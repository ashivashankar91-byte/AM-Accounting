import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher, setTenantContextOnConnection, createEvent } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/recon-client';
import {
  canAddLine, canMatch, canUnmatch, canComplete, checkConservation, isValidBookItemType, isValidStatementLineSource,
  ReconInputError, ReconSessionNotFoundError, ReconStatementLineNotFoundError, ReconBookItemNotFoundError,
  ReconSessionNotOpenError, ReconAlreadyClearedError, ReconNotClearedError,
} from '../domain/recon-session';
import { CashServiceBookItemAdapter, AparServiceBookItemAdapter } from '../infrastructure/book-item-source-adapter';

export interface CreateSessionDTO {
  tenantId: string;
  entityId: string;
  bankAccountCode: string;
  periodStart: string;
  periodEnd: string;
  statementBeginningBalance: number | string;
  statementEndingBalance: number | string;
  idempotencyKey: string;
  actor: string;
}

export interface AddStatementLineDTO {
  tenantId: string;
  sessionId: string;
  lineDate: string;
  description: string;
  amount: number | string;
  source: string;
  externalRef?: string | null;
  actor: string;
}

export interface AddManualBookItemDTO {
  tenantId: string;
  sessionId: string;
  itemType: string;
  itemDate: string;
  description: string;
  amount: number | string;
  actor: string;
}

/**
 * S054A — Manual Bank Reconciliation Workbench. One session per bank
 * account + statement period; statement lines (bank-side, manual or
 * imported) are matched/cleared against book items (book-side: payments,
 * deposits, fees, NSF, sweeps — synced from cash-service/apar-service via
 * HTTP, or entered manually). Completion is gated by a conservation check
 * (cleared book total + outstanding items = statement ending balance) and
 * is a one-way lock; no cleared line is ever deleted, only unmatched
 * beforehand.
 */
@injectable()
export class ReconSessionService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('CashServiceBookItemAdapter') private readonly cashAdapter: CashServiceBookItemAdapter,
    @inject('AparServiceBookItemAdapter') private readonly aparAdapter: AparServiceBookItemAdapter,
  ) {}

  async createSession(dto: CreateSessionDTO) {
    if (!dto.bankAccountCode) throw new ReconInputError('bankAccountCode is required');
    if (!dto.idempotencyKey) throw new ReconInputError('idempotencyKey is required');
    if (new Date(dto.periodStart) > new Date(dto.periodEnd)) throw new ReconInputError('periodStart must be on or before periodEnd');

    const prior = await (this.prisma as any).reconSession.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
    });
    if (prior) return { ...prior, idempotent: true };

    try {
      const created = await (this.prisma as any).reconSession.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, entityId: dto.entityId,
          bankAccountCode: dto.bankAccountCode,
          periodStart: new Date(dto.periodStart), periodEnd: new Date(dto.periodEnd),
          statementBeginningBalance: dto.statementBeginningBalance as any,
          statementEndingBalance: dto.statementEndingBalance as any,
          status: 'OPEN', idempotencyKey: dto.idempotencyKey, createdBy: dto.actor,
        },
      });
      await this.publishSafely('BANK_RECON_STARTED', dto.tenantId, { sessionId: created.id });
      return { ...created, idempotent: false };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const winner = await (this.prisma as any).reconSession.findUnique({
          where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
        });
        if (winner) return { ...winner, idempotent: true };
      }
      throw err;
    }
  }

  async listSessions(tenantId: string, filters: { status?: string; bankAccountCode?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const where: any = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.bankAccountCode) where.bankAccountCode = filters.bankAccountCode;
    const [items, total] = await Promise.all([
      (this.prisma as any).reconSession.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      (this.prisma as any).reconSession.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async getSession(tenantId: string, sessionId: string) {
    const session = await (this.prisma as any).reconSession.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new ReconSessionNotFoundError();
    return session;
  }

  async listStatementLines(tenantId: string, sessionId: string) {
    await this.getSession(tenantId, sessionId);
    return (this.prisma as any).reconStatementLine.findMany({ where: { sessionId, tenantId }, orderBy: { lineDate: 'asc' } });
  }

  async listBookItems(tenantId: string, sessionId: string) {
    await this.getSession(tenantId, sessionId);
    return (this.prisma as any).reconBookItem.findMany({ where: { sessionId, tenantId }, orderBy: { itemDate: 'asc' } });
  }

  /** Manual entry AND imported statement lines — both always available; the session must be OPEN. */
  async addStatementLine(dto: AddStatementLineDTO) {
    const session = await this.getSession(dto.tenantId, dto.sessionId);
    if (!canAddLine(session.status)) throw new ReconSessionNotOpenError();
    if (!isValidStatementLineSource(dto.source)) throw new ReconInputError('source must be MANUAL or IMPORTED');
    if (!dto.description) throw new ReconInputError('description is required');

    return (this.prisma as any).reconStatementLine.create({
      data: {
        id: crypto.randomUUID(), sessionId: dto.sessionId, tenantId: dto.tenantId,
        lineDate: new Date(dto.lineDate), description: dto.description, amount: dto.amount as any,
        source: dto.source, externalRef: dto.externalRef ?? null, status: 'UNMATCHED', createdBy: dto.actor,
      },
    });
  }

  async importStatementLines(dto: { tenantId: string; sessionId: string; actor: string; lines: Array<{ lineDate: string; description: string; amount: number | string; externalRef?: string | null }> }) {
    const session = await this.getSession(dto.tenantId, dto.sessionId);
    if (!canAddLine(session.status)) throw new ReconSessionNotOpenError();
    if (!dto.lines?.length) throw new ReconInputError('lines must be a non-empty array');

    const created = [];
    for (const line of dto.lines) {
      created.push(await (this.prisma as any).reconStatementLine.create({
        data: {
          id: crypto.randomUUID(), sessionId: dto.sessionId, tenantId: dto.tenantId,
          lineDate: new Date(line.lineDate), description: line.description, amount: line.amount as any,
          source: 'IMPORTED', externalRef: line.externalRef ?? null, status: 'UNMATCHED', createdBy: dto.actor,
        },
      }));
    }
    return { imported: created.length, lines: created };
  }

  /** NSF entries (and anything else with no source-service model) are always manually entered — never fabricated as "synced". */
  async addManualBookItem(dto: AddManualBookItemDTO) {
    const session = await this.getSession(dto.tenantId, dto.sessionId);
    if (!canAddLine(session.status)) throw new ReconSessionNotOpenError();
    if (!isValidBookItemType(dto.itemType)) throw new ReconInputError('itemType must be one of PAYMENT, DEPOSIT, FEE, NSF, SWEEP');
    if (!dto.description) throw new ReconInputError('description is required');

    return (this.prisma as any).reconBookItem.create({
      data: {
        id: crypto.randomUUID(), sessionId: dto.sessionId, tenantId: dto.tenantId,
        itemType: dto.itemType, sourceService: 'MANUAL', sourceId: null,
        itemDate: new Date(dto.itemDate), description: dto.description, amount: dto.amount as any,
        status: 'OUTSTANDING', createdBy: dto.actor,
      },
    });
  }

  /**
   * Pulls deposits/sweeps/settlement-fees from cash-service and payments
   * from apar-service, creating recon_book_item rows idempotently (unique
   * on session+sourceService+sourceId — a P2002 on re-sync is swallowed as
   * "already synced", never duplicated). Each category degrades
   * independently and truthfully (PENDING_SERVICE_INTEGRATION) if its
   * source service is unreachable — never a fabricated/guessed item.
   */
  async syncBookItems(tenantId: string, sessionId: string, actor: string) {
    const session = await this.getSession(tenantId, sessionId);
    if (!canAddLine(session.status)) throw new ReconSessionNotOpenError();

    const [deposits, sweeps, fees, payments] = await Promise.all([
      this.cashAdapter.syncDeposits(tenantId),
      this.cashAdapter.syncSweeps(tenantId),
      this.cashAdapter.syncSettlementFees(tenantId),
      this.aparAdapter.syncPayments(tenantId),
    ]);

    const results: Record<string, { state: string; note: string; created: number }> = {};
    for (const [sourceService, group] of [
      ['CASH_SERVICE_DEPOSITS', deposits],
      ['CASH_SERVICE_SWEEPS', sweeps],
      ['CASH_SERVICE_FEES', fees],
      ['APAR_SERVICE_PAYMENTS', payments],
    ] as const) {
      let created = 0;
      if (group.state === 'OK') {
        for (const item of group.items) {
          try {
            await (this.prisma as any).reconBookItem.create({
              data: {
                id: crypto.randomUUID(), sessionId, tenantId,
                itemType: item.itemType,
                sourceService: sourceService.startsWith('CASH') ? 'CASH_SERVICE' : 'APAR_SERVICE',
                sourceId: item.sourceId, itemDate: new Date(item.itemDate),
                description: item.description, amount: item.amount as any,
                status: 'OUTSTANDING', createdBy: actor,
              },
            });
            created += 1;
          } catch (err: any) {
            if (err?.code !== 'P2002') throw err; // already synced — idempotent no-op
          }
        }
      }
      results[sourceService] = { state: group.state, note: group.note, created };
    }
    return results;
  }

  /**
   * Matches (clears) a statement line against a book item. Both flip to
   * CLEARED and reference each other; neither row is ever deleted. Rejects
   * if either side is already CLEARED, or if the session is not OPEN.
   * `ruleId` is stamped on both rows when this match was produced by
   * auto-match (S054B) — manual matches (UI-driven, S054A) leave it null.
   */
  async matchLine(dto: { tenantId: string; sessionId: string; statementLineId: string; bookItemId: string; actor: string; ruleId?: string | null }) {
    const session = await this.getSession(dto.tenantId, dto.sessionId);
    if (!canMatch(session.status)) throw new ReconSessionNotOpenError();

    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, dto.tenantId);
      const line = await tx.reconStatementLine.findFirst({ where: { id: dto.statementLineId, sessionId: dto.sessionId, tenantId: dto.tenantId } });
      if (!line) throw new ReconStatementLineNotFoundError();
      const item = await tx.reconBookItem.findFirst({ where: { id: dto.bookItemId, sessionId: dto.sessionId, tenantId: dto.tenantId } });
      if (!item) throw new ReconBookItemNotFoundError();
      if (line.status === 'CLEARED' || item.status === 'CLEARED') throw new ReconAlreadyClearedError();

      const now = new Date();
      await tx.reconStatementLine.update({
        where: { id: line.id },
        data: { status: 'CLEARED', clearedBookItemId: item.id, clearedBy: dto.actor, clearedAt: now, matchRuleId: dto.ruleId ?? null, version: { increment: 1 } },
      });
      await tx.reconBookItem.update({
        where: { id: item.id },
        data: { status: 'CLEARED', clearedStatementLineId: line.id, clearedBy: dto.actor, clearedAt: now, matchRuleId: dto.ruleId ?? null, version: { increment: 1 } },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'RECON_MATCH',
          docId: `${line.id}:${item.id}`, action: dto.ruleId ? 'RECON_LINE_AUTO_MATCHED' : 'RECON_LINE_MATCHED',
          before: { statementLineStatus: 'UNMATCHED', bookItemStatus: 'OUTSTANDING' } as any,
          after: { statementLineStatus: 'CLEARED', bookItemStatus: 'CLEARED', ruleId: dto.ruleId ?? null } as any, actor: dto.actor,
        },
      });
      return {
        statementLine: await tx.reconStatementLine.findFirst({ where: { id: line.id } }),
        bookItem: await tx.reconBookItem.findFirst({ where: { id: item.id } }),
      };
    });
  }

  /**
   * Reverts a match before completion — never deletes either row, only
   * reverts status back to UNMATCHED/OUTSTANDING and clears the
   * cross-references. Refused once the session is COMPLETED.
   */
  async unmatchLine(dto: { tenantId: string; sessionId: string; statementLineId: string; reason: string; actor: string }) {
    const session = await this.getSession(dto.tenantId, dto.sessionId);
    if (!canUnmatch(session.status)) throw new ReconSessionNotOpenError();

    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, dto.tenantId);
      const line = await tx.reconStatementLine.findFirst({ where: { id: dto.statementLineId, sessionId: dto.sessionId, tenantId: dto.tenantId } });
      if (!line) throw new ReconStatementLineNotFoundError();
      if (line.status !== 'CLEARED') throw new ReconNotClearedError();

      const bookItemId = line.clearedBookItemId;
      await tx.reconStatementLine.update({
        where: { id: line.id },
        data: { status: 'UNMATCHED', clearedBookItemId: null, clearedBy: null, clearedAt: null, matchRuleId: null, version: { increment: 1 } },
      });
      if (bookItemId) {
        await tx.reconBookItem.update({
          where: { id: bookItemId },
          data: { status: 'OUTSTANDING', clearedStatementLineId: null, clearedBy: null, clearedAt: null, matchRuleId: null, version: { increment: 1 } },
        });
      }
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'RECON_MATCH',
          docId: `${line.id}:${bookItemId ?? 'none'}`, action: 'RECON_LINE_UNMATCHED',
          before: { statementLineStatus: 'CLEARED', bookItemStatus: 'CLEARED' } as any,
          after: { statementLineStatus: 'UNMATCHED', bookItemStatus: 'OUTSTANDING', reason: dto.reason } as any, actor: dto.actor,
        },
      });
      return tx.reconStatementLine.findFirst({ where: { id: line.id } });
    });
  }

  /**
   * BR: idempotent, gated by the conservation check. Completion is REFUSED
   * (ReconOutOfBalanceError) when cleared book total + outstanding items !=
   * statement ending balance — never forced through. Once COMPLETED, no
   * cleared line may ever be unmatched or deleted (canUnmatch/canMatch
   * both require OPEN).
   */
  async completeSession(tenantId: string, sessionId: string, actor: string) {
    const session = await this.getSession(tenantId, sessionId);
    if (session.status === 'COMPLETED') return { ...session, idempotent: true };
    if (!canComplete(session.status)) throw new ReconSessionNotOpenError();

    const bookItems = await (this.prisma as any).reconBookItem.findMany({ where: { sessionId, tenantId } });
    const clearedTotals = bookItems.filter((i: any) => i.status === 'CLEARED').map((i: any) => i.amount.toString());
    const outstandingTotals = bookItems.filter((i: any) => i.status === 'OUTSTANDING').map((i: any) => i.amount.toString());
    checkConservation(clearedTotals, outstandingTotals, session.statementEndingBalance.toString());

    const updated = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.reconSession.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED', completedBy: actor, completedAt: new Date(), version: { increment: 1 } },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId, docType: 'RECON_SESSION', docId: sessionId,
          action: 'RECON_SESSION_COMPLETED', before: { status: 'OPEN' } as any,
          after: { status: 'COMPLETED' } as any, actor,
        },
      });
      return tx.reconSession.findFirst({ where: { id: sessionId } });
    });

    await this.publishSafely('BANK_RECON_COMPLETED', tenantId, { sessionId });
    return { ...updated, idempotent: false };
  }

  private async publishSafely(type: 'BANK_RECON_STARTED' | 'BANK_RECON_COMPLETED', tenantId: string, payload: Record<string, unknown>) {
    try {
      await this.events.publish(createEvent(type, tenantId, payload));
    } catch {
      /* best-effort; audit_outbox row (for completion) already durable */
    }
  }
}
