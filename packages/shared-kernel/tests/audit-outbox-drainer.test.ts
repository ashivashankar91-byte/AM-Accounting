import { describe, it, expect, vi } from 'vitest';
import { AuditOutboxDrainer, AuditOutboxRow, AuditOutboxStore } from '../src/audit/audit-outbox-drainer';
import type { AuditClient } from '../src/audit/audit-client';

function makeStore(rows: AuditOutboxRow[]) {
  const published = new Set<string>();
  const failedUpdates: Array<{ id: string; retryCount: number; error: string }> = [];
  const store: AuditOutboxStore = {
    async findUnpublished(limit) {
      return rows.filter((r) => !published.has(r.id)).slice(0, limit);
    },
    async markPublished(id) {
      published.add(id);
    },
    async markFailed(id, retryCount, error) {
      failedUpdates.push({ id, retryCount, error });
      const row = rows.find((r) => r.id === id);
      if (row) row.retryCount = retryCount;
    },
  };
  return { store, published, failedUpdates };
}

const ROW = (id: string): AuditOutboxRow => ({
  id, tenantId: 't1', docType: 'LegalEntity', docId: 'e1', action: 'CREATE',
  before: null, after: { name: 'Acme' }, actor: 'u1', retryCount: 0,
});

describe('AuditOutboxDrainer (R0 Stabilization Phase 4)', () => {
  it('delivers an unpublished row and marks it published', async () => {
    const { store, published } = makeStore([ROW('r1')]);
    const client: AuditClient = { log: vi.fn(async () => ({ id: 'audit-1', idempotent: false })) };
    const drainer = new AuditOutboxDrainer(store, client, { serviceName: 'coa-service' });

    const result = await drainer.drainOnce();

    expect(result).toEqual({ delivered: 1, failed: 0, permanentlyFailed: 0 });
    expect(published.has('r1')).toBe(true);
    expect(client.log).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', entityType: 'LegalEntity', entityId: 'e1', action: 'CREATE',
      sourceEventId: 'coa-service:r1',
    }));
  });

  it('never marks a row published on failure, and increments retryCount instead — nothing is silently lost', async () => {
    const { store, published, failedUpdates } = makeStore([ROW('r1')]);
    const client: AuditClient = { log: vi.fn(async () => { throw new Error('audit-service unreachable'); }) };
    const onFailed = vi.fn();
    const drainer = new AuditOutboxDrainer(store, client, { serviceName: 'auth-service', onFailed });

    const result = await drainer.drainOnce();

    expect(result).toEqual({ delivered: 0, failed: 1, permanentlyFailed: 0 });
    expect(published.has('r1')).toBe(false);
    expect(failedUpdates).toEqual([{ id: 'r1', retryCount: 1, error: 'audit-service unreachable' }]);
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), expect.any(Error), true);
  });

  it('stops treating a row as retryable once maxRetries is reached — but still never deletes or silently drops it', async () => {
    const row = ROW('r1');
    row.retryCount = 7; // one below the default maxRetries (8)
    const { store, failedUpdates } = makeStore([row]);
    const client: AuditClient = { log: vi.fn(async () => { throw new Error('still down'); }) };
    const onFailed = vi.fn();
    const drainer = new AuditOutboxDrainer(store, client, { serviceName: 'coa-service', onFailed });

    const result = await drainer.drainOnce();

    expect(result.permanentlyFailed).toBe(1);
    expect(failedUpdates[0].retryCount).toBe(8);
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), expect.any(Error), false);
  });

  it('processes multiple rows independently — one failure does not block delivery of the others', async () => {
    const { store, published } = makeStore([ROW('r1'), ROW('r2'), ROW('r3')]);
    const client: AuditClient = {
      log: vi.fn(async (entry) => {
        if (entry.entityId === 'e1' && entry.sourceEventId === 'coa-service:r2') throw new Error('boom');
        return { id: `audit-${entry.sourceEventId}`, idempotent: false };
      }),
    };
    const drainer = new AuditOutboxDrainer(store, client, { serviceName: 'coa-service' });

    const result = await drainer.drainOnce();

    expect(result).toEqual({ delivered: 2, failed: 1, permanentlyFailed: 0 });
    expect(published.has('r1')).toBe(true);
    expect(published.has('r2')).toBe(false);
    expect(published.has('r3')).toBe(true);
  });

  it('passes an idempotent delivery result through without treating it as a failure', async () => {
    const { store, published } = makeStore([ROW('r1')]);
    const client: AuditClient = { log: vi.fn(async () => ({ id: 'audit-1', idempotent: true })) };
    const onDelivered = vi.fn();
    const drainer = new AuditOutboxDrainer(store, client, { serviceName: 'coa-service', onDelivered });

    const result = await drainer.drainOnce();

    expect(result.delivered).toBe(1);
    expect(published.has('r1')).toBe(true);
    expect(onDelivered).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), { id: 'audit-1', idempotent: true });
  });
});
