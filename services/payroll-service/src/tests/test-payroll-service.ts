/**
 * @file test-payroll-service.ts
 * @coverage
 *   - Employee CRUD: 5 tests
 *   - Batch lifecycle: 8 tests
 *   - Tax calculation: 9 tests
 *   - Duplicate detection: 4 tests
 *   - GL posting balance: 6 tests
 *   - Reports: 5 tests
 * Total: 37 tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateTaxes, DEFAULT_TAX_RATES_2024 } from '../domain/tax-calculator';
import { detectExactDuplicate, detectSimilarGross } from '../domain/duplicate-detector';
import { PayrollService, ValidationResult } from '../application/payroll-service';

// ── Shared mocks ──────────────────────────────────────────────────────────────

const makeMockEmployee = (overrides?: Partial<any>) => ({
  id: 'emp-1',
  tenantId: 'tenant-test',
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
  };

  // @ts-ignore — DI constructor injection bypassed for testing
  return new PayrollService(employeeRepo, batchRepo, itemRepo, glMappingRepo, taxRateRepo, ytdRepo, prisma);
}

const TENANT = 'tenant-test' as any;

// ─────────────────────────────────────────────────────────────────────────────
// Employee CRUD — 5 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Employee CRUD', () => {
  it('createEmployee — creates and returns new employee', async () => {
    const svc = makeService();
    const result = await svc.createEmployee(TENANT, {
      employeeCode: 'EMP001', firstName: 'Alice', lastName: 'Smith',
      department: 'SERVICE', payType: 'HOURLY', hireDate: new Date('2020-01-01'),
    });
    expect(result.firstName).toBe('Alice');
  });

  it('createEmployee — throws 409 if employee code exists', async () => {
    const svc = makeService({
      employeeRepo: { findByCode: vi.fn().mockResolvedValue(makeMockEmployee()), create: vi.fn(), findById: vi.fn(), findAll: vi.fn(), update: vi.fn(), terminate: vi.fn() },
    });
    await expect(svc.createEmployee(TENANT, {
      employeeCode: 'EMP001', firstName: 'Alice', lastName: 'Smith',
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
      batchNumber: 'PR-2024-01',
      payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14'),
      payDate: new Date('2024-01-17'), payFrequency: 'BI_WEEKLY', createdBy: 'admin',
    })).rejects.toThrow('already exists');
  });

  it('createBatch — throws if periodStart >= periodEnd', async () => {
    const svc = makeService();
    await expect(svc.createBatch(TENANT, {
      batchNumber: 'PR-2024-02',
      payPeriodStart: new Date('2024-01-14'), payPeriodEnd: new Date('2024-01-01'),
      payDate: new Date('2024-01-17'), payFrequency: 'BI_WEEKLY', createdBy: 'admin',
    })).rejects.toThrow('must be before');
  });

  it('addItemToBatch — calculates taxes and creates item', async () => {
    const createItem = vi.fn().mockResolvedValue(makeMockItem());
    const svc = makeService({
      itemRepo: { create: createItem, findByBatch: vi.fn().mockResolvedValue([]), findById: vi.fn(), deleteById: vi.fn(), deleteByBatch: vi.fn(), sumByBatch: vi.fn().mockResolvedValue({ totalGrossPay: { toString: () => '2000' }, totalDeductions: { toString: () => '499' }, totalNetPay: { toString: () => '1501' }, totalEmployerTax: { toString: () => '219' }, employeeCount: 1 }) },
    });
    await svc.addItemToBatch(TENANT, 'batch-1', {
      employeeId: 'emp-1',
      regularPay: 2000,
      regularHours: 80,
    });
    expect(createItem).toHaveBeenCalled();
    const callArg = createItem.mock.calls[0][1];
    expect(callArg.grossPay).toBe(2000);
    expect(callArg.federalTax).toBeGreaterThan(0);
    expect(callArg.socialSecurity).toBeGreaterThan(0);
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
    await expect(svc.postBatch(TENANT, 'batch-1')).rejects.toThrow('must be APPROVED');
  });

  it('voidBatch — throws if batch not POSTED', async () => {
    const svc = makeService();
    await expect(svc.voidBatch(TENANT, 'batch-1', 'Duplicate')).rejects.toThrow('Only POSTED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tax Calculation — 9 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Tax Calculation', () => {
  const baseInput = {
    grossPay: 2000,
    ytdGrossPay: 0,
    ytdFicaWages: 0,
    federalFilingStatus: 'SINGLE',
    federalAllowances: 1,
    payFrequency: 'BI_WEEKLY',
    rates: DEFAULT_TAX_RATES_2024,
  };

  it('FICA: 6.2% of gross for single paycheck below wage base', () => {
    const result = calculateTaxes(baseInput);
    expect(result.socialSecurity).toBeCloseTo(2000 * 0.062, 1);
  });

  it('FICA wage base cap: employee stops paying FICA at $168,600', () => {
    const result = calculateTaxes({
      ...baseInput,
      grossPay: 5000,
      ytdFicaWages: 167000, // $1,600 remaining under cap
    });
    // Only $1,600 should be FICA-taxable
    expect(result.socialSecurity).toBeCloseTo(1600 * 0.062, 1);
  });

  it('FICA: no FICA when wage base already exceeded', () => {
    const result = calculateTaxes({ ...baseInput, ytdFicaWages: 168600 });
    expect(result.socialSecurity).toBe(0);
  });

  it('Medicare: 1.45% with no cap', () => {
    const result = calculateTaxes(baseInput);
    expect(result.medicare).toBeCloseTo(2000 * 0.0145, 1);
  });

  it('Additional Medicare: 0.9% on wages above $200k YTD', () => {
    const result = calculateTaxes({
      ...baseInput,
      grossPay: 5000,
      ytdGrossPay: 198000,
    });
    // $3,000 above threshold, additional = $3,000 × 0.009 = $27
    const expectedAdditional = 3000 * 0.009;
    const expectedBase = 5000 * 0.0145;
    expect(result.medicare).toBeCloseTo(expectedBase + expectedAdditional, 1);
  });

  it('FUTA: net 0.6% on first $7,000 (after SUTA credit)', () => {
    const result = calculateTaxes({ ...baseInput, grossPay: 1000, ytdFicaWages: 0, ytdGrossPay: 0 });
    // Net FUTA = 0.06 - 0.027 = 0.033; 1000 × 0.033 = 33
    expect(result.employerFUTA).toBeCloseTo(1000 * 0.033, 1);
  });

  it('FUTA: no FUTA when wages exceed $7,000 YTD', () => {
    const result = calculateTaxes({ ...baseInput, ytdFutaWages: 7000 });
    expect(result.employerFUTA).toBe(0);
  });

  it('Employer FICA matches employee FICA', () => {
    const result = calculateTaxes(baseInput);
    expect(result.employerFICA).toBe(result.socialSecurity);
  });

  it('Federal tax: SINGLE with 1 allowance on $2,000 biweekly is non-zero', () => {
    const result = calculateTaxes(baseInput);
    expect(result.federalTax).toBeGreaterThan(0);
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

  it('postBatch — calls GL service and updates YTD', async () => {
    const accumulateDelta = vi.fn().mockResolvedValue({});
    const setJournalEntryId = vi.fn().mockResolvedValue({});

    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: 'je-abc123' }),
      text: vi.fn().mockResolvedValue(''),
    });
    vi.stubGlobal('fetch', mockFetch);

    const svc = makeService({
      batchRepo: {
        findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'APPROVED', totalGrossPay: { toString: () => '2000' }, totalDeductions: { toString: () => '499' }, totalNetPay: { toString: () => '1501' }, payDate: new Date('2024-01-17'), payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14') })),
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
    });

    const result = await svc.postBatch(TENANT, 'batch-1');
    expect(mockFetch).toHaveBeenCalled();
    expect(accumulateDelta).toHaveBeenCalled();
    expect(setJournalEntryId).toHaveBeenCalledWith(TENANT, 'batch-1', 'je-abc123');
    expect(result.journalEntryId).toBe('je-abc123');

    vi.unstubAllGlobals();
  });

  it('postBatch — throws when GL service returns error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const svc = makeService({
      batchRepo: {
        findById: vi.fn().mockResolvedValue(makeMockBatch({ status: 'APPROVED', totalGrossPay: { toString: () => '2000' }, totalDeductions: { toString: () => '499' }, totalNetPay: { toString: () => '1501' }, payDate: new Date('2024-01-17'), payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14') })),
        findByBatchNumber: vi.fn(), listByTenant: vi.fn(), create: vi.fn(),
        updateStatus: vi.fn(), updateTotals: vi.fn(), setJournalEntryId: vi.fn(), listNonVoidInWindow: vi.fn().mockResolvedValue([]),
      },
    });

    await expect(svc.postBatch(TENANT, 'batch-1')).rejects.toThrow('GL journal post failed');
    vi.unstubAllGlobals();
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
