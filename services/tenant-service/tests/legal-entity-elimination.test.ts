import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import {
  LegalEntityService,
  LegalEntityNotFoundError,
  LegalEntityConflictError,
  LegalEntityValidationError,
} from '../src/application/legal-entity-service';

// ── ACC-S003 — Elimination Entity Configuration service tests ────────────────

const TENANT_ID = 'tenant-test-elim';
const ENTITY_ID = 'le-uuid-elim-001';

const BASE_ENTITY = {
  id: ENTITY_ID,
  tenantId: TENANT_ID,
  entityCode: 'ELIM-01',
  legalName: 'Elimination Holdco',
  status: 'ACTIVE',
  version: 1,
  hasPostedJournals: false,
  isElimination: false,
  eliminationChangedAt: null,
  eliminationChangedBy: null,
  eliminationChangeReason: null,
};

function makePrisma(overrides: {
  entityFindFirst?: ReturnType<typeof vi.fn>;
  entityUpdate?: ReturnType<typeof vi.fn>;
  entityUpdateMany?: ReturnType<typeof vi.fn>;
  storeFindMany?: ReturnType<typeof vi.fn>;
  /** Seeds the mutable in-memory row with a non-default starting state
   * (e.g. a different version or isElimination value), while still routing
   * both findFirst and updateMany through the same tracked row so a
   * post-write findFirst reflects the write — unlike `entityFindFirst`,
   * which fully replaces the read behavior (used only for the NotFound
   * case, which short-circuits before any write is attempted). */
  initialRow?: Partial<typeof BASE_ENTITY>;
} = {}) {
  // Mutable in-memory row so the atomic updateMany mock can genuinely
  // enforce "only the request whose expected version still matches the
  // stored version may mutate it" — the same invariant Postgres enforces
  // via `UPDATE ... WHERE version = $expected`.
  const row = { ...BASE_ENTITY, ...overrides.initialRow };

  const client: any = {
    legalEntity: {
      findFirst: overrides.entityFindFirst ?? vi.fn().mockImplementation(async () => ({ ...row })),
      update: overrides.entityUpdate ?? vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...row, ...data })),
      // P1-F1: atomic conditional update — mirrors
      // `updateMany({ where: { id, tenantId, version } })` semantics: the
      // write only takes effect (count 1) when `version` in the WHERE
      // clause still matches the row's current version; otherwise it is a
      // no-op (count 0), exactly like a real Postgres UPDATE ... WHERE
      // version = $expected racing against a concurrent writer.
      updateMany: overrides.entityUpdateMany ?? vi.fn().mockImplementation(async ({ where, data }: any) => {
        if (row.version !== where.version) return { count: 0 };
        if (data.isElimination !== undefined) row.isElimination = data.isElimination;
        if (data.eliminationChangedAt !== undefined) (row as any).eliminationChangedAt = data.eliminationChangedAt;
        if (data.eliminationChangedBy !== undefined) (row as any).eliminationChangedBy = data.eliminationChangedBy;
        if (data.eliminationChangeReason !== undefined) (row as any).eliminationChangeReason = data.eliminationChangeReason;
        if (data.version?.increment) row.version += data.version.increment;
        return { count: 1 };
      }),
    },
    store: {
      findMany: overrides.storeFindMany ?? vi.fn().mockResolvedValue([]),
    },
    tenantOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  client.$transaction = async (arg: any) => (typeof arg === 'function' ? arg(client) : Promise.all(arg));
  return client;
}

function makeService(overrides = {}) {
  const prisma = makePrisma(overrides);
  const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
  const svc = new LegalEntityService(prisma as any, publisher as any);
  return { svc, prisma };
}


describe('LegalEntityService.configureElimination', () => {
  it('flags an entity with no active stores as an elimination entity', async () => {
    const { svc, prisma } = makeService();
    const entity = await svc.configureElimination(TENANT_ID, ENTITY_ID, {
      version: 1, isElimination: true, reason: 'Group restructure — new holdco', actor: 'controller-1',
    });
    expect(entity.isElimination).toBe(true);
    expect(prisma.auditOutboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'ELIMINATION_CHANGED', docType: 'LegalEntity' }) }),
    );
    expect(prisma.tenantOutboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'LEGAL_ENTITY_ELIMINATION_CHANGED' }) }),
    );
  });

  it('throws LegalEntityNotFoundError for a cross-tenant / missing entity', async () => {
    const { svc } = makeService({ entityFindFirst: vi.fn().mockResolvedValue(null) });
    await expect(svc.configureElimination(TENANT_ID, ENTITY_ID, { version: 1, isElimination: true, actor: 'x' }))
      .rejects.toBeInstanceOf(LegalEntityNotFoundError);
  });

  it('throws VERSION_CONFLICT on optimistic-lock mismatch', async () => {
    const { svc } = makeService();
    await expect(svc.configureElimination(TENANT_ID, ENTITY_ID, { version: 99, isElimination: true, actor: 'x' }))
      .rejects.toBeInstanceOf(LegalEntityConflictError);
    await expect(svc.configureElimination(TENANT_ID, ENTITY_ID, { version: 99, isElimination: true, actor: 'x' }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('throws NO_CHANGE when the flag value is unchanged (idempotency guard)', async () => {
    const { svc } = makeService();
    await expect(svc.configureElimination(TENANT_ID, ENTITY_ID, { version: 1, isElimination: false, actor: 'x' }))
      .rejects.toMatchObject({ code: 'NO_CHANGE' });
  });

  it('BR003-2: rejects flagging an entity that owns active stores with 422 OWNS_STORES + ownedStores[]', async () => {
    const storeFindMany = vi.fn().mockResolvedValue([
      { id: 's1', storeCode: '01', storeName: 'Main Store' },
    ]);
    const { svc } = makeService({ storeFindMany });
    try {
      await svc.configureElimination(TENANT_ID, ENTITY_ID, { version: 1, isElimination: true, reason: 'Restructure', actor: 'x' });
      expect.fail('expected OWNS_STORES to throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(LegalEntityValidationError);
      expect(err.code).toBe('OWNS_STORES');
      expect(err.ownedStores).toEqual([{ id: 's1', storeCode: '01', storeName: 'Main Store' }]);
    }
  });

  it('BR003-4: rejects the change with REASON_REQUIRED when no reason is supplied', async () => {
    const { svc } = makeService();
    await expect(svc.configureElimination(TENANT_ID, ENTITY_ID, { version: 1, isElimination: true, actor: 'x' }))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('BR003-4: requires a reason even when the entity has no posted journal activity', async () => {
    const { svc } = makeService({ entityFindFirst: vi.fn().mockResolvedValue({ ...BASE_ENTITY, hasPostedJournals: false }) });
    await expect(svc.configureElimination(TENANT_ID, ENTITY_ID, { version: 1, isElimination: true, actor: 'x' }))
      .rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('BR003-4: accepts the change with a reason when the entity has posted journal activity', async () => {
    const { svc } = makeService({ initialRow: { hasPostedJournals: true } });
    const entity = await svc.configureElimination(TENANT_ID, ENTITY_ID, {
      version: 1, isElimination: true, reason: 'Group restructure — new holdco', actor: 'controller-1',
    });
    expect(entity.isElimination).toBe(true);
    expect(entity.eliminationChangeReason).toBe('Group restructure — new holdco');
  });

  it('unflags an elimination entity back to a normal entity', async () => {
    const { svc } = makeService({ initialRow: { isElimination: true, version: 2 } });
    const entity = await svc.configureElimination(TENANT_ID, ENTITY_ID, {
      version: 2, isElimination: false, reason: 'No longer required for elimination', actor: 'controller-1',
    });
    expect(entity.isElimination).toBe(false);
  });

  // ── P1-F1: atomic optimistic concurrency ──────────────────────────────────

  it('P1-F1: two "simultaneous" configureElimination calls with the SAME expected version — exactly one succeeds, the other gets 409 VERSION_CONFLICT (never a silent lost update)', async () => {
    const { svc, prisma } = makeService();

    const [r1, r2] = await Promise.allSettled([
      svc.configureElimination(TENANT_ID, ENTITY_ID, { version: 1, isElimination: true, reason: 'Racer A', actor: 'user-a' }),
      svc.configureElimination(TENANT_ID, ENTITY_ID, { version: 1, isElimination: true, reason: 'Racer B', actor: 'user-b' }),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
    const rejected   = [r1, r2].filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LegalEntityConflictError);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'VERSION_CONFLICT' });

    // The row itself only ever moved from version 1 -> 2 once — no double
    // apply, no lost update.
    const final = await prisma.legalEntity.findFirst();
    expect(final.version).toBe(2);
    expect(final.isElimination).toBe(true);
  });

  it('P1-F1: a stale expected version (already-superseded by a prior write) is rejected with 409, even on the very first call in the test', async () => {
    const { svc } = makeService({ initialRow: { version: 5 } });
    await expect(
      svc.configureElimination(TENANT_ID, ENTITY_ID, { version: 4, isElimination: true, reason: 'stale caller', actor: 'x' }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });
});
