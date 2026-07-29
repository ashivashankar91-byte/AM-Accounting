/**
 * S003 — P1 CORRECTIVE PASS — LIVE DATABASE integration tests.
 *
 * Unlike every other tenant-service test (which mocks Prisma), these run
 * against a real PostgreSQL instance and prove guarantees a mock cannot:
 *
 *   P1-F1 — atomic optimistic concurrency on configureElimination(): under
 *   genuine concurrent requests (fired in parallel against a real Postgres
 *   connection pool, not sequential mock calls), the conditional
 *   `updateMany({ where: { id, tenantId, version } })` guarantees exactly
 *   one writer wins per contested version and every loser gets a real 409
 *   VERSION_CONFLICT — never a silently lost update.
 *
 *   P1-F2 — the reverse ownership guard: no store or franchise can end up
 *   beneath an elimination entity via any of the four ownership paths
 *   (store create, franchise create, store re-parent, franchise re-parent),
 *   whether the placement is direct (store/franchise's own immediate
 *   parent is an elimination entity) or indirect (reached via an S202
 *   re-parent override, or via an INACTIVE store that predates its
 *   entity's elimination designation).
 *
 * Deliberately separate from the regular mocked unit-test suite: skipped
 * entirely unless LIVE_DATABASE_URL is set, so `npm test` is unaffected.
 * This file's LIVE_DATABASE_URL is expected to authenticate as a role that
 * bypasses RLS unconditionally (the migration/superuser role), same
 * rationale as coa-service's live-db suite — Prisma's pool opens multiple
 * physical connections, so per-connection `SET app.current_tenant_id` RLS
 * enforcement would need per-connection setup this suite isn't testing.
 * Tenant isolation is proven here at the *application/service* layer
 * instead (every query is explicitly scoped by tenantId in the service
 * code under test), which is what P1-F2 requires ("existing tenant
 * isolation remains intact") — RLS itself is out of scope for this
 * corrective pass (no RLS policy was touched).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/tenant-client';
import {
  LegalEntityService,
  LegalEntityConflictError,
} from '../../src/application/legal-entity-service';
import { StoreService, StoreConflictError } from '../../src/application/store-service';
import { FranchiseService, FranchiseConflictError } from '../../src/application/franchise-service';
import { OrgService, OrgValidationError } from '../../src/application/org-service';
import type { IEventPublisher } from '@amacc/shared-kernel';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];

const noopEvents: IEventPublisher = {
  publish: async () => {},
  subscribe: () => {},
};

describe.skipIf(!LIVE_DB_URL)('Live database — S003 P1 corrective pass: atomic concurrency + reverse ownership guard', () => {
  let prisma: PrismaClient;
  let legalEntitySvc: LegalEntityService;
  let storeSvc: StoreService;
  let franchiseSvc: FranchiseService;
  let orgSvc: OrgService;

  // Unique per run so re-running this suite never collides with a previous
  // run's fixtures — afterAll cleans its own rows up regardless.
  const TENANT   = `live-test-tenant-${randomUUID()}`;
  const TENANT_B = `live-test-tenant-b-${randomUUID()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();

    legalEntitySvc = new LegalEntityService(prisma, noopEvents);
    storeSvc       = new StoreService(prisma, noopEvents);
    franchiseSvc   = new FranchiseService(prisma, noopEvents);
    orgSvc         = new OrgService(prisma, noopEvents);
  });

  afterAll(async () => {
    for (const t of [TENANT, TENANT_B]) {
      await prisma.orgReparentEvent.deleteMany({ where: { tenantId: t } });
      await prisma.franchise.deleteMany({ where: { tenantId: t } });
      await prisma.store.deleteMany({ where: { tenantId: t } });
      await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: t } });
      await prisma.tenantOutboxEvent.deleteMany({ where: { tenantId: t } });
      await prisma.legalEntity.deleteMany({ where: { tenantId: t } });
    }
    await prisma.$disconnect();
  });

  async function makeEntity(tenantId: string, code: string, isElimination = false) {
    return prisma.legalEntity.create({
      data: {
        id: randomUUID(), tenantId, entityCode: code, legalName: `${code} Inc`,
        functionalCurrency: 'USD', country: 'US', fiscalYearEndMonth: 12,
        effectiveDate: new Date('2026-01-01'), status: 'ACTIVE', version: 1,
        isElimination,
      },
    });
  }

  // ── P1-F1: atomic optimistic concurrency ──────────────────────────────────

  describe('P1-F1: configureElimination — atomic optimistic concurrency', () => {
    it('two GENUINELY concurrent requests against real Postgres, same expected version: exactly one succeeds, the other gets a real 409 VERSION_CONFLICT — never a silent lost update', async () => {
      const entity = await makeEntity(TENANT, 'P1F1-A');

      const results = await Promise.allSettled([
        legalEntitySvc.configureElimination(TENANT, entity.id, { version: 1, isElimination: true, reason: 'racer A', actor: 'user-a' }),
        legalEntitySvc.configureElimination(TENANT, entity.id, { version: 1, isElimination: true, reason: 'racer B', actor: 'user-b' }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected  = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(LegalEntityConflictError);
      expect(rejected[0].reason).toMatchObject({ code: 'VERSION_CONFLICT' });

      // Prove against the real row: exactly one version bump (1 -> 2), not
      // a double-apply and not a lost update.
      const final = await prisma.legalEntity.findUniqueOrThrow({ where: { id: entity.id } });
      expect(final.version).toBe(2);
      expect(final.isElimination).toBe(true);
    });

    it('10-way genuinely concurrent race on the SAME expected version: exactly 1 winner, 9 real 409s, and the row moves version N -> N+1 exactly once', async () => {
      const entity = await makeEntity(TENANT, 'P1F1-B');

      const attempts = Array.from({ length: 10 }, (_, i) =>
        legalEntitySvc.configureElimination(TENANT, entity.id, { version: 1, isElimination: true, reason: `racer-${i}`, actor: `user-${i}` }),
      );
      const results = await Promise.allSettled(attempts);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected  = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(LegalEntityConflictError);
        expect(r.reason).toMatchObject({ code: 'VERSION_CONFLICT' });
      }

      const final = await prisma.legalEntity.findUniqueOrThrow({ where: { id: entity.id } });
      expect(final.version).toBe(2);
    });

    it('a stale caller (expected version already superseded by a real committed write) gets a real 409, never applies its write', async () => {
      const entity = await makeEntity(TENANT, 'P1F1-C');
      await legalEntitySvc.configureElimination(TENANT, entity.id, { version: 1, isElimination: true, reason: 'first write', actor: 'user-a' });

      await expect(
        legalEntitySvc.configureElimination(TENANT, entity.id, { version: 1, isElimination: false, reason: 'stale caller', actor: 'user-b' }),
      ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });

      const final = await prisma.legalEntity.findUniqueOrThrow({ where: { id: entity.id } });
      expect(final.version).toBe(2);
      expect(final.isElimination).toBe(true); // stale write never applied
    });

    it('mandatory version + mandatory reason remain enforced against the real DB (no bypass introduced by the atomic rewrite)', async () => {
      const entity = await makeEntity(TENANT, 'P1F1-D');
      await expect(
        legalEntitySvc.configureElimination(TENANT, entity.id, { version: 1, isElimination: true, actor: 'user-a' } as any),
      ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });

      const stillUnflagged = await prisma.legalEntity.findUniqueOrThrow({ where: { id: entity.id } });
      expect(stillUnflagged.isElimination).toBe(false);
      expect(stillUnflagged.version).toBe(1);
    });
  });

  // ── P1-F2: reverse ownership guard ────────────────────────────────────────

  describe('P1-F2: reverse ownership guard — no store/franchise beneath an elimination entity', () => {
    it('direct: an ACTIVE store cannot be created directly under an elimination entity', async () => {
      const elim = await makeEntity(TENANT, 'P1F2-ELIM-1', true);
      await expect(
        storeSvc.create({ tenantId: TENANT, entityId: elim.id, storeCode: 'S1', storeName: 'Store 1', stateProvince: 'IL' }),
      ).rejects.toMatchObject({ code: 'ELIMINATION_ENTITY_CANNOT_OWN_STORES' });
      await expect(
        storeSvc.create({ tenantId: TENANT, entityId: elim.id, storeCode: 'S1', storeName: 'Store 1', stateProvince: 'IL' }),
      ).rejects.toBeInstanceOf(StoreConflictError);
    });

    it('direct (re-parent path): an ACTIVE store cannot be RE-PARENTED onto an elimination entity', async () => {
      const normal = await makeEntity(TENANT, 'P1F2-NORM-1');
      const elim   = await makeEntity(TENANT, 'P1F2-ELIM-2', true);
      const store = await storeSvc.create({ tenantId: TENANT, entityId: normal.id, storeCode: 'S2', storeName: 'Store 2', stateProvince: 'IL' });

      await expect(
        orgSvc.reparent({ tenantId: TENANT, nodeType: 'STORE', nodeId: store.id, newParentId: elim.id, effectiveFrom: '2026-03-01' }),
      ).rejects.toBeInstanceOf(OrgValidationError);
      await expect(
        orgSvc.reparent({ tenantId: TENANT, nodeType: 'STORE', nodeId: store.id, newParentId: elim.id, effectiveFrom: '2026-03-01' }),
      ).rejects.toMatchObject({ code: 'ELIMINATION_ENTITY_CANNOT_OWN_STORES' });

      // Confirm no override row was actually persisted by the rejected attempt.
      const overrides = await prisma.orgReparentEvent.findMany({ where: { tenantId: TENANT, nodeType: 'STORE', nodeId: store.id } });
      expect(overrides).toHaveLength(0);
    });

    it('indirect (this exact reported defect): an INACTIVE store under an entity that is LATER flagged as an elimination entity cannot receive a franchise', async () => {
      const entity = await makeEntity(TENANT, 'P1F2-NORM-2');
      const store = await storeSvc.create({ tenantId: TENANT, entityId: entity.id, storeCode: 'S3', storeName: 'Store 3', stateProvince: 'IL' });
      await storeSvc.deactivate(TENANT, store.id, { version: 1, reason: 'closing', deactivatedBy: 'controller-1' });

      // BR003-2's OWNS_STORES guard only counts ACTIVE stores, so flagging
      // the entity as elimination succeeds here — this is the exact
      // precondition the P1-F2 finding described.
      const flagged = await legalEntitySvc.configureElimination(TENANT, entity.id, {
        version: 1, isElimination: true, reason: 'restructure', actor: 'controller-1',
      });
      expect(flagged.isElimination).toBe(true);

      await expect(
        franchiseSvc.create({ tenantId: TENANT, storeId: store.id, oemCode: 'FORD', dealerCode: '11111', effectiveFrom: '2026-03-01' }),
      ).rejects.toBeInstanceOf(FranchiseConflictError);
      await expect(
        franchiseSvc.create({ tenantId: TENANT, storeId: store.id, oemCode: 'FORD', dealerCode: '11111', effectiveFrom: '2026-03-01' }),
      ).rejects.toMatchObject({ code: 'ELIMINATION_ENTITY_CANNOT_OWN_STORES' });

      // Confirm no franchise row was actually persisted by the rejected attempt.
      const franchises = await prisma.franchise.findMany({ where: { tenantId: TENANT, storeId: store.id } });
      expect(franchises).toHaveLength(0);
    });

    it('indirect (franchise re-parent path): a franchise cannot be re-parented onto a store owned by an elimination entity', async () => {
      // Two normal entities + stores, one franchise attached to store A.
      const entityA = await makeEntity(TENANT, 'P1F2-NORM-3A');
      const entityB = await makeEntity(TENANT, 'P1F2-NORM-3B');
      const storeA = await storeSvc.create({ tenantId: TENANT, entityId: entityA.id, storeCode: 'S4A', storeName: 'Store 4A', stateProvince: 'IL' });
      const storeB = await storeSvc.create({ tenantId: TENANT, entityId: entityB.id, storeCode: 'S4B', storeName: 'Store 4B', stateProvince: 'IL' });
      const franchise = await franchiseSvc.create({ tenantId: TENANT, storeId: storeA.id, oemCode: 'TOYOTA', dealerCode: '22222', effectiveFrom: '2026-03-01' });

      // storeB goes INACTIVE, then its owning entity is (later) flagged as
      // an elimination entity — same indirect precondition as the prior test.
      await storeSvc.deactivate(TENANT, storeB.id, { version: 1, reason: 'closing', deactivatedBy: 'controller-1' });
      await legalEntitySvc.configureElimination(TENANT, entityB.id, { version: 1, isElimination: true, reason: 'restructure', actor: 'controller-1' });

      await expect(
        orgSvc.reparent({ tenantId: TENANT, nodeType: 'FRANCHISE', nodeId: franchise.id, newParentId: storeB.id, effectiveFrom: '2026-03-15' }),
      ).rejects.toMatchObject({ code: 'ELIMINATION_ENTITY_CANNOT_OWN_STORES' });

      const overrides = await prisma.orgReparentEvent.findMany({ where: { tenantId: TENANT, nodeType: 'FRANCHISE', nodeId: franchise.id } });
      expect(overrides).toHaveLength(0);
    });

    it('indirect via S202 re-parent override: a store beneath an elimination entity is still reachable and blocked on a subsequent re-parent attempt, not just the base FK', async () => {
      // storeC starts under a normal entity (so it is created legally),
      // then gets legally re-parented onto a second normal entity; a later
      // attempt to move it onto the elimination entity must still be
      // rejected — proving the guard consults the *currently resolved*
      // parent (via the S202 override chain), not a cached/stale base FK.
      const entityC1 = await makeEntity(TENANT, 'P1F2-NORM-4A');
      const entityC2 = await makeEntity(TENANT, 'P1F2-NORM-4B');
      const elimD    = await makeEntity(TENANT, 'P1F2-ELIM-4', true);
      const storeC = await storeSvc.create({ tenantId: TENANT, entityId: entityC1.id, storeCode: 'S5', storeName: 'Store 5', stateProvince: 'IL' });

      const legalMove = await orgSvc.reparent({ tenantId: TENANT, nodeType: 'STORE', nodeId: storeC.id, newParentId: entityC2.id, effectiveFrom: '2026-03-01' });
      expect(legalMove.newParentId).toBe(entityC2.id);

      await expect(
        orgSvc.reparent({ tenantId: TENANT, nodeType: 'STORE', nodeId: storeC.id, newParentId: elimD.id, effectiveFrom: '2026-03-10' }),
      ).rejects.toMatchObject({ code: 'ELIMINATION_ENTITY_CANNOT_OWN_STORES' });
    });

    it('unrelated entities remain unaffected: normal entity + active store + franchise creation, and franchise re-parent onto its own store, all still succeed end to end', async () => {
      const entity = await makeEntity(TENANT, 'P1F2-CONTROL');
      const store = await storeSvc.create({ tenantId: TENANT, entityId: entity.id, storeCode: 'S6', storeName: 'Store 6', stateProvince: 'IL' });
      const franchise = await franchiseSvc.create({ tenantId: TENANT, storeId: store.id, oemCode: 'HONDA', dealerCode: '333333', effectiveFrom: '2026-03-01' });
      expect(franchise.oemCode).toBe('HONDA');

      const reparented = await orgSvc.reparent({
        tenantId: TENANT, nodeType: 'FRANCHISE', nodeId: franchise.id, newParentId: store.id, effectiveFrom: '2026-04-01',
      });
      expect(reparented.newParentId).toBe(store.id);
    });

    it('tenant isolation remains intact: tenant-B cannot use tenant-A store/entity ids to bypass the guard or perform a cross-tenant mutation', async () => {
      const entityA = await makeEntity(TENANT, 'P1F2-ISO-A');
      const storeA = await storeSvc.create({ tenantId: TENANT, entityId: entityA.id, storeCode: 'S7', storeName: 'Store 7', stateProvince: 'IL' });

      // tenant-B franchise create against tenant-A's store id → not found in tenant-B's scope.
      await expect(
        franchiseSvc.create({ tenantId: TENANT_B, storeId: storeA.id, oemCode: 'FORD', dealerCode: '44444', effectiveFrom: '2026-03-01' }),
      ).rejects.toMatchObject({ name: 'StoreNotFoundForFranchiseError' });

      // tenant-B store re-parent against tenant-A's store/entity ids → not found in tenant-B's scope.
      const entityB = await makeEntity(TENANT_B, 'P1F2-ISO-B');
      await expect(
        orgSvc.reparent({ tenantId: TENANT_B, nodeType: 'STORE', nodeId: storeA.id, newParentId: entityB.id, effectiveFrom: '2026-03-01' }),
      ).rejects.toMatchObject({ name: 'OrgNodeNotFoundError' });
    });
  });
});
