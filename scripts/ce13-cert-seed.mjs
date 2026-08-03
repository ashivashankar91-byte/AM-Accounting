#!/usr/bin/env node
// CE-13 Playwright certification fixture seed — bootstrap-only data (users,
// role grants, legal entities, GL accounts) that has no bootstrapping path
// through the real HTTP APIs themselves (creating the first user/role
// requires an already-authenticated user; see auth-service's
// USER_PERMISSIONS.MANAGE/ROLE_PERMISSIONS.MANAGE guards). Everything the
// certification spec itself can create through a real, authenticated API
// call (employees, batches, rule packs, GL mappings, commission plans,
// clawbacks, accruals) is left to the spec to create live — this script
// only seeds what nothing else can. Mirrors scripts/seed.ts's direct-`pg`
// convention (tenant_id/legal_entity_id are plain slugs/uuids, no FK to
// tenant-service's own Tenant row — confirmed via
// services/auth-service/src/http/routes.ts's own tenantId documentation and
// services/tenant-service/src/application/legal-entity-service.ts, which
// never checks Tenant existence).
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://amacc:amacc_dev@localhost:5432/amacc_ce13_cert',
});

const TENANT_A = 'ce13-cert-tenant';
const TENANT_B = 'ce13-cert-tenant-b';
const PASSWORD = 'Ce13Cert!2026';

const USERS = [
  { email: 'author@ce13cert.test', tenantId: TENANT_A, role: 'CONTROLLER' },
  { email: 'approver@ce13cert.test', tenantId: TENANT_A, role: 'CONTROLLER' },
  { email: 'noperm@ce13cert.test', tenantId: TENANT_A, role: null },
  { email: 'xt@ce13cert.test', tenantId: TENANT_B, role: 'CONTROLLER' },
];

const GL_ACCOUNTS = [
  { code: '60000', name: 'CE13 Cert — Payroll Expense', type: 'EXPENSE' },
  { code: '61000', name: 'CE13 Cert — Payroll Tax Expense', type: 'EXPENSE' },
  { code: '21000', name: 'CE13 Cert — Payroll Liability / Clearing', type: 'LIABILITY' },
];

async function upsertUser(client, { email, tenantId, role }) {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const existing = await client.query('SELECT id FROM "user" WHERE tenant_id = $1 AND email = $2', [tenantId, email]);
  let userId;
  if (existing.rowCount > 0) {
    userId = existing.rows[0].id;
    await client.query('UPDATE "user" SET password_hash = $1, status = $2 WHERE id = $3', [passwordHash, 'ACTIVE', userId]);
  } else {
    userId = randomUUID();
    await client.query(
      `INSERT INTO "user" (id, tenant_id, email, display_name, status, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5, now(), now())`,
      [userId, tenantId, email, email.split('@')[0], passwordHash],
    );
  }

  // Clear any prior role grant for this user before re-granting — keeps the
  // seed idempotent (e.g. noperm must genuinely hold zero grants on rerun).
  await client.query('DELETE FROM authz_role_assignment WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
  if (role) {
    await client.query(
      `INSERT INTO authz_role_assignment (id, tenant_id, user_id, role, entity_id, store_id, created_at)
       VALUES ($1, $2, $3, $4, NULL, NULL, now())`,
      [randomUUID(), tenantId, userId, role],
    );
  }
  console.log(`  user ${email} (${userId}) — role ${role ?? '(none)'}`);
  return userId;
}

async function upsertGlAccounts(client, tenantId) {
  for (const acct of GL_ACCOUNTS) {
    const existing = await client.query('SELECT id FROM gl_accounts WHERE tenant_id = $1 AND code = $2', [tenantId, acct.code]);
    if (existing.rowCount > 0) continue;
    await client.query(
      `INSERT INTO gl_accounts (id, tenant_id, code, name, type, normal_balance, allow_posting, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, true, now())`,
      [randomUUID(), tenantId, acct.code, acct.name, acct.type, acct.type === 'EXPENSE' ? 'DEBIT' : 'CREDIT'],
    );
  }
  console.log(`  GL accounts seeded for ${tenantId}`);
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('Seeding CE-13 certification fixtures...');
    for (const u of USERS) {
      await upsertUser(client, u);
    }
    await upsertGlAccounts(client, TENANT_A);
    await upsertGlAccounts(client, TENANT_B);
    console.log('Done.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
