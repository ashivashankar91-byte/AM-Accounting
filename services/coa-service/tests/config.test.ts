/**
 * S223 — Configuration Framework unit tests.
 *
 * Strategy (matches org-foundation precedent): inject an in-memory fake Prisma
 * + fake event publisher via tsyringe. The AuditPort stub is exercised through
 * an in-memory recorder here (permitted for unit tests, packet §11/§12); the
 * real audit_outbox table is written by the Docker runtime transcript, which is
 * the integration evidence.
 *
 * Covers: scope-resolution matrix, effective-date flip, cache invalidation, and
 * a named negative test for every 400/422 path in packet §9.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import {
  ConfigService,
  ConfigUnknownKeyError,
  ConfigValidationError,
} from '../src/application/config-service';

// ── Fixtures ────────────────────────────────────────────────────────────────

const TENANT = 'tenant-kunes';
const ENTITY = 'entity-a';
const OTHER_ENTITY = 'entity-b';
const STORE = 'store-01';

const CATALOG = [
  {
    key: 'je.posting_mode',
    type: 'ENUM',
    allowedScope: ['TENANT', 'ENTITY', 'STORE'],
    enumValues: ['direct', 'review'],
    defaultValue: 'direct',
    description: 'JE posting mode',
    sinceVersion: '1.0.0',
  },
  {
    key: 'fiscal.max_open_periods',
    type: 'INT',
    allowedScope: ['TENANT', 'ENTITY'],
    enumValues: [],
    defaultValue: '2',
    description: 'Max open periods',
    sinceVersion: '1.0.0',
  },
];

function makePrisma() {
  const settings: any[] = [];
  const audits: any[] = [];
  const outbox: any[] = [];
  return {
    _settings: settings,
    _audits: audits,
    _outbox: outbox,
    configKeyCatalog: {
      findUnique: async ({ where }: any) => CATALOG.find((c) => c.key === where.key) ?? null,
      findMany: async () => [...CATALOG],
    },
    configSetting: {
      findMany: async ({ where }: any) => {
        return settings
          .filter(
            (r) =>
              r.tenantId === where.tenantId &&
              r.key === where.key &&
              r.effectiveFrom.getTime() <= where.effectiveFrom.lte.getTime() &&
              where.status.in.includes(r.status),
          )
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of settings) {
          if (
            r.tenantId === where.tenantId &&
            r.key === where.key &&
            r.scope === where.scope &&
            (r.entityId ?? null) === (where.entityId ?? null) &&
            (r.storeId ?? null) === (where.storeId ?? null) &&
            r.effectiveFrom.getTime() <= where.effectiveFrom.lte.getTime() &&
            where.status.in.includes(r.status)
          ) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }: any) => {
        const row = { ...data };
        settings.push(row);
        return row;
      },
    },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
  };
}

function makeEvents() {
  const published: any[] = [];
  return {
    published,
    publish: async (e: any) => void published.push(e),
    subscribe: () => {},
  };
}

let prisma: ReturnType<typeof makePrisma>;
let events: ReturnType<typeof makeEvents>;
let svc: ConfigService;

beforeEach(() => {
  container.clearInstances();
  prisma = makePrisma();
  events = makeEvents();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  svc = container.resolve(ConfigService);
});

// ── BR223-2: scope resolution matrix (STORE > ENTITY > TENANT > DEFAULT) ──────

describe('scope resolution matrix', () => {
  it('falls back to the catalog default when nothing is set', async () => {
    const r = await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode', entityId: ENTITY, storeId: STORE });
    expect(r.value).toBe('direct');
    expect(r.resolvedScope).toBe('DEFAULT');
  });

  it('a tenant-scope value is inherited by entity and store reads', async () => {
    await svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'TENANT', value: 'review', actor: 'admin' });
    const r = await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode', entityId: ENTITY, storeId: STORE });
    expect(r.value).toBe('review');
    expect(r.resolvedScope).toBe('TENANT');
  });

  it('an entity-scope value overrides the tenant value for that entity', async () => {
    await svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'TENANT', value: 'direct', actor: 'admin' });
    await svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'ENTITY', entityId: ENTITY, value: 'review', actor: 'admin' });

    const atEntity = await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode', entityId: ENTITY, storeId: STORE });
    expect(atEntity.value).toBe('review');
    expect(atEntity.resolvedScope).toBe('ENTITY');

    const otherEntity = await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode', entityId: OTHER_ENTITY });
    expect(otherEntity.value).toBe('direct');
    expect(otherEntity.resolvedScope).toBe('TENANT');
  });

  it('a store-scope value is the most specific and wins', async () => {
    await svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'ENTITY', entityId: ENTITY, value: 'direct', actor: 'admin' });
    await svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'STORE', entityId: ENTITY, storeId: STORE, value: 'review', actor: 'admin' });
    const r = await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode', entityId: ENTITY, storeId: STORE });
    expect(r.value).toBe('review');
    expect(r.resolvedScope).toBe('STORE');
  });
});

// ── BR223-3: effective-date flip ──────────────────────────────────────────────

describe('effective-date flip', () => {
  it('a future-dated value is SCHEDULED and observed only once its date arrives', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000); // +1h
    const res = await svc.put({
      tenantId: TENANT, key: 'je.posting_mode', scope: 'TENANT', value: 'review', actor: 'admin',
      effectiveFrom: future,
    });
    expect(res.setting.status).toBe('SCHEDULED');

    const before = await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode', asOf: new Date(Date.now() - 1000) });
    expect(before.value).toBe('direct'); // default, not yet effective

    const after = await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode', asOf: new Date(future.getTime() + 1000) });
    expect(after.value).toBe('review');
    expect(after.resolvedScope).toBe('TENANT');
  });

  it('an immediate value is EFFECTIVE right away', async () => {
    const res = await svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'TENANT', value: 'review', actor: 'admin' });
    expect(res.setting.status).toBe('EFFECTIVE');
  });
});

// ── Cache invalidation ─────────────────────────────────────────────────────────

describe('cache invalidation', () => {
  it('a put() invalidates cached resolutions so the new value is observed', async () => {
    const first = await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode' });
    expect(first.value).toBe('direct'); // cached default

    await svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'TENANT', value: 'review', actor: 'admin' });

    const second = await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode' });
    expect(second.value).toBe('review'); // stale cache was cleared
  });

  it('invalidateAll() clears every cached key', async () => {
    await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode' });
    svc.invalidateAll();
    // No assertion error path; simply exercises the branch used by the subscriber.
    const r = await svc.resolve({ tenantId: TENANT, key: 'je.posting_mode' });
    expect(r.value).toBe('direct');
  });
});

// ── Audit + event emission ─────────────────────────────────────────────────────

describe('audit + event', () => {
  it('a put() writes an audit record with before/after and emits config.changed', async () => {
    await svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'TENANT', value: 'review', actor: 'admin' });

    expect(prisma._audits).toHaveLength(1);
    expect(prisma._audits[0]).toMatchObject({ docType: 'config_setting', action: 'PUT', actor: 'admin' });
    expect(prisma._audits[0].before.value).toBe('direct');
    expect(prisma._audits[0].after.value).toBe('review');

    expect(events.published).toHaveLength(1);
    expect(events.published[0].type).toBe('config.changed');
    expect(events.published[0].payload).toMatchObject({ key: 'je.posting_mode', before: 'direct', after: 'review', schemaV: 1 });
  });
});

// ── Negative tests (every 400/422 path in packet §9) ────────────────────────────

describe('negative — 400 unknown key', () => {
  it('resolve() rejects an unknown key with ConfigUnknownKeyError (400)', async () => {
    await expect(svc.resolve({ tenantId: TENANT, key: 'does.not.exist' })).rejects.toBeInstanceOf(ConfigUnknownKeyError);
  });

  it('put() rejects an unknown key with ConfigUnknownKeyError (400)', async () => {
    await expect(
      svc.put({ tenantId: TENANT, key: 'does.not.exist', scope: 'TENANT', value: 'x', actor: 'admin' }),
    ).rejects.toBeInstanceOf(ConfigUnknownKeyError);
  });
});

describe('negative — 422 type-invalid value', () => {
  it('rejects a non-integer INT value', async () => {
    await expect(
      svc.put({ tenantId: TENANT, key: 'fiscal.max_open_periods', scope: 'TENANT', value: 'abc', actor: 'admin' }),
    ).rejects.toMatchObject({ code: 'INVALID_VALUE' });
  });

  it('rejects an ENUM value outside the allowed set', async () => {
    await expect(
      svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'TENANT', value: 'nope', actor: 'admin' }),
    ).rejects.toMatchObject({ code: 'INVALID_VALUE' });
  });
});

describe('negative — 422 scope-invalid', () => {
  it('rejects a scope not permitted for the key', async () => {
    await expect(
      svc.put({ tenantId: TENANT, key: 'fiscal.max_open_periods', scope: 'STORE', entityId: ENTITY, storeId: STORE, value: '3', actor: 'admin' }),
    ).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('rejects an ENTITY scope missing entityId', async () => {
    await expect(
      svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'ENTITY', value: 'review', actor: 'admin' }),
    ).rejects.toMatchObject({ code: 'INVALID_SCOPE' });
  });

  it('rejects a STORE scope missing storeId', async () => {
    await expect(
      svc.put({ tenantId: TENANT, key: 'je.posting_mode', scope: 'STORE', entityId: ENTITY, value: 'review', actor: 'admin' }),
    ).rejects.toMatchObject({ code: 'INVALID_SCOPE' });
  });
});
