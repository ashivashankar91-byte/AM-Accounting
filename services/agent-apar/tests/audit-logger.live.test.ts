import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';

// Live-Postgres tests for PostgresAuditLogger (identical implementation
// shared by all 5 agent services — agent-apar used here as the
// representative instance). Requires LIVE_DATABASE_URL pointing at a
// Postgres instance with audit-service's agent_action_logs migration
// applied (services/audit-service/prisma/migrations/
// 20260731000000_add_agent_action_logs), run as a role subject to its RLS
// policies (e.g. amacc_app) so tenant isolation is genuinely exercised, not
// just asserted in application code.
//
// The module under test creates its `pg.Pool` at MODULE LOAD time from
// process.env['DATABASE_URL'] (a module-level singleton, not a per-instance
// connection) — so every test here sets the env var and then dynamically
// re-imports the module (vi.resetModules() + await import()) to get a fresh
// pool bound to the URL that test needs, rather than relying on a static
// top-of-file import that would freeze whichever URL happened to be set
// first.
//
// Run with:
//   LIVE_DATABASE_URL=postgresql://amacc_app:...@localhost:5432/db npx vitest run tests/audit-logger.live.test.ts
const LIVE_URL = process.env['LIVE_DATABASE_URL'];
const describeLive = LIVE_URL ? describe : describe.skip;

async function freshLogger(databaseUrl: string) {
  const { vi } = await import('vitest');
  vi.resetModules();
  process.env['DATABASE_URL'] = databaseUrl;
  const mod = await import('../src/infrastructure/audit-logger');
  return new mod.PostgresAuditLogger();
}

describeLive('PostgresAuditLogger — live Postgres (insert/read, tenant isolation, filtering, restart persistence)', () => {
  const originalDatabaseUrl = process.env['DATABASE_URL'];
  let adminPool: Pool;

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: LIVE_URL });
  });

  afterAll(async () => {
    process.env['DATABASE_URL'] = originalDatabaseUrl;
    await adminPool.end();
  });

  beforeEach(async () => {
    process.env['DATABASE_URL'] = LIVE_URL;
  });

  async function cleanupTenant(tenantId: string) {
    const client = await adminPool.connect();
    try {
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantId]);
      await client.query(`DELETE FROM agent_action_logs WHERE tenant_id = $1`, [tenantId]);
    } finally {
      client.release();
    }
  }

  it('log() persists a real row, and getByTenant() reads it back', async () => {
    const tenantId = 'test-tenant-audit-insert-read';
    await cleanupTenant(tenantId);
    const logger = await freshLogger(LIVE_URL!);

    await logger.log({ agentName: 'gl-integrity', tenantId: tenantId as any, actionTaken: 'JE_REVIEWED', outcome: 'SUCCESS', humanRequired: false, details: { journalId: 'JE-1' } });

    const entries = await logger.getByTenant(tenantId as any);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ agentName: 'gl-integrity', tenantId, actionTaken: 'JE_REVIEWED', outcome: 'SUCCESS', humanRequired: false });
    expect(entries[0].details).toMatchObject({ journalId: 'JE-1' });
    await cleanupTenant(tenantId);
  });

  it('tenant isolation: tenant A cannot see tenant B\'s agent action logs', async () => {
    const tenantA = 'test-tenant-audit-iso-a';
    const tenantB = 'test-tenant-audit-iso-b';
    await cleanupTenant(tenantA);
    await cleanupTenant(tenantB);
    const logger = await freshLogger(LIVE_URL!);

    await logger.log({ agentName: 'eom-orchestration', tenantId: tenantA as any, actionTaken: 'CLOSE_STARTED', outcome: 'SUCCESS', humanRequired: false });
    await logger.log({ agentName: 'eom-orchestration', tenantId: tenantB as any, actionTaken: 'CLOSE_STARTED', outcome: 'SUCCESS', humanRequired: false });

    const aEntries = await logger.getByTenant(tenantA as any);
    const bEntries = await logger.getByTenant(tenantB as any);

    expect(aEntries).toHaveLength(1);
    expect(bEntries).toHaveLength(1);
    expect(aEntries[0].tenantId).toBe(tenantA);
    expect(bEntries[0].tenantId).toBe(tenantB);
    await cleanupTenant(tenantA);
    await cleanupTenant(tenantB);
  });

  it('agent-name filtering: getByTenant(tenantId, limit, agentName) narrows to one agent only', async () => {
    const tenantId = 'test-tenant-audit-filter';
    await cleanupTenant(tenantId);
    const logger = await freshLogger(LIVE_URL!);

    await logger.log({ agentName: 'gl-integrity', tenantId: tenantId as any, actionTaken: 'A', outcome: 'SUCCESS', humanRequired: false });
    await logger.log({ agentName: 'apar-recon', tenantId: tenantId as any, actionTaken: 'B', outcome: 'SUCCESS', humanRequired: false });
    await logger.log({ agentName: 'gl-integrity', tenantId: tenantId as any, actionTaken: 'C', outcome: 'SUCCESS', humanRequired: false });

    const all = await logger.getByTenant(tenantId as any);
    const glOnly = await logger.getByTenant(tenantId as any, 50, 'gl-integrity');

    expect(all).toHaveLength(3);
    expect(glOnly).toHaveLength(2);
    expect(glOnly.every((e: any) => e.agentName === 'gl-integrity')).toBe(true);
    await cleanupTenant(tenantId);
  });

  it('pagination: limit/offset page through results in created_at DESC order', async () => {
    const tenantId = 'test-tenant-audit-page';
    await cleanupTenant(tenantId);
    const logger = await freshLogger(LIVE_URL!);

    for (let i = 0; i < 5; i++) {
      await logger.log({ agentName: 't1-copilot', tenantId: tenantId as any, actionTaken: `ACTION_${i}`, outcome: 'SUCCESS', humanRequired: false });
    }

    const page1 = await logger.getByTenant(tenantId as any, 2, undefined, 0);
    const page2 = await logger.getByTenant(tenantId as any, 2, undefined, 2);

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1.map((e: any) => e.id)).not.toEqual(page2.map((e: any) => e.id));
    await cleanupTenant(tenantId);
  });

  it('restart persistence: a brand-new module instance (fresh pool, simulating a service restart) reads data an earlier instance wrote', async () => {
    const tenantId = 'test-tenant-audit-restart';
    await cleanupTenant(tenantId);
    const beforeRestart = await freshLogger(LIVE_URL!);
    await beforeRestart.log({ agentName: 'payroll-integrity', tenantId: tenantId as any, actionTaken: 'BATCH_REVIEWED', outcome: 'SUCCESS', humanRequired: false });

    // A fresh module import = a fresh `pg.Pool` = exactly what happens on
    // process restart, since this class holds no in-memory state of its
    // own (unlike the InMemoryAuditLogger it replaces, whose whole history
    // was lost on restart).
    const afterRestart = await freshLogger(LIVE_URL!);
    const entries = await afterRestart.getByTenant(tenantId as any);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ agentName: 'payroll-integrity', actionTaken: 'BATCH_REVIEWED' });
    await cleanupTenant(tenantId);
  });

  it('resolveHumanRequired() sets human_required=false and human_resolved_at, scoped to the correct tenant', async () => {
    const tenantId = 'test-tenant-audit-resolve';
    await cleanupTenant(tenantId);
    const logger = await freshLogger(LIVE_URL!);
    await logger.log({ agentName: 'gl-integrity', tenantId: tenantId as any, actionTaken: 'FLAGGED', outcome: 'NEEDS_REVIEW', humanRequired: true });

    const [entry] = await logger.getByTenant(tenantId as any);
    await logger.resolveHumanRequired(entry.id, tenantId);

    const resolved = await logger.getById(entry.id, tenantId);
    expect(resolved?.humanRequired).toBe(false);
    expect(resolved?.humanResolvedAt).not.toBeNull();
    await cleanupTenant(tenantId);
  });
});

describe('PostgresAuditLogger — audit-service/Postgres unavailable', () => {
  it('log() rejects (does not hang) when Postgres is unreachable, so callers can catch and continue', async () => {
    const originalUrl = process.env['DATABASE_URL'];
    const logger = await freshLogger('postgresql://amacc_app:wrong@localhost:1/nonexistent');
    try {
      await expect(
        logger.log({ agentName: 'gl-integrity', tenantId: 'test-tenant' as any, actionTaken: 'X', outcome: 'SUCCESS', humanRequired: false }),
      ).rejects.toThrow();
    } finally {
      process.env['DATABASE_URL'] = originalUrl;
    }
  }, 10_000);
});
