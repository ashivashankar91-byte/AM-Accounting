// Mirrors coa-service's private audit() helper (posting-engine-service.ts)
// — every mutating action in this service, especially chargeback draws,
// cancellations, and recognition-run approval, is audited with before/after,
// drained to the real S007 audit-service by AuditOutboxDrainer (wired in
// index.ts via @amacc/shared-kernel's makePrismaAuditOutboxStore, same
// pattern as every other CE-12/CE-08/CE-10 service).
import { randomUUID } from 'crypto';

export interface AuditWriter {
  auditOutboxEvent: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
}

export async function audit(
  tx: AuditWriter,
  tenantId: string,
  docType: string,
  docId: string,
  action: string,
  actor: string,
  before: unknown,
  after: unknown,
  correlationId?: string | null,
): Promise<void> {
  await tx.auditOutboxEvent.create({
    data: {
      id: randomUUID(),
      tenantId,
      docType,
      docId,
      action,
      before: (before ?? undefined) as any,
      after: (after ?? undefined) as any,
      actor: actor ?? 'system',
      correlationId: correlationId ?? null,
    },
  });
}
