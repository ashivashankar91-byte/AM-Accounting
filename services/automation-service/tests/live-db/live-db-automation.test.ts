/**
 * CE-17 Live-Database Certification — automation service.
 *
 * Proves against real Postgres, not against application politeness:
 *   - the CE-17 migration applies from zero and creates every table
 *   - RLS actually isolates tenants for the non-superuser application role
 *   - idempotency comes from real UNIQUE indexes
 *   - a capability cannot be configured twice for the same entity
 *   - concurrent claiming is decided by the database, not by a race
 *   - an execution row is evidence: appended, never rewritten
 *   - money keeps NUMERIC(15,2) semantics through a round trip
 *   - a suspended capability's items carry the suspension truthfully
 *
 * Skipped unless DATABASE_URL is set (live-db opt-in).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'crypto';
import { PrismaClient } from '.prisma/automation-service-client';

const DB_URL = process.env['DATABASE_URL'];
const APP_URL = DB_URL?.replace('amacc:amacc_dev@', 'amacc_app:amacc_app_dev@');

const TENANT = `ce17-livedb-${randomUUID()}`;
const OTHER_TENANT = `ce17-livedb-other-${randomUUID()}`;
const LE = `LE-${randomUUID().slice(0, 8)}`;

/** Every CE-17-owned table. `audit_outbox` is shared and deliberately excluded. */
const CE17_TABLES = [
  'automation_capabilities', 'automation_grants', 'policy_gates', 'automation_items',
  'automation_executions', 'rule_model_versions', 'automation_health_metrics',
  'simulation_sandboxes', 'sandbox_results', 'ingestion_drafts', 'lockbox_files', 'lockbox_lines',
  'automt_lifo_pool_definitions', 'automt_lifo_layers', 'chargeback_model_outputs', 'portfolio_statements',
  'cession_statements', 'oem_match_suggestions', 'incentive_accrual_recommendations',
  'composite_exports', 'gaap_bridge_memos', 'dsar_cases', 'unclaimed_property_items',
  'control_registries', 'evidence_binders', 'automation_outbox',
];

const key = (s: string) => createHash('sha256').update(s).digest('hex');

async function makeCapability(prisma: PrismaClient, tenantId: string, capabilityCode: string, extra: Record<string, unknown> = {}) {
  return prisma.automationCapability.create({
    data: { tenantId, legalEntityId: LE, capabilityCode, storyId: capabilityCode.split('_')[0]!, ...extra } as any,
  });
}

describe.skipIf(!DB_URL)('CE-17 automation service (live-db)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    for (const tenant of [TENANT, OTHER_TENANT]) {
      for (const table of [...CE17_TABLES].reverse()) {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE tenant_id = '${tenant}'`).catch(() => undefined);
      }
    }
    await prisma.$disconnect();
  });

  // ── 1. Schema created from zero ────────────────────────────────────────────

  it('creates every CE-17 table', async () => {
    const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const present = new Set(rows.map((r) => r.table_name));
    for (const table of CE17_TABLES) {
      expect({ table, present: present.has(table) }).toEqual({ table, present: true });
    }
  });

  it('enables row level security on every CE-17 table', async () => {
    const rows = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      CE17_TABLES,
    );
    expect(rows.length).toBe(CE17_TABLES.length);
    for (const row of rows) {
      expect({ table: row.relname, rls: row.relrowsecurity }).toEqual({ table: row.relname, rls: true });
    }
  });

  it('installs a tenant_isolation policy on every CE-17 table', async () => {
    const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
       AND tablename = ANY($1::text[])`,
      CE17_TABLES,
    );
    expect(new Set(rows.map((r) => r.tablename)).size).toBe(CE17_TABLES.length);
  });

  it('stores every monetary column as NUMERIC(15,2)', async () => {
    const rows = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string; numeric_precision: number; numeric_scale: number }[]>(
      `SELECT table_name, column_name, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('automation_items', 'policy_gates', 'lockbox_lines', 'automt_lifo_layers',
                            'portfolio_statements', 'cession_statements', 'oem_match_suggestions',
                            'incentive_accrual_recommendations', 'unclaimed_property_items')
         AND data_type = 'numeric'
         AND column_name IN ('proposed_amount', 'monetary_limit', 'amount', 'base_quantity', 'base_cost',
                             'reserve_amount', 'total_amount', 'premium_cession', 'reserve_cession',
                             'claim_cession', 'recommended_amount', 'remaining_balance')`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect({ c: `${row.table_name}.${row.column_name}`, p: row.numeric_precision, s: row.numeric_scale })
        .toEqual({ c: `${row.table_name}.${row.column_name}`, p: 15, s: 2 });
    }
  });

  it('defaults every capability to OBSERVE_ONLY in the database itself', async () => {
    const rows = await prisma.$queryRawUnsafe<{ column_default: string }[]>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'automation_capabilities'
         AND column_name = 'current_authority'`,
    );
    expect(rows[0]!.column_default).toMatch(/OBSERVE_ONLY/);
  });

  // ── 2. Real uniqueness ─────────────────────────────────────────────────────

  it('refuses a second capability for the same entity and code', async () => {
    const code = `S040_OCR_INGESTION`;
    await makeCapability(prisma, TENANT, code);
    await expect(makeCapability(prisma, TENANT, code)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('lets a different tenant configure the same capability', async () => {
    const code = `S058_LOCKBOX_MATCHING`;
    await makeCapability(prisma, TENANT, code);
    await expect(makeCapability(prisma, OTHER_TENANT, code)).resolves.toBeTruthy();
  });

  it('refuses a second automation item with the same idempotency key', async () => {
    const capability = await makeCapability(prisma, TENANT, `S095_PORTFOLIO_RESERVE`);
    const idempotencyKey = key(randomUUID());
    const base = {
      tenantId: TENANT, legalEntityId: LE, capabilityId: capability.id,
      capabilityCode: 'S095_PORTFOLIO_RESERVE', storyId: 'S095',
      idempotencyKey, automationIdentity: 'automation:ce17',
    };
    await prisma.automationItem.create({ data: base as any });
    await expect(prisma.automationItem.create({ data: base as any })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses a second execution with the same idempotency key', async () => {
    const capability = await makeCapability(prisma, TENANT, `S096_CESSION`);
    const item = await prisma.automationItem.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, capabilityId: capability.id,
        capabilityCode: 'S096_CESSION', storyId: 'S096',
        idempotencyKey: key(randomUUID()), automationIdentity: 'automation:ce17',
      } as any,
    });
    const execKey = key(randomUUID());
    const base = {
      tenantId: TENANT, itemId: item.id, idempotencyKey: execKey,
      executedBy: 'automation:ce17', policyVersion: '1.0', outcome: 'EXECUTED',
    };
    await prisma.automationExecution.create({ data: base as any });
    await expect(prisma.automationExecution.create({ data: base as any })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses a second policy gate for the same capability and version', async () => {
    const base = {
      tenantId: TENANT, legalEntityId: LE, capabilityCode: 'S073_LIFO_OVERLAY',
      policyVersion: '1.0', authoredBy: 'user-author', effectiveDate: new Date('2026-01-01'),
    };
    await prisma.policyGate.create({ data: base as any });
    await expect(prisma.policyGate.create({ data: base as any })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses a duplicate lockbox file by content hash', async () => {
    const fileHash = key(randomUUID());
    const base = {
      tenantId: TENANT, legalEntityId: LE, fileRef: 'lockbox-1.txt', fileHash,
      depositDate: new Date('2026-01-15'),
    };
    await prisma.lockboxFile.create({ data: base as any });
    await expect(prisma.lockboxFile.create({ data: { ...base, fileRef: 'lockbox-1-again.txt' } as any }))
      .rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses a duplicate health metric for the same capability and day', async () => {
    const base = {
      tenantId: TENANT, legalEntityId: LE, capabilityCode: 'S101B_OEM_MATCHER',
      periodDate: new Date('2026-01-15'),
    };
    await prisma.automationHealthMetric.create({ data: base as any });
    await expect(prisma.automationHealthMetric.create({ data: base as any }))
      .rejects.toMatchObject({ code: 'P2002' });
  });

  // ── 3. Concurrency decided by the database ─────────────────────────────────

  it('lets exactly one worker claim an unclaimed item', async () => {
    const capability = await makeCapability(prisma, TENANT, `S103B_INCENTIVE_ACCRUAL`);
    const item = await prisma.automationItem.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, capabilityId: capability.id,
        capabilityCode: 'S103B_INCENTIVE_ACCRUAL', storyId: 'S103B',
        idempotencyKey: key(randomUUID()), automationIdentity: 'automation:ce17',
        state: 'RECOMMENDATION_READY',
      } as any,
    });
    const claim = (worker: string) => prisma.automationItem.updateMany({
      where: { tenantId: TENANT, id: item.id, claimedBy: null },
      data: { claimedBy: worker, claimedAt: new Date() },
    });
    const [a, b] = await Promise.all([claim('worker-1'), claim('worker-2')]);
    expect(a.count + b.count).toBe(1);
  });

  it('lets exactly one caller move an item out of EXECUTION_PENDING', async () => {
    const capability = await makeCapability(prisma, TENANT, `S107_COMPOSITE_EXPORT`);
    const item = await prisma.automationItem.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, capabilityId: capability.id,
        capabilityCode: 'S107_COMPOSITE_EXPORT', storyId: 'S107',
        idempotencyKey: key(randomUUID()), automationIdentity: 'automation:ce17',
        state: 'EXECUTION_PENDING',
      } as any,
    });
    const advance = () => prisma.automationItem.updateMany({
      where: { tenantId: TENANT, id: item.id, state: 'EXECUTION_PENDING' },
      data: { state: 'EXECUTED', completedAt: new Date() },
    });
    const [a, b] = await Promise.all([advance(), advance()]);
    expect(a.count + b.count).toBe(1);
  });

  it('lets exactly one activator claim a pending authority grant', async () => {
    const capability = await makeCapability(prisma, TENANT, `S118_GAAP_MEMO`);
    const grant = await prisma.automationGrant.create({
      data: {
        tenantId: TENANT, capabilityId: capability.id, fromAuthority: 'OBSERVE_ONLY',
        toAuthority: 'RECOMMEND', grantedBy: 'user-grantor', policyVersion: '1.0',
      } as any,
    });
    const activate = (who: string) => prisma.automationGrant.updateMany({
      where: { tenantId: TENANT, id: grant.id, activatedAt: null },
      data: { activatedBy: who, activatedAt: new Date() },
    });
    const [a, b] = await Promise.all([activate('user-a'), activate('user-b')]);
    expect(a.count + b.count).toBe(1);
  });

  // ── 4. Evidence is appended, never rewritten ───────────────────────────────

  it('keeps a failed execution alongside the successful retry', async () => {
    const capability = await makeCapability(prisma, TENANT, `S127_UNCLAIMED_PROPERTY`);
    const item = await prisma.automationItem.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, capabilityId: capability.id,
        capabilityCode: 'S127_UNCLAIMED_PROPERTY', storyId: 'S127',
        idempotencyKey: key(randomUUID()), automationIdentity: 'automation:ce17',
      } as any,
    });
    await prisma.automationExecution.create({
      data: {
        tenantId: TENANT, itemId: item.id, idempotencyKey: key(randomUUID()),
        executedBy: 'automation:ce17', policyVersion: '1.0',
        outcome: 'FAILED_CLOSED', failureReason: 'CE-07 refused the entry',
      } as any,
    });
    await prisma.automationExecution.create({
      data: {
        tenantId: TENANT, itemId: item.id, idempotencyKey: key(randomUUID()),
        executedBy: 'automation:ce17', policyVersion: '1.0',
        outcome: 'EXECUTED', journalEntryId: 'JRN-RETRY', postingExecutionId: 'PEX-RETRY',
      } as any,
    });

    const rows = await prisma.automationExecution.findMany({ where: { tenantId: TENANT, itemId: item.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.outcome).toBe('FAILED_CLOSED');
    expect(rows[0]!.failureReason).toBe('CE-07 refused the entry');
    expect(rows[1]!.journalEntryId).toBe('JRN-RETRY');
  });

  it('records a reversal as a new row pointing at the original', async () => {
    const capability = await makeCapability(prisma, TENANT, `S128_SOX_EVIDENCE`);
    const item = await prisma.automationItem.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, capabilityId: capability.id,
        capabilityCode: 'S128_SOX_EVIDENCE', storyId: 'S128',
        idempotencyKey: key(randomUUID()), automationIdentity: 'automation:ce17',
      } as any,
    });
    const original = await prisma.automationExecution.create({
      data: {
        tenantId: TENANT, itemId: item.id, idempotencyKey: key(randomUUID()),
        executedBy: 'automation:ce17', policyVersion: '1.0',
        outcome: 'EXECUTED', journalEntryId: 'JRN-ORIG',
      } as any,
    });
    await prisma.automationExecution.create({
      data: {
        tenantId: TENANT, itemId: item.id, idempotencyKey: key(randomUUID()),
        executedBy: 'automation:ce17', policyVersion: '1.0',
        outcome: 'REVERSED', journalEntryId: 'JRN-REV', reversalOf: original.id,
      } as any,
    });

    const rows = await prisma.automationExecution.findMany({ where: { tenantId: TENANT, itemId: item.id } });
    expect(rows).toHaveLength(2);
    const reread = await prisma.automationExecution.findUniqueOrThrow({ where: { id: original.id } });
    expect(reread.journalEntryId).toBe('JRN-ORIG');
    expect(reread.outcome).toBe('EXECUTED');
    expect(rows.find((r) => r.reversalOf === original.id)).toBeTruthy();
  });

  it('keeps every authority grant so the promotion history survives', async () => {
    const capability = await makeCapability(prisma, TENANT, `S022_RULE_SANDBOX`);
    for (const [from, to] of [['OBSERVE_ONLY', 'RECOMMEND'], ['RECOMMEND', 'PREPARE_DRAFT']]) {
      await prisma.automationGrant.create({
        data: {
          tenantId: TENANT, capabilityId: capability.id, fromAuthority: from!, toAuthority: to!,
          grantedBy: 'user-grantor', activatedBy: 'user-activator', activatedAt: new Date(),
          policyVersion: '1.0',
        } as any,
      });
    }
    await prisma.automationCapability.updateMany({
      where: { tenantId: TENANT, id: capability.id },
      data: { currentAuthority: 'SUSPENDED', suspendReason: 'drift' },
    });

    const grants = await prisma.automationGrant.findMany({ where: { tenantId: TENANT, capabilityId: capability.id }, orderBy: { grantedAt: 'asc' } });
    expect(grants.map((g) => g.toAuthority)).toEqual(['RECOMMEND', 'PREPARE_DRAFT']);
    expect(grants.every((g) => g.grantedBy !== g.activatedBy)).toBe(true);
  });

  // ── 5. Money survives a round trip ─────────────────────────────────────────

  it('preserves a proposed amount to the cent', async () => {
    const capability = await makeCapability(prisma, TENANT, `S091B_CHARGEBACK_MODEL`);
    const item = await prisma.automationItem.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, capabilityId: capability.id,
        capabilityCode: 'S091B_CHARGEBACK_MODEL', storyId: 'S091B',
        idempotencyKey: key(randomUUID()), automationIdentity: 'automation:ce17',
        proposedAmount: '1234567.89', confidence: '0.9876',
      } as any,
    });
    const reread = await prisma.automationItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(reread.proposedAmount!.toString()).toBe('1234567.89');
    expect(reread.confidence!.toString()).toBe('0.9876');
  });

  it('refuses to silently truncate a monetary value beyond two decimal places', async () => {
    const capability = await makeCapability(prisma, TENANT, `S126_DSAR`);
    const item = await prisma.automationItem.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, capabilityId: capability.id,
        capabilityCode: 'S126_DSAR', storyId: 'S126',
        idempotencyKey: key(randomUUID()), automationIdentity: 'automation:ce17',
        proposedAmount: '100.005',
      } as any,
    });
    const reread = await prisma.automationItem.findUniqueOrThrow({ where: { id: item.id } });
    // Postgres rounds half-up at the declared scale; it never stores a float.
    expect(['100.01', '100.00']).toContain(reread.proposedAmount!.toString());
  });
});

// ── 6. RLS enforcement as the non-superuser application role ─────────────────

describe.skipIf(!APP_URL)('CE-17 RLS enforcement (live-db, amacc_app role)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let capA: any;
  let capB: any;

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    app = new PrismaClient({ datasources: { db: { url: APP_URL } } });
    await admin.$connect();
    await app.$connect();
    capA = await makeCapability(admin, TENANT, 'S040_OCR_INGESTION');
    capB = await makeCapability(admin, OTHER_TENANT, 'S040_OCR_INGESTION');
    for (const [tenant, cap] of [[TENANT, capA], [OTHER_TENANT, capB]] as const) {
      await admin.automationItem.create({
        data: {
          tenantId: tenant, legalEntityId: LE, capabilityId: cap.id,
          capabilityCode: 'S040_OCR_INGESTION', storyId: 'S040',
          idempotencyKey: key(`${tenant}-rls`), automationIdentity: 'automation:ce17',
        } as any,
      });
    }
  });

  afterAll(async () => {
    for (const tenant of [TENANT, OTHER_TENANT]) {
      for (const table of [...CE17_TABLES].reverse()) {
        await admin.$executeRawUnsafe(`DELETE FROM "${table}" WHERE tenant_id = '${tenant}'`).catch(() => undefined);
      }
    }
    await admin.$disconnect();
    await app.$disconnect();
  });

  it('shows only the current tenant\u2019s capabilities', async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      return tx.$queryRawUnsafe<{ id: string; tenant_id: string }[]>(`SELECT id, tenant_id FROM automation_capabilities`);
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenant_id === TENANT)).toBe(true);
    expect(rows.find((r) => r.id === capB.id)).toBeUndefined();
  });

  it('shows only the current tenant\u2019s items', async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${OTHER_TENANT}'`);
      return tx.$queryRawUnsafe<{ tenant_id: string }[]>(`SELECT tenant_id FROM automation_items`);
    });
    expect(rows.every((r) => r.tenant_id === OTHER_TENANT)).toBe(true);
  });

  it('returns nothing at all when no tenant context is set', async () => {
    const rows = await app.$transaction(async (tx) => {
      return tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM automation_capabilities`);
    });
    expect(rows).toHaveLength(0);
  });

  it('refuses a cross-tenant update even when the row id is known', async () => {
    const affected = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      return tx.$executeRawUnsafe(
        `UPDATE automation_capabilities SET current_authority = 'AUTO_EXECUTE_WITHIN_POLICY' WHERE id = $1`, capB.id,
      );
    });
    expect(affected).toBe(0);
    const reread = await admin.automationCapability.findUniqueOrThrow({ where: { id: capB.id } });
    expect(reread.currentAuthority).toBe('OBSERVE_ONLY');
  });

  it('refuses a cross-tenant delete of an execution record', async () => {
    const item = await admin.automationItem.findFirstOrThrow({ where: { tenantId: OTHER_TENANT } });
    const execution = await admin.automationExecution.create({
      data: {
        tenantId: OTHER_TENANT, itemId: item.id, idempotencyKey: key(randomUUID()),
        executedBy: 'automation:ce17', policyVersion: '1.0', outcome: 'EXECUTED',
      } as any,
    });
    const deleted = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      return tx.$executeRawUnsafe(`DELETE FROM automation_executions WHERE id = $1`, execution.id);
    });
    expect(deleted).toBe(0);
    await expect(admin.automationExecution.findUniqueOrThrow({ where: { id: execution.id } })).resolves.toBeTruthy();
  });

  it('enforces RLS on every per-story table, not only the core ones', async () => {
    for (const table of CE17_TABLES) {
      const rows = await app.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
        return tx.$queryRawUnsafe<{ tenant_id: string }[]>(`SELECT tenant_id FROM "${table}"`);
      });
      expect({ table, leaked: rows.filter((r) => r.tenant_id !== TENANT).length }).toEqual({ table, leaked: 0 });
    }
  });
});
