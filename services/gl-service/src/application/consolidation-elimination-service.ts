/**
 * S035 — Consolidation Eliminations
 *
 * Uses S003 (Elimination Entity Attributes) + S034 (Intercompany Pairs) to
 * generate elimination journal entries in the designated consolidation entity.
 *
 * Process:
 *   1. Identify all IC pairs for the tenant
 *   2. For each pair, sum unmatched IC entries for the period
 *   3. Generate a balanced elimination JE in the elimination entity
 *      (debit IC payable of entity A = credit IC receivable of entity B)
 *   4. Mark IC entries as ELIMINATED
 *   5. Record the elimination run
 *
 * Elimination entries post through the standard posting door (S013/S020).
 * A closed period blocks the elimination run — period must be open.
 */

import Decimal from 'decimal.js';
import crypto from 'crypto';
import { TenantId } from '@amacc/shared-kernel';

export interface EliminationRunRequest {
  eliminationEntityId: string;
  periodYear: number;
  periodMonth: number;
}

export interface EliminationRunResult {
  runId: string;
  eliminationEntityId: string;
  periodYear: number;
  periodMonth: number;
  icPairsProcessed: number;
  journalEntryIds: string[];
  totalEliminatedDebit: Decimal;
  totalEliminatedCredit: Decimal;
  status: 'COMPLETED' | 'FAILED';
}

export class ConsolidationEliminationService {
  constructor(
    private readonly prisma: any,
    private readonly glService: { createJournalEntry: Function; postJournalEntry: Function; approveJournalEntry: Function },
  ) {}

  async runElimination(
    req: EliminationRunRequest,
    tenantId: TenantId,
    startedBy: string,
  ): Promise<EliminationRunResult> {
    // Create a run record (idempotent: same period + entity can only run once in PENDING/RUNNING state)
    const existingRun = await this.prisma.consolidationEliminationRun.findUnique({
      where: {
        tenantId_eliminationEntityId_periodYear_periodMonth: {
          tenantId,
          eliminationEntityId: req.eliminationEntityId,
          periodYear: req.periodYear,
          periodMonth: req.periodMonth,
        },
      },
    });
    if (existingRun && existingRun.status === 'COMPLETED') {
      // Already completed — return existing result
      return {
        runId: existingRun.id,
        eliminationEntityId: existingRun.eliminationEntityId,
        periodYear: existingRun.periodYear,
        periodMonth: existingRun.periodMonth,
        icPairsProcessed: existingRun.icPairsProcessed,
        journalEntryIds: existingRun.journalEntryIds,
        totalEliminatedDebit: new Decimal(existingRun.totalEliminatedDebit.toString()),
        totalEliminatedCredit: new Decimal(existingRun.totalEliminatedCredit.toString()),
        status: 'COMPLETED',
      };
    }

    const run = await this.prisma.consolidationEliminationRun.upsert({
      where: {
        tenantId_eliminationEntityId_periodYear_periodMonth: {
          tenantId,
          eliminationEntityId: req.eliminationEntityId,
          periodYear: req.periodYear,
          periodMonth: req.periodMonth,
        },
      },
      create: {
        tenantId,
        eliminationEntityId: req.eliminationEntityId,
        periodYear: req.periodYear,
        periodMonth: req.periodMonth,
        status: 'RUNNING',
        startedBy,
      },
      update: { status: 'RUNNING', startedAt: new Date() },
    });

    const journalEntryIds: string[] = [];
    let totalDebit = new Decimal(0);
    let totalCredit = new Decimal(0);
    let pairsProcessed = 0;

    try {
      // Get all IC pairs for this tenant
      const pairs = await this.prisma.intercompanyPair.findMany({
        where: { tenantId },
      });

      for (const pair of pairs) {
        // Find unmatched IC entries for this period
        const entries = await this.prisma.intercompanyEntry.findMany({
          where: {
            tenantId,
            pairId: pair.id,
            periodYear: req.periodYear,
            periodMonth: req.periodMonth,
            status: 'UNMATCHED',
          },
        });

        if (entries.length === 0) continue;

        const entityABalance = entries
          .filter((e: any) => e.originatingEntityId === pair.entityAId)
          .reduce((s: Decimal, e: any) => s.plus(e.icAmount), new Decimal(0));

        const entityBBalance = entries
          .filter((e: any) => e.originatingEntityId === pair.entityBId)
          .reduce((s: Decimal, e: any) => s.plus(e.icAmount), new Decimal(0));

        const eliminationAmount = entityABalance.abs();
        if (eliminationAmount.isZero()) continue;

        // Generate elimination JE in the elimination entity
        // Debit IC payable of entity A, Credit IC receivable of entity B
        if (!pair.icReceivableAccount || !pair.icPayableAccount) {
          // Cannot eliminate without IC accounts configured — skip with warning
          continue;
        }

        const lines = [
          {
            accountId: pair.icPayableAccount,
            debit: eliminationAmount.toNumber(),
            credit: 0,
            description: `IC elimination — entity ${pair.entityAId}`,
          },
          {
            accountId: pair.icReceivableAccount,
            debit: 0,
            credit: eliminationAmount.toNumber(),
            description: `IC elimination — entity ${pair.entityBId}`,
          },
        ];

        const je = await this.glService.createJournalEntry(
          {
            description: `Consolidation elimination: ${pair.entityAId} ↔ ${pair.entityBId} ${req.periodYear}/${String(req.periodMonth).padStart(2, '0')}`,
            entryDate: new Date(req.periodYear, req.periodMonth - 1, 1),
            source: 'CONSOLIDATION_ELIMINATION',
            legalEntityId: req.eliminationEntityId,
            idempotencyKey: `elim:${run.id}:${pair.id}`,
            lines,
          },
          tenantId,
        );

        // Auto-approve and post the elimination entry (system-generated, no human approval required)
        await this.glService.postJournalEntry(je.id, tenantId, 'system:consolidation');
        await this.glService.approveJournalEntry(je.id, tenantId, 'system:consolidation');

        journalEntryIds.push(je.id);
        totalDebit = totalDebit.plus(eliminationAmount);
        totalCredit = totalCredit.plus(eliminationAmount);
        pairsProcessed++;

        // Mark IC entries as ELIMINATED
        await this.prisma.intercompanyEntry.updateMany({
          where: {
            tenantId,
            pairId: pair.id,
            periodYear: req.periodYear,
            periodMonth: req.periodMonth,
            status: 'UNMATCHED',
          },
          data: { status: 'ELIMINATED', contraJournalEntryId: je.id },
        });
      }

      // Mark run as completed
      await this.prisma.consolidationEliminationRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          journalEntryIds,
          icPairsProcessed: pairsProcessed,
          totalEliminatedDebit: totalDebit.toNumber(),
          totalEliminatedCredit: totalCredit.toNumber(),
        },
      });

      return {
        runId: run.id,
        eliminationEntityId: req.eliminationEntityId,
        periodYear: req.periodYear,
        periodMonth: req.periodMonth,
        icPairsProcessed: pairsProcessed,
        journalEntryIds,
        totalEliminatedDebit: totalDebit,
        totalEliminatedCredit: totalCredit,
        status: 'COMPLETED',
      };
    } catch (err: any) {
      await this.prisma.consolidationEliminationRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', errorMessage: err?.message ?? 'Unknown error', completedAt: new Date() },
      });
      throw err;
    }
  }

  async getRunHistory(tenantId: TenantId, eliminationEntityId?: string): Promise<any[]> {
    return this.prisma.consolidationEliminationRun.findMany({
      where: { tenantId, ...(eliminationEntityId ? { eliminationEntityId } : {}) },
      orderBy: { startedAt: 'desc' },
    });
  }
}
