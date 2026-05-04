#!/usr/bin/env node
/**
 * Demo Seed — Lee Hyundai dealership data for three specific scenarios:
 *   A. Payroll Double-Post (idempotency rejection)
 *   B. GL Duplicate Detection (same sourceRef)
 *   C. EOM Failure and Recovery (blocked at step 068)
 *
 * Usage:
 *   npx tsx scripts/demo-seed.ts
 *
 * Requires PostgreSQL running (docker-compose postgres on port 5433).
 */

import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc',
});

const TENANT_ID = 'lee-hyundai-01';
const GATEWAY = 'http://localhost:8081';

// ── AutoMate GL Account Codes for Lee Hyundai ───────────────────────────────
const GL_ACCOUNTS = [
  { code: '0110', name: 'Salaries — Sales', type: 'EXPENSE' },
  { code: '0120', name: 'Salaries — Service', type: 'EXPENSE' },
  { code: '0130', name: 'Salaries — Parts', type: 'EXPENSE' },
  { code: '2010', name: 'Cash Clearing', type: 'ASSET' },
  { code: '2025', name: 'Cash — Payroll', type: 'ASSET' },
  { code: '2250', name: 'Cash Sales', type: 'ASSET' },
  { code: '2470', name: 'WIP Labor', type: 'ASSET' },
  { code: '3210', name: 'Accrued Payroll', type: 'LIABILITY' },
  { code: '3231', name: 'Federal Tax Withholding', type: 'LIABILITY' },
  { code: '3232', name: 'State Tax Withholding', type: 'LIABILITY' },
  { code: '3233', name: 'FICA Withholding', type: 'LIABILITY' },
  { code: '4500', name: 'Labor Revenue — Standard Hyundai', type: 'REVENUE' },
  { code: '6500', name: 'Labor Cost of Sales', type: 'COST_OF_SALES' },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Insert a GL account; return its UUID. Upsert on (tenant_id, code). */
async function upsertGLAccount(
  client: ReturnType<Pool['connect'] extends () => Promise<infer R> ? () => R : never>,
  acct: (typeof GL_ACCOUNTS)[number],
): Promise<string> {
  const res = await (client as any).query(
    `INSERT INTO gl_accounts (id, tenant_id, code, name, type, is_active)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_ID, acct.code, acct.name, acct.type],
  );
  return res.rows[0].id;
}

/** Insert a journal entry with lines; return entry UUID. */
async function insertJournalEntry(
  client: any,
  accountMap: Record<string, string>,
  entry: {
    date: string;
    description: string;
    source: string;
    sourceRef: string;
    status: string;
    agentReviewed?: boolean;
    postedBy?: string;
    postedAt?: string;
    lines: { code: string; debit: number; credit: number; memo: string }[];
  },
): Promise<string> {
  const res = await client.query(
    `INSERT INTO journal_entries
       (id, tenant_id, entry_date, description, source, source_ref, status,
        agent_reviewed, posted_by, posted_at, created_at)
     VALUES
       (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     RETURNING id`,
    [
      TENANT_ID,
      entry.date,
      entry.description,
      entry.source,
      entry.sourceRef,
      entry.status,
      entry.agentReviewed ?? false,
      entry.postedBy ?? null,
      entry.postedAt ?? null,
    ],
  );
  const entryId: string = res.rows[0].id;

  for (const line of entry.lines) {
    const glAccountId = accountMap[line.code];
    if (!glAccountId) {
      console.warn(`  WARN: no GL account for code ${line.code} — skipping line`);
      continue;
    }
    await client.query(
      `INSERT INTO journal_lines (id, journal_entry_id, gl_account_id, debit, credit, memo)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [entryId, glAccountId, line.debit, line.credit, line.memo],
    );
  }

  return entryId;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main seed
// ═══════════════════════════════════════════════════════════════════════════════

async function seed() {
  const client = await pool.connect();

  // Track created IDs for the summary
  const ids: Record<string, string> = {};

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  AMACC Demo Seed — Lee Hyundai (lee-hyundai-01)            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  try {
    // ── Clean previous demo data for this tenant ──────────────────────────
    console.log('Cleaning previous demo data for tenant:', TENANT_ID);
    await client.query(`DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE tenant_id = $1)`, [TENANT_ID]);
    await client.query(`DELETE FROM journal_entries WHERE tenant_id = $1`, [TENANT_ID]);
    await client.query(`DELETE FROM gl_accounts WHERE tenant_id = $1`, [TENANT_ID]);
    await client.query(`DELETE FROM payroll_batches WHERE tenant_id = $1`, [TENANT_ID]);
    await client.query(`DELETE FROM eom_steps WHERE eom_close_id IN (SELECT id FROM eom_closes WHERE tenant_id = $1)`, [TENANT_ID]);
    await client.query(`DELETE FROM eom_closes WHERE tenant_id = $1`, [TENANT_ID]);
    console.log('  Done.\n');

    // ── Seed GL Accounts ──────────────────────────────────────────────────
    console.log('Creating GL accounts (AutoMate codes)...');
    const accountMap: Record<string, string> = {};
    for (const acct of GL_ACCOUNTS) {
      accountMap[acct.code] = await upsertGLAccount(client as any, acct);
      console.log(`  ${acct.code}  ${acct.name.padEnd(40)} → ${accountMap[acct.code]}`);
    }
    console.log(`  ${GL_ACCOUNTS.length} accounts created.\n`);

    // ═════════════════════════════════════════════════════════════════════════
    // SCENARIO A — Payroll Double-Post
    // ═════════════════════════════════════════════════════════════════════════
    console.log('═══ SCENARIO A: Payroll Double-Post ═══');

    const batchA1 = await client.query(
      `INSERT INTO payroll_batches
         (id, tenant_id, batch_ref, period_start, period_end, total_amount,
          status, idempotency_key, submitted_at, posted_at, held_reason)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NULL, NULL)
       RETURNING id`,
      [
        TENANT_ID,
        'PAY-2026-03-28',
        '2026-03-14',
        '2026-03-28',
        127450.0,
        'PENDING',
        'PAY-2026-03-28-HYU01',
      ],
    );
    ids['payroll_batch_1'] = batchA1.rows[0].id;
    console.log(`  Batch 1 (original):  ${ids['payroll_batch_1']}`);
    console.log('    batchRef:       PAY-2026-03-28');
    console.log('    totalAmount:    $127,450.00');
    console.log('    idempotencyKey: PAY-2026-03-28-HYU01');
    console.log('    status:         PENDING');
    console.log('    employees:      23');

    // Attempt to insert the duplicate — DB unique constraint will block it,
    // so we simulate the "duplicate that arrives via the API" by inserting
    // with a different ID but flagging it for the demo narrative.
    // In reality, submitBatch() returns the EXISTING batch — it never creates a second row.
    // We log what WOULD happen.
    console.log('\n  Batch 2 (duplicate attempt):');
    console.log('    idempotencyKey: PAY-2026-03-28-HYU01  ← SAME KEY');
    console.log('    ┌─────────────────────────────────────────────────────────┐');
    console.log('    │ Layer 1: submitBatch() finds existing key within 24h   │');
    console.log('    │          → returns batch 1, no new row created         │');
    console.log('    │ Layer 2: @@unique([tenantId, idempotencyKey]) in DB    │');
    console.log('    │          → PostgreSQL rejects with P2002 on race       │');
    console.log('    │ Layer 3: Agent flags CRITICAL if somehow both pass     │');
    console.log('    └─────────────────────────────────────────────────────────┘');
    console.log('');

    // ═════════════════════════════════════════════════════════════════════════
    // SCENARIO B — GL Duplicate Detection
    // ═════════════════════════════════════════════════════════════════════════
    console.log('═══ SCENARIO B: GL Duplicate Detection ═══');

    // Entry 1 — the original, already posted
    ids['je_original'] = await insertJournalEntry(client, accountMap, {
      date: '2026-03-25',
      description: 'Service RO — Oil Change + Brake Job',
      source: 'AUTOMATE_DMS',
      sourceRef: 'RO-2026-001',
      status: 'POSTED',
      agentReviewed: true,
      postedBy: 'agent-gl',
      postedAt: '2026-03-25T14:30:00Z',
      lines: [
        { code: '4500', debit: 385.0, credit: 0, memo: 'Labor revenue — RO-2026-001' },
        { code: '2470', debit: 0, credit: 385.0, memo: 'WIP reversal — RO-2026-001' },
        { code: '2250', debit: 385.0, credit: 0, memo: 'Cash received — RO-2026-001' },
        { code: '4500', debit: 0, credit: 385.0, memo: 'Revenue credit — RO-2026-001' },
      ],
    });
    console.log(`  Entry 1 (original): ${ids['je_original']}`);
    console.log('    sourceRef:  RO-2026-001');
    console.log('    status:     POSTED');
    console.log('    lines:      DR 4500 $385 / CR 2470 $385 / DR 2250 $385 / CR 4500 $385');

    // Entry 2 — the duplicate, sitting as DRAFT for the agent to catch
    ids['je_duplicate'] = await insertJournalEntry(client, accountMap, {
      date: '2026-03-25',
      description: 'Service RO — Oil Change + Brake Job',
      source: 'AUTOMATE_DMS',
      sourceRef: 'RO-2026-001',
      status: 'DRAFT',
      agentReviewed: false,
      lines: [
        { code: '4500', debit: 385.0, credit: 0, memo: 'Labor revenue — RO-2026-001' },
        { code: '2470', debit: 0, credit: 385.0, memo: 'WIP reversal — RO-2026-001' },
        { code: '2250', debit: 385.0, credit: 0, memo: 'Cash received — RO-2026-001' },
        { code: '4500', debit: 0, credit: 385.0, memo: 'Revenue credit — RO-2026-001' },
      ],
    });
    console.log(`\n  Entry 2 (duplicate): ${ids['je_duplicate']}`);
    console.log('    sourceRef:  RO-2026-001  ← SAME SOURCE REF');
    console.log('    status:     DRAFT  ← awaiting GL Integrity Agent review');
    console.log('    ┌─────────────────────────────────────────────────────────┐');
    console.log('    │ When JOURNAL_ENTRY_SUBMITTED fires for entry 2:        │');
    console.log('    │ Agent calls get_journal_entries for same sourceRef      │');
    console.log('    │ Finds entry 1 (POSTED) with identical sourceRef        │');
    console.log('    │ → Calls flag_for_human_review(CRITICAL, "duplicate")   │');
    console.log('    └─────────────────────────────────────────────────────────┘');
    console.log('');

    // ═════════════════════════════════════════════════════════════════════════
    // SCENARIO C — EOM Failure and Recovery
    // ═════════════════════════════════════════════════════════════════════════
    console.log('═══ SCENARIO C: EOM Failure and Recovery ═══');

    const eomRes = await client.query(
      `INSERT INTO eom_closes
         (id, tenant_id, period_year, period_month, status, current_step, started_at, completed_at, blocked_reason)
       VALUES
         (gen_random_uuid(), $1, 2026, 3, 'BLOCKED', '068', '2026-03-28T08:00:00Z', NULL,
          'Service Close failed: Financial Statement lock detected')
       RETURNING id`,
      [TENANT_ID],
    );
    ids['eom_close'] = eomRes.rows[0].id;
    console.log(`  EOM Close: ${ids['eom_close']}`);
    console.log('    period:  March 2026');
    console.log('    status:  BLOCKED at step 068 (Service Close)');

    const EOM_STEPS = [
      { code: '010', name: 'Pre-Close Checklist', status: 'DONE', message: null },
      { code: '020', name: 'Verify Open Items', status: 'DONE', message: null },
      { code: '062', name: 'Parts Close', status: 'DONE', message: null },
      { code: '065', name: 'Parts Reconciliation', status: 'DONE', message: null },
      {
        code: '068',
        name: 'Service Close',
        status: 'BLOCKED',
        message: 'Financial Statement lock detected — retry to resume from this step',
      },
      { code: '070', name: 'Body Shop Close', status: 'PENDING', message: null },
      { code: '071', name: 'Variable Operations Close', status: 'PENDING', message: null },
      { code: '074', name: 'Fixed Operations Close', status: 'PENDING', message: null },
      { code: '077', name: 'Master Close', status: 'PENDING', message: null },
      { code: '200', name: 'FS Generation', status: 'PENDING', message: null },
      { code: '300', name: 'FS Submission to OEM', status: 'PENDING', message: null },
    ];

    for (const step of EOM_STEPS) {
      await client.query(
        `INSERT INTO eom_steps
           (id, eom_close_id, step_code, step_name, status, error_message,
            retry_count, started_at, completed_at)
         VALUES
           (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          ids['eom_close'],
          step.code,
          step.name,
          step.status,
          step.message,
          step.status === 'BLOCKED' ? 1 : 0,
          step.status !== 'PENDING' ? '2026-03-28T08:00:00Z' : null,
          step.status === 'DONE' ? '2026-03-28T08:05:00Z' : null,
        ],
      );
    }

    console.log('\n  Steps:');
    for (const step of EOM_STEPS) {
      const icon =
        step.status === 'DONE' ? '✓' : step.status === 'BLOCKED' ? '✗' : '○';
      const line = `    ${icon} ${step.code} ${step.name.padEnd(30)} ${step.status}`;
      console.log(
        step.status === 'BLOCKED'
          ? `${line}\n      └─ "${step.message}"`
          : line,
      );
    }

    console.log('\n  ┌─────────────────────────────────────────────────────────┐');
    console.log('  │ retryStep() will:                                       │');
    console.log('  │  1. Find step 068 (BLOCKED)                             │');
    console.log('  │  2. Increment retryCount (1 → 2)                        │');
    console.log('  │  3. Set status back to PENDING                          │');
    console.log('  │  4. Call advanceStep() → ServiceCloseHandler.execute()  │');
    console.log('  │  5. Fetch DRAFT RO entries from GL → post them          │');
    console.log('  │  6. On success → 068 = DONE, advance to 070            │');
    console.log('  └─────────────────────────────────────────────────────────┘');
    console.log('');

    // ═════════════════════════════════════════════════════════════════════════
    // Summary
    // ═════════════════════════════════════════════════════════════════════════
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  SEED COMPLETE — Summary                                   ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Tenant ID:           ${TENANT_ID.padEnd(38)}║`);
    console.log(`║  GL Accounts:         ${String(GL_ACCOUNTS.length).padEnd(38)}║`);
    console.log(`║  Payroll Batch:       ${ids['payroll_batch_1'].substring(0, 36).padEnd(38)}║`);
    console.log(`║  JE Original:        ${ids['je_original'].substring(0, 36).padEnd(38)}║`);
    console.log(`║  JE Duplicate:       ${ids['je_duplicate'].substring(0, 36).padEnd(38)}║`);
    console.log(`║  EOM Close:          ${ids['eom_close'].substring(0, 36).padEnd(38)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');

    console.log('\n───────────────────────────────────────────────────────────────');
    console.log('  CURL COMMANDS TO TRIGGER EACH SCENARIO');
    console.log('───────────────────────────────────────────────────────────────\n');

    // Scenario A
    console.log('# ── SCENARIO A: Payroll Double-Post ─────────────────────────');
    console.log('# Submit the FIRST payroll batch (creates it):');
    console.log(`curl -X POST ${GATEWAY}/api/v1/payroll/batches \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -H "x-tenant-id: ${TENANT_ID}" \\`);
    console.log(`  -d '{`);
    console.log(`    "batchRef": "PAY-2026-03-28",`);
    console.log(`    "periodStart": "2026-03-14",`);
    console.log(`    "periodEnd": "2026-03-28",`);
    console.log(`    "totalAmount": 127450,`);
    console.log(`    "idempotencyKey": "PAY-2026-03-28-HYU01"`);
    console.log(`  }'`);
    console.log('');
    console.log('# Submit the SAME key again (returns existing, no duplicate):');
    console.log(`curl -X POST ${GATEWAY}/api/v1/payroll/batches \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -H "x-tenant-id: ${TENANT_ID}" \\`);
    console.log(`  -d '{`);
    console.log(`    "batchRef": "PAY-2026-03-28-RESUBMIT",`);
    console.log(`    "periodStart": "2026-03-14",`);
    console.log(`    "periodEnd": "2026-03-28",`);
    console.log(`    "totalAmount": 127450,`);
    console.log(`    "idempotencyKey": "PAY-2026-03-28-HYU01"`);
    console.log(`  }'`);
    console.log('# → Should return the SAME batch ID as above\n');

    // Scenario B
    console.log('# ── SCENARIO B: GL Duplicate Detection ──────────────────────');
    console.log('# Trigger the GL Integrity Agent on the duplicate entry:');
    console.log(`curl -X POST ${GATEWAY}/api/v1/gl/journal-entries/${ids['je_duplicate']}/post \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -H "x-tenant-id: ${TENANT_ID}" \\`);
    console.log(`  -H "x-user-id: demo-user"`);
    console.log('# → Publishes JOURNAL_ENTRY_SUBMITTED → GL Integrity Agent');
    console.log('#   Agent detects duplicate sourceRef "RO-2026-001"');
    console.log('#   Agent calls flag_for_human_review(CRITICAL)\n');
    console.log('# Check that entry 2 was flagged (still DRAFT if agent rejected):');
    console.log(`curl ${GATEWAY}/api/v1/gl/journal-entries?status=DRAFT \\`);
    console.log(`  -H "x-tenant-id: ${TENANT_ID}"\n`);

    // Scenario C
    console.log('# ── SCENARIO C: EOM Retry from Blocked Step 068 ─────────────');
    console.log('# View current EOM state (068 = BLOCKED):');
    console.log(`curl ${GATEWAY}/api/v1/eom/${ids['eom_close']}/steps \\`);
    console.log(`  -H "x-tenant-id: ${TENANT_ID}"`);
    console.log('');
    console.log('# Retry the blocked step:');
    console.log(`curl -X POST ${GATEWAY}/api/v1/eom/${ids['eom_close']}/retry-step \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -H "x-tenant-id: ${TENANT_ID}"`);
    console.log('# → retryStep() resets 068 to PENDING, re-runs ServiceCloseHandler');
    console.log('#   On success: 068 = DONE, currentStep advances to 070\n');
    console.log('# After retry — confirm advancement:');
    console.log(`curl ${GATEWAY}/api/v1/eom/${ids['eom_close']} \\`);
    console.log(`  -H "x-tenant-id: ${TENANT_ID}"`);
    console.log('# → status should be "IN_PROGRESS", currentStep should be "070"\n');
  } catch (err) {
    console.error('\nSeed FAILED:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
