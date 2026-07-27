/**
 * S202 — Org Service Unit Tests
 *
 * Tests OrgService in isolation with an in-memory Prisma fake (no database).
 * Covers: tree assembly (GROUP->ENTITY->STORE->FRANCHISE), tenant scoping,
 * re-parent (effective-dated override, BR202-2), BR202-1 cycle rejection,
 * CSV export row parity (BR202-3).
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  OrgService,
  OrgNodeNotFoundError,
  OrgValidationError,
  orgTreeToCsv,
} from '../src/application/org-service';

const T1 = 'tenant-1';
const T2 = 'tenant-2';

interface Db {
  legalEntity: any[];
  store: any[];
  franchise: any[];
  orgReparentEvent: any[];
  tenantOutboxEvent: any[];
  auditOutboxEvent: any[];
}

function seedDb(): Db {
  return {
    legalEntity: [
      { id: 'e1', tenantId: T1, entityCode: 'E1', legalName: 'Entity One', status: 'ACTIVE', effectiveDate: new Date('2026-01-01T00:00:00.000Z') },
      { id: 'e2', tenantId: T1, entityCode: 'E2', legalName: 'Entity Two', status: 'ACTIVE', effectiveDate: new Date('2026-01-01T00:00:00.000Z') },
      { id: 'e9', tenantId: T2, entityCode: 'E9', legalName: 'Other Tenant Entity', status: 'ACTIVE', effectiveDate: new Date('2026-01-01T00:00:00.000Z') },
    ],
    store: [
      { id: 's1', tenantId: T1, entityId: 'e1', storeCode: 'S1', storeName: 'Store One', status: 'ACTIVE' },
      { id: 's9', tenantId: T2, entityId: 'e9', storeCode: 'S9', storeName: 'Other Tenant Store', status: 'ACTIVE' },
    ],
    franchise: [
      { id: 'f1', tenantId: T1, storeId: 's1', oemCode: 'FORD', dealerCode: '12345', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null },
    ],
    orgReparentEvent: [],
    tenantOutboxEvent: [],
    auditOutboxEvent: [],
  };
}

function makePrisma(db: Db) {
  const client: any = {
    legalEntity: {
      findMany: async ({ where }: any) => db.legalEntity.filter((r) => r.tenantId === where.tenantId),
      findFirst: async ({ where }: any) => db.legalEntity.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
    },
    store: {
      findMany: async ({ where }: any) => db.store.filter((r) => r.tenantId === where.tenantId),
      findFirst: async ({ where }: any) => db.store.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
    },
    franchise: {
      findMany: async ({ where }: any) => db.franchise.filter((r) => r.tenantId === where.tenantId),
      findFirst: async ({ where }: any) => db.franchise.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
    },
    orgReparentEvent: {
      findMany: async ({ where }: any) => db.orgReparentEvent
        .filter((r) => r.tenantId === where.tenantId && r.effectiveFrom.getTime() <= where.effectiveFrom.lte.getTime()),
      findFirst: async ({ where }: any) => {
        const matches = db.orgReparentEvent.filter((r) =>
          r.tenantId === where.tenantId && r.nodeType === where.nodeType && r.nodeId === where.nodeId &&
          r.effectiveFrom.getTime() <= where.effectiveFrom.lte.getTime(),
        );
        if (matches.length === 0) return null;
        matches.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
        return matches[0];
      },
      create: async ({ data }: any) => {
        const row = { ...data, createdAt: new Date() };
        db.orgReparentEvent.push(row);
        return row;
      },
    },
    tenantOutboxEvent: { create: async ({ data }: any) => { db.tenantOutboxEvent.push(data); return data; } },
    auditOutboxEvent: { create: async ({ data }: any) => { db.auditOutboxEvent.push(data); return data; } },
  };
  client.$transaction = async (fn: any) => fn(client);
  return client;
}

function noopPublisher() { return { publish: async () => {} }; }

describe('OrgService.getTree (S202)', () => {
  let db: Db;
  let svc: OrgService;

  beforeEach(() => {
    db = seedDb();
    svc = new OrgService(makePrisma(db), noopPublisher());
  });

  it('assembles a full GROUP->ENTITY->STORE->FRANCHISE tree for the tenant', async () => {
    const tree = await svc.getTree(T1);
    expect(tree.type).toBe('GROUP');
    expect(tree.children.map((c) => c.id).sort()).toEqual(['e1', 'e2']);
    const entityOne = tree.children.find((c) => c.id === 'e1')!;
    expect(entityOne.children.map((c) => c.id)).toEqual(['s1']);
    const storeOne = entityOne.children[0];
    expect(storeOne.children.map((c) => c.id)).toEqual(['f1']);
  });

  it('never leaks another tenant\'s nodes into the tree', async () => {
    const tree = await svc.getTree(T1);
    const allIds = flattenIds(tree);
    expect(allIds).not.toContain('e9');
    expect(allIds).not.toContain('s9');
  });

  it('a tenant with no data at all resolves to an empty GROUP root (no 404/throw)', async () => {
    const tree = await svc.getTree('tenant-empty');
    expect(tree.type).toBe('GROUP');
    expect(tree.children).toEqual([]);
  });
});

describe('OrgService.reparent (S202 BR202-1/BR202-2)', () => {
  let db: Db;
  let svc: OrgService;

  beforeEach(() => {
    db = seedDb();
    svc = new OrgService(makePrisma(db), noopPublisher());
  });

  it('re-parents a STORE to a different ENTITY, recorded as an effective-dated override', async () => {
    const result = await svc.reparent({
      tenantId: T1, nodeType: 'STORE', nodeId: 's1', newParentId: 'e2',
      effectiveFrom: '2026-02-01', actor: 'cfo-1',
    });
    expect(result).toMatchObject({ nodeType: 'STORE', nodeId: 's1', oldParentId: 'e1', newParentId: 'e2' });

    const tree = await svc.getTree(T1, '2026-02-01');
    const entityTwo = tree.children.find((c) => c.id === 'e2')!;
    expect(entityTwo.children.map((c) => c.id)).toEqual(['s1']);
    const entityOne = tree.children.find((c) => c.id === 'e1')!;
    expect(entityOne.children).toEqual([]);
  });

  it('a re-parent as-of BEFORE its effective date does not yet apply (effective-dated, BR202-2)', async () => {
    await svc.reparent({
      tenantId: T1, nodeType: 'STORE', nodeId: 's1', newParentId: 'e2',
      effectiveFrom: '2026-06-01', actor: 'cfo-1',
    });
    const treeBefore = await svc.getTree(T1, '2026-03-01');
    const entityOneBefore = treeBefore.children.find((c) => c.id === 'e1')!;
    expect(entityOneBefore.children.map((c) => c.id)).toEqual(['s1']); // still under e1

    const treeAfter = await svc.getTree(T1, '2026-06-01');
    const entityTwoAfter = treeAfter.children.find((c) => c.id === 'e2')!;
    expect(entityTwoAfter.children.map((c) => c.id)).toEqual(['s1']);
  });

  it('writes an audit record (before/after images) alongside the reparent, in the same transaction', async () => {
    await svc.reparent({
      tenantId: T1, nodeType: 'STORE', nodeId: 's1', newParentId: 'e2',
      effectiveFrom: '2026-02-01', actor: 'cfo-1',
    });
    expect(db.auditOutboxEvent).toHaveLength(1);
    expect(db.auditOutboxEvent[0]).toMatchObject({
      tenantId: T1, docType: 'OrgNode', docId: 's1', action: 'REPARENT',
      before: { parentId: 'e1' }, after: { parentId: 'e2', effectiveFrom: '2026-02-01' },
    });
  });

  it('emits org.node.reparented to the tenant outbox', async () => {
    await svc.reparent({
      tenantId: T1, nodeType: 'STORE', nodeId: 's1', newParentId: 'e2',
      effectiveFrom: '2026-02-01', actor: 'cfo-1',
    });
    expect(db.tenantOutboxEvent).toHaveLength(1);
    expect(db.tenantOutboxEvent[0].eventType).toBe('org.node.reparented');
  });

  it('BR202-1: rejects a self-parent as a cycle (422)', async () => {
    await expect(svc.reparent({
      tenantId: T1, nodeType: 'STORE', nodeId: 's1', newParentId: 's1',
      effectiveFrom: '2026-02-01',
    })).rejects.toThrow(OrgValidationError);
  });

  it('rejects a re-parent to a parent of the wrong type (STORE target must be an ENTITY)', async () => {
    await expect(svc.reparent({
      tenantId: T1, nodeType: 'STORE', nodeId: 's1', newParentId: 'f1', // franchise, not an entity
      effectiveFrom: '2026-02-01',
    })).rejects.toThrow(OrgValidationError);
  });

  it('rejects re-parenting a node that does not exist in the tenant (404)', async () => {
    await expect(svc.reparent({
      tenantId: T1, nodeType: 'STORE', nodeId: 'no-such-store', newParentId: 'e2',
      effectiveFrom: '2026-02-01',
    })).rejects.toThrow(OrgNodeNotFoundError);
  });

  it('rejects cross-tenant reparent: a T1 store cannot be re-parented using a T2 entity id', async () => {
    await expect(svc.reparent({
      tenantId: T1, nodeType: 'STORE', nodeId: 's1', newParentId: 'e9',
      effectiveFrom: '2026-02-01',
    })).rejects.toThrow(OrgValidationError);
  });
});

describe('orgTreeToCsv (S202 BR202-3)', () => {
  it('produces one row per node, matching the tree exactly', async () => {
    const db = seedDb();
    const svc = new OrgService(makePrisma(db), noopPublisher());
    const tree = await svc.getTree(T1);
    const rows = await svc.toCsvRows(tree);
    const csv = orgTreeToCsv(rows);
    const lines = csv.split('\n');
    // header + GROUP + e1 + e2 + s1 + f1 = 6 lines
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('type,id,parentId,code,name,status,effectiveFrom,effectiveTo');
    expect(csv).toContain('FRANCHISE,f1,s1,12345');
  });
});

function flattenIds(node: any): string[] {
  return [node.id, ...node.children.flatMap(flattenIds)];
}
