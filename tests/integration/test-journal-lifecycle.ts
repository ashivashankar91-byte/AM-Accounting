/**
 * End-to-end integration tests for the full journal entry lifecycle across services.
 *
 * Prerequisites:
 *   - gl-service    running on localhost:3010
 *   - eom-service   running on localhost:3011
 *   - schedule-service running on localhost:3030
 *   - apar-service  running on localhost:3013
 *   - Postgres accessible at localhost:5433 (user: amacc, pass: amacc_dev, db: amacc)
 *   - RabbitMQ running (so schedule-service receives JOURNAL_ENTRY_POSTED events)
 *
 * Usage:
 *   npm install
 *   npx tsx test-journal-lifecycle.ts
 *
 * All services must be running with NODE_ENV=development (no JWT required).
 */

import pg from 'pg';

// ── Service endpoints ────────────────────────────────────────────────────────
const GL = 'http://localhost:3010/api/v1/gl';
const EOM = 'http://localhost:3011/api/v1/eom';
const SCHED = 'http://localhost:3030/api/v1';

// ── Test tenant isolation ────────────────────────────────────────────────────
const TENANT = 'integration-test-tenant';

// ── Database (for setup/teardown and outbox verification) ───────────────────
const DB_URL = process.env['DATABASE_URL'] ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';

// ── Timing constants ─────────────────────────────────────────────────────────
// auto-timeout default = 30s, poll interval = 10s → worst case = 40s from creation.
// We submit at ~t=1s, so entry is ~1s old when submitted.
// The timeout fires when createdAt < now-30s, i.e. at earliest t=31s after creation.
// With 10s polling we might catch it at t=40s. Wait 45s to be safe.
const AUTO_APPROVE_WAIT_MS = 45_000;
// Extra wait after posting for outbox processor to publish events (polls every 5s)
const OUTBOX_SETTLE_MS = 8_000;

const HEADERS = {
  'Content-Type': 'application/json',
  'x-tenant-id': TENANT,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

function pass(label: string) {
  console.log(`  ✓ ${label}`);
}

function fail(label: string, detail: string): never {
  throw new Error(`FAIL: ${label} — ${detail}`);
}

function assert(condition: boolean, label: string, detail = '') {
  if (!condition) fail(label, detail || 'assertion failed');
  pass(label);
}

async function httpPost(url: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function httpGet(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { headers: HEADERS });
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Setup ────────────────────────────────────────────────────────────────────

interface SetupResult {
  cashAccountId: string;
  revAccountId: string;
  revAccountCode: string;
  scheduleNo: string;
}

async function setup(): Promise<SetupResult> {
  log('--- SETUP ---');

  // Upsert GL accounts: first try to find existing, then create
  const CASH_CODE = 'IT-1000';
  const REV_CODE = 'IT-4000';

  // Create or get cash account
  let cashAccountId: string;
  {
    const listRes = await httpGet(`${GL}/accounts`);
    assert(listRes.status === 200, 'GET /gl/accounts health check');
    const existing = listRes.body.find((a: any) => a.code === CASH_CODE && a.tenantId === TENANT);
    if (existing) {
      cashAccountId = existing.id;
      log(`  Reusing existing cash account ${CASH_CODE} (${cashAccountId})`);
    } else {
      const res = await httpPost(`${GL}/accounts`, {
        code: CASH_CODE,
        name: 'Integration Test Cash',
        type: 'ASSET',
        allowPosting: true,
      });
      assert(res.status === 201, 'Create cash GL account', JSON.stringify(res.body));
      cashAccountId = res.body.id;
      log(`  Created cash account ${CASH_CODE} (${cashAccountId})`);
    }
  }

  // Create or get revenue account (with scheduleCode so schedule detail is created)
  let revAccountId: string;
  {
    const listRes = await httpGet(`${GL}/accounts`);
    const existing = listRes.body.find((a: any) => a.code === REV_CODE && a.tenantId === TENANT);
    if (existing) {
      revAccountId = existing.id;
      log(`  Reusing existing revenue account ${REV_CODE} (${revAccountId})`);
    } else {
      const res = await httpPost(`${GL}/accounts`, {
        code: REV_CODE,
        name: 'Integration Test Revenue',
        type: 'REVENUE',
        scheduleCode: '01',
        allowPosting: true,
      });
      assert(res.status === 201, 'Create revenue GL account', JSON.stringify(res.body));
      revAccountId = res.body.id;
      log(`  Created revenue account ${REV_CODE} (${revAccountId})`);
    }
  }

  // Create or get schedule in schedule-service
  let scheduleNo: string;
  {
    const listRes = await httpGet(`${SCHED}/schedules`);
    assert(listRes.status === 200, 'GET /schedules health check');
    const existing = Array.isArray(listRes.body)
      ? listRes.body.find((s: any) => s.scheduleNumber === '01' && s.tenantId === TENANT)
      : null;
    if (existing) {
      scheduleNo = existing.scheduleNumber;
      log(`  Reusing existing schedule 01 (scheduleNo=${scheduleNo})`);
    } else {
      const res = await httpPost(`${SCHED}/schedules`, {
        scheduleNumber: '01',
        title: 'Integration Test Schedule',
        reportSequence: 'C',
        scheduleType: 1,
        glAccountNumbers: [REV_CODE],
        eomPurgeType: 1,
      });
      assert(res.status === 201, 'Create schedule', JSON.stringify(res.body));
      scheduleNo = res.body.scheduleNumber;
      log(`  Created schedule 01 (scheduleNo=${scheduleNo})`);
    }
  }

  return { cashAccountId, revAccountId, revAccountCode: REV_CODE, scheduleNo };
}

// ── Teardown ──────────────────────────────────────────────────────────────────

async function teardown(db: pg.Client) {
  log('--- TEARDOWN ---');
  try {
    // Delete all test data for the integration tenant using direct SQL
    // (no DELETE endpoints for journal entries in the API)
    await db.query(`DELETE FROM history_transactions   WHERE tenant_id = $1`, [TENANT]);
    await db.query(`DELETE FROM gl_account_period_balances WHERE tenant_id = $1`, [TENANT]);
    await db.query(`DELETE FROM journal_lines          WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = $1)`, [TENANT]);
    await db.query(`DELETE FROM journal_entries        WHERE tenant_id = $1`, [TENANT]);
    await db.query(`DELETE FROM outbox_events          WHERE tenant_id = $1`, [TENANT]);
    await db.query(`DELETE FROM schedule_details       WHERE tenant_id = $1`, [TENANT]);
    // Soft-delete GL accounts (cannot hard-delete via API; clean via SQL for test isolation)
    await db.query(`DELETE FROM gl_accounts            WHERE tenant_id = $1`, [TENANT]);
    log('  Deleted all integration-test-tenant data');
  } catch (err) {
    log(`  WARNING: teardown error (non-fatal): ${err}`);
  }
}

// ── Test runner ───────────────────────────────────────────────────────────────

async function run() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  AMACC Journal Entry Lifecycle — Integration Tests');
  console.log('═══════════════════════════════════════════════════════════\n');

  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  log('Connected to Postgres');

  // Pre-clean leftover data from any previous run
  await db.query(`DELETE FROM history_transactions   WHERE tenant_id = $1`, [TENANT]);
  await db.query(`DELETE FROM gl_account_period_balances WHERE tenant_id = $1`, [TENANT]);
  await db.query(`DELETE FROM journal_lines          WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = $1)`, [TENANT]);
  await db.query(`DELETE FROM journal_entries        WHERE tenant_id = $1`, [TENANT]);
  await db.query(`DELETE FROM outbox_events          WHERE tenant_id = $1`, [TENANT]);
  await db.query(`DELETE FROM schedule_details       WHERE tenant_id = $1`, [TENANT]);
  await db.query(`DELETE FROM gl_accounts            WHERE tenant_id = $1`, [TENANT]);
  log('Pre-cleaned stale test data');

  const { cashAccountId, revAccountId, revAccountCode, scheduleNo } = await setup();

  let journalEntryId: string;
  let eomCloseId: string | null = null;

  try {
    // ── Test 1: Create DRAFT journal entry ──────────────────────────────────
    log('\n--- TEST 1: POST /gl/journal-entries → DRAFT ---');
    const today = new Date().toISOString().split('T')[0]!;
    const createRes = await httpPost(`${GL}/journal-entries`, {
      entryDate: today,
      description: 'Integration Test — Auto-Approve Lifecycle',
      source: 'IT',
      sourceRef: `IT-${Date.now()}`,
      lines: [
        { glAccountId: cashAccountId, debit: 1500, credit: 0, memo: 'IT cash debit' },
        { glAccountId: revAccountId,  debit: 0, credit: 1500, memo: 'IT revenue credit' },
      ],
    });
    assert(createRes.status === 201, 'POST /gl/journal-entries returns 201', JSON.stringify(createRes.body));
    assert(createRes.body.status === 'DRAFT', 'Entry status is DRAFT', `got: ${createRes.body.status}`);
    journalEntryId = createRes.body.id;
    log(`  Entry created: ${journalEntryId}`);

    // ── Test 2: Submit entry → PENDING_REVIEW ───────────────────────────────
    log('\n--- TEST 2: POST /gl/journal-entries/:id/post → PENDING_REVIEW ---');
    const submitRes = await httpPost(`${GL}/journal-entries/${journalEntryId}/post`, {});
    assert(submitRes.status === 200, 'POST /gl/journal-entries/:id/post returns 200', JSON.stringify(submitRes.body));
    assert(
      submitRes.body.status === 'PENDING_REVIEW',
      'Entry status is PENDING_REVIEW',
      `got: ${submitRes.body.status}`,
    );

    // ── Test 3: Wait for auto-approve timeout ───────────────────────────────
    log(`\n--- TEST 3: Waiting ${AUTO_APPROVE_WAIT_MS / 1000}s for auto-approve timeout ---`);
    log('  (AGENT_REVIEW_TIMEOUT_SECONDS=30, poll every 10s → auto-approves at ~t=40s)');
    const waitStart = Date.now();
    let dotInterval = setInterval(() => process.stdout.write('.'), 2000);
    await sleep(AUTO_APPROVE_WAIT_MS);
    clearInterval(dotInterval);
    process.stdout.write('\n');
    log(`  Waited ${Math.round((Date.now() - waitStart) / 1000)}s`);

    // ── Test 4: Verify status=POSTED, postedBy=AUTO_TIMEOUT ─────────────────
    log('\n--- TEST 4: GET /gl/journal-entries/:id → status=POSTED, postedBy=AUTO_TIMEOUT ---');
    const getRes = await httpGet(`${GL}/journal-entries/${journalEntryId}`);
    assert(getRes.status === 200, 'GET /gl/journal-entries/:id returns 200', JSON.stringify(getRes.body));
    assert(
      getRes.body.status === 'POSTED',
      'Entry status is POSTED after timeout',
      `got: ${getRes.body.status}`,
    );
    assert(
      getRes.body.postedBy === 'AUTO_TIMEOUT',
      'postedBy is AUTO_TIMEOUT',
      `got: ${getRes.body.postedBy}`,
    );
    log(`  Entry is POSTED by ${getRes.body.postedBy}`);

    // ── Test 5: Verify period balance updated ────────────────────────────────
    log('\n--- TEST 5: GET /gl/accounts/:code/period-balances → balance updated ---');
    const now = new Date();
    const balRes = await httpGet(
      `${GL}/accounts/${revAccountCode}/period-balances?year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
    );
    assert(balRes.status === 200, 'GET /gl/accounts/:code/period-balances returns 200', JSON.stringify(balRes.body));
    assert(
      Array.isArray(balRes.body.balances) && balRes.body.balances.length > 0,
      'Period balance records exist for revenue account',
      `got ${balRes.body.balances?.length ?? 0} records`,
    );
    const totalBalance = balRes.body.balances.reduce(
      (sum: number, b: any) => sum + Number(b.runningBalance),
      0,
    );
    assert(
      Math.abs(totalBalance) === 1500,
      'Period balance reflects posted amount (1500)',
      `got total: ${totalBalance}`,
    );
    log(`  Period balance for ${revAccountCode}: ${totalBalance}`);

    // ── Test 6: Schedule detail created via outbox event ────────────────────
    log('\n--- TEST 6: GET /schedules/:id/details → schedule detail created by JOURNAL_ENTRY_POSTED ---');
    log(`  Waiting ${OUTBOX_SETTLE_MS / 1000}s for outbox processor + RabbitMQ event delivery...`);
    await sleep(OUTBOX_SETTLE_MS);

    const detailsRes = await httpGet(`${SCHED}/schedules/${scheduleNo}/details`);
    assert(detailsRes.status === 200, 'GET /schedules/:id/details returns 200', JSON.stringify(detailsRes.body));
    const details = Array.isArray(detailsRes.body) ? detailsRes.body : detailsRes.body.details ?? [];
    const matchingDetail = details.find((d: any) => d.journalEntryId === journalEntryId);
    assert(
      matchingDetail !== undefined,
      `Schedule detail exists for journal entry ${journalEntryId}`,
      `details found: ${JSON.stringify(details.map((d: any) => ({ id: d.id, jeId: d.journalEntryId })))}`,
    );
    log(`  Schedule detail created: ${matchingDetail.id}, amount: ${matchingDetail.amount}`);

    // ── Test 7: Initiate EOM close ───────────────────────────────────────────
    log('\n--- TEST 7: POST /eom/ → initiate EOM close ---');
    const eomYear = now.getFullYear();
    const eomMonth = now.getMonth() + 1;
    const eomRes = await httpPost(`${EOM}/`, {
      year: eomYear,
      month: eomMonth,
      initiatedBy: 'integration-test',
    });

    if (eomRes.status === 201) {
      assert(true, `POST /eom/ returns 201 (close initiated for ${eomYear}-${String(eomMonth).padStart(2, '0')})`);
      eomCloseId = eomRes.body.id;
    } else if (eomRes.status === 409) {
      // A close already exists for this period; find it and use it
      log('  409 — close already in progress; fetching existing close');
      const listRes = await httpGet(`${EOM}/`);
      assert(listRes.status === 200, 'GET /eom/ returns 200', JSON.stringify(listRes.body));
      const existing = (listRes.body as any[]).find(
        (c: any) =>
          (c.periodYear ?? c.period_year) === eomYear &&
          (c.periodMonth ?? c.period_month) === eomMonth,
      );
      assert(existing !== undefined, `Existing EOM close found for ${eomYear}-${eomMonth}`);
      eomCloseId = existing.id;
      pass(`POST /eom/ returns 409 (existing close reused: ${eomCloseId})`);
    } else {
      fail('POST /eom/', `Unexpected status ${eomRes.status}: ${JSON.stringify(eomRes.body)}`);
    }

    // ── Test 8: Verify EOM close status and step tracking ────────────────────
    log('\n--- TEST 8: GET /eom/:id → close status and steps ---');
    const closeRes = await httpGet(`${EOM}/${eomCloseId}`);
    assert(closeRes.status === 200, 'GET /eom/:id returns 200', JSON.stringify(closeRes.body));
    assert(
      typeof closeRes.body.status === 'string',
      'EOM close has a status field',
      `got: ${JSON.stringify(closeRes.body.status)}`,
    );
    assert(
      Array.isArray(closeRes.body.steps),
      'EOM close has a steps array',
      `steps: ${JSON.stringify(closeRes.body.steps)}`,
    );
    assert(
      closeRes.body.steps.length > 0,
      'EOM close steps array is non-empty',
      `got ${closeRes.body.steps.length} steps`,
    );
    log(`  Close status: ${closeRes.body.status}, steps: ${closeRes.body.steps.length}`);
    log(`  Step details: ${closeRes.body.steps.map((s: any) => `${s.stepCode}:${s.status}`).join(', ')}`);

    // ── Test 9: Period carry-forward ─────────────────────────────────────────
    log('\n--- TEST 9: POST /gl/admin/period-carry-forward → opening balance accumulated ---');
    const cfRes = await httpPost(`${GL}/admin/period-carry-forward`, {
      periodYear: eomYear,
      periodMonth: eomMonth,
    });
    assert(cfRes.status === 200, 'POST /gl/admin/period-carry-forward returns 200', JSON.stringify(cfRes.body));
    assert(cfRes.body.status === 'COMPLETE', 'Carry-forward status is COMPLETE', `got: ${cfRes.body.status}`);
    assert(
      typeof cfRes.body.accountsUpdated === 'number',
      'accountsUpdated is a number',
      `got: ${cfRes.body.accountsUpdated}`,
    );
    assert(
      cfRes.body.accountsUpdated >= 1,
      'At least one account had opening balance accumulated',
      `got accountsUpdated=${cfRes.body.accountsUpdated}`,
    );
    assert(
      typeof cfRes.body.periodBalancesConsolidated === 'number',
      'periodBalancesConsolidated is a number',
      `got: ${cfRes.body.periodBalancesConsolidated}`,
    );
    assert(
      cfRes.body.periodBalancesConsolidated >= 1,
      'At least one period balance row was consolidated',
      `got periodBalancesConsolidated=${cfRes.body.periodBalancesConsolidated}`,
    );
    log(`  accountsUpdated=${cfRes.body.accountsUpdated}, periodBalancesConsolidated=${cfRes.body.periodBalancesConsolidated}, historyRecordsPurged=${cfRes.body.historyRecordsPurged}`);

    // Verify opening balance was written to the GL account
    const openingBalRow = await db.query<{ opening_balance: string }>(
      `SELECT opening_balance FROM gl_accounts WHERE tenant_id = $1 AND code = $2`,
      [TENANT, revAccountCode],
    );
    assert(
      openingBalRow.rows.length === 1,
      'GL account row exists after carry-forward',
    );
    const openingBal = Number(openingBalRow.rows[0]!.opening_balance);
    assert(
      openingBal !== 0,
      `Revenue account opening_balance is non-zero (=${openingBal})`,
      `expected non-zero, got ${openingBal}`,
    );
    log(`  Opening balance accumulated on ${revAccountCode}: ${openingBal}`);

    // ── Test 10: Verify outbox — no events stuck unpublished ─────────────────
    log('\n--- TEST 10: Query outbox_events → all events for test tenant are published ---');
    log(`  Waiting ${OUTBOX_SETTLE_MS / 1000}s for outbox processor...`);
    await sleep(OUTBOX_SETTLE_MS);

    const unpublishedRows = await db.query<{ id: string; event_type: string; created_at: Date }>(
      `SELECT id, event_type, created_at
       FROM outbox_events
       WHERE tenant_id = $1 AND published_at IS NULL
       ORDER BY created_at`,
      [TENANT],
    );

    if (unpublishedRows.rows.length > 0) {
      const stuckList = unpublishedRows.rows
        .map((r) => `  • ${r.event_type} (id=${r.id}, created=${r.created_at.toISOString()})`)
        .join('\n');
      fail(
        'All outbox events published',
        `${unpublishedRows.rows.length} events still unpublished:\n${stuckList}`,
      );
    }

    const totalPublished = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM outbox_events WHERE tenant_id = $1`,
      [TENANT],
    );
    pass(
      `All ${totalPublished.rows[0]!.count} outbox events for test tenant have publishedAt set`,
    );

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  ALL 10 TESTS PASSED ✓');
    console.log('═══════════════════════════════════════════════════════════\n');
  } finally {
    await teardown(db);
    await db.end();
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
run().catch((err) => {
  console.error('\n✗ TEST FAILED:', err.message ?? err);
  process.exit(1);
});
