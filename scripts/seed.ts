#!/usr/bin/env node
// Seed script — populates all service databases with realistic auto dealership data
// Usage: npx tsx scripts/seed.ts
// Connects via DATABASE_URL or defaults to the docker-compose postgres

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc',
});

const TENANT_ID = 'tenant-kunes';

// ── GL Accounts (NADA-style automotive chart of accounts) ───────────────────
const GL_ACCOUNTS: { code: string; name: string; type: string }[] = [
  // Payroll expense accounts (used by payroll→GL posting)
  { code: '0110', name: 'Salaries - Sales', type: 'EXPENSE' },
  { code: '0120', name: 'Salaries - Service', type: 'EXPENSE' },
  { code: '0130', name: 'Salaries - Parts', type: 'EXPENSE' },
  // Assets
  { code: '1000', name: 'Cash - Operating Checking', type: 'ASSET' },
  { code: '1010', name: 'Cash - Payroll Account', type: 'ASSET' },
  { code: '2025', name: 'Cash - Payroll', type: 'ASSET' },
  { code: '1020', name: 'Cash - Savings Reserve', type: 'ASSET' },
  { code: '1100', name: 'Accounts Receivable - Trade', type: 'ASSET' },
  { code: '1110', name: 'Accounts Receivable - Factory', type: 'ASSET' },
  { code: '1120', name: 'Accounts Receivable - Finance', type: 'ASSET' },
  { code: '1200', name: 'New Vehicle Inventory', type: 'ASSET' },
  { code: '1210', name: 'Used Vehicle Inventory', type: 'ASSET' },
  { code: '1220', name: 'Demo Vehicles', type: 'ASSET' },
  { code: '1300', name: 'Parts Inventory', type: 'ASSET' },
  { code: '1400', name: 'Prepaid Insurance', type: 'ASSET' },
  { code: '1500', name: 'Land', type: 'ASSET' },
  { code: '1510', name: 'Buildings', type: 'ASSET' },
  { code: '1530', name: 'Furniture & Fixtures', type: 'ASSET' },
  { code: '1540', name: 'Shop Equipment', type: 'ASSET' },
  // Liabilities
  { code: '2000', name: 'Accounts Payable - Trade', type: 'LIABILITY' },
  { code: '2100', name: 'New Vehicle Floor Plan', type: 'LIABILITY' },
  { code: '2110', name: 'Used Vehicle Floor Plan', type: 'LIABILITY' },
  { code: '2200', name: 'Accrued Payroll', type: 'LIABILITY' },
  { code: '2210', name: 'Payroll Taxes Payable', type: 'LIABILITY' },
  { code: '3210', name: 'Accrued Payroll (Payroll Posting)', type: 'LIABILITY' },
  { code: '3231', name: 'Federal Tax Withholding', type: 'LIABILITY' },
  { code: '2300', name: 'Sales Tax Payable', type: 'LIABILITY' },
  { code: '2400', name: 'Customer Deposits', type: 'LIABILITY' },
  { code: '2500', name: 'Long-Term Debt', type: 'LIABILITY' },
  // Equity
  { code: '3000', name: 'Owner Equity', type: 'EQUITY' },
  { code: '3100', name: 'Retained Earnings', type: 'EQUITY' },
  // Revenue
  { code: '4000', name: 'New Vehicle Sales', type: 'REVENUE' },
  { code: '4010', name: 'Used Vehicle Sales - Retail', type: 'REVENUE' },
  { code: '4020', name: 'Used Vehicle Sales - Wholesale', type: 'REVENUE' },
  { code: '4100', name: 'Service Labor Sales', type: 'REVENUE' },
  { code: '4110', name: 'Service Sublet Revenue', type: 'REVENUE' },
  { code: '4200', name: 'Parts Sales - Counter', type: 'REVENUE' },
  { code: '4210', name: 'Parts Sales - Internal', type: 'REVENUE' },
  { code: '4300', name: 'Body Shop Revenue', type: 'REVENUE' },
  { code: '4400', name: 'F&I Income', type: 'REVENUE' },
  { code: '4420', name: 'Warranty Revenue', type: 'REVENUE' },
  { code: '4500', name: 'Factory Incentives', type: 'REVENUE' },
  // Cost of Sales
  { code: '5000', name: 'Cost of New Vehicles Sold', type: 'COST_OF_SALES' },
  { code: '5010', name: 'Cost of Used Vehicles Sold', type: 'COST_OF_SALES' },
  { code: '5100', name: 'Service Cost of Sales', type: 'COST_OF_SALES' },
  { code: '5200', name: 'Parts Cost of Sales', type: 'COST_OF_SALES' },
  { code: '5300', name: 'Body Shop Cost of Sales', type: 'COST_OF_SALES' },
  // Expenses
  { code: '6000', name: 'Salaries - Management', type: 'EXPENSE' },
  { code: '6010', name: 'Commissions - Sales', type: 'EXPENSE' },
  { code: '6030', name: 'Wages - Service Technicians', type: 'EXPENSE' },
  { code: '6040', name: 'Wages - Parts Personnel', type: 'EXPENSE' },
  { code: '6100', name: 'Payroll Taxes', type: 'EXPENSE' },
  { code: '6110', name: 'Employee Benefits', type: 'EXPENSE' },
  { code: '6200', name: 'Advertising', type: 'EXPENSE' },
  { code: '6300', name: 'Rent Expense', type: 'EXPENSE' },
  { code: '6310', name: 'Utilities', type: 'EXPENSE' },
  { code: '6320', name: 'Insurance', type: 'EXPENSE' },
  { code: '6400', name: 'Depreciation Expense', type: 'EXPENSE' },
  { code: '6500', name: 'Floor Plan Interest', type: 'EXPENSE' },
  { code: '6800', name: 'DMS / IT Expense', type: 'EXPENSE' },
  { code: '6900', name: 'Miscellaneous Expense', type: 'EXPENSE' },
];

// Journal entries with balanced debit/credit lines (amounts in cents)
const JOURNAL_ENTRIES = [
  {
    desc: 'New Vehicle Sale - Stock #N4521 2026 Silverado', date: '2026-03-01', status: 'POSTED', source: 'CONNECTOR_CDK',
    lines: [
      { code: '1000', debit: 4850000, credit: 0 },
      { code: '4000', debit: 0, credit: 4850000 },
      { code: '5000', debit: 4520000, credit: 0 },
      { code: '1200', debit: 0, credit: 4520000 },
    ],
  },
  {
    desc: 'New Vehicle Sale - Stock #N4535 2026 Equinox EV', date: '2026-03-03', status: 'POSTED', source: 'CONNECTOR_CDK',
    lines: [
      { code: '1000', debit: 3950000, credit: 0 },
      { code: '4000', debit: 0, credit: 3950000 },
      { code: '5000', debit: 3710000, credit: 0 },
      { code: '1200', debit: 0, credit: 3710000 },
    ],
  },
  {
    desc: 'Used Vehicle Sale - Stock #U2210 2023 F-150', date: '2026-03-04', status: 'POSTED', source: 'CONNECTOR_CDK',
    lines: [
      { code: '1000', debit: 3120000, credit: 0 },
      { code: '4010', debit: 0, credit: 3120000 },
      { code: '5010', debit: 2780000, credit: 0 },
      { code: '1210', debit: 0, credit: 2780000 },
    ],
  },
  {
    desc: 'Service RO #8834 - Customer Pay', date: '2026-03-05', status: 'POSTED', source: 'CONNECTOR_CDK',
    lines: [
      { code: '1100', debit: 189000, credit: 0 },
      { code: '4100', debit: 0, credit: 135000 },
      { code: '4200', debit: 0, credit: 54000 },
      { code: '5100', debit: 68000, credit: 0 },
      { code: '5200', debit: 38000, credit: 0 },
      { code: '1300', debit: 0, credit: 38000 },
      { code: '2300', debit: 0, credit: 68000 },
    ],
  },
  {
    desc: 'Service RO #8841 - Warranty Repair', date: '2026-03-06', status: 'POSTED', source: 'CONNECTOR_CDK',
    lines: [
      { code: '1110', debit: 95000, credit: 0 },
      { code: '4420', debit: 0, credit: 95000 },
      { code: '5100', debit: 48000, credit: 0 },
      { code: '5200', debit: 0, credit: 0 },
      { code: '1300', debit: 0, credit: 48000 },
    ],
  },
  {
    desc: 'Body Shop RO #B-412 - Insurance Claim', date: '2026-03-07', status: 'POSTED', source: 'CONNECTOR_CDK',
    lines: [
      { code: '1100', debit: 670000, credit: 0 },
      { code: '4300', debit: 0, credit: 670000 },
      { code: '5300', debit: 480000, credit: 0 },
      { code: '1300', debit: 0, credit: 480000 },
    ],
  },
  {
    desc: 'F&I Deal #D-1221 - Finance Reserve & Products', date: '2026-03-08', status: 'POSTED', source: 'CONNECTOR_CDK',
    lines: [
      { code: '1120', debit: 780000, credit: 0 },
      { code: '4400', debit: 0, credit: 780000 },
    ],
  },
  {
    desc: 'Payroll Batch March W1', date: '2026-03-07', status: 'POSTED', source: 'PAYROLL',
    lines: [
      { code: '6000', debit: 450000, credit: 0 },
      { code: '6010', debit: 1200000, credit: 0 },
      { code: '6030', debit: 800000, credit: 0 },
      { code: '6040', debit: 320000, credit: 0 },
      { code: '6100', debit: 280000, credit: 0 },
      { code: '6110', debit: 190000, credit: 0 },
      { code: '2200', debit: 0, credit: 2480000 },
      { code: '2210', debit: 0, credit: 760000 },
    ],
  },
  {
    desc: 'Payroll Batch March W2', date: '2026-03-14', status: 'POSTED', source: 'PAYROLL',
    lines: [
      { code: '6000', debit: 450000, credit: 0 },
      { code: '6010', debit: 1350000, credit: 0 },
      { code: '6030', debit: 820000, credit: 0 },
      { code: '6040', debit: 310000, credit: 0 },
      { code: '6100', debit: 295000, credit: 0 },
      { code: '6110', debit: 195000, credit: 0 },
      { code: '2200', debit: 0, credit: 2615000 },
      { code: '2210', debit: 0, credit: 805000 },
    ],
  },
  {
    desc: 'Monthly Rent & Utilities', date: '2026-03-01', status: 'POSTED', source: 'MANUAL',
    lines: [
      { code: '6300', debit: 850000, credit: 0 },
      { code: '6310', debit: 145000, credit: 0 },
      { code: '2000', debit: 0, credit: 995000 },
    ],
  },
  {
    desc: 'Floor Plan Interest - March', date: '2026-03-15', status: 'POSTED', source: 'MANUAL',
    lines: [
      { code: '6500', debit: 425000, credit: 0 },
      { code: '2100', debit: 0, credit: 425000 },
    ],
  },
  {
    desc: 'Factory Incentive Credit - GM Q1', date: '2026-03-18', status: 'POSTED', source: 'CONNECTOR_CDK',
    lines: [
      { code: '1110', debit: 320000, credit: 0 },
      { code: '4500', debit: 0, credit: 320000 },
    ],
  },
  {
    desc: 'Advertising - March Digital Campaign', date: '2026-03-10', status: 'POSTED', source: 'MANUAL',
    lines: [
      { code: '6200', debit: 285000, credit: 0 },
      { code: '2000', debit: 0, credit: 285000 },
    ],
  },
  {
    desc: 'Warranty Claim #W-3321 - Pending Review', date: '2026-03-20', status: 'DRAFT', source: 'CONNECTOR_CDK',
    lines: [
      { code: '1110', debit: 45000, credit: 0 },
      { code: '4420', debit: 0, credit: 45000 },
    ],
  },
  {
    desc: 'Used Vehicle Purchase - Auction #A-889', date: '2026-03-21', status: 'DRAFT', source: 'MANUAL',
    lines: [
      { code: '1210', debit: 2150000, credit: 0 },
      { code: '2110', debit: 0, credit: 2150000 },
    ],
  },
  {
    desc: 'DMS Monthly Fee + IT Support', date: '2026-03-01', status: 'POSTED', source: 'MANUAL',
    lines: [
      { code: '6800', debit: 175000, credit: 0 },
      { code: '2000', debit: 0, credit: 175000 },
    ],
  },
];

// ── EOM Close with steps (codes must match step-handlers.ts canHandle()) ────
const EOM_STEPS = [
  { code: '010', name: 'Pre-Close Checklist', status: 'DONE' },
  { code: '020', name: 'Verify Open Items', status: 'DONE' },
  { code: '062', name: 'Parts Close', status: 'DONE' },
  { code: '065', name: 'Parts Reconciliation', status: 'DONE' },
  { code: '068', name: 'Service Close', status: 'RUNNING' },
  { code: '070', name: 'Body Shop Close', status: 'PENDING' },
  { code: '071', name: 'Variable Operations Close', status: 'PENDING' },
  { code: '074', name: 'Fixed Operations Close', status: 'PENDING' },
  { code: '077', name: 'Master Close', status: 'PENDING' },
  { code: '200', name: 'FS Generation', status: 'PENDING' },
  { code: '300', name: 'FS Submission to OEM', status: 'PENDING' },
];

// ── AR Entries (various ages) ───────────────────────────────────────────────
const AR_ENTRIES = [
  { ref: 'INV-4521', type: 'RECEIVABLE', amount: 485000, due: '2026-03-28', status: 'OPEN' },
  { ref: 'INV-4522', type: 'RECEIVABLE', amount: 312000, due: '2026-03-25', status: 'OPEN' },
  { ref: 'WC-3301', type: 'WARRANTY', amount: 95000, due: '2026-03-15', status: 'OPEN' },
  { ref: 'WC-3290', type: 'WARRANTY', amount: 78000, due: '2026-02-20', status: 'OPEN' },
  { ref: 'INV-4498', type: 'RECEIVABLE', amount: 234000, due: '2026-02-15', status: 'OPEN' },
  { ref: 'INV-4472', type: 'RECEIVABLE', amount: 156000, due: '2026-01-28', status: 'OPEN' },
  { ref: 'INV-4401', type: 'RECEIVABLE', amount: 89000, due: '2025-12-15', status: 'OPEN' },
  { ref: 'WC-3210', type: 'WARRANTY', amount: 42000, due: '2025-11-30', status: 'OPEN' },
];

// ── AP Entries ──────────────────────────────────────────────────────────────
const AP_ENTRIES = [
  { vendor: 'AutoNation Parts', inv: 'AP-8801', amount: 132000, due: '2026-03-30' },
  { vendor: 'NAPA Auto Parts', inv: 'AP-8802', amount: 89000, due: '2026-03-28' },
  { vendor: 'Shell Fleet Fuel', inv: 'AP-8803', amount: 45000, due: '2026-03-25' },
  { vendor: 'Sherwin-Williams', inv: 'AP-8804', amount: 67000, due: '2026-03-20' },
  { vendor: 'PPG Industries', inv: 'AP-8790', amount: 41000, due: '2026-02-28' },
  { vendor: 'Snap-On Tools', inv: 'AP-8775', amount: 23000, due: '2026-02-15' },
  { vendor: 'Reynolds & Reynolds', inv: 'AP-8760', amount: 15000, due: '2026-01-30' },
  { vendor: 'Würth USA', inv: 'AP-8740', amount: 8000, due: '2025-12-20' },
];

// ── Bank Recon Sessions ─────────────────────────────────────────────────────
const RECON_SESSIONS = [
  { account: 'Operating Checking', glBal: 18520000, bankBal: 18645000, variance: 125000, status: 'OPEN' },
  { account: 'Payroll Account', glBal: 4230000, bankBal: 4230000, variance: 0, status: 'RECONCILED' },
];

async function seed() {
  const client = await pool.connect();
  console.log('Seed Script — starting...\n');

  try {
    // ── 1. Seed GL Accounts ───────────────────────────────────────────────
    const existingAccounts = await client.query(
      `SELECT id FROM gl_accounts WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID]
    );
    const accountIdMap: Record<string, string> = {};

    if (existingAccounts.rows.length === 0) {
      for (const acct of GL_ACCOUNTS) {
        const res = await client.query(
          `INSERT INTO gl_accounts (id, tenant_id, code, name, type, is_active)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
           ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
           RETURNING id`,
          [TENANT_ID, acct.code, acct.name, acct.type]
        );
        accountIdMap[acct.code] = res.rows[0].id;
      }
      console.log(`  GL Accounts: ${GL_ACCOUNTS.length} accounts created`);
    } else {
      const rows = await client.query(
        `SELECT id, code FROM gl_accounts WHERE tenant_id = $1`, [TENANT_ID]
      );
      for (const r of rows.rows) accountIdMap[r.code] = r.id;
      console.log(`  GL Accounts: already exist (${rows.rows.length} found)`);
    }

    // ── 2. Seed Journal Entries ─────────────────────────────────────────────
    const existingEntries = await client.query(
      `SELECT id FROM journal_entries WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID]
    );

    if (existingEntries.rows.length === 0) {
      for (const e of JOURNAL_ENTRIES) {
        const res = await client.query(
          `INSERT INTO journal_entries (id, tenant_id, entry_date, description, source, source_ref, status, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $2)
           RETURNING id`,
          [TENANT_ID, e.date, e.desc, e.source, null, e.status]
        );
        const entryId = res.rows[0].id;
        for (const l of e.lines) {
          const glAccountId = accountIdMap[l.code];
          if (!glAccountId) { console.warn(`    WARN: no account for code ${l.code}`); continue; }
          await client.query(
            `INSERT INTO journal_lines (id, journal_entry_id, gl_account_id, debit, credit, memo)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
            [entryId, glAccountId, l.debit / 100, l.credit / 100, null]
          );
        }
      }
      console.log(`  Journal Entries: ${JOURNAL_ENTRIES.length} entries created with lines`);
    } else {
      console.log(`  Journal Entries: already exist, skipping`);
    }

    // ── 3. Seed EOM Close ───────────────────────────────────────────────────
    const existingEom = await client.query(
      `SELECT id FROM eom_closes WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID]
    );

    if (existingEom.rows.length === 0) {
      const now = new Date();
      const res = await client.query(
        `INSERT INTO eom_closes (id, tenant_id, period_year, period_month, status, current_step, started_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'IN_PROGRESS', '068', NOW())
         RETURNING id`,
        [TENANT_ID, now.getFullYear(), now.getMonth() + 1]
      );
      const eomId = res.rows[0].id;
      for (const step of EOM_STEPS) {
        await client.query(
          `INSERT INTO eom_steps (id, eom_close_id, step_code, step_name, status, started_at, completed_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
          [eomId, step.code, step.name, step.status,
            step.status !== 'PENDING' ? new Date() : null,
            step.status === 'DONE' ? new Date() : null]
        );
      }
      console.log(`  EOM Close: created with ${EOM_STEPS.length} steps`);
    } else {
      console.log(`  EOM Close: already exists, skipping`);
    }

    // ── 4. Seed AR Entries ──────────────────────────────────────────────────
    const existingAR = await client.query(
      `SELECT id FROM ar_entries WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID]
    );

    if (existingAR.rows.length === 0) {
      for (const ar of AR_ENTRIES) {
        await client.query(
          `INSERT INTO ar_entries (id, tenant_id, dealer_ref, type, amount, due_date, status, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())`,
          [TENANT_ID, ar.ref, ar.type, ar.amount / 100, ar.due, ar.status]
        );
      }
      console.log(`  AR Entries: ${AR_ENTRIES.length} entries created`);
    } else {
      console.log(`  AR Entries: already exist, skipping`);
    }

    // ── 5. Seed AP Entries ──────────────────────────────────────────────────
    const existingAP = await client.query(
      `SELECT id FROM ap_entries WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID]
    );

    if (existingAP.rows.length === 0) {
      for (const ap of AP_ENTRIES) {
        await client.query(
          `INSERT INTO ap_entries (id, tenant_id, vendor_name, invoice_ref, amount, due_date, status, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'OPEN', NOW())`,
          [TENANT_ID, ap.vendor, ap.inv, ap.amount / 100, ap.due]
        );
      }
      console.log(`  AP Entries: ${AP_ENTRIES.length} entries created`);
    } else {
      console.log(`  AP Entries: already exist, skipping`);
    }

    // ── 6. Seed Bank Recon Sessions ─────────────────────────────────────────
    const existingRecon = await client.query(
      `SELECT id FROM bank_recons WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID]
    );

    if (existingRecon.rows.length === 0) {
      for (const r of RECON_SESSIONS) {
        await client.query(
          `INSERT INTO bank_recons (id, tenant_id, account_name, recon_date, gl_balance, bank_balance, variance, status)
           VALUES (gen_random_uuid(), $1, $2, NOW(), $3, $4, $5, $6)`,
          [TENANT_ID, r.account, r.glBal / 100, r.bankBal / 100, r.variance / 100, r.status]
        );
      }
      console.log(`  Bank Recons: ${RECON_SESSIONS.length} sessions created`);
    } else {
      console.log(`  Bank Recons: already exist, skipping`);
    }

    // ── 7. Seed Payroll Batch ───────────────────────────────────────────────
    const existingPayroll = await client.query(
      `SELECT id FROM payroll_batches WHERE tenant_id = $1 LIMIT 1`, [TENANT_ID]
    );

    if (existingPayroll.rows.length === 0) {
      await client.query(
        `INSERT INTO payroll_batches (id, tenant_id, batch_ref, period_start, period_end, total_amount, status, idempotency_key, submitted_at)
         VALUES (gen_random_uuid(), $1, 'PR-2026-03-W1', '2026-03-01', '2026-03-07', 32400, 'POSTED', 'pr-2026-03-w1', '2026-03-07'),
                (gen_random_uuid(), $1, 'PR-2026-03-W2', '2026-03-08', '2026-03-14', 34200, 'POSTED', 'pr-2026-03-w2', '2026-03-14'),
                (gen_random_uuid(), $1, 'PR-2026-03-W3', '2026-03-15', '2026-03-21', 33800, 'VALIDATED', 'pr-2026-03-w3', NOW())`,
        [TENANT_ID]
      );
      console.log(`  Payroll Batches: 3 batches created`);
    } else {
      console.log(`  Payroll Batches: already exist, skipping`);
    }

    // ── Gap-Filling Service Seed Data ────────────────────────────────────

    // User Preferences (Gap 14)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'CONTROLLER',
        dashboard_layout JSONB DEFAULT '{}',
        default_filters JSONB DEFAULT '{}',
        notifications JSONB DEFAULT '{}',
        timezone TEXT DEFAULT 'America/Chicago',
        UNIQUE(tenant_id, user_id)
      )
    `);
    await client.query(`
      INSERT INTO user_preferences (tenant_id, user_id, role, timezone)
      VALUES ($1, 'user-controller-1', 'CONTROLLER', 'America/Chicago')
      ON CONFLICT (tenant_id, user_id) DO NOTHING
    `, [TENANT_ID]);
    console.log('  User Preferences: seeded');

    // Data Quality (Gap 15) — reports table
    await client.query(`
      CREATE TABLE IF NOT EXISTS data_quality_reports (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id TEXT NOT NULL,
        period TEXT NOT NULL,
        overall_score INT DEFAULT 85,
        journal_line_score INT DEFAULT 90,
        payroll_line_score INT DEFAULT 82,
        deal_product_score INT DEFAULT 88,
        issues JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO data_quality_reports (tenant_id, period, overall_score, journal_line_score, payroll_line_score, deal_product_score, issues)
      VALUES ($1, '2026-03', 85, 90, 82, 88, '[{"type":"MISSING_DEPT","count":3},{"type":"DUPLICATE_REF","count":1}]')
      ON CONFLICT DO NOTHING
    `, [TENANT_ID]);
    console.log('  Data Quality Reports: seeded');

    // ESG Metrics (Gap 12)
    await client.query(`
      CREATE TABLE IF NOT EXISTS esg_metrics (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id TEXT NOT NULL,
        metric_type TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        period TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO esg_metrics (tenant_id, metric_type, value, unit, period)
      VALUES ($1, 'CARBON_TONS', 42.5, 'tons', '2026-03'),
             ($1, 'EV_REVENUE_PCT', 23, '%', '2026-03'),
             ($1, 'ENERGY_KWH', 18500, 'kWh', '2026-03')
      ON CONFLICT DO NOTHING
    `, [TENANT_ID]);
    console.log('  ESG Metrics: seeded');

    // Compliance Rules (Gap 7)
    await client.query(`
      CREATE TABLE IF NOT EXISTS compliance_rules (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id TEXT NOT NULL,
        rule_code TEXT NOT NULL,
        description TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        configuration JSONB DEFAULT '{}',
        UNIQUE(tenant_id, rule_code)
      )
    `);
    await client.query(`
      INSERT INTO compliance_rules (tenant_id, rule_code, description)
      VALUES ($1, 'IRS_8300', 'Cash transactions >$10K reporting'),
             ($1, '401K_ANNUAL_LIMIT', '401(k) annual contribution limit'),
             ($1, 'FUTA_WAGE_BASE', 'FUTA wage base compliance')
      ON CONFLICT (tenant_id, rule_code) DO NOTHING
    `, [TENANT_ID]);
    console.log('  Compliance Rules: seeded');

    // Revenue Contracts (Gap 6)
    await client.query(`
      CREATE TABLE IF NOT EXISTS revenue_contracts (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id TEXT NOT NULL,
        deal_number TEXT NOT NULL,
        product_type TEXT NOT NULL,
        total_value REAL NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        recognition_method TEXT DEFAULT 'STRAIGHT_LINE',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      INSERT INTO revenue_contracts (tenant_id, deal_number, product_type, total_value, start_date, end_date)
      VALUES ($1, 'D-2026-0142', 'SERVICE_CONTRACT', 2400, '2026-01-15', '2028-01-15'),
             ($1, 'D-2026-0143', 'EXTENDED_WARRANTY', 1800, '2026-02-01', '2029-02-01')
      ON CONFLICT DO NOTHING
    `, [TENANT_ID]);
    console.log('  Revenue Contracts: seeded');

    console.log('\nSeed completed successfully.');
  } catch (err) {
    console.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
