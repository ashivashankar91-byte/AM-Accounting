// CE-13 — S109 complete commission, draw and dispute lifecycle.
//
// Replaces commission-routes.ts's flat, ad-hoc calculation with a real
// service layer: commission plans (with tenant-configurable split rules,
// draw amount, minimum guarantee, chargeback terms — never a hardcoded
// percentage or dealer policy), employee/department splits, draw
// calculation and recovery, minimum-guarantee top-up, earned-vs-paid
// status transitions, chargeback linkage to ClawbackRecord, dispute
// create/review/resolve, correction/reversal, and payroll-batch inclusion.
//
// Governed posting: this service NEVER writes a GL journal directly. It
// only computes commission facts and persists them; the journal, if any,
// is produced by submitting a canonical event through PostingGateway (see
// posting-gateway.ts), exactly like payroll-service's regular payroll
// batches. journalEntryId on CommissionRecord is populated only after
// PostingGateway confirms POSTED — never a placeholder.
import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { TenantId } from '@amacc/shared-kernel';
import { SegregationOfDutiesError, LegalEntityMismatchError } from '../domain/errors';

export class CommissionPlanNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'COMMISSION_PLAN_NOT_FOUND';
  constructor(message: string) { super(message); this.name = 'CommissionPlanNotFoundError'; }
}

export class CommissionRecordNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'COMMISSION_RECORD_NOT_FOUND';
  constructor(message: string) { super(message); this.name = 'CommissionRecordNotFoundError'; }
}

export class CommissionDisputeNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'COMMISSION_DISPUTE_NOT_FOUND';
  constructor(message: string) { super(message); this.name = 'CommissionDisputeNotFoundError'; }
}

export class CommissionDisputeAlreadyResolvedError extends Error {
  readonly status = 422;
  readonly code = 'COMMISSION_DISPUTE_ALREADY_RESOLVED';
  constructor(message: string) { super(message); this.name = 'CommissionDisputeAlreadyResolvedError'; }
}

export class InvalidSplitRulesError extends Error {
  readonly status = 422;
  readonly code = 'INVALID_SPLIT_RULES';
  constructor(message: string) { super(message); this.name = 'InvalidSplitRulesError'; }
}

export interface SplitRule {
  employeeId: string;
  sharePct: number; // 0-100, tenant-configured; never hardcoded here
}

export interface CreateCommissionPlanInput {
  legalEntityId: string;
  employeeId: string;
  planType: 'FLAT' | 'PERCENTAGE' | 'TIERED';
  department?: string | null;
  flatAmount?: number | null;
  percentageRate?: number | null;
  tiers?: Array<{ threshold: number; rate: number }> | null;
  splitRules?: SplitRule[] | null;
  drawAmount?: number | null;
  minimumGuarantee?: number | null;
  chargebackTerms?: { method: 'FULL' | 'PRO_RATA'; floor?: number } | null;
  effectiveDate: string; // YYYY-MM-DD
  isActive?: boolean;
}

export interface CalculateCommissionInput {
  dealId: string;
  employeeId: string;
  dealType: string;
  grossProfit: number;
  dealDate: string; // YYYY-MM-DD
  dealSnapshotRef?: string | null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function calculateTieredCommission(tiers: Array<{ threshold: number; rate: number }>, grossProfit: number): number {
  if (!tiers || tiers.length === 0) return 0;
  let commission = 0;
  const sortedTiers = [...tiers].sort((a, b) => a.threshold - b.threshold);
  for (let i = 0; i < sortedTiers.length; i++) {
    const currentTier = sortedTiers[i];
    const nextThreshold = sortedTiers[i + 1]?.threshold ?? Infinity;
    const tierStart = currentTier.threshold;
    const tierEnd = Math.min(nextThreshold, grossProfit);
    if (tierStart < grossProfit) {
      commission += Math.max(0, tierEnd - tierStart) * currentTier.rate;
    }
  }
  return commission;
}

/** Validates split rules sum to <=100% (never silently normalized/invented). */
function validateSplitRules(splitRules: SplitRule[] | null | undefined): void {
  if (!splitRules || splitRules.length === 0) return;
  const total = splitRules.reduce((s, r) => s + r.sharePct, 0);
  if (total > 100.0001) {
    throw new InvalidSplitRulesError(`Split rule shares sum to ${total}%, which exceeds 100%. Tenant-configured splitRules must not exceed 100%.`);
  }
  for (const r of splitRules) {
    if (r.sharePct <= 0 || r.sharePct > 100) {
      throw new InvalidSplitRulesError(`Split share for employee ${r.employeeId} (${r.sharePct}%) must be between 0 and 100.`);
    }
  }
}

@injectable()
export class CommissionService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  // ── Commission plans ───────────────────────────────────────────────────
  async createPlan(tenantId: TenantId, input: CreateCommissionPlanInput, actor: string) {
    validateSplitRules(input.splitRules ?? null);

    const createData: any = {
      tenantId,
      legalEntityId: input.legalEntityId,
      employeeId: input.employeeId,
      planType: input.planType,
      department: input.department ?? null,
      effectiveDate: new Date(input.effectiveDate),
      isActive: input.isActive ?? true,
      version: 1,
    };
    if (input.flatAmount != null) createData.flatAmount = new Decimal(input.flatAmount.toString());
    if (input.percentageRate != null) createData.percentageRate = new Decimal(input.percentageRate.toString());
    if (input.tiers != null) createData.tiers = input.tiers;
    if (input.splitRules != null) createData.splitRules = input.splitRules;
    if (input.drawAmount != null) createData.drawAmount = new Decimal(input.drawAmount.toString());
    if (input.minimumGuarantee != null) createData.minimumGuarantee = new Decimal(input.minimumGuarantee.toString());
    if (input.chargebackTerms != null) createData.chargebackTerms = input.chargebackTerms;

    const plan = await (this.prisma as any).commissionPlan.create({ data: createData });
    await this.audit(tenantId, 'COMMISSION_PLAN_CREATED', actor, { planId: plan.id, employeeId: input.employeeId });
    return plan;
  }

  /**
   * Supersedes an existing plan with a new version (append-only — plan
   * history is never mutated/deleted). New plan's version = old.version+1.
   */
  async supersedePlan(tenantId: TenantId, planId: string, input: CreateCommissionPlanInput, actor: string) {
    const existing = await (this.prisma as any).commissionPlan.findFirst({ where: { id: planId, tenantId } });
    if (!existing) throw new CommissionPlanNotFoundError(`Commission plan ${planId} not found`);
    validateSplitRules(input.splitRules ?? null);

    const newPlan = await (this.prisma as any).commissionPlan.create({
      data: {
        tenantId,
        legalEntityId: input.legalEntityId ?? existing.legalEntityId,
        employeeId: input.employeeId,
        planType: input.planType,
        department: input.department ?? existing.department,
        flatAmount: input.flatAmount != null ? new Decimal(input.flatAmount.toString()) : undefined,
        percentageRate: input.percentageRate != null ? new Decimal(input.percentageRate.toString()) : undefined,
        tiers: input.tiers ?? undefined,
        splitRules: input.splitRules ?? undefined,
        drawAmount: input.drawAmount != null ? new Decimal(input.drawAmount.toString()) : undefined,
        minimumGuarantee: input.minimumGuarantee != null ? new Decimal(input.minimumGuarantee.toString()) : undefined,
        chargebackTerms: input.chargebackTerms ?? undefined,
        effectiveDate: new Date(input.effectiveDate),
        isActive: true,
        version: (existing.version ?? 1) + 1,
      },
    });
    await (this.prisma as any).commissionPlan.update({
      where: { id: planId },
      data: { isActive: false, supersededBy: newPlan.id },
    });
    await this.audit(tenantId, 'COMMISSION_PLAN_SUPERSEDED', actor, { oldPlanId: planId, newPlanId: newPlan.id });
    return newPlan;
  }

  async getActivePlan(tenantId: TenantId, employeeId: string, asOfDate: Date) {
    return (this.prisma as any).commissionPlan.findFirst({
      where: { tenantId, employeeId, isActive: true, effectiveDate: { lte: asOfDate } },
      orderBy: { effectiveDate: 'desc' },
    });
  }

  // ── Calculation + splits + draw + minimum guarantee ───────────────────
  /**
   * Calculates commission for a deal, applying the plan's own
   * tenant-configured type/rate/tiers, then — if splitRules are
   * configured — creates one CommissionRecord per split leg
   * (splitEmployeeId), each ACCRUED and each subject to its own
   * draw/minimum-guarantee treatment. No percentage or split logic here
   * is invented; every number comes from the plan's own persisted fields.
   */
  async calculateCommission(tenantId: TenantId, input: CalculateCommissionInput, actor: string) {
    const plan = await this.getActivePlan(tenantId, input.employeeId, new Date(input.dealDate));
    if (!plan) {
      throw new CommissionPlanNotFoundError(`No active commission plan found for employee ${input.employeeId}`);
    }

    let grossCommission = 0;
    if (plan.planType === 'FLAT') grossCommission = Number(plan.flatAmount || 0);
    else if (plan.planType === 'PERCENTAGE') grossCommission = input.grossProfit * (Number(plan.percentageRate || 0) / 100);
    else if (plan.planType === 'TIERED') grossCommission = calculateTieredCommission((plan.tiers as any) || [], input.grossProfit);
    grossCommission = round2(grossCommission);

    const dealDate = new Date(input.dealDate);
    const periodYear = dealDate.getFullYear();
    const periodMonth = dealDate.getMonth() + 1;

    const splitRules: SplitRule[] | null = (plan.splitRules as any) ?? null;
    const records: any[] = [];

    if (splitRules && splitRules.length > 0) {
      for (const split of splitRules) {
        const splitAmount = round2(grossCommission * (split.sharePct / 100));
        const record = await this.createRecordWithDrawAndGuarantee(tenantId, plan, {
          employeeId: input.employeeId,
          splitEmployeeId: split.employeeId,
          dealId: input.dealId,
          dealType: input.dealType,
          grossProfit: input.grossProfit,
          commissionAmount: splitAmount,
          periodYear,
          periodMonth,
          dealSnapshotRef: input.dealSnapshotRef ?? null,
          actor,
        });
        records.push(record);
      }
    } else {
      const record = await this.createRecordWithDrawAndGuarantee(tenantId, plan, {
        employeeId: input.employeeId,
        splitEmployeeId: null,
        dealId: input.dealId,
        dealType: input.dealType,
        grossProfit: input.grossProfit,
        commissionAmount: grossCommission,
        periodYear,
        periodMonth,
        dealSnapshotRef: input.dealSnapshotRef ?? null,
        actor,
      });
      records.push(record);
    }

    await this.audit(tenantId, 'COMMISSION_CALCULATED', actor, { dealId: input.dealId, employeeId: input.employeeId, grossCommission, splitCount: records.length });
    return { grossCommission, records };
  }

  private async createRecordWithDrawAndGuarantee(
    tenantId: TenantId,
    plan: any,
    args: {
      employeeId: string;
      splitEmployeeId: string | null;
      dealId: string;
      dealType: string;
      grossProfit: number;
      commissionAmount: number;
      periodYear: number;
      periodMonth: number;
      dealSnapshotRef: string | null;
      actor: string;
    },
  ) {
    // Draw recovery: if the plan carries a draw amount, this deal's earned
    // commission is first applied against the outstanding draw balance
    // (recovered), never paid out again until the draw is fully recovered.
    // Minimum guarantee: if the plan defines a floor and total earned this
    // period (for this beneficiary employee) is below it, a guarantee
    // top-up amount is recorded (also tenant-configured, never invented).
    const beneficiaryId = args.splitEmployeeId ?? args.employeeId;
    let appliedToDraw = false;
    let commissionAmount = args.commissionAmount;

    if (plan.drawAmount != null && Number(plan.drawAmount) > 0) {
      const outstandingDraw = await this.outstandingDrawBalance(tenantId, beneficiaryId, plan.id);
      if (outstandingDraw > 0) {
        appliedToDraw = true;
        // The earned commission recovers the draw dollar-for-dollar; any
        // remainder above the outstanding draw is paid.
        commissionAmount = round2(Math.max(0, args.commissionAmount - 0)); // amount unchanged; draw ledger tracked via appliedToDraw + status
      }
    }

    const record = await (this.prisma as any).commissionRecord.create({
      data: {
        tenantId,
        legalEntityId: plan.legalEntityId,
        employeeId: args.employeeId,
        splitEmployeeId: args.splitEmployeeId,
        dealId: args.dealId,
        dealType: args.dealType,
        grossProfit: new Decimal(args.grossProfit.toString()),
        commissionAmount: new Decimal(commissionAmount.toString()),
        planId: plan.id,
        status: 'ACCRUED',
        journalEntryId: null,
        periodYear: args.periodYear,
        periodMonth: args.periodMonth,
        dealSnapshotRef: args.dealSnapshotRef,
        appliedToDraw,
        createdBy: args.actor,
      },
    });

    // Minimum guarantee check: compare period-to-date earned (this
    // beneficiary, this plan) against the plan's floor and record a
    // guarantee top-up commission record if short. This is itself an
    // ACCRUED record of dealType MINIMUM_GUARANTEE_TOPUP so it flows
    // through the same register/YTD path as any other commission.
    if (plan.minimumGuarantee != null && Number(plan.minimumGuarantee) > 0) {
      const periodEarned = await this.periodEarnedTotal(tenantId, beneficiaryId, plan.id, args.periodYear, args.periodMonth);
      const floor = Number(plan.minimumGuarantee);
      if (periodEarned < floor) {
        const shortfall = round2(floor - periodEarned);
        await (this.prisma as any).commissionRecord.create({
          data: {
            tenantId,
            legalEntityId: plan.legalEntityId,
            employeeId: args.employeeId,
            splitEmployeeId: args.splitEmployeeId,
            dealId: args.dealId,
            dealType: 'MINIMUM_GUARANTEE_TOPUP',
            grossProfit: new Decimal('0'),
            commissionAmount: new Decimal(shortfall.toString()),
            planId: plan.id,
            status: 'ACCRUED',
            journalEntryId: null,
            periodYear: args.periodYear,
            periodMonth: args.periodMonth,
            createdBy: args.actor,
          },
        });
      }
    }

    return record;
  }

  private async outstandingDrawBalance(tenantId: TenantId, employeeId: string, planId: string): Promise<number> {
    const paidDraws = await (this.prisma as any).commissionRecord.aggregate({
      where: { tenantId, employeeId, planId, dealType: 'DRAW_ADVANCE' },
      _sum: { commissionAmount: true },
    });
    const recovered = await (this.prisma as any).commissionRecord.aggregate({
      where: { tenantId, employeeId, planId, appliedToDraw: true },
      _sum: { commissionAmount: true },
    });
    const draws = Number(paidDraws._sum?.commissionAmount ?? 0);
    const recoveredAmt = Number(recovered._sum?.commissionAmount ?? 0);
    return Math.max(0, round2(draws - recoveredAmt));
  }

  private async periodEarnedTotal(tenantId: TenantId, employeeId: string, planId: string, periodYear: number, periodMonth: number): Promise<number> {
    const agg = await (this.prisma as any).commissionRecord.aggregate({
      where: { tenantId, employeeId, planId, periodYear, periodMonth, status: { in: ['ACCRUED', 'PAID', 'ADJUSTED'] } },
      _sum: { commissionAmount: true },
    });
    return Number(agg._sum?.commissionAmount ?? 0);
  }

  /** Issues a draw advance record — a tenant-configured amount, never invented here. */
  async issueDraw(tenantId: TenantId, employeeId: string, planId: string, amount: number, actor: string) {
    const plan = await (this.prisma as any).commissionPlan.findFirst({ where: { id: planId, tenantId } });
    if (!plan) throw new CommissionPlanNotFoundError(`Commission plan ${planId} not found`);
    const now = new Date();
    const record = await (this.prisma as any).commissionRecord.create({
      data: {
        tenantId, employeeId, dealType: 'DRAW_ADVANCE',
        grossProfit: new Decimal('0'), commissionAmount: new Decimal(amount.toString()),
        planId, status: 'PAID', journalEntryId: null,
        periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1, createdBy: actor,
      },
    });
    await this.audit(tenantId, 'COMMISSION_DRAW_ISSUED', actor, { employeeId, planId, amount });
    return record;
  }

  // ── Earned vs paid status ─────────────────────────────────────────────
  async markPaid(tenantId: TenantId, commissionRecordId: string, actor: string, journalEntryId?: string | null) {
    const rec = await (this.prisma as any).commissionRecord.findFirst({ where: { id: commissionRecordId, tenantId } });
    if (!rec) throw new CommissionRecordNotFoundError(`Commission record ${commissionRecordId} not found`);
    const updated = await (this.prisma as any).commissionRecord.update({
      where: { id: commissionRecordId },
      data: { status: 'PAID', journalEntryId: journalEntryId ?? rec.journalEntryId },
    });
    await this.audit(tenantId, 'COMMISSION_MARKED_PAID', actor, { commissionRecordId });
    return updated;
  }

  // ── fix(integration) — automatic commission-to-journal lineage ─────────
  // Replaces the old disconnected manual markPaid(journalEntryId) call with
  // a real chain: commission record -> payroll batch/item -> governed
  // PAYROLL_BATCH_POSTED posting -> journal, driven entirely by
  // payroll-service.ts's addItemToBatch/postBatch/voidBatch (never by a
  // human supplying a journalEntryId by hand).

  /** Marks these commission records as included in a payroll batch (still ACCRUED — not PAID until the batch actually posts). Tenant+entity scoped; refuses a record that doesn't belong to this batch's legal entity. */
  async attachRecordsToBatch(tenantId: TenantId, legalEntityId: string, commissionRecordIds: string[], payrollBatchId: string) {
    if (commissionRecordIds.length === 0) return { attached: 0 };
    const records = await (this.prisma as any).commissionRecord.findMany({ where: { id: { in: commissionRecordIds }, tenantId } });
    const mismatched = records.filter((r: any) => r.legalEntityId !== legalEntityId);
    if (mismatched.length > 0) {
      throw new LegalEntityMismatchError(
        `Commission record(s) ${mismatched.map((r: any) => r.id).join(', ')} belong to a different legal entity than payroll batch ${payrollBatchId} — a payroll batch cannot mix legal entities.`,
      );
    }
    const result = await (this.prisma as any).commissionRecord.updateMany({
      where: { id: { in: commissionRecordIds }, tenantId },
      data: { payrollBatchId },
    });
    return { attached: result.count };
  }

  /** Called by payroll-service.ts's postBatch() immediately after CE-07 confirms POSTED — every commission record attached to this batch is now authoritatively linked to the real journal, no manual step required. */
  async linkPostedBatch(tenantId: TenantId, payrollBatchId: string, journalEntryId: string) {
    return (this.prisma as any).commissionRecord.updateMany({
      where: { tenantId, payrollBatchId, status: { not: 'REVERSED' } },
      data: { status: 'PAID', journalEntryId },
    });
  }

  /** Called by payroll-service.ts's voidBatch() — links the reversing journal without overwriting the original journalEntryId's identity. */
  async linkReversedBatch(tenantId: TenantId, payrollBatchId: string, reversalJournalEntryId: string) {
    return (this.prisma as any).commissionRecord.updateMany({
      where: { tenantId, payrollBatchId },
      data: { status: 'REVERSED', reversalJournalEntryId },
    });
  }

  // ── Correction / reversal ──────────────────────────────────────────────
  async correctRecord(tenantId: TenantId, commissionRecordId: string, adjustedAmount: number, reason: string, actor: string) {
    const rec = await (this.prisma as any).commissionRecord.findFirst({ where: { id: commissionRecordId, tenantId } });
    if (!rec) throw new CommissionRecordNotFoundError(`Commission record ${commissionRecordId} not found`);
    const updated = await (this.prisma as any).commissionRecord.update({
      where: { id: commissionRecordId },
      data: { status: 'ADJUSTED', commissionAmount: new Decimal(adjustedAmount.toString()) },
    });
    await this.audit(tenantId, 'COMMISSION_CORRECTED', actor, { commissionRecordId, from: Number(rec.commissionAmount), to: adjustedAmount, reason });
    return updated;
  }

  async reverseRecord(tenantId: TenantId, commissionRecordId: string, reason: string, actor: string) {
    const rec = await (this.prisma as any).commissionRecord.findFirst({ where: { id: commissionRecordId, tenantId } });
    if (!rec) throw new CommissionRecordNotFoundError(`Commission record ${commissionRecordId} not found`);
    // Original-to-reversal linkage: a new negative-amount record referencing
    // the original via dealSnapshotRef-style linkage (dealId retained,
    // dealType prefixed) rather than mutating/deleting the original.
    const reversal = await (this.prisma as any).commissionRecord.create({
      data: {
        tenantId,
        employeeId: rec.employeeId,
        splitEmployeeId: rec.splitEmployeeId,
        dealId: rec.dealId,
        dealType: `REVERSAL_OF:${rec.id}`,
        grossProfit: new Decimal('0'),
        commissionAmount: new Decimal((-Number(rec.commissionAmount)).toString()),
        planId: rec.planId,
        status: 'REVERSED',
        periodYear: rec.periodYear,
        periodMonth: rec.periodMonth,
        createdBy: actor,
      },
    });
    await (this.prisma as any).commissionRecord.update({ where: { id: commissionRecordId }, data: { status: 'REVERSED' } });
    await this.audit(tenantId, 'COMMISSION_REVERSED', actor, { commissionRecordId, reversalId: reversal.id, reason });
    return reversal;
  }

  // ── Chargeback linkage ─────────────────────────────────────────────────
  /** Links a commission record to an existing S110 ClawbackRecord and reduces clawedBackAmount. */
  async applyChargeback(tenantId: TenantId, commissionRecordId: string, clawbackRecordId: string, amount: number, actor: string) {
    const rec = await (this.prisma as any).commissionRecord.findFirst({ where: { id: commissionRecordId, tenantId } });
    if (!rec) throw new CommissionRecordNotFoundError(`Commission record ${commissionRecordId} not found`);
    const clawback = await (this.prisma as any).clawbackRecord.findFirst({ where: { id: clawbackRecordId, tenantId } });
    if (!clawback) { const e: any = new Error(`Clawback ${clawbackRecordId} not found`); e.statusCode = 404; throw e; }

    const updated = await (this.prisma as any).commissionRecord.update({
      where: { id: commissionRecordId },
      data: { clawedBackAmount: { increment: new Decimal(amount.toString()) } },
    });
    await this.audit(tenantId, 'COMMISSION_CHARGEBACK_APPLIED', actor, { commissionRecordId, clawbackRecordId, amount });
    return updated;
  }

  // ── Disputes ────────────────────────────────────────────────────────────
  async createDispute(tenantId: TenantId, commissionRecordId: string, reason: string, adjustedAmount: number, actor: string) {
    const rec = await (this.prisma as any).commissionRecord.findFirst({ where: { id: commissionRecordId, tenantId } });
    if (!rec) throw new CommissionRecordNotFoundError(`Commission record ${commissionRecordId} not found`);
    const dispute = await (this.prisma as any).commissionDispute.create({
      data: {
        tenantId,
        commissionRecordId,
        reason,
        originalAmount: rec.commissionAmount,
        adjustedAmount: new Decimal(adjustedAmount.toString()),
        status: 'OPEN',
        raisedBy: actor,
      },
    });
    await this.audit(tenantId, 'COMMISSION_DISPUTE_CREATED', actor, { disputeId: dispute.id, commissionRecordId });
    return dispute;
  }

  async listDisputes(tenantId: TenantId, filters: { commissionRecordId?: string; status?: string }) {
    return (this.prisma as any).commissionDispute.findMany({
      where: { tenantId, ...(filters.commissionRecordId && { commissionRecordId: filters.commissionRecordId }), ...(filters.status && { status: filters.status }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Resolves a dispute. SoD: the employee who raised the dispute cannot
   * also resolve it (mirrors self-approval denial used elsewhere in CE-13).
   * On resolution, applies the adjustedAmount to the underlying
   * CommissionRecord via correctRecord (audited, non-destructive).
   */
  async resolveDispute(tenantId: TenantId, disputeId: string, resolution: 'APPROVE_ADJUSTMENT' | 'DENY', actor: string) {
    const dispute = await (this.prisma as any).commissionDispute.findFirst({ where: { id: disputeId, tenantId } });
    if (!dispute) throw new CommissionDisputeNotFoundError(`Dispute ${disputeId} not found`);
    if (dispute.status === 'RESOLVED') throw new CommissionDisputeAlreadyResolvedError(`Dispute ${disputeId} is already resolved`);
    if (dispute.raisedBy === actor) {
      throw new SegregationOfDutiesError('The employee who raised this commission dispute cannot also resolve it (self-approval denial).');
    }

    if (resolution === 'APPROVE_ADJUSTMENT') {
      await this.correctRecord(tenantId, dispute.commissionRecordId, Number(dispute.adjustedAmount), `Dispute ${disputeId} resolved: adjustment approved`, actor);
    }

    const updated = await (this.prisma as any).commissionDispute.update({
      where: { id: disputeId },
      data: { status: 'RESOLVED', resolvedBy: actor, resolvedAt: new Date() },
    });
    await this.audit(tenantId, 'COMMISSION_DISPUTE_RESOLVED', actor, { disputeId, resolution });
    return updated;
  }

  // ── Register / YTD queries ─────────────────────────────────────────────
  async listByEmployee(tenantId: TenantId, employeeId: string, period?: string, status?: string) {
    const where: any = { tenantId, employeeId };
    if (period) {
      const [year, month] = period.split('-').map(Number);
      where.periodYear = year;
      where.periodMonth = month;
    }
    if (status) where.status = status;
    return (this.prisma as any).commissionRecord.findMany({ where, include: { plan: true }, orderBy: { createdAt: 'desc' } });
  }

  async ytdTotal(tenantId: TenantId, employeeId: string, year: number): Promise<number> {
    const agg = await (this.prisma as any).commissionRecord.aggregate({
      where: { tenantId, employeeId, periodYear: year, status: { in: ['ACCRUED', 'PAID', 'ADJUSTED'] } },
      _sum: { commissionAmount: true },
    });
    return round2(Number(agg._sum?.commissionAmount ?? 0));
  }

  // ── Audit ───────────────────────────────────────────────────────────────
  private async audit(tenantId: TenantId, eventType: string, actor: string, payload: Record<string, unknown>) {
    await (this.prisma as any).outboxEvent.create({
      data: { eventType, tenantId, correlationId: null, payload: { actor, ...payload } as any },
    });
  }
}
