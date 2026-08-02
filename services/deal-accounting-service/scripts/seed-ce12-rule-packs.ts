#!/usr/bin/env tsx
// S024 (CE-12) — authors + activates every deal-accounting.* rule-pack
// family this service's segments (see src/domain/segments.ts) submit
// events for, against coa-service's real posting-engine rule-pack
// lifecycle API (services/coa-service/src/http/posting-engine-routes.ts /
// src/application/posting-engine-service.ts — read directly, not guessed).
//
// Governance (mandatory, verified against coa-service's own enforcement in
// PostingEngineService.activateVersion): every packKey below starts with
// 'ce12.' — coa-service enforces author != activator ONLY for that prefix
// (ActivationSoDViolationError, 422, if the same actor both creates and
// activates). This script uses two DISTINCT service-token actors
// (`ce12-deal-accounting-author` / `ce12-deal-accounting-activator`,
// createServiceToken's `sub` claim) to satisfy that boundary for real,
// never by reusing one actor for both calls.
//
// Every allocation's accountNumber defaults to the literal
// ACCOUNT_MAPPING_VALUES_PENDING (coa-service's own sentinel,
// services/coa-service/src/domain/posting-engine/dsl.ts) — never a
// realistic-looking default. Pass --test-tenant/--test-entity to ALSO
// author a second, clearly-labeled fixture-account version (accountNumber
// values prefixed CE12-TEST-) scoped to that tenant/entity, so live-db and
// browser-certification runs can actually post through to real journals —
// a fully separate, explicit path from the blank production template.
//
// Usage:
//   npx tsx scripts/seed-ce12-rule-packs.ts --tenant <tenantId> --entity <entityId> [--store <storeId>] [--test-tenant <tenantId> --test-entity <entityId>]

interface CliArgs {
  tenant: string;
  entity: string;
  store: string;
  testTenant?: string;
  testEntity?: string;
  testStore?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const tenant = get('--tenant');
  const entity = get('--entity');
  if (!tenant || !entity) {
    throw new Error('Usage: seed-ce12-rule-packs.ts --tenant <tenantId> --entity <entityId> [--store <storeId>] [--test-tenant <tenantId> --test-entity <entityId>]');
  }
  return {
    tenant, entity,
    store: get('--store') ?? 'STORE-1',
    testTenant: get('--test-tenant'),
    testEntity: get('--test-entity'),
    testStore: get('--test-store') ?? 'STORE-1',
  };
}

const ACCOUNT_MAPPING_VALUES_PENDING = 'ACCOUNT_MAPPING_VALUES_PENDING';
const BP_TOTAL = 10_000;

// ── DSL type shapes (mirrors services/coa-service/src/domain/posting-engine/dsl.ts) ──
interface Allocation { accountNumber: string; storeId: string; deptCode?: string | null; bp: number; controlNumberPath?: string | null; applyNumberPath?: string | null; }
interface PostingGroup { groupId: string; baseAmountPath: string; debitAllocations: Allocation[]; creditAllocations: Allocation[]; }
interface Rule { ruleId: string; priority: number; description: string; condition?: unknown; blueprint: { memoTemplate?: string; postingGroups: PostingGroup[] }; }
export interface RulePackDef {
  dslVersion: 1; packKey: string; semver: string; eventType: string; supportedEventSchemaVersions: string[];
  tenantScope: string; entityId: string; effectiveFrom: string; effectiveTo?: string | null;
  journalSourceCode: string; matchStrategy: 'FIRST_MATCH'; noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION'; rules: Rule[];
}

// Fixture GL account roles -> clearly-labeled test account numbers. Real
// tenants NEVER get these — only --test-tenant mode does.
//
// FIXED (gap-closure pass): these were previously non-numeric
// ("CE12-TEST-1150" etc.), which coa-service's account API rejects outright
// (isValidAccountNumber requires exactly 5 digits — see
// services/coa-service/src/domain/gl-account.ts). Real 5-digit codes below.
// RESERVE_RECEIVABLE (19213), FINANCE_RESERVE_INCOME (19214), PRODUCT_INCOME
// (19218) and PRODUCT_REMIT_LIABILITY (19219) are LOAD-BEARING cross-service
// constants — fni-reserve-service's own seed script (FIXTURE_ACCOUNTS there)
// MUST reference these exact same four numbers, since fni-reserve-service
// relieves/adjusts items this service originates. Do not renumber without
// updating both files.
export const FIXTURE_ACCOUNTS: Record<string, string> = {
  DEAL_RECEIVABLE_CLEARING: '19200',
  VEHICLE_SALES_REVENUE: '19201',
  WHOLESALE_AR: '19202',
  DEALER_TRADE_RECEIVABLE: '19203',
  LEASE_CAP_CLEARING: '19204',
  LEASE_RESIDUAL_RECEIVABLE: '19205',
  VEHICLE_INVENTORY: '19206',
  COST_OF_VEHICLE_SOLD: '19207',
  TRADE_IN_CLEARING: '19208',
  TRADE_ALLOWANCE_CONTRA: '19209',
  TRADE_IN_INVENTORY: '19210',
  TRADE_PAYOFF_LIABILITY: '19211',
  CIT_RECEIVABLE: '19212',
  RESERVE_RECEIVABLE: '19213',
  FINANCE_RESERVE_INCOME: '19214',
  FEE_INCOME: '19215',
  SALES_TAX_PAYABLE: '19216',
  REBATE_RECEIVABLE: '19217',
  PRODUCT_INCOME: '19218',
  PRODUCT_REMIT_LIABILITY: '19219',
  PRODUCT_COST_EXPENSE: '19220',
  CIT_SHORT_FUND_FEE_EXPENSE: '19221',
  WHOLESALE_DISPOSITION_CLEARING: '19222',
  AUCTION_FEE_EXPENSE: '19223',
  ARBITRATION_CONDITION_COST_EXPENSE: '19224',
  RECONTRACT_DELTA_SUSPENSE: '19225',
  // Gap-closure — schedule 91 (Due-Bill/We-Owe items), next free number
  // after 19225. See DueBillService / ce12.deal-accounting.due-bill.
  DUE_BILL_PAYABLE: '19226',
};

// GL account type per role (ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE) — needed
// to actually create these fixture accounts (see ensureAccount below).
export const FIXTURE_ACCOUNT_TYPES: Record<string, 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'> = {
  DEAL_RECEIVABLE_CLEARING: 'ASSET',
  VEHICLE_SALES_REVENUE: 'REVENUE',
  WHOLESALE_AR: 'ASSET',
  DEALER_TRADE_RECEIVABLE: 'ASSET',
  LEASE_CAP_CLEARING: 'ASSET',
  LEASE_RESIDUAL_RECEIVABLE: 'ASSET',
  VEHICLE_INVENTORY: 'ASSET',
  COST_OF_VEHICLE_SOLD: 'EXPENSE',
  TRADE_IN_CLEARING: 'LIABILITY',
  TRADE_ALLOWANCE_CONTRA: 'REVENUE',
  TRADE_IN_INVENTORY: 'ASSET',
  TRADE_PAYOFF_LIABILITY: 'LIABILITY',
  CIT_RECEIVABLE: 'ASSET',
  RESERVE_RECEIVABLE: 'ASSET',
  FINANCE_RESERVE_INCOME: 'REVENUE',
  FEE_INCOME: 'REVENUE',
  SALES_TAX_PAYABLE: 'LIABILITY',
  REBATE_RECEIVABLE: 'ASSET',
  PRODUCT_INCOME: 'REVENUE',
  PRODUCT_REMIT_LIABILITY: 'LIABILITY',
  PRODUCT_COST_EXPENSE: 'EXPENSE',
  CIT_SHORT_FUND_FEE_EXPENSE: 'EXPENSE',
  WHOLESALE_DISPOSITION_CLEARING: 'ASSET',
  AUCTION_FEE_EXPENSE: 'EXPENSE',
  ARBITRATION_CONDITION_COST_EXPENSE: 'EXPENSE',
  RECONTRACT_DELTA_SUSPENSE: 'ASSET',
  DUE_BILL_PAYABLE: 'LIABILITY',
};

// ── Gap-closure — schedule-service linkage (schedules 87-94) ────────────────
// Every scheduleNumber below is 2-digit-only assigned to this service (no
// cross-service collision) except the two starred roles (RESERVE_RECEIVABLE
// 93 / PRODUCT_REMIT_LIABILITY 94), which reuse GL accounts 19213/19219
// fni-reserve-service also touches (it relieves the items THIS service
// creates on those two schedules — fni-reserve-service creates no schedule
// of its own for them). controlNumberPath below documents exactly what each
// rule pack allocation must resolve for the schedule bridge (coa-service's
// PostingService.post() -> JOURNAL_ENTRY_POSTED, see posting-service.ts) to
// fire; the corresponding alloc() calls in buildRulePacks() are the source
// of truth — this table exists only for the seed script's own schedule-
// creation + GL-account-patch step below.
export interface ScheduleLink { scheduleNumber: string; title: string; role: string; controlNumberDoc: string; scheduleType: number; eomPurgeType: number; }
export const SCHEDULE_LINKS: ScheduleLink[] = [
  { scheduleNumber: '87', title: 'CIT Receivable (S088)', role: 'CIT_RECEIVABLE', controlNumberDoc: 'payload.dealNumber', scheduleType: 1, eomPurgeType: 1 },
  { scheduleNumber: '88', title: 'Trade Payoff Liability (S089)', role: 'TRADE_PAYOFF_LIABILITY', controlNumberDoc: 'payload.dealNumber', scheduleType: 1, eomPurgeType: 1 },
  { scheduleNumber: '89', title: 'Wholesale AR (S090)', role: 'WHOLESALE_AR', controlNumberDoc: 'payload.unitRef', scheduleType: 1, eomPurgeType: 1 },
  { scheduleNumber: '90', title: 'Deposits/Down-payment Clearing', role: 'DEAL_RECEIVABLE_CLEARING', controlNumberDoc: 'payload.dealNumber', scheduleType: 1, eomPurgeType: 1 },
  { scheduleNumber: '91', title: 'Due-Bill/We-Owe Payable', role: 'DUE_BILL_PAYABLE', controlNumberDoc: 'payload.dealNumber', scheduleType: 1, eomPurgeType: 1 },
  { scheduleNumber: '92', title: 'Incentive/Holdback/Rebate Rcvbl', role: 'REBATE_RECEIVABLE', controlNumberDoc: 'payload.dealNumber', scheduleType: 1, eomPurgeType: 1 },
  { scheduleNumber: '93', title: 'Reserve Receivable (S091)', role: 'RESERVE_RECEIVABLE', controlNumberDoc: 'payload.dealNumber', scheduleType: 1, eomPurgeType: 1 },
  { scheduleNumber: '94', title: 'Product Remit Liability (S092)', role: 'PRODUCT_REMIT_LIABILITY', controlNumberDoc: 'payload.productControlRef', scheduleType: 1, eomPurgeType: 1 },
];

export const JOURNAL_SOURCE_CODE = 'DEAL';

// Gap-closure — this cert environment's shared coa-service instance is
// under real concurrent write load from multiple sibling gap-closure agents
// at once. coa-service's own mutating endpoints (account create/update,
// rule-pack create/validate/activate) each wrap their write in an
// interactive `prisma.$transaction(async (tx) => {...})` — and per
// packages/shared-kernel/src/tenancy/rls-middleware.ts's OWN documented
// caveat ("Prisma's connection pool does not give an ironclad guarantee...
// under high concurrency"), a `SET`-before-query middleware races against
// which physical connection an interactive transaction gets handed. Under
// this environment's real multi-agent concurrent load that race is directly
// observable: the exact same request intermittently 42501s
// ("new row violates row-level security policy") and intermittently
// succeeds outright, with no change on this script's side between attempts
// — confirmed empirically against the real running coa-service before
// adding this retry. This is a transient-failure characteristic of the
// UPSTREAM service, not a bug in the request this script sends — bounded
// retry with backoff is the correct, minimal, in-scope response (this
// script is the only file gap-closure work is allowed to change here);
// coa-service's own fix (adding setTenantContextOnConnection(tx, tenantId)
// as each transaction's first statement, exactly as this pass already did
// throughout deal-accounting-service's own application/*.ts) is out of
// this service's boundary and is flagged separately in the delivery
// summary, not applied here.
const TRANSIENT_RLS_RETRY_MAX = Number(process.env['CE12_SEED_RETRY_MAX'] ?? 8);
const TRANSIENT_RLS_RETRY_BASE_MS = 400;
const TRANSIENT_RLS_RETRY_CAP_MS = 5000;

function isTransientRlsFailure(status: number, body: unknown): boolean {
  if (status < 500) return false;
  const text = JSON.stringify(body ?? '');
  return text.includes('42501') || text.includes('row-level security') || text.includes('row_level_security');
}

async function withTransientRlsRetry<T extends { ok: boolean; status: number; body: unknown }>(
  label: string,
  attempt: () => Promise<T>,
): Promise<T> {
  let last: T | undefined;
  for (let i = 1; i <= TRANSIENT_RLS_RETRY_MAX; i++) {
    last = await attempt();
    if (last.ok || !isTransientRlsFailure(last.status, last.body)) return last;
    const delay = Math.min(TRANSIENT_RLS_RETRY_CAP_MS, TRANSIENT_RLS_RETRY_BASE_MS * i);
    console.warn(`  [transient-retry] ${label} hit a transient upstream RLS/connection-pool race (attempt ${i}/${TRANSIENT_RLS_RETRY_MAX}) — retrying in ${delay}ms.`);
    await new Promise((r) => setTimeout(r, delay));
  }
  return last!;
}

export async function coaFetch(baseUrl: string, tenantId: string, token: string, path: string, init?: { method?: string; body?: unknown }) {
  return withTransientRlsRetry(`${init?.method ?? 'GET'} ${path}`, async () => {
    const hasBody = init?.body !== undefined;
    const res = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': tenantId, Authorization: `Bearer ${token}` },
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    return { ok: res.ok, status: res.status, body: parsed };
  });
}

/** Creates every FIXTURE_ACCOUNTS role as a real, clearly-labeled GL account
 * ("CE-12 TEST FIXTURE — ... (do not use in production)") via coa-service's
 * account API. Idempotent (409 = already exists = ok). */
export async function ensureFixtureAccounts(baseUrl: string, tenantId: string, entityId: string, token: string) {
  for (const [role, accountNumber] of Object.entries(FIXTURE_ACCOUNTS)) {
    const type = FIXTURE_ACCOUNT_TYPES[role];
    const name = `CE-12 TEST FIXTURE — ${role.replace(/_/g, ' ')} (do not use in production)`;
    const created = await coaFetch(baseUrl, tenantId, token, '/api/v1/coa/accounts', {
      method: 'POST',
      body: { entityId, accountNumber, name, type, postable: true },
    });
    if (created.ok) console.log(`  created fixture account ${accountNumber} (${type}) — ${role}`);
    else if (created.status === 409) console.log(`  fixture account ${accountNumber} already exists — ok`);
    else throw new Error(`Failed to create fixture account ${accountNumber} (${role}): HTTP ${created.status} ${JSON.stringify(created.body)}`);
  }
}

/** SYSTEM-class journal sources cannot be tenant-self-created (coa-service's
 * account API refuses CANNOT_CREATE_SYSTEM_SOURCE by design — the posting
 * engine always posts callerClass SYSTEM, BR013-3). Check-first via GET,
 * matching vehicle-accounting-service's/floorplan-service's precedent. */
export async function ensureJournalSource(baseUrl: string, tenantId: string, token: string) {
  const existing = await coaFetch(baseUrl, tenantId, token, '/api/v1/coa/journal-sources');
  const rows = Array.isArray(existing.body) ? existing.body : [];
  const found = rows.find((s: any) => s.code === JOURNAL_SOURCE_CODE);
  if (found?.sourceClass === 'SYSTEM') {
    console.log(`  journal source ${JOURNAL_SOURCE_CODE} already exists (SYSTEM) — ok`);
    return;
  }
  if (found) {
    throw new Error(`Journal source ${JOURNAL_SOURCE_CODE} exists but is class "${found.sourceClass}", not SYSTEM. Provision it directly (platform/migration tooling), then re-run.`);
  }
  throw new Error(`No SYSTEM-class journal source "${JOURNAL_SOURCE_CODE}" exists for this tenant, and tenants cannot self-create one. Provision it directly via platform/migration tooling before running --test-tenant mode.`);
}

export async function scheduleFetch(baseUrl: string, tenantId: string, token: string, path: string, init?: { method?: string; body?: unknown }) {
  return withTransientRlsRetry(`${init?.method ?? 'GET'} ${path}`, async () => {
    const hasBody = init?.body !== undefined;
    const res = await fetch(`${baseUrl}${path}`, {
      method: init?.method ?? 'GET',
      headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), 'x-tenant-id': tenantId, Authorization: `Bearer ${token}` },
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    return { ok: res.ok, status: res.status, body: parsed };
  });
}

/** Creates schedules 87-94 (real services/schedule-service masters) for the
 * fixture accounts each SCHEDULE_LINKS entry maps to. Idempotent (check-
 * first via GET /schedules, since schedule-service's POST doesn't itself
 * report 409-on-duplicate-number the way coa-service's account POST does). */
export async function ensureSchedules(scheduleBaseUrl: string, tenantId: string, token: string, links: ScheduleLink[]) {
  const existing = await scheduleFetch(scheduleBaseUrl, tenantId, token, '/api/v1/schedules');
  const rows = Array.isArray(existing.body) ? existing.body : (Array.isArray(existing.body?.items) ? existing.body.items : []);
  const existingNumbers = new Set(rows.map((r: any) => String(r.scheduleNumber ?? r.id)));
  for (const link of links) {
    if (existingNumbers.has(link.scheduleNumber)) {
      console.log(`  schedule ${link.scheduleNumber} (${link.title}) already exists — ok`);
      continue;
    }
    const accountNumber = FIXTURE_ACCOUNTS[link.role];
    const created = await scheduleFetch(scheduleBaseUrl, tenantId, token, '/api/v1/schedules', {
      method: 'POST',
      body: {
        scheduleNumber: link.scheduleNumber,
        title: link.title.slice(0, 29),
        reportSequence: 'C',
        scheduleType: link.scheduleType,
        glAccountNumbers: [accountNumber],
        eomPurgeType: link.eomPurgeType,
      },
    });
    if (created.ok) console.log(`  created schedule ${link.scheduleNumber} (${link.title}) -> GL ${accountNumber}`);
    else throw new Error(`Failed to create schedule ${link.scheduleNumber} (${link.title}): HTTP ${created.status} ${JSON.stringify(created.body)}`);
  }
}

/** PATCHes each SCHEDULE_LINKS role's GL account with scheduleCode = the
 * mapped scheduleNumber, so coa-service's posting-service bridge
 * (JOURNAL_ENTRY_POSTED) actually fires for that account. Looks the
 * account id up via GET /coa/accounts?entity=. */
export async function patchAccountScheduleCodes(coaBaseUrl: string, tenantId: string, entityId: string, token: string, links: ScheduleLink[]) {
  const listed = await coaFetch(coaBaseUrl, tenantId, token, `/api/v1/coa/accounts?entity=${encodeURIComponent(entityId)}`);
  const accounts: any[] = Array.isArray(listed.body?.accounts) ? listed.body.accounts : [];
  for (const link of links) {
    const accountNumber = FIXTURE_ACCOUNTS[link.role];
    const account = accounts.find((a) => a.accountNumber === accountNumber);
    if (!account) throw new Error(`Cannot patch scheduleCode for role ${link.role} (${accountNumber}) — account not found via GET /coa/accounts?entity=${entityId}. Run ensureFixtureAccounts first.`);
    if (account.scheduleCode === link.scheduleNumber) {
      console.log(`  GL ${accountNumber} already carries scheduleCode ${link.scheduleNumber} — ok`);
      continue;
    }
    const patched = await coaFetch(coaBaseUrl, tenantId, token, `/api/v1/coa/accounts/${account.id}`, {
      method: 'PATCH',
      body: { scheduleCode: link.scheduleNumber, actor: 'ce12-fixture-provisioner' },
    });
    if (!patched.ok) throw new Error(`Failed to PATCH scheduleCode=${link.scheduleNumber} onto GL ${accountNumber}: HTTP ${patched.status} ${JSON.stringify(patched.body)}`);
    console.log(`  GL ${accountNumber} -> scheduleCode ${link.scheduleNumber} (${link.title})`);
  }
}

function alloc(accountFn: (role: string) => string, role: string, storeId: string, bp = BP_TOTAL, extra: Partial<Allocation> = {}): Allocation {
  return { accountNumber: accountFn(role), storeId, bp, ...extra };
}

function group(groupId: string, baseAmountPath: string, debit: Allocation, credit: Allocation): PostingGroup {
  return { groupId, baseAmountPath, debitAllocations: [debit], creditAllocations: [credit] };
}

/** Builds the full set of 17 rule-pack definitions for a given tenant/entity/store, using accountFn to resolve each role. */
export function buildRulePacks(tenantId: string, entityId: string, storeId: string, accountFn: (role: string) => string, keySuffix = ''): RulePackDef[] {
  const A = accountFn;
  const base = (packKey: string, eventType: string, rules: Rule[]): RulePackDef => ({
    dslVersion: 1, packKey: `${packKey}${keySuffix}`, semver: '1.0.0', eventType, supportedEventSchemaVersions: ['v1'],
    tenantScope: tenantId, entityId, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null,
    journalSourceCode: 'DEAL', matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION', rules,
  });

  const packs: RulePackDef[] = [];

  // ── deal.finalized.v1 — 4 dealType-keyed golden rules ──────────────────
  packs.push(base('ce12.deal-accounting.finalized', 'deal.finalized.v1', [
    {
      ruleId: 'retail', priority: 10, description: 'RETAIL: sale + unit cost relief', condition: { equals: { path: 'payload.dealType', value: 'RETAIL' } },
      blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — retail sale', postingGroups: [
        group('sale', 'payload.saleAmount', alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId, BP_TOTAL, { controlNumberPath: 'payload.dealNumber' }), alloc(A, 'VEHICLE_SALES_REVENUE', storeId, BP_TOTAL, { deptCode: 'NEW' })),
        group('unitCostRelief', 'payload.unitCostAmount', alloc(A, 'COST_OF_VEHICLE_SOLD', storeId, BP_TOTAL, { deptCode: 'NEW' }), alloc(A, 'VEHICLE_INVENTORY', storeId, BP_TOTAL, { applyNumberPath: 'payload.stockNumber' })),
      ] },
    },
    {
      ruleId: 'dealer-trade', priority: 20, description: 'DEALER_TRADE: sale + unit cost relief', condition: { equals: { path: 'payload.dealType', value: 'DEALER_TRADE' } },
      blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — dealer trade', postingGroups: [
        group('sale', 'payload.saleAmount', alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId, BP_TOTAL, { controlNumberPath: 'payload.dealNumber' }), alloc(A, 'DEALER_TRADE_RECEIVABLE', storeId, BP_TOTAL, { deptCode: 'NEW' })),
        group('unitCostRelief', 'payload.unitCostAmount', alloc(A, 'COST_OF_VEHICLE_SOLD', storeId, BP_TOTAL, { deptCode: 'NEW' }), alloc(A, 'VEHICLE_INVENTORY', storeId, BP_TOTAL, { applyNumberPath: 'payload.stockNumber' })),
      ] },
    },
    {
      ruleId: 'wholesale', priority: 30, description: 'WHOLESALE: wholesale AR + unit cost relief', condition: { equals: { path: 'payload.dealType', value: 'WHOLESALE' } },
      blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — wholesale', postingGroups: [
        group('sale', 'payload.wholesaleAmount', alloc(A, 'WHOLESALE_AR', storeId), alloc(A, 'VEHICLE_SALES_REVENUE', storeId, BP_TOTAL, { deptCode: 'USED' })),
        group('unitCostRelief', 'payload.unitCostAmount', alloc(A, 'COST_OF_VEHICLE_SOLD', storeId, BP_TOTAL, { deptCode: 'USED' }), alloc(A, 'VEHICLE_INVENTORY', storeId, BP_TOTAL, { applyNumberPath: 'payload.stockNumber' })),
      ] },
    },
    {
      ruleId: 'lease', priority: 40, description: 'LEASE: capitalized cost + residual + unit cost relief', condition: { equals: { path: 'payload.dealType', value: 'LEASE' } },
      blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — lease', postingGroups: [
        group('leaseCap', 'payload.leaseCapitalizedCostAmount', alloc(A, 'LEASE_CAP_CLEARING', storeId), alloc(A, 'VEHICLE_SALES_REVENUE', storeId, BP_TOTAL, { deptCode: 'LEASE' })),
        group('leaseResidual', 'payload.leaseResidualAmount', alloc(A, 'LEASE_RESIDUAL_RECEIVABLE', storeId), alloc(A, 'LEASE_CAP_CLEARING', storeId)),
        group('unitCostRelief', 'payload.unitCostAmount', alloc(A, 'COST_OF_VEHICLE_SOLD', storeId, BP_TOTAL, { deptCode: 'LEASE' }), alloc(A, 'VEHICLE_INVENTORY', storeId, BP_TOTAL, { applyNumberPath: 'payload.stockNumber' })),
      ] },
    },
  ]));

  // ── D-CE12-02 trade-in treatment — two independent clearing-balanced groups ──
  packs.push(base('ce12.deal-accounting.trade-allowance', 'deal.trade-allowance-booked.v1', [
    { ruleId: 'default', priority: 10, description: 'Trade allowance (D-CE12-02 mechanical clearing residual)', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — trade allowance', postingGroups: [
      group('tradeAllowance', 'payload.tradeAllowanceAmount', alloc(A, 'TRADE_IN_CLEARING', storeId), alloc(A, 'TRADE_ALLOWANCE_CONTRA', storeId, BP_TOTAL, { deptCode: 'NEW' })),
    ] } },
  ]));
  packs.push(base('ce12.deal-accounting.trade-acv', 'deal.trade-acv-booked.v1', [
    { ruleId: 'default', priority: 10, description: 'Trade ACV — books the trade-in unit onto inventory (D-CE12-02)', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — trade ACV', postingGroups: [
      group('tradeAcv', 'payload.tradeAcvAmount', alloc(A, 'TRADE_IN_INVENTORY', storeId, BP_TOTAL, { controlNumberPath: 'payload.tradeVin' }), alloc(A, 'TRADE_IN_CLEARING', storeId)),
    ] } },
  ]));
  packs.push(base('ce12.deal-accounting.trade-payoff', 'deal.trade-payoff-booked.v1', [
    { ruleId: 'default', priority: 10, description: 'Trade payoff liability (feeds S089)', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — trade payoff', postingGroups: [
      group('tradePayoff', 'payload.tradePayoffAmount', alloc(A, 'TRADE_IN_CLEARING', storeId), alloc(A, 'TRADE_PAYOFF_LIABILITY', storeId, BP_TOTAL, { controlNumberPath: 'payload.dealNumber' })),
    ] } },
  ]));

  packs.push(base('ce12.deal-accounting.cit-receivable', 'deal.cit-receivable-booked.v1', [
    { ruleId: 'default', priority: 10, description: 'CIT receivable (feeds S088)', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — CIT receivable', postingGroups: [
      group('cit', 'payload.financedAmount', alloc(A, 'CIT_RECEIVABLE', storeId, BP_TOTAL, { controlNumberPath: 'payload.dealNumber' }), alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId)),
    ] } },
  ]));
  packs.push(base('ce12.deal-accounting.reserve-receivable', 'deal.reserve-receivable-booked.v1', [
    { ruleId: 'default', priority: 10, description: 'Reserve receivable (feeds S091/S093)', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — reserve receivable', postingGroups: [
      group('reserve', 'payload.reserveIncomeAmount', alloc(A, 'RESERVE_RECEIVABLE', storeId, BP_TOTAL, { controlNumberPath: 'payload.dealNumber' }), alloc(A, 'FINANCE_RESERVE_INCOME', storeId, BP_TOTAL, { deptCode: 'FI' })),
    ] } },
  ]));
  packs.push(base('ce12.deal-accounting.fees', 'deal.fees-booked.v1', [
    { ruleId: 'default', priority: 10, description: 'Fees per S125', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — fees', postingGroups: [
      group('fees', 'payload.feesAmount', alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId), alloc(A, 'FEE_INCOME', storeId, BP_TOTAL, { deptCode: 'ADMIN' })),
    ] } },
  ]));
  packs.push(base('ce12.deal-accounting.tax', 'deal.tax-booked.v1', [
    { ruleId: 'default', priority: 10, description: 'Tax per S124 result (never estimated)', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — tax ({{payload.taxResultId}})', postingGroups: [
      group('tax', 'payload.taxAmount', alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId), alloc(A, 'SALES_TAX_PAYABLE', storeId)),
    ] } },
  ]));
  packs.push(base('ce12.deal-accounting.rebate-receivable', 'deal.rebate-receivable-booked.v1', [
    { ruleId: 'default', priority: 10, description: 'Rebate receivable (feeds CE-14 S103A boundary / S092)', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — rebate receivable', postingGroups: [
      group('rebate', 'payload.rebateReceivableAmount', alloc(A, 'REBATE_RECEIVABLE', storeId, BP_TOTAL, { controlNumberPath: 'payload.dealNumber' }), alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId)),
    ] } },
  ]));

  packs.push(base('ce12.deal-accounting.product-line', 'deal.product-line-finalized.v1', [
    { ruleId: 'default', priority: 10, description: 'Per-product income + remit liability (feeds S092/S094)', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — product {{payload.productCode}}', postingGroups: [
      group('income', 'payload.customerPriceAmount', alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId), alloc(A, 'PRODUCT_INCOME', storeId, BP_TOTAL, { deptCode: 'FI' })),
      group('remit', 'payload.providerCostAmount', alloc(A, 'PRODUCT_COST_EXPENSE', storeId, BP_TOTAL, { deptCode: 'FI' }), alloc(A, 'PRODUCT_REMIT_LIABILITY', storeId, BP_TOTAL, { applyNumberPath: 'payload.dealNumber', controlNumberPath: 'payload.productControlRef' })),
    ] } },
  ]));

  // ── Gap-closure — S095-equivalent due-bill/we-owe items (schedule 91) ──
  packs.push(base('ce12.deal-accounting.due-bill', 'deal.due-bill-recorded.v1', [
    { ruleId: 'default', priority: 10, description: 'Due-bill/we-owe obligation recorded against the deal (feeds schedule 91)', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — due-bill: {{payload.itemDescription}}', postingGroups: [
      group('dueBill', 'payload.amount', alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId), alloc(A, 'DUE_BILL_PAYABLE', storeId, BP_TOTAL, { controlNumberPath: 'payload.dealNumber' })),
    ] } },
  ]));

  // ── S087 recontract delta — one rule per (role, direction) ──────────────
  const DELTA_ROLES = ['GROSS', 'LEASE_RESIDUAL', 'UNIT_COST', 'CIT', 'RESERVE_INCOME', 'FEES', 'TAX'];
  const deltaRules: Rule[] = [];
  let priority = 10;
  for (const role of DELTA_ROLES) {
    for (const direction of ['INCREASE', 'DECREASE'] as const) {
      // INCREASE mirrors the original segment's normal DR/CR treatment for
      // the delta magnitude; DECREASE flips it — both post against the same
      // RECONTRACT_DELTA_SUSPENSE role account paired with a role-neutral
      // clearing account, since the DSL cannot dynamically select a
      // different real account per role at delta-authoring time without one
      // rule per role (which this loop already provides structurally).
      deltaRules.push({
        ruleId: `${role.toLowerCase()}-${direction.toLowerCase()}`, priority: priority++,
        description: `Recontract delta: ${role} ${direction}`,
        condition: { and: [{ equals: { path: 'payload.role', value: role } }, { equals: { path: 'payload.deltaDirection', value: direction } }] },
        blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — recontract delta {{payload.role}}', postingGroups: [
          direction === 'INCREASE'
            ? group('delta', 'payload.deltaAmount', alloc(A, 'RECONTRACT_DELTA_SUSPENSE', storeId), alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId))
            : group('delta', 'payload.deltaAmount', alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId), alloc(A, 'RECONTRACT_DELTA_SUSPENSE', storeId)),
        ] },
      });
    }
  }
  // Product-line deltas — condition on role starting with PRODUCT_INCOME:/PRODUCT_REMIT: is not expressible with `equals`
  // (no startsWith operator in the DSL) so product deltas are handled via the identical INCOME/REMIT-role pair below,
  // matched with `in` against a small closed set is not viable for unbounded codes either — documented limitation:
  // product-line recontract deltas fall back to the REVERSE_REPOST path (see structure-hash.ts's role list, which
  // already always includes product roles in the structure signature, making ANY product amount change on an
  // otherwise-identical structure hash the ONE case this rule pack does not carry a matching delta rule for). This is a
  // disclosed, intentional scope cut — see the final delivery summary.
  deltaRules.push({
    ruleId: 'no-match-fallback', priority: 9999, description: 'Unrecognized role/direction — deliberately falls through to NO_RULE_MATCH so an unsupported delta role surfaces as an exception, never a silent misuse of another role\'s accounts.',
    condition: { equals: { path: 'payload.role', value: '__NEVER__' } },
    blueprint: { postingGroups: [group('noop', 'payload.deltaAmount', alloc(A, 'RECONTRACT_DELTA_SUSPENSE', storeId), alloc(A, 'RECONTRACT_DELTA_SUSPENSE', storeId))] },
  });
  packs.push(base('ce12.deal-accounting.recontract-delta', 'deal.recontract-delta.v1', deltaRules));

  packs.push(base('ce12.deal-accounting.cit-short-fund-fee', 'deal.cit-short-fund-fee.v1', [
    { ruleId: 'default', priority: 10, description: 'S088 short-fund fee-withheld disposition', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — CIT short-fund fee', postingGroups: [
      group('fee', 'payload.feeAmount', alloc(A, 'CIT_SHORT_FUND_FEE_EXPENSE', storeId, BP_TOTAL, { deptCode: 'ADMIN' }), alloc(A, 'CIT_RECEIVABLE', storeId, BP_TOTAL, { applyNumberPath: 'payload.dealNumber' })),
    ] } },
  ]));

  packs.push(base('ce12.deal-accounting.payoff-issuance', 'deal.payoff-issuance.v1', [
    { ruleId: 'default', priority: 10, description: 'S089 payoff payment issued', blueprint: { memoTemplate: 'Deal {{payload.dealNumber}} — payoff issued', postingGroups: [
      group('payoff', 'payload.payoffAmount', alloc(A, 'TRADE_PAYOFF_LIABILITY', storeId, BP_TOTAL, { applyNumberPath: 'payload.dealNumber' }), alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId)),
    ] } },
  ]));
  packs.push(base('ce12.deal-accounting.payoff-variance', 'deal.payoff-variance.v1', [
    { ruleId: 'additional-payment', priority: 10, description: 'S089 payoff variance — additional payment owed', condition: { equals: { path: 'payload.disposition', value: 'ADDITIONAL_PAYMENT' } },
      blueprint: { postingGroups: [group('variance', 'payload.varianceAmount', alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId), alloc(A, 'TRADE_PAYOFF_LIABILITY', storeId))] } },
    { ruleId: 'refund-receivable', priority: 20, description: 'S089 payoff variance — refund receivable', condition: { equals: { path: 'payload.disposition', value: 'REFUND_RECEIVABLE' } },
      blueprint: { postingGroups: [group('variance', 'payload.varianceAmount', alloc(A, 'TRADE_PAYOFF_LIABILITY', storeId), alloc(A, 'DEAL_RECEIVABLE_CLEARING', storeId))] } },
  ]));

  // ── S090 wholesale — 3 unconditional groups (see WholesaleService header doc) ──
  packs.push(base('ce12.deal-accounting.wholesale-disposition', 'deal.wholesale-disposition.v1', [
    { ruleId: 'default', priority: 10, description: 'Wholesale AR + unit relief + auction fees (mechanical clearing residual = gain/loss)', blueprint: { memoTemplate: 'Wholesale {{payload.unitRef}}', postingGroups: [
      group('wholesaleAr', 'payload.wholesaleAmount', alloc(A, 'WHOLESALE_AR', storeId, BP_TOTAL, { controlNumberPath: 'payload.unitRef' }), alloc(A, 'WHOLESALE_DISPOSITION_CLEARING', storeId)),
      group('unitRelief', 'payload.unitReliefAmount', alloc(A, 'WHOLESALE_DISPOSITION_CLEARING', storeId), alloc(A, 'VEHICLE_INVENTORY', storeId, BP_TOTAL, { controlNumberPath: 'payload.unitRef' })),
      group('auctionFees', 'payload.auctionFeesAmount', alloc(A, 'AUCTION_FEE_EXPENSE', storeId, BP_TOTAL, { deptCode: 'USED' }), alloc(A, 'WHOLESALE_DISPOSITION_CLEARING', storeId)),
    ] } },
  ]));
  packs.push(base('ce12.deal-accounting.arbitration-price-adjustment', 'deal.arbitration-price-adjustment.v1', [
    { ruleId: 'increase', priority: 10, description: 'Arbitration price adjustment — increase', condition: { equals: { path: 'payload.adjustmentDirection', value: 'INCREASE' } },
      blueprint: { postingGroups: [group('adj', 'payload.adjustmentAmount', alloc(A, 'WHOLESALE_AR', storeId, BP_TOTAL, { controlNumberPath: 'payload.unitRef' }), alloc(A, 'WHOLESALE_DISPOSITION_CLEARING', storeId))] } },
    { ruleId: 'decrease', priority: 20, description: 'Arbitration price adjustment — decrease', condition: { equals: { path: 'payload.adjustmentDirection', value: 'DECREASE' } },
      blueprint: { postingGroups: [group('adj', 'payload.adjustmentAmount', alloc(A, 'WHOLESALE_DISPOSITION_CLEARING', storeId), alloc(A, 'WHOLESALE_AR', storeId, BP_TOTAL, { controlNumberPath: 'payload.unitRef' }))] } },
  ]));
  packs.push(base('ce12.deal-accounting.arbitration-condition-cost', 'deal.arbitration-unit-return-condition-cost.v1', [
    { ruleId: 'default', priority: 10, description: 'Arbitration unit return — condition-cost lines added on top', blueprint: { postingGroups: [
      group('conditionCost', 'payload.conditionCostAmount', alloc(A, 'ARBITRATION_CONDITION_COST_EXPENSE', storeId, BP_TOTAL, { deptCode: 'USED' }), alloc(A, 'WHOLESALE_DISPOSITION_CLEARING', storeId)),
    ] } },
  ]));

  return packs;
}

export async function authorValidateActivate(baseUrl: string, tenantId: string, def: RulePackDef, authorToken: string, activatorToken: string): Promise<void> {
  const created = await withTransientRlsRetry(`create ${def.packKey}`, async () => {
    const res = await fetch(`${baseUrl}/api/v1/coa/posting-engine/rule-packs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, Authorization: `Bearer ${authorToken}` },
      body: JSON.stringify({ packKey: def.packKey, sourceText: JSON.stringify(def) }),
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  });
  if (!created.ok) throw new Error(`create ${def.packKey} -> HTTP ${created.status}: ${JSON.stringify(created.body)}`);
  const versionId = (created.body as any).id;

  const validated = await withTransientRlsRetry(`validate ${def.packKey}`, async () => {
    const res = await fetch(`${baseUrl}/api/v1/coa/posting-engine/rule-pack-versions/${versionId}/validate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, Authorization: `Bearer ${authorToken}` }, body: '{}',
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  });
  if (!validated.ok) throw new Error(`validate ${def.packKey} -> HTTP ${validated.status}: ${JSON.stringify(validated.body)}`);
  if (!(validated.body as any).valid) {
    console.warn(`[seed-ce12-rule-packs] ${def.packKey} did NOT validate cleanly:`, JSON.stringify((validated.body as any).findings));
  }

  const activated = await withTransientRlsRetry(`activate ${def.packKey}`, async () => {
    const res = await fetch(`${baseUrl}/api/v1/coa/posting-engine/rule-pack-versions/${versionId}/activate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId, Authorization: `Bearer ${activatorToken}` }, body: '{}',
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  });
  if (!activated.ok) throw new Error(`activate ${def.packKey} -> HTTP ${activated.status}: ${JSON.stringify(activated.body)}`);

  console.log(`[seed-ce12-rule-packs] activated ${def.packKey}@${def.semver} (tenant=${tenantId}) -> version ${versionId}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (process.env['COA_SERVICE_URL'] ?? 'http://coa-service:3016').replace(/\/$/, '');
  const jwtSecret = process.env['AMACC_JWT_SECRET'];
  if (!jwtSecret) throw new Error('AMACC_JWT_SECRET is required to sign the author/activator service tokens.');

  const { createServiceToken } = await import('@amacc/shared-kernel');
  // Two DISTINCT actors — required for the ce12.* SoD boundary to actually engage.
  const authorToken = createServiceToken('ce12-deal-accounting-author', jwtSecret);
  const activatorToken = createServiceToken('ce12-deal-accounting-activator', jwtSecret);

  console.log(`[seed-ce12-rule-packs] authoring BLANK (ACCOUNT_MAPPING_VALUES_PENDING) packs for tenant=${args.tenant} entity=${args.entity}`);
  const blankPacks = buildRulePacks(args.tenant, args.entity, args.store, () => ACCOUNT_MAPPING_VALUES_PENDING);
  for (const def of blankPacks) {
    await authorValidateActivate(baseUrl, args.tenant, def, authorToken, activatorToken);
  }

  if (args.testTenant && args.testEntity) {
    const fixtureToken = createServiceToken('ce12-fixture-provisioner', jwtSecret);
    console.log(`[seed-ce12-rule-packs] provisioning fixture GL accounts + journal source for --test-tenant=${args.testTenant} entity=${args.testEntity}`);
    await ensureFixtureAccounts(baseUrl, args.testTenant, args.testEntity, fixtureToken);
    await ensureJournalSource(baseUrl, args.testTenant, fixtureToken);

    console.log(`[seed-ce12-rule-packs] authoring FIXTURE (labeled test accounts) packs for --test-tenant=${args.testTenant} entity=${args.testEntity}`);
    const fixturePacks = buildRulePacks(args.testTenant, args.testEntity, args.testStore ?? 'STORE-1', (role) => FIXTURE_ACCOUNTS[role] ?? ACCOUNT_MAPPING_VALUES_PENDING);
    for (const def of fixturePacks) {
      await authorValidateActivate(baseUrl, args.testTenant, def, authorToken, activatorToken);
    }

    // Gap-closure — real services/schedule-service linkage (schedules
    // 87-94): create the schedule masters, then PATCH each mapped GL
    // account's scheduleCode so coa-service's own JOURNAL_ENTRY_POSTED
    // bridge (services/coa-service/src/application/posting-service.ts)
    // actually opens/relieves real ScheduleOpenItems for CIT/trade-payoff/
    // wholesale-AR/deposits-clearing/due-bill/rebate/reserve/product-remit.
    const scheduleBaseUrl = (process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3018').replace(/\/$/, '');
    console.log(`[seed-ce12-rule-packs] ensuring schedules 87-94 + GL scheduleCode linkage for --test-tenant=${args.testTenant} entity=${args.testEntity}`);
    await ensureSchedules(scheduleBaseUrl, args.testTenant, fixtureToken, SCHEDULE_LINKS);
    await patchAccountScheduleCodes(baseUrl, args.testTenant, args.testEntity, fixtureToken, SCHEDULE_LINKS);
  }

  console.log('[seed-ce12-rule-packs] done.');
}

// CLI entrypoint guard — this module's helpers (buildRulePacks,
// authorValidateActivate, ensureFixtureAccounts, ensureSchedules,
// patchAccountScheduleCodes, FIXTURE_ACCOUNTS, SCHEDULE_LINKS, ...) are also
// imported directly by tests/live-db/real-coa-live-cert.test.ts to author a
// scratch fixture rule-pack set against the REAL running coa-service/
// schedule-service without duplicating ~450 lines of rule-pack JSON — only
// run main() when this file is executed directly (`tsx scripts/seed-ce12-
// rule-packs.ts ...`), never on import.
// (Avoids `import.meta` — this repo's tsconfig.base.json module target
// doesn't permit it under `tsc --noEmit`; a process.argv[1] filename check
// is sufficient here since this script is always invoked by its own
// filename, never re-exported under a different name.)
const isMainModule = Boolean(process.argv[1]?.includes('seed-ce12-rule-packs'));

if (isMainModule) {
  main().catch((err) => {
    console.error('[seed-ce12-rule-packs] FAILED:', err);
    process.exit(1);
  });
}
