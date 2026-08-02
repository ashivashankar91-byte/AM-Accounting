#!/usr/bin/env tsx
// CE-12 (S024, floorplan-service's event families) — rule-pack authoring
// script. Creates, validates and activates the 5 floorplan rule packs
// (advance, payoff, break write-off, interest accrual, curtailment payment)
// against coa-service's posting-engine API.
//
// Two distinct actor strings are used for authoring vs activation
// (author != activator), enforcing the ACTIVATION_SOD_VIOLATION guard
// coa-service applies to every packKey prefixed `ce12.` — see coa-service's
// PostingEngineService.activateVersion.
//
// Modes:
//   Default (blank/pending):
//     npx tsx scripts/seed-ce12-rule-packs.ts --tenant <id> --entity <id>
//     Every allocation's accountNumber is the literal
//     ACCOUNT_MAPPING_VALUES_PENDING — a submit-time posting against it
//     deterministically REJECTS until a real tenant mapping activates a
//     superseding version.
//
//   Test-tenant fixture (separate, explicit path):
//     npx tsx scripts/seed-ce12-rule-packs.ts \
//       --test-tenant <id> --test-entity <id> [--test-store-id CE12-TEST-STORE]
//     Creates clearly-labeled fixture GL accounts via coa-service's account
//     API ("CE-12 TEST FIXTURE — ... (do not use in production)") and maps
//     every rule-pack row to those real account numbers, plus a real
//     MANUAL-class journal source ("FLRPLN") so a posting can actually
//     reach POSTED end-to-end for certification/automated tests.
//
// Env: COA_SERVICE_URL (default http://coa-service:3016),
// SCHEDULE_SERVICE_URL (default http://schedule-service:3018),
// AMACC_JWT_SECRET (required).
//
// CE-12 gap-close — schedule-service linkage (test-tenant mode only): this
// script now also (1) defines/generates an OPEN fiscal period for the test
// entity (posting a journal requires one), (2) creates schedule-service's
// Schedule 85 ("Floorplan Advance Liability", GL account 19102), and
// (3) sets GlAccount(19102).scheduleCode='85' via coa-service's account
// PATCH. All three steps are idempotent (safe to re-run).
//
// controlNumber business-key note: schedule-service's ScheduleDetail.
// controlNumber is VarChar(10). This service's general applyNumber (VIN when
// present, else stock#, see match-service.ts's applyNumberOf) can be up to
// 17 characters (a full VIN) — too long to round-trip through both the
// 10-char controlNumber truncation (coa-service's posting-service.ts, used
// as the new open item's itemNumber) and the 12-char applyNumber truncation
// (used to target that item for relief) and still resolve to the SAME
// value on both sides. To keep the open (advance) and relief (payoff/
// break-writeoff/curtailment) legs deterministically resolvable against the
// same schedule-service item, the schedule-relevant controlNumberPath/
// applyNumberPath below resolve from `payload.stockNumber` specifically
// (not the general `payload.applyNumber`) — dealer stock numbers are
// reliably short. A staged row with a VIN but no stock# still posts its GL
// journal normally (controlNumber/applyNumber are optional, non-blocking
// fields), it simply does not open/relieve a schedule-service item — a
// documented limitation, not a silent failure.

import { EVENT_TYPES, PACK_KEYS, EVENT_SCHEMA_VERSION } from '../src/domain/event-types';
import { ACCOUNT_MAPPING_VALUES_PENDING } from './pending-sentinel';

const COA_SERVICE_URL = (process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016').replace(/\/+$/, '');
const SCHEDULE_SERVICE_URL = (process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3018').replace(/\/+$/, '');
const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
if (!JWT_SECRET) {
  console.error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  process.exit(1);
}

const AUTHOR_ACTOR = 'ce12-rulepack-author';
const ACTIVATOR_ACTOR = 'ce12-rulepack-activator';
const FIXTURE_LOADER_ACTOR = 'ce12-fixture-loader';
const JOURNAL_SOURCE_CODE = 'FLRPLN';
const PENDING_STORE_ID = 'CE12-STORE-PENDING';

// CE-12 gap-close — schedule-service linkage constants (test-tenant mode
// only; see src/domain/event-types.ts's FLOORPLAN_SCHEDULE_NUMBER, which
// TieOutService reads at runtime — kept in sync manually since this script
// intentionally has zero runtime dependency on floorplan-service's own
// compiled application code).
const FLOORPLAN_SCHEDULE_NUMBER = '85';
const FLOORPLAN_SCHEDULE_GL_ACCOUNT = '19102';
const TEST_FISCAL_YEAR = 2026;
const TEST_FISCAL_PERIOD_CODE = '2026-08';

interface Args {
  tenant?: string;
  entity?: string;
  testTenant?: string;
  testEntity?: string;
  testStoreId: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { testStoreId: 'CE12-TEST-STORE' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tenant') args.tenant = argv[++i];
    else if (a === '--entity') args.entity = argv[++i];
    else if (a === '--test-tenant') args.testTenant = argv[++i];
    else if (a === '--test-entity') args.testEntity = argv[++i];
    else if (a === '--test-store-id') args.testStoreId = argv[++i];
  }
  return args;
}

async function token(actor: string): Promise<string> {
  const { createServiceToken } = await import('@amacc/shared-kernel');
  return createServiceToken(actor, JWT_SECRET as string);
}

async function callCoa(path: string, actor: string, tenantId: string, method: string, body?: unknown) {
  const t = await token(actor);
  const hasBody = body !== undefined;
  const res = await fetch(`${COA_SERVICE_URL}${path}`, {
    method,
    // Fastify rejects Content-Type: application/json on a body-less POST
    // (FST_ERR_CTP_EMPTY_JSON_BODY) — only set it when actually sending a
    // body (rule-pack-versions/:id/{validate,activate} take none).
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': tenantId, Authorization: `Bearer ${t}` },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

/** Same shape as callCoa, but against schedule-service. */
async function callSchedule(path: string, actor: string, tenantId: string, method: string, body?: unknown) {
  const t = await token(actor);
  const hasBody = body !== undefined;
  const res = await fetch(`${SCHEDULE_SERVICE_URL}${path}`, {
    method,
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': tenantId, Authorization: `Bearer ${t}` },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

/** GET that treats 404 as "not found" (null) instead of throwing. */
async function getScheduleMaybe(path: string, actor: string, tenantId: string) {
  const t = await token(actor);
  const res = await fetch(`${SCHEDULE_SERVICE_URL}${path}`, {
    method: 'GET',
    headers: { 'x-tenant-id': tenantId, Authorization: `Bearer ${t}` },
  });
  if (res.status === 404) return null;
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

interface AccountSpec {
  accountNumber: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  normalBalance: 'DR' | 'CR';
}

const FIXTURE_ACCOUNTS: AccountSpec[] = [
  { accountNumber: '19101', name: 'CE-12 TEST FIXTURE — Floorplan Advance Clearing (do not use in production)', type: 'ASSET', normalBalance: 'DR' },
  { accountNumber: '19102', name: 'CE-12 TEST FIXTURE — Floorplan Notes Payable (do not use in production)', type: 'LIABILITY', normalBalance: 'CR' },
  { accountNumber: '19103', name: 'CE-12 TEST FIXTURE — Floorplan Payoff Clearing (do not use in production)', type: 'ASSET', normalBalance: 'DR' },
  { accountNumber: '19104', name: 'CE-12 TEST FIXTURE — Floorplan Variance Write-off Expense (do not use in production)', type: 'EXPENSE', normalBalance: 'DR' },
  { accountNumber: '19105', name: 'CE-12 TEST FIXTURE — Floorplan Interest Expense (do not use in production)', type: 'EXPENSE', normalBalance: 'DR' },
  { accountNumber: '19106', name: 'CE-12 TEST FIXTURE — Floorplan Interest Accrued Payable (do not use in production)', type: 'LIABILITY', normalBalance: 'CR' },
  { accountNumber: '19107', name: 'CE-12 TEST FIXTURE — Floorplan Curtailment Cash Clearing (do not use in production)', type: 'ASSET', normalBalance: 'DR' },
];

// Role -> accountNumber, resolved per mode below.
type Roles = {
  advanceClearing: string;
  notesPayable: string;
  payoffClearing: string;
  writeoffExpense: string;
  interestExpense: string;
  interestAccruedPayable: string;
  curtailmentClearing: string;
};

const PENDING_ROLES: Roles = {
  advanceClearing: ACCOUNT_MAPPING_VALUES_PENDING,
  notesPayable: ACCOUNT_MAPPING_VALUES_PENDING,
  payoffClearing: ACCOUNT_MAPPING_VALUES_PENDING,
  writeoffExpense: ACCOUNT_MAPPING_VALUES_PENDING,
  interestExpense: ACCOUNT_MAPPING_VALUES_PENDING,
  interestAccruedPayable: ACCOUNT_MAPPING_VALUES_PENDING,
  curtailmentClearing: ACCOUNT_MAPPING_VALUES_PENDING,
};

// Bug fix (CE-12 gap-close): these MUST be the actual accountNumbers
// FIXTURE_ACCOUNTS creates (19101-19107) — this previously referenced
// non-existent 'FL0xx' codes, which was never caught because no prior test
// run actually authored/validated a rule pack against a real coa-service
// (the 27+7 pre-existing test suites use in-memory posting-engine doubles
// exclusively). Confirmed against a real running coa-service (gap-close
// cert run): validation fails with ACCOUNT_NOT_FOUND for every 'FL0xx' role
// until fixed to match FIXTURE_ACCOUNTS below.
const FIXTURE_ROLES: Roles = {
  advanceClearing: '19101',
  notesPayable: '19102',
  payoffClearing: '19103',
  writeoffExpense: '19104',
  interestExpense: '19105',
  interestAccruedPayable: '19106',
  curtailmentClearing: '19107',
};

function buildRulePacks(tenantId: string, entityId: string, roles: Roles, storeId: string, deptCode: string | null) {
  const common = { dslVersion: 1, tenantScope: tenantId, entityId, effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null, journalSourceCode: JOURNAL_SOURCE_CODE, matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION' };
  const deptFor = (accountNumber: string) => (accountNumber === ACCOUNT_MAPPING_VALUES_PENDING ? undefined : deptCode ?? undefined);

  const advance = {
    ...common,
    packKey: PACK_KEYS.ADVANCE_MATCHED,
    semver: '1.2.0',
    eventType: EVENT_TYPES.ADVANCE_MATCHED,
    supportedEventSchemaVersions: [EVENT_SCHEMA_VERSION],
    rules: [
      {
        ruleId: 'advance-matched-unconditional',
        priority: 1,
        description: 'S080 — lender advance matched to a unit floorplan liability item. DR advance clearing / CR floorplan notes payable (opens a real schedule-service open item via controlNumberPath, sourced from payload.stockNumber — see this script\'s header comment on the VarChar(10) controlNumber constraint).',
        condition: null,
        blueprint: {
          memoTemplate: 'Floorplan advance — {{payload.lenderCode}} / {{payload.applyNumber}}',
          postingGroups: [
            {
              groupId: 'advance',
              baseAmountPath: 'payload.amount',
              debitAllocations: [{ accountNumber: roles.advanceClearing, storeId, bp: 10000 }],
              creditAllocations: [{ accountNumber: roles.notesPayable, storeId, bp: 10000, controlNumberPath: 'payload.stockNumber' }],
            },
          ],
        },
      },
    ],
  };

  const payoff = {
    ...common,
    packKey: PACK_KEYS.PAYOFF_MATCHED,
    semver: '1.2.0',
    eventType: EVENT_TYPES.PAYOFF_MATCHED,
    supportedEventSchemaVersions: [EVENT_SCHEMA_VERSION],
    rules: [
      {
        ruleId: 'payoff-matched-unconditional',
        priority: 1,
        description: 'S080 — lender payoff matched, relieving the unit floorplan liability item. DR floorplan notes payable (controlNumberPath scopes + applyNumberPath targets the specific schedule-service open item to relieve, both sourced from payload.stockNumber) / CR payoff clearing.',
        condition: null,
        blueprint: {
          memoTemplate: 'Floorplan payoff — {{payload.lenderCode}} / {{payload.applyNumber}}',
          postingGroups: [
            {
              groupId: 'payoff',
              baseAmountPath: 'payload.amount',
              debitAllocations: [{ accountNumber: roles.notesPayable, storeId, bp: 10000, controlNumberPath: 'payload.stockNumber', applyNumberPath: 'payload.stockNumber' }],
              creditAllocations: [{ accountNumber: roles.payoffClearing, storeId, bp: 10000 }],
            },
          ],
        },
      },
    ],
  };

  const writeoff = {
    ...common,
    packKey: PACK_KEYS.BREAK_WRITEOFF,
    semver: '1.2.0',
    eventType: EVENT_TYPES.BREAK_WRITEOFF,
    supportedEventSchemaVersions: [EVENT_SCHEMA_VERSION],
    rules: [
      {
        ruleId: 'break-writeoff-unconditional',
        priority: 1,
        description: 'S080 — WRITE_OFF_VARIANCE break disposition. DR variance write-off expense / CR floorplan notes payable (controlNumberPath scopes + applyNumberPath relieves the specific schedule-service open item for the variance amount, both sourced from payload.stockNumber).',
        condition: null,
        blueprint: {
          memoTemplate: 'Floorplan break write-off — {{payload.lenderCode}} / {{payload.applyNumber}}',
          postingGroups: [
            {
              groupId: 'writeoff',
              baseAmountPath: 'payload.amount',
              debitAllocations: [{ accountNumber: roles.writeoffExpense, storeId, deptCode: deptFor(roles.writeoffExpense), bp: 10000 }],
              creditAllocations: [{ accountNumber: roles.notesPayable, storeId, bp: 10000, controlNumberPath: 'payload.stockNumber', applyNumberPath: 'payload.stockNumber' }],
            },
          ],
        },
      },
    ],
  };

  const interest = {
    ...common,
    packKey: PACK_KEYS.INTEREST_ACCRUAL,
    semver: '1.0.0',
    eventType: EVENT_TYPES.INTEREST_ACCRUAL,
    supportedEventSchemaVersions: [EVENT_SCHEMA_VERSION],
    rules: [
      {
        ruleId: 'interest-accrual-unconditional',
        priority: 1,
        description: 'S082 — entered lender interest statement accrual. DR floorplan interest expense / CR floorplan interest accrued payable, for the statement total (unit/department allocation is floorplan-service\'s own reporting breakdown, not separate GL lines).',
        condition: null,
        blueprint: {
          memoTemplate: 'Floorplan interest accrual — {{payload.lenderCode}} statement {{payload.statementId}}',
          postingGroups: [
            {
              groupId: 'interest-accrual',
              baseAmountPath: 'payload.totalAmount',
              debitAllocations: [{ accountNumber: roles.interestExpense, storeId, deptCode: deptFor(roles.interestExpense), bp: 10000 }],
              creditAllocations: [{ accountNumber: roles.interestAccruedPayable, storeId, bp: 10000 }],
            },
          ],
        },
      },
    ],
  };

  const curtailment = {
    ...common,
    packKey: PACK_KEYS.CURTAILMENT_PAYMENT,
    semver: '1.2.0',
    eventType: EVENT_TYPES.CURTAILMENT_PAYMENT,
    supportedEventSchemaVersions: [EVENT_SCHEMA_VERSION],
    rules: [
      {
        ruleId: 'curtailment-payment-unconditional',
        priority: 1,
        description: 'S082 — curtailment payment posts principal relief against the unit floorplan liability item. DR floorplan notes payable (controlNumberPath scopes + applyNumberPath relieves the specific schedule-service open item, both sourced from payload.stockNumber) / CR curtailment cash clearing.',
        condition: null,
        blueprint: {
          memoTemplate: 'Floorplan curtailment — {{payload.lenderCode}} / {{payload.applyNumber}}',
          postingGroups: [
            {
              groupId: 'curtailment',
              baseAmountPath: 'payload.amount',
              debitAllocations: [{ accountNumber: roles.notesPayable, storeId, bp: 10000, controlNumberPath: 'payload.stockNumber', applyNumberPath: 'payload.stockNumber' }],
              creditAllocations: [{ accountNumber: roles.curtailmentClearing, storeId, bp: 10000 }],
            },
          ],
        },
      },
    ],
  };

  return [advance, payoff, writeoff, interest, curtailment];
}

// BR013-3: the posting engine always posts with callerClass SYSTEM
// (services/coa-service/src/application/posting-engine-service.ts), and
// (confirmed against a real running coa-service, gap-close cert run)
// resolveContext's source resolution requires the journalSource row itself
// to be SYSTEM-class too. coa-service's tenant-facing journal-source API
// deliberately REFUSES to let a tenant self-create a SYSTEM-class source
// (CANNOT_CREATE_SYSTEM_SOURCE, 422 — a real production safety rule: SYSTEM
// sources are platform-internal, not tenant-configurable). This mirrors the
// exact fixture-provisioning gap already documented/handled the same way in
// services/vehicle-accounting-service, services/deal-accounting-service and
// services/fni-reserve-service's own seed-ce12-rule-packs.ts scripts: check
// via GET first; if a SYSTEM-class source with this code already exists
// (platform/migration-provisioned, or seeded directly against the DB by a
// certification harness — see coa-service's own tests/live-db/
// posting-engine-live.test.ts, which does exactly that via a direct Prisma
// write), proceed silently. Otherwise fail with a clear, actionable message
// rather than a confusing 422 — this script, being a pure REST client, has
// no way to bypass the guard itself.
async function ensureJournalSource(tenantId: string) {
  const existing = await callCoa('/api/v1/coa/journal-sources', FIXTURE_LOADER_ACTOR, tenantId, 'GET');
  const rows = Array.isArray(existing) ? existing : [];
  const found = rows.find((s: any) => s.code === JOURNAL_SOURCE_CODE);
  if (found?.sourceClass === 'SYSTEM') {
    console.log(`  journal-source ${JOURNAL_SOURCE_CODE} already exists (SYSTEM) for tenant ${tenantId} — skipping.`);
    return;
  }
  if (found) {
    throw new Error(
      `Journal source ${JOURNAL_SOURCE_CODE} exists for tenant ${tenantId} but is class "${found.sourceClass}", not SYSTEM — ` +
        `a SYSTEM-class source is required for posting-engine submissions (BR013-3) and cannot be created via this tenant-facing API. ` +
        `Provision it directly (platform/migration tooling), then re-run this script.`,
    );
  }
  throw new Error(
    `No SYSTEM-class journal source "${JOURNAL_SOURCE_CODE}" exists for tenant ${tenantId}, and tenants cannot self-create one ` +
      `(CANNOT_CREATE_SYSTEM_SOURCE). Provision it directly via platform/migration tooling before running --test-tenant mode.`,
  );
}

async function ensureFixtureAccounts(tenantId: string, entityId: string) {
  for (const acct of FIXTURE_ACCOUNTS) {
    try {
      await callCoa('/api/v1/coa/accounts', FIXTURE_LOADER_ACTOR, tenantId, 'POST', {
        entityId,
        accountNumber: acct.accountNumber,
        name: acct.name,
        type: acct.type,
        normalBalance: acct.normalBalance,
        postable: true,
        actor: FIXTURE_LOADER_ACTOR,
      });
      console.log(`  fixture account ${acct.accountNumber} (${acct.name}) created.`);
    } catch (err: any) {
      if (String(err.message).includes('409')) {
        console.log(`  fixture account ${acct.accountNumber} already exists — skipping.`);
      } else {
        throw err;
      }
    }
  }
}

// Idempotent (CE-12 gap-close fix): postingRulePackVersion is unique on
// (tenantId, packKey, semver) — a bare create-every-time approach 500s with
// a P2002 on any re-run after a partial failure (e.g. this exact pack
// created but not yet validated/activated by an earlier interrupted run).
// Confirmed against a real running coa-service (gap-close cert run). Look
// up any existing version at this exact packKey+semver first: an ACTIVE
// one means this exact content is already fully live (skip entirely); a
// DRAFT/VALIDATED one is reused (resume validate/activate) rather than
// creating a duplicate row.
async function authorValidateActivate(tenantId: string, pack: Record<string, unknown>) {
  const packKey = pack.packKey as string;
  const semver = pack.semver as string;

  const existingPack = await callCoa(`/api/v1/coa/posting-engine/rule-packs/${encodeURIComponent(packKey)}`, AUTHOR_ACTOR, tenantId, 'GET').catch((err: any) => {
    if (String(err.message).includes('404')) return null;
    throw err;
  });
  const existingVersion = (existingPack?.versions ?? []).find((v: any) => v.semver === semver);

  if (existingVersion?.status === 'ACTIVE') {
    console.log(`  [${packKey}] version ${existingVersion.id} (semver ${semver}) already ACTIVE — skipping.`);
    return existingVersion;
  }

  let versionId: string;
  if (existingVersion) {
    versionId = existingVersion.id;
    console.log(`  [${packKey}] reusing existing version ${versionId} (semver ${semver}, status=${existingVersion.status}) from a prior run.`);
  } else {
    const created = await callCoa('/api/v1/coa/posting-engine/rule-packs', AUTHOR_ACTOR, tenantId, 'POST', {
      packKey,
      sourceText: JSON.stringify(pack),
    });
    console.log(`  [${packKey}] created version ${created.id} (status=${created.status})`);
    versionId = created.id;
  }

  const validated = await callCoa(`/api/v1/coa/posting-engine/rule-pack-versions/${versionId}/validate`, AUTHOR_ACTOR, tenantId, 'POST', {});
  console.log(`  [${packKey}] validated: valid=${validated.valid}, findings=${(validated.findings ?? []).length}`);
  if (!validated.valid) {
    console.error(`  [${packKey}] VALIDATION FAILED:`, JSON.stringify(validated.findings, null, 2));
    throw new Error(`Rule pack ${packKey} failed validation.`);
  }

  const activated = await callCoa(`/api/v1/coa/posting-engine/rule-pack-versions/${versionId}/activate`, ACTIVATOR_ACTOR, tenantId, 'POST', {});
  console.log(`  [${packKey}] activated: status=${activated.status}`);
  return activated;
}

// CE-12 gap-close — ensures an OPEN fiscal period exists for the test
// entity (test-tenant mode only; posting a journal requires one).
// Idempotent: defineCalendar updates-in-place on repeat calls,
// generateYear's 409 FISCAL_YEAR_OVERLAP is treated as already-done, and
// PeriodService.open() is itself idempotent on an already-OPEN period.
async function ensureOpenFiscalPeriod(tenantId: string, entityId: string) {
  await callCoa(`/api/v1/fiscal/entities/${encodeURIComponent(entityId)}/fiscal-calendar`, FIXTURE_LOADER_ACTOR, tenantId, 'POST', {
    fyStartMonth: 1,
    structure: 'TWELVE',
  });
  try {
    await callCoa(`/api/v1/fiscal/entities/${encodeURIComponent(entityId)}/fiscal-calendar/years`, FIXTURE_LOADER_ACTOR, tenantId, 'POST', {
      fiscalYear: TEST_FISCAL_YEAR,
    });
    console.log(`  fiscal year ${TEST_FISCAL_YEAR} generated for entity ${entityId}.`);
  } catch (err: any) {
    if (String(err.message).includes('409')) {
      console.log(`  fiscal year ${TEST_FISCAL_YEAR} already generated for entity ${entityId} — skipping.`);
    } else {
      throw err;
    }
  }

  const { periods } = await callCoa(`/api/v1/fiscal/entities/${encodeURIComponent(entityId)}/periods?fy=${TEST_FISCAL_YEAR}`, FIXTURE_LOADER_ACTOR, tenantId, 'GET');
  const period = (periods ?? []).find((p: any) => p.code === TEST_FISCAL_PERIOD_CODE);
  if (!period) throw new Error(`Fiscal period ${TEST_FISCAL_PERIOD_CODE} not found for entity ${entityId} after generation.`);

  const opened = await callCoa(`/api/v1/fiscal/periods/${period.id}/open`, FIXTURE_LOADER_ACTOR, tenantId, 'POST', { confirm: true });
  console.log(`  fiscal period ${TEST_FISCAL_PERIOD_CODE} (entity ${entityId}) status=${opened.status ?? '(unchanged)'}.`);
}

// CE-12 gap-close — ensures schedule-service's Schedule 85 ("Floorplan
// Advance Liability") exists (test-tenant mode only). Idempotent: a GET
// that finds the schedule already present skips creation.
async function ensureSchedule85(tenantId: string) {
  const existing = await getScheduleMaybe(`/api/v1/schedules/${FLOORPLAN_SCHEDULE_NUMBER}`, FIXTURE_LOADER_ACTOR, tenantId);
  if (existing) {
    console.log(`  schedule ${FLOORPLAN_SCHEDULE_NUMBER} already exists for tenant ${tenantId} — skipping.`);
    return;
  }
  await callSchedule('/api/v1/schedules', FIXTURE_LOADER_ACTOR, tenantId, 'POST', {
    scheduleNumber: FLOORPLAN_SCHEDULE_NUMBER,
    title: 'Floorplan Advance Liability',
    reportSequence: 'C',
    scheduleType: 1,
    glAccountNumbers: [FLOORPLAN_SCHEDULE_GL_ACCOUNT],
    eomPurgeType: 1,
  });
  console.log(`  schedule ${FLOORPLAN_SCHEDULE_NUMBER} created for tenant ${tenantId}.`);
}

// CE-12 gap-close — sets GlAccount(FLOORPLAN_SCHEDULE_GL_ACCOUNT).scheduleCode
// = FLOORPLAN_SCHEDULE_NUMBER (test-tenant mode only). Idempotent: a no-op
// PATCH when already set to the same value.
async function ensureAccountScheduleCode(tenantId: string, entityId: string) {
  const list = await callCoa(`/api/v1/coa/accounts?entity=${encodeURIComponent(entityId)}`, FIXTURE_LOADER_ACTOR, tenantId, 'GET');
  const acct = (list.accounts ?? []).find((a: any) => a.accountNumber === FLOORPLAN_SCHEDULE_GL_ACCOUNT);
  if (!acct) {
    throw new Error(`Account ${FLOORPLAN_SCHEDULE_GL_ACCOUNT} not found for entity ${entityId} — run ensureFixtureAccounts first.`);
  }
  if (acct.scheduleCode === FLOORPLAN_SCHEDULE_NUMBER) {
    console.log(`  account ${FLOORPLAN_SCHEDULE_GL_ACCOUNT} already has scheduleCode=${FLOORPLAN_SCHEDULE_NUMBER} — skipping.`);
    return;
  }
  await callCoa(`/api/v1/coa/accounts/${acct.id}`, FIXTURE_LOADER_ACTOR, tenantId, 'PATCH', { scheduleCode: FLOORPLAN_SCHEDULE_NUMBER });
  console.log(`  account ${FLOORPLAN_SCHEDULE_GL_ACCOUNT} scheduleCode set to ${FLOORPLAN_SCHEDULE_NUMBER}.`);
}

async function seedForTenant(tenantId: string, entityId: string, roles: Roles, storeId: string, deptCode: string | null, label: string) {
  console.log(`\n=== Seeding CE-12 floorplan rule packs (${label}) — tenant=${tenantId} entity=${entityId} ===`);
  await ensureJournalSource(tenantId);
  const packs = buildRulePacks(tenantId, entityId, roles, storeId, deptCode);
  for (const pack of packs) {
    await authorValidateActivate(tenantId, pack);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.tenant && !args.testTenant) {
    console.error('Usage: seed-ce12-rule-packs.ts --tenant <id> --entity <id>');
    console.error('   or: seed-ce12-rule-packs.ts --test-tenant <id> --test-entity <id> [--test-store-id <id>]');
    process.exit(1);
  }

  if (args.testTenant) {
    if (!args.testEntity) throw new Error('--test-entity is required when --test-tenant is given.');
    await ensureFixtureAccounts(args.testTenant, args.testEntity);
    await ensureOpenFiscalPeriod(args.testTenant, args.testEntity);
    await ensureSchedule85(args.testTenant);
    await ensureAccountScheduleCode(args.testTenant, args.testEntity);
    await seedForTenant(args.testTenant, args.testEntity, FIXTURE_ROLES, args.testStoreId, 'FLRPLN', 'TEST-TENANT FIXTURE — resolved accounts');
  }

  if (args.tenant) {
    if (!args.entity) throw new Error('--entity is required when --tenant is given.');
    await seedForTenant(args.tenant, args.entity, PENDING_ROLES, PENDING_STORE_ID, null, 'DEFAULT — ACCOUNT_MAPPING_VALUES_PENDING');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('seed-ce12-rule-packs failed:', err);
  process.exit(1);
});
