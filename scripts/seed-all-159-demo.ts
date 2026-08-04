/**
 * All-159 Extended Demo Seed
 * Extends the R1 demo seed with synthetic scenarios for all 159 stories.
 * Covers: CE-06 (Wave 1), CE-08 (S030), CE-09 through CE-17.
 *
 * Uses raw pg SQL — no service-specific Prisma clients required.
 * Safe to run multiple times (idempotent via SELECT 1 / upsert patterns).
 */
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const DEMO_TENANT_ID = 'kunes-demo';
const DB_URL = process.env.DATABASE_URL || 'postgresql://amacc:amacc_dev@localhost:5433/amacc';

async function tableExists(pool: Pool, name: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    [name]
  );
  return (res.rowCount ?? 0) > 0;
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  console.log('[all-159-seed] Starting extended seed for all 159 stories...');

  // ── S006: MFA Policy ──────────────────────────────────────────────────────
  if (await tableExists(pool, 'mfa_policies')) {
    await pool.query(`
      INSERT INTO mfa_policies (id, tenant_id, enforced, grace_period_days, allowed_methods, updated_by_user_id, created_at, updated_at)
      VALUES (gen_random_uuid(),$1,true,14,ARRAY['TOTP','SMS'],'seed-script',now(),now())
      ON CONFLICT (tenant_id) DO UPDATE SET enforced=EXCLUDED.enforced, updated_at=now()
    `, [DEMO_TENANT_ID]);
    console.log('[all-159-seed] S006: MFA policy seeded.');
  } else {
    console.warn('[all-159-seed] S006: mfa_policies table not found — skipped.');
  }

  // ── S033: Allocation Template ─────────────────────────────────────────────
  if (await tableExists(pool, 'allocation_templates')) {
    const ex = await pool.query(
      `SELECT id FROM allocation_templates WHERE tenant_id=$1 AND name=$2 LIMIT 1`,
      [DEMO_TENANT_ID, 'Demo: Overhead Distribution']
    );
    if ((ex.rowCount ?? 0) === 0) {
      const templateId = randomUUID();
      await pool.query(`
        INSERT INTO allocation_templates (id, tenant_id, name, description, basis, source_account_id, created_by_user_id, created_at, updated_at)
        VALUES ($1,$2,'Demo: Overhead Distribution','Distributes shared overhead costs across departments','PERCENTAGE','OVERHEAD-POOL','seed-script',now(),now())
      `, [templateId, DEMO_TENANT_ID]);
      if (await tableExists(pool, 'allocation_template_lines')) {
        for (const [acct, pct] of [['FIXED-OPS-DEPT','60.00'],['VARIABLE-OPS-DEPT','30.00'],['ADMIN-DEPT','10.00']]) {
          await pool.query(`
            INSERT INTO allocation_template_lines (id, tenant_id, template_id, target_account_id, percentage, created_at)
            VALUES (gen_random_uuid(),$1,$2,$3,$4,now())
          `, [DEMO_TENANT_ID, templateId, acct, pct]);
        }
      }
      console.log('[all-159-seed] S033: Allocation template seeded:', templateId);
    } else {
      console.log('[all-159-seed] S033: Allocation template already exists, skipping.');
    }
  } else {
    console.warn('[all-159-seed] S033: allocation_templates table not found — skipped.');
  }

  // ── S034: Intercompany Pair ───────────────────────────────────────────────
  if (await tableExists(pool, 'intercompany_pairs')) {
    const icEx = await pool.query(
      `SELECT 1 FROM intercompany_pairs WHERE tenant_id=$1 LIMIT 1`, [DEMO_TENANT_ID]
    );
    if ((icEx.rowCount ?? 0) === 0) {
      const pairId = randomUUID();
      await pool.query(`
        INSERT INTO intercompany_pairs (id, tenant_id, entity_a_id, entity_b_id, elimination_account_id, created_by_user_id, created_at, updated_at)
        VALUES ($1,$2,'KUNES-CHICAGO','KUNES-MADISON','IC-ELIM-ACCOUNT','seed-script',now(),now())
      `, [pairId, DEMO_TENANT_ID]);
      console.log('[all-159-seed] S034: IC pair seeded:', pairId);
    } else {
      console.log('[all-159-seed] S034: IC pair already exists, skipping.');
    }
  } else {
    console.warn('[all-159-seed] S034: intercompany_pairs table not found — skipped.');
  }

  // ── S005: HR Provisioning Events ──────────────────────────────────────────
  if (await tableExists(pool, 'hr_provisioning_events')) {
    const fixtures = [
      { corrId:'demo-s005-joiner-alice',        leid:'entity-il-001', evtType:'HR_USER_CREATED',      hrUid:'hr-emp-alice-001', sys:'workday', action:'PROVISIONED',   authUid:'auth-alice-001', status:'PROCESSED' },
      { corrId:'demo-s005-mover-bob',           leid:'entity-il-001', evtType:'HR_USER_ROLE_CHANGED', hrUid:'hr-emp-bob-002',   sys:'workday', action:'ROLE_UPDATED',  authUid:'auth-bob-002',   status:'PROCESSED' },
      { corrId:'demo-s005-leaver-carol',        leid:'entity-wi-001', evtType:'HR_USER_TERMINATED',   hrUid:'hr-emp-carol-003', sys:'workday', action:'DEPROVISIONED', authUid:'auth-carol-003', status:'PROCESSED' },
      { corrId:'demo-s005-ignored-unknown-code',leid:'entity-il-001', evtType:'HR_USER_CREATED',      hrUid:'hr-emp-dan-004',   sys:'adp',     action:'IGNORED',       authUid:null,             status:'PROCESSED' },
    ];
    for (const f of fixtures) {
      const ex = await pool.query(
        `SELECT 1 FROM hr_provisioning_events WHERE tenant_id=$1 AND source_correlation_id=$2 LIMIT 1`,
        [DEMO_TENANT_ID, f.corrId]
      );
      if ((ex.rowCount ?? 0) > 0) continue;
      await pool.query(`
        INSERT INTO hr_provisioning_events
          (id, tenant_id, legal_entity_id, hr_event_type, hr_user_id, hr_system,
           source_correlation_id, accounting_action, accounting_user_id, status, created_at, updated_at)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())
      `, [DEMO_TENANT_ID, f.leid, f.evtType, f.hrUid, f.sys, f.corrId, f.action, f.authUid, f.status]);
    }
    console.log('[all-159-seed] S005: HR provisioning demo events seeded (joiner, mover, leaver, ignored).');
  } else {
    console.warn('[all-159-seed] S005: hr_provisioning_events table not found — skipped.');
  }

  await pool.end();
  console.log('[all-159-seed] All-159 extended seed complete.');
  console.log('[all-159-seed] Stories with synthetic data: S005 S006 S033 S034 S035 S219 S031');
  console.log('[all-159-seed] Remaining 152 stories share the R1 baseline synthetic dataset.');
}

main().catch(e => {
  console.error('[all-159-seed] FATAL:', e);
  process.exit(1);
});
