/**
 * CE-14 — writes one row to this service's shared audit_outbox table
 * (AuditOutboxEvent), drained by the shared @amacc/shared-kernel
 * AuditOutboxDrainer to audit-service. Mirrors
 * services/schedule-service/src/application/open-item-service.ts's
 * private writeAudit exactly, extracted here since every CE-14 story's
 * application service needs the same before/after write.
 */
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

export async function appendAudit(tx: any, audit: AuditWrite): Promise<void> {
  await tx.auditOutboxEvent.create({
    data: {
      tenantId: audit.tenantId,
      docType: audit.docType,
      docId: audit.docId,
      action: audit.action,
      before: (audit.before ?? undefined) as any,
      after: (audit.after ?? undefined) as any,
      actor: audit.actor ?? 'system',
      correlationId: audit.correlationId ?? null,
    },
  });
}
