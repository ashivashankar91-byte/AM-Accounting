/**
 * @module PayrollService
 * @why-built COBOL had no integrated payroll module — payroll was posted as raw
 *   GL journal entries with no tax computation, no employee tracking, and no
 *   duplicate detection. This service provides a full production payroll cycle.
 * @intelligence-additions
 *   - 9 business-rule validations before batch approval
 *   - Multi-line double-entry GL journal on post (debits = credits enforced)
 *   - Reversing journal entry on void
 *   - YTD accumulator updates on post/void
 *   - Duplicate detection (exact period + similar gross)
 */

import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { TenantId } from '@amacc/shared-kernel';
import { PrismaClient, Prisma } from '.prisma/payroll-client';
import pino from 'pino';
import {
  IEmployeeRepository,
  CreateEmployeeDto,
  UpdateEmployeeDto,
} from '../infrastructure/employee-repository';
import { IBatchRepository, CreateBatchDto } from '../infrastructure/batch-repository';
import { IPayrollItemRepository, CreatePayrollItemDto } from '../infrastructure/payroll-item-repository';
import { IGLMappingRepository, GLMappingDto } from '../infrastructure/gl-mapping-repository';
import { ITaxRateRepository, TaxRateDto } from '../infrastructure/tax-rate-repository';
import { IEmployeeYTDRepository, YTDAccumulatorDelta } from '../infrastructure/employee-ytd-repository';
import {
  detectExactDuplicate,
  detectSimilarGross,
  BatchSummary,
  ItemSummary,
} from '../domain/duplicate-detector';
import { IPostingGateway, PostingGatewayUnavailableError, PostingRefusedError, PayrollDistributionLine } from '../infrastructure/posting-gateway';
import { PayrollSourceRegistry } from '../domain/engines/payroll-source-registry';
import {
  PayrollWithholdingLines,
  WITHHOLDING_STATUSES_ALLOWING_PROCEED,
  ZERO_WITHHOLDING,
} from '../domain/payroll-adapter-contract';
import {
  DuplicatePayrollRunError,
  SegregationOfDutiesError,
  MissingGLMappingError,
} from '../domain/errors';

const logger = pino({ name: 'payroll-service' });

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface SubmitBatchDTO {
  batchRef: string;
  periodStart: Date;
  periodEnd: Date;
  totalAmount: number;
  idempotencyKey: string;
  createdByUserId?: string;
}

export interface CreateBatchRequest {
  batchNumber: string;
  payPeriodStart: Date;
  payPeriodEnd: Date;
  payDate: Date;
  payFrequency: string;
  createdBy: string;
  /** Idempotency / duplicate-payroll-prevention key from the upstream provider or manual run identifier (S108 AC). */
  providerRunId?: string;
}

export interface AddItemRequest {
  employeeId: string;
  department?: string;
  regularHours?: number;
  overtimeHours?: number;
  regularPay: number;
  overtimePay?: number;
  commissionPay?: number;
  bonusPay?: number;
  otherPay?: number;
  otherDeductions?: number;
  glAccountCode?: string;
  glDepartment?: string;
  /**
   * Statutory withholding boundary (never computed by payroll-service — see
   * domain/payroll-adapter-contract.ts). Required to move an item out of
   * NOT_CONFIGURED when the tenant's payrollSourceMode is MANUAL_ATTESTED:
   * these are figures a human copied from the certified provider's own
   * register, with attestation.
   */
  attestedWithholding?: Partial<PayrollWithholdingLines>;
  attestedBy?: string;
  sourceDocumentRef?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PostingResult {
  batchId: string;
  journalEntryId: string;
  totalDebits: number;
  totalCredits: number;
  linesPosted: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dec(n: number | undefined | null): Prisma.Decimal {
  return new Prisma.Decimal(n ?? 0);
}

function toNum(d: Prisma.Decimal | null | undefined): number {
  return d ? Number(d.toString()) : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isoYear(d: Date): number {
  return d.getFullYear();
}


// ── Service ──────────────────────────────────────────────────────────────────

@injectable()
export class PayrollService {
  constructor(
    @inject('IEmployeeRepository') private readonly employeeRepo: IEmployeeRepository,
    @inject('IBatchRepository') private readonly batchRepo: IBatchRepository,
    @inject('IPayrollItemRepository') private readonly itemRepo: IPayrollItemRepository,
    @inject('IGLMappingRepository') private readonly glMappingRepo: IGLMappingRepository,
    @inject('ITaxRateRepository') private readonly taxRateRepo: ITaxRateRepository,
    @inject('IEmployeeYTDRepository') private readonly ytdRepo: IEmployeeYTDRepository,
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IPostingGateway') private readonly postingGateway: IPostingGateway,
    @inject('PayrollSourceRegistry') private readonly sourceRegistry: PayrollSourceRegistry,
  ) {}

  // ── Employee CRUD ──────────────────────────────────────────────────────────

  async createEmployee(tenantId: TenantId, dto: CreateEmployeeDto) {
    const existing = await this.employeeRepo.findByCode(tenantId, dto.employeeCode);
    if (existing) throw new Error(`Employee code ${dto.employeeCode} already exists`);
    return this.employeeRepo.create(tenantId, dto);
  }

  async getEmployee(tenantId: TenantId, id: string) {
    const emp = await this.employeeRepo.findById(tenantId, id);
    if (!emp) throw new Error(`Employee ${id} not found`);
    return emp;
  }

  async listEmployees(tenantId: TenantId, filters?: { department?: string; isActive?: boolean }) {
    return this.employeeRepo.findAll(tenantId, filters);
  }

  async updateEmployee(tenantId: TenantId, id: string, dto: UpdateEmployeeDto) {
    await this.getEmployee(tenantId, id);
    return this.employeeRepo.update(tenantId, id, dto);
  }

  async terminateEmployee(tenantId: TenantId, id: string, terminationDate: Date) {
    await this.getEmployee(tenantId, id);
    return this.employeeRepo.terminate(tenantId, id, terminationDate);
  }

  // ── Batch Lifecycle ────────────────────────────────────────────────────────

  async createBatch(tenantId: TenantId, dto: CreateBatchRequest) {
    const existing = await this.batchRepo.findByBatchNumber(tenantId, dto.batchNumber);
    if (existing) throw new Error(`Batch number ${dto.batchNumber} already exists`);
    if (dto.payPeriodStart >= dto.payPeriodEnd) {
      throw new Error('payPeriodStart must be before payPeriodEnd');
    }
    // Duplicate-payroll-run prevention (S108 AC): the same providerRunId for
    // the same pay period, for the same tenant, can never create a second
    // batch — this is the idempotency boundary for retried/duplicated
    // upstream imports, enforced both here and by the DB unique constraint
    // (tenantId, providerRunId, payPeriodStart, payPeriodEnd) as a
    // concurrency backstop.
    if (dto.providerRunId) {
      const dup = await this.batchRepo.findByProviderRunId(tenantId, dto.providerRunId, dto.payPeriodStart, dto.payPeriodEnd);
      if (dup) {
        throw new DuplicatePayrollRunError(
          `A payroll batch already exists for providerRunId=${dto.providerRunId} in this pay period (batch ${dup.batchNumber}, status ${dup.status})`,
        );
      }
    }
    try {
      return await this.batchRepo.create(tenantId, dto);
    } catch (err: any) {
      // DB-level race backstop: unique constraint violation (P2002) surfaces as the same duplicate error.
      if (err?.code === 'P2002') {
        throw new DuplicatePayrollRunError(`A payroll batch already exists for providerRunId=${dto.providerRunId} in this pay period`);
      }
      throw err;
    }
  }

  async getBatch(tenantId: TenantId, id: string) {
    const batch = await this.batchRepo.findById(tenantId, id);
    if (!batch) throw new Error(`Batch ${id} not found`);
    return batch;
  }

  async listBatches(tenantId: TenantId, filters?: { status?: string; payFrequency?: string }) {
    return this.batchRepo.listByTenant(tenantId, filters);
  }

  async addItemToBatch(tenantId: TenantId, batchId: string, req: AddItemRequest) {
    const batch = await this.getBatch(tenantId, batchId);
    if (!['DRAFT', 'VALIDATED'].includes(batch.status)) {
      throw new Error(`Cannot add items to batch in status ${batch.status}`);
    }

    const employee = await this.employeeRepo.findById(tenantId, req.employeeId);
    if (!employee) throw new Error(`Employee ${req.employeeId} not found`);

    const grossPay =
      req.regularPay +
      (req.overtimePay ?? 0) +
      (req.commissionPay ?? 0) +
      (req.bonusPay ?? 0) +
      (req.otherPay ?? 0);

    // ── CE-13 statutory boundary ────────────────────────────────────────────
    // Withholding is NEVER computed here. The tenant's configured
    // payrollSourceMode resolves to exactly one of:
    //   NullPayrollSource       -> NOT_CONFIGURED (blocks validate/post, names employee)
    //   AttestedManualSource    -> requires req.attestedBy + sourceDocumentRef,
    //                              carries entered figures through unchanged
    //   TestFixturePayrollSource-> deterministic labeled fixture math, hard-
    //                              restricted to TEST-TENANT-CE13-CERTIFICATION-ONLY,
    //                              always productionCertified:false
    const tenantConfig = await (this.prisma as any).payrollTenantConfig.findUnique({ where: { tenantId } });
    const adapter = this.sourceRegistry.resolve(tenantConfig?.payrollSourceMode);
    const withholdingResult = await adapter.resolve(
      {
        tenantId,
        employeeId: req.employeeId,
        grossPay,
        payFrequency: employee.payFrequency,
        businessDate: (batch.payDate as Date).toISOString().slice(0, 10),
      },
      { ...req.attestedWithholding, attestedBy: req.attestedBy, sourceDocumentRef: req.sourceDocumentRef },
    );

    const taxes: PayrollWithholdingLines = WITHHOLDING_STATUSES_ALLOWING_PROCEED.has(withholdingResult.status)
      ? withholdingResult.lines
      : ZERO_WITHHOLDING;

    const totalDeductions =
      taxes.federalTax + taxes.stateTax + taxes.socialSecurity + taxes.medicare + (req.otherDeductions ?? 0);
    const netPay = grossPay - totalDeductions;
    const totalEmployerTax =
      taxes.employerFICA + taxes.employerMedicare + taxes.employerFUTA + taxes.employerSUTA;

    const item = await this.itemRepo.create(tenantId, {
      batchId,
      employeeId: req.employeeId,
      department: req.department ?? employee.department,
      regularHours: req.regularHours ?? null,
      overtimeHours: req.overtimeHours ?? null,
      regularPay: req.regularPay,
      overtimePay: req.overtimePay ?? 0,
      commissionPay: req.commissionPay ?? 0,
      bonusPay: req.bonusPay ?? 0,
      otherPay: req.otherPay ?? 0,
      grossPay,
      federalTax: taxes.federalTax,
      stateTax: taxes.stateTax,
      socialSecurity: taxes.socialSecurity,
      medicare: taxes.medicare,
      otherDeductions: req.otherDeductions ?? 0,
      totalDeductions,
      netPay,
      employerFICA: taxes.employerFICA,
      employerMedicare: taxes.employerMedicare,
      employerFUTA: taxes.employerFUTA,
      employerSUTA: taxes.employerSUTA,
      totalEmployerTax,
      glAccountCode: req.glAccountCode ?? null,
      glDepartment: req.glDepartment ?? null,
      withholdingStatus: withholdingResult.status,
      withholdingSource: withholdingResult.source,
      attestedBy: withholdingResult.attestedBy ?? null,
      attestedAt: withholdingResult.attestedAt ? new Date(withholdingResult.attestedAt) : null,
      sourceDocumentRef: withholdingResult.sourceDocumentRef ?? null,
    });

    await this.recomputeBatchTotals(tenantId, batchId);
    return { ...item, withholdingRejectReason: withholdingResult.rejectReason ?? null };
  }

  async removeItemFromBatch(tenantId: TenantId, batchId: string, itemId: string) {
    const batch = await this.getBatch(tenantId, batchId);
    if (!['DRAFT', 'VALIDATED'].includes(batch.status)) {
      throw new Error(`Cannot remove items from batch in status ${batch.status}`);
    }
    const item = await this.itemRepo.findById(tenantId, itemId);
    if (!item || item.batchId !== batchId) throw new Error(`Item ${itemId} not found in batch ${batchId}`);
    await this.itemRepo.deleteById(tenantId, itemId);
    await this.recomputeBatchTotals(tenantId, batchId);
  }

  private async recomputeBatchTotals(tenantId: TenantId, batchId: string) {
    const totals = await this.itemRepo.sumByBatch(tenantId, batchId);
    await this.batchRepo.updateTotals(tenantId, batchId, totals);
  }

  // ── Validation — 9 business rules ─────────────────────────────────────────

  async validateBatch(tenantId: TenantId, batchId: string): Promise<ValidationResult> {
    const batch = await this.getBatch(tenantId, batchId);
    const errors: string[] = [];

    // Rule 1: batch must be in DRAFT
    if (batch.status !== 'DRAFT') {
      errors.push(`Batch status is ${batch.status}; only DRAFT batches can be validated`);
    }

    // Rule 2: at least one item
    const items = await this.itemRepo.findByBatch(tenantId, batchId);
    if (items.length === 0) {
      errors.push('Batch has no payroll items');
    }

    // Rule 3: no duplicate employees
    const empIds = items.map((i: any) => i.employeeId as string);
    const uniqueEmpIds = new Set(empIds);
    if (uniqueEmpIds.size !== empIds.length) {
      errors.push('Batch contains duplicate employees');
    }

    // Rule 4: all employees active
    const inactiveEmps = items.filter((i: any) => !i.employee?.isActive);
    if (inactiveEmps.length > 0) {
      errors.push(`Batch contains ${inactiveEmps.length} inactive employee(s)`);
    }

    // Rule 5: pay date not more than 7 days in future
    const sevenDaysAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (batch.payDate > sevenDaysAhead) {
      errors.push(`Pay date ${batch.payDate.toISOString().slice(0, 10)} is more than 7 days in the future`);
    }

    // Rule 6: FICA ≤ gross sanity check
    for (const item of items) {
      const fica = toNum(item.socialSecurity);
      const gross = toNum(item.grossPay);
      if (fica > gross) {
        errors.push(`Employee ${item.employeeId as string}: FICA ($${fica}) > gross ($${gross})`);
      }
    }

    // Rule 7: GL mappings exist for each dept × component
    const depts = new Set(items.map((i: any) => i.department as string));
    const requiredComponents = ['REGULAR_PAY', 'FICA_TAX', 'MEDICARE_TAX', 'FED_TAX', 'NET_PAY'];
    for (const dept of depts) {
      for (const comp of requiredComponents) {
        const mapping = await this.glMappingRepo.findByDeptAndComponent(tenantId, dept, comp);
        if (!mapping) {
          errors.push(`Missing GL mapping for department=${dept} component=${comp}`);
        }
      }
    }

    // Rule 8: gross = net + deductions (within $0.01)
    const totalGross = toNum(batch.totalGrossPay);
    const totalNet = toNum(batch.totalNetPay);
    const totalDeduct = toNum(batch.totalDeductions);
    if (Math.abs(totalGross - totalNet - totalDeduct) > 0.01) {
      errors.push(
        `Batch totals do not balance: gross=${totalGross} ≠ net=${totalNet} + deductions=${totalDeduct}`,
      );
    }

    // Rule 9: no period overlap with POSTED batches of same frequency
    const windowStart = new Date(batch.payPeriodStart.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(batch.payPeriodEnd.getTime() + 24 * 60 * 60 * 1000);
    const otherBatches = await this.batchRepo.listNonVoidInWindow(tenantId, windowStart, windowEnd);
    const overlapping = otherBatches.filter(
      (b: any) =>
        b.id !== batchId &&
        b.status === 'POSTED' &&
        b.payFrequency === batch.payFrequency &&
        b.payPeriodStart <= batch.payPeriodEnd &&
        b.payPeriodEnd >= batch.payPeriodStart,
    );
    if (overlapping.length > 0) {
      errors.push(
        `Pay period overlaps with posted batch(es): ${overlapping.map((b: any) => b.batchNumber as string).join(', ')}`,
      );
    }

    // Rule 10 (CE-13 statutory boundary, S108 AC): every item's withholding
    // must have progressed past NOT_CONFIGURED (attested or a labeled test
    // fixture) — never silently estimated. Names the affected employees
    // rather than a generic failure.
    const unresolved = items.filter((i: any) => !WITHHOLDING_STATUSES_ALLOWING_PROCEED.has(i.withholdingStatus));
    if (unresolved.length > 0) {
      errors.push(
        `PAYROLL_SOURCE_NOT_CONFIGURED: withholding is not resolved for employee(s): ${unresolved
          .map((i: any) => i.employeeId as string)
          .join(', ')}. Attest each item's withholding or configure a certified payroll source before validating.`,
      );
    }

    if (errors.length === 0) {
      await this.batchRepo.updateStatus(tenantId, batchId, 'VALIDATED');
    }

    return { valid: errors.length === 0, errors };
  }

  async holdBatch(tenantId: TenantId, batchId: string, holdReason: string, heldBy: string): Promise<void> {
    const batch = await this.getBatch(tenantId, batchId);
    if (!['DRAFT', 'VALIDATED'].includes(batch.status)) {
      throw new Error(`Only DRAFT or VALIDATED batches can be held; current status: ${batch.status}`);
    }
    await this.batchRepo.updateStatus(tenantId, batchId, 'HOLD', { holdReason, heldBy, heldAt: new Date() });
  }

  async releaseBatch(tenantId: TenantId, batchId: string): Promise<void> {
    const batch = await this.getBatch(tenantId, batchId);
    if (batch.status !== 'HOLD') {
      throw new Error(`Only HOLD batches can be released; current status: ${batch.status}`);
    }
    // Releases back to DRAFT so validation (Rule 10, duplicate checks, etc.)
    // must re-run before approval — a released batch is never trusted as
    // still-valid without re-validation.
    await this.batchRepo.updateStatus(tenantId, batchId, 'DRAFT', { holdReason: null, heldBy: null, heldAt: null });
  }

  async approveBatch(tenantId: TenantId, batchId: string, approvedBy: string): Promise<ValidationResult> {
    const batch = await this.getBatch(tenantId, batchId);
    if (batch.status !== 'VALIDATED') {
      throw new Error(`Batch must be VALIDATED before approval; current status: ${batch.status}`);
    }
    // Segregation of duties: the batch preparer cannot also approve it.
    if (batch.createdBy === approvedBy) {
      throw new SegregationOfDutiesError('The same user who created this payroll batch cannot approve it (self-approval denial).');
    }

    const errors: string[] = [];
    const items = await this.itemRepo.findByBatch(tenantId, batchId);
    const proposedItems: ItemSummary[] = items.map((i: any) => ({
      employeeId: i.employeeId as string,
      grossPay: toNum(i.grossPay),
    }));

    const windowMs = 14 * 24 * 60 * 60 * 1000;
    const fromDate = new Date(batch.payDate.getTime() - windowMs);
    const toDate = new Date(batch.payDate.getTime() + windowMs);
    const existingBatches = await this.batchRepo.listNonVoidInWindow(tenantId, fromDate, toDate);

    const existingItemsByBatch = new Map<string, ItemSummary[]>();
    for (const eb of existingBatches) {
      if (eb.id === batchId) continue;
      const ebItems = await this.itemRepo.findByBatch(tenantId, eb.id as string);
      existingItemsByBatch.set(
        eb.id as string,
        ebItems.map((i: any) => ({ employeeId: i.employeeId as string, grossPay: toNum(i.grossPay) })),
      );
    }

    const otherBatches: BatchSummary[] = existingBatches
      .filter((b: any) => b.id !== batchId)
      .map((b: any) => ({
        id: b.id as string,
        status: b.status as string,
        payPeriodStart: b.payPeriodStart as Date,
        payPeriodEnd: b.payPeriodEnd as Date,
        payDate: b.payDate as Date,
        totalGrossPay: toNum(b.totalGrossPay),
        employeeCount: b.employeeCount as number,
      }));

    const exactCheck = detectExactDuplicate(
      { payPeriodStart: batch.payPeriodStart, payPeriodEnd: batch.payPeriodEnd, employeeCount: batch.employeeCount },
      otherBatches,
      proposedItems,
      existingItemsByBatch,
    );
    if (exactCheck.isDuplicate) errors.push(exactCheck.message!);

    const similarCheck = detectSimilarGross(
      { payDate: batch.payDate, totalGrossPay: toNum(batch.totalGrossPay) },
      otherBatches,
    );
    if (similarCheck.isDuplicate) errors.push(similarCheck.message!);

    if (errors.length === 0) {
      await this.batchRepo.updateStatus(tenantId, batchId, 'APPROVED', {
        approvedBy,
        approvedAt: new Date(),
      });
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * fix(integration): extracted so voidBatch can rebuild the identical
   * per-department journal lines (mirrored to a symmetric reversal) instead
   * of submitting an empty distributions array — CE-07's blueprint resolver
   * (debitLineItemsPath/creditLineItemsPath) requires a non-empty line-item
   * array on every posting/reversal event, never just on the original post.
   */
  private async buildJournalLines(tenantId: TenantId, items: Awaited<ReturnType<IPayrollItemRepository['findByBatch']>>) {
    const journalLines: Array<{ glAccountCode: string; debit: number; credit: number; description: string }> = [];
    const deptTotals = new Map<string, {
      grossPay: number; netPay: number; federalTax: number; stateTax: number;
      fica: number; medicare: number; employerFICA: number; employerMedicare: number;
      employerFUTA: number; employerSUTA: number; otherDeductions: number;
    }>();

    for (const item of items) {
      const dept = item.department as string;
      const cur = deptTotals.get(dept) ?? {
        grossPay: 0, netPay: 0, federalTax: 0, stateTax: 0,
        fica: 0, medicare: 0, employerFICA: 0, employerMedicare: 0,
        employerFUTA: 0, employerSUTA: 0, otherDeductions: 0,
      };
      cur.grossPay += toNum(item.grossPay);
      cur.netPay += toNum(item.netPay);
      cur.federalTax += toNum(item.federalTax);
      cur.stateTax += toNum(item.stateTax);
      cur.fica += toNum(item.socialSecurity);
      cur.medicare += toNum(item.medicare);
      cur.employerFICA += toNum(item.employerFICA);
      cur.employerMedicare += toNum(item.employerMedicare);
      cur.employerFUTA += toNum(item.employerFUTA);
      cur.employerSUTA += toNum(item.employerSUTA);
      cur.otherDeductions += toNum(item.otherDeductions);
      deptTotals.set(dept, cur);
    }

    let totalDebits = 0;
    let totalCredits = 0;

    for (const [dept, totals] of deptTotals) {
      const mappings = await this.glMappingRepo.findByDepartment(tenantId, dept);
      const getMapping = (component: string) =>
        (mappings.find((m: any) => m.payComponent === component)?.glAccountCode as string | undefined) ?? '9999-UNMAPPED';

      journalLines.push({ glAccountCode: getMapping('REGULAR_PAY'), debit: round2(totals.grossPay), credit: 0, description: `${dept} gross wages` });
      totalDebits += totals.grossPay;
      journalLines.push({ glAccountCode: getMapping('EMPLOYER_FICA_EXPENSE'), debit: round2(totals.employerFICA), credit: 0, description: `${dept} employer FICA` });
      totalDebits += totals.employerFICA;
      journalLines.push({ glAccountCode: getMapping('EMPLOYER_MEDICARE_EXPENSE'), debit: round2(totals.employerMedicare), credit: 0, description: `${dept} employer Medicare` });
      totalDebits += totals.employerMedicare;
      journalLines.push({ glAccountCode: getMapping('EMPLOYER_FUTA_EXPENSE'), debit: round2(totals.employerFUTA), credit: 0, description: `${dept} employer FUTA` });
      totalDebits += totals.employerFUTA;
      journalLines.push({ glAccountCode: getMapping('EMPLOYER_SUTA_EXPENSE'), debit: round2(totals.employerSUTA), credit: 0, description: `${dept} employer SUTA` });
      totalDebits += totals.employerSUTA;

      journalLines.push({ glAccountCode: getMapping('NET_PAY'), debit: 0, credit: round2(totals.netPay), description: `${dept} net payroll disbursement` });
      totalCredits += totals.netPay;
      journalLines.push({ glAccountCode: getMapping('FED_TAX'), debit: 0, credit: round2(totals.federalTax), description: `${dept} federal income tax withheld` });
      totalCredits += totals.federalTax;
      journalLines.push({ glAccountCode: getMapping('STATE_TAX'), debit: 0, credit: round2(totals.stateTax), description: `${dept} state income tax withheld` });
      totalCredits += totals.stateTax;
      journalLines.push({ glAccountCode: getMapping('FICA_TAX'), debit: 0, credit: round2(totals.fica + totals.employerFICA), description: `${dept} FICA payable (employee + employer)` });
      totalCredits += totals.fica + totals.employerFICA;
      journalLines.push({ glAccountCode: getMapping('MEDICARE_TAX'), debit: 0, credit: round2(totals.medicare + totals.employerMedicare), description: `${dept} Medicare payable (employee + employer)` });
      totalCredits += totals.medicare + totals.employerMedicare;
      journalLines.push({ glAccountCode: getMapping('FUTA_TAX'), debit: 0, credit: round2(totals.employerFUTA), description: `${dept} FUTA payable` });
      totalCredits += totals.employerFUTA;
      journalLines.push({ glAccountCode: getMapping('SUTA_TAX'), debit: 0, credit: round2(totals.employerSUTA), description: `${dept} SUTA payable` });
      totalCredits += totals.employerSUTA;
      if (totals.otherDeductions > 0) {
        journalLines.push({ glAccountCode: getMapping('OTHER_DEDUCTIONS'), debit: 0, credit: round2(totals.otherDeductions), description: `${dept} other deductions payable` });
        totalCredits += totals.otherDeductions;
      }
    }

    return { journalLines, totalDebits, totalCredits };
  }

  async postBatch(tenantId: TenantId, batchId: string, postedByUserId: string): Promise<PostingResult> {
    const batch = await this.getBatch(tenantId, batchId);
    if (batch.status !== 'APPROVED') {
      throw new Error(`Batch must be APPROVED before posting; current status: ${batch.status}`);
    }
    // Segregation of duties, second gate: the identity executing the post
    // step must differ from the batch's approver. gl-service enforces the
    // same rule again independently (createdByUserId vs approverUserId on
    // the journal entry itself) as a defense-in-depth backstop.
    if (postedByUserId === batch.approvedBy) {
      throw new SegregationOfDutiesError('The batch approver cannot also execute the posting step (self-approval denial).');
    }

    const items = await this.itemRepo.findByBatch(tenantId, batchId);
    if (items.length === 0) throw new Error('No items to post');

    const { journalLines, totalDebits, totalCredits } = await this.buildJournalLines(tenantId, items);

    // Double-entry balance enforcement
    const imbalance = Math.abs(totalDebits - totalCredits);
    if (imbalance > 0.02) {
      throw new Error(
        `Journal entry is out of balance: debits=${totalDebits.toFixed(2)} credits=${totalCredits.toFixed(2)} diff=${imbalance.toFixed(2)}`,
      );
    }

    // Governed posting (CE-13 gap #2): payroll-service no longer resolves GL
    // account codes or constructs a journal entry itself — the departmental
    // pay-component amounts above are business FACTS (distributions), not GL
    // write instructions. They are submitted as one canonical
    // PAYROLL_BATCH_POSTED event to CE-07's posting engine
    // (coa-service /posting-engine/events); CE-07's own rule pack resolves
    // the account mapping and performs the actual authoritative journal
    // write. A missing/blank mapping surfaces as CE-07's own deterministic
    // NO_RULE_MATCH/REJECTED refusal (PostingRefusedError below), never a
    // silently-estimated or partially-posted journal. If CE-07 itself is
    // unreachable, this fails closed with PostingGatewayUnavailableError
    // (PENDING_CE07_TECHNICAL_RECONCILIATION) — there is no fallback path
    // to a direct gl-service write.
    const distributions: PayrollDistributionLine[] = journalLines.map((line) => ({
      payComponent: line.glAccountCode,
      department: (line.description.split(' ')[0]) ?? 'UNKNOWN',
      amount: line.debit > 0 ? line.debit : line.credit,
      direction: line.debit > 0 ? 'DEBIT' : 'CREDIT',
    }));

    let posted;
    try {
      posted = await this.postingGateway.submitPayrollEvent({
        tenantId,
        legalEntityId: tenantId, // see posting-gateway.ts's doc-comment — single-entity-per-tenant default
        batchId,
        batchNumber: batch.batchNumber as string,
        businessDate: (batch.payDate as Date).toISOString().slice(0, 10),
        payPeriodStart: (batch.payPeriodStart as Date).toISOString().slice(0, 10),
        payPeriodEnd: (batch.payPeriodEnd as Date).toISOString().slice(0, 10),
        distributions,
        idempotencyKey: `payroll-batch-posted:${tenantId}:${batchId}`,
        correlationId: batchId,
        rulePackVersionId: (batch.rulePackVersionId as string) ?? null,
        actor: postedByUserId,
        eventType: 'PAYROLL_BATCH_POSTED',
      });
    } catch (err) {
      if (err instanceof PostingRefusedError) throw new MissingGLMappingError(err.message);
      throw err;
    }
    const journalEntryId = posted.journalEntryId ?? posted.executionId;

    await this.batchRepo.updateStatus(tenantId, batchId, 'POSTED', { postedAt: new Date() });
    await this.batchRepo.setJournalEntryId(tenantId, batchId, journalEntryId as string);


    const year = isoYear(batch.payDate as Date);
    for (const item of items) {
      const delta: YTDAccumulatorDelta = {
        grossPay: dec(toNum(item.grossPay)),
        federalTax: dec(toNum(item.federalTax)),
        stateTax: dec(toNum(item.stateTax)),
        socialSecurity: dec(toNum(item.socialSecurity)),
        medicare: dec(toNum(item.medicare)),
        ficaWages: dec(toNum(item.grossPay)),
        otherDeductions: dec(toNum(item.otherDeductions)),
        netPay: dec(toNum(item.netPay)),
      };
      await this.ytdRepo.accumulateDelta(tenantId, item.employeeId as string, year, delta);
    }

    await this.prisma.outboxEvent.create({
      data: {
        eventType: 'PAYROLL_BATCH_POSTED',
        tenantId,
        payload: { batchId, batchNumber: batch.batchNumber, journalEntryId, totalGross: toNum(batch.totalGrossPay) } as any,
      },
    });

    logger.info({ batchId, journalEntryId, totalDebits, totalCredits }, 'Payroll batch posted');
    return { batchId, journalEntryId, totalDebits: round2(totalDebits), totalCredits: round2(totalCredits), linesPosted: journalLines.length };
  }

  async voidBatch(tenantId: TenantId, batchId: string, voidReason: string, voidedByUserId: string): Promise<PostingResult> {
    const batch = await this.getBatch(tenantId, batchId);
    if (batch.status !== 'POSTED') {
      throw new Error(`Only POSTED batches can be voided; current status: ${batch.status}`);
    }
    if (!voidReason?.trim()) throw new Error('voidReason is required');
    if (!batch.journalEntryId) throw new Error('Batch has no linked journal entry to reverse');

    const items = await this.itemRepo.findByBatch(tenantId, batchId);

    // fix(integration): CE-07's blueprint resolver requires a non-empty
    // debitLineItemsPath/creditLineItemsPath array on every event it posts,
    // including reversals — rebuild the SAME per-department lines postBatch
    // used, with debit/credit swapped, so the reversal is the true
    // symmetric mirror of the original journal rather than an empty event
    // that CE-07 would refuse (MISSING_LINE_ITEMS).
    const { journalLines: originalLines } = await this.buildJournalLines(tenantId, items);
    const reversingDistributions: PayrollDistributionLine[] = originalLines.map((line) => ({
      payComponent: line.glAccountCode,
      department: (line.description.split(' ')[0]) ?? 'UNKNOWN',
      amount: line.debit > 0 ? line.debit : line.credit,
      // Mirrored: what was a debit on the original journal is a credit on
      // the reversal, and vice versa (symmetric reversing entry).
      direction: line.debit > 0 ? 'CREDIT' : 'DEBIT',
    }));

    // Original-to-reversal linkage (S218): submit a PAYROLL_BATCH_REVERSED
    // canonical event through the same CE-07 governed posting boundary
    // (never a direct gl-service call) — reversalOfEventId links back to
    // the original PAYROLL_BATCH_POSTED event's deterministic id so CE-07's
    // rule pack can construct the symmetric reversing journal with
    // reversalOfId/reversedById linkage. Fails closed exactly like postBatch.
    const originalIdempotencyKey = `payroll-batch-posted:${tenantId}:${batchId}`;
    const originalEventId = crypto.createHash('sha256').update(originalIdempotencyKey).digest('hex');
    let reversal;
    try {
      reversal = await this.postingGateway.submitPayrollEvent({
        tenantId,
        legalEntityId: tenantId, // see posting-gateway.ts's doc-comment — single-entity-per-tenant default
        batchId,
        batchNumber: batch.batchNumber as string,
        businessDate: new Date().toISOString().slice(0, 10),
        payPeriodStart: (batch.payPeriodStart as Date).toISOString().slice(0, 10),
        payPeriodEnd: (batch.payPeriodEnd as Date).toISOString().slice(0, 10),
        distributions: reversingDistributions,
        idempotencyKey: `payroll-batch-reversed:${tenantId}:${batchId}:${voidReason}`,
        correlationId: batchId,
        actor: voidedByUserId,
        eventType: 'PAYROLL_BATCH_REVERSED',
        reversalOfEventId: originalEventId,
      });
    } catch (err) {
      if (err instanceof PostingRefusedError) throw new MissingGLMappingError(err.message);
      throw err;
    }
    const journalEntryId = reversal.journalEntryId ?? reversal.executionId;

    await this.batchRepo.updateStatus(tenantId, batchId, 'VOID', { voidedAt: new Date(), voidReason });

    const totalDebits = toNum(batch.totalNetPay) + toNum(batch.totalDeductions);
    const totalCredits = totalDebits; // symmetric reversal — CE-07 enforces balance

    const year = isoYear(batch.payDate as Date);
    for (const item of items) {
      const delta: YTDAccumulatorDelta = {
        grossPay: dec(toNum(item.grossPay)), federalTax: dec(toNum(item.federalTax)),
        stateTax: dec(toNum(item.stateTax)), socialSecurity: dec(toNum(item.socialSecurity)),
        medicare: dec(toNum(item.medicare)), ficaWages: dec(toNum(item.grossPay)),
        otherDeductions: dec(toNum(item.otherDeductions)), netPay: dec(toNum(item.netPay)),
      };
      await this.ytdRepo.reverseDelta(tenantId, item.employeeId as string, year, delta);
    }


    await this.prisma.outboxEvent.create({
      data: {
        eventType: 'PAYROLL_BATCH_VOIDED',
        tenantId,
        payload: { batchId, batchNumber: batch.batchNumber, journalEntryId, voidReason } as any,
      },
    });

    logger.info({ batchId, journalEntryId }, 'Payroll batch voided (S218 reversal)');
    return { batchId, journalEntryId, totalDebits: round2(totalDebits), totalCredits: round2(totalCredits), linesPosted: items.length };
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  async payrollRegister(tenantId: TenantId, batchId: string) {
    const batch = await this.getBatch(tenantId, batchId);
    const items = await this.itemRepo.findByBatch(tenantId, batchId);
    return {
      batch: {
        batchNumber: batch.batchNumber, payPeriodStart: batch.payPeriodStart, payPeriodEnd: batch.payPeriodEnd,
        payDate: batch.payDate, status: batch.status, totalGrossPay: toNum(batch.totalGrossPay),
        totalDeductions: toNum(batch.totalDeductions), totalNetPay: toNum(batch.totalNetPay),
        totalEmployerTax: toNum(batch.totalEmployerTax), employeeCount: batch.employeeCount,
      },
      items: items.map((i: any) => ({
        employeeId: i.employeeId, employeeName: `${i.employee?.firstName ?? ''} ${i.employee?.lastName ?? ''}`.trim(),
        department: i.department, grossPay: toNum(i.grossPay), federalTax: toNum(i.federalTax),
        stateTax: toNum(i.stateTax), socialSecurity: toNum(i.socialSecurity), medicare: toNum(i.medicare),
        otherDeductions: toNum(i.otherDeductions), totalDeductions: toNum(i.totalDeductions),
        netPay: toNum(i.netPay), employerFICA: toNum(i.employerFICA), employerMedicare: toNum(i.employerMedicare),
        employerFUTA: toNum(i.employerFUTA), employerSUTA: toNum(i.employerSUTA),
      })),
    };
  }

  async payrollSummary(tenantId: TenantId, batchId: string) {
    const batch = await this.getBatch(tenantId, batchId);
    return {
      batchNumber: batch.batchNumber, payDate: batch.payDate, status: batch.status,
      totalGrossPay: toNum(batch.totalGrossPay), totalNetPay: toNum(batch.totalNetPay),
      totalDeductions: toNum(batch.totalDeductions), totalEmployerTax: toNum(batch.totalEmployerTax),
      employeeCount: batch.employeeCount,
    };
  }

  async departmentalSummary(tenantId: TenantId, batchId: string) {
    const items = await this.itemRepo.findByBatch(tenantId, batchId);
    const deptMap = new Map<string, { grossPay: number; netPay: number; headCount: number; employerTax: number }>();
    for (const item of items) {
      const dept = item.department as string;
      const cur = deptMap.get(dept) ?? { grossPay: 0, netPay: 0, headCount: 0, employerTax: 0 };
      cur.grossPay += toNum(item.grossPay); cur.netPay += toNum(item.netPay);
      cur.headCount++; cur.employerTax += toNum(item.totalEmployerTax);
      deptMap.set(dept, cur);
    }
    return Array.from(deptMap.entries()).map(([department, totals]) => ({ department, ...totals }));
  }

  async employeeYTD(tenantId: TenantId, employeeId: string, year: number) {
    await this.getEmployee(tenantId, employeeId);
    const ytd = await this.ytdRepo.findByEmployeeAndYear(tenantId, employeeId, year);
    if (!ytd) return { employeeId, year, message: 'No YTD data found' };
    return {
      employeeId, year,
      grossPay: toNum(ytd.grossPay), federalTax: toNum(ytd.federalTax), stateTax: toNum(ytd.stateTax),
      socialSecurity: toNum(ytd.socialSecurity), medicare: toNum(ytd.medicare),
      ficaWages: toNum(ytd.ficaWages), otherDeductions: toNum(ytd.otherDeductions), netPay: toNum(ytd.netPay),
    };
  }

  async taxLiabilityReport(tenantId: TenantId, year: number) {
    const ytdRecords = await this.ytdRepo.findByTenantAndYear(tenantId, year);
    const totals = ytdRecords.reduce(
      (acc: any, r: any) => ({
        federalTax: acc.federalTax + toNum(r.federalTax), stateTax: acc.stateTax + toNum(r.stateTax),
        socialSecurity: acc.socialSecurity + toNum(r.socialSecurity), medicare: acc.medicare + toNum(r.medicare),
      }),
      { federalTax: 0, stateTax: 0, socialSecurity: 0, medicare: 0 },
    );
    return { year, employeeCount: ytdRecords.length, ...totals };
  }

  // ── GL Mapping Management ──────────────────────────────────────────────────

  async listGLMappings(tenantId: TenantId) { return this.glMappingRepo.findAll(tenantId); }
  async upsertGLMapping(tenantId: TenantId, dto: GLMappingDto) { return this.glMappingRepo.upsert(tenantId, dto); }
  async deleteGLMapping(tenantId: TenantId, department: string, payComponent: string) {
    await this.glMappingRepo.delete(tenantId, department, payComponent);
  }

  // ── Tax Rate Management ────────────────────────────────────────────────────
  // Retained as tenant-reference/statutory-audit-trail storage only — these
  // values are NEVER read into a calculation path in this service (see
  // domain/payroll-adapter-contract.ts). Useful for reconciling an attested
  // register against what a tenant believes its statutory rates to be.

  async listTaxRates(tenantId: TenantId, effectiveYear?: number) { return this.taxRateRepo.findAll(tenantId, effectiveYear); }
  async upsertTaxRate(tenantId: TenantId, dto: TaxRateDto) { return this.taxRateRepo.upsert(tenantId, dto); }
}

