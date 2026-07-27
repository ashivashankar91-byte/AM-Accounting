/**
 * S010 — Seed Canonical COA Skeleton unit tests.
 *
 * Strategy: in-memory fake Prisma + fake event publisher via tsyringe. Covers
 * the AC set: full skeleton created with correct type/normal-balance/hierarchy,
 * idempotent re-run, merge-by-number with conflict report (never overwrite),
 * diff-from-canonical, and the §9 422 unknown-manifest negative.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { SeedService, UnknownManifestError } from '../src/application/seed-service';
import { BP_3_2_MANIFEST, orderedForSeed } from '../src/domain/coa-blueprint';

const TENANT = 'tenant-kunes';
const ENTITY = 'entity-fresh-001';

function makePrisma(seed: any[] = []) {
  const accounts: any[] = [...seed];
  const audits: any[] = [];
  const outbox: any[] = [];
  const runs: any[] = [];
  const client: any = {
    _accounts: accounts,
    _audits: audits,
    _outbox: outbox,
    _runs: runs,
    glAccount: {
      findMany: async ({ where }: any) =>
        accounts.filter((a) => a.tenantId === where.tenantId && a.entityId === where.entityId),
      create: async ({ data }: any) => {
        accounts.push(data);
        return data;
      },
    },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    coaSeedRun: { create: async ({ data }: any) => (runs.push(data), data) },
  };
  client.$transaction = async (arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg);
  return client;

}

function makeEvents() {
  const published: any[] = [];
  return { published, publish: async (e: any) => void published.push(e) };
}

function setup(seed: any[] = []) {
  container.reset();
  const prisma = makePrisma(seed);
  const events = makeEvents();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.register('SeedService', { useClass: SeedService });
  return { svc: container.resolve<SeedService>('SeedService'), prisma, events };
}

describe('S010 domain — blueprint', () => {
  it('orderedForSeed places every parent before its children', () => {
    const ordered = orderedForSeed(BP_3_2_MANIFEST);
    const seen = new Set<string>();
    for (const a of ordered) {
      if (a.parentNumber) expect(seen.has(a.parentNumber)).toBe(true);
      seen.add(a.number);
    }
    expect(ordered).toHaveLength(BP_3_2_MANIFEST.accounts.length);
  });

  it('summary nodes are non-postable and contra accounts carry a reason', () => {
    for (const a of BP_3_2_MANIFEST.accounts) {
      const def = a.type === 'ASSET' || a.type === 'EXPENSE' ? 'DR' : 'CR';
      if (a.normalBalance !== def) expect(a.contraReason).toBeTruthy();
    }
    expect(BP_3_2_MANIFEST.accounts.find((a) => a.number === '10000')!.postable).toBe(false);
  });
});

describe('S010 service — seed', () => {
  it('BR010-2 seeds the full skeleton with correct type/normal-balance/hierarchy + emits coa.seeded', async () => {
    const { svc, prisma, events } = setup();
    const res = await svc.seed({ tenantId: TENANT, entityId: ENTITY, actor: 'controller-1' });

    expect(res.created).toBe(BP_3_2_MANIFEST.accounts.length);
    expect(res.merged).toBe(0);
    expect(res.conflicts).toHaveLength(0);

    // hierarchy resolved: 11100 Operating Cash's parent is the row for 11000.
    const opCash = prisma._accounts.find((a) => a.accountNumber === '11100');
    const cashGroup = prisma._accounts.find((a) => a.accountNumber === '11000');
    expect(opCash.parentId).toBe(cashGroup.id);
    expect(opCash.type).toBe('ASSET');
    expect(opCash.normalBalance).toBe('DR');

    // contra account flagged.
    const allowance = prisma._accounts.find((a) => a.accountNumber === '12430');
    expect(allowance.isContra).toBe(true);
    expect(allowance.contraReason).toBeTruthy();

    const ev = events.published.find((e) => e.type === 'coa.seeded');
    expect(ev.payload).toMatchObject({ entityId: ENTITY, manifestVersion: 'BP-3.2', schemaV: 1 });
    expect(ev.payload.createdCount).toBe(res.created);
    expect(prisma._runs).toHaveLength(1);
    expect(prisma._audits.find((a) => a.action === 'SEED')).toBeTruthy();
  });

  it('BR010-1 re-run is idempotent (0 created, all merged, no conflicts)', async () => {
    const { svc } = setup();
    await svc.seed({ tenantId: TENANT, entityId: ENTITY, actor: 'a' });
    const res2 = await svc.seed({ tenantId: TENANT, entityId: ENTITY, actor: 'a' });
    expect(res2.created).toBe(0);
    expect(res2.merged).toBe(BP_3_2_MANIFEST.accounts.length);
    expect(res2.conflicts).toHaveLength(0);
  });

  it('AC-negative merge-by-number reports a conflict and never overwrites', async () => {
    // Pre-existing 10000 with a divergent name/postable.
    const existing = {
      id: 'x1',
      tenantId: TENANT,
      entityId: ENTITY,
      accountNumber: '10000',
      name: 'Custom Cash Root',
      type: 'ASSET',
      normalBalance: 'DR',
      isContra: false,
      contraReason: null,
      postable: true, // canonical is false
      parentId: null,
      status: 'ACTIVE',
      version: 4,
    };
    const { svc, prisma } = setup([existing]);
    const res = await svc.seed({ tenantId: TENANT, entityId: ENTITY, actor: 'a' });

    const conflict = res.conflicts.find((c) => c.number === '10000');
    expect(conflict).toBeTruthy();
    expect(conflict!.diffs.postable).toEqual({ canonical: false, existing: true });
    // never overwritten
    const row = prisma._accounts.find((a) => a.id === 'x1');
    expect(row.name).toBe('Custom Cash Root');
    expect(row.postable).toBe(true);
    // the rest still created
    expect(res.created).toBe(BP_3_2_MANIFEST.accounts.length - 1);
  });

  it('§9 422 unknown manifest version', async () => {
    const { svc } = setup();
    await expect(
      svc.seed({ tenantId: TENANT, entityId: ENTITY, manifestVersion: 'NADA-90', actor: 'a' }),
    ).rejects.toBeInstanceOf(UnknownManifestError);
  });
});

describe('S010 service — diff-from-canonical', () => {
  it('reports missing, divergent, and extra accounts', async () => {
    // Seed then customize: add an extra account + diverge one.
    const { svc, prisma } = setup();
    await svc.seed({ tenantId: TENANT, entityId: ENTITY, actor: 'a' });
    // extra (non-canonical) account
    prisma._accounts.push({
      id: 'extra', tenantId: TENANT, entityId: ENTITY, accountNumber: '99999', name: 'Custom',
      type: 'ASSET', normalBalance: 'DR', isContra: false, contraReason: null, postable: true,
      parentId: null, status: 'ACTIVE', version: 1,
    });
    // diverge 62000 Rent -> renamed
    prisma._accounts.find((a) => a.accountNumber === '62000').name = 'Facility Rent';

    const diff = await svc.diffFromCanonical(TENANT, ENTITY);
    expect(diff.manifestVersion).toBe('BP-3.2');
    expect(diff.missing).toHaveLength(0);
    expect(diff.extra).toContain('99999');
    expect(diff.divergent.find((d) => d.number === '62000')).toBeTruthy();
  });

  it('reports all canonical accounts missing for an empty entity', async () => {
    const { svc } = setup();
    const diff = await svc.diffFromCanonical(TENANT, 'entity-empty');
    expect(diff.missing).toHaveLength(BP_3_2_MANIFEST.accounts.length);
    expect(diff.extra).toHaveLength(0);
  });
});
