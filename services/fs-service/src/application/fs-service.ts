import { Decimal } from '@prisma/client/runtime/library';
import type { OEMProfile, FinancialStatement, OEMAccountMapping } from '.prisma/fs-client';
import { OEMProfileRepository, CreateOEMProfileDto, UpdateOEMProfileDto } from '../infrastructure/oem-profile-repository';
import { MappingRepository, CreateMappingDto, UpdateMappingDto } from '../infrastructure/mapping-repository';
import { StatementRepository } from '../infrastructure/statement-repository';
import { SupplementalRepository, UpsertSupplementalDto } from '../infrastructure/supplemental-repository';
import { FormatCodeRepository, CreateFormatCodeDto, UpdateFormatCodeDto } from '../infrastructure/format-code-repository';
import { FSTemplateRepository, CreateFSTemplateDto } from '../infrastructure/fs-template-repository';
import { FSSetupRepository, CreateFSSetupDto } from '../infrastructure/fs-setup-repository';
import { generateLines, buildAccountMap, TrialBalanceAccount, MappingLine } from '../domain/fs-generator';
import { validateStatement, ValidationResult } from '../domain/fs-validator';
import type { MappingTemplate } from '../seed/oem-templates/types';

export interface GenerateStatementOptions {
  statementType?: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL';
  comparePriorMonth?: boolean;
  comparePriorYear?: boolean;
}

export interface OEMResponseDto {
  responseCode: string;
  responseMessage: string;
  accepted: boolean;
  rejectionReason?: string;
}

export interface FSComparisonReport {
  statementId: string;
  oemCode: string;
  periodYear: number;
  periodMonth: number;
  comparisonType: string;
  lines: Array<{
    oemLineNumber: string;
    oemLineLabel: string;
    current: Decimal;
    comparison: Decimal;
    variance: Decimal;
    variancePct: Decimal | null;
  }>;
}

interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
}

interface GLTrialBalanceResponse {
  periodYear: number;
  periodMonth: number;
  accounts: TrialBalanceRow[];
}

class GLServiceError extends Error {}

/**
 * Financial Statement Service — Stream 4.
 *
 * @cobol-origin All 100 finstm* programs + all finsup* screen programs.
 * @trace-improvement
 *   COBOL: Each finstm* program was a monolithic report generator with hardcoded GL mappings.
 *   One new program per OEM per year when the OEM changed report format.
 *   TypeScript: Config-driven engine — same code generates any OEM's FS by reading
 *   the OEMAccountMapping table. Adding a new OEM = configuration, not code.
 */
export class FSService {
  private readonly glServiceUrl: string;

  constructor(
    private readonly profileRepo: OEMProfileRepository,
    private readonly mappingRepo: MappingRepository,
    private readonly statementRepo: StatementRepository,
    private readonly supplementalRepo: SupplementalRepository,
    private readonly formatCodeRepo: FormatCodeRepository,
    private readonly templateRepo: FSTemplateRepository,
    private readonly setupRepo: FSSetupRepository,
  ) {
    this.glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
  }

  // ── OEM Profile Management ───────────────────────────────────────────────

  async createOEMProfile(tenantId: string, dto: CreateOEMProfileDto): Promise<OEMProfile> {
    const existing = await this.profileRepo.findByOemCode(tenantId, dto.oemCode);
    if (existing) throw new Error(`OEM profile already exists for code: ${dto.oemCode}`);
    return this.profileRepo.create(tenantId, dto);
  }

  async updateOEMProfile(tenantId: string, oemCode: string, dto: UpdateOEMProfileDto): Promise<OEMProfile> {
    return this.profileRepo.update(tenantId, oemCode, dto);
  }

  async getOEMProfile(tenantId: string, oemCode: string): Promise<OEMProfile> {
    const profile = await this.profileRepo.findByOemCode(tenantId, oemCode);
    if (!profile) throw new Error(`OEM profile not found: ${oemCode}`);
    return profile;
  }

  async listOEMProfiles(tenantId: string): Promise<OEMProfile[]> {
    return this.profileRepo.findAll(tenantId);
  }

  // ── Account Mapping ──────────────────────────────────────────────────────

  /**
   * @cobol-origin finstm* family — each program hardcoded GL→line mappings.
   * @removes-need-for All 100 finstm* programs: adding OEM = config, not code.
   */
  async createMapping(tenantId: string, dto: CreateMappingDto): Promise<OEMAccountMapping> {
    return this.mappingRepo.create(tenantId, dto);
  }

  async updateMapping(tenantId: string, mappingId: string, dto: UpdateMappingDto): Promise<OEMAccountMapping> {
    const existing = await this.mappingRepo.findById(mappingId);
    if (!existing || existing.tenantId !== tenantId) throw new Error('Mapping not found');
    return this.mappingRepo.update(mappingId, dto);
  }

  async getMappings(tenantId: string, oemCode: string): Promise<OEMAccountMapping[]> {
    const profile = await this.getOEMProfile(tenantId, oemCode);
    return this.mappingRepo.findAll(tenantId, profile.id);
  }

  async importMappingTemplate(tenantId: string, oemCode: string, template: MappingTemplate): Promise<number> {
    const profile = await this.getOEMProfile(tenantId, oemCode);
    return this.mappingRepo.importTemplate(tenantId, profile.id, template);
  }

  async deleteMapping(tenantId: string, mappingId: string): Promise<void> {
    const existing = await this.mappingRepo.findById(mappingId);
    if (!existing || existing.tenantId !== tenantId) throw new Error('Mapping not found');
    await this.mappingRepo.delete(mappingId);
  }

  // ── Statement Generation ─────────────────────────────────────────────────

  /**
   * @business-rule Financial statement generation algorithm:
   *   1. Load OEM profile and account mappings for the tenant
   *   2. Fetch trial balance from gl-service for the period
   *   3. For each OEM line: sum GL account balances that map to that line
   *   4. For FORMULA lines: evaluate formula referencing other line numbers
   *   5. Calculate subtotals and totals
   *   6. If comparison requested: fetch prior period/year trial balance, compute variances
   *   7. Persist all line items with source GL account codes (audit trail)
   */
  async generateStatement(
    tenantId: string,
    oemCode: string,
    periodYear: number,
    periodMonth: number,
    options: GenerateStatementOptions = {},
  ): Promise<FinancialStatement> {
    const profile = await this.getOEMProfile(tenantId, oemCode);
    const rawMappings = await this.mappingRepo.findAll(tenantId, profile.id);
    if (rawMappings.length === 0) {
      throw new Error(`No account mappings configured for OEM: ${oemCode}`);
    }

    const mappings: MappingLine[] = rawMappings.map((m) => ({
      oemLineNumber: m.oemLineNumber,
      oemLineLabel: m.oemLineLabel,
      oemSection: m.oemSection,
      glAccountCodes: m.glAccountCodes,
      calculationType: m.calculationType as 'SUM' | 'DIFFERENCE' | 'FORMULA',
      formula: m.formula,
      displayOrder: m.displayOrder,
      isSubtotal: m.isSubtotal,
      isTotal: m.isTotal,
    }));

    const statementType = options.statementType ?? 'MONTHLY';
    const currentTB = await this.fetchTrialBalance(tenantId, periodYear, periodMonth);
    const currentMap = buildAccountMap(this.toTrialBalanceAccounts(currentTB.accounts));
    const ytdMap = await this.fetchYTDBalance(tenantId, periodYear, 1, periodMonth);

    let priorMonthMap: Map<string, Decimal> | null = null;
    let priorYearMap: Map<string, Decimal> | null = null;

    if (options.comparePriorMonth) {
      const [py, pm] = periodMonth === 1 ? [periodYear - 1, 12] : [periodYear, periodMonth - 1];
      const tb = await this.fetchTrialBalance(tenantId, py, pm);
      priorMonthMap = buildAccountMap(this.toTrialBalanceAccounts(tb.accounts));
    }
    if (options.comparePriorYear) {
      const tb = await this.fetchTrialBalance(tenantId, periodYear - 1, periodMonth);
      priorYearMap = buildAccountMap(this.toTrialBalanceAccounts(tb.accounts));
    }

    const lines = generateLines(mappings, currentMap, ytdMap, priorMonthMap, priorYearMap);
    const statement = await this.statementRepo.upsertWithLines(
      tenantId, profile.id, periodYear, periodMonth, statementType, lines,
    );

    if (options.comparePriorMonth) {
      const [py, pm] = periodMonth === 1 ? [periodYear - 1, 12] : [periodYear, periodMonth - 1];
      await this.statementRepo.upsertComparison(tenantId, statement.id, 'PRIOR_MONTH', py, pm);
    }
    if (options.comparePriorYear) {
      await this.statementRepo.upsertComparison(tenantId, statement.id, 'PRIOR_YEAR', periodYear - 1, periodMonth);
    }

    return statement;
  }

  async getStatement(statementId: string) {
    const stmt = await this.statementRepo.findById(statementId);
    if (!stmt) throw new Error('Statement not found');
    return stmt;
  }

  async listStatements(tenantId: string, status?: string) {
    return this.statementRepo.listByTenant(tenantId, status);
  }

  // ── Statement Validation ─────────────────────────────────────────────────

  async validateStatement(tenantId: string, statementId: string): Promise<ValidationResult> {
    const stmt = await this.statementRepo.findById(statementId);
    if (!stmt) throw new Error('Statement not found');
    if (stmt.tenantId !== tenantId) throw new Error('Statement not found');
    return validateStatement(
      { oemCode: stmt.oemProfile.oemCode, dealerCode: stmt.oemProfile.dealerCode },
      stmt.lineItems,
    );
  }

  // ── Statement Submission Lifecycle ───────────────────────────────────────

  async reviewStatement(tenantId: string, statementId: string, reviewedBy: string): Promise<FinancialStatement> {
    const stmt = await this.statementRepo.findById(statementId);
    if (!stmt) throw new Error('Statement not found');
    if (stmt.tenantId !== tenantId) throw new Error('Statement not found');
    if (stmt.status !== 'GENERATED') {
      throw new Error(`Statement must be GENERATED to review; current status: ${stmt.status}`);
    }
    return this.statementRepo.updateStatus(statementId, {
      status: 'REVIEWED', reviewedBy, reviewedAt: new Date(),
    }) as unknown as FinancialStatement;
  }

  async submitStatement(tenantId: string, statementId: string, submittedBy: string): Promise<FinancialStatement> {
    const stmt = await this.statementRepo.findById(statementId);
    if (!stmt) throw new Error('Statement not found');
    if (stmt.tenantId !== tenantId) throw new Error('Statement not found');
    if (stmt.status !== 'REVIEWED') {
      throw new Error(`Statement must be REVIEWED before submission; current status: ${stmt.status}`);
    }
    const validationResult = validateStatement(
      { oemCode: stmt.oemProfile.oemCode, dealerCode: stmt.oemProfile.dealerCode },
      stmt.lineItems,
    );
    if (!validationResult.valid) {
      throw new Error(
        `Statement has validation errors: ${validationResult.issues
          .filter((i) => i.severity === 'ERROR')
          .map((i) => i.message)
          .join('; ')}`,
      );
    }
    return this.statementRepo.updateStatus(statementId, {
      status: 'SUBMITTED', submittedBy, submittedAt: new Date(),
    }) as unknown as FinancialStatement;
  }

  async recordResponse(tenantId: string, statementId: string, response: OEMResponseDto): Promise<FinancialStatement> {
    const stmt = await this.statementRepo.findById(statementId);
    if (!stmt) throw new Error('Statement not found');
    if (stmt.tenantId !== tenantId) throw new Error('Statement not found');
    return this.statementRepo.updateStatus(statementId, {
      status: response.accepted ? 'ACCEPTED' : 'REJECTED',
      responseCode: response.responseCode,
      responseMessage: response.responseMessage,
      rejectionReason: response.rejectionReason ?? undefined,
    }) as unknown as FinancialStatement;
  }

  // ── Statement Comparison ─────────────────────────────────────────────────

  async getStatementComparison(
    tenantId: string,
    statementId: string,
    comparisonType: 'PRIOR_MONTH' | 'PRIOR_YEAR' | 'BUDGET',
  ): Promise<FSComparisonReport> {
    const stmt = await this.statementRepo.findById(statementId);
    if (!stmt) throw new Error('Statement not found');
    if (stmt.tenantId !== tenantId) throw new Error('Statement not found');

    const comparison = stmt.comparisons.find((c) => c.comparisonType === comparisonType);
    if (!comparison) throw new Error(`No ${comparisonType} comparison data for this statement`);

    const compStmt = await this.statementRepo.findByPeriod(
      tenantId, stmt.oemProfileId, comparison.comparisonYear, comparison.comparisonMonth, stmt.statementType,
    );

    const compLineMap = new Map<string, Decimal>();
    if (compStmt) {
      for (const item of compStmt.lineItems) {
        compLineMap.set(item.oemLineNumber, new Decimal(item.currentMonth.toString()));
      }
    }

    const lines = stmt.lineItems.map((item) => {
      const current = new Decimal(item.currentMonth.toString());
      const comp = compLineMap.get(item.oemLineNumber) ?? new Decimal(0);
      const variance = current.minus(comp);
      const variancePct = !comp.isZero() ? variance.div(comp.abs()).times(100).toDecimalPlaces(4) : null;
      return { oemLineNumber: item.oemLineNumber, oemLineLabel: item.oemLineLabel, current, comparison: comp, variance, variancePct };
    });

    return { statementId: stmt.id, oemCode: stmt.oemProfile.oemCode, periodYear: stmt.periodYear, periodMonth: stmt.periodMonth, comparisonType, lines };
  }

  // ── Supplemental Data ────────────────────────────────────────────────────

  /**
   * @cobol-origin finsup* programs wrote supplemental data to FINSUP-FILE.
   * @trace-improvement Single key-value API replaces all OEM-specific finsup* screen programs.
   */
  async getSupplementalData(tenantId: string, oemCode: string, year: number, month: number) {
    return this.supplementalRepo.findAll(tenantId, oemCode, year, month);
  }

  async upsertSupplementalData(dto: UpsertSupplementalDto) {
    return this.supplementalRepo.upsert(dto);
  }

  // ── Format Code Management (BUILD-011) ────────────────────────────────────

  async createFormatCode(tenantId: string, dto: CreateFormatCodeDto) {
    const existing = await this.formatCodeRepo.findByMfgCode(tenantId, dto.mfgCode);
    if (existing) throw new Error(`Format code already exists: ${dto.mfgCode}`);
    return this.formatCodeRepo.create(tenantId, dto);
  }

  async updateFormatCode(tenantId: string, id: string, dto: UpdateFormatCodeDto) {
    const existing = await this.formatCodeRepo.findById(id);
    if (!existing || existing.tenantId !== tenantId) throw new Error('Format code not found');
    return this.formatCodeRepo.update(id, dto);
  }

  async getFormatCode(tenantId: string, id: string) {
    const code = await this.formatCodeRepo.findById(id);
    if (!code || code.tenantId !== tenantId) throw new Error('Format code not found');
    return code;
  }

  async listFormatCodes(tenantId: string) {
    return this.formatCodeRepo.findAll(tenantId);
  }

  async deleteFormatCode(tenantId: string, id: string) {
    const existing = await this.formatCodeRepo.findById(id);
    if (!existing || existing.tenantId !== tenantId) throw new Error('Format code not found');
    await this.formatCodeRepo.delete(id);
  }

  // ── Template Management (BUILD-011) ────────────────────────────────────────

  async importTemplate(tenantId: string, mfgCode: string, year: number, parameters: Record<string, any>) {
    const formatCode = await this.formatCodeRepo.findByMfgCode(tenantId, mfgCode);
    if (!formatCode) throw new Error(`Format code not found: ${mfgCode}`);
    return this.templateRepo.upsert(tenantId, { mfgCode, year, parameters });
  }

  async getTemplate(tenantId: string, mfgCode: string, year: number) {
    return this.templateRepo.findByMfgCodeAndYear(tenantId, mfgCode, year);
  }

  async listTemplates(tenantId: string, mfgCode: string) {
    return this.templateRepo.findAll(tenantId, mfgCode);
  }

  // ── FS Period Setup (BUILD-011) ────────────────────────────────────────────

  async setupFS(tenantId: string, dto: CreateFSSetupDto) {
    const formatCode = await this.formatCodeRepo.findByMfgCode(tenantId, dto.mfgCode);
    if (!formatCode) throw new Error(`Format code not found: ${dto.mfgCode}`);

    const existing = await this.setupRepo.findByMfgCodeAndYear(tenantId, dto.mfgCode, dto.year);
    if (existing) {
      return this.setupRepo.update(tenantId, dto.mfgCode, dto.year, dto);
    }
    return this.setupRepo.create(tenantId, dto);
  }

  async getSetup(tenantId: string, mfgCode: string, year: number) {
    return this.setupRepo.findByMfgCodeAndYear(tenantId, mfgCode, year);
  }

  async listSetups(tenantId: string, mfgCode?: string) {
    return this.setupRepo.findAll(tenantId, mfgCode);
  }

  // ── Private: GL Integration ──────────────────────────────────────────────

  private async fetchTrialBalance(tenantId: string, year: number, month: number): Promise<GLTrialBalanceResponse> {
    const res = await fetch(
      `${this.glServiceUrl}/api/v1/gl/trial-balance?year=${year}&month=${month}`,
      { headers: { 'x-tenant-id': tenantId }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) throw new GLServiceError(`Trial balance fetch failed for ${year}/${month}: ${res.status}`);
    return res.json() as Promise<GLTrialBalanceResponse>;
  }

  private async fetchYTDBalance(
    tenantId: string,
    year: number,
    fromMonth: number,
    throughMonth: number,
  ): Promise<Map<string, Decimal>> {
    const ytd = new Map<string, Decimal>();
    for (let m = fromMonth; m <= throughMonth; m++) {
      const tb = await this.fetchTrialBalance(tenantId, year, m);
      for (const row of tb.accounts) {
        const net = new Decimal(row.debit).minus(new Decimal(row.credit));
        ytd.set(row.accountCode, (ytd.get(row.accountCode) ?? new Decimal(0)).plus(net));
      }
    }
    return ytd;
  }

  private toTrialBalanceAccounts(rows: TrialBalanceRow[]): TrialBalanceAccount[] {
    return rows.map((r) => ({
      accountCode: r.accountCode,
      accountName: r.accountName,
      accountType: r.accountType,
      balance: new Decimal(r.debit).minus(new Decimal(r.credit)),
    }));
  }
}

