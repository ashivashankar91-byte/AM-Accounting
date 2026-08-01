import type { PrismaClient } from '.prisma/tax-client';
import type { AuditOutboxRow, AuditOutboxStore } from '@amacc/shared-kernel';

export interface AuditWrite {
  tenantId: string;
  entityType?: string | null;
  entityId?: string | null;
  eventType: string;
  actor: string;
  before?: unknown;
  after?: unknown;
}

type AuditTx = {
  taxAuditReference: { create(args: any): Promise<any> };
};

/**
 * Writes one row to this service's audit outbox (tax_audit_reference),
 * drained by the shared @amacc/shared-kernel AuditOutboxDrainer to
 * audit-service — mirrors
 * services/posting-recovery-service/src/infrastructure/audit.ts exactly,
 * adapted to this service's outbox table name. Powers the epic's audit
 * requirement: every config change (before/after), every calculation
 * attempt + status, every exception disposition, every re-request.
 */
export async function appendAuditReference(prisma: PrismaClient, audit: AuditWrite): Promise<void> {
  await (prisma as unknown as AuditTx).taxAuditReference.create({
    data: {
      tenantId: audit.tenantId,
      entityType: audit.entityType ?? null,
      entityId: audit.entityId ?? null,
      eventType: audit.eventType,
      actor: audit.actor,
      before: (audit.before ?? null) as any,
      after: (audit.after ?? null) as any,
    },
  });
}

const EVENT_TYPE_PREFIX = 'tax.';

type PrismaAuditReferenceDelegate = {
  findMany(args: any): Promise<any[]>;
  update(args: any): Promise<any>;
};

/**
 * Adapts tax_audit_reference (eventType/entityType/entityId-shaped) to the
 * shared AuditOutboxStore interface, exactly like
 * posting-recovery-service's makePostingRecoveryAuditStore.
 */
export function makeTaxAuditStore(delegate: PrismaAuditReferenceDelegate): AuditOutboxStore {
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
        docType: r.entityType ?? EVENT_TYPE_PREFIX.slice(0, -1),
        docId: r.entityId ?? 'N/A',
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
