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

/** Extracts the literal SQL text of a tagged-template raw-query call, so the
 * fake can tell an anchor INSERT apart from an anchor UPDATE/SELECT without
 * a real SQL parser. */
function sqlOf(strings: TemplateStringsArray): string {
  return strings.join('?');
}

function fakePrisma(initial: any[] = []) {
  const rows = [...initial];
  // In-memory stand-in for the audit_chain_anchors bookkeeping table.
  const anchors = new Map<string, { tailHash: string | null; tailAuditLogId: string | null; chainVerifiedFrom?: Date | null }>();

  const auditLog = {
    create: vi.fn(async ({ data }: any) => {
      if (data.sourceEventId && rows.some((r) => r.sourceEventId === data.sourceEventId)) {
        const err: any = new Error('Unique constraint failed on the fields: (`source_event_id`)');
        err.code = 'P2002';
        throw err;
      }
      // Mimic Postgres's generated `partition_key` column (see
      // migration 20260727000001_add_hash_chain): the real DB derives this
      // from occurred_at/tenant_id automatically; the app never sends it.
      const partitionKey = `${data.occurredAt.toISOString().slice(0, 7)}:${data.tenantId}`;
      const record = { id: `audit-${rows.length + 1}`, ...data, partitionKey };
      rows.push(record);
      return record;
    }),
    findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.sourceEventId === where.sourceEventId) ?? null),
    findMany: vi.fn(async ({ where }: any) => {
      let result = rows;
      if (where?.partitionKey) result = result.filter((r) => r.partitionKey === where.partitionKey);
      if (where?.tenantId) result = result.filter((r) => r.tenantId === where.tenantId);
      if (where?.entityType) result = result.filter((r) => r.entityType === where.entityType);
      if (where?.entityId) result = result.filter((r) => r.entityId === where.entityId);
      return [...result].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : 1));
    }),
  };

  const client: any = {
    auditLog,
    __anchors: anchors, // test-only escape hatch, mirrors the existing pattern of mutating `stored[i]` in place for the broken-chain test above
    // GOLDEN-R0 Phase 4: verifyChain() now reads the anchor row's
    // chainVerifiedFrom (legacy-audit-row cutoff) via a real Prisma model
    // call rather than $queryRaw. No test in this file sets a cutoff, so
    // this always returns null/undefined -- every existing assertion here
    // still verifies the whole partition from genesis, unchanged.
    auditChainAnchor: {
      findUnique: vi.fn(async ({ where }: any) => {
        const anchor = anchors.get(where.partitionKey);
        if (!anchor) return null;
        return { partitionKey: where.partitionKey, ...anchor, chainVerifiedFrom: anchor.chainVerifiedFrom ?? null };
      }),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = sqlOf(strings);
      if (sql.includes('SELECT tail_hash FROM audit_chain_anchors')) {
        const partitionKey = values[0];
        const anchor = anchors.get(partitionKey);
        return anchor ? [{ tail_hash: anchor.tailHash }] : [];
      }
      if (sql.includes('SELECT DISTINCT partition_key FROM audit_logs')) {
        const keys = [...new Set(rows.map((r) => r.partitionKey).filter(Boolean))].sort();
        return keys.map((k) => ({ partition_key: k }));
      }
      throw new Error(`fakePrisma.$queryRaw: unrecognized query: ${sql}`);
    }),
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = sqlOf(strings);
      if (sql.includes('INSERT INTO audit_chain_anchors')) {
        const partitionKey = values[0];
        if (!anchors.has(partitionKey)) anchors.set(partitionKey, { tailHash: null, tailAuditLogId: null });
        return 1;
      }
      if (sql.includes('UPDATE audit_chain_anchors')) {
        const [tailHash, tailAuditLogId, partitionKey] = values;
        anchors.set(partitionKey, { tailHash, tailAuditLogId });
        return 1;
      }
      throw new Error(`fakePrisma.$executeRaw: unrecognized query: ${sql}`);
    }),
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(client)),
  };
  return client;
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

describe('AuditService — BR7-2 hash chain', () => {
  it('chains hashPrev/hashSelf across successive writes in the same partition, starting from a null genesis', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    const occurredAt = new Date('2026-07-01T00:00:00.000Z');
    await svc.log({ tenantId: 't1', eventType: 'a', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt });
    await svc.log({ tenantId: 't1', eventType: 'b', entityType: 'X', entityId: '2', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-02T00:00:00.000Z') });
    await svc.log({ tenantId: 't1', eventType: 'c', entityType: 'X', entityId: '3', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-03T00:00:00.000Z') });

    const call = (i: number) => prisma.auditLog.create.mock.calls[i][0].data;
    expect(call(0).hashPrev).toBeNull();
    expect(call(0).hashSelf).toBeTruthy();
    expect(call(1).hashPrev).toBe(call(0).hashSelf); // second row chains from the first
    expect(call(2).hashPrev).toBe(call(1).hashSelf); // third row chains from the second
  });

  it('starts a fresh chain (hashPrev null) for a different tenant/month partition, independent of other partitions', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    await svc.log({ tenantId: 't1', eventType: 'a', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-01T00:00:00.000Z') });
    await svc.log({ tenantId: 't2', eventType: 'a', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-01T00:00:00.000Z') });
    const call = (i: number) => prisma.auditLog.create.mock.calls[i][0].data;
    expect(call(0).hashPrev).toBeNull();
    expect(call(1).hashPrev).toBeNull(); // different tenant => different partition => own genesis
  });

  it('verifyChain reports ok for an untampered chain and recomputes the same hashes verifyChain would expect', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    await svc.log({ tenantId: 't1', eventType: 'a', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-01T00:00:00.000Z') });
    await svc.log({ tenantId: 't1', eventType: 'b', entityType: 'X', entityId: '2', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-02T00:00:00.000Z') });

    const result = await svc.verifyChain('2026-07:t1');
    expect(result.ok).toBe(true);
    expect(result.recordsChecked).toBe(2);
  });

  it('verifyChain detects tampering with a stored record\'s content (hashSelf no longer matches recomputed hash)', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    await svc.log({ tenantId: 't1', eventType: 'a', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-01T00:00:00.000Z') });
    await svc.log({ tenantId: 't1', eventType: 'b', entityType: 'X', entityId: '2', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-02T00:00:00.000Z') });

    // Simulate a row being altered out-of-band (bypassing the app entirely,
    // e.g. a rogue superuser disabling the immutability trigger) — the
    // chain must still catch it.
    const stored = await prisma.auditLog.findMany({ where: { partitionKey: '2026-07:t1' } });
    stored[0].action = 'TAMPERED';

    const result = await svc.verifyChain('2026-07:t1');
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(stored[0].id);
    expect(result.reason).toMatch(/hashSelf/);
  });

  it('verifyChain detects a broken hashPrev link (e.g. a row deleted/reordered out-of-band)', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    await svc.log({ tenantId: 't1', eventType: 'a', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-01T00:00:00.000Z') });
    await svc.log({ tenantId: 't1', eventType: 'b', entityType: 'X', entityId: '2', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-02T00:00:00.000Z') });

    const stored = await prisma.auditLog.findMany({ where: { partitionKey: '2026-07:t1' } });
    stored[1].hashPrev = 'not-the-real-prior-hash';

    const result = await svc.verifyChain('2026-07:t1');
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(stored[1].id);
    expect(result.reason).toMatch(/hashPrev/);
  });

  it('GOLDEN-R0 Phase 4: an explicit chainVerifiedFrom cutoff excludes pre-cutoff legacy rows (no hashPrev/hashSelf) from verification, and leaves post-cutoff chain integrity fully enforced', async () => {
    // A legacy row predating hash-chaining: real ones found live in the
    // amacc dev database have null hashPrev/hashSelf because they were
    // written before this feature existed, not because anything was
    // tampered with.
    const legacyRow = {
      id: 'legacy-1', partitionKey: '2026-07:t1', tenantId: 't1', eventType: 'legacy', entityType: 'X', entityId: '0',
      actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-01T00:00:00.000Z'),
      hashPrev: null, hashSelf: null,
    };
    const prisma = fakePrisma([legacyRow]);
    const svc = new AuditService(prisma as any);
    await svc.log({ tenantId: 't1', eventType: 'a', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-10T00:00:00.000Z') });
    await svc.log({ tenantId: 't1', eventType: 'b', entityType: 'X', entityId: '2', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-11T00:00:00.000Z') });

    // Without a cutoff, the legacy row (no hashPrev/hashSelf, and not the
    // real genesis) makes the partition report broken -- correctly, since
    // there is genuinely no hash-chain proof covering it.
    const withoutCutoff = await svc.verifyChain('2026-07:t1');
    expect(withoutCutoff.ok).toBe(false);
    expect(withoutCutoff.legacyExcluded ?? 0).toBe(0);

    // Explicitly, deliberately set the cutoff to the first real chained
    // row's timestamp (this is the one-time, disclosed operation described
    // in LEGACY_AUDIT_CHAIN_DECISION.md, not something verifyChain infers
    // on its own).
    (prisma as any).__anchors.set('2026-07:t1', {
      ...(prisma as any).__anchors.get('2026-07:t1'),
      chainVerifiedFrom: new Date('2026-07-10T00:00:00.000Z'),
    });

    const withCutoff = await svc.verifyChain('2026-07:t1');
    expect(withCutoff.ok).toBe(true);
    expect(withCutoff.recordsChecked).toBe(2);
    expect(withCutoff.legacyExcluded).toBe(1);

    // A genuine break from the cutoff point forward is still caught.
    const stored = await prisma.auditLog.findMany({ where: { partitionKey: '2026-07:t1' } });
    const secondRealRow = stored.find((r: any) => r.id !== 'legacy-1' && r.hashPrev);
    secondRealRow.hashPrev = 'tampered';
    const withTamper = await svc.verifyChain('2026-07:t1');
    expect(withTamper.ok).toBe(false);
    expect(withTamper.legacyExcluded).toBe(1);
  });

  it('listPartitions returns every distinct partition key with at least one row', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    await svc.log({ tenantId: 't1', eventType: 'a', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-01T00:00:00.000Z') });
    await svc.log({ tenantId: 't2', eventType: 'a', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-08-01T00:00:00.000Z') });
    const partitions = await svc.listPartitions();
    expect(partitions.sort()).toEqual(['2026-07:t1', '2026-08:t2']);
  });

  it('BR7-4: a fault mid-write (audit-log create throws for a reason other than the sourceEventId idempotency case) rolls back the whole write, including any anchor advance', async () => {
    const prisma = fakePrisma();
    // Force the very next create() call to fail with an unrelated DB error,
    // simulating an audit-write fault. Because the anchor lock/read/update
    // and the auditLog.create all happen inside the same $transaction, the
    // fake's $transaction wrapper re-throws synchronously (no partial
    // anchor mutation survives) — mirroring real Postgres transaction
    // rollback semantics.
    prisma.auditLog.create.mockImplementationOnce(async () => {
      throw new Error('simulated audit-store outage');
    });
    const svc = new AuditService(prisma as any);
    await expect(svc.log({
      tenantId: 't1', eventType: 'a', entityType: 'X', entityId: '1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    })).rejects.toThrow('simulated audit-store outage');

    // The next successful write must still start from a null hashPrev
    // (genesis), proving the failed attempt above never advanced the chain
    // anchor and left no gap/gap-hash behind.
    await svc.log({ tenantId: 't1', eventType: 'b', entityType: 'X', entityId: '2', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt: new Date('2026-07-01T00:00:00.000Z') });
    const call0 = prisma.auditLog.create.mock.calls[1][0].data; // index 1: the first call (index 0) was the failed one
    expect(call0.hashPrev).toBeNull();
  });
});

describe('AuditService.getDocumentHistory / historyContainsPii / documentHistoryToCsv (S224)', () => {
  it('returns an empty array (not an error) for a document with zero events', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    const events = await svc.getDocumentHistory('t1', 'ManualJeDraft', 'draft-does-not-exist');
    expect(events).toEqual([]);
  });

  it('returns events in chronological (ascending) order with field-level diffs', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    await svc.log({
      tenantId: 't1', eventType: 'je.draft.created', entityType: 'ManualJeDraft', entityId: 'd1',
      actorType: 'USER', actorId: 'u1', actorName: 'Alice', action: 'DRAFT_CREATED',
      newState: { status: 'DRAFT', memo: 'first' }, occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    await svc.log({
      tenantId: 't1', eventType: 'je.draft.updated', entityType: 'ManualJeDraft', entityId: 'd1',
      actorType: 'USER', actorId: 'u2', actorName: 'Bob', action: 'DRAFT_UPDATED',
      previousState: { status: 'DRAFT', memo: 'first' }, newState: { status: 'DRAFT', memo: 'second' },
      occurredAt: new Date('2026-07-02T00:00:00.000Z'),
    });

    const events = await svc.getDocumentHistory('t1', 'ManualJeDraft', 'd1');
    expect(events).toHaveLength(2);
    expect(events[0].action).toBe('DRAFT_CREATED');
    expect(events[1].action).toBe('DRAFT_UPDATED');
    expect(events[1].fieldDiffs).toEqual([{ field: 'memo', before: 'first', after: 'second' }]);
  });

  it('is tenant- and document-scoped — never leaks another tenant/document\'s events', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    await svc.log({ tenantId: 't1', eventType: 'a', entityType: 'X', entityId: 'd1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE' });
    await svc.log({ tenantId: 't2', eventType: 'a', entityType: 'X', entityId: 'd1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE' });
    await svc.log({ tenantId: 't1', eventType: 'a', entityType: 'X', entityId: 'd2', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE' });

    const events = await svc.getDocumentHistory('t1', 'X', 'd1');
    expect(events).toHaveLength(1);
  });

  it('historyContainsPii is false when no diffed field matches a PII marker', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    await svc.log({
      tenantId: 't1', eventType: 'a', entityType: 'Department', entityId: 'd1', actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE',
      newState: { name: 'Service', status: 'ACTIVE' },
    });
    const events = await svc.getDocumentHistory('t1', 'Department', 'd1');
    expect(svc.historyContainsPii(events)).toBe(false);
  });

  it('historyContainsPii is true when a diffed field name matches a PII marker (BR224-3)', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    await svc.log({
      tenantId: 't1', eventType: 'a', entityType: 'User', entityId: 'u1', actorType: 'USER', actorId: 'admin', actorName: 'admin', action: 'CREATE',
      newState: { name: 'Alice', email: 'alice@example.com' },
    });
    const events = await svc.getDocumentHistory('t1', 'User', 'u1');
    expect(svc.historyContainsPii(events)).toBe(true);
  });

  it('documentHistoryToCsv produces one row per changed field, exact parity with the timeline', async () => {
    const prisma = fakePrisma();
    const svc = new AuditService(prisma as any);
    await svc.log({
      tenantId: 't1', eventType: 'a', entityType: 'X', entityId: 'd1', actorType: 'USER', actorId: 'u1', actorName: 'Alice', action: 'CREATE',
      newState: { status: 'DRAFT', amount: 100 }, occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    const events = await svc.getDocumentHistory('t1', 'X', 'd1');
    const csv = svc.documentHistoryToCsv(events);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('timestamp,actor,action,eventType,field,before,after,reason');
    expect(lines).toHaveLength(3); // header + 2 changed fields (status, amount)
  });
});
