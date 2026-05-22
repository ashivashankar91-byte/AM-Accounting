/**
 * @module ConsolidationService
 * @cobol-ancestry consolgl.cbl, consolexpgl.cbl
 * @cobol-programs-replaced
 *   CONSOLGL    — Consolidated G/L menu (Options 1=Clear, 2=Import)
 *   CONSOLEXPGL — Merges GL/journal/source COBOL files across companies
 *
 * @architecture
 *   TypeScript merges Postgres data across tenants via HTTP fan-out to gl-service.
 *   No COBOL ISAM file merging needed. The consolmap ISAM file becomes ConsolidationMapping table.
 *   Java OfficeMate syncs (GLReverseSync, JournalSync) are eliminated — data is already in Postgres.
 */

import { PrismaClient } from '.prisma/group-client';
import pino from 'pino';

const logger = pino({ name: 'consolidation-service' });
const GL_SERVICE_URL = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
const INTERNAL_TOKEN = process.env['AMACC_INTERNAL_TOKEN'] ?? 'amacc-internal';

// ── Types ───────────────────────────────────────────────────────────────────────

export interface ConsolidatedTrialBalanceLine {
  consolidatedAccountId: string;
  name: string;
  totalDebit: number;
  totalCredit: number;
  runningBalance: number;
}

// ── Typed errors ──────────────────────────────────────────────────────────────

export class GroupNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(groupId: string) {
    super(`Group ${groupId} not found`);
    this.name = 'GroupNotFoundError';
  }
}

export class ConsolidationConfigNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(groupId: string) {
    super(`No consolidated GL config found for group ${groupId}`);
    this.name = 'ConsolidationConfigNotFoundError';
  }
}

export class InvalidCompanyListError extends Error {
  readonly statusCode = 400;
  constructor(msg: string) {
    super(msg);
    this.name = 'InvalidCompanyListError';
  }
}

// ── Helper: next consolidated account ID (a0001..z9999) ──────────────────────
// @cobol-origin consolexpgl.cbl CONSOL-MAP-NEW-ACCTID assignment

function numberToConsolidatedId(n: number): string {
  const letterIndex = Math.floor((n - 1) / 9999);
  if (letterIndex > 25) throw new Error('Consolidated account ID space exhausted (max 259,974 accounts)');
  const letter = String.fromCharCode('a'.charCodeAt(0) + letterIndex);
  const num = ((n - 1) % 9999) + 1;
  return letter + String(num).padStart(4, '0');
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function glGet(path: string, tenantId: string): Promise<any> {
  const resp = await fetch(`${GL_SERVICE_URL}/api/v1/gl${path}`, {
    headers: {
      'x-tenant-id': tenantId,
      'Authorization': `Bearer ${INTERNAL_TOKEN}`,
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`GL service GET ${path} for tenant ${tenantId} failed [${resp.status}]: ${text}`);
  }
  return resp.json();
}

async function glDelete(path: string, tenantId: string): Promise<void> {
  const resp = await fetch(`${GL_SERVICE_URL}/api/v1/gl${path}`, {
    method: 'DELETE',
    headers: {
      'x-tenant-id': tenantId,
      'Authorization': `Bearer ${INTERNAL_TOKEN}`,
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`GL service DELETE ${path} for tenant ${tenantId} failed [${resp.status}]: ${text}`);
  }
}

// ── ConsolidationService ──────────────────────────────────────────────────────

export class ConsolidationService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── getStatus ─────────────────────────────────────────────────────────────

  async getStatus(groupId: string) {
    const config = await this.prisma.consolidatedGlConfig.findFirst({
      where: { groupId },
      include: { _count: { select: { mappings: true } } },
    });
    if (!config) return null;

    return {
      configId: config.id,
      groupId: config.groupId,
      consolidatedTenantId: config.consolidatedTenantId,
      sourceTenantIds: config.sourceTenantIds,
      lastClosedDate: config.lastClosedDate,
      lastImportedAt: config.lastImportedAt,
      isValid: config.isValid,
      mappingCount: config._count.mappings,
    };
  }

  // ── upsertConfig ──────────────────────────────────────────────────────────

  async upsertConfig(groupId: string, consolidatedTenantId: string, sourceTenantIds: string[]) {
    return this.prisma.consolidatedGlConfig.upsert({
      where: { groupId_consolidatedTenantId: { groupId, consolidatedTenantId } },
      create: { groupId, consolidatedTenantId, sourceTenantIds },
      update: { sourceTenantIds },
    });
  }

  // ── clear ─────────────────────────────────────────────────────────────────
  // @cobol-origin consolgl.cbl Option 1 (Clear)
  // COBOL: truncates GL, journal, source COBOL files + psql DELETE on journal/gl/mfg_gl/yearbal
  // TypeScript: clears consolidated tenant's GL data via gl-service + wipes ConsolidationMapping

  async clear(groupId: string): Promise<{ cleared: boolean; configId: string }> {
    const config = await this.prisma.consolidatedGlConfig.findFirst({ where: { groupId } });
    if (!config) throw new ConsolidationConfigNotFoundError(groupId);

    logger.info({ groupId, consolidatedTenantId: config.consolidatedTenantId }, 'Clearing consolidated GL');

    // Delete all GL accounts for the consolidated tenant via gl-service
    // (gl-service uses soft-delete; accounts are deactivated)
    const accounts = await glGet('/accounts', config.consolidatedTenantId);
    for (const account of accounts ?? []) {
      await glDelete(`/accounts/${account.id}`, config.consolidatedTenantId);
    }

    // Delete all ConsolidationMapping rows for this consolidated tenant
    await this.prisma.consolidationMapping.deleteMany({
      where: { consolidatedTenantId: config.consolidatedTenantId },
    });

    // Reset config status
    await this.prisma.consolidatedGlConfig.update({
      where: { id: config.id },
      data: { isValid: false, lastImportedAt: null, lastClosedDate: null },
    });

    logger.info({ groupId }, 'Consolidated GL cleared');
    return { cleared: true, configId: config.id };
  }

  // ── import ────────────────────────────────────────────────────────────────
  // @cobol-origin consolgl.cbl Option 2 (Import) + consolexpgl.cbl (merge algorithm)
  //
  // Architecture decision: LIVE FAN-OUT (option b) — import is mapping-setup only.
  // No GL account or period balance data is copied into the consolidated tenant.
  // Trial balance queries fan out to source tenants in real-time via getConsolidatedTrialBalance.
  //
  // COBOL did:
  //   1. consolmap lookup/create (assigns consolidated account ID)
  //   2. WRITE GL to consolidated file (ADD on duplicate)      ← NOT reproduced
  //   3. Merge journal entries from BEG-OF-YEAR-DATE           ← NOT reproduced
  //   4. Merge source file (skip duplicates)                   ← NOT reproduced
  // Steps 2-4 eliminated: data lives in Postgres per-tenant, read live via API.

  async import(
    groupId: string,
    params: {
      companies: string[];   // source tenantIds
      lastClosedDate: string; // YYYYMMDD
      consolidatedTenantId?: string;
    },
  ): Promise<{
    configId: string;
    consolidatedTenantId: string;
    sourcesProcessed: number;
    mappingEntriesCreated: number;
    lastClosedDate: string;
  }> {
    if (params.companies.length < 2 || params.companies.length > 40) {
      throw new InvalidCompanyListError('Must provide 2 to 40 source company tenant IDs');
    }

    // @cobol-origin consolgl.cbl EDIT-CONSOLIMIMPORT-COMPNO: no duplicate company numbers
    const unique = new Set(params.companies);
    if (unique.size < params.companies.length) {
      throw new InvalidCompanyListError('Duplicate source company IDs are not allowed');
    }

    // Validate lastClosedDate format YYYYMMDD
    if (!/^\d{8}$/.test(params.lastClosedDate)) {
      throw new InvalidCompanyListError('lastClosedDate must be in YYYYMMDD format');
    }

    // Get or create config
    let config = await this.prisma.consolidatedGlConfig.findFirst({ where: { groupId } });

    // @cobol-origin consolgl.cbl EDIT-CONSOLIMIMPORT-COMPNO:
    // "Cannot use consolidated company number here" — prevents circular consolidation
    // (would double-count every balance: $10M consolidated → appears as $20M)
    const consolidatedId = config?.consolidatedTenantId ?? params.consolidatedTenantId;
    if (consolidatedId && params.companies.includes(consolidatedId)) {
      throw new InvalidCompanyListError(
        `Consolidated tenant '${consolidatedId}' cannot be listed as a source company — this would double-count all balances`
      );
    }
    if (!config) {
      if (!params.consolidatedTenantId) {
        throw new InvalidCompanyListError(
          'consolidatedTenantId is required when no config exists for this group'
        );
      }
      config = await this.prisma.consolidatedGlConfig.create({
        data: {
          groupId,
          consolidatedTenantId: params.consolidatedTenantId,
          sourceTenantIds: params.companies,
          lastClosedDate: params.lastClosedDate,
        },
      });
    } else {
      await this.prisma.consolidatedGlConfig.update({
        where: { id: config.id },
        data: { sourceTenantIds: params.companies, lastClosedDate: params.lastClosedDate, isValid: false },
      });
    }

    const { consolidatedTenantId } = config;
    let totalAccountsMerged = 0;

    // Current mapping count (to continue ID sequence)
    let mappingCount = await this.prisma.consolidationMapping.count({
      where: { consolidatedTenantId },
    });

    // Process each source company
    for (const sourceTenantId of params.companies) {
      logger.info({ groupId, sourceTenantId, consolidatedTenantId }, 'Merging source tenant');

      // Fetch all active GL accounts from source tenant
      let sourceAccounts: any[];
      try {
        sourceAccounts = await glGet('/accounts', sourceTenantId);
      } catch (err) {
        logger.warn({ sourceTenantId, err }, 'Failed to fetch accounts — skipping tenant');
        continue;
      }

      for (const srcAcct of sourceAccounts ?? []) {
        // Look up or create consolidation mapping
        const existing = await this.prisma.consolidationMapping.findUnique({
          where: {
            consolidatedTenantId_originalAccountCode_sourceTenantId: {
              consolidatedTenantId,
              originalAccountCode: srcAcct.code,
              sourceTenantId,
            },
          },
        });

        let consolidatedAccountId: string;
        if (existing) {
          consolidatedAccountId = existing.consolidatedAccountId;
        } else {
          mappingCount += 1;
          consolidatedAccountId = numberToConsolidatedId(mappingCount);
          await this.prisma.consolidationMapping.create({
            data: {
              configId: config.id,
              consolidatedTenantId,
              sourceTenantId,
              originalAccountCode: srcAcct.code,
              consolidatedAccountId,
            },
          });
        }

        totalAccountsMerged += 1;
      }
    }

    // Mark config as valid
    await this.prisma.consolidatedGlConfig.update({
      where: { id: config.id },
      data: { isValid: true, lastImportedAt: new Date(), lastClosedDate: params.lastClosedDate },
    });

    logger.info({ groupId, consolidatedTenantId, totalAccountsMerged }, 'Consolidated GL import complete (mapping-setup only)');

    return {
      configId: config.id,
      consolidatedTenantId,
      sourcesProcessed: params.companies.length,
      mappingEntriesCreated: totalAccountsMerged,
      lastClosedDate: params.lastClosedDate,
    };
  }

  // ── getConsolidatedTrialBalance ───────────────────────────────────────────
  // @architecture Live fan-out — no data copy into consolidated tenant.
  //   For each source tenant: fetch accounts, look up ConsolidationMapping,
  //   fetch period running balances, aggregate by consolidatedAccountId.
  // @note Uses inquiry typeCode=1 (current period journals) for running balances.
  // TODO: optimize with a bulk GET /accounts/period-balances endpoint on gl-service
  //       to eliminate N+1 per account per tenant.

  async getConsolidatedTrialBalance(
    groupId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<ConsolidatedTrialBalanceLine[]> {
    const config = await this.prisma.consolidatedGlConfig.findFirst({
      where: { groupId },
      include: { mappings: true },
    });
    if (!config) throw new ConsolidationConfigNotFoundError(groupId);

    // Index: "sourceTenantId:originalAccountCode" → consolidatedAccountId
    const mappingIndex = new Map<string, string>();
    for (const m of config.mappings) {
      mappingIndex.set(`${m.sourceTenantId}:${m.originalAccountCode}`, m.consolidatedAccountId);
    }

    // Aggregate: consolidatedAccountId → running totals
    const aggregated = new Map<string, ConsolidatedTrialBalanceLine>();

    for (const sourceTenantId of config.sourceTenantIds) {
      let sourceAccounts: any[];
      try {
        sourceAccounts = await glGet('/accounts', sourceTenantId);
      } catch (err) {
        logger.warn({ sourceTenantId, err }, 'getConsolidatedTrialBalance: failed to fetch accounts — skipping tenant');
        continue;
      }

      for (const srcAcct of sourceAccounts ?? []) {
        const consolidatedAccountId = mappingIndex.get(`${sourceTenantId}:${srcAcct.code}`);
        if (!consolidatedAccountId) continue;

        let periodLines: any[];
        try {
          periodLines = await glGet(
            `/accounts/${encodeURIComponent(srcAcct.code)}/inquiry?typeCode=1&periodYear=${periodYear}&periodMonth=${periodMonth}`,
            sourceTenantId,
          );
        } catch (err) {
          logger.warn({ sourceTenantId, accountCode: srcAcct.code, err }, 'getConsolidatedTrialBalance: failed to fetch period balance — skipping account');
          continue;
        }

        let debit = 0;
        let credit = 0;
        let runningBalance = 0;
        for (const line of periodLines ?? []) {
          debit += Number(line.debit ?? 0);
          credit += Number(line.credit ?? 0);
          runningBalance = Number(line.runningBalance ?? runningBalance);
        }

        const existing = aggregated.get(consolidatedAccountId);
        if (existing) {
          existing.totalDebit += debit;
          existing.totalCredit += credit;
          existing.runningBalance += runningBalance;
        } else {
          aggregated.set(consolidatedAccountId, {
            consolidatedAccountId,
            name: srcAcct.name ?? srcAcct.code,
            totalDebit: debit,
            totalCredit: credit,
            runningBalance,
          });
        }
      }
    }

    return Array.from(aggregated.values()).sort((a, b) =>
      a.consolidatedAccountId.localeCompare(b.consolidatedAccountId),
    );
  }
}
