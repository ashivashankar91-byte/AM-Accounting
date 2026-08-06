import type { PrismaClient } from '.prisma/fixedops-client';
import type { AuditOutboxRow, AuditOutboxStore } from '@amacc/shared-kernel';

export interface AuditWrite {
  tenantId: string;
  docType: string;
  docId: string;
  action: string;
  actor: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  correlationId?: string | null;
}

type AuditTx = { auditOutboxEvent: { create(args: any): Promise<any> } };

/** Writes one row to this service's local audit outbox (audit_outbox_event),
 * drained by @amacc/shared-kernel's AuditOutboxDrainer to the real central
 * audit-service — every material action (RO close, reopen/void,
 * disposition, redemption, WIP election) calls this INSIDE the same
 * transaction as the business write. Mirrors
 * services/tax-service/src/infrastructure/audit.ts. */
export async function appendAuditEvent(prismaOrTx: any, audit: AuditWrite): Promise<void> {
  await (prismaOrTx as AuditTx).auditOutboxEvent.create({
    data: {
      tenantId: audit.tenantId,
      docType: audit.docType,
      docId: audit.docId,
      action: audit.action,
      before: (audit.before ?? null) as any,
      after: (audit.after ?? null) as any,
      reason: audit.reason ?? null,
      correlationId: audit.correlationId ?? null,
      actor: audit.actor,
    },
  });
}

export function makeFixedOpsAuditStore(delegate: PrismaClient['auditOutboxEvent']): AuditOutboxStore {
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
        docType: r.docType,
        docId: r.docId,
        action: r.action,
        before: r.before,
        after: r.after,
        actor: r.actor,
        retryCount: 0,
      }));
    },
    async markPublished(id: string): Promise<void> {
      await delegate.update({ where: { id }, data: { publishedAt: new Date() } });
    },
    async markFailed(): Promise<void> {
      // audit_outbox_event has no retryCount/lastError column; the drainer
      // simply retries unpublished rows on its next tick.
    },
  };
}
