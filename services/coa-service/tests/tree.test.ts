/**
 * S211 — Account Hierarchy & Totaling Groups unit tests.
 *
 * Strategy: in-memory fake Prisma + fake event publisher via tsyringe (matches
 * S208/S209/S210). Covers the §9 negatives: 422 cycle (BR211-1), 422 non-summary
 * parent (BR211-2), 422 max-depth, 422 unknown parent — plus tree property tests
 * and the effective-dated re-parent trail (BR211-3).
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import crypto from 'crypto';
import {
  AccountService,
  CycleError,
  MaxDepthError,
  ParentNotSummaryError,
  ParentNotFoundError,
} from '../src/application/account-service';
import {
  MAX_TREE_DEPTH,
  buildTree,
  wouldCreateCycle,
  depthOf,
  projectedMaxDepth,
} from '../src/domain/account-tree';

const TENANT = 'tenant-kunes';
const ENTITY = 'a24612ec-d281-4360-a159-9c0debc8610b';
const ACTOR = 'controller-1';

function dec(n: number) {
  return { _v: n, equals: (x: any) => n === Number(x), toString: () => String(n) };
}

function makePrisma(seed: any[] = []) {
  const accounts: any[] = [...seed];
  const audits: any[] = [];
  const outbox: any[] = [];
  const reparents: any[] = [];
  const client: any = {
    _accounts: accounts,
    _audits: audits,
    _outbox: outbox,
    _reparents: reparents,
    glAccount: {
      findUnique: async ({ where }: any) => accounts.find((a) => a.id === where.id) ?? null,
      findMany: async ({ where }: any) =>
        accounts.filter((a) => a.tenantId === where.tenantId && a.entityId === where.entityId),
      update: async ({ where, data }: any) => {
        const row = accounts.find((a) => a.id === where.id);
        for (const [k, v] of Object.entries<any>(data)) {
          if (v && typeof v === 'object' && 'increment' in v) row[k] = (row[k] ?? 0) + v.increment;
          else row[k] = v;
        }
        return row;
      },
    },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    glAccountReparent: { create: async ({ data }: any) => (reparents.push(data), data) },
  };
  client.$transaction = async (arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg);
  return client;

}

function makeEvents() {
  const published: any[] = [];
  return { published, publish: async (e: any) => void published.push(e) };
}

let SEQ = 0;
function acc(over: Partial<any> = {}) {
  SEQ += 1;
  return {
    id: over.id ?? `acc-${SEQ}`,
    tenantId: TENANT,
    entityId: ENTITY,
    accountNumber: over.accountNumber ?? String(10000 + SEQ),
    name: over.name ?? `Acct ${SEQ}`,
    type: 'ASSET',
    normalBalance: 'DR',
    isContra: false,
    contraReason: null,
    postable: over.postable ?? true,
    parentId: over.parentId ?? null,
    parentEffectiveFrom: null,
    status: 'ACTIVE',
    balance: dec(0),
    hasPostings: false,
    version: 1,
    ...over,
  };
}

function setup(seed: any[]) {
  container.reset();
  const prisma = makePrisma(seed);
  const events = makeEvents();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.register('AccountService', { useClass: AccountService });
  return { svc: container.resolve<AccountService>('AccountService'), prisma, events };
}

// ── Domain: pure tree functions ────────────────────────────────────────────────

describe('S211 domain — tree functions', () => {
  const list = [
    { id: 'a', parentId: null, accountNumber: '10000', name: 'A', type: 'ASSET', normalBalance: 'DR', postable: false, status: 'ACTIVE' },
    { id: 'b', parentId: 'a', accountNumber: '10100', name: 'B', type: 'ASSET', normalBalance: 'DR', postable: false, status: 'ACTIVE' },
    { id: 'c', parentId: 'b', accountNumber: '10110', name: 'C', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' },
  ];

  it('buildTree nests children ordered by number', () => {
    const roots = buildTree(list);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('a');
    expect(roots[0].children[0].id).toBe('b');
    expect(roots[0].children[0].children[0].id).toBe('c');
  });

  it('wouldCreateCycle detects self and descendant parents', () => {
    expect(wouldCreateCycle('a', 'a', list)).toBe(true); // self
    expect(wouldCreateCycle('a', 'c', list)).toBe(true); // descendant
    expect(wouldCreateCycle('c', 'a', list)).toBe(false); // ancestor is fine
    expect(wouldCreateCycle('a', null, list)).toBe(false); // detach
  });

  it('depthOf counts from root = 1', () => {
    expect(depthOf('a', list)).toBe(1);
    expect(depthOf('b', list)).toBe(2);
    expect(depthOf('c', list)).toBe(3);
  });

  it('projectedMaxDepth accounts for subtree height', () => {
    // moving root 'a' (subtree height 2) under a level-1 node would reach level 4.
    const withParent = [
      { id: 'p', parentId: null, accountNumber: '20000', name: 'P', type: 'ASSET', normalBalance: 'DR', postable: false, status: 'ACTIVE' },
      ...list,
    ];
    expect(projectedMaxDepth('a', 'p', withParent)).toBe(4);
  });
});

// ── Service: re-parent happy path ───────────────────────────────────────────────

describe('S211 service — reparent', () => {
  it('re-parents a leaf under a summary node, effective-dated, emits event + audit + trail', async () => {
    const parent = acc({ id: 'p1', accountNumber: '10000', name: 'Cash & Equivalents', postable: false });
    const child = acc({ id: 'c1', accountNumber: '10100', name: 'Petty Cash', postable: true, parentId: null });
    const { svc, prisma, events } = setup([parent, child]);

    const updated = await svc.reparent({ tenantId: TENANT, id: 'c1', parentId: 'p1', effectiveFrom: '2026-01-01T00:00:00.000Z', actor: ACTOR });

    expect(updated.parentId).toBe('p1');
    expect(updated.version).toBe(2);
    expect(prisma._reparents).toHaveLength(1);
    expect(prisma._reparents[0]).toMatchObject({ accountId: 'c1', oldParentId: null, newParentId: 'p1' });
    const ev = events.published.find((e) => e.type === 'coa.account.reparented');
    expect(ev.payload).toMatchObject({ accountId: 'c1', newParentId: 'p1', oldParentId: null, schemaV: 1 });
    expect(prisma._audits.find((a) => a.action === 'REPARENT')).toBeTruthy();
  });

  it('detach to root (parentId null) is allowed', async () => {
    const parent = acc({ id: 'p1', accountNumber: '10000', postable: false });
    const child = acc({ id: 'c1', accountNumber: '10100', postable: true, parentId: 'p1' });
    const { svc } = setup([parent, child]);
    const updated = await svc.reparent({ tenantId: TENANT, id: 'c1', parentId: null, actor: ACTOR });
    expect(updated.parentId).toBeNull();
  });

  it('no-op when parent unchanged returns without a new trail row', async () => {
    const parent = acc({ id: 'p1', accountNumber: '10000', postable: false });
    const child = acc({ id: 'c1', accountNumber: '10100', postable: true, parentId: 'p1' });
    const { svc, prisma } = setup([parent, child]);
    await svc.reparent({ tenantId: TENANT, id: 'c1', parentId: 'p1', actor: ACTOR });
    expect(prisma._reparents).toHaveLength(0);
  });

  it('tree() returns nested structure for the entity', async () => {
    const p = acc({ id: 'p1', accountNumber: '10000', postable: false });
    const c = acc({ id: 'c1', accountNumber: '10100', postable: true, parentId: 'p1' });
    const { svc } = setup([p, c]);
    const tree = await svc.tree(TENANT, ENTITY);
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0].id).toBe('c1');
  });
});

// ── Service: negatives (every §9 4xx path) ──────────────────────────────────────

describe('S211 service — negatives', () => {
  it('BR211-1 self-parent → CycleError (422)', async () => {
    const a = acc({ id: 'a1', accountNumber: '10000', postable: false });
    const { svc } = setup([a]);
    await expect(svc.reparent({ tenantId: TENANT, id: 'a1', parentId: 'a1', actor: ACTOR })).rejects.toBeInstanceOf(CycleError);
  });

  it('BR211-1 descendant-parent → CycleError (422)', async () => {
    // a1 (summary) -> b1 (summary) ; try to set a1's parent to b1 → cycle.
    const a = acc({ id: 'a1', accountNumber: '10000', postable: false, parentId: null });
    const b = acc({ id: 'b1', accountNumber: '10100', postable: false, parentId: 'a1' });
    const { svc } = setup([a, b]);
    await expect(svc.reparent({ tenantId: TENANT, id: 'a1', parentId: 'b1', actor: ACTOR })).rejects.toBeInstanceOf(CycleError);
  });

  it('BR211-2 postable parent → ParentNotSummaryError (422)', async () => {
    const parent = acc({ id: 'p1', accountNumber: '10000', postable: true }); // postable!
    const child = acc({ id: 'c1', accountNumber: '10100', postable: true });
    const { svc } = setup([parent, child]);
    await expect(svc.reparent({ tenantId: TENANT, id: 'c1', parentId: 'p1', actor: ACTOR })).rejects.toBeInstanceOf(ParentNotSummaryError);
  });

  it('unknown parent → ParentNotFoundError (422)', async () => {
    const child = acc({ id: 'c1', accountNumber: '10100', postable: true });
    const { svc } = setup([child]);
    await expect(svc.reparent({ tenantId: TENANT, id: 'c1', parentId: 'ghost', actor: ACTOR })).rejects.toBeInstanceOf(ParentNotFoundError);
  });

  it('depth guard → MaxDepthError (422)', async () => {
    // Build a chain of MAX_TREE_DEPTH summary nodes; attaching one more exceeds it.
    const chain: any[] = [];
    let prev: string | null = null;
    for (let i = 0; i < MAX_TREE_DEPTH; i++) {
      const id = `n${i}`;
      chain.push(acc({ id, accountNumber: String(10000 + i), postable: false, parentId: prev }));
      prev = id;
    }
    const leaf = acc({ id: 'leaf', accountNumber: '19999', postable: true, parentId: null });
    const { svc } = setup([...chain, leaf]);
    // deepest summary node is n{MAX-1} at level MAX; leaf under it → level MAX+1.
    await expect(
      svc.reparent({ tenantId: TENANT, id: 'leaf', parentId: `n${MAX_TREE_DEPTH - 1}`, actor: ACTOR }),
    ).rejects.toBeInstanceOf(MaxDepthError);
  });
});
