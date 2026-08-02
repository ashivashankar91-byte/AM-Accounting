// CE-12 (S024 responsibility for this service's event families) — seeds the
// 10 fni-reserve-service rule packs into coa-service via its REST posting-
// engine API: POST /rule-packs -> POST /rule-pack-versions/:id/validate ->
// POST /rule-pack-versions/:id/activate.
//
// SoD enforcement (coa-service ActivationSoDViolationError, 422): every
// packKey here starts with 'ce12.' — coa-service enforces author !=
// activator ONLY for that prefix. This script therefore ALWAYS uses two
// distinct actor identities (--author / --activator, defaulting to
// 'ce12-fni-reserve-rulepack-author' and 'ce12-fni-reserve-rulepack-
// activator') — reusing the same actor for both steps will be rejected by
// coa-service, by design.
//
// Production mode (default): every accountNumber is
// ACCOUNT_MAPPING_VALUES_PENDING — a real tenant must supersede these
// versions with mapped accounts before any event of these families can
// post (missing mapping deterministically rejects, per epic standing rule).
//
// Test-tenant fixture mode (--test-tenant/--test-entity): a SEPARATE,
// explicit path that substitutes clearly-labeled FIXTURE GL account numbers
// (never realistic-looking production accounts) so this service's own
// live-db tests and local demo/dev runs can exercise a fully end-to-end
// posted journal. Fixture accounts must already exist in coa-service for
// the given entity (this script does not create GL accounts).
//
// Usage:
//   npx tsx scripts/seed-ce12-rule-packs.ts --tenant <tenantId> --entity <entityId> [--effective-from 2026-01-01T00:00:00Z]
//   npx tsx scripts/seed-ce12-rule-packs.ts --test-tenant <tenantId> --test-entity <entityId>
import { buildCe12FniReserveRulePacks, RulePackDefinitionLite } from './ce12-rule-pack-definitions';

const COA_SERVICE_URL = (process.env['COA_SERVICE_URL'] ?? 'http://localhost:3016').replace(/\/$/, '');
const SCHEDULE_SERVICE_URL = (process.env['SCHEDULE_SERVICE_URL'] ?? 'http://localhost:3018').replace(/\/$/, '');

/** CE-12 gap-closure — this service's OWN two schedule-service schedules
 * (test-tenant fixture mode only): 95 (Chargeback Reserve Liability, GL
 * 19301, S091c) and 96 (Deferred Income Liability, GL 19308, S094). Both are
 * ORIGINATED by this service (see ce12-rule-pack-definitions.ts's
 * chargeback-accrual and deferral-booking-origination packs). */
const OWN_SCHEDULES: Array<{ scheduleNumber: string; title: string; glAccountNumber: string }> = [
  // scheduleTitle is VarChar(29) — kept short.
  { scheduleNumber: '95', title: 'CE12 TEST Chargeback Reserve', glAccountNumber: '19301' },
  { scheduleNumber: '96', title: 'CE12 TEST Deferred Income', glAccountNumber: '19308' },
];

interface CliArgs {
  tenantId: string;
  entityId: string;
  effectiveFrom: string;
  author: string;
  activator: string;
  isTestTenant: boolean;
  jwt: string;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const testTenant = get('--test-tenant');
  const testEntity = get('--test-entity');
  const tenant = get('--tenant') ?? testTenant;
  const entity = get('--entity') ?? testEntity;
  if (!tenant || !entity) {
    throw new Error('Usage: seed-ce12-rule-packs.ts --tenant <id> --entity <id> [--effective-from <iso>] | --test-tenant <id> --test-entity <id>');
  }
  const jwt = process.env['AMACC_JWT_SECRET'];
  if (!jwt) throw new Error('AMACC_JWT_SECRET is required to sign the service token used to call coa-service.');
  return {
    tenantId: tenant,
    entityId: entity,
    effectiveFrom: get('--effective-from') ?? '2026-01-01T00:00:00.000Z',
    author: get('--author') ?? 'ce12-fni-reserve-rulepack-author',
    activator: get('--activator') ?? 'ce12-fni-reserve-rulepack-activator',
    isTestTenant: Boolean(testTenant),
    jwt,
  };
}

/** Test-tenant fixture mode: replace every ACCOUNT_MAPPING_VALUES_PENDING /
 * STORE_MAPPING_PENDING / DEPT_MAPPING_PENDING sentinel with a clearly-
 * labeled fixture value.
 *
 * FIXED (gap-closure pass): these were previously non-numeric
 * ("FNI-TEST-REMIT-CLR" etc.), which coa-service's account API rejects
 * outright (isValidAccountNumber requires exactly 5 digits). Real 5-digit
 * codes below. 19213 (RESERVE_RECEIVABLE), 19214 (FINANCE_RESERVE_INCOME),
 * 19218 (PRODUCT_INCOME) and 19219 (PRODUCT_REMIT_LIABILITY) are LOAD-
 * BEARING cross-service constants owned by deal-accounting-service's own
 * seed script (services/deal-accounting-service/scripts/seed-ce12-rule-
 * packs.ts's FIXTURE_ACCOUNTS) — this service relieves/adjusts items deal-
 * accounting-service originates on those exact same GL accounts, so the
 * numbers MUST match exactly. Do not renumber without updating both files. */
const FIXTURE_ACCOUNTS: Record<string, string> = {
  'ce12.fni-reserve.remittance-relief': '19300|19213',
  'ce12.fni-reserve.chargeback-accrual': '19214|19301',
  'ce12.fni-reserve.shortpay-writeoff': '19302|19213',
  'ce12.fni-reserve.chargeback-draw-from-reserve': '19301|19303',
  'ce12.fni-reserve.chargeback-draw-excess-expense': '19304|19303',
  'ce12.fni-reserve.product-remit-relief': '19219|19305',
  'ce12.fni-reserve.cancellation-income-reversal': '19218|19306',
  'ce12.fni-reserve.cancellation-remit-adjustment': '19219|19306',
  'ce12.fni-reserve.cancellation-refund-payable': '19306|19307',
  'ce12.fni-reserve.deferral-booking-origination': '19309|19308',
  'ce12.fni-reserve.deferral-recognition': '19308|19218',
};
// Account type per NEW (fni-reserve-service-owned) fixture number, for
// ensureFixtureAccounts below. The four shared numbers (19213/19214/19218/
// 19219) are created by deal-accounting-service's own seed script — this
// service only relieves/adjusts them, never (re)creates them, to avoid a
// harmless-but-confusing duplicate-create race between the two scripts.
const OWN_FIXTURE_ACCOUNT_TYPES: Record<string, 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'> = {
  '19300': 'ASSET',    // Remittance cash-in-transit clearing (CE-09 pending)
  '19301': 'LIABILITY', // Chargeback Reserve Liability (fni-reserve-service's own new item)
  '19302': 'EXPENSE',   // Reserve short-pay write-off expense
  '19303': 'LIABILITY', // Chargeback payable clearing (CE-09 pending)
  '19304': 'EXPENSE',   // Chargeback excess-over-reserve expense
  '19305': 'LIABILITY', // Provider remittance payable clearing (CE-09 pending)
  '19306': 'LIABILITY', // Cancellation clearing (nets the 3-leg cancellation ceremony)
  '19307': 'LIABILITY', // Customer/lender refund payable (CE-09 pending)
  '19308': 'LIABILITY', // Deferred Income Liability (S094, fni-reserve-service's own new item — schedule 96)
  '19309': 'ASSET',     // Deferred booking origination clearing (CE-09 pending) — debit leg opening the schedule-96 item
};
const FIXTURE_STORE = 'FNI-TEST-STORE-001';
const FIXTURE_DEPT = 'FNI-TEST-DEPT-FI';

async function coaFetch(tenantId: string, jwt: string, actorServiceId: string, path: string, init?: { method?: string; body?: unknown }) {
  const { createServiceToken } = await import('@amacc/shared-kernel');
  const token = createServiceToken(actorServiceId, jwt);
  const hasBody = init?.body !== undefined;
  const res = await fetch(`${COA_SERVICE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': tenantId, Authorization: `Bearer ${token}` },
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, body: parsed };
}

/** Creates this service's OWN new fixture accounts (not the 4 shared ones —
 * see comment above). Idempotent (409 = already exists = ok). */
async function ensureFixtureAccounts(tenantId: string, entityId: string, jwt: string) {
  for (const [accountNumber, type] of Object.entries(OWN_FIXTURE_ACCOUNT_TYPES)) {
    const name = `CE-12 TEST FIXTURE — fni-reserve-service ${accountNumber} (do not use in production)`;
    const created = await coaFetch(tenantId, jwt, 'ce12-fixture-provisioner', '/api/v1/coa/accounts', {
      method: 'POST',
      body: { entityId, accountNumber, name, type, postable: true },
    });
    if (created.ok) console.log(`  created fixture account ${accountNumber} (${type})`);
    else if (created.status === 409) console.log(`  fixture account ${accountNumber} already exists — ok`);
    else throw new Error(`Failed to create fixture account ${accountNumber}: HTTP ${created.status} ${JSON.stringify(created.body)}`);
  }
}

/** SYSTEM-class journal sources cannot be tenant-self-created — check-first
 * via GET, matching the other three CE-12 services' precedent. */
async function ensureJournalSource(tenantId: string, jwt: string) {
  const existing = await coaFetch(tenantId, jwt, 'ce12-fixture-provisioner', '/api/v1/coa/journal-sources');
  const rows = Array.isArray(existing.body) ? existing.body : [];
  const found = rows.find((s: any) => s.code === 'FNI');
  if (found?.sourceClass === 'SYSTEM') {
    console.log(`  journal source FNI already exists (SYSTEM) — ok`);
    return;
  }
  if (found) {
    throw new Error(`Journal source FNI exists but is class "${found.sourceClass}", not SYSTEM. Provision it directly, then re-run.`);
  }
  throw new Error(`No SYSTEM-class journal source "FNI" exists for this tenant. Provision it directly via platform/migration tooling before running --test-tenant mode.`);
}

async function scheduleFetch(tenantId: string, jwt: string, actorServiceId: string, path: string, init?: { method?: string; body?: unknown }) {
  const { createServiceToken } = await import('@amacc/shared-kernel');
  const token = createServiceToken(actorServiceId, jwt);
  const hasBody = init?.body !== undefined;
  const res = await fetch(`${SCHEDULE_SERVICE_URL}${path}`, {
    method: init?.method ?? 'GET',
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': tenantId, Authorization: `Bearer ${token}` },
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, body: parsed };
}

/** Idempotent schedule-service schedule 95/96 provisioning (test-tenant
 * fixture mode only) — check-first via GET (schedule-service's own :id path
 * param is the scheduleNumber, not a DB id — confirmed against
 * ScheduleApplicationService#getSchedule), then POST create only if absent.
 * scheduleType=1 (open-item/subsidiary-ledger schedule, matches this
 * service's use), eomPurgeType=1 (standard, no special EOM purge handling
 * required for either of these two new items), reportSequence='C' (control
 * number order, matches every other CE-12 schedule precedent read in this
 * codebase). */
async function ensureSchedule(tenantId: string, jwt: string, def: { scheduleNumber: string; title: string; glAccountNumber: string }) {
  const existing = await scheduleFetch(tenantId, jwt, 'ce12-fixture-provisioner', `/api/v1/schedules/${def.scheduleNumber}`);
  if (existing.ok) {
    console.log(`  schedule ${def.scheduleNumber} already exists — ok`);
    return;
  }
  const created = await scheduleFetch(tenantId, jwt, 'ce12-fixture-provisioner', '/api/v1/schedules', {
    method: 'POST',
    body: {
      scheduleNumber: def.scheduleNumber,
      title: def.title,
      scheduleType: 1,
      glAccountNumbers: [def.glAccountNumber],
      eomPurgeType: 1,
      reportSequence: 'C',
    },
  });
  if (!created.ok) {
    throw new Error(`Failed to create schedule ${def.scheduleNumber}: HTTP ${created.status} ${JSON.stringify(created.body)}`);
  }
  console.log(`  created schedule ${def.scheduleNumber} (${def.title}) -> GL ${def.glAccountNumber}`);
}

/** PATCH the GL account's scheduleCode so coa-service's posting-service
 * emits the schedule-service bridge event for every posted line carrying a
 * controlNumber against this account (see posting-service.ts's
 * scheduleBridgeEvents gate). coa-service's PATCH /accounts/:id addresses
 * the account by its internal cuid, not its accountNumber — look it up via
 * GET /accounts?entity= first. Idempotent (re-PATCHing the same value is a
 * no-op). */
async function ensureAccountScheduleCode(tenantId: string, entityId: string, jwt: string, accountNumber: string, scheduleNumber: string) {
  const list = await coaFetch(tenantId, jwt, 'ce12-fixture-provisioner', `/api/v1/coa/accounts?entity=${encodeURIComponent(entityId)}`);
  if (!list.ok) throw new Error(`Failed to list coa-service accounts for entity ${entityId}: HTTP ${list.status} ${JSON.stringify(list.body)}`);
  const accounts = Array.isArray(list.body?.accounts) ? list.body.accounts : [];
  const account = accounts.find((a: any) => a.accountNumber === accountNumber);
  if (!account) throw new Error(`Account ${accountNumber} not found for entity ${entityId} — ensureFixtureAccounts must run first.`);
  if (account.scheduleCode === scheduleNumber) {
    console.log(`  account ${accountNumber} already has scheduleCode=${scheduleNumber} — ok`);
    return;
  }
  const patched = await coaFetch(tenantId, jwt, 'ce12-fixture-provisioner', `/api/v1/coa/accounts/${account.id}`, {
    method: 'PATCH',
    body: { scheduleCode: scheduleNumber },
  });
  if (!patched.ok) throw new Error(`Failed to set scheduleCode=${scheduleNumber} on account ${accountNumber} (id ${account.id}): HTTP ${patched.status} ${JSON.stringify(patched.body)}`);
  console.log(`  set account ${accountNumber} scheduleCode=${scheduleNumber}`);
}

/** Provisions this service's OWN schedule-service schedules (95/96) and
 * links their GL accounts' scheduleCode — test-tenant fixture mode only. */
async function ensureOwnSchedules(tenantId: string, entityId: string, jwt: string) {
  for (const def of OWN_SCHEDULES) {
    await ensureSchedule(tenantId, jwt, def);
    await ensureAccountScheduleCode(tenantId, entityId, jwt, def.glAccountNumber, def.scheduleNumber);
  }
}

function applyFixtures(def: RulePackDefinitionLite): RulePackDefinitionLite {
  const [debitAccount, creditAccount] = (FIXTURE_ACCOUNTS[def.packKey] ?? '').split('|');
  if (!debitAccount || !creditAccount) {
    throw new Error(`No fixture accounts registered for packKey ${def.packKey}`);
  }
  return {
    ...def,
    rules: def.rules.map((r) => ({
      ...r,
      blueprint: {
        ...r.blueprint,
        postingGroups: r.blueprint.postingGroups.map((g) => ({
          ...g,
          debitAllocations: g.debitAllocations.map((a) => ({
            ...a,
            accountNumber: debitAccount,
            storeId: FIXTURE_STORE,
            deptCode: a.deptCode ? FIXTURE_DEPT : a.deptCode,
          })),
          creditAllocations: g.creditAllocations.map((a) => ({
            ...a,
            accountNumber: creditAccount,
            storeId: FIXTURE_STORE,
            deptCode: a.deptCode ? FIXTURE_DEPT : a.deptCode,
          })),
        })),
      },
    })),
  };
}

// coa-service's actor identity for every posting-engine mutation is
// request.user.sub — populated straight from the bearer service token's
// `sub` claim (createServiceToken sets sub := serviceId). To make SoD
// (author != activator) actually observable to coa-service, the create/
// validate calls and the activate call MUST be signed as two distinct
// serviceIds — never both 'fni-reserve-service' — hence `actorServiceId`
// below, not a hardcoded constant.
async function callCoaService(path: string, method: string, tenantId: string, jwt: string, actorServiceId: string, body?: unknown) {
  const { createServiceToken } = await import('@amacc/shared-kernel');
  const token = createServiceToken(actorServiceId, jwt);
  const hasBody = body !== undefined;
  const res = await fetch(`${COA_SERVICE_URL}${path}`, {
    method,
    // Fastify rejects Content-Type: application/json on a body-less POST
    // (FST_ERR_CTP_EMPTY_JSON_BODY) — only set it when actually sending a
    // body (rule-pack-versions/:id/{validate,activate} take none).
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      'x-tenant-id': tenantId,
      Authorization: `Bearer ${token}`,
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function seedOne(def: RulePackDefinitionLite, args: CliArgs): Promise<void> {
  console.log(`\n[seed-ce12-rule-packs] ${def.packKey} (${def.eventType})`);

  const created = await callCoaService('/api/v1/coa/posting-engine/rule-packs', 'POST', args.tenantId, args.jwt, args.author, {
    packKey: def.packKey,
    sourceText: JSON.stringify(def),
  });
  console.log(`  created version ${created.id} (status=${created.status}, createdBy=${created.createdBy})`);

  const validated = await callCoaService(`/api/v1/coa/posting-engine/rule-pack-versions/${created.id}/validate`, 'POST', args.tenantId, args.jwt, args.author);
  console.log(`  validated: valid=${validated.valid} findings=${validated.findings?.length ?? 0}`);
  if (!validated.valid) {
    console.error(`  VALIDATION FINDINGS:`, JSON.stringify(validated.findings, null, 2));
    throw new Error(`${def.packKey}: validation failed — a rule pack version must be VALIDATED before it can be activated.`);
  }

  // Activation MUST use a DIFFERENT actor identity than authoring — coa-
  // service's ActivationSoDViolationError (422) enforces author != activator
  // for every 'ce12.' packKey (createServiceToken(args.activator, ...) below
  // signs a token whose `sub` differs from args.author's, which is what
  // coa-service actually compares — see the comment on callCoaService).
  const activated = await callCoaService(`/api/v1/coa/posting-engine/rule-pack-versions/${created.id}/activate`, 'POST', args.tenantId, args.jwt, args.activator);
  console.log(`  activated: status=${activated.status} activatedBy=${activated.activatedBy}`);
}

async function main() {
  const args = parseArgs();
  const definitions = buildCe12FniReserveRulePacks({
    tenantScope: args.tenantId,
    entityId: args.entityId,
    effectiveFrom: args.effectiveFrom,
  });
  const toSeed = args.isTestTenant ? definitions.map(applyFixtures) : definitions;

  if (args.isTestTenant) {
    console.log(`[seed-ce12-rule-packs] provisioning fni-reserve-service's own fixture GL accounts + journal source for tenant=${args.tenantId} entity=${args.entityId}`);
    console.log(`  (NOTE: the 4 shared accounts 19213/19214/19218/19219 are created by deal-accounting-service's own seed script — run that first if this is a fresh tenant.)`);
    await ensureFixtureAccounts(args.tenantId, args.entityId, args.jwt);
    await ensureJournalSource(args.tenantId, args.jwt);
    await ensureOwnSchedules(args.tenantId, args.entityId, args.jwt);
  }

  console.log(`[seed-ce12-rule-packs] Seeding ${toSeed.length} CE-12 fni-reserve-service rule packs for tenant=${args.tenantId} entity=${args.entityId} (${args.isTestTenant ? 'TEST-TENANT FIXTURE MODE' : 'production, ACCOUNT_MAPPING_VALUES_PENDING'})`);

  for (const def of toSeed) {
    await seedOne(def, args);
  }

  console.log(`\n[seed-ce12-rule-packs] Done. ${toSeed.length} rule packs created, validated, and activated.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[seed-ce12-rule-packs] FAILED:', err);
    process.exit(1);
  });
}

export { main };
