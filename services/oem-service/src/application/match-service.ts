import { injectable, inject } from 'tsyringe';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAudit } from '../infrastructure/audit';
import { withIdempotency } from '../infrastructure/idempotency';
import { OemNotFoundError, OemValidationError } from '../domain/errors';
import type { OpenItemSource, OemOpenItemTypeKey } from '../domain/upstream-items';

const CANONICAL_TO_OPEN_ITEM_TYPE: Record<string, OemOpenItemTypeKey> = {
  RECEIVABLE_REMITTANCE: 'WARRANTY_CLAIM',
  PARTS_RETURN_CREDIT: 'PARTS_RETURN_CREDIT',
  INCENTIVE_LINE: 'INCENTIVE_ACCRUAL',
  COOP_LINE: 'COOP_CLAIM',
};

function itemRefFromRow(openItemType: OemOpenItemTypeKey, ref: string): string {
  switch (openItemType) {
    case 'WARRANTY_CLAIM': return `CLAIM-${ref}`;
    case 'PARTS_RETURN_CREDIT': return `RETURN-${ref}`;
    default: return ref;
  }
}

/**
 * S101A — Manual OEM Statement Match Workbench. Session-scoped, one row per
 * matchable staged row (UNPARSED rows are excluded — they surface in the
 * S098 staging browser, not here). Completion requires every row
 * dispositioned (package AC: "100%-disposition gate").
 */
@injectable()
export class OemMatchService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('OpenItemSource') private readonly openItems: OpenItemSource,
  ) {}

  async createSession(tenantId: string, storeId: string, statementDocumentId: string, actor: string) {
    const document = await this.prisma.oemStagedDocument.findFirst({
      where: { tenantId, id: statementDocumentId },
      include: { rows: true },
    });
    if (!document) throw new OemNotFoundError('OemStagedDocument', statementDocumentId);

    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const session = await tx.oemMatchSession.create({
        data: { tenantId, storeId, statementDocumentId, status: 'OPEN', openedBy: actor },
      });

      const matchableRows = document.rows.filter((r: any) => r.parseStatus === 'PARSED' && r.canonicalType);
      for (const row of matchableRows) {
        const openItemType = CANONICAL_TO_OPEN_ITEM_TYPE[row.canonicalType] ?? null;
        const ref = String((row.fields as any)?.ref ?? '');
        const openItemRef = openItemType ? itemRefFromRow(openItemType, ref) : null;
        await tx.oemMatchSessionRow.create({
          data: {
            tenantId, sessionId: session.id, stagedRowId: row.id,
            openItemType, openItemRef,
            statementAmount: (row.fields as any)?.amount ?? '0',
          },
        });
      }

      await appendAudit(tx, {
        tenantId, docType: 'OemMatchSession', docId: session.id,
        action: 'MATCH_SESSION_OPENED', actor, after: { sessionId: session.id, rowCount: matchableRows.length },
      });

      return tx.oemMatchSession.findFirst({ where: { id: session.id }, include: { rows: true } });
    });
  }

  async getSession(tenantId: string, id: string) {
    const session = await this.prisma.oemMatchSession.findFirst({ where: { tenantId, id }, include: { rows: true } });
    if (!session) throw new OemNotFoundError('OemMatchSession', id);
    return session;
  }

  async listSessions(tenantId: string, storeId?: string) {
    return this.prisma.oemMatchSession.findMany({
      where: { tenantId, ...(storeId ? { storeId } : {}) },
      orderBy: { openedAt: 'desc' },
    });
  }

  /**
   * Disposition one row. MATCHED: exact match, appliedAmount = statement
   * amount, relieves the item (CE-09 receipt-path posting is
   * PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — see domain/upstream-
   * items.ts — this records the relief in oem-service's own ledger of
   * record, the GL posting itself is a separate, not-yet-wired step).
   * SHORT_PAY conserves: appliedAmount + writeDownAmount === openAmount.
   * DISPUTED/INVESTIGATION post nothing.
   */
  async disposeRow(
    tenantId: string,
    sessionId: string,
    rowId: string,
    disposition: 'MATCHED' | 'SHORT_PAY' | 'DISPUTED' | 'INVESTIGATION',
    actor: string,
    note?: string,
  ) {
    const session = await this.prisma.oemMatchSession.findFirst({ where: { tenantId, id: sessionId } });
    if (!session) throw new OemNotFoundError('OemMatchSession', sessionId);
    if (session.status !== 'OPEN') throw new OemValidationError('SESSION_NOT_OPEN', 'session is not open');

    const row = await this.prisma.oemMatchSessionRow.findFirst({ where: { tenantId, id: rowId, sessionId } });
    if (!row) throw new OemNotFoundError('OemMatchSessionRow', rowId);

    const idempotencyKey = `match-row-dispose:${rowId}`;
    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      return withIdempotency(tx, tenantId, 'MATCH_ROW_DISPOSE', idempotencyKey, async () => {
        let appliedAmount: string | null = null;
        let writeDownAmount: string | null = null;
        let applyNumber: string | null = null;

        if (disposition === 'MATCHED' || disposition === 'SHORT_PAY') {
          const openItem = row.openItemRef
            ? await this.openItems.findOpenItemByRef(tenantId, row.openItemRef)
            : null;
          const openAmount = openItem ? Number(openItem.openAmount) : Number(row.statementAmount);
          const statementAmount = Number(row.statementAmount);
          appliedAmount = statementAmount.toFixed(2);
          if (disposition === 'SHORT_PAY') {
            const shortfall = Math.max(0, openAmount - statementAmount);
            writeDownAmount = shortfall.toFixed(2);
          }
          applyNumber = `MATCH-${sessionId.slice(-8)}-${rowId.slice(-8)}`;
        }

        const updated = await tx.oemMatchSessionRow.update({
          where: { id: rowId },
          data: {
            disposition: disposition === 'SHORT_PAY' ? 'SHORT_PAID' : disposition,
            appliedAmount, writeDownAmount, applyNumber, note: note ?? null,
            dispositionedAt: new Date(), dispositionedBy: actor,
          },
        });

        await appendAudit(tx, {
          tenantId, docType: 'OemMatchSessionRow', docId: rowId,
          action: 'MATCH_ROW_DISPOSITIONED', actor, before: row, after: updated,
        });

        return updated;
      });
    });
  }

  /**
   * Completion gate: every row must be dispositioned. Before checking,
   * auto-adds "ours-not-on-statement" system rows for any open item (of the
   * types this session touches) not referenced by any staged row — package
   * AC: "ours-not-on-statement → aging continues, exception per config".
   * These are auto-dispositioned INVESTIGATION (aging continues is itself
   * the disposition, not a pending user action).
   */
  async completeSession(tenantId: string, sessionId: string, actor: string) {
    const session = await this.getSession(tenantId, sessionId);
    if (session.status !== 'OPEN') throw new OemValidationError('SESSION_NOT_OPEN', 'session is not open');

    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const referencedTypes = new Set(
        session.rows.filter((r: any) => r.openItemType === 'WARRANTY_CLAIM' || r.openItemType === 'PARTS_RETURN_CREDIT').map((r: any) => r.openItemType),
      );
      const referencedRefs = new Set(session.rows.map((r: any) => r.openItemRef).filter(Boolean));

      for (const itemType of referencedTypes as Set<OemOpenItemTypeKey>) {
        const openItems = await this.openItems.findOpenItems(tenantId, session.storeId, itemType);
        for (const item of openItems) {
          if (referencedRefs.has(item.itemRef)) continue;
          await tx.oemMatchSessionRow.create({
            data: {
              tenantId, sessionId, isSystemGenerated: true,
              openItemRef: item.itemRef, openItemType: itemType,
              disposition: 'INVESTIGATION',
              statementAmount: 0,
              note: 'ours-not-on-statement: aging continues per config',
              dispositionedAt: new Date(), dispositionedBy: 'system',
            },
          });
        }
      }

      const rows = await tx.oemMatchSessionRow.findMany({ where: { tenantId, sessionId } });
      const pending = rows.filter((r: any) => r.disposition === 'PENDING');
      if (pending.length > 0) {
        throw new OemValidationError(
          'SESSION_NOT_FULLY_DISPOSITIONED',
          `${pending.length} row(s) still PENDING — every row must be dispositioned before completion`,
        );
      }

      const updated = await tx.oemMatchSession.update({
        where: { id: sessionId },
        data: { status: 'COMPLETE', completedAt: new Date(), completedBy: actor },
      });

      await appendAudit(tx, {
        tenantId, docType: 'OemMatchSession', docId: sessionId,
        action: 'MATCH_SESSION_COMPLETED', actor, before: session, after: updated,
      });

      return tx.oemMatchSession.findFirst({ where: { id: sessionId }, include: { rows: true } });
    });
  }
}
