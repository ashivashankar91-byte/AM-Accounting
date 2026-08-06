/**
 * S024 (CE-12 scope) — authors, validates and activates this service's
 * eight `ce12.*` posting-engine rule packs in coa-service, via its REST
 * API (never direct DB writes — this script is a REST client, mirroring
 * services/schedule-service/scripts/seed-e2e-fixtures.ts's role as a
 * committed, repeatable, idempotent fixture seeder, just HTTP-based instead
 * of Prisma-based since rule-pack authoring only exists behind coa-service's
 * API). The rule-pack JSON shapes themselves live in
 * src/domain/rule-pack-definitions.ts (pure, unit-tested independently of
 * this CLI).
 *
 * TWO SEPARATE, EXPLICITLY-LABELED MODES (never conflated):
 *
 *   1. DEFAULT (blank/pending authoring) — every allocation's accountNumber
 *      is the literal sentinel ACCOUNT_MAPPING_VALUES_PENDING. A real
 *      submit-time posting against these versions deterministically
 *      REJECTS ("Account ... could not be resolved") until a tenant maps
 *      real accounts. This is the production-safe default — no invented
 *      GL account numbers ever appear here.
 *
 *        npx tsx scripts/seed-ce12-rule-packs.ts --tenant <tenantId> --entity <entityId> [--store <storeId>]
 *
 *   2. --test-tenant / --test-entity (certification/Playwright fixture
 *      mode) — creates REAL fixture GL accounts via coa-service's account
 *      API, each named "CE-12 TEST FIXTURE — ... (do not use in
 *      production)", and maps every rule-pack row to those real account
 *      numbers so a real posting can actually succeed end-to-end. This
 *      mode also ensures a journal source code exists (coa-service's
 *      posting evaluator requires one — BR013-3) — it does NOT seed a
 *      fiscal calendar/open period, which is standard tenant-onboarding
 *      setup owned elsewhere (coa-service's own S208 fiscal routes); the
 *      certification harness must ensure an open period exists for
 *      --test-entity/--store before a real post will succeed all the way
 *      through. This mode ALSO wires this service's 3 assigned real
 *      schedule-service schedules (80/81/82) onto their corresponding
 *      fixture GL accounts' scheduleCode field (ensureScheduleLinkage())
 *      — see src/infrastructure/schedule-client.ts's header comment for
 *      what that unlocks (real ScheduleOpenItem opening/relief via
 *      coa-service's posting bridge). Requires SCHEDULE_SERVICE_URL
 *      (default http://schedule-service:3018) in addition to
 *      COA_SERVICE_URL.
 *
 *        npx tsx scripts/seed-ce12-rule-packs.ts --test-tenant <tenantId> --test-entity <entityId> [--store <storeId>]
 *
 * SoD (author != activator): coa-service's activateVersion() refuses
 * activation when the activating actor equals the version's author, for
 * any packKey starting with "ce12." (ActivationSoDViolationError, 422,
 * code ACTIVATION_SOD_VIOLATION) — see coa-service's
 * application/posting-engine-service.ts. This script therefore uses TWO
 * DIFFERENT service-token actor identities: 'ce12-rulepack-author' for
 * every create call, 'ce12-rulepack-activator' for every activate call.
 *
 * Requires: AMACC_JWT_SECRET (to mint service tokens), COA_SERVICE_URL
 * (default http://coa-service:3016).
 */
import { createServiceToken } from '@amacc/shared-kernel';
import { buildRulePacks, ROLE_FIXTURES, VehicleAccountingGlRole, JOURNAL_SOURCE_CODE, SCHEDULE_LINKS } from '../src/domain/rule-pack-definitions';

const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required to run this seed script.');

const COA_BASE = (process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016').replace(/\/$/, '');
const SCHEDULE_BASE = (process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3018').replace(/\/$/, '');

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const testTenantId = argVal('test-tenant');
const testEntityId = argVal('test-entity');
const plainTenantId = argVal('tenant');
const plainEntityId = argVal('entity');
const storeId = argVal('store') ?? 'STORE-01';

const isTestFixtureMode = Boolean(testTenantId || testEntityId);
if (isTestFixtureMode && (!testTenantId || !testEntityId)) {
  throw new Error('--test-tenant and --test-entity must both be supplied together.');
}
const tenantId = isTestFixtureMode ? testTenantId! : plainTenantId;
const entityId = isTestFixtureMode ? testEntityId! : plainEntityId;
if (!tenantId || !entityId) {
  throw new Error('Either (--tenant and --entity) or (--test-tenant and --test-entity) are required.');
}

async function coaFetch(actor: string, path: string, init?: { method?: string; body?: unknown }) {
  const token = createServiceToken(actor, JWT_SECRET!);
  const hasBody = init?.body !== undefined;
  const res = await fetch(`${COA_BASE}${path}`, {
    method: init?.method ?? 'GET',
    // Fastify's JSON body parser rejects Content-Type: application/json on
    // a body-less POST with FST_ERR_CTP_EMPTY_JSON_BODY — only set it when
    // we're actually sending a body (e.g. rule-pack-versions/:id/activate
    // and .../validate take no request body at all).
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': tenantId!, Authorization: `Bearer ${token}` },
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, body: parsed };
}

async function scheduleFetch(path: string, init?: { method?: string; body?: unknown }) {
  const token = createServiceToken('ce12-fixture-provisioner', JWT_SECRET!);
  const hasBody = init?.body !== undefined;
  const res = await fetch(`${SCHEDULE_BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': tenantId!, Authorization: `Bearer ${token}` },
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, body: parsed };
}

/**
 * Real schedule-service linkage (CE-12 gap-close): for each of this
 * service's 3 assigned roles (VEHICLE_INVENTORY -> schedule 80,
 * DEALER_TRADE_RECEIVABLE -> 81, DEALER_TRADE_PAYABLE -> 82 — see
 * src/domain/rule-pack-definitions.ts's SCHEDULE_LINKS), creates the real
 * schedule-service Schedule row (idempotent via a GET-then-POST-if-missing
 * precheck, NOT via the POST call's error status — schedule-service's
 * createSchedule() has no duplicate-scheduleNumber precheck of its own, so a
 * repeat POST surfaces as a bare HTTP 500, not 409) and PATCHes
 * GlAccount.scheduleCode onto the corresponding fixture GL
 * account, so a real posted journal line against that account (carrying a
 * controlNumber via this service's already-wired controlNumberPath/
 * applyNumberPath rule-pack allocations) opens/relieves a real
 * ScheduleOpenItem via coa-service's PostingService bridge.
 */
async function ensureScheduleLinkage() {
  // Pre-check via GET rather than relying on POST's error status for
  // idempotency: schedule-service's createSchedule() has no duplicate-
  // scheduleNumber precheck of its own — a repeat POST hits the DB's raw
  // unique-constraint violation (Prisma P2002), which schedule-service's
  // generic error handler maps to a bare HTTP 500 "Internal server error"
  // (not 409) — confirmed by re-running this script against an
  // already-seeded tenant. A real GET-then-POST-only-if-missing check is
  // both correct AND idempotent regardless of that response-shape detail.
  const existingSchedules = await scheduleFetch('/api/v1/schedules');
  if (!existingSchedules.ok) throw new Error(`Failed to list schedules for ${tenantId}: HTTP ${existingSchedules.status} ${JSON.stringify(existingSchedules.body)}`);
  const existingScheduleNumbers = new Set(((existingSchedules.body ?? []) as Array<{ scheduleNumber: string }>).map((s) => s.scheduleNumber));

  for (const role of Object.keys(SCHEDULE_LINKS) as VehicleAccountingGlRole[]) {
    const link = SCHEDULE_LINKS[role]!;
    const fixture = ROLE_FIXTURES[role];

    if (existingScheduleNumbers.has(link.scheduleNumber)) {
      console.log(`  schedule ${link.scheduleNumber} already exists — ok`);
    } else {
      const created = await scheduleFetch('/api/v1/schedules', {
        method: 'POST',
        body: {
          scheduleNumber: link.scheduleNumber,
          title: link.title,
          scheduleType: 1,
          glAccountNumbers: [fixture.accountNumber],
          eomPurgeType: 1,
          reportSequence: 'C',
        },
      });
      if (!created.ok) {
        throw new Error(`Failed to create schedule ${link.scheduleNumber} (${link.title}): HTTP ${created.status} ${JSON.stringify(created.body)}`);
      }
      console.log(`  created schedule ${link.scheduleNumber} — ${link.title} (GL ${fixture.accountNumber})`);
    }

    const list = await coaFetch('ce12-fixture-provisioner', `/api/v1/coa/accounts?entity=${encodeURIComponent(entityId!)}`);
    if (!list.ok) throw new Error(`Failed to list accounts for entity ${entityId} while wiring scheduleCode: HTTP ${list.status} ${JSON.stringify(list.body)}`);
    const accounts = ((list.body as any)?.accounts ?? []) as Array<{ id: string; accountNumber: string; scheduleCode?: string | null }>;
    const account = accounts.find((a) => a.accountNumber === fixture.accountNumber);
    if (!account) throw new Error(`Fixture account ${fixture.accountNumber} not found for entity ${entityId} while wiring scheduleCode — run the account-fixture step first.`);

    if (account.scheduleCode === link.scheduleNumber) {
      console.log(`  account ${fixture.accountNumber} already has scheduleCode ${link.scheduleNumber} — ok`);
      continue;
    }
    const patched = await coaFetch('ce12-fixture-provisioner', `/api/v1/coa/accounts/${account.id}`, {
      method: 'PATCH',
      body: { scheduleCode: link.scheduleNumber },
    });
    if (!patched.ok) throw new Error(`Failed to set scheduleCode ${link.scheduleNumber} on account ${fixture.accountNumber}: HTTP ${patched.status} ${JSON.stringify(patched.body)}`);
    console.log(`  account ${fixture.accountNumber}: scheduleCode set to ${link.scheduleNumber}.`);
  }
}

async function ensureAccount(role: VehicleAccountingGlRole) {
  const fixture = ROLE_FIXTURES[role];
  const created = await coaFetch('ce12-fixture-provisioner', '/api/v1/coa/accounts', {
    method: 'POST',
    body: { entityId, accountNumber: fixture.accountNumber, name: fixture.name, type: fixture.type, postable: true },
  });
  if (created.ok) {
    console.log(`  created fixture account ${fixture.accountNumber} (${fixture.type}) — ${fixture.name}`);
  } else if (created.status === 409) {
    console.log(`  fixture account ${fixture.accountNumber} already exists — ok`);
  } else {
    throw new Error(`Failed to create fixture account ${fixture.accountNumber}: HTTP ${created.status} ${JSON.stringify(created.body)}`);
  }
}

async function ensureJournalSource() {
  // BR013-3: the posting engine always posts with callerClass SYSTEM, so
  // this fixture source must be SYSTEM-class too — but coa-service's
  // account-facing journal-source API deliberately REFUSES to let a tenant
  // self-create a SYSTEM-class source (CANNOT_CREATE_SYSTEM_SOURCE, 422 —
  // a real production safety rule, not a bug: SYSTEM sources represent
  // platform-internal posting paths, not tenant-configurable ones). The
  // certification live-db precedent (coa-service's tests/live-db/posting-
  // engine-live.test.ts) seeds its equivalent fixture source via a direct
  // Prisma write in test setup, bypassing this guard intentionally for
  // fixture provisioning — this script, being a pure REST client (see file
  // header), cannot do that. So: check via GET first; if a SYSTEM-class
  // source with this code already exists (platform/migration-provisioned,
  // or seeded directly against the DB by a certification harness), proceed
  // silently. If none exists, this is a genuine, disclosed prerequisite —
  // fail with a clear, actionable message rather than a confusing 422.
  const existing = await coaFetch('ce12-fixture-provisioner', '/api/v1/coa/journal-sources');
  const rows = Array.isArray(existing.body) ? existing.body : [];
  const found = rows.find((s: any) => s.code === JOURNAL_SOURCE_CODE);
  if (found?.sourceClass === 'SYSTEM') {
    console.log(`  journal source ${JOURNAL_SOURCE_CODE} already exists (SYSTEM) — ok`);
    return;
  }
  if (found) {
    throw new Error(`Journal source ${JOURNAL_SOURCE_CODE} exists but is class "${found.sourceClass}", not SYSTEM — a SYSTEM-class source is required for posting-engine submissions (BR013-3) and cannot be created via this tenant-facing API. Provision it directly (platform/migration tooling), then re-run this script.`);
  }
  throw new Error(`No SYSTEM-class journal source "${JOURNAL_SOURCE_CODE}" exists for this tenant, and tenants cannot self-create one (CANNOT_CREATE_SYSTEM_SOURCE). Provision it directly via platform/migration tooling before running --test-tenant mode.`);
}

/** Order-independent deep-equality helper — a plain JSON.stringify()
 * comparison is NOT reliable here because coa-service's stored `definition`
 * JSON (as echoed back by GET) is not guaranteed to preserve the exact key
 * insertion order this script's own object literals use; only VALUES need
 * to match, key order must not matter. Array element order DOES matter
 * (e.g. `rules`), so arrays are compared positionally, not sorted. */
function deepEqualIgnoringKeyOrder(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqualIgnoringKeyOrder(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>).sort();
    const bKeys = Object.keys(b as Record<string, unknown>).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) return false;
    return aKeys.every((k) => deepEqualIgnoringKeyOrder((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

async function authorAndActivate(def: Record<string, unknown>) {
  const packKey = def['packKey'] as string;
  const semver = def['semver'] as string;

  // Idempotency precheck (CE-12 gap-close fix, discovered while re-running
  // this script end-to-end for the schedule-linkage verification step):
  // coa-service's rule-pack versions are unique on (tenantId, packKey,
  // semver) — buildRulePacks() always emits the SAME semver for a given
  // (packKey, mode) pair, so a byte-identical re-run of this script (same
  // tenant/entity/store, same mode) previously hit a raw Prisma P2002 on
  // re-authoring, surfaced as an unhelpful bare HTTP 500 (coa-service's
  // create-version route has no duplicate-semver precheck of its own,
  // mirroring the same rough edge found in schedule-service's
  // createSchedule() — see ensureScheduleLinkage()'s comment above). A real
  // GET-then-skip-if-already-active check makes this script genuinely
  // re-runnable, matching its own header's "committed, repeatable,
  // idempotent fixture seeder" claim.
  const existing = await coaFetch('ce12-rulepack-author', `/api/v1/coa/posting-engine/rule-packs/${encodeURIComponent(packKey)}`);
  if (existing.ok) {
    const versions = ((existing.body as any)?.versions ?? []) as Array<{ id: string; semver: string; status: string; definition: unknown }>;
    // Match by exact semver (the common case: an un-toggled pack's
    // deterministic '1.0.0'), OR — since this same script's activateRecon-
    // PackVersion-style toggling (used by this service's own live-db
    // certification tests) can leave a DIFFERENT semver active with
    // IDENTICAL functional content — by content equality with whatever
    // version IS currently ACTIVE, ignoring semver itself (semver is a
    // version label, not part of the posting behavior).
    const bySemver = versions.find((v) => v.semver === semver && v.status === 'ACTIVE');
    const { semver: _defSemver, ...defWithoutSemver } = def as Record<string, unknown> & { semver: string };
    const byContent = versions.find((v) => {
      if (v.status !== 'ACTIVE') return false;
      const { semver: _vSemver, ...defnWithoutSemver } = (v.definition ?? {}) as Record<string, unknown> & { semver?: string };
      return deepEqualIgnoringKeyOrder(defnWithoutSemver, defWithoutSemver);
    });
    const match = bySemver ?? byContent;
    if (match) {
      console.log(`  ${packKey}: version ${match.id} (semver ${match.semver}) already authored + activated with equivalent content — ok`);
      return match.id;
    }
  }

  const created = await coaFetch('ce12-rulepack-author', '/api/v1/coa/posting-engine/rule-packs', {
    method: 'POST',
    body: { packKey, sourceText: JSON.stringify(def) },
  });
  if (!created.ok) throw new Error(`Failed to create rule-pack version for ${packKey}: HTTP ${created.status} ${JSON.stringify(created.body)}`);
  const versionId = (created.body as any).id;

  const validated = await coaFetch('ce12-rulepack-author', `/api/v1/coa/posting-engine/rule-pack-versions/${versionId}/validate`, { method: 'POST' });
  if (!validated.ok) throw new Error(`Failed to validate rule-pack version ${versionId} (${packKey}): HTTP ${validated.status} ${JSON.stringify(validated.body)}`);
  if (!(validated.body as any).valid) {
    console.warn(`  ${packKey}: validation findings:`, JSON.stringify((validated.body as any).findings, null, 2));
    throw new Error(`Rule-pack version ${versionId} (${packKey}) did not validate.`);
  }

  // Different actor than the author — required SoD for ce12.* packKeys.
  const activated = await coaFetch('ce12-rulepack-activator', `/api/v1/coa/posting-engine/rule-pack-versions/${versionId}/activate`, { method: 'POST' });
  if (!activated.ok) throw new Error(`Failed to activate rule-pack version ${versionId} (${packKey}): HTTP ${activated.status} ${JSON.stringify(activated.body)}`);

  console.log(`  ${packKey}: version ${versionId} authored + validated + activated.`);
  return versionId;
}

async function main() {
  console.log(`Seeding CE-12 vehicle-accounting rule packs — mode=${isTestFixtureMode ? 'TEST_FIXTURE' : 'BLANK_PENDING'} tenant=${tenantId} entity=${entityId} store=${storeId}`);

  if (isTestFixtureMode) {
    console.log('Ensuring test-fixture GL accounts + journal source...');
    for (const role of Object.keys(ROLE_FIXTURES) as VehicleAccountingGlRole[]) {
      // eslint-disable-next-line no-await-in-loop
      await ensureAccount(role);
    }
    await ensureJournalSource();

    console.log('Ensuring real schedule-service linkage (schedules 80/81/82)...');
    await ensureScheduleLinkage();
  } else {
    console.log('Blank/pending mode — every allocation uses ACCOUNT_MAPPING_VALUES_PENDING; no accounts created.');
  }

  console.log('Authoring + validating + activating rule packs...');
  const packs = buildRulePacks({ tenantId: tenantId!, entityId: entityId!, storeId, testFixtureMode: isTestFixtureMode });
  for (const def of packs) {
    // eslint-disable-next-line no-await-in-loop
    await authorAndActivate(def);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
