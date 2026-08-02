/**
 * CE-12 Workstream D — RLS-negative (tenant isolation) live database proof.
 * Same pattern as services/coa-service/tests/live-db/posting-engine-live.
 * test.ts's own RLS-negative section: plain `pg` (not Prisma), single-
 * connection control, a non-superuser amacc_app role whose SELECT/INSERT/
 * UPDATE/DELETE is gated purely by the RLS policies from migration
 * 20260802010001_add_rls_policies_deal_accounting_svc.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_URL = process.env['PG_APP_URL'];

describe.skipIf(!LIVE_DB_URL || !APP_URL)('CE-12 Workstream D — RLS-negative (deal-accounting tables)', () => {
  const SUPER_URL = LIVE_DB_URL!;
  const TENANT_A = `deal-rls-a-${randomUUID()}`;
  const TENANT_B = `deal-rls-b-${randomUUID()}`;
  let dealAId: string;
  let dealBId: string;

  async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    dealAId = randomUUID();
    dealBId = randomUUID();
    await withClient(SUPER_URL, async (c) => {
      const insertDeal = (id: string, tenantId: string, dealNumber: string) => c.query(
        `INSERT INTO deal (id, tenant_id, deal_number, deal_type, stock_number, legal_entity_id, store_id, status, current_recap_version, created_at, updated_at)
         VALUES ($1,$2,$3,'RETAIL','STK-1','entity-1','store-1','DESKED',0,now(),now())`,
        [id, tenantId, dealNumber],
      );
      await insertDeal(dealAId, TENANT_A, `RLS-A-${dealAId}`);
      await insertDeal(dealBId, TENANT_B, `RLS-B-${dealBId}`);
    });
  });

  afterAll(async () => {
    await withClient(SUPER_URL, async (c) => {
      await c.query(`DELETE FROM deal WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
    });
  });

  it('tenant A cannot read tenant B deals', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      const res = await c.query(`SELECT id FROM deal WHERE id = $1`, [dealBId]);
      expect(res.rows).toHaveLength(0);
      const own = await c.query(`SELECT id FROM deal WHERE id = $1`, [dealAId]);
      expect(own.rows).toHaveLength(1);
    });
  });

  it('tenant A cannot update tenant B deals — zero rows affected under tenant A RLS context', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      const res = await c.query(`UPDATE deal SET status = 'POSTED' WHERE id = $1`, [dealBId]);
      expect(res.rowCount).toBe(0);
    });
    // Confirm it truly never changed, from the superuser connection.
    await withClient(SUPER_URL, async (c) => {
      const res = await c.query(`SELECT status FROM deal WHERE id = $1`, [dealBId]);
      expect(res.rows[0].status).toBe('DESKED');
    });
  });

  it('tenant A cannot delete tenant B deals', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      const res = await c.query(`DELETE FROM deal WHERE id = $1`, [dealBId]);
      expect(res.rowCount).toBe(0);
    });
  });

  it('an INSERT under tenant A context with tenant_id = B is rejected by the WITH CHECK policy', async () => {
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_A]);
      await expect(
        c.query(
          `INSERT INTO deal (id, tenant_id, deal_number, deal_type, stock_number, legal_entity_id, store_id, status, current_recap_version, created_at, updated_at)
           VALUES ($1,$2,'cross-tenant-insert','RETAIL','STK-X','entity-1','store-1','DESKED',0,now(),now())`,
          [randomUUID(), TENANT_B],
        ),
      ).rejects.toThrow();
    });
  });

  it('deal_audit_reference is excluded from RLS (background drainer table) — readable across the connection regardless of app.current_tenant_id, filtered only by an explicit WHERE', async () => {
    const auditId = randomUUID();
    await withClient(SUPER_URL, async (c) => {
      await c.query(
        `INSERT INTO deal_audit_reference (id, tenant_id, doc_type, doc_id, action, actor, created_at) VALUES ($1,$2,'DEAL',$3,'TEST','tester',now())`,
        [auditId, TENANT_A, dealAId],
      );
    });
    await withClient(APP_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT_B]);
      // RLS-disabled table: a tenant-B session can still see tenant-A's row if it queries for it explicitly
      // (this table is intentionally NOT tenant-isolated at the RLS layer — the background drainer runs outside
      // any per-request tenant context, exactly like tax_audit_reference/posting_recovery_audit_reference).
      const res = await c.query(`SELECT id FROM deal_audit_reference WHERE id = $1`, [auditId]);
      expect(res.rows).toHaveLength(1);
    });
    await withClient(SUPER_URL, async (c) => {
      await c.query(`DELETE FROM deal_audit_reference WHERE id = $1`, [auditId]);
    });
  });
});
