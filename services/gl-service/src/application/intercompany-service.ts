/**
 * S034 — Intercompany Pairing & Net-Zero
 *
 * Defines legal entity pairs that transact with each other intercompany.
 * When a JE is tagged as intercompany (via legalEntityId + icPairId), the
 * engine tracks the entry and enforces net-zero by period close.
 *
 * Net-zero invariant: for each IC pair in each period,
 *   Σ entity-A IC entries + Σ entity-B IC entries = 0
 *
 * Enforcement modes:
 *   NONE — no enforcement, informational only
 *   WARN — allow posting but flag unmatched entries for review
 *   BLOCK — reject period close when IC pair is not net-zero
 */

import Decimal from 'decimal.js';
import { TenantId } from '@amacc/shared-kernel';

export interface IntercompanyPairDTO {
  entityAId: string;
  entityBId: string;
  icReceivableAccount?: string;
  icPayableAccount?: string;
  enforcement: 'NONE' | 'WARN' | 'BLOCK';
}

export interface IcNetZeroResult {
  pairId: string;
  entityAId: string;
  entityBId: string;
  periodYear: number;
  periodMonth: number;
  entityABalance: Decimal;
  entityBBalance: Decimal;
  netBalance: Decimal;
  isNetZero: boolean;
  unmatchedEntries: string[];
}

export class IntercompanyService {
  constructor(private readonly prisma: any) {}

  async createPair(dto: IntercompanyPairDTO, tenantId: TenantId, createdBy: string): Promise<any> {
    // Normalize: always store the pair with entity IDs in sorted order to
    // avoid A↔B / B↔A duplicates.
    const [entityAId, entityBId] = [dto.entityAId, dto.entityBId].sort();

    return this.prisma.intercompanyPair.create({
      data: {
        tenantId,
        entityAId,
        entityBId,
        icReceivableAccount: dto.icReceivableAccount,
        icPayableAccount: dto.icPayableAccount,
        enforcement: dto.enforcement,
        createdBy,
      },
    });
  }

  async listPairs(tenantId: TenantId): Promise<any[]> {
    return this.prisma.intercompanyPair.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async recordIcEntry(
    tenantId: TenantId,
    pairId: string,
    journalEntryId: string,
    originatingEntityId: string,
    icAmount: Decimal,
    periodYear: number,
    periodMonth: number,
  ): Promise<any> {
    return this.prisma.intercompanyPairEntry.create({
      data: {
        tenantId,
        pairId,
        journalEntryId,
        originatingEntityId,
        icAmount: icAmount.toNumber(),
        periodYear,
        periodMonth,
        status: 'UNMATCHED',
      },
    });
  }

  /**
   * Check net-zero status for all IC pairs in a period.
   * Called by close-service during pre-close scrub (CE-15 S115).
   */
  async checkNetZero(
    tenantId: TenantId,
    periodYear: number,
    periodMonth: number,
  ): Promise<IcNetZeroResult[]> {
    const pairs = await this.listPairs(tenantId);
    const results: IcNetZeroResult[] = [];

    for (const pair of pairs) {
      const entries = await this.prisma.intercompanyPairEntry.findMany({
        where: { tenantId, pairId: pair.id, periodYear, periodMonth },
      });

      const entityABalance = entries
        .filter((e: any) => e.originatingEntityId === pair.entityAId)
        .reduce((s: Decimal, e: any) => s.plus(e.icAmount), new Decimal(0));

      const entityBBalance = entries
        .filter((e: any) => e.originatingEntityId === pair.entityBId)
        .reduce((s: Decimal, e: any) => s.plus(e.icAmount), new Decimal(0));

      const netBalance = entityABalance.plus(entityBBalance);
      const isNetZero = netBalance.abs().lt('0.01');

      const unmatchedEntries = entries
        .filter((e: any) => e.status === 'UNMATCHED')
        .map((e: any) => e.journalEntryId);

      results.push({
        pairId: pair.id,
        entityAId: pair.entityAId,
        entityBId: pair.entityBId,
        periodYear,
        periodMonth,
        entityABalance,
        entityBBalance,
        netBalance,
        isNetZero,
        unmatchedEntries,
      });
    }

    return results;
  }
}
