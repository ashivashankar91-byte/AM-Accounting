import type { PrismaClient } from '.prisma/deal-accounting-client';
import type { AuditOutboxRow, AuditOutboxStore } from '@amacc/shared-kernel';

// Mirrors coa-service's private audit() helper / posting-recovery-service's
// appendAuditReference — every mutating action in this service (finalize,
// hold/release/return, unwind, recontract, CIT disposition, payoff issue/
// variance, wholesale dispose/arbitrate) writes one row here with before/
// after images, drained to the real S007 audit-service by the shared
// AuditOutboxDrainer exactly like every other service's audit_outbox.

export interface AuditWrite {
  tenantId: string;
  docType: string;
  docId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  actor: string;
  correlationId?: string | null;
}

type AuditTx = { dealAuditReference: { create(args: any): Promise<any> } };

export async function appendAuditReference(prisma: PrismaClient | any, audit: AuditWrite): Promise<void> {
  await (prisma as unknown as AuditTx).dealAuditReference.create({
    data: {
      tenantId: audit.tenantId,
      docType: audit.docType,
      docId: audit.docId,
      action: audit.action,
      before: (audit.before ?? null) as any,
      after: (audit.after ?? null) as any,
      actor: audit.actor,
      correlationId: audit.correlationId ?? null,
    },
  });
}

type PrismaAuditReferenceDelegate = { findMany(args: any): Promise<any[]>; update(args: any): Promise<any> };

export function makeDealAuditStore(delegate: PrismaAuditReferenceDelegate): AuditOutboxStore {
  return {
    async findUnpublished(limit: number): Promise<AuditOutboxRow[]> {
      const rows = await delegate.findMany({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' }, take: limit });
      return rows.map((r: any) => ({
        id: r.id, tenantId: r.tenantId, docType: r.docType, docId: r.docId,
        action: r.action, before: r.before, after: r.after, actor: r.actor,
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
