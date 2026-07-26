/**
 * R0 Stabilization Phase 4 — audit-service had no test infrastructure at all
 * before this (no test script, no vitest devDependency, no tests/ dir).
 * audit-service is not one of the 22 R0 stories, so a full test-suite
 * retrofit is out of scope here; this file covers only the new logic this
 * phase actually added: idempotent handling of a duplicate sourceEventId
 * (AuditOutboxDrainer retries deliver the same outbox row more than once).
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from '../src/application/audit-service';

function fakePrisma(initial: any[] = []) {
  const rows = [...initial];
  return {
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        if (data.sourceEventId && rows.some((r) => r.sourceEventId === data.sourceEventId)) {
          const err: any = new Error('Unique constraint failed on the fields: (`source_event_id`)');
          err.code = 'P2002';
          throw err;
        }
        const record = { id: `audit-${rows.length + 1}`, ...data };
        rows.push(record);
        return record;
      }),
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.sourceEventId === where.sourceEventId) ?? null),
    },
  };
}

describe('AuditService.log — idempotent delivery (R0 Stabilization Phase 4)', () => {
  it('creates a new record when sourceEventId has not been seen before', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    const result = await svc.log({
      tenantId: 't1', eventType: 'legalentity.create', entityType: 'LegalEntity', entityId: 'e1',
      actorType: 'USER', actorId: 'u1', actorName: 'u1', action: 'CREATE', sourceEventId: 'tenant-service:outbox-1',
    });
    expect(result.idempotent).toBe(false);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('treats a duplicate sourceEventId as an idempotent no-op, not a new row or a thrown error', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    const dto = {
      tenantId: 't1', eventType: 'legalentity.create', entityType: 'LegalEntity', entityId: 'e1',
      actorType: 'USER', actorId: 'u1', actorName: 'u1', action: 'CREATE', sourceEventId: 'tenant-service:outbox-1',
    };
    const first = await svc.log(dto);
    const second = await svc.log(dto); // simulates AuditOutboxDrainer retrying the same outbox row
    expect(second.idempotent).toBe(true);
    expect(second.id).toBe(first.id); // same underlying record, not a duplicate
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(2); // both attempts hit create...
    expect(prisma.auditLog.findUnique).toHaveBeenCalledTimes(1); // ...but only the duplicate falls back to a lookup
  });

  it('still creates distinct records for distinct sourceEventIds (no over-broad dedup)', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    const a = await svc.log({ tenantId: 't1', eventType: 'x', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', sourceEventId: 'svc:1' });
    const b = await svc.log({ tenantId: 't1', eventType: 'x', entityType: 'X', entityId: '2', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', sourceEventId: 'svc:2' });
    expect(a.id).not.toBe(b.id);
    expect(a.idempotent).toBe(false);
    expect(b.idempotent).toBe(false);
  });

  it('creates a record fine when no sourceEventId is supplied at all (direct API callers, not the drainer)', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    const result = await svc.log({
      tenantId: 't1', eventType: 'manual.entry', entityType: 'X', entityId: '1',
      actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE',
    });
    expect(result.idempotent).toBe(false);
  });
});
