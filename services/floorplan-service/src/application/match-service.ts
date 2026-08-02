// S080 — Floorplan VIN Match & Breaks. Matches a staged lender row (S079)
// to this service's OWN floorplan liability item, keyed self-sufficiently
// by VIN/stock# (applyNumber). Does NOT call vehicle-accounting-service
// synchronously to confirm a VIN is a "real" unit —
// PENDING_UPSTREAM_TECHNICAL_RECONCILIATION: vehicle-accounting-service
// (S074) is a sibling CE-12 service not guaranteed to exist/be reachable at
// match time. The expected future contract, once available, is a read API
// (e.g. GET /vehicle-accounting/v1/units/by-vin/:vin) this service would
// call to enrich/validate the match — until then, any VIN/stock# is treated
// as PENDING_UPSTREAM_TECHNICAL_RECONCILIATION-eligible and matching
// proceeds purely on this service's own ledger.
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { withSerializableRetry } from '../lib/serializable-retry';
import { appendAuditReference } from '../infrastructure/audit';
import { buildEnvelope } from '../domain/envelope';
import { EVENT_TYPES, EVENT_SCHEMA_VERSION } from '../domain/event-types';
import { classifyStagedRow, findWeHaveLenderDoesntBreaks } from '../domain/matching';
import { PostingOrchestrator } from './posting-orchestrator';
import {
  FloorplanNotFoundError,
  FloorplanValidationError,
  RowNotEligibleForPostingError,
} from '../domain/errors';

export interface MatchRowResult {
  outcome: 'MATCHED' | 'BREAK_DETECTED' | 'ALREADY_PROCESSED';
  matchId?: string;
  breakId?: string;
  status?: string;
  journalNumber?: string | null;
  failureReason?: string | null;
}

@injectable()
export class MatchService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject(PostingOrchestrator) private readonly postingOrchestrator: PostingOrchestrator,
  ) {}

  private applyNumberOf(row: { vin: string | null; stockNumber: string | null }): string {
    const v = row.vin?.trim();
    if (v) return v;
    const s = row.stockNumber?.trim();
    if (s) return s;
    throw new FloorplanValidationError('Staged row has neither vin nor stockNumber — cannot derive an applyNumber.');
  }

  /**
   * S080 — matches one staged row. Idempotent on the row's own identity: a
   * second call for the same stagedRowId always returns the SAME outcome
   * (fetched from this service's own DB), never re-posts and never creates
   * a second FloorplanMatch/FloorplanBreak row — enforced by the DB unique
   * constraints on floorplan_match.staged_row_id / floorplan_break.staged_row_id,
   * not merely an application-level check (races are caught via P2002).
   */
  async matchRow(tenantId: string, stagedRowId: string, actor: string): Promise<MatchRowResult> {
    const row = await this.prisma.floorplanStagedRow.findFirst({ where: { tenantId, id: stagedRowId } });
    if (!row) throw new FloorplanNotFoundError(`No staged row ${stagedRowId}.`);

    if (row.status !== 'STAGED') {
      const existingMatch = await this.prisma.floorplanMatch.findUnique({ where: { stagedRowId } });
      if (existingMatch) {
        return { outcome: 'ALREADY_PROCESSED', matchId: existingMatch.id, status: existingMatch.status, journalNumber: existingMatch.journalNumber, failureReason: existingMatch.failureReason };
      }
      const existingBreak = await this.prisma.floorplanBreak.findUnique({ where: { stagedRowId } });
      if (existingBreak) {
        return { outcome: 'ALREADY_PROCESSED', breakId: existingBreak.id, status: existingBreak.status };
      }
      throw new RowNotEligibleForPostingError(stagedRowId, row.status);
    }

    const applyNumber = this.applyNumberOf(row);
    const existingItem = await this.prisma.floorplanLiabilityItem.findUnique({
      where: { tenantId_lenderCode_applyNumber: { tenantId, lenderCode: row.lenderCode, applyNumber } },
    });

    const classification = classifyStagedRow(
      { rowType: row.rowType, amount: row.amount.toString() },
      existingItem ? { status: existingItem.status, remainingBalance: existingItem.remainingBalance.toString() } : null,
    );

    if (classification.kind === 'BREAK_LENDER_HAS_WE_DONT' || classification.kind === 'BREAK_AMOUNT_VARIANCE') {
      return this.recordBreak(tenantId, row, existingItem, classification, actor);
    }

    // MATCH_ADVANCE / MATCH_PAYOFF — post through coa-service, then
    // atomically record the local liability-item + match state.
    const eventType = classification.kind === 'MATCH_ADVANCE' ? EVENT_TYPES.ADVANCE_MATCHED : EVENT_TYPES.PAYOFF_MATCHED;
    const businessDate = row.statementDate.toISOString().slice(0, 10);
    const envelope = buildEnvelope(tenantId, {
      eventType,
      eventSchemaVersion: EVENT_SCHEMA_VERSION,
      sourceEntityType: 'FLOORPLAN_STAGED_ROW',
      sourceEntityId: row.id,
      correlationId: row.id,
      businessDate,
      occurredAt: `${businessDate}T00:00:00.000Z`,
      deterministicEventId: row.id,
      payload: {
        lenderCode: row.lenderCode,
        applyNumber,
        vin: row.vin,
        stockNumber: row.stockNumber,
        amount: row.amount.toString(),
        stagedRowId: row.id,
      },
    });

    const { submitResult, deadLetterId, recoveryReportError } = await this.postingOrchestrator.postAndRecover(envelope, {
      postingIdempotencyKey: `${tenantId}:${envelope.eventId}`,
      sourceTransactionId: row.referenceNumber ?? undefined,
    });

    const matchType = classification.kind === 'MATCH_ADVANCE' ? 'ADVANCE' : 'PAYOFF';
    const matchStatus = submitResult.status === 'POSTED' ? 'POSTED' : submitResult.status === 'NO_RULE_MATCH' ? 'REJECTED' : submitResult.status;

    const result = await withSerializableRetry(this.prisma, async (tx: any) => {
      // CE-12 gap-close fix: an interactive $transaction is pinned to its
      // OWN dedicated connection, separate from whichever pooled
      // connection the RLS middleware's app.current_tenant_id SET most
      // recently landed on (see createTenantRlsMiddleware's doc comment,
      // @amacc/shared-kernel) — every write inside here 42501s under a
      // real forced-RLS, non-BYPASSRLS role otherwise. Must be the FIRST
      // statement, exactly like schedule-service's OpenItemService does.
      await setTenantContextOnConnection(tx, tenantId);
      // Re-check under the transaction: a concurrent call may have already
      // completed this row.
      const fresh = await tx.floorplanStagedRow.findFirst({ where: { tenantId, id: stagedRowId } });
      if (fresh.status !== 'STAGED') {
        const already = await tx.floorplanMatch.findUnique({ where: { stagedRowId } });
        return { alreadyProcessed: true, match: already };
      }

      let item = existingItem
        ? await tx.floorplanLiabilityItem.findUnique({ where: { id: existingItem.id } })
        : null;

      // Liability item balances (and the application ledger row) ONLY move
      // when coa-service actually POSTED the journal — never on REJECTED/
      // FAILED/NO_RULE_MATCH (the overwhelmingly common case until real GL
      // accounts are mapped over ACCOUNT_MAPPING_VALUES_PENDING). This keeps
      // the S080 tie-out AC honest: our own liability-item ledger can never
      // show a dollar of exposure that has no corresponding real posted
      // journal. A rejected match is still fully recorded (FloorplanMatch
      // row + posting-recovery dead-letter) so it is visible/actionable,
      // just without moving money that was never actually posted.
      if (submitResult.status === 'POSTED') {
        if (matchType === 'ADVANCE') {
          if (item) {
            item = await tx.floorplanLiabilityItem.update({
              where: { id: item.id },
              data: {
                originalAmount: { increment: row.amount },
                remainingBalance: { increment: row.amount },
                status: 'OPEN',
                relievedAt: null,
              },
            });
          } else {
            item = await tx.floorplanLiabilityItem.create({
              data: {
                id: randomUUID(),
                tenantId,
                lenderCode: row.lenderCode,
                vin: row.vin,
                stockNumber: row.stockNumber,
                applyNumber,
                originalAmount: row.amount,
                remainingBalance: row.amount,
                status: 'OPEN',
              },
            });
          }
        } else {
          // PAYOFF — item is guaranteed non-null by classifyStagedRow's contract.
          const newRemaining = Number(item.remainingBalance) - Number(row.amount);
          item = await tx.floorplanLiabilityItem.update({
            where: { id: item.id },
            data: {
              remainingBalance: newRemaining.toFixed(2),
              status: newRemaining <= 0 ? 'RELIEVED' : 'PARTIALLY_RELIEVED',
              relievedAt: newRemaining <= 0 ? new Date() : null,
            },
          });
        }
      }

      const match = await tx.floorplanMatch.create({
        data: {
          id: randomUUID(),
          tenantId,
          stagedRowId: row.id,
          itemId: item?.id ?? null,
          matchType,
          idempotencyKey: `${tenantId}:${envelope.eventId}`,
          status: matchStatus,
          postingExecutionId: submitResult.executionId,
          journalEntryId: submitResult.journalEntryId,
          journalNumber: submitResult.journalNumber,
          failureReason: submitResult.failureReason,
          matchedBy: actor,
        },
      });

      if (submitResult.status === 'POSTED') {
        await tx.floorplanLiabilityApplication.create({
          data: {
            id: randomUUID(),
            tenantId,
            itemId: item.id,
            applicationType: matchType,
            amount: matchType === 'ADVANCE' ? row.amount : `-${row.amount}`,
            matchId: match.id,
            postingExecutionId: submitResult.executionId,
            journalEntryId: submitResult.journalEntryId,
            journalNumber: submitResult.journalNumber,
          },
        });
      }

      // Row status reflects that VIN correlation succeeded (it IS matched
      // to a liability item/lifecycle event) regardless of whether the
      // posting itself succeeded — posting failures surface via
      // match.status + the posting-recovery dead-letter, not by leaving the
      // row perpetually STAGED (which would make it eligible for a second,
      // duplicate match attempt).
      await tx.floorplanStagedRow.update({ where: { id: row.id }, data: { status: 'MATCHED' } });

      return { alreadyProcessed: false, match };
    }).catch(async (err: any) => {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.floorplanMatch.findUnique({ where: { stagedRowId } });
        if (winner) return { alreadyProcessed: true, match: winner };
      }
      throw err;
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_MATCH',
      entityId: result.match.id,
      eventType: 'floorplan.match.executed',
      actor,
      after: { stagedRowId: row.id, matchType, status: result.match.status, journalNumber: result.match.journalNumber, deadLetterId, recoveryReportError },
    });

    return {
      outcome: result.alreadyProcessed ? 'ALREADY_PROCESSED' : 'MATCHED',
      matchId: result.match.id,
      status: result.match.status,
      journalNumber: result.match.journalNumber,
      failureReason: result.match.failureReason,
    };
  }

  private async recordBreak(
    tenantId: string,
    row: any,
    existingItem: any,
    classification: { kind: 'BREAK_LENDER_HAS_WE_DONT' } | { kind: 'BREAK_AMOUNT_VARIANCE'; varianceAmount: string },
    actor: string,
  ): Promise<MatchRowResult> {
    const result = await withSerializableRetry(this.prisma, async (tx: any) => {
      // CE-12 gap-close fix — see recordBreak's sibling call above for why.
      await setTenantContextOnConnection(tx, tenantId);
      const fresh = await tx.floorplanStagedRow.findFirst({ where: { tenantId, id: row.id } });
      if (fresh.status !== 'STAGED') {
        const already = await tx.floorplanBreak.findUnique({ where: { stagedRowId: row.id } });
        return { alreadyProcessed: true, brk: already };
      }
      const brk = await tx.floorplanBreak.create({
        data: {
          id: randomUUID(),
          tenantId,
          breakType: classification.kind === 'BREAK_LENDER_HAS_WE_DONT' ? 'LENDER_HAS_WE_DONT' : 'AMOUNT_VARIANCE',
          stagedRowId: row.id,
          itemId: existingItem?.id ?? null,
          vin: row.vin,
          stockNumber: row.stockNumber,
          lenderAmount: row.amount,
          ourAmount: existingItem?.remainingBalance ?? null,
          varianceAmount: classification.kind === 'BREAK_AMOUNT_VARIANCE' ? classification.varianceAmount : null,
          status: 'OPEN',
        },
      });
      await tx.floorplanStagedRow.update({ where: { id: row.id }, data: { status: 'BREAK' } });
      return { alreadyProcessed: false, brk };
    }).catch(async (err: any) => {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.floorplanBreak.findUnique({ where: { stagedRowId: row.id } });
        if (winner) return { alreadyProcessed: true, brk: winner };
      }
      throw err;
    });

    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_BREAK',
      entityId: result.brk.id,
      eventType: 'floorplan.break.detected',
      actor,
      after: { stagedRowId: row.id, breakType: result.brk.breakType },
    });

    return { outcome: result.alreadyProcessed ? 'ALREADY_PROCESSED' : 'BREAK_DETECTED', breakId: result.brk.id, status: result.brk.status };
  }

  /** S080 break worklist, "we-have/lender-doesn't" category — computed
   * on-demand against the latest import batch per lender (pure set
   * comparison, see domain/matching.ts), and persisted as OPEN
   * FloorplanBreak rows (idempotent: skips a lenderCode/applyNumber pair
   * that already has an OPEN break of this type). */
  async scanForWeHaveLenderDoesntBreaks(tenantId: string, lenderCode: string, actor: string): Promise<{ created: number }> {
    const latestBatch = await this.prisma.floorplanImportBatch.findFirst({
      where: { tenantId, lenderCode },
      orderBy: { importedAt: 'desc' },
    });
    if (!latestBatch) return { created: 0 };

    const rowsInBatch = await this.prisma.floorplanStagedRow.findMany({ where: { tenantId, importBatchId: latestBatch.id } });
    const lenderApplyNumbers = new Set(rowsInBatch.map((r: any) => (r.vin?.trim() || r.stockNumber?.trim())).filter(Boolean));

    const ourOpenItems = await this.prisma.floorplanLiabilityItem.findMany({
      where: { tenantId, lenderCode, status: { in: ['OPEN', 'PARTIALLY_RELIEVED'] } },
    });
    const missing = findWeHaveLenderDoesntBreaks(
      ourOpenItems.map((i: any) => ({ applyNumber: i.applyNumber, vin: i.vin, stockNumber: i.stockNumber })),
      lenderApplyNumbers as Set<string>,
    );

    let created = 0;
    for (const m of missing) {
      const item = ourOpenItems.find((i: any) => i.applyNumber === m.applyNumber);
      const existingOpenBreak = await this.prisma.floorplanBreak.findFirst({
        where: { tenantId, itemId: item.id, breakType: 'WE_HAVE_LENDER_DOESNT', status: 'OPEN' },
      });
      if (existingOpenBreak) continue;
      await this.prisma.floorplanBreak.create({
        data: {
          id: randomUUID(),
          tenantId,
          breakType: 'WE_HAVE_LENDER_DOESNT',
          stagedRowId: null,
          itemId: item.id,
          vin: item.vin,
          stockNumber: item.stockNumber,
          lenderAmount: null,
          ourAmount: item.remainingBalance,
          varianceAmount: null,
          status: 'OPEN',
        },
      });
      created++;
    }

    if (created > 0) {
      await appendAuditReference(this.prisma, {
        tenantId,
        entityType: 'FLOORPLAN_BREAK',
        entityId: null,
        eventType: 'floorplan.break.we_have_lender_doesnt_scan',
        actor,
        after: { lenderCode, batchId: latestBatch.id, created },
      });
    }
    return { created };
  }

  async listMatches(tenantId: string, filters: { status?: string } = {}) {
    return this.prisma.floorplanMatch.findMany({ where: { tenantId, ...(filters.status ? { status: filters.status } : {}) }, orderBy: { matchedAt: 'desc' } });
  }

  async listLiabilityItems(tenantId: string, filters: { status?: string; lenderCode?: string } = {}) {
    return this.prisma.floorplanLiabilityItem.findMany({
      where: { tenantId, ...(filters.status ? { status: filters.status } : {}), ...(filters.lenderCode ? { lenderCode: filters.lenderCode } : {}) },
      orderBy: { openedAt: 'desc' },
    });
  }

  async getLiabilityItem(tenantId: string, itemId: string) {
    const item = await this.prisma.floorplanLiabilityItem.findFirst({ where: { tenantId, id: itemId }, include: { applications: true } });
    if (!item) throw new FloorplanNotFoundError(`No liability item ${itemId}.`);
    return item;
  }
}
