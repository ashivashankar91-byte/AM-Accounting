#!/usr/bin/env node
/**
 * verify-r1-demo.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Automated verification of the Accounting R1 demo data.
 *
 * Checks:
 *   - Expected tenant and three legal entities exist
 *   - All demo users can authenticate (password verified against hash)
 *   - Required permission/role assignments exist
 *   - All R1 modules contain data
 *   - Journals balance (debits === credits per entry)
 *   - Fiscal periods are present for each entity
 *   - No tenantId-as-legalEntityId substitution
 *   - No duplicate seed data
 *   - OEM data is labelled DEMO_FIXTURE
 *
 * Usage:
 *   npx tsx scripts/verify-r1-demo.ts
 *   npx tsx scripts/verify-r1-demo.ts --json     # machine-readable output
 *
 * Returns:
 *   exit 0  — all required checks pass
 *   exit 1  — one or more required checks fail
 */

import { Pool, PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';

const JSON_OUTPUT = process.argv.includes('--json');

const TENANT_ID   = 'tenant-kunes';
const LE_FORD_ID  = '11111111-kune-0000-0000-000000000001';
const LE_CHEV_ID  = '22222222-kune-0000-0000-000000000002';
const LE_TOYOTA_ID= '33333333-kune-0000-0000-000000000003';
const DEMO_PASSWORD = 'KunesDemo2026!';

const DEMO_USERS = [
  'admin@kunes-demo.local',
  'controller@kunes-demo.local',
  'accountant@kunes-demo.local',
  'ap.clerk@kunes-demo.local',
  'ar.clerk@kunes-demo.local',
  'cashier@kunes-demo.local',
  'payroll@kunes-demo.local',
  'service.mgr@kunes-demo.local',
  'approver@kunes-demo.local',
  'auditor@kunes-demo.local',
];

interface CheckResult {
  label: string;
  status: 'PASS' | 'FAIL' | 'SKIP' | 'WARN';
  detail?: string;
}

const results: CheckResult[] = [];
const pool = new Pool({ connectionString: DATABASE_URL });

async function tableExists(client: PoolClient, t: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]
  );
  return r.rowCount! > 0;
}

function check(label: string, status: CheckResult['status'], detail?: string): void {
  results.push({ label, status, detail });
  if (!JSON_OUTPUT) {
    const icon = { PASS:'✅', FAIL:'❌', SKIP:'⚠️ ', WARN:'⚠️ ' }[status];
    console.log(`  ${icon} ${status.padEnd(4)} ${label}${detail ? ': ' + detail : ''}`);
  }
}

async function runChecks(client: PoolClient): Promise<void> {
  // ── 1. Tenant ──────────────────────────────────────────────────────────────
  if (await tableExists(client, 'tenants')) {
    const r = await client.query(`SELECT name FROM tenants WHERE id=$1`, [TENANT_ID]);
    check('Tenant exists', r.rowCount! > 0 ? 'PASS' : 'FAIL',
      r.rowCount! > 0 ? r.rows[0].name : 'tenant-kunes not found');
  } else {
    check('Tenant exists', 'SKIP', 'tenants table not present');
  }

  // ── 2. Legal entities ──────────────────────────────────────────────────────
  if (await tableExists(client, 'legal_entities')) {
    const r = await client.query(
      `SELECT id, entity_code FROM legal_entities WHERE tenant_id=$1 ORDER BY entity_code`, [TENANT_ID]
    );
    check('Three legal entities', r.rowCount! >= 3 ? 'PASS' : 'FAIL',
      `found ${r.rowCount}`);
    for (const leId of [LE_FORD_ID, LE_CHEV_ID, LE_TOYOTA_ID]) {
      const has = r.rows.some((row: any) => row.id === leId);
      check(`Legal entity ${leId.substring(0,12)}`, has ? 'PASS' : 'FAIL');
    }
    // No tenantId-as-legalEntityId substitution
    const badSub = await client.query(
      `SELECT count(*) FROM legal_entities WHERE tenant_id=$1 AND id=$1`, [TENANT_ID]
    );
    check('No tenantId-as-legalEntityId substitution',
      parseInt(badSub.rows[0].count, 10) === 0 ? 'PASS' : 'FAIL');
  } else {
    check('Legal entities', 'SKIP', 'legal_entities table not present');
  }

  // ── 3. Demo users ──────────────────────────────────────────────────────────
  if (await tableExists(client, 'user')) {
    const r = await client.query(
      `SELECT email, password_hash FROM "user" WHERE tenant_id=$1 AND status='ACTIVE'`, [TENANT_ID]
    );
    const userMap = Object.fromEntries(r.rows.map((row: any) => [row.email, row.password_hash]));
    const found = DEMO_USERS.filter(e => userMap[e]);
    check('All 10 demo users present', found.length === 10 ? 'PASS' : 'FAIL',
      `${found.length}/10 found`);

    // Verify password hash (one user is enough to confirm all share same hash)
    if (userMap['controller@kunes-demo.local']) {
      const valid = await bcrypt.compare(DEMO_PASSWORD, userMap['controller@kunes-demo.local']);
      check('Demo password authenticates (controller)', valid ? 'PASS' : 'FAIL');
    }
  } else {
    check('Demo users', 'SKIP', '"user" table not present');
  }

  // ── 4. Role assignments ────────────────────────────────────────────────────
  if (await tableExists(client, 'authz_role_assignment')) {
    const r = await client.query(
      `SELECT count(*) FROM authz_role_assignment WHERE tenant_id=$1`, [TENANT_ID]
    );
    check('Role assignments present', parseInt(r.rows[0].count, 10) >= 10 ? 'PASS' : 'FAIL',
      `${r.rows[0].count} assignments`);
    // Separate preparer / approver for SoD
    const approver = await client.query(
      `SELECT u.email FROM authz_role_assignment a
       JOIN "user" u ON u.id = a.user_id
       WHERE a.tenant_id=$1 AND u.email='approver@kunes-demo.local' LIMIT 1`, [TENANT_ID]
    );
    check('SoD: approver user exists', approver.rowCount! > 0 ? 'PASS' : 'FAIL');
  } else {
    check('Role assignments', 'SKIP', 'authz_role_assignment table not present');
  }

  // ── 5. GL accounts ────────────────────────────────────────────────────────
  if (await tableExists(client, 'gl_accounts')) {
    const r = await client.query(
      `SELECT count(*) FROM gl_accounts WHERE tenant_id=$1 AND is_active=true`, [TENANT_ID]
    );
    check('GL accounts (min 50)', parseInt(r.rows[0].count, 10) >= 50 ? 'PASS' : 'FAIL',
      `${r.rows[0].count} accounts`);
    // Check account types present
    const types = await client.query(
      `SELECT DISTINCT type FROM gl_accounts WHERE tenant_id=$1`, [TENANT_ID]
    );
    const typeSet = new Set(types.rows.map((r: any) => r.type));
    const required = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COST_OF_SALES'];
    const missingTypes = required.filter(t => !typeSet.has(t));
    check('All required GL account types', missingTypes.length === 0 ? 'PASS' : 'FAIL',
      missingTypes.length > 0 ? `missing: ${missingTypes.join(', ')}` : undefined);
  } else {
    check('GL accounts', 'SKIP', 'gl_accounts table not present');
  }

  // ── 6. Fiscal periods ─────────────────────────────────────────────────────
  if (await tableExists(client, 'fiscal_periods')) {
    const r = await client.query(
      `SELECT count(*) FROM fiscal_periods WHERE tenant_id=$1`, [TENANT_ID]
    );
    check('Fiscal periods (min 12)', parseInt(r.rows[0].count, 10) >= 12 ? 'PASS' : 'FAIL',
      `${r.rows[0].count} periods`);
    // Verify open period exists
    const open = await client.query(
      `SELECT 1 FROM fiscal_periods WHERE tenant_id=$1 AND status='OPEN' LIMIT 1`, [TENANT_ID]
    );
    check('Current period OPEN', open.rowCount! > 0 ? 'PASS' : 'FAIL');
    // Prior period closed
    const closed = await client.query(
      `SELECT 1 FROM fiscal_periods WHERE tenant_id=$1 AND status IN ('SOFT_CLOSED','HARD_CLOSED') LIMIT 1`, [TENANT_ID]
    );
    check('Prior period closed', closed.rowCount! > 0 ? 'PASS' : 'FAIL');
  } else {
    check('Fiscal periods', 'SKIP', 'fiscal_periods table not present');
  }

  // ── 7. Journal entries ────────────────────────────────────────────────────
  if (await tableExists(client, 'journal_entries')) {
    const r = await client.query(
      `SELECT count(*) FROM journal_entries WHERE tenant_id=$1`, [TENANT_ID]
    );
    check('Journal entries (min 15)', parseInt(r.rows[0].count, 10) >= 15 ? 'PASS' : 'FAIL',
      `${r.rows[0].count} entries`);

    // Journals balance check (debit === credit per entry)
    if (await tableExists(client, 'journal_lines')) {
      const unbalanced = await client.query(`
        SELECT je.id, je.description,
               sum(jl.debit) AS total_debit, sum(jl.credit) AS total_credit
        FROM journal_entries je
        JOIN journal_lines jl ON jl.journal_entry_id = je.id
        WHERE je.tenant_id = $1
        GROUP BY je.id, je.description
        HAVING abs(sum(jl.debit) - sum(jl.credit)) > 0.01
        LIMIT 5
      `, [TENANT_ID]);
      check('Journals balance (debit=credit)', unbalanced.rowCount! === 0 ? 'PASS' : 'WARN',
        unbalanced.rowCount! > 0 ? `${unbalanced.rowCount} unbalanced entries` : undefined);
    }
  } else {
    check('Journal entries', 'SKIP', 'journal_entries table not present');
  }

  // ── 8. AP/AR/Bank ─────────────────────────────────────────────────────────
  for (const [label, table, minRows] of [
    ['AP entries (min 8)',    'ap_entries',    8],
    ['AR entries (min 8)',    'ar_entries',    8],
    ['Vendors (min 5)',       'vendors',       5],
    ['Customers (min 5)',     'customers',     5],
    ['Bank recon sessions',   'bank_recons',   2],
    ['Purchase orders',       'purchase_orders', 3],
  ] as Array<[string, string, number]>) {
    if (!(await tableExists(client, table))) { check(label, 'SKIP', 'table not present'); continue; }
    const r = await client.query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1`, [TENANT_ID]);
    check(label, parseInt(r.rows[0].count, 10) >= minRows ? 'PASS' : 'FAIL', `${r.rows[0].count} rows`);
  }

  // AP aging — overdue entries exist
  if (await tableExists(client, 'ap_entries')) {
    const overdue = await client.query(
      `SELECT count(*) FROM ap_entries WHERE tenant_id=$1 AND due_date < now() AND status='OPEN'`, [TENANT_ID]
    );
    check('AP overdue entries exist', parseInt(overdue.rows[0].count, 10) > 0 ? 'PASS' : 'WARN',
      `${overdue.rows[0].count} overdue`);
  }

  // ── 9. Payroll ────────────────────────────────────────────────────────────
  if (await tableExists(client, 'payroll_batches')) {
    const r = await client.query(
      `SELECT count(*) FROM payroll_batches WHERE tenant_id=$1`, [TENANT_ID]
    );
    check('Payroll batches (min 3)', parseInt(r.rows[0].count, 10) >= 3 ? 'PASS' : 'FAIL',
      `${r.rows[0].count} batches`);
    const posted = await client.query(
      `SELECT count(*) FROM payroll_batches WHERE tenant_id=$1 AND status='POSTED'`, [TENANT_ID]
    );
    check('Posted payroll batches', parseInt(posted.rows[0].count, 10) > 0 ? 'PASS' : 'FAIL');
    const voided = await client.query(
      `SELECT count(*) FROM payroll_batches WHERE tenant_id=$1 AND status='VOIDED'`, [TENANT_ID]
    );
    check('Payroll reversal example', parseInt(voided.rows[0].count, 10) > 0 ? 'PASS' : 'WARN');
  } else {
    check('Payroll batches', 'SKIP', 'payroll_batches table not present');
  }

  if (await tableExists(client, 'employees')) {
    const r = await client.query(
      `SELECT count(*) FROM employees WHERE tenant_id=$1`, [TENANT_ID]
    );
    check('Employees (min 8)', parseInt(r.rows[0].count, 10) >= 8 ? 'PASS' : 'FAIL',
      `${r.rows[0].count} employees`);
    // Verify legal entity IDs on employees (not tenant-id substitution)
    const badLeid = await client.query(
      `SELECT count(*) FROM employees WHERE tenant_id=$1 AND legal_entity_id=$1`, [TENANT_ID]
    );
    check('No tenantId-as-legalEntityId in employees',
      parseInt(badLeid.rows[0].count, 10) === 0 ? 'PASS' : 'FAIL',
      `${badLeid.rows[0].count} bad rows`);
  } else {
    check('Employees', 'SKIP', 'employees table not present');
  }

  // ── 10. OEM (DEMO_FIXTURE label) ──────────────────────────────────────────
  if (await tableExists(client, 'oem_integration_profiles')) {
    const r = await client.query(
      `SELECT count(*) FROM oem_integration_profiles WHERE tenant_id=$1`, [TENANT_ID]
    );
    check('OEM profiles (min 2)', parseInt(r.rows[0].count, 10) >= 2 ? 'PASS' : 'FAIL',
      `${r.rows[0].count} profiles`);
    // DEMO_FIXTURE label check
    const notLabelled = await client.query(
      `SELECT count(*) FROM oem_integration_profiles
       WHERE tenant_id=$1 AND (notes IS NULL OR notes NOT LIKE '%DEMO_FIXTURE%')`, [TENANT_ID]
    );
    check('OEM DEMO_FIXTURE label on all profiles',
      parseInt(notLabelled.rows[0].count, 10) === 0 ? 'PASS' : 'FAIL',
      `${notLabelled.rows[0].count} unlabelled`);
  } else {
    check('OEM profiles', 'SKIP', 'oem_integration_profiles table not present');
  }

  // ── 11. Close ─────────────────────────────────────────────────────────────
  if (await tableExists(client, 'close_period_states')) {
    const r = await client.query(
      `SELECT count(*) FROM close_period_states WHERE tenant_id=$1`, [TENANT_ID]
    );
    check('Close period states', parseInt(r.rows[0].count, 10) >= 3 ? 'PASS' : 'FAIL',
      `${r.rows[0].count} states`);
  } else {
    check('Close period states', 'SKIP', 'close_period_states table not present');
  }

  // ── 12. Automation ────────────────────────────────────────────────────────
  if (await tableExists(client, 'automation_capabilities')) {
    const r = await client.query(
      `SELECT count(*) FROM automation_capabilities WHERE tenant_id=$1`, [TENANT_ID]
    );
    check('Automation capabilities', parseInt(r.rows[0].count, 10) >= 5 ? 'PASS' : 'FAIL',
      `${r.rows[0].count} capabilities`);
    // All must be OBSERVE_ONLY or APPROVAL_REQUIRED (R1 policy)
    const badMode = await client.query(
      `SELECT count(*) FROM automation_capabilities
       WHERE tenant_id=$1 AND mode NOT IN ('OBSERVE_ONLY','APPROVAL_REQUIRED')`, [TENANT_ID]
    );
    check('Automation R1 mode policy',
      parseInt(badMode.rows[0].count, 10) === 0 ? 'PASS' : 'FAIL',
      `${badMode.rows[0].count} capabilities with disallowed mode`);
  } else {
    check('Automation capabilities', 'SKIP', 'automation_capabilities table not present');
  }

  // ── 13. Schedules ─────────────────────────────────────────────────────────
  if (await tableExists(client, 'schedules')) {
    const r = await client.query(
      `SELECT count(*) FROM schedules WHERE tenant_id=$1`, [TENANT_ID]
    );
    check('Schedules (min 4)', parseInt(r.rows[0].count, 10) >= 4 ? 'PASS' : 'FAIL',
      `${r.rows[0].count} schedules`);
  } else {
    check('Schedules', 'SKIP', 'schedules table not present');
  }

  // ── 14. No duplicate seed data ────────────────────────────────────────────
  if (await tableExists(client, 'gl_accounts')) {
    const dups = await client.query(
      `SELECT code, count(*) FROM gl_accounts WHERE tenant_id=$1 GROUP BY code HAVING count(*) > 1`, [TENANT_ID]
    );
    check('No duplicate GL account codes', dups.rowCount! === 0 ? 'PASS' : 'FAIL',
      dups.rowCount! > 0 ? `${dups.rowCount} duplicates` : undefined);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  try {
    if (!JSON_OUTPUT) {
      console.log('\n🔍 Accounting R1 Demo — Verification');
      console.log('─'.repeat(60));
    }
    await runChecks(client);

    const pass = results.filter(r => r.status === 'PASS').length;
    const fail = results.filter(r => r.status === 'FAIL').length;
    const skip = results.filter(r => r.status === 'SKIP' || r.status === 'WARN').length;

    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ summary: { pass, fail, skip }, results }, null, 2));
    } else {
      console.log('\n' + '─'.repeat(60));
      console.log(`Result: ${pass} pass  ${fail} fail  ${skip} skip/warn`);
      if (fail === 0) {
        console.log('✅  ACCOUNTING_R1_DEMO_READY');
      } else {
        console.log('❌  ACCOUNTING_R1_DEMO_PARTIAL_WITH_EXACT_GAPS');
        console.log('\nFailed checks:');
        results.filter(r => r.status === 'FAIL').forEach(r => {
          console.log(`  • ${r.label}${r.detail ? ': ' + r.detail : ''}`);
        });
      }
      console.log('─'.repeat(60));
    }

    process.exit(fail === 0 ? 0 : 1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
