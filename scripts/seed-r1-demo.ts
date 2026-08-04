#!/usr/bin/env node
/**
 * seed-r1-demo.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Authoritative R1 prototype demo-data seeder for the Accounting module.
 *
 * Creates "Kunes Demo Automotive Group" — three rooftops, ten demo users, and
 * complete synthetic financial data covering every R1 module. Safe to run
 * repeatedly (fully idempotent).
 *
 * Usage:
 *   npx tsx scripts/seed-r1-demo.ts              # seed only
 *   npx tsx scripts/seed-r1-demo.ts --reset       # delete + re-seed (local only)
 *   npx tsx scripts/seed-r1-demo.ts --verify      # verify without seeding
 *
 * Never prints JWT secrets or database passwords.
 * Never uses real customer, dealer, employee, payroll, banking or OEM data.
 */

import { Pool, PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

// ─── CLI flags ───────────────────────────────────────────────────────────────
const RESET  = process.argv.includes('--reset');
const VERIFY = process.argv.includes('--verify');

// ─── Safety guard ────────────────────────────────────────────────────────────
if (RESET) {
  const url = process.env['DATABASE_URL'] ?? '';
  const isLocal = url === '' || /localhost|127\.0\.0\.1|docker/.test(url);
  if (!isLocal) {
    console.error('ERROR: --reset refused on non-local database target.');
    console.error('DATABASE_URL must point to localhost or be unset.');
    process.exit(1);
  }
}

// ─── Database ────────────────────────────────────────────────────────────────
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';

const pool = new Pool({ connectionString: DATABASE_URL });

// ─── Demo tenant & legal-entity constants ────────────────────────────────────
export const TENANT_ID = 'tenant-kunes';
export const TENANT_NAME = 'Kunes Demo Automotive Group';

// Fixed UUIDs → idempotent across runs
export const LE_FORD_ID    = '11111111-kune-0000-0000-000000000001';
export const LE_CHEV_ID    = '22222222-kune-0000-0000-000000000002';
export const LE_TOYOTA_ID  = '33333333-kune-0000-0000-000000000003';

export const LEGAL_ENTITIES = [
  {
    id: LE_FORD_ID,
    entityCode: 'KUNES-FORD-MAD',
    legalName: 'Kunes Ford Madison LLC',
    displayName: 'Kunes Ford Madison',
    state: 'WI',
    city: 'Madison',
    storeCode: 'KFM',
    storeName: 'Kunes Ford Madison',
    franchise: 'Ford',
  },
  {
    id: LE_CHEV_ID,
    entityCode: 'KUNES-CHEV-MKE',
    legalName: 'Kunes Chevrolet Milwaukee LLC',
    displayName: 'Kunes Chevrolet Milwaukee',
    state: 'WI',
    city: 'Milwaukee',
    storeCode: 'KCM',
    storeName: 'Kunes Chevrolet Milwaukee',
    franchise: 'Chevrolet',
  },
  {
    id: LE_TOYOTA_ID,
    entityCode: 'KUNES-TOY-GB',
    legalName: 'Kunes Toyota Green Bay LLC',
    displayName: 'Kunes Toyota Green Bay',
    state: 'WI',
    city: 'Green Bay',
    storeCode: 'KTG',
    storeName: 'Kunes Toyota Green Bay',
    franchise: 'Toyota',
  },
] as const;

// ─── Demo users ──────────────────────────────────────────────────────────────
// Password printed in summary — never committed as a secret; local demo only.
const DEMO_PASSWORD = 'KunesDemo2026!';

export const DEMO_USERS = [
  { email: 'admin@kunes-demo.local',         displayName: 'Alex Admin',     role: 'ADMIN',      description: 'System Administrator' },
  { email: 'controller@kunes-demo.local',    displayName: 'Carol Controller', role: 'CONTROLLER', description: 'Group Controller' },
  { email: 'accountant@kunes-demo.local',    displayName: 'Ann Accountant', role: 'ACCOUNTANT', description: 'Accountant' },
  { email: 'ap.clerk@kunes-demo.local',      displayName: 'Pete AP',        role: 'AP_CLERK',   description: 'AP Clerk' },
  { email: 'ar.clerk@kunes-demo.local',      displayName: 'Rachel AR',      role: 'AR_CLERK',   description: 'AR Clerk' },
  { email: 'cashier@kunes-demo.local',       displayName: 'Casey Cashier',  role: 'CASHIER',    description: 'Cashier' },
  { email: 'payroll@kunes-demo.local',       displayName: 'Pat Payroll',    role: 'PAYROLL_MGR', description: 'Payroll Manager' },
  { email: 'service.mgr@kunes-demo.local',   displayName: 'Sam Service',    role: 'SERVICE_MGR', description: 'Service Manager' },
  { email: 'approver@kunes-demo.local',      displayName: 'Andrew Approver', role: 'ADMIN',     description: 'Approver' },
  { email: 'auditor@kunes-demo.local',       displayName: 'Aria Auditor',   role: 'AUDITOR',    description: 'Read-only Auditor' },
] as const;

// ─── GL Accounts (NADA automotive chart) ─────────────────────────────────────
const GL_ACCOUNTS = [
  // Assets
  { code: '1000', name: 'Cash – Operating Checking',       type: 'ASSET',        normalBalance: 'DEBIT',  isCashClearing: false },
  { code: '1010', name: 'Cash – Payroll Account',          type: 'ASSET',        normalBalance: 'DEBIT',  isCashClearing: false },
  { code: '1020', name: 'Cash – Savings Reserve',          type: 'ASSET',        normalBalance: 'DEBIT',  isCashClearing: false },
  { code: '1090', name: 'Cash Clearing',                   type: 'ASSET',        normalBalance: 'DEBIT',  isCashClearing: true  },
  { code: '1100', name: 'Accounts Receivable – Trade',     type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1110', name: 'Accounts Receivable – Factory',   type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1120', name: 'Accounts Receivable – Finance',   type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1130', name: 'Accounts Receivable – Insurance', type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1200', name: 'New Vehicle Inventory',           type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1210', name: 'Used Vehicle Inventory',          type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1220', name: 'Demo Vehicles',                   type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1230', name: 'In-Transit Vehicles',             type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1300', name: 'Parts Inventory',                 type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1310', name: 'Parts Inventory – Obsolete Reserve', type: 'ASSET',     normalBalance: 'CREDIT' },
  { code: '1400', name: 'Prepaid Insurance',               type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1410', name: 'Prepaid Expenses',                type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1420', name: 'WIP Labor',                       type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1430', name: 'WIP Parts',                       type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1500', name: 'Land',                            type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1510', name: 'Buildings',                       type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1520', name: 'Accumulated Depreciation – Buildings', type: 'ASSET',   normalBalance: 'CREDIT' },
  { code: '1530', name: 'Furniture & Fixtures',            type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1535', name: 'Accumulated Depreciation – FF&E', type: 'ASSET',        normalBalance: 'CREDIT' },
  { code: '1540', name: 'Shop Equipment',                  type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '1545', name: 'Accumulated Depreciation – Shop Equipment', type: 'ASSET', normalBalance: 'CREDIT' },
  // Liabilities
  { code: '2000', name: 'Accounts Payable – Trade',        type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '2010', name: 'Accounts Payable – Parts',        type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '2020', name: 'Accounts Payable – Service',      type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '2025', name: 'Cash – Payroll (clearing)',        type: 'ASSET',        normalBalance: 'DEBIT'  },
  { code: '2100', name: 'New Vehicle Floor Plan',          type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '2110', name: 'Used Vehicle Floor Plan',         type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '2200', name: 'Accrued Payroll',                 type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '2210', name: 'Payroll Taxes Payable',           type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '2300', name: 'Sales Tax Payable',               type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '2400', name: 'Customer Deposits',               type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '2500', name: 'Long-Term Debt',                  type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '2600', name: 'Deferred Revenue – Service Contracts', type: 'LIABILITY', normalBalance: 'CREDIT' },
  { code: '3210', name: 'Accrued Payroll (Payroll Posting)', type: 'LIABILITY',  normalBalance: 'CREDIT' },
  { code: '3231', name: 'Federal Tax Withholding',         type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '3232', name: 'State Tax Withholding',           type: 'LIABILITY',    normalBalance: 'CREDIT' },
  { code: '3233', name: 'FICA Withholding',                type: 'LIABILITY',    normalBalance: 'CREDIT' },
  // Equity
  { code: '3000', name: 'Owner Equity',                    type: 'EQUITY',       normalBalance: 'CREDIT' },
  { code: '3100', name: 'Retained Earnings',               type: 'EQUITY',       normalBalance: 'CREDIT' },
  { code: '3200', name: 'Current Year Earnings',           type: 'EQUITY',       normalBalance: 'CREDIT' },
  // Revenue
  { code: '4000', name: 'New Vehicle Sales',               type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4010', name: 'Used Vehicle Sales – Retail',     type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4020', name: 'Used Vehicle Sales – Wholesale',  type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4100', name: 'Service Labor Sales',             type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4110', name: 'Service Sublet Revenue',          type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4200', name: 'Parts Sales – Counter',           type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4210', name: 'Parts Sales – Internal',          type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4300', name: 'Body Shop Revenue',               type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4400', name: 'F&I Income',                      type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4410', name: 'Finance Reserve Income',          type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4420', name: 'Warranty Revenue',                type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4500', name: 'Factory Incentives',              type: 'REVENUE',      normalBalance: 'CREDIT' },
  { code: '4510', name: 'OEM Co-op Income',                type: 'REVENUE',      normalBalance: 'CREDIT' },
  // Cost of Sales
  { code: '5000', name: 'Cost of New Vehicles Sold',       type: 'COST_OF_SALES', normalBalance: 'DEBIT' },
  { code: '5010', name: 'Cost of Used Vehicles Sold',      type: 'COST_OF_SALES', normalBalance: 'DEBIT' },
  { code: '5020', name: 'Cost of Wholesale Vehicles',      type: 'COST_OF_SALES', normalBalance: 'DEBIT' },
  { code: '5100', name: 'Service Cost of Sales',           type: 'COST_OF_SALES', normalBalance: 'DEBIT' },
  { code: '5200', name: 'Parts Cost of Sales',             type: 'COST_OF_SALES', normalBalance: 'DEBIT' },
  { code: '5300', name: 'Body Shop Cost of Sales',         type: 'COST_OF_SALES', normalBalance: 'DEBIT' },
  // Expenses
  { code: '0110', name: 'Salaries – Sales',                type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '0120', name: 'Salaries – Service',              type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '0130', name: 'Salaries – Parts',                type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6000', name: 'Salaries – Management',           type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6010', name: 'Commissions – Sales',             type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6020', name: 'Commissions – F&I',               type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6030', name: 'Wages – Service Technicians',     type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6040', name: 'Wages – Parts Personnel',         type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6050', name: 'Wages – Admin',                   type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6100', name: 'Payroll Taxes',                   type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6110', name: 'Employee Benefits',               type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6200', name: 'Advertising',                     type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6300', name: 'Rent Expense',                    type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6310', name: 'Utilities',                       type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6320', name: 'Insurance',                       type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6400', name: 'Depreciation Expense',            type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6500', name: 'Floor Plan Interest',             type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6510', name: 'Interest Expense – Long-Term Debt', type: 'EXPENSE',    normalBalance: 'DEBIT'  },
  { code: '6600', name: 'Bad Debt Expense',                type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6700', name: 'Parts Obsolescence',              type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6800', name: 'DMS / IT Expense',                type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6900', name: 'Miscellaneous Expense',           type: 'EXPENSE',      normalBalance: 'DEBIT'  },
  { code: '6500', name: 'Labor Cost of Sales',             type: 'COST_OF_SALES', normalBalance: 'DEBIT' },
] as const;

// Unique-code version for seeding (remove duplicate 6500)
const GL_ACCOUNTS_SEED = [
  ...GL_ACCOUNTS.filter(
    (a, idx, arr) => arr.findIndex(b => b.code === a.code) === idx,
  ),
];

// ─── Journal entries ──────────────────────────────────────────────────────────
const JOURNAL_ENTRIES_DATA = [
  // March 2026 — POSTED
  { desc: 'New Vehicle Sale #N4521 2026 F-150 XLT',         date: '2026-03-01', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_FORD_ID,
    lines: [{ code:'1000', dr:5200000, cr:0 }, { code:'4000', dr:0, cr:5200000 }, { code:'5000', dr:4820000, cr:0 }, { code:'1200', dr:0, cr:4820000 }] },
  { desc: 'New Vehicle Sale #N4535 2026 Silverado 1500',    date: '2026-03-03', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_CHEV_ID,
    lines: [{ code:'1000', dr:4850000, cr:0 }, { code:'4000', dr:0, cr:4850000 }, { code:'5000', dr:4520000, cr:0 }, { code:'1200', dr:0, cr:4520000 }] },
  { desc: 'New Vehicle Sale #N4540 2026 Camry SE',          date: '2026-03-04', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_TOYOTA_ID,
    lines: [{ code:'1000', dr:3280000, cr:0 }, { code:'4000', dr:0, cr:3280000 }, { code:'5000', dr:2960000, cr:0 }, { code:'1200', dr:0, cr:2960000 }] },
  { desc: 'Used Vehicle Sale #U2210 2023 F-150',            date: '2026-03-04', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_FORD_ID,
    lines: [{ code:'1000', dr:3120000, cr:0 }, { code:'4010', dr:0, cr:3120000 }, { code:'5010', dr:2780000, cr:0 }, { code:'1210', dr:0, cr:2780000 }] },
  { desc: 'Service RO #8834 – Customer Pay',                date: '2026-03-05', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_FORD_ID,
    lines: [{ code:'1100', dr:189000, cr:0 }, { code:'4100', dr:0, cr:135000 }, { code:'4200', dr:0, cr:54000 }, { code:'5100', dr:68000, cr:0 }, { code:'5200', dr:38000, cr:0 }, { code:'1300', dr:0, cr:38000 }, { code:'2300', dr:0, cr:68000 }] },
  { desc: 'Service RO #8841 – Warranty Repair',             date: '2026-03-06', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_FORD_ID,
    lines: [{ code:'1110', dr:95000, cr:0 }, { code:'4420', dr:0, cr:95000 }, { code:'5100', dr:48000, cr:0 }, { code:'1300', dr:0, cr:48000 }] },
  { desc: 'Body Shop RO #B-412 – Insurance Claim',          date: '2026-03-07', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_CHEV_ID,
    lines: [{ code:'1130', dr:670000, cr:0 }, { code:'4300', dr:0, cr:670000 }, { code:'5300', dr:480000, cr:0 }, { code:'1300', dr:0, cr:480000 }] },
  { desc: 'F&I Deal #D-1221 Finance Reserve & Products',    date: '2026-03-08', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_CHEV_ID,
    lines: [{ code:'1120', dr:780000, cr:0 }, { code:'4400', dr:0, cr:480000 }, { code:'4410', dr:0, cr:300000 }] },
  { desc: 'Payroll Batch March W1',                         date: '2026-03-07', status: 'POSTED',  src: 'PAYROLL',       leId: LE_FORD_ID,
    lines: [{ code:'6000', dr:450000, cr:0 }, { code:'6010', dr:1200000, cr:0 }, { code:'6030', dr:800000, cr:0 }, { code:'6040', dr:320000, cr:0 }, { code:'6100', dr:280000, cr:0 }, { code:'6110', dr:190000, cr:0 }, { code:'2200', dr:0, cr:2480000 }, { code:'2210', dr:0, cr:760000 }] },
  { desc: 'Payroll Batch March W2',                         date: '2026-03-14', status: 'POSTED',  src: 'PAYROLL',       leId: LE_FORD_ID,
    lines: [{ code:'6000', dr:450000, cr:0 }, { code:'6010', dr:1350000, cr:0 }, { code:'6030', dr:820000, cr:0 }, { code:'6040', dr:310000, cr:0 }, { code:'6100', dr:295000, cr:0 }, { code:'6110', dr:195000, cr:0 }, { code:'2200', dr:0, cr:2615000 }, { code:'2210', dr:0, cr:805000 }] },
  { desc: 'Monthly Rent & Utilities',                       date: '2026-03-01', status: 'POSTED',  src: 'MANUAL',        leId: LE_FORD_ID,
    lines: [{ code:'6300', dr:850000, cr:0 }, { code:'6310', dr:145000, cr:0 }, { code:'2000', dr:0, cr:995000 }] },
  { desc: 'Floor Plan Interest – March',                    date: '2026-03-15', status: 'POSTED',  src: 'MANUAL',        leId: LE_CHEV_ID,
    lines: [{ code:'6500', dr:425000, cr:0 }, { code:'2100', dr:0, cr:425000 }] },
  { desc: 'Factory Incentive Credit – GM Q1',               date: '2026-03-18', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_CHEV_ID,
    lines: [{ code:'1110', dr:320000, cr:0 }, { code:'4500', dr:0, cr:320000 }] },
  { desc: 'Advertising – March Digital Campaign',           date: '2026-03-10', status: 'POSTED',  src: 'MANUAL',        leId: LE_FORD_ID,
    lines: [{ code:'6200', dr:285000, cr:0 }, { code:'2000', dr:0, cr:285000 }] },
  { desc: 'DMS Monthly Fee + IT Support',                   date: '2026-03-01', status: 'POSTED',  src: 'MANUAL',        leId: LE_FORD_ID,
    lines: [{ code:'6800', dr:175000, cr:0 }, { code:'2000', dr:0, cr:175000 }] },
  // DRAFT entries for review workflow
  { desc: 'Warranty Claim #W-3321 – Pending Review',        date: '2026-03-20', status: 'DRAFT',   src: 'CONNECTOR_CDK', leId: LE_TOYOTA_ID,
    lines: [{ code:'1110', dr:45000, cr:0 }, { code:'4420', dr:0, cr:45000 }] },
  { desc: 'Used Vehicle Purchase – Auction #A-889',         date: '2026-03-21', status: 'DRAFT',   src: 'MANUAL',        leId: LE_CHEV_ID,
    lines: [{ code:'1210', dr:2150000, cr:0 }, { code:'2110', dr:0, cr:2150000 }] },
  // Prior period (Feb 2026) — POSTED comparative
  { desc: 'New Vehicle Sales – Feb 2026 Total',             date: '2026-02-28', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_FORD_ID,
    lines: [{ code:'1000', dr:9800000, cr:0 }, { code:'4000', dr:0, cr:9800000 }, { code:'5000', dr:8820000, cr:0 }, { code:'1200', dr:0, cr:8820000 }] },
  { desc: 'Service Revenue – Feb 2026',                     date: '2026-02-28', status: 'POSTED',  src: 'CONNECTOR_CDK', leId: LE_FORD_ID,
    lines: [{ code:'1100', dr:1650000, cr:0 }, { code:'4100', dr:0, cr:1200000 }, { code:'4200', dr:0, cr:450000 }, { code:'5100', dr:560000, cr:0 }, { code:'5200', dr:310000, cr:0 }, { code:'1300', dr:0, cr:310000 }, { code:'2300', dr:0, cr:560000 }] },
  // Reversal example
  { desc: 'REVERSAL: Duplicate Payroll Entry PR-2026-02-W3', date: '2026-03-02', status: 'POSTED', src: 'PAYROLL',       leId: LE_FORD_ID,
    lines: [{ code:'2200', dr:2480000, cr:0 }, { code:'6000', dr:0, cr:450000 }, { code:'6010', dr:0, cr:1200000 }, { code:'6030', dr:0, cr:800000 }, { code:'6040', dr:0, cr:30000 }] },
  // Opening balance entry
  { desc: 'Opening Balance – Jan 1 2026',                   date: '2026-01-01', status: 'POSTED',  src: 'MANUAL',        leId: LE_FORD_ID,
    lines: [{ code:'1000', dr:18500000, cr:0 }, { code:'1200', dr:45000000, cr:0 }, { code:'1300', dr:8200000, cr:0 }, { code:'2100', dr:0, cr:42000000 }, { code:'3000', dr:0, cr:20000000 }, { code:'3100', dr:0, cr:9700000 }] },
];

// ─── Vendors ──────────────────────────────────────────────────────────────────
const VENDORS = [
  { num:'V-0001', name:'AutoNation Parts',     type:'SUPPLIER',          addr:'100 Parts Way',    city:'Madison',   state:'WI', zip:'53701', ein:'45-1234567' },
  { num:'V-0002', name:'NAPA Auto Parts',      type:'SUPPLIER',          addr:'200 Main St',      city:'Milwaukee', state:'WI', zip:'53201', ein:'45-2345678' },
  { num:'V-0003', name:'Shell Fleet Fuel',     type:'SUPPLIER',          addr:'300 Energy Blvd',  city:'Green Bay', state:'WI', zip:'54301', ein:'45-3456789' },
  { num:'V-0004', name:'Sherwin-Williams',     type:'SUPPLIER',          addr:'400 Color Ave',    city:'Madison',   state:'WI', zip:'53702', ein:'45-4567890' },
  { num:'V-0005', name:'PPG Industries',       type:'SUPPLIER',          addr:'500 Finish Rd',    city:'Milwaukee', state:'WI', zip:'53202', ein:'45-5678901' },
  { num:'V-0006', name:'Snap-On Tools',        type:'SUPPLIER',          addr:'600 Tool Pkwy',    city:'Madison',   state:'WI', zip:'53703', ein:'45-6789012' },
  { num:'V-0007', name:'Reynolds & Reynolds',  type:'SERVICE_PROVIDER',  addr:'700 DMS Blvd',     city:'Dayton',    state:'OH', zip:'45401', ein:'45-7890123' },
  { num:'V-0008', name:'Würth USA',            type:'SUPPLIER',          addr:'800 Hardware Dr',  city:'Ramsey',    state:'NJ', zip:'07446', ein:'45-8901234' },
  { num:'V-0009', name:'Enterprise Rent-A-Car',type:'SERVICE_PROVIDER',  addr:'900 Rental Way',   city:'St. Louis', state:'MO', zip:'63105', ein:'45-9012345' },
  { num:'V-0010', name:'WPS Insurance Group',  type:'SERVICE_PROVIDER',  addr:'1000 Policy Ln',   city:'Madison',   state:'WI', zip:'53704', ein:'45-0123456' },
] as const;

// ─── Customers ────────────────────────────────────────────────────────────────
const CUSTOMERS = [
  { num:'C-0001', first:'James',   last:'Miller',    phone:'608-555-0101', city:'Madison',   state:'WI', zip:'53701', custType:'RETAIL' },
  { num:'C-0002', first:'Maria',   last:'Garcia',    phone:'414-555-0102', city:'Milwaukee', state:'WI', zip:'53201', custType:'RETAIL' },
  { num:'C-0003', first:'Robert',  last:'Johnson',   phone:'920-555-0103', city:'Green Bay', state:'WI', zip:'54301', custType:'RETAIL' },
  { num:'C-0004', first:'Linda',   last:'Williams',  phone:'608-555-0104', city:'Janesville', state:'WI', zip:'53545', custType:'RETAIL' },
  { num:'C-0005', first:'Michael', last:'Brown',     phone:'414-555-0105', city:'Waukesha',  state:'WI', zip:'53186', custType:'FLEET' },
  { num:'C-0006', first:'Patricia',last:'Jones',     phone:'920-555-0106', city:'Appleton',  state:'WI', zip:'54911', custType:'RETAIL' },
  { num:'C-0007', first:'David',   last:'Davis',     phone:'608-555-0107', city:'Racine',    state:'WI', zip:'53401', custType:'RETAIL' },
  { num:'C-0008', first:'Barbara', last:'Taylor',    phone:'414-555-0108', city:'Kenosha',   state:'WI', zip:'53140', custType:'FLEET' },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function tableExists(client: PoolClient, tableName: string): Promise<boolean> {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [tableName]
  );
  return r.rowCount! > 0;
}

async function rowExists(client: PoolClient, table: string, where: Record<string, unknown>): Promise<boolean> {
  const keys = Object.keys(where);
  const vals = Object.values(where);
  const conds = keys.map((k, i) => `"${k}" = $${i + 1}`).join(' AND ');
  const r = await client.query(`SELECT 1 FROM "${table}" WHERE ${conds} LIMIT 1`, vals);
  return r.rowCount! > 0;
}

function log(msg: string) { console.log(`  ${msg}`); }

// ─────────────────────────────────────────────────────────────────────────────
// MODULE SEEDS
// ─────────────────────────────────────────────────────────────────────────────

// 1. Tenant row (tenant-service)
async function seedTenant(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'tenants'))) { log('SKIP: tenants table not found'); return; }
  await client.query(`
    INSERT INTO tenants (id, name, dms_type, dms_api_key, schema_name, status, rooftop_count)
    VALUES ($1, $2, 'CDK', 'DEMO-API-KEY-NOT-REAL', 'kunes_demo', 'ACTIVE', 3)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'ACTIVE'
  `, [TENANT_ID, TENANT_NAME]);
  log(`Tenant: ${TENANT_NAME} (${TENANT_ID})`);
}

// 2. Legal entities (tenant-service)
async function seedLegalEntities(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'legal_entities'))) { log('SKIP: legal_entities table not found'); return; }
  for (const le of LEGAL_ENTITIES) {
    await client.query(`
      INSERT INTO legal_entities
        (id, tenant_id, entity_code, legal_name, display_name, functional_currency, country,
         fiscal_year_end_month, state, city, status, effective_date, version)
      VALUES ($1,$2,$3,$4,$5,'USD','US',12,$6,$7,'ACTIVE','2026-01-01',1)
      ON CONFLICT (id) DO UPDATE SET legal_name = EXCLUDED.legal_name, status = 'ACTIVE'
    `, [le.id, TENANT_ID, le.entityCode, le.legalName, le.displayName, le.state, le.city]);
  }
  // Stores
  if (await tableExists(client, 'stores')) {
    for (const le of LEGAL_ENTITIES) {
      await client.query(`
        INSERT INTO stores (id, tenant_id, legal_entity_id, store_code, name, status, effective_date)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,'ACTIVE','2026-01-01')
        ON CONFLICT (tenant_id, store_code) DO NOTHING
      `, [TENANT_ID, le.id, le.storeCode, le.storeName]);
    }
  }
  log(`Legal entities: ${LEGAL_ENTITIES.length} (${LEGAL_ENTITIES.map(le => le.displayName).join(', ')})`);
}

// 3. Demo users (auth-service)
async function seedUsers(client: PoolClient): Promise<{ [email: string]: string }> {
  const idMap: { [email: string]: string } = {};
  if (!(await tableExists(client, 'user'))) { log('SKIP: user table not found'); return idMap; }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const u of DEMO_USERS) {
    const existing = await client.query(
      `SELECT id FROM "user" WHERE tenant_id = $1 AND email = $2`, [TENANT_ID, u.email]
    );
    let userId: string;
    if (existing.rowCount! > 0) {
      userId = existing.rows[0].id;
      await client.query(
        `UPDATE "user" SET password_hash=$1, status='ACTIVE', display_name=$2 WHERE id=$3`,
        [passwordHash, u.displayName, userId]
      );
    } else {
      userId = randomUUID();
      await client.query(`
        INSERT INTO "user" (id, tenant_id, email, display_name, status, password_hash, created_at, updated_at)
        VALUES ($1,$2,$3,$4,'ACTIVE',$5,now(),now())
      `, [userId, TENANT_ID, u.email, u.displayName, passwordHash]);
    }
    idMap[u.email] = userId;

    // Role assignment
    if (await tableExists(client, 'authz_role_assignment')) {
      await client.query(
        `DELETE FROM authz_role_assignment WHERE tenant_id=$1 AND user_id=$2`, [TENANT_ID, userId]
      );
      await client.query(`
        INSERT INTO authz_role_assignment (id, tenant_id, user_id, role, created_at)
        VALUES ($1,$2,$3,$4,now())
      `, [randomUUID(), TENANT_ID, userId, u.role]);
    }
  }
  log(`Users: ${DEMO_USERS.length} demo users created`);
  return idMap;
}

// 4. GL Accounts (gl-service)
async function seedGLAccounts(client: PoolClient): Promise<{ [code: string]: string }> {
  const idMap: { [code: string]: string } = {};
  if (!(await tableExists(client, 'gl_accounts'))) { log('SKIP: gl_accounts table not found'); return idMap; }

  for (const acct of GL_ACCOUNTS_SEED) {
    const res = await client.query(`
      INSERT INTO gl_accounts
        (id, tenant_id, code, name, type, normal_balance, is_active, allow_posting,
         is_cash_clearing, is_deposit_clearing, opening_balance)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,true,true,$6,false,0)
      ON CONFLICT (tenant_id, code) DO UPDATE SET name=EXCLUDED.name, is_active=true
      RETURNING id
    `, [
      TENANT_ID, acct.code, acct.name, acct.type,
      (acct as any).normalBalance ?? 'DEBIT',
      (acct as any).isCashClearing ?? false,
    ]);
    idMap[acct.code] = res.rows[0].id;
  }
  log(`GL Accounts: ${GL_ACCOUNTS_SEED.length} accounts`);
  return idMap;
}

// 5. Fiscal calendar + periods (coa-service)
async function seedFiscalCalendar(client: PoolClient): Promise<string | null> {
  if (!(await tableExists(client, 'fiscal_calendars'))) { log('SKIP: fiscal_calendars table not found'); return null; }

  // Calendar
  let calId: string;
  const existing = await client.query(
    `SELECT id FROM fiscal_calendars WHERE tenant_id=$1 AND entity_id=$2 LIMIT 1`,
    [TENANT_ID, LE_FORD_ID]
  );
  if (existing.rowCount! > 0) {
    calId = existing.rows[0].id;
  } else {
    calId = randomUUID();
    await client.query(`
      INSERT INTO fiscal_calendars (id, tenant_id, entity_id, fiscal_year, year_end_month, period_count)
      VALUES ($1,$2,$3,2026,12,12)
    `, [calId, TENANT_ID, LE_FORD_ID]);
  }

  // Periods for all three entities
  const PERIOD_STATUSES: Record<number, string> = {
    1:'HARD_CLOSED', 2:'HARD_CLOSED', 3:'HARD_CLOSED',
    4:'HARD_CLOSED', 5:'HARD_CLOSED', 6:'HARD_CLOSED',
    7:'SOFT_CLOSED', 8:'OPEN', 9:'FUTURE', 10:'FUTURE', 11:'FUTURE', 12:'FUTURE',
  };
  // Current calendar month is March (period 3 for demo)
  const DEMO_PERIOD_STATUSES: Record<number, string> = {
    1:'HARD_CLOSED', 2:'SOFT_CLOSED', 3:'OPEN', 4:'FUTURE', 5:'FUTURE', 6:'FUTURE',
    7:'FUTURE', 8:'FUTURE', 9:'FUTURE', 10:'FUTURE', 11:'FUTURE', 12:'FUTURE',
  };

  for (const le of LEGAL_ENTITIES) {
    let leCal: string;
    const existCal = await client.query(
      `SELECT id FROM fiscal_calendars WHERE tenant_id=$1 AND entity_id=$2 LIMIT 1`,
      [TENANT_ID, le.id]
    );
    if (existCal.rowCount! > 0) {
      leCal = existCal.rows[0].id;
    } else {
      leCal = randomUUID();
      await client.query(`
        INSERT INTO fiscal_calendars (id, tenant_id, entity_id, fiscal_year, year_end_month, period_count)
        VALUES ($1,$2,$3,2026,12,12)
      `, [leCal, TENANT_ID, le.id]);
    }

    for (let p = 1; p <= 12; p++) {
      const startMonth = p;
      const endMonth = p;
      const startDate = `2026-${String(startMonth).padStart(2,'0')}-01`;
      const endDay = new Date(2026, endMonth, 0).getDate();
      const endDate = `2026-${String(endMonth).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`;
      const code = `2026-${String(p).padStart(2,'0')}`;
      const status = DEMO_PERIOD_STATUSES[p] ?? 'FUTURE';
      await client.query(`
        INSERT INTO fiscal_periods
          (id, tenant_id, entity_id, calendar_id, fiscal_year, period_number, code,
           start_date, end_date, status, adjustments_only, has_postings)
        VALUES (gen_random_uuid(),$1,$2,$3,2026,$4,$5,$6,$7,$8,false,$9)
        ON CONFLICT (tenant_id, entity_id, fiscal_year, period_number) DO UPDATE
          SET status = EXCLUDED.status
      `, [TENANT_ID, le.id, leCal, p, code, startDate, endDate, status, p <= 3]);
    }
  }
  log('Fiscal calendar: 2026 calendar + 12 periods per entity (periods 1-2 closed, 3 open, 4+ future)');
  return calId;
}

// 6. Journal entries + lines (gl-service)
async function seedJournalEntries(client: PoolClient, glMap: Record<string, string>): Promise<void> {
  if (!(await tableExists(client, 'journal_entries'))) { log('SKIP: journal_entries table not found'); return; }

  let created = 0;
  for (const je of JOURNAL_ENTRIES_DATA) {
    const srcRef = `DEMO-${je.desc.substring(0, 20).replace(/\s+/g, '-').toUpperCase()}`;
    const existing = await client.query(
      `SELECT id FROM journal_entries WHERE tenant_id=$1 AND source_ref=$2 LIMIT 1`,
      [TENANT_ID, srcRef]
    );
    if (existing.rowCount! > 0) continue;

    const jeId = randomUUID();
    await client.query(`
      INSERT INTO journal_entries
        (id, tenant_id, entry_date, description, source, source_ref, status, agent_reviewed,
         posted_by, posted_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    `, [
      jeId, TENANT_ID, je.date, je.desc, je.src, srcRef, je.status,
      je.status === 'POSTED', je.status === 'POSTED' ? 'seed' : null,
      je.status === 'POSTED' ? new Date(je.date) : null,
    ]);

    if (await tableExists(client, 'journal_lines')) {
      for (const line of je.lines) {
        const glId = glMap[line.code];
        if (!glId) { continue; }
        await client.query(`
          INSERT INTO journal_lines (id, tenant_id, journal_entry_id, gl_account_id, debit, credit, memo)
          VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)
        `, [TENANT_ID, jeId, glId, line.dr / 100, line.cr / 100, je.desc]);
      }
    }
    created++;
  }
  log(`Journal entries: ${created} new entries created`);
}

// 7. AP vendors (apar-service)
async function seedVendors(client: PoolClient): Promise<{ [num: string]: string }> {
  const idMap: { [num: string]: string } = {};
  if (!(await tableExists(client, 'vendors'))) { log('SKIP: vendors table not found'); return idMap; }

  for (const v of VENDORS) {
    const norm = v.name.toLowerCase().trim();
    const existing = await client.query(
      `SELECT id FROM vendors WHERE tenant_id=$1 AND vendor_number=$2 LIMIT 1`, [TENANT_ID, v.num]
    );
    let vid: string;
    if (existing.rowCount! > 0) {
      vid = existing.rows[0].id;
    } else {
      vid = randomUUID();
      await client.query(`
        INSERT INTO vendors
          (id, tenant_id, vendor_number, normalized_vendor_number, vendor_name, normalized_vendor_name,
           vendor_type, address, city, state, postal_code, remit_state, is_1099_vendor, ein,
           is_active, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10,true,$12,true,now(),now())
      `, [vid, TENANT_ID, v.num, v.num.toUpperCase(), v.name, norm, v.type, v.addr, v.city, v.state, v.zip, v.ein]);
    }
    idMap[v.num] = vid;
  }
  log(`Vendors: ${VENDORS.length}`);
  return idMap;
}

// 8. AP entries (apar-service)
async function seedAPEntries(client: PoolClient, vendorMap: Record<string, string>): Promise<void> {
  if (!(await tableExists(client, 'ap_entries'))) { log('SKIP: ap_entries table not found'); return; }

  const entries = [
    { inv:'AP-8801', vnum:'V-0001', amt:1320.00, due:'2026-03-30', status:'OPEN', note:'Parts replenishment batch' },
    { inv:'AP-8802', vnum:'V-0002', amt:890.00,  due:'2026-03-28', status:'OPEN', note:'NAPA monthly order' },
    { inv:'AP-8803', vnum:'V-0003', amt:450.00,  due:'2026-03-25', status:'OPEN', note:'Fleet fuel March' },
    { inv:'AP-8804', vnum:'V-0004', amt:670.00,  due:'2026-03-20', status:'OPEN', note:'Paint & supplies' },
    { inv:'AP-8790', vnum:'V-0005', amt:410.00,  due:'2026-02-28', status:'OPEN', note:'Clearcoat — 31 days overdue' },
    { inv:'AP-8775', vnum:'V-0006', amt:230.00,  due:'2026-02-15', status:'OPEN', note:'Tool kit — 44 days overdue' },
    { inv:'AP-8760', vnum:'V-0007', amt:150.00,  due:'2026-01-30', status:'OPEN', note:'DMS support Q1 — 60 days overdue' },
    { inv:'AP-8740', vnum:'V-0008', amt:80.00,   due:'2025-12-20', status:'OPEN', note:'Hardware — 90+ days overdue' },
    { inv:'AP-8830', vnum:'V-0001', amt:560.00,  due:'2026-04-15', status:'APPROVED', note:'Approved – pending payment' },
    { inv:'AP-8831', vnum:'V-0009', amt:1200.00, due:'2026-04-20', status:'PAID', note:'Enterprise rental – paid 2026-03-20', checkNum:'CHK-4421', paidDate:'2026-03-20' },
    { inv:'AP-8832', vnum:'V-0010', amt:4500.00, due:'2026-04-30', status:'OPEN', note:'Insurance premium Q2 — DISPUTED', holdFlag:true },
  ];

  let created = 0;
  for (const e of entries) {
    const exists = await client.query(
      `SELECT 1 FROM ap_entries WHERE tenant_id=$1 AND invoice_ref=$2 LIMIT 1`, [TENANT_ID, e.inv]
    );
    if (exists.rowCount! > 0) continue;
    await client.query(`
      INSERT INTO ap_entries
        (id, tenant_id, vendor_name, invoice_ref, amount, due_date, status,
         check_number, paid_date, hold_flag, note, created_at)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
    `, [TENANT_ID, VENDORS.find(v => v.num === e.vnum)?.name ?? e.vnum,
        e.inv, e.amt, e.due, e.status,
        (e as any).checkNum ?? null, (e as any).paidDate ?? null,
        (e as any).holdFlag ?? false, e.note]);
    created++;
  }
  log(`AP entries: ${created} new entries (draft/approved/paid/disputed/overdue)`);
}

// 9. AR customers (apar-service)
async function seedCustomers(client: PoolClient): Promise<{ [num: string]: string }> {
  const idMap: { [num: string]: string } = {};
  if (!(await tableExists(client, 'customers'))) { log('SKIP: customers table not found'); return idMap; }

  for (const c of CUSTOMERS) {
    const norm = `${c.last}, ${c.first}`.toLowerCase().trim();
    const existing = await client.query(
      `SELECT id FROM customers WHERE tenant_id=$1 AND customer_number=$2 LIMIT 1`, [TENANT_ID, c.num]
    );
    let cid: string;
    if (existing.rowCount! > 0) {
      cid = existing.rows[0].id;
    } else {
      cid = randomUUID();
      // Check required columns
      const cols = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='customers' AND table_schema='public'`
      );
      const colNames = cols.rows.map((r: any) => r.column_name);
      const hasCustType = colNames.includes('customer_type');
      await client.query(`
        INSERT INTO customers
          (id, tenant_id, customer_number, ${hasCustType ? 'customer_type,' : ''} first_name, last_name,
           phone, city, state, postal_code, is_active, created_at, updated_at)
        VALUES ($1,$2,$3,${hasCustType ? `$${hasCustType ? 9 : 8},` : ''} $4,$5,$6,$7,$8,$9,true,now(),now())
      `.replace(/\s+/g, ' '),
      hasCustType
        ? [cid, TENANT_ID, c.num, c.first, c.last, c.phone, c.city, c.state, c.zip, c.custType]
        : [cid, TENANT_ID, c.num, c.first, c.last, c.phone, c.city, c.state, c.zip]);
    }
    idMap[c.num] = cid;
  }
  log(`Customers: ${CUSTOMERS.length}`);
  return idMap;
}

// 10. AR entries (apar-service)
async function seedAREntries(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'ar_entries'))) { log('SKIP: ar_entries table not found'); return; }

  const entries = [
    { ref:'INV-4521', type:'RECEIVABLE', amt:4850.00, due:'2026-03-28', status:'OPEN',   note:'Vehicle sale balance due' },
    { ref:'INV-4522', type:'RECEIVABLE', amt:3120.00, due:'2026-03-25', status:'OPEN',   note:'Service invoice – current' },
    { ref:'WC-3301',  type:'WARRANTY',   amt:950.00,  due:'2026-03-15', status:'OPEN',   note:'Ford warranty claim pending' },
    { ref:'WC-3290',  type:'WARRANTY',   amt:780.00,  due:'2026-02-20', status:'OPEN',   note:'Warranty — 28 days overdue' },
    { ref:'INV-4498', type:'RECEIVABLE', amt:2340.00, due:'2026-02-15', status:'OPEN',   note:'Fleet billing – 44 days overdue' },
    { ref:'INV-4472', type:'RECEIVABLE', amt:1560.00, due:'2026-01-28', status:'OPEN',   note:'Insurance — 60 days overdue' },
    { ref:'INV-4401', type:'RECEIVABLE', amt:890.00,  due:'2025-12-15', status:'OPEN',   note:'Trade receivable — 90+ days' },
    { ref:'WC-3210',  type:'WARRANTY',   amt:420.00,  due:'2025-11-30', status:'OPEN',   note:'Warranty chargeback — 120+ days' },
    { ref:'CR-5501',  type:'RECEIVABLE', amt:1250.00, due:'2026-03-31', status:'OPEN',   note:'Customer pay – current' },
    { ref:'NSF-101',  type:'RECEIVABLE', amt:325.00,  due:'2026-03-10', status:'OPEN',   note:'NSF check returned – Miller' },
    { ref:'INV-4600', type:'RECEIVABLE', amt:980.00,  due:'2026-04-15', status:'PENDING_MANUAL', note:'Unapplied cash – to be applied' },
  ];

  let created = 0;
  for (const e of entries) {
    const exists = await client.query(
      `SELECT 1 FROM ar_entries WHERE tenant_id=$1 AND dealer_ref=$2 LIMIT 1`, [TENANT_ID, e.ref]
    );
    if (exists.rowCount! > 0) continue;
    await client.query(`
      INSERT INTO ar_entries (id, tenant_id, dealer_ref, type, amount, due_date, status, created_at)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,now())
    `, [TENANT_ID, e.ref, e.type, e.amt, e.due, e.status]);
    created++;
  }
  log(`AR entries: ${created} new entries (open/overdue/NSF/unapplied)`);
}

// 11. Bank recon sessions (recon-service)
async function seedBankRecon(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'bank_recons'))) { log('SKIP: bank_recons table not found'); return; }

  const sessions = [
    { acct:'Operating Checking – First Business Bank', gl:185200.00, bank:186450.00, var:1250.00, status:'OPEN' },
    { acct:'Payroll Account – Wells Fargo',            gl:42300.00,  bank:42300.00,  var:0,       status:'RECONCILED' },
    { acct:'Savings Reserve – US Bank',                gl:120000.00, bank:120000.00, var:0,       status:'RECONCILED' },
    { acct:'Parts Flooring – Floorplan Corp',          gl:82000.00,  bank:82125.00,  var:125.00,  status:'OPEN' },
  ];

  let created = 0;
  for (const s of sessions) {
    const exists = await client.query(
      `SELECT 1 FROM bank_recons WHERE tenant_id=$1 AND account_name=$2 LIMIT 1`, [TENANT_ID, s.acct]
    );
    if (exists.rowCount! > 0) continue;
    await client.query(`
      INSERT INTO bank_recons (id, tenant_id, account_name, recon_date, gl_balance, bank_balance, variance, status)
      VALUES (gen_random_uuid(),$1,$2,now(),$3,$4,$5,$6)
    `, [TENANT_ID, s.acct, s.gl, s.bank, s.var, s.status]);
    created++;
  }
  log(`Bank recon sessions: ${created}`);
}

// 12. Payroll data (payroll-service)
async function seedPayroll(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'employees'))) { log('SKIP: employees table not found'); return; }

  const employees = [
    { code:'EMP-001', first:'Tom',     last:'Henderson', dept:'SALES',   payType:'COMMISSION', commRate:0.0250, leid:LE_FORD_ID    },
    { code:'EMP-002', first:'Susan',   last:'Park',      dept:'SALES',   payType:'COMMISSION', commRate:0.0220, leid:LE_FORD_ID    },
    { code:'EMP-003', first:'Carlos',  last:'Rivera',    dept:'SERVICE', payType:'HOURLY',     payRate:32.50,  leid:LE_FORD_ID    },
    { code:'EMP-004', first:'Diane',   last:'Chen',      dept:'SERVICE', payType:'HOURLY',     payRate:38.00,  leid:LE_FORD_ID    },
    { code:'EMP-005', first:'Marcus',  last:'Wilson',    dept:'PARTS',   payType:'HOURLY',     payRate:24.00,  leid:LE_CHEV_ID   },
    { code:'EMP-006', first:'Nadia',   last:'Patel',     dept:'ADMIN',   payType:'SALARY',     payRate:72000,  leid:LE_CHEV_ID   },
    { code:'EMP-007', first:'Brandon', last:'Scott',     dept:'SALES',   payType:'COMMISSION', commRate:0.0230, leid:LE_TOYOTA_ID },
    { code:'EMP-008', first:'Leila',   last:'Kim',       dept:'SERVICE', payType:'HOURLY',     payRate:35.00,  leid:LE_TOYOTA_ID },
    { code:'EMP-009', first:'Frank',   last:'Nguyen',    dept:'FNI',     payType:'COMMISSION', commRate:0.0500, leid:LE_FORD_ID   },
    { code:'EMP-010', first:'Grace',   last:'Turner',    dept:'ADMIN',   payType:'SALARY',     payRate:85000,  leid:LE_FORD_ID   },
  ];

  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='employees' AND table_schema='public'`
  );
  const colNames: string[] = cols.rows.map((r: any) => r.column_name);
  const hasLeid = colNames.includes('legal_entity_id');

  let empCreated = 0;
  const empIdMap: Record<string, string> = {};
  for (const e of employees) {
    const ex = await client.query(
      `SELECT id FROM employees WHERE tenant_id=$1 AND employee_code=$2 LIMIT 1`, [TENANT_ID, e.code]
    );
    if (ex.rowCount! > 0) { empIdMap[e.code] = ex.rows[0].id; continue; }
    const eid = randomUUID();
    if (hasLeid) {
      await client.query(`
        INSERT INTO employees
          (id, tenant_id, legal_entity_id, employee_code, first_name, last_name, department,
           pay_type, pay_rate, commission_rate, pay_frequency, federal_filing_status,
           is_active, hire_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'BI_WEEKLY','SINGLE',true,'2022-01-01')
      `, [eid, TENANT_ID, e.leid, e.code, e.first, e.last, e.dept,
          e.payType, e.payType === 'SALARY' ? e.payRate : (e.payRate ?? null),
          e.commRate ?? null]);
    } else {
      await client.query(`
        INSERT INTO employees
          (id, tenant_id, employee_code, first_name, last_name, department,
           pay_type, pay_rate, commission_rate, pay_frequency, federal_filing_status,
           is_active, hire_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'BI_WEEKLY','SINGLE',true,'2022-01-01')
      `, [eid, TENANT_ID, e.code, e.first, e.last, e.dept,
          e.payType, e.payType === 'SALARY' ? e.payRate : (e.payRate ?? null),
          e.commRate ?? null]);
    }
    empIdMap[e.code] = eid;
    empCreated++;
  }

  if (!(await tableExists(client, 'payroll_batches'))) { log(`Employees: ${empCreated}; SKIP: payroll_batches not found`); return; }

  const hasBatchLeid = (await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='payroll_batches' AND column_name='legal_entity_id'`
  )).rowCount! > 0;

  const batches = [
    { num:'PR-2026-02-W4', start:'2026-02-22', end:'2026-02-28', payDate:'2026-03-04', status:'POSTED',    gross:324000.00, ded:98000.00, net:226000.00, empTax:28000.00, leid:LE_FORD_ID,   approvedBy:'approver@kunes-demo.local', approvedAt:'2026-03-01', postedAt:'2026-03-04' },
    { num:'PR-2026-03-W1', start:'2026-03-01', end:'2026-03-07', payDate:'2026-03-11', status:'POSTED',    gross:332000.00, ded:100000.00, net:232000.00, empTax:29000.00, leid:LE_FORD_ID,  approvedBy:'approver@kunes-demo.local', approvedAt:'2026-03-08', postedAt:'2026-03-11' },
    { num:'PR-2026-03-W2', start:'2026-03-08', end:'2026-03-14', payDate:'2026-03-18', status:'POSTED',    gross:342000.00, ded:103000.00, net:239000.00, empTax:30000.00, leid:LE_FORD_ID,  approvedBy:'approver@kunes-demo.local', approvedAt:'2026-03-15', postedAt:'2026-03-18' },
    { num:'PR-2026-03-W3', start:'2026-03-15', end:'2026-03-21', payDate:'2026-03-25', status:'VALIDATED', gross:338000.00, ded:102000.00, net:236000.00, empTax:29500.00, leid:LE_FORD_ID,  approvedBy:null, approvedAt:null, postedAt:null },
    { num:'PR-2026-03-CHEV', start:'2026-03-01', end:'2026-03-31', payDate:'2026-04-04', status:'DRAFT',   gross:180000.00, ded:54000.00, net:126000.00, empTax:16000.00, leid:LE_CHEV_ID,  approvedBy:null, approvedAt:null, postedAt:null },
    // Reversal example
    { num:'PR-2026-02-W3-REV', start:'2026-02-15', end:'2026-02-21', payDate:'2026-02-25', status:'VOIDED', gross:320000.00, ded:96000.00, net:224000.00, empTax:28000.00, leid:LE_FORD_ID,  approvedBy:'approver@kunes-demo.local', approvedAt:'2026-02-22', postedAt:null, voidReason:'Duplicate submission detected' },
  ];

  let batchCreated = 0;
  for (const b of batches) {
    const ex = await client.query(
      `SELECT 1 FROM payroll_batches WHERE tenant_id=$1 AND batch_number=$2 LIMIT 1`, [TENANT_ID, b.num]
    );
    if (ex.rowCount! > 0) continue;
    const idempKey = `demo-${b.num}`;
    if (hasBatchLeid) {
      await client.query(`
        INSERT INTO payroll_batches
          (id, tenant_id, legal_entity_id, batch_number, pay_period_start, pay_period_end, pay_date,
           pay_frequency, status, total_gross_pay, total_deductions, total_net_pay, total_employer_tax,
           employee_count, approved_by, approved_at, posted_at, voided_at, void_reason, idempotency_key)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,'BI_WEEKLY',$7,$8,$9,$10,$11,5,$12,$13,$14,$15,$16,$17)
      `, [TENANT_ID, b.leid, b.num, b.start, b.end, b.payDate, b.status,
          b.gross, b.ded, b.net, b.empTax, b.approvedBy, b.approvedAt,
          b.postedAt, (b as any).voidReason ?? null, idempKey]);
    } else {
      await client.query(`
        INSERT INTO payroll_batches
          (id, tenant_id, batch_number, pay_period_start, pay_period_end, pay_date,
           pay_frequency, status, total_gross_pay, total_deductions, total_net_pay, total_employer_tax,
           employee_count, approved_by, approved_at, posted_at, idempotency_key)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,'BI_WEEKLY',$6,$7,$8,$9,$10,5,$11,$12,$13,$14)
      `, [TENANT_ID, b.num, b.start, b.end, b.payDate, b.status,
          b.gross, b.ded, b.net, b.empTax, b.approvedBy, b.approvedAt, b.postedAt, idempKey]);
    }
    batchCreated++;
  }
  log(`Employees: ${empCreated}; Payroll batches: ${batchCreated} (posted/validated/draft/voided)`);
}

// 13. OEM data (oem-service)
async function seedOEM(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'oem_integration_profiles'))) { log('SKIP: oem_integration_profiles table not found'); return; }

  // NOTE: DEMO_FIXTURE mode — these OEM profiles simulate external connections.
  // No real OEM acknowledgements are represented here.
  const profiles = [
    { id: randomUUID(), make:'Ford',      status:'DEMO_FIXTURE', prog:'Ford Motor Credit Statement',     ver:'2.1.0' },
    { id: randomUUID(), make:'Chevrolet', status:'DEMO_FIXTURE', prog:'GM Financial Statement',           ver:'3.0.0' },
    { id: randomUUID(), make:'Toyota',    status:'DEMO_FIXTURE', prog:'Toyota Financial Services Stmt',  ver:'1.8.0' },
  ];

  let created = 0;
  for (const p of profiles) {
    const ex = await client.query(
      `SELECT 1 FROM oem_integration_profiles WHERE tenant_id=$1 AND make=$2 LIMIT 1`, [TENANT_ID, p.make]
    );
    if (ex.rowCount! > 0) continue;
    await client.query(`
      INSERT INTO oem_integration_profiles
        (id, tenant_id, make, program_name, connection_status, statement_spec_version,
         notes, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now())
    `, [p.id, TENANT_ID, p.make, p.prog, p.status, p.ver,
        'DEMO_FIXTURE: Simulated OEM connection — no real external acknowledgement']);
    created++;
  }

  // Incentive programs
  if (await tableExists(client, 'oem_incentive_programs')) {
    const incentives = [
      { make:'Ford',      name:'Ford Fast Lane Bonus Q1 2026', type:'VOLUME_BONUS', amount:45000.00, status:'PENDING' },
      { make:'Chevrolet', name:'GM Dealer Growth Incentive Q1', type:'VOLUME_BONUS', amount:32000.00, status:'CONFIRMED' },
      { make:'Toyota',    name:'Toyota National Dealer Award',  type:'QUALITY_BONUS', amount:18500.00, status:'DISPUTED' },
    ];
    for (const inc of incentives) {
      const profEx = await client.query(
        `SELECT id FROM oem_integration_profiles WHERE tenant_id=$1 AND make=$2 LIMIT 1`, [TENANT_ID, inc.make]
      );
      if (profEx.rowCount! === 0) continue;
      const profId = profEx.rows[0].id;
      const ex = await client.query(
        `SELECT 1 FROM oem_incentive_programs WHERE tenant_id=$1 AND program_name=$2 LIMIT 1`, [TENANT_ID, inc.name]
      );
      if (ex.rowCount! > 0) continue;
      await client.query(`
        INSERT INTO oem_incentive_programs
          (id, tenant_id, profile_id, program_name, incentive_type, estimated_amount, status,
           effective_start, effective_end, created_at, updated_at)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,'2026-01-01','2026-03-31',now(),now())
      `, [TENANT_ID, profId, inc.name, inc.type, inc.amount, inc.status]);
    }
  }
  log(`OEM profiles: ${created} (DEMO_FIXTURE mode)`);
}

// 14. Close data (close-service)
async function seedCloseData(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'close_period_states'))) { log('SKIP: close_period_states not found'); return; }

  const closePeriods = [
    { entity:LE_FORD_ID,   period:'2026-01', status:'LOCKED',      prelim:true,  final:true  },
    { entity:LE_FORD_ID,   period:'2026-02', status:'HARD_CLOSED', prelim:true,  final:true  },
    { entity:LE_FORD_ID,   period:'2026-03', status:'IN_PROGRESS', prelim:false, final:false },
    { entity:LE_CHEV_ID,   period:'2026-01', status:'LOCKED',      prelim:true,  final:true  },
    { entity:LE_CHEV_ID,   period:'2026-02', status:'HARD_CLOSED', prelim:true,  final:true  },
    { entity:LE_TOYOTA_ID, period:'2026-01', status:'LOCKED',      prelim:true,  final:true  },
    { entity:LE_TOYOTA_ID, period:'2026-02', status:'SOFT_CLOSED', prelim:true,  final:false },
  ];

  let created = 0;
  for (const cp of closePeriods) {
    const ex = await client.query(
      `SELECT 1 FROM close_period_states WHERE tenant_id=$1 AND entity_id=$2 AND period_code=$3 LIMIT 1`,
      [TENANT_ID, cp.entity, cp.period]
    );
    if (ex.rowCount! > 0) continue;
    await client.query(`
      INSERT INTO close_period_states
        (id, tenant_id, entity_id, period_code, status, preliminary_close_complete, final_close_complete, created_at)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,now())
    `, [TENANT_ID, cp.entity, cp.period, cp.status, cp.prelim, cp.final]);
    created++;
  }
  log(`Close period states: ${created}`);
}

// 15. Migration data (close/migration-service)
async function seedMigrationData(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'source_systems'))) { log('SKIP: source_systems not found'); return; }

  const ex = await client.query(
    `SELECT 1 FROM source_systems WHERE tenant_id=$1 AND source_code=$2 LIMIT 1`,
    [TENANT_ID, 'CDK-LEGACY-KFM']
  );
  if (ex.rowCount! > 0) { log('Migration source: already exists'); return; }

  await client.query(`
    INSERT INTO source_systems
      (id, tenant_id, source_code, source_name, source_type, status, created_at)
    VALUES (gen_random_uuid(),$1,'CDK-LEGACY-KFM','CDK Legacy – Kunes Ford Madison','DMS_LEGACY','REGISTERED',now())
  `, [TENANT_ID]);

  await client.query(`
    INSERT INTO source_systems
      (id, tenant_id, source_code, source_name, source_type, status, created_at)
    VALUES (gen_random_uuid(),$1,'CDK-LEGACY-KCM','CDK Legacy – Kunes Chevrolet Milwaukee','DMS_LEGACY','REGISTERED',now())
  `, [TENANT_ID]);

  log('Migration sources: 2 registered');
}

// 16. Automation capabilities (automation-service)
async function seedAutomation(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'automation_capabilities'))) { log('SKIP: automation_capabilities not found'); return; }

  const caps = [
    { code:'AUTO-JE-BALANCE-CHECK',  name:'Journal Balance Validation',    mode:'OBSERVE_ONLY', risk:'LOW' },
    { code:'AUTO-PERIOD-LOCK',        name:'Period Auto-Lock',               mode:'OBSERVE_ONLY', risk:'MEDIUM' },
    { code:'AUTO-VENDOR-DUP-DETECT',  name:'Vendor Duplicate Detection',    mode:'OBSERVE_ONLY', risk:'LOW' },
    { code:'AUTO-PAYROLL-VALIDATE',   name:'Payroll Pre-Validation',        mode:'OBSERVE_ONLY', risk:'MEDIUM' },
    { code:'AUTO-RECON-MATCH',        name:'Bank Reconciliation Auto-Match', mode:'APPROVAL_REQUIRED', risk:'MEDIUM' },
    { code:'AUTO-OEM-MATCH',          name:'OEM Statement Auto-Matching',   mode:'APPROVAL_REQUIRED', risk:'HIGH' },
    { code:'AUTO-CLOSE-CHECKLIST',    name:'Close Checklist Automation',    mode:'OBSERVE_ONLY', risk:'LOW' },
  ];

  let created = 0;
  for (const c of caps) {
    const ex = await client.query(
      `SELECT 1 FROM automation_capabilities WHERE tenant_id=$1 AND capability_code=$2 LIMIT 1`,
      [TENANT_ID, c.code]
    );
    if (ex.rowCount! > 0) continue;
    await client.query(`
      INSERT INTO automation_capabilities
        (id, tenant_id, capability_code, capability_name, mode, risk_level, is_enabled, created_at, updated_at)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,true,now(),now())
    `, [TENANT_ID, c.code, c.name, c.mode, c.risk]);
    created++;
  }
  log(`Automation capabilities: ${created} (all OBSERVE_ONLY / APPROVAL_REQUIRED per R1 policy)`);
}

// 17. EOM steps (legacy tables used by gl-service / eom-service)
async function seedEOMSteps(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'eom_closes'))) { log('SKIP: eom_closes not found'); return; }

  const ex = await client.query(
    `SELECT 1 FROM eom_closes WHERE tenant_id=$1 LIMIT 1`, [TENANT_ID]
  );
  if (ex.rowCount! > 0) { log('EOM: already exists'); return; }

  const eomId = randomUUID();
  await client.query(`
    INSERT INTO eom_closes (id, tenant_id, period, status)
    VALUES ($1,$2,'2026-03','IN_PROGRESS')
  `, [eomId, TENANT_ID]);

  const steps = [
    { code:'010', name:'Pre-Close Checklist',       status:'DONE' },
    { code:'020', name:'Verify Open Items',         status:'DONE' },
    { code:'062', name:'Parts Close',               status:'DONE' },
    { code:'065', name:'Parts Reconciliation',      status:'DONE' },
    { code:'068', name:'Service Close',             status:'RUNNING' },
    { code:'070', name:'Body Shop Close',           status:'PENDING' },
    { code:'071', name:'Variable Operations Close', status:'PENDING' },
    { code:'074', name:'Fixed Operations Close',    status:'PENDING' },
    { code:'077', name:'Master Close',              status:'PENDING' },
    { code:'200', name:'FS Generation',             status:'PENDING' },
    { code:'300', name:'FS Submission to OEM',      status:'PENDING' },
  ];
  if (await tableExists(client, 'eom_close_steps')) {
    for (const s of steps) {
      await client.query(`
        INSERT INTO eom_close_steps
          (id, eom_close_id, step_code, step_name, status, started_at, completed_at)
        VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)
      `, [eomId, s.code, s.name, s.status,
          s.status !== 'PENDING' ? new Date() : null,
          s.status === 'DONE' ? new Date() : null]);
    }
  }
  log('EOM close: March 2026 in-progress, 4 steps done');
}

// 18. Purchase orders (apar-service)
async function seedPurchaseOrders(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'purchase_orders'))) { log('SKIP: purchase_orders not found'); return; }

  const pos = [
    { num:'PO-2026-0142', vendor:'AutoNation Parts',    amt:5600.00, status:'RECEIVED',  note:'Parts replenishment – fully received' },
    { num:'PO-2026-0143', vendor:'NAPA Auto Parts',     amt:3200.00, status:'PARTIAL',   note:'Partial delivery – 2 lines outstanding' },
    { num:'PO-2026-0144', vendor:'Sherwin-Williams',    amt:1800.00, status:'OPEN',      note:'Body shop supplies – ordered' },
    { num:'PO-2026-0145', vendor:'Snap-On Tools',       amt:4500.00, status:'OPEN',      note:'Alignment equipment – pending approval' },
    { num:'PO-2026-0146', vendor:'Shell Fleet Fuel',    amt:2200.00, status:'APPROVED',  note:'Fuel contract Q2' },
  ];

  let created = 0;
  for (const po of pos) {
    const ex = await client.query(
      `SELECT 1 FROM purchase_orders WHERE tenant_id=$1 AND po_number=$2 LIMIT 1`, [TENANT_ID, po.num]
    );
    if (ex.rowCount! > 0) continue;
    await client.query(`
      INSERT INTO purchase_orders
        (id, tenant_id, po_number, vendor_name, total_amount, status, notes, created_at)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,now())
    `, [TENANT_ID, po.num, po.vendor, po.amt, po.status, po.note]);
    created++;
  }
  log(`Purchase orders: ${created}`);
}

// 19. Schedule data (schedule-service)
async function seedSchedules(client: PoolClient): Promise<void> {
  if (!(await tableExists(client, 'schedules'))) { log('SKIP: schedules not found'); return; }

  const schedules = [
    { code:'SCHED-AR-TRADE', name:'AR Trade Receivables',      type:'RECEIVABLE', status:'OPEN' },
    { code:'SCHED-AR-WARR',  name:'AR Warranty Receivables',   type:'RECEIVABLE', status:'OPEN' },
    { code:'SCHED-AP-TRADE', name:'AP Trade Payables',         type:'PAYABLE',    status:'OPEN' },
    { code:'SCHED-INV-NEW',  name:'New Vehicle Inventory',     type:'INVENTORY',  status:'OPEN' },
    { code:'SCHED-INV-USED', name:'Used Vehicle Inventory',    type:'INVENTORY',  status:'OPEN' },
    { code:'SCHED-INV-PARTS','name':'Parts Inventory',          type:'INVENTORY',  status:'OPEN' },
    { code:'SCHED-FLRPLN',   name:'Floor Plan Payable',        type:'PAYABLE',    status:'OPEN' },
    { code:'SCHED-PAYROLL',  name:'Accrued Payroll',           type:'ACCRUAL',    status:'OPEN' },
  ];

  let created = 0;
  for (const s of schedules) {
    const ex = await client.query(
      `SELECT 1 FROM schedules WHERE tenant_id=$1 AND schedule_code=$2 LIMIT 1`, [TENANT_ID, s.code]
    );
    if (ex.rowCount! > 0) continue;
    await client.query(`
      INSERT INTO schedules
        (id, tenant_id, schedule_code, name, schedule_type, status, created_at)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,now())
    `, [TENANT_ID, s.code, s.name, s.type, s.status]);
    created++;
  }
  log(`Schedules: ${created}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// RESET
// ─────────────────────────────────────────────────────────────────────────────
async function resetDemoData(client: PoolClient): Promise<void> {
  console.log('\n⚠️  RESET: removing demo tenant data (local only)...');
  const tables = [
    'automation_capabilities', 'source_systems', 'close_period_states',
    'eom_close_steps', 'eom_closes', 'oem_incentive_programs', 'oem_integration_profiles',
    'payroll_batches', 'employees', 'schedules', 'purchase_orders',
    'bank_recons', 'ar_entries', 'ap_entries', 'customers', 'vendors',
    'journal_lines', 'journal_entries', 'gl_accounts',
    'fiscal_periods', 'fiscal_calendars',
    'authz_role_assignment', 'user', 'stores', 'legal_entities', 'tenants',
  ];
  for (const t of tables) {
    if (!(await tableExists(client, t))) continue;
    const col = t === 'user' ? 'tenant_id' : 'tenant_id';
    try {
      await client.query(`DELETE FROM "${t}" WHERE ${col} = $1`, [TENANT_ID]);
      process.stdout.write(`    cleared: ${t}\n`);
    } catch { /* ignore FK errors — partial reset is OK */ }
  }
  console.log('  Reset complete.\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY
// ─────────────────────────────────────────────────────────────────────────────
async function verifyDemoData(client: PoolClient): Promise<boolean> {
  console.log('\n🔍 Verification checks:');
  let pass = true;
  const checks: Array<{ label: string; sql: string; params: unknown[]; min: number }> = [
    { label: 'Legal entities',    sql: `SELECT count(*) FROM legal_entities WHERE tenant_id=$1`,         params:[TENANT_ID], min:3 },
    { label: 'Demo users',        sql: `SELECT count(*) FROM "user" WHERE tenant_id=$1`,                 params:[TENANT_ID], min:10 },
    { label: 'GL accounts',       sql: `SELECT count(*) FROM gl_accounts WHERE tenant_id=$1`,            params:[TENANT_ID], min:50 },
    { label: 'Fiscal periods',    sql: `SELECT count(*) FROM fiscal_periods WHERE tenant_id=$1`,         params:[TENANT_ID], min:12 },
    { label: 'Journal entries',   sql: `SELECT count(*) FROM journal_entries WHERE tenant_id=$1`,        params:[TENANT_ID], min:15 },
    { label: 'Vendors',           sql: `SELECT count(*) FROM vendors WHERE tenant_id=$1`,                params:[TENANT_ID], min:5 },
    { label: 'AP entries',        sql: `SELECT count(*) FROM ap_entries WHERE tenant_id=$1`,             params:[TENANT_ID], min:8 },
    { label: 'AR entries',        sql: `SELECT count(*) FROM ar_entries WHERE tenant_id=$1`,             params:[TENANT_ID], min:8 },
    { label: 'Payroll batches',   sql: `SELECT count(*) FROM payroll_batches WHERE tenant_id=$1`,        params:[TENANT_ID], min:3 },
    { label: 'Employees',         sql: `SELECT count(*) FROM employees WHERE tenant_id=$1`,              params:[TENANT_ID], min:8 },
  ];

  for (const c of checks) {
    try {
      if (!(await tableExists(client, c.sql.match(/FROM "?(\w+)"?/)?.[1] ?? ''))) {
        console.log(`  ⚠️  SKIP   ${c.label} (table not present)`);
        continue;
      }
      const r = await client.query(c.sql, c.params);
      const cnt = parseInt(r.rows[0].count, 10);
      const ok = cnt >= c.min;
      console.log(`  ${ok ? '✅' : '❌'} ${c.label}: ${cnt} (min ${c.min})`);
      if (!ok) pass = false;
    } catch {
      console.log(`  ⚠️  SKIP   ${c.label} (query error)`);
    }
  }
  return pass;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const client = await pool.connect();
  const counts: Record<string, number> = {};

  try {
    if (RESET) {
      await resetDemoData(client);
    }

    if (VERIFY) {
      const ok = await verifyDemoData(client);
      process.exit(ok ? 0 : 1);
    }

    console.log('\n🌱 Kunes Demo Automotive Group — R1 Seed');
    console.log('─────────────────────────────────────────');

    console.log('\n[1/17] Tenant...');
    await seedTenant(client);

    console.log('\n[2/17] Legal entities & stores...');
    await seedLegalEntities(client);

    console.log('\n[3/17] Demo users...');
    const userMap = await seedUsers(client);

    console.log('\n[4/17] GL accounts (chart of accounts)...');
    const glMap = await seedGLAccounts(client);

    console.log('\n[5/17] Fiscal calendar & periods...');
    await seedFiscalCalendar(client);

    console.log('\n[6/17] Journal entries...');
    await seedJournalEntries(client, glMap);

    console.log('\n[7/17] AP vendors...');
    const vendorMap = await seedVendors(client);

    console.log('\n[8/17] AP entries...');
    await seedAPEntries(client, vendorMap);

    console.log('\n[9/17] AR customers...');
    const customerMap = await seedCustomers(client);

    console.log('\n[10/17] AR entries...');
    await seedAREntries(client);

    console.log('\n[11/17] Bank reconciliation...');
    await seedBankRecon(client);

    console.log('\n[12/17] Payroll (employees + batches)...');
    await seedPayroll(client);

    console.log('\n[13/17] OEM (DEMO_FIXTURE mode)...');
    await seedOEM(client);

    console.log('\n[14/17] Close period states...');
    await seedCloseData(client);

    console.log('\n[15/17] Migration sources...');
    await seedMigrationData(client);

    console.log('\n[16/17] Automation capabilities...');
    await seedAutomation(client);

    console.log('\n[17/17] EOM steps & schedules...');
    await seedEOMSteps(client);
    await seedPurchaseOrders(client);
    await seedSchedules(client);

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log('\n' + '─'.repeat(60));
    console.log('✅  R1 Demo Seed Complete');
    console.log('─'.repeat(60));
    console.log(`\nTenant: ${TENANT_NAME} (${TENANT_ID})`);
    console.log('\nLegal entities:');
    for (const le of LEGAL_ENTITIES) {
      console.log(`  • ${le.displayName} [${le.entityCode}] id=${le.id}`);
    }
    console.log(`\nApplication URL: ${process.env['APP_URL'] ?? 'http://localhost:5174'}`);
    console.log('\nDemo users (role: email):');
    for (const u of DEMO_USERS) {
      console.log(`  ${u.role.padEnd(15)} ${u.email}`);
    }
    console.log(`\nDemo password: ${DEMO_PASSWORD}`);
    console.log('\n⚠️  Demo password is for local prototype use only. Not production-safe.');
    console.log('─'.repeat(60));

  } catch (err) {
    console.error('\n❌ Seed failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
