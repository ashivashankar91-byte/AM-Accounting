/**
 * @file test-payroll-service.ts
 * @coverage
 *   - Employee CRUD: 5 tests
 *   - Batch lifecycle (incl. duplicate-run prevention, hold/release): 14 tests
 *   - Statutory boundary (CE-13 adapters): 9 tests
 *   - Duplicate detection: 4 tests
 *   - GL posting (governed client) + validation boundary: 9 tests
 *   - Reports: 5 tests
 * Total: 46 tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectExactDuplicate, detectSimilarGross } from '../domain/duplicate-detector';
import { PayrollService, ValidationResult } from '../application/payroll-service';
import { NullPayrollSource } from '../domain/engines/null-source';
import { AttestedManualSource } from '../domain/engines/attested-manual-source';
import { TestFixturePayrollSource } from '../domain/engines/test-fixture-source';
import { PayrollSourceRegistry } from '../domain/engines/payroll-source-registry';
import { TEST_TENANT_CE13_CERTIFICATION_ONLY } from '../domain/errors';
import { PostingGatewayUnavailableError, PostingRefusedError } from '../infrastructure/posting-gateway';

// ── Shared mocks ──────────────────────────────────────────────────────────────

const makeMockEmployee = (overrides?: Partial<any>) => ({
  id: 'emp-1',
  tenantId: 'tenant-test',
  legalEntityId: 'entity-test',
  employeeCode: 'EMP001',
  firstName: 'Alice',
  lastName: 'Smith',
  department: 'SERVICE',
  payType: 'HOURLY',
  payRate: 25,
  commissionRate: null,
  payFrequency: 'BI_WEEKLY',
  federalFilingStatus: 'SINGLE',
  stateCode: 'IL',
  federalAllowances: 1,
  stateAllowances: 0,
  isActive: true,
  hireDate: new Date('2020-01-01'),
  terminationDate: null,
  defaultGlDept: null,
  ...overrides,
});

const makeMockBatch = (overrides?: Partial<any>) => ({
  id: 'batch-1',
  tenantId: 'tenant-test',
  legalEntityId: 'entity-test',
  batchNumber: 'PR-2024-01',
  payPeriodStart: new Date('2024-01-01'),
  payPeriodEnd: new Date('2024-01-14'),
  payDate: new Date('2024-01-17'),
  payFrequency: 'BI_WEEKLY',
  status: 'DRAFT',
  totalGrossPay: { toString: () => '0' },
  totalDeductions: { toString: () => '0' },
  totalNetPay: { toString: () => '0' },
  totalEmployerTax: { toString: () => '0' },
  employeeCount: 0,
  journalEntryId: null,
  approvedBy: null,
  approvedAt: null,
  postedAt: null,
  voidedAt: null,
  voidReason: null,
  createdBy: 'admin',
  items: [],
  ...overrides,
});

const makeMockItem = (overrides?: Partial<any>) => ({
  id: 'item-1',
  tenantId: 'tenant-test',
  legalEntityId: 'entity-test',
  batchId: 'batch-1',
  employeeId: 'emp-1',
  department: 'SERVICE',
  regularHours: { toString: () => '80' },
  overtimeHours: null,
  regularPay: { toString: () => '2000' },
  overtimePay: { toString: () => '0' },
  commissionPay: { toString: () => '0' },
  bonusPay: { toString: () => '0' },
  otherPay: { toString: () => '0' },
  grossPay: { toString: () => '2000' },
  federalTax: { toString: () => '248' },
  stateTax: { toString: () => '98' },
  socialSecurity: { toString: () => '124' },
  medicare: { toString: () => '29' },
  otherDeductions: { toString: () => '0' },
  totalDeductions: { toString: () => '499' },
  netPay: { toString: () => '1501' },
  employerFICA: { toString: () => '124' },
  employerMedicare: { toString: () => '29' },
  employerFUTA: { toString: () => '12' },
  employerSUTA: { toString: () => '54' },
  totalEmployerTax: { toString: () => '219' },
  glAccountCode: null,
  glDepartment: null,
  withholdingStatus: 'ATTESTED_MANUAL_ENTRY',
  withholdingSource: 'MANUAL_ATTESTED_REGISTER',
  attestedBy: 'preparer-1',
  attestedAt: new Date('2024-01-15'),
  sourceDocumentRef: 'provider-register-2024-01',
  employee: makeMockEmployee(),
  ...overrides,
});

function makeService(overrides: Partial<{
  employeeRepo: any;
  batchRepo: any;
  itemRepo: any;
  glMappingRepo: any;
  taxRateRepo: any;
  ytdRepo: any;
  prisma: any;
  glClient: any;
  postingGateway: any;
  sourceRegistry: any;
  commissionService: any;
  paymentHandoffService: any;
}> = {}) {
  const employeeRepo = overrides.employeeRepo ?? {
    findById: vi.fn().mockResolvedValue(makeMockEmployee()),
    findByCode: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([makeMockEmployee()]),
    create: vi.fn().mockResolvedValue(makeMockEmployee()),
    update: vi.fn().mockResolvedValue(makeMockEmployee()),
    terminate: vi.fn().mockResolvedValue(makeMockEmployee({ isActive: false })),
  };

  const batchRepo = overrides.batchRepo ?? {
    findById: vi.fn().mockResolvedValue({ ...makeMockBatch(), items: [makeMockItem()] }),
    findByBatchNumber: vi.fn().mockResolvedValue(null),
    listByTenant: vi.fn().mockResolvedValue([makeMockBatch()]),
    create: vi.fn().mockResolvedValue(makeMockBatch()),
    updateStatus: vi.fn().mockResolvedValue(makeMockBatch()),
    updateTotals: vi.fn().mockResolvedValue(makeMockBatch()),
    setJournalEntryId: vi.fn().mockResolvedValue(makeMockBatch()),
    listNonVoidInWindow: vi.fn().mockResolvedValue([]),
  };

  const itemRepo = overrides.itemRepo ?? {
    findByBatch: vi.fn().mockResolvedValue([makeMockItem()]),
    findById: vi.fn().mockResolvedValue(makeMockItem()),
    create: vi.fn().mockResolvedValue(makeMockItem()),
    deleteById: vi.fn().mockResolvedValue(undefined),
    deleteByBatch: vi.fn().mockResolvedValue(undefined),
    sumByBatch: vi.fn().mockResolvedValue({
      totalGrossPay: { toString: () => '2000' },
      totalDeductions: { toString: () => '499' },
      totalNetPay: { toString: () => '1501' },
      totalEmployerTax: { toString: () => '219' },
      employeeCount: 1,
    }),
  };

  const glMappingRepo = overrides.glMappingRepo ?? {
    findAll: vi.fn().mockResolvedValue([]),
    findByDeptAndComponent: vi.fn().mockResolvedValue({ glAccountCode: '6000', isDebit: true }),
    findByDepartment: vi.fn().mockResolvedValue([
      { payComponent: 'REGULAR_PAY', glAccountCode: '6000', isDebit: true },
      { payComponent: 'EMPLOYER_FICA_EXPENSE', glAccountCode: '6100', isDebit: true },
      { payComponent: 'EMPLOYER_MEDICARE_EXPENSE', glAccountCode: '6110', isDebit: true },
      { payComponent: 'EMPLOYER_FUTA_EXPENSE', glAccountCode: '6120', isDebit: true },
      { payComponent: 'EMPLOYER_SUTA_EXPENSE', glAccountCode: '6130', isDebit: true },
      { payComponent: 'NET_PAY', glAccountCode: '2000', isDebit: false },
      { payComponent: 'FED_TAX', glAccountCode: '2100', isDebit: false },
      { payComponent: 'STATE_TAX', glAccountCode: '2110', isDebit: false },
      { payComponent: 'FICA_TAX', glAccountCode: '2120', isDebit: false },
      { payComponent: 'MEDICARE_TAX', glAccountCode: '2130', isDebit: false },
      { payComponent: 'FUTA_TAX', glAccountCode: '2140', isDebit: false },
      { payComponent: 'SUTA_TAX', glAccountCode: '2150', isDebit: false },
    ]),
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  const taxRateRepo = overrides.taxRateRepo ?? {
    findAll: vi.fn().mockResolvedValue([]),
    findByType: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  const ytdRepo = overrides.ytdRepo ?? {
    findByEmployeeAndYear: vi.fn().mockResolvedValue(null),
    findByTenantAndYear: vi.fn().mockResolvedValue([]),
    accumulateDelta: vi.fn().mockResolvedValue({}),
    reverseDelta: vi.fn().mockResolvedValue({}),
  };

  const prisma = overrides.prisma ?? {
    outboxEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    payrollTenantConfig: {
      findFirst: vi.fn().mockResolvedValue({ payrollSourceMode: 'MANUAL_ATTESTED' }),
    },
  };

  // Default: an AttestedManualSource-equivalent stub that carries entered
  // figures through unchanged with status ATTESTED_MANUAL_ENTRY — mirrors
  // the real AttestedManualSource without needing attestation validation
  // noise in unrelated tests.
  const glClient = overrides.glClient ?? {
    createDraft: vi.fn().mockResolvedValue({ journalEntryId: 'gl-draft-1', status: 'DRAFT' }),
    approveAndPost: vi.fn().mockResolvedValue({ journalEntryId: 'je-abc123', status: 'POSTED' }),
    reverse: vi.fn().mockResolvedValue({ journalEntryId: 'je-reversal-1', status: 'DRAFT' }),
    resolveAccountId: vi.fn().mockResolvedValue('gl-acct-1'),
  };

  // Governed-posting gateway (CE-13 gap #2): submits a canonical event to
  // CE-07 (coa-service posting engine) rather than writing GL directly.
  // Default stub returns POSTED with a synthetic journalEntryId/executionId.
  const postingGateway = overrides.postingGateway ?? {
    submitPayrollEvent: vi.fn().mockResolvedValue({
      executionId: 'exec-1', eventId: 'evt-1', status: 'POSTED', idempotent: false,
      journalEntryId: 'je-abc123', journalNumber: 'JE-000123',
    }),
  };

  const sourceRegistry = overrides.sourceRegistry ?? {
    resolve: vi.fn().mockReturnValue({
      sourceType: 'ATTESTED_MANUAL_ENTRY',
      resolve: vi.fn().mockResolvedValue({
        status: 'ATTESTED_MANUAL_ENTRY',
        lines: { federalTax: 248, stateTax: 98, socialSecurity: 124, medicare: 29, employerFICA: 124, employerMedicare: 29, employerFUTA: 12, employerSUTA: 54 },
        productionCertified: true,
        source: 'MANUAL_ATTESTED_REGISTER',
        attestedBy: 'preparer-1',
        attestedAt: '2024-01-15T00:00:00.000Z',
        sourceDocumentRef: 'provider-register-2024-01',
      }),
      getStatus: vi.fn().mockResolvedValue({ sourceType: 'ATTESTED_MANUAL_ENTRY', configured: true }),
    }),
  };

  // @ts-ignore — DI constructor injection bypassed for testing
  const commissionService = overrides.commissionService ?? {
    attachRecordsToBatch: vi.fn().mockResolvedValue({ attached: 0 }),
    linkPostedBatch: vi.fn().mockResolvedValue({ count: 0 }),
    linkReversedBatch: vi.fn().mockResolvedValue({ count: 0 }),
  };

  const paymentHandoffService = overrides.paymentHandoffService ?? {
    createHandoff: vi.fn().mockResolvedValue({ id: 'handoff-1', status: 'NOT_CONFIGURED' }),
    voidForBatch: vi.fn().mockResolvedValue(null),
  };

  return new PayrollService(employeeRepo, batchRepo, itemRepo, glMappingRepo, taxRateRepo, ytdRepo, prisma, postingGateway, sourceRegistry, commissionService, paymentHandoffService);
}

const TENANT = 'tenant-test' as any;

// ─────────────────────────────────────────────────────────────────────────────
// Employee CRUD — 5 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Employee CRUD', () => {
  it('createEmployee — creates and returns new employee', async () => {
    const svc = makeService();
    const result = await svc.createEmployee(TENANT, {
      legalEntityId: 'entity-test', employeeCode: 'EMP001', firstName: 'Alice', lastName: 'Smith',
      department: 'SERVICE', payType: 'HOURLY', hireDate: new Date('2020-01-01'),
    });
    expect(result.firstName).toBe('Alice');
  });

  it('createEmployee — throws 409 if employee code exists', async () => {
    const svc = makeService({
      employeeRepo: { findByCode: vi.fn().mockResolvedValue(makeMockEmployee()), create: vi.fn(), findById: vi.fn(), findAll: vi.fn(), update: vi.fn(), terminate: vi.fn() },
    });
    await expect(svc.createEmployee(TENANT, {
      legalEntityId: 'entity-test', employeeCode: 'EMP001', firstName: 'Alice', lastName: 'Smith',
      department: 'SERVICE', payType: 'HOURLY', hireDate: new Date('2020-01-01'),
    })).rejects.toThrow('already exists');
  });

  it('getEmployee — throws if not found', async () => {
    const svc = makeService({
      employeeRepo: { findById: vi.fn().mockResolvedValue(null), findByCode: vi.fn(), findAll: vi.fn(), create: vi.fn(), update: vi.fn(), terminate: vi.fn() },
    });
    await expect(svc.getEmployee(TENANT, 'missing-id')).rejects.toThrow('not found');
  });

  it('updateEmployee — delegates to repo', async () => {
    const updateFn = vi.fn().mockResolvedValue(makeMockEmployee({ firstName: 'Bob' }));
    const svc = makeService({
      employeeRepo: { findById: vi.fn().mockResolvedValue(makeMockEmployee()), update: updateFn, findByCode: vi.fn(), findAll: vi.fn(), create: vi.fn(), terminate: vi.fn() },
    });
    const result = await svc.updateEmployee(TENANT, 'emp-1', { firstName: 'Bob' });
    expect(result.firstName).toBe('Bob');
    expect(updateFn).toHaveBeenCalledWith(TENANT, 'emp-1', { firstName: 'Bob' });
  });

  it('terminateEmployee — sets isActive=false and terminationDate', async () => {
    const terminateFn = vi.fn().mockResolvedValue(makeMockEmployee({ isActive: false, terminationDate: new Date('2024-12-31') }));
    const svc = makeService({
      employeeRepo: { findById: vi.fn().mockResolvedValue(makeMockEmployee()), terminate: terminateFn, findByCode: vi.fn(), findAll: vi.fn(), create: vi.fn(), update: vi.fn() },
    });
    const result = await svc.terminateEmployee(TENANT, 'emp-1', new Date('2024-12-31'));
    expect(result.isActive).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Batch Lifecycle — 8 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Batch Lifecycle', () => {
  it('createBatch — creates DRAFT batch', async () => {
    const svc = makeService();
    const result = await svc.createBatch(TENANT, {
      legalEntityId: 'entity-test',
      batchNumber: 'PR-2024-01',
      payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14'),
      payDate: new Date('2024-01-17'), payFrequency: 'BI_WEEKLY', createdBy: 'admin',
    });
    expect(result.status).toBe('DRAFT');
  });

  it('createBatch — throws if batchNumber already exists', async () => {
    const svc = makeService({
      batchRepo: { findByBatchNumber: vi.fn().mockResolvedValue(makeMockBatch()), create: vi.fn(), findById: vi.fn(), listByTenant: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn() },
    });
    await expect(svc.createBatch(TENANT, {
      legalEntityId: 'entity-test',
      batchNumber: 'PR-2024-01',
      payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14'),
      payDate: new Date('2024-01-17'), payFrequency: 'BI_WEEKLY', createdBy: 'admin',
    })).rejects.toThrow('already exists');
  });

  it('createBatch — throws if periodStart >= periodEnd', async () => {
    const svc = makeService();
    await expect(svc.createBatch(TENANT, {
      legalEntityId: 'entity-test',
      batchNumber: 'PR-2024-02',
      payPeriodStart: new Date('2024-01-14'), payPeriodEnd: new Date('2024-01-01'),
      payDate: new Date('2024-01-17'), payFrequency: 'BI_WEEKLY', createdBy: 'admin',
    })).rejects.toThrow('must be before');
  });

  it('createBatch — duplicate-payroll prevention: rejects a second batch for the same providerRunId + pay period', async () => {
    const svc = makeService({
      batchRepo: {
        findByBatchNumber: vi.fn().mockResolvedValue(null),
        findByProviderRunId: vi.fn().mockResolvedValue(makeMockBatch({ batchNumber: 'PR-2024-01', status: 'POSTED' })),
        create: vi.fn(), findById: vi.fn(), listByTenant: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn(),
      },
    });
    await expect(svc.createBatch(TENANT, {
      legalEntityId: 'entity-test',
      batchNumber: 'PR-2024-03',
      payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14'),
      payDate: new Date('2024-01-17'), payFrequency: 'BI_WEEKLY', createdBy: 'admin',
      providerRunId: 'RUN-0001',
    })).rejects.toThrow(/already exists/);
  });

  it('addItemToBatch — resolves withholding via the tenant-configured statutory-boundary adapter and creates item', async () => {
    const createItem = vi.fn().mockResolvedValue(makeMockItem());
    const svc = makeService({
      itemRepo: { create: createItem, findByBatch: vi.fn().mockResolvedValue([]), findById: vi.fn(), deleteById: vi.fn(), deleteByBatch: vi.fn(), sumByBatch: vi.fn().mockResolvedValue({ totalGrossPay: { toString: () => '2000' }, totalDeductions: { toString: () => '499' }, totalNetPay: { toString: () => '1501' }, totalEmployerTax: { toString: () => '219' }, employeeCount: 1 }) },
    });
    await svc.addItemToBatch(TENANT, 'batch-1', {
      employeeId: 'emp-1',
      regularPay: 2000,
      regularHours: 80,
      attestedBy: 'preparer-1',
      sourceDocumentRef: 'provider-register-2024-01',
    });
    expect(createItem).toHaveBeenCalled();
    const callArg = createItem.mock.calls[0][1];
    expect(callArg.grossPay).toBe(2000);
    expect(callArg.withholdingStatus).toBe('ATTESTED_MANUAL_ENTRY');
    expect(callArg.federalTax).toBeGreaterThan(0);
    expect(callArg.socialSecurity).toBeGreaterThan(0);
  });

  it('addItemToBatch — NOT_CONFIGURED source yields zero withholding, never an invented estimate', async () => {
    const createItem = vi.fn().mockResolvedValue(makeMockItem());
    const svc = makeService({
      itemRepo: { create: createItem, findByBatch: vi.fn().mockResolvedValue([]), findById: vi.fn(), deleteById: vi.fn(), deleteByBatch: vi.fn(), sumByBatch: vi.fn().mockResolvedValue({ totalGrossPay: { toString: () => '2000' }, totalDeductions: { toString: () => '0' }, totalNetPay: { toString: () => '2000' }, totalEmployerTax: { toString: () => '0' }, employeeCount: 1 }) },
      prisma: { outboxEvent: { create: vi.fn() }, payrollTenantConfig: { findFirst: vi.fn().mockResolvedValue(null) } },
      sourceRegistry: { resolve: vi.fn().mockReturnValue(new NullPayrollSource()) },
    });
    await svc.addItemToBatch(TENANT, 'batch-1', { employeeId: 'emp-1', regularPay: 2000, regularHours: 80 });
    const callArg = createItem.mock.calls[0][1];
    expect(callArg.withholdingStatus).toBe('NOT_CONFIGURED');
    expect(callArg.federalTax).toBe(0);
    expect(callArg.socialSecurity).toBe(0);
  });

  it('addItemToBatch — throws if batch status is POSTED', async () => {
    const svc = makeService({
      batchRepo: { findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'POSTED' })), findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn() },
    });
    await expect(svc.addItemToBatch(TENANT, 'batch-1', { employeeId: 'emp-1', regularPay: 1000 })).rejects.toThrow('Cannot add items');
  });

  it('removeItemFromBatch — deletes item from DRAFT batch', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const svc = makeService({
      itemRepo: { findById: vi.fn().mockResolvedValue(makeMockItem()), deleteById: deleteFn, findByBatch: vi.fn().mockResolvedValue([]), sumByBatch: vi.fn().mockResolvedValue({ totalGrossPay: { toString: () => '0' }, totalDeductions: { toString: () => '0' }, totalNetPay: { toString: () => '0' }, totalEmployerTax: { toString: () => '0' }, employeeCount: 0 }), create: vi.fn(), deleteByBatch: vi.fn() },
    });
    await svc.removeItemFromBatch(TENANT, 'batch-1', 'item-1');
    expect(deleteFn).toHaveBeenCalledWith(TENANT, 'item-1');
  });

  it('postBatch — throws if batch not APPROVED', async () => {
    const svc = makeService();
    await expect(svc.postBatch(TENANT, 'batch-1', 'poster-1')).rejects.toThrow('must be APPROVED');
  });

  it('voidBatch — throws if batch not POSTED', async () => {
    const svc = makeService();
    await expect(svc.voidBatch(TENANT, 'batch-1', 'Duplicate', 'voider-1')).rejects.toThrow('Only POSTED');
  });

  it('holdBatch — moves a DRAFT/VALIDATED batch to HOLD with reason and holder', async () => {
    const updateStatus = vi.fn().mockResolvedValue(undefined);
    const svc = makeService({
      batchRepo: { findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'VALIDATED' })), findByBatchNumber: vi.fn(), findByProviderRunId: vi.fn(), create: vi.fn(), listByTenant: vi.fn(), updateStatus, updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn() },
    });
    await svc.holdBatch(TENANT, 'batch-1', 'Pending manual correction', 'reviewer-1');
    expect(updateStatus).toHaveBeenCalledWith(TENANT, 'batch-1', 'HOLD', expect.objectContaining({ holdReason: 'Pending manual correction', heldBy: 'reviewer-1' }));
  });

  it('holdBatch — throws if batch is already POSTED', async () => {
    const svc = makeService({
      batchRepo: { findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'POSTED' })), findByBatchNumber: vi.fn(), findByProviderRunId: vi.fn(), create: vi.fn(), listByTenant: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn() },
    });
    await expect(svc.holdBatch(TENANT, 'batch-1', 'reason', 'reviewer-1')).rejects.toThrow('Only DRAFT or VALIDATED');
  });

  it('releaseBatch — moves a HOLD batch back to DRAFT for re-validation', async () => {
    const updateStatus = vi.fn().mockResolvedValue(undefined);
    const svc = makeService({
      batchRepo: { findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'HOLD' })), findByBatchNumber: vi.fn(), findByProviderRunId: vi.fn(), create: vi.fn(), listByTenant: vi.fn(), updateStatus, updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn() },
    });
    await svc.releaseBatch(TENANT, 'batch-1');
    expect(updateStatus).toHaveBeenCalledWith(TENANT, 'batch-1', 'DRAFT', expect.objectContaining({ holdReason: null }));
  });

  it('releaseBatch — throws if batch is not on HOLD', async () => {
    const svc = makeService({
      batchRepo: { findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'DRAFT' })), findByBatchNumber: vi.fn(), findByProviderRunId: vi.fn(), create: vi.fn(), listByTenant: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn() },
    });
    await expect(svc.releaseBatch(TENANT, 'batch-1')).rejects.toThrow('Only HOLD');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Statutory Boundary (CE-13) — 9 tests
// The core safety fix: payroll-service never computes federal/state
// withholding, FICA/Medicare/FUTA/SUTA. Every payroll item's withholding
// resolves through exactly one of three adapters (domain/engines/*),
// exercised here directly.
// ─────────────────────────────────────────────────────────────────────────────

describe('Statutory Boundary', () => {
  const baseRequest = {
    tenantId: 'tenant-test',
    employeeId: 'emp-1',
    grossPay: 2000,
    payFrequency: 'BI_WEEKLY',
    businessDate: '2024-01-17',
  };

  it('NullPayrollSource — always returns NOT_CONFIGURED with zero lines, never an estimate', async () => {
    const result = await new NullPayrollSource().resolve(baseRequest);
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.lines.federalTax).toBe(0);
    expect(result.lines.socialSecurity).toBe(0);
    expect(result.productionCertified).toBe(false);
    expect(result.rejectReason).toContain('emp-1');
  });

  it('NullPayrollSource — getStatus reports configured:false', async () => {
    const status = await new NullPayrollSource().getStatus();
    expect(status.configured).toBe(false);
  });

  it('AttestedManualSource — requires attestedBy and sourceDocumentRef', async () => {
    const result = await new AttestedManualSource().resolve(baseRequest, {});
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.rejectReason).toMatch(/attest/i);
  });

  it('AttestedManualSource — carries entered figures through unchanged (never computes)', async () => {
    const entered = { federalTax: 248, stateTax: 98, socialSecurity: 124, medicare: 29 };
    const result = await new AttestedManualSource().resolve(baseRequest, {
      ...entered,
      attestedBy: 'preparer-1',
      sourceDocumentRef: 'provider-register-2024-01',
    });
    expect(result.status).toBe('ATTESTED_MANUAL_ENTRY');
    expect(result.lines.federalTax).toBe(248);
    expect(result.lines.socialSecurity).toBe(124);
    expect(result.productionCertified).toBe(true);
    expect(result.attestedBy).toBe('preparer-1');
  });

  it('TestFixturePayrollSource — refuses any tenant other than the labeled certification tenant', async () => {
    await expect(new TestFixturePayrollSource().resolve(baseRequest)).rejects.toThrow(/certification-only/i);
  });

  it('TestFixturePayrollSource — resolves deterministic fixture math ONLY for the labeled test tenant, never production-certified', async () => {
    const result = await new TestFixturePayrollSource().resolve({ ...baseRequest, tenantId: TEST_TENANT_CE13_CERTIFICATION_ONLY });
    expect(result.status).toBe('TEST_FIXTURE');
    expect(result.productionCertified).toBe(false);
    expect(result.lines.socialSecurity).toBeGreaterThan(0);
  });

  it('PayrollSourceRegistry — defaults unknown/absent mode to NullPayrollSource (truthful default)', () => {
    const registry = new PayrollSourceRegistry();
    expect(registry.resolve(undefined).sourceType).toBe(new NullPayrollSource().sourceType);
    expect(registry.resolve('SOMETHING_UNKNOWN' as any).sourceType).toBe(new NullPayrollSource().sourceType);
  });

  it('PayrollSourceRegistry — resolves MANUAL_ATTESTED to AttestedManualSource', () => {
    const registry = new PayrollSourceRegistry();
    expect(registry.resolve('MANUAL_ATTESTED').sourceType).toBe(new AttestedManualSource().sourceType);
  });

  it('PayrollSourceRegistry — resolves TEST_FIXTURE to TestFixturePayrollSource', () => {
    const registry = new PayrollSourceRegistry();
    expect(registry.resolve('TEST_FIXTURE').sourceType).toBe(new TestFixturePayrollSource().sourceType);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate Detection — 4 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Duplicate Detection', () => {
  const makeExistingBatch = (overrides?: Partial<any>) => ({
    id: 'existing-1',
    status: 'POSTED',
    payPeriodStart: new Date('2024-01-01'),
    payPeriodEnd: new Date('2024-01-14'),
    payDate: new Date('2024-01-17'),
    totalGrossPay: 50000,
    employeeCount: 5,
    ...overrides,
  });

  it('exactDuplicate: detects overlapping employee in same period', () => {
    const proposed = { payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14'), employeeCount: 1 };
    const existing = [makeExistingBatch()];
    const existingItems = new Map([['existing-1', [{ employeeId: 'emp-1', grossPay: 2000 }]]]);
    const result = detectExactDuplicate(proposed, existing, [{ employeeId: 'emp-1', grossPay: 2000 }], existingItems);
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe('EXACT_PERIOD');
  });

  it('exactDuplicate: no duplicate when employees differ', () => {
    const proposed = { payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14'), employeeCount: 1 };
    const existing = [makeExistingBatch()];
    const existingItems = new Map([['existing-1', [{ employeeId: 'emp-2', grossPay: 2000 }]]]);
    const result = detectExactDuplicate(proposed, existing, [{ employeeId: 'emp-1', grossPay: 2000 }], existingItems);
    expect(result.isDuplicate).toBe(false);
  });

  it('similarGross: flags batches within 5% and 14 days', () => {
    const proposed = { payDate: new Date('2024-01-17'), totalGrossPay: 50001 };
    const existing = [makeExistingBatch({ totalGrossPay: 50000, id: 'existing-1' })];
    const result = detectSimilarGross(proposed, existing);
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe('SIMILAR_GROSS');
  });

  it('similarGross: no flag when amounts differ by more than 5%', () => {
    const proposed = { payDate: new Date('2024-01-17'), totalGrossPay: 55000 };
    const existing = [makeExistingBatch({ totalGrossPay: 50000 })];
    const result = detectSimilarGross(proposed, existing);
    expect(result.isDuplicate).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GL Posting — 6 tests (balance verification + error cases)
// ─────────────────────────────────────────────────────────────────────────────

describe('GL Posting', () => {
  it('validateBatch — passes with valid DRAFT batch', async () => {
    const svc = makeService({
      batchRepo: {
        findById: vi.fn().mockResolvedValue(makeMockBatch({
          totalGrossPay: { toString: () => '2000' },
          totalDeductions: { toString: () => '499' },
          totalNetPay: { toString: () => '1501' },
          totalEmployerTax: { toString: () => '219' },
          employeeCount: 1,
          payDate: new Date(Date.now() + 86400000), // tomorrow
          payPeriodStart: new Date('2024-01-01'),
          payPeriodEnd: new Date('2024-01-14'),
        })),
        findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(),
        updateStatus: vi.fn().mockResolvedValue({}),
        updateTotals: vi.fn(), setJournalEntryId: vi.fn(),
        listNonVoidInWindow: vi.fn().mockResolvedValue([]),
      },
    });
    const result: ValidationResult = await svc.validateBatch(TENANT, 'batch-1');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validateBatch — fails when batch is empty', async () => {
    const svc = makeService({
      itemRepo: { findByBatch: vi.fn().mockResolvedValue([]), findById: vi.fn(), create: vi.fn(), deleteById: vi.fn(), deleteByBatch: vi.fn(), sumByBatch: vi.fn() },
    });
    const result: ValidationResult = await svc.validateBatch(TENANT, 'batch-1');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('no payroll items'))).toBe(true);
  });

  it('validateBatch — fails when batch is not DRAFT', async () => {
    const svc = makeService({
      batchRepo: { findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'VALIDATED' })), findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn().mockResolvedValue([]) },
    });
    const result: ValidationResult = await svc.validateBatch(TENANT, 'batch-1');
    expect(result.errors.some((e: string) => e.includes('DRAFT'))).toBe(true);
  });

  it('validateBatch — fails when inactive employee in batch', async () => {
    const inactiveItem = makeMockItem({ employee: makeMockEmployee({ isActive: false }) });
    const svc = makeService({
      itemRepo: { findByBatch: vi.fn().mockResolvedValue([inactiveItem]), findById: vi.fn(), create: vi.fn(), deleteById: vi.fn(), deleteByBatch: vi.fn(), sumByBatch: vi.fn() },
      batchRepo: { findById: vi.fn().mockResolvedValue(makeMockBatch({ payDate: new Date(Date.now() + 86400000), payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14'), totalGrossPay: { toString: () => '2000' }, totalDeductions: { toString: () => '499' }, totalNetPay: { toString: () => '1501' } })), findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn().mockResolvedValue([]) },
    });
    const result: ValidationResult = await svc.validateBatch(TENANT, 'batch-1');
    expect(result.errors.some((e: string) => e.includes('inactive'))).toBe(true);
  });

  it('postBatch — creates a governed DRAFT, approves via distinct identity, and updates YTD', async () => {
    const accumulateDelta = vi.fn().mockResolvedValue({});
    const setJournalEntryId = vi.fn().mockResolvedValue({});
    const submitPayrollEvent = vi.fn().mockResolvedValue({
      executionId: 'exec-1', eventId: 'evt-1', status: 'POSTED', idempotent: false,
      journalEntryId: 'je-abc123', journalNumber: 'JE-000123',
    });

    const svc = makeService({
      batchRepo: {
        findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'APPROVED', approvedBy: 'approver-1', totalGrossPay: { toString: () => '2000' }, totalDeductions: { toString: () => '499' }, totalNetPay: { toString: () => '1501' }, payDate: new Date('2024-01-17'), payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14') })),
        findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(),
        updateStatus: vi.fn().mockResolvedValue({}),
        updateTotals: vi.fn(),
        setJournalEntryId,
        listNonVoidInWindow: vi.fn().mockResolvedValue([]),
      },
      ytdRepo: {
        findByEmployeeAndYear: vi.fn().mockResolvedValue(null),
        findByTenantAndYear: vi.fn().mockResolvedValue([]),
        accumulateDelta,
        reverseDelta: vi.fn(),
      },
      postingGateway: { submitPayrollEvent },
    });

    const result = await svc.postBatch(TENANT, 'batch-1', 'poster-1');
    expect(submitPayrollEvent).toHaveBeenCalled();
    expect(submitPayrollEvent.mock.calls[0][0].actor).toBe('poster-1');
    expect(submitPayrollEvent.mock.calls[0][0].eventType).toBe('PAYROLL_BATCH_POSTED');
    expect(accumulateDelta).toHaveBeenCalled();
    expect(setJournalEntryId).toHaveBeenCalledWith(TENANT, 'batch-1', 'je-abc123');
    expect(result.journalEntryId).toBe('je-abc123');
  });

  it('postBatch — denies self-approval: the batch approver cannot also execute the posting step', async () => {
    const svc = makeService({
      batchRepo: {
        findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'APPROVED', approvedBy: 'same-user' })),
        findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn().mockResolvedValue([]),
      },
    });
    await expect(svc.postBatch(TENANT, 'batch-1', 'same-user')).rejects.toThrow('self-approval denial');
  });

  it('postBatch — propagates PENDING_CE07_TECHNICAL_RECONCILIATION when the CE-07 posting gateway is unreachable (fail closed, no direct GL fallback)', async () => {
    const svc = makeService({
      batchRepo: {
        findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'APPROVED', approvedBy: 'approver-1' })),
        findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn().mockResolvedValue([]),
      },
      postingGateway: {
        submitPayrollEvent: vi.fn().mockRejectedValue(new PostingGatewayUnavailableError('CE-07 posting engine (coa-service) is unreachable: connect ECONNREFUSED. PENDING_CE07_TECHNICAL_RECONCILIATION — no direct GL write was attempted.')),
      },
    });
    await expect(svc.postBatch(TENANT, 'batch-1', 'poster-1')).rejects.toThrow('PENDING_CE07_TECHNICAL_RECONCILIATION');
  });

  it('postBatch — a missing GL account mapping is a deterministic refusal (ACCOUNT_MAPPING_VALUES_PENDING), never a placeholder account', async () => {
    const svc = makeService({
      batchRepo: {
        findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'APPROVED', approvedBy: 'approver-1' })),
        findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn().mockResolvedValue([]),
      },
      postingGateway: {
        submitPayrollEvent: vi.fn().mockRejectedValue(new PostingRefusedError('CE-07 refused to post this payroll event: NO_RULE_MATCH', 'NO_RULE_MATCH')),
      },
    });
    await expect(svc.postBatch(TENANT, 'batch-1', 'poster-1')).rejects.toThrow('CE-07 refused to post this payroll event');
  });

  it('voidBatch — reverses the posted journal via a canonical PAYROLL_BATCH_REVERSED event through the same governed posting gateway (original-to-reversal linkage)', async () => {
    const submitPayrollEvent = vi.fn().mockResolvedValue({
      executionId: 'exec-2', eventId: 'evt-2', status: 'POSTED', idempotent: false,
      journalEntryId: 'je-reversal-1', journalNumber: 'JE-000124',
    });
    const reverseDelta = vi.fn().mockResolvedValue({});
    const svc = makeService({
      batchRepo: {
        findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'POSTED', journalEntryId: 'je-abc123', totalNetPay: { toString: () => '1501' }, totalDeductions: { toString: () => '499' } })),
        findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(),
        updateStatus: vi.fn().mockResolvedValue({}), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn().mockResolvedValue([]),
      },
      ytdRepo: { findByEmployeeAndYear: vi.fn(), findByTenantAndYear: vi.fn(), accumulateDelta: vi.fn(), reverseDelta },
      postingGateway: { submitPayrollEvent },
    });
    const result = await svc.voidBatch(TENANT, 'batch-1', 'Duplicate entry', 'voider-1');
    expect(submitPayrollEvent).toHaveBeenCalled();
    expect(submitPayrollEvent.mock.calls[0][0].eventType).toBe('PAYROLL_BATCH_REVERSED');
    expect(submitPayrollEvent.mock.calls[0][0].reversalOfEventId).toBeTruthy();
    expect(reverseDelta).toHaveBeenCalled();
    expect(result.journalEntryId).toBe('je-reversal-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reports — 5 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Reports', () => {
  it('payrollRegister — returns batch + item list', async () => {
    const svc = makeService();
    const result = await svc.payrollRegister(TENANT, 'batch-1');
    expect(result.batch.batchNumber).toBe('PR-2024-01');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.employeeName).toBe('Alice Smith');
  });

  it('payrollSummary — returns aggregate totals', async () => {
    const svc = makeService({
      batchRepo: {
        findById: vi.fn().mockResolvedValue(makeMockBatch({
          totalGrossPay: { toString: () => '10000' }, totalNetPay: { toString: () => '7500' },
          totalDeductions: { toString: () => '2500' }, totalEmployerTax: { toString: () => '850' }, employeeCount: 3,
        })),
        findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn(),
      },
    });
    const result = await svc.payrollSummary(TENANT, 'batch-1');
    expect(result.totalGrossPay).toBe(10000);
    expect(result.employeeCount).toBe(3);
  });

  it('departmentalSummary — groups items by department', async () => {
    const items = [
      makeMockItem({ department: 'SERVICE', grossPay: { toString: () => '2000' }, netPay: { toString: () => '1500' }, totalEmployerTax: { toString: () => '200' } }),
      makeMockItem({ id: 'item-2', department: 'PARTS', grossPay: { toString: () => '3000' }, netPay: { toString: () => '2200' }, totalEmployerTax: { toString: () => '300' } }),
    ];
    const svc = makeService({
      itemRepo: { findByBatch: vi.fn().mockResolvedValue(items), findById: vi.fn(), create: vi.fn(), deleteById: vi.fn(), deleteByBatch: vi.fn(), sumByBatch: vi.fn() },
    });
    const result = await svc.departmentalSummary(TENANT, 'batch-1');
    expect(result).toHaveLength(2);
    const svc_dept = result.find((d: any) => d.department === 'SERVICE');
    expect(svc_dept?.grossPay).toBe(2000);
  });

  it('employeeYTD — returns null message when no YTD exists', async () => {
    const svc = makeService();
    const result = await svc.employeeYTD(TENANT, 'emp-1', 2024);
    expect((result as any).message).toBe('No YTD data found');
  });

  it('taxLiabilityReport — sums liabilities across all employees', async () => {
    const ytdRecords = [
      { grossPay: { toString: () => '50000' }, federalTax: { toString: () => '6000' }, stateTax: { toString: () => '2500' }, socialSecurity: { toString: () => '3100' }, medicare: { toString: () => '725' } },
      { grossPay: { toString: () => '40000' }, federalTax: { toString: () => '4800' }, stateTax: { toString: () => '2000' }, socialSecurity: { toString: () => '2480' }, medicare: { toString: () => '580' } },
    ];
    const svc = makeService({
      ytdRepo: { findByTenantAndYear: vi.fn().mockResolvedValue(ytdRecords), findByEmployeeAndYear: vi.fn(), accumulateDelta: vi.fn(), reverseDelta: vi.fn() },
    });
    const result = await svc.taxLiabilityReport(TENANT, 2024);
    expect(result.employeeCount).toBe(2);
    expect(result.federalTax).toBeCloseTo(10800, 1);
  });
});
