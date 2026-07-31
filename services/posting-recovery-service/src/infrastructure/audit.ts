import type { PrismaClient } from '.prisma/posting-recovery-client';
import type { AuditOutboxRow, AuditOutboxStore } from '@amacc/shared-kernel';

export interface AuditWrite {
  tenantId: string;
  deadLetterId?: string | null;
  eventType: string;
  actor: string;
  before?: unknown;
  after?: unknown;
}

type AuditTx = {
  postingRecoveryAuditReference: { create(args: any): Promise<any> };
};

/**
 * Writes one row to this service's audit outbox (posting_recovery_audit_reference),
 * drained by the shared @amacc/shared-kernel AuditOutboxDrainer to
 * audit-service — mirrors services/gl-service/src/infrastructure/audit.ts's
 * appendAuditRows exactly, adapted to this service's outbox table name.
 *
 * Callers must never pass unmasked sensitive payload values in `after` —
 * masking happens before this is called (see routes).
 */
export async function appendAuditReference(prisma: PrismaClient, audit: AuditWrite): Promise<void> {
  await (prisma as unknown as AuditTx).postingRecoveryAuditReference.create({
    data: {
      tenantId: audit.tenantId,
      deadLetterId: audit.deadLetterId ?? null,
      eventType: audit.eventType,
      actor: audit.actor,
      before: (audit.before ?? null) as any,
      after: (audit.after ?? null) as any,
    },
  });
}

const EVENT_TYPE_PREFIX = 'posting_recovery.';

type PrismaAuditReferenceDelegate = {
  findMany(args: any): Promise<any[]>;
  update(args: any): Promise<any>;
};

/**
 * Adapts posting_recovery_audit_reference (eventType/deadLetterId-shaped) to
 * the shared AuditOutboxStore interface every other service's audit_outbox
 * (docType/docId/action-shaped) satisfies via makePrismaAuditOutboxStore.
 * A direct field-for-field reuse of that helper isn't possible (this
 * table's columns are deliberately named per the S021 story's required
 * schema list, not the generic docType/docId/action shape) — this adapter
 * is the seam instead, so the same AuditOutboxDrainer still works
 * unmodified. AuditOutboxDrainer computes the eventType it sends to
 * audit-service as `${docType}.${action}`.toLowerCase(); splitting/
 * rejoining on EVENT_TYPE_PREFIX here round-trips this table's literal
 * `posting_recovery.<x>` event names through that computation unchanged.
 */
export function makePostingRecoveryAuditStore(delegate: PrismaAuditReferenceDelegate): AuditOutboxStore {
  return {
    async findUnpublished(limit: number): Promise<AuditOutboxRow[]> {
      const rows = await delegate.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      return rows.map((r: any) => ({
        id: r.id,
        tenantId: r.tenantId,
        docType: EVENT_TYPE_PREFIX.slice(0, -1),
        docId: r.deadLetterId ?? 'QUEUE',
        action: String(r.eventType).startsWith(EVENT_TYPE_PREFIX) ? r.eventType.slice(EVENT_TYPE_PREFIX.length) : r.eventType,
        before: r.before,
        after: r.after,
        actor: r.actor,
        retryCount: r.retryCount ?? 0,
      }));
    },
    async markPublished(id: string): Promise<void> {
      await delegate.update({ where: { id }, data: { publishedAt: new Date() } });
    },
    async markFailed(id: string, retryCount: number, error: string): Promise<void> {
      await delegate.update({ where: { id }, data: { retryCount, lastError: error.slice(0, 2000) } });
    },
  };
}
