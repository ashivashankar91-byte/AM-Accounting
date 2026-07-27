import crypto from 'crypto';
import type { PrismaClient } from '.prisma/gl-client';

export interface AuditWrite {
  tenantId: string;
  docType: string;
  docId: string;
  action: string;
  actor: string;
  before?: unknown;
  after?: unknown;
  eventType?: string;
  correlationId?: string;
  writeEventOutbox?: boolean;
}

type AuditTx = Pick<PrismaClient, '$transaction'> & {
  outboxEvent: { create(args: any): Promise<any> };
  auditOutboxEvent: { create(args: any): Promise<any> };
};

export async function appendAuditRowsTx(tx: AuditTx, audit: AuditWrite): Promise<void> {
  const payload = {
    eventId: crypto.randomUUID(),
    tenantId: audit.tenantId,
    docType: audit.docType,
    docId: audit.docId,
    action: audit.action,
    actor: audit.actor,
    before: audit.before ?? null,
    after: audit.after ?? null,
    ts: new Date().toISOString(),
    schemaV: 1,
  };

  if (audit.writeEventOutbox !== false) {
    await tx.outboxEvent.create({
      data: {
        eventType: audit.eventType ?? `audit.${audit.action.toLowerCase()}`,
        tenantId: audit.tenantId,
        payload: payload as any,
        correlationId: audit.correlationId ?? audit.docId,
      },
    });
  }

  await tx.auditOutboxEvent.create({
    data: {
      id: crypto.randomUUID(),
      tenantId: audit.tenantId,
      docType: audit.docType,
      docId: audit.docId,
      action: audit.action,
      before: audit.before as any,
      after: audit.after as any,
      actor: audit.actor,
    },
  });
}

export async function appendAuditRows(prisma: AuditTx, audit: AuditWrite): Promise<void> {
  await prisma.$transaction(async (tx: any) => appendAuditRowsTx(tx, audit));
}
