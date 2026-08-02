// Local audit-outbox helper — same pattern as coa-service's private
// `audit()` method on PostingEngineService (application/posting-engine-
// service.ts): an append-only row written inside the same transaction as
// the mutation it records, drained to the real S007 audit-service by
// AuditOutboxDrainer (wired in src/index.ts exactly like coa-service's own
// bootstrap does with makePrismaAuditOutboxStore/HttpAuditClient).
import crypto from 'crypto';

export interface AuditOutboxDelegate {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
}

export async function auditOutboxEvent(
  tx: { auditOutboxEvent: AuditOutboxDelegate },
  args: { tenantId: string; docType: string; docId: string; action: string; actor: string; before?: unknown; after?: unknown },
): Promise<void> {
  await tx.auditOutboxEvent.create({
    data: {
      id: crypto.randomUUID(),
      tenantId: args.tenantId,
      docType: args.docType,
      docId: args.docId,
      action: args.action,
      before: (args.before ?? null) as any,
      after: (args.after ?? null) as any,
      actor: args.actor,
    },
  });
}
