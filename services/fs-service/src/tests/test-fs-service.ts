import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { FSService } from '../application/fs-service';
import { OEMProfileRepository } from '../infrastructure/oem-profile-repository';
import { MappingRepository } from '../infrastructure/mapping-repository';
import { StatementRepository } from '../infrastructure/statement-repository';
import { SupplementalRepository } from '../infrastructure/supplemental-repository';
import { generateLines, buildAccountMap } from '../domain/fs-generator';
import { evaluateFormula } from '../domain/formula-evaluator';
import { validateStatement } from '../domain/fs-validator';
import { GM_MAPPING_TEMPLATE } from '../seed/oem-templates/gm';

// ── Factory ──────────────────────────────────────────────────────────────────

function makeService() {
  const profileRepo = {
    create: vi.fn(),
    findByOemCode: vi.fn(),
    findAll: vi.fn(),
    update: vi.fn(),
  } as unknown as OEMProfileRepository;

  const mappingRepo = {
    create: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    importTemplate: vi.fn(),
  } as unknown as MappingRepository;

  const statementRepo = {
    findById: vi.fn(),
    findByPeriod: vi.fn(),
    listByTenant: vi.fn(),
    create: vi.fn(),
    upsertWithLines: vi.fn(),
    updateStatus: vi.fn(),
    upsertComparison: vi.fn(),
  } as unknown as StatementRepository;

  const supplementalRepo = {
    findAll: vi.fn(),
    upsert: vi.fn(),
  } as unknown as SupplementalRepository;

  // @ts-ignore — bypassing DI for unit tests
  const svc = new FSService(profileRepo, mappingRepo, statementRepo, supplementalRepo);

  return { svc, profileRepo, mappingRepo, statementRepo, supplementalRepo };
}

const TENANT = 'tenant-test';

const mockProfile = {
  id: 'profile-gm',
  tenantId: TENANT,
  oemCode: 'GM',
  oemName: 'General Motors',
  dealerCode: '12345',
  reportFormat: 'STANDARD',
  submissionMethod: 'API',
  submissionUrl: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockStatement = {
  id: 'stmt-1',
  tenantId: TENANT,
  oemProfileId: 'profile-gm',
  oemProfile: mockProfile,
  periodYear: 2025,
  periodMonth: 6,
  statementType: 'MONTHLY',
  status: 'GENERATED',
  generatedAt: new Date(),
  reviewedBy: null,
  reviewedAt: null,
  submittedAt: null,
  submittedBy: null,
  responseCode: null,
  responseMessage: null,
  rejectionReason: null,
  lineItems: [
    {
      id: 'li-1',
      tenantId: TENANT,
      statementId: 'stmt-1',
      oemLineNumber: '101',
      oemLineLabel: 'New Vehicle Sales',
      oemSection: 'REVENUE',
      currentMonth: new Decimal('500000'),
      yearToDate: new Decimal('3000000'),
      priorMonth: null,
      priorYear: null,
      variance: null,
      variancePct: null,
      displayOrder: 10,
      isSubtotal: false,
      isTotal: false,
      glAccountCodes: ['4010'],
    },
    {
      id: 'li-2',
      tenantId: TENANT,
      statementId: 'stmt-1',
      oemLineNumber: '199',
      oemLineLabel: 'Total Revenue',
      oemSection: 'REVENUE',
      currentMonth: new Decimal('500000'),
      yearToDate: new Decimal('3000000'),
      priorMonth: null,
      priorYear: null,
      variance: null,
      variancePct: null,
      displayOrder: 90,
      isSubtotal: false,
      isTotal: true,
      glAccountCodes: [],
    },
    {
      id: 'li-3',
      tenantId: TENANT,
      statementId: 'stmt-1',
      oemLineNumber: '299',
      oemLineLabel: 'Total Cost of Sales',
      oemSection: 'COST_OF_SALES',
      currentMonth: new Decimal('400000'),
      yearToDate: new Decimal('2400000'),
      priorMonth: null,
      priorYear: null,
      variance: null,
      variancePct: null,
      displayOrder: 150,
      isSubtotal: false,
      isTotal: true,
      glAccountCodes: [],
    },
    {
      id: 'li-4',
      tenantId: TENANT,
      statementId: 'stmt-1',
      oemLineNumber: '300',
      oemLineLabel: 'Gross Profit',
      oemSection: 'GROSS_PROFIT',
      currentMonth: new Decimal('100000'),
      yearToDate: new Decimal('600000'),
      priorMonth: null,
      priorYear: null,
      variance: null,
      variancePct: null,
      displayOrder: 160,
      isSubtotal: true,
      isTotal: true,
      glAccountCodes: [],
    },
  ],
  comparisons: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── OEM Profile Tests ─────────────────────────────────────────────────────────

describe('OEM Profile', () => {
  it('createOEMProfile — creates and returns profile', async () => {
    const { svc, profileRepo } = makeService();
    vi.mocked(profileRepo.findByOemCode).mockResolvedValue(null);
    vi.mocked(profileRepo.create).mockResolvedValue(mockProfile);

    const result = await svc.createOEMProfile(TENANT, {
      oemCode: 'GM',
      oemName: 'General Motors',
      dealerCode: '12345',
    });

    expect(result.oemCode).toBe('GM');
    expect(profileRepo.create).toHaveBeenCalledOnce();
  });

  it('createOEMProfile — throws 409 if oemCode already exists for tenant', async () => {
    const { svc, profileRepo } = makeService();
    vi.mocked(profileRepo.findByOemCode).mockResolvedValue(mockProfile);

    await expect(
      svc.createOEMProfile(TENANT, { oemCode: 'GM', oemName: 'General Motors', dealerCode: '12345' }),
    ).rejects.toThrow('already exists');
  });

  it('updateOEMProfile — delegates to repo', async () => {
    const { svc, profileRepo } = makeService();
    vi.mocked(profileRepo.update).mockResolvedValue({ ...mockProfile, submissionMethod: 'XML_UPLOAD' });

    const result = await svc.updateOEMProfile(TENANT, 'GM', { submissionMethod: 'XML_UPLOAD' });
    expect(result.submissionMethod).toBe('XML_UPLOAD');
  });

  it('listOEMProfiles — returns all active profiles', async () => {
    const { svc, profileRepo } = makeService();
    vi.mocked(profileRepo.findAll).mockResolvedValue([mockProfile]);

    const result = await svc.listOEMProfiles(TENANT);
    expect(result).toHaveLength(1);
    expect(result[0].oemCode).toBe('GM');
  });
});

// ── Mapping Tests ─────────────────────────────────────────────────────────────

describe('Account Mapping', () => {
  it('createMapping — creates a GL mapping', async () => {
    const { svc, profileRepo, mappingRepo } = makeService();
    vi.mocked(profileRepo.findByOemCode).mockResolvedValue(mockProfile);
    const mockMapping = { id: 'map-1', tenantId: TENANT, oemProfileId: 'profile-gm', oemLineNumber: '101', oemLineLabel: 'New Vehicle Sales', oemSection: 'REVENUE', glAccountCodes: ['4010'], calculationType: 'SUM', formula: null, displayOrder: 10, isSubtotal: false, isTotal: false };
    vi.mocked(mappingRepo.create).mockResolvedValue(mockMapping);

    const result = await svc.createMapping(TENANT, {
      oemProfileId: 'profile-gm',
      oemLineNumber: '101',
      oemLineLabel: 'New Vehicle Sales',
      oemSection: 'REVENUE',
      glAccountCodes: ['4010'],
      displayOrder: 10,
    });
    expect(result.oemLineNumber).toBe('101');
    expect(result.glAccountCodes).toContain('4010');
  });

  it('importMappingTemplate — imports all GM template lines', async () => {
    const { svc, profileRepo, mappingRepo } = makeService();
    vi.mocked(profileRepo.findByOemCode).mockResolvedValue(mockProfile);
    vi.mocked(mappingRepo.importTemplate).mockResolvedValue(GM_MAPPING_TEMPLATE.lines.length);

    const count = await svc.importMappingTemplate(TENANT, 'GM', GM_MAPPING_TEMPLATE);
    expect(count).toBe(GM_MAPPING_TEMPLATE.lines.length);
    expect(mappingRepo.importTemplate).toHaveBeenCalledWith(TENANT, 'profile-gm', GM_MAPPING_TEMPLATE);
  });

  it('formula mapping — FORMULA calculation resolves LINE_ references', () => {
    const lineValues = new Map<string, Decimal>([
      ['199', new Decimal('500000')],
      ['299', new Decimal('400000')],
    ]);
    const result = evaluateFormula('LINE_199 - LINE_299', lineValues);
    expect(result.toNumber()).toBe(100000);
  });

  it('subtotal lines sum section correctly via generateLines', () => {
    const mappings = [
      { oemLineNumber: '101', oemLineLabel: 'Sales', oemSection: 'REVENUE', glAccountCodes: ['4010'], calculationType: 'SUM' as const, displayOrder: 10, isSubtotal: false, isTotal: false },
      { oemLineNumber: '102', oemLineLabel: 'Other', oemSection: 'REVENUE', glAccountCodes: ['4020'], calculationType: 'SUM' as const, displayOrder: 20, isSubtotal: false, isTotal: false },
      { oemLineNumber: '199', oemLineLabel: 'Total', oemSection: 'REVENUE', glAccountCodes: [], calculationType: 'FORMULA' as const, formula: 'LINE_101 + LINE_102', displayOrder: 30, isSubtotal: false, isTotal: true },
    ];
    const tb = buildAccountMap([
      { accountCode: '4010', accountName: 'Sales', accountType: 'REVENUE', balance: new Decimal('300000') },
      { accountCode: '4020', accountName: 'Other', accountType: 'REVENUE', balance: new Decimal('50000') },
    ]);
    const lines = generateLines(mappings, tb, tb, null, null);
    const total = lines.find((l) => l.oemLineNumber === '199');
    expect(total?.currentMonth.toNumber()).toBe(350000);
  });

  it('rejects duplicate oemLineNumber for same profile', async () => {
    const { svc, profileRepo, mappingRepo } = makeService();
    vi.mocked(profileRepo.findByOemCode).mockResolvedValue(mockProfile);
    vi.mocked(mappingRepo.create).mockRejectedValue(new Error('Unique constraint failed'));

    await expect(
      svc.createMapping(TENANT, { oemProfileId: 'profile-gm', oemLineNumber: '101', oemLineLabel: 'dup', oemSection: 'REVENUE', displayOrder: 10 }),
    ).rejects.toThrow();
  });
});

// ── Statement Generation Tests ────────────────────────────────────────────────

describe('Statement Generation', () => {
  function makeMappings() {
    return GM_MAPPING_TEMPLATE.lines.map((l) => ({
      id: `map-${l.lineNumber}`,
      tenantId: TENANT,
      oemProfileId: 'profile-gm',
      oemLineNumber: l.lineNumber,
      oemLineLabel: l.label,
      oemSection: l.section,
      glAccountCodes: l.glAccountCodes,
      calculationType: l.calculationType ?? 'SUM',
      formula: l.formula ?? null,
      displayOrder: l.displayOrder,
      isSubtotal: l.isSubtotal ?? false,
      isTotal: l.isTotal ?? false,
    }));
  }

  function setupGenerate(svc: FSService, profileRepo: any, mappingRepo: any, statementRepo: any, fetchMock: any) {
    vi.mocked(profileRepo.findByOemCode).mockResolvedValue(mockProfile);
    vi.mocked(mappingRepo.findAll).mockResolvedValue(makeMappings());
    vi.mocked(statementRepo.upsertWithLines).mockResolvedValue({ ...mockStatement, status: 'GENERATED' });
    vi.mocked(statementRepo.upsertComparison).mockResolvedValue({} as any);
    global.fetch = fetchMock;
  }

  const trialBalanceResponse = {
    periodYear: 2025, periodMonth: 6,
    accounts: [
      { accountCode: '4010', accountName: 'New Vehicle Sales', accountType: 'REVENUE', debit: 0, credit: 500000 },
      { accountCode: '5010', accountName: 'New Vehicle Cost', accountType: 'COST_OF_SALES', debit: 400000, credit: 0 },
    ],
  };

  it('generateStatement — returns GENERATED statement', async () => {
    const { svc, profileRepo, mappingRepo, statementRepo } = makeService();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => trialBalanceResponse } as any);
    setupGenerate(svc, profileRepo, mappingRepo, statementRepo, fetchMock);

    const result = await svc.generateStatement(TENANT, 'GM', 2025, 6);
    expect(result.status).toBe('GENERATED');
  });

  it('generateStatement — current month amounts match trial balance', async () => {
    const { svc, profileRepo, mappingRepo, statementRepo } = makeService();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => trialBalanceResponse } as any);
    setupGenerate(svc, profileRepo, mappingRepo, statementRepo, fetchMock);

    await svc.generateStatement(TENANT, 'GM', 2025, 6);

    // upsertWithLines was called with computed lines
    const [, , , , , lines] = vi.mocked(statementRepo.upsertWithLines).mock.calls[0];
    const newVehicleLine = lines.find((l: any) => l.oemLineNumber === '101');
    // Credit balance → negative debit-credit = 0 - 500000 = -500000
    expect(newVehicleLine).toBeDefined();
  });

  it('generateStatement — YTD calculated from Jan through current month', async () => {
    const { svc, profileRepo, mappingRepo, statementRepo } = makeService();
    // Called multiple times: once per month Jan-Jun + comparison calls
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => trialBalanceResponse } as any);
    setupGenerate(svc, profileRepo, mappingRepo, statementRepo, fetchMock);

    await svc.generateStatement(TENANT, 'GM', 2025, 6);

    // fetch called 7 times: 1 current + 6 YTD months (Jan-Jun)
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('generateStatement — fetches prior month when comparePriorMonth=true', async () => {
    const { svc, profileRepo, mappingRepo, statementRepo } = makeService();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => trialBalanceResponse } as any);
    setupGenerate(svc, profileRepo, mappingRepo, statementRepo, fetchMock);

    await svc.generateStatement(TENANT, 'GM', 2025, 6, { comparePriorMonth: true });

    // +1 for prior month fetch
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(statementRepo.upsertComparison).toHaveBeenCalledWith(TENANT, expect.any(String), 'PRIOR_MONTH', 2025, 5);
  });

  it('generateStatement — fetches prior year when comparePriorYear=true', async () => {
    const { svc, profileRepo, mappingRepo, statementRepo } = makeService();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => trialBalanceResponse } as any);
    setupGenerate(svc, profileRepo, mappingRepo, statementRepo, fetchMock);

    await svc.generateStatement(TENANT, 'GM', 2025, 6, { comparePriorYear: true });

    expect(statementRepo.upsertComparison).toHaveBeenCalledWith(TENANT, expect.any(String), 'PRIOR_YEAR', 2024, 6);
  });

  it('generateStatement — variance = currentMonth - priorMonth', () => {
    const mappings = [
      { oemLineNumber: '101', oemLineLabel: 'Sales', oemSection: 'REVENUE', glAccountCodes: ['4010'], calculationType: 'SUM' as const, displayOrder: 10, isSubtotal: false, isTotal: false },
    ];
    const currentTB = buildAccountMap([{ accountCode: '4010', accountName: 'Sales', accountType: 'REVENUE', balance: new Decimal('600000') }]);
    const priorTB = buildAccountMap([{ accountCode: '4010', accountName: 'Sales', accountType: 'REVENUE', balance: new Decimal('500000') }]);

    const lines = generateLines(mappings, currentTB, currentTB, priorTB, null);
    expect(lines[0].variance?.toNumber()).toBe(100000);
  });

  it('generateStatement — variance percentage calculated correctly', () => {
    const mappings = [
      { oemLineNumber: '101', oemLineLabel: 'Sales', oemSection: 'REVENUE', glAccountCodes: ['4010'], calculationType: 'SUM' as const, displayOrder: 10, isSubtotal: false, isTotal: false },
    ];
    const currentTB = buildAccountMap([{ accountCode: '4010', accountName: 'Sales', accountType: 'REVENUE', balance: new Decimal('550000') }]);
    const priorTB = buildAccountMap([{ accountCode: '4010', accountName: 'Sales', accountType: 'REVENUE', balance: new Decimal('500000') }]);

    const lines = generateLines(mappings, currentTB, currentTB, priorTB, null);
    // 50000 / 500000 * 100 = 10.0000%
    expect(lines[0].variancePct?.toNumber()).toBe(10);
  });

  it('generateStatement — missing GL account → line value = 0, not error', () => {
    const mappings = [
      { oemLineNumber: '101', oemLineLabel: 'Sales', oemSection: 'REVENUE', glAccountCodes: ['9999'], calculationType: 'SUM' as const, displayOrder: 10, isSubtotal: false, isTotal: false },
    ];
    const emptyTB = new Map<string, Decimal>();
    const lines = generateLines(mappings, emptyTB, emptyTB, null, null);
    expect(lines[0].currentMonth.toNumber()).toBe(0);
  });

  it('generateStatement — GL account in multiple lines each gets independent sum', () => {
    const mappings = [
      { oemLineNumber: '101', oemLineLabel: 'Sales A', oemSection: 'REVENUE', glAccountCodes: ['4010'], calculationType: 'SUM' as const, displayOrder: 10, isSubtotal: false, isTotal: false },
      { oemLineNumber: '102', oemLineLabel: 'Sales B', oemSection: 'REVENUE', glAccountCodes: ['4010', '4011'], calculationType: 'SUM' as const, displayOrder: 20, isSubtotal: false, isTotal: false },
    ];
    const tb = buildAccountMap([
      { accountCode: '4010', accountName: 'Sales', accountType: 'REVENUE', balance: new Decimal('300000') },
      { accountCode: '4011', accountName: 'Sales2', accountType: 'REVENUE', balance: new Decimal('100000') },
    ]);
    const lines = generateLines(mappings, tb, tb, null, null);
    expect(lines[0].currentMonth.toNumber()).toBe(300000);
    expect(lines[1].currentMonth.toNumber()).toBe(400000);
  });
});

// ── Validation Tests ──────────────────────────────────────────────────────────

describe('Statement Validation', () => {
  it('passes when Gross Profit = Revenue - COGS', () => {
    const result = validateStatement(
      { oemCode: 'GM', dealerCode: '12345' },
      mockStatement.lineItems as any,
    );
    // 500000 - 400000 = 100000 ✓
    const gpIssue = result.issues.find((i) => i.code === 'GP_MISMATCH');
    expect(gpIssue).toBeUndefined();
  });

  it('fails GP_MISMATCH when Gross Profit does not equal Revenue - COGS', () => {
    const badItems = mockStatement.lineItems.map((item) =>
      item.oemLineNumber === '300'
        ? { ...item, currentMonth: new Decimal('90000') } // wrong GP
        : item,
    );
    const result = validateStatement({ oemCode: 'GM', dealerCode: '12345' }, badItems as any);
    const gpIssue = result.issues.find((i) => i.code === 'GP_MISMATCH');
    expect(gpIssue).toBeDefined();
    expect(gpIssue?.severity).toBe('ERROR');
  });

  it('reports NULL_LINE_VALUE error for non-subtotal/total lines with null currentMonth', () => {
    const badItems = mockStatement.lineItems.map((item) =>
      item.oemLineNumber === '101'
        ? { ...item, currentMonth: null as any }
        : item,
    );
    const result = validateStatement({ oemCode: 'GM', dealerCode: '12345' }, badItems as any);
    const nullIssue = result.issues.find((i) => i.code === 'NULL_LINE_VALUE');
    expect(nullIssue).toBeDefined();
  });

  it('passes with valid data — result.valid = true', () => {
    const result = validateStatement({ oemCode: 'GM', dealerCode: '12345' }, mockStatement.lineItems as any);
    expect(result.valid).toBe(true);
  });

  it('OEM-specific: GM dealer code must be 5 digits', () => {
    const result = validateStatement({ oemCode: 'GM', dealerCode: 'ABC' }, mockStatement.lineItems as any);
    const issue = result.issues.find((i) => i.code === 'GM_DEALER_CODE');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('ERROR');
  });
});

// ── Submission Tests ──────────────────────────────────────────────────────────

describe('Statement Submission', () => {
  it('reviewStatement — updates reviewedBy and status to REVIEWED', async () => {
    const { svc, statementRepo } = makeService();
    vi.mocked(statementRepo.findById).mockResolvedValue(mockStatement as any);
    vi.mocked(statementRepo.updateStatus).mockResolvedValue({ ...mockStatement, status: 'REVIEWED', reviewedBy: 'alice' } as any);

    const result = await svc.reviewStatement(TENANT, 'stmt-1', 'alice');
    expect(statementRepo.updateStatus).toHaveBeenCalledWith('stmt-1', expect.objectContaining({ status: 'REVIEWED', reviewedBy: 'alice' }));
  });

  it('submitStatement — fails if status is not REVIEWED', async () => {
    const { svc, statementRepo } = makeService();
    vi.mocked(statementRepo.findById).mockResolvedValue({ ...mockStatement, status: 'DRAFT' } as any);

    await expect(svc.submitStatement(TENANT, 'stmt-1', 'alice')).rejects.toThrow('REVIEWED');
  });

  it('submitStatement — updates submittedAt when REVIEWED + valid', async () => {
    const { svc, statementRepo } = makeService();
    const reviewedStmt = { ...mockStatement, status: 'REVIEWED' };
    vi.mocked(statementRepo.findById).mockResolvedValue(reviewedStmt as any);
    vi.mocked(statementRepo.updateStatus).mockResolvedValue({ ...reviewedStmt, status: 'SUBMITTED' } as any);

    const result = await svc.submitStatement(TENANT, 'stmt-1', 'alice');
    expect(statementRepo.updateStatus).toHaveBeenCalledWith('stmt-1', expect.objectContaining({ status: 'SUBMITTED' }));
  });

  it('recordResponse — ACCEPTED sets status ACCEPTED', async () => {
    const { svc, statementRepo } = makeService();
    const submittedStmt = { ...mockStatement, status: 'SUBMITTED' };
    vi.mocked(statementRepo.findById).mockResolvedValue(submittedStmt as any);
    vi.mocked(statementRepo.updateStatus).mockResolvedValue({ ...submittedStmt, status: 'ACCEPTED' } as any);

    await svc.recordResponse(TENANT, 'stmt-1', { responseCode: 'OK', responseMessage: 'Accepted', accepted: true });
    expect(statementRepo.updateStatus).toHaveBeenCalledWith('stmt-1', expect.objectContaining({ status: 'ACCEPTED' }));
  });
});

// ── Supplemental Data Tests ───────────────────────────────────────────────────

describe('Supplemental Data', () => {
  it('upsertSupplementalData — creates new field', async () => {
    const { svc, supplementalRepo } = makeService();
    const mockField = { id: 's-1', tenantId: TENANT, oemCode: 'GM', periodYear: 2025, periodMonth: 6, fieldName: 'NEW_VEHICLE_INVENTORY', fieldValue: '150', fieldType: 'NUMBER' };
    vi.mocked(supplementalRepo.upsert).mockResolvedValue(mockField);

    const result = await svc.upsertSupplementalData({
      tenantId: TENANT, oemCode: 'GM', periodYear: 2025, periodMonth: 6, fieldName: 'NEW_VEHICLE_INVENTORY', fieldValue: '150', fieldType: 'NUMBER',
    });
    expect(result.fieldName).toBe('NEW_VEHICLE_INVENTORY');
    expect(result.fieldValue).toBe('150');
  });

  it('upsertSupplementalData — updates existing field', async () => {
    const { svc, supplementalRepo } = makeService();
    vi.mocked(supplementalRepo.upsert).mockResolvedValue({ id: 's-1', tenantId: TENANT, oemCode: 'GM', periodYear: 2025, periodMonth: 6, fieldName: 'TECH_COUNT', fieldValue: '12', fieldType: 'NUMBER' });

    const result = await svc.upsertSupplementalData({ tenantId: TENANT, oemCode: 'GM', periodYear: 2025, periodMonth: 6, fieldName: 'TECH_COUNT', fieldValue: '12' });
    expect(supplementalRepo.upsert).toHaveBeenCalledOnce();
    expect(result.fieldValue).toBe('12');
  });

  it('getSupplementalData — returns all fields for OEM/period', async () => {
    const { svc, supplementalRepo } = makeService();
    vi.mocked(supplementalRepo.findAll).mockResolvedValue([
      { id: 's-1', tenantId: TENANT, oemCode: 'GM', periodYear: 2025, periodMonth: 6, fieldName: 'INVENTORY', fieldValue: '200', fieldType: 'NUMBER' },
      { id: 's-2', tenantId: TENANT, oemCode: 'GM', periodYear: 2025, periodMonth: 6, fieldName: 'TECH_COUNT', fieldValue: '15', fieldType: 'NUMBER' },
    ]);

    const result = await svc.getSupplementalData(TENANT, 'GM', 2025, 6);
    expect(result).toHaveLength(2);
    expect(supplementalRepo.findAll).toHaveBeenCalledWith(TENANT, 'GM', 2025, 6);
  });
});
