/**
 * Hyundai Financial Statement Form 006 — Complete Structure Definition
 *
 * This file defines the LAYOUT of the Hyundai 006 form (7 pages, ~350 lines).
 * It contains NO data — only the structure that gets filled with GL balances.
 *
 * Source of truth: hyundai006_202603_03.pdf (Lee Hyundai, March 2026)
 * OEM Code: HY | Form: 006 | Version: 2026
 *
 * The amounts for every line come from AMACC's GL via gl_relate mappings.
 * When Parts creates an invoice → GL 460A → gl_relate → OEM line 460A (P6 L26)
 * When Service closes an RO → GL 450A → gl_relate → OEM line 450A (P6 L1)
 * When a Vehicle deal closes → GL 401 → gl_relate → OEM line 401 (P4 L1)
 */

import {
  type OEMFormDefinition, type FSFormPage, type FSFormLine,
  FSLineSource, Department,
} from '../types/financial-statements';

// ── Helper to create lines concisely ─────────────────────────────────────

const gl = (ln: number, label: string, oem: string[], opts: Partial<FSFormLine> = {}): FSFormLine => ({
  lineNumber: ln, label, oemAccounts: oem, source: FSLineSource.GL_BALANCE,
  indent: 0, isTotal: false, isContra: false, ...opts,
});

const sub = (ln: number, label: string, formula: string, opts: Partial<FSFormLine> = {}): FSFormLine => ({
  lineNumber: ln, label, oemAccounts: [], source: FSLineSource.SUBTOTAL, formula,
  indent: 0, isTotal: true, isContra: false, ...opts,
});

const calc = (ln: number, label: string, formula: string, opts: Partial<FSFormLine> = {}): FSFormLine => ({
  lineNumber: ln, label, oemAccounts: [], source: FSLineSource.FORMULA, formula,
  indent: 0, isTotal: false, isContra: false, ...opts,
});

const pct = (ln: number, label: string, formula: string): FSFormLine => ({
  lineNumber: ln, label, oemAccounts: [], source: FSLineSource.PERCENT, formula,
  indent: 0, isTotal: false, isContra: false,
});

const hdr = (ln: number, label: string): FSFormLine => ({
  lineNumber: ln, label, oemAccounts: [], source: FSLineSource.HEADER,
  indent: 0, isTotal: false, isContra: false,
});

const ext = (ln: number, label: string, key: string, opts: Partial<FSFormLine> = {}): FSFormLine => ({
  lineNumber: ln, label, oemAccounts: [], source: FSLineSource.EXTERNAL_MODULE,
  indent: 0, isTotal: false, isContra: false, formula: key, ...opts,
});

const sup = (ln: number, label: string, key: string, opts: Partial<FSFormLine> = {}): FSFormLine => ({
  lineNumber: ln, label, oemAccounts: [], source: FSLineSource.SUPPLEMENTAL,
  indent: 0, isTotal: false, isContra: false, formula: key, ...opts,
});

// ═══════════════════════════════════════════════════════════════════════════
// PAGE 1 — Balance Sheet (Assets / Liabilities / Net Worth)
// ═══════════════════════════════════════════════════════════════════════════
// Data source: GL trial balance. Every line is a GL account mapped to OEM number.
// Vehicle inventory (231A) comes from Vehicle Sales posting deal costs.
// Parts inventory (242A) comes from Parts module posting inventory adjustments.
// WIP (247) comes from Service posting labor to WIP on RO open.

const PAGE_1: FSFormPage = {
  pageNumber: 1,
  pageTitle: 'Balance Sheet',
  lines: [
    hdr(0, 'CURRENT ASSETS'),
    gl(1, 'Cash on Hand', ['210']),
    gl(2, 'Cash in Banks', ['211']),
    gl(3, 'Contracts in Transit - New', ['220'], { indent: 1 }),
    gl(4, 'Contracts in Transit - Used', ['221'], { indent: 1 }),
    sub(5, 'TOTAL CASH AND CONTRACTS IN TRANSIT (Lines 1 to 4)', 'SUM(1:4)', { isTotal: true }),
    hdr(6, 'RECEIVABLES'),
    gl(7, 'Hyundai Motor Finance', ['224'], { indent: 1 }),
    gl(8, 'Factory Receivable - Hyundai', ['222A'], { indent: 1 }),
    gl(9, 'Factory Receivable - Other Franchise', ['222B'], { indent: 1 }),
    gl(10, 'Parts & Service Receivable', ['223'], { indent: 1 }),
    gl(11, 'Vehicle Receivable', ['225'], { indent: 1 }),
    gl(12, 'Finance & Insurance Receivable', ['226'], { indent: 1 }),
    gl(13, 'Warranty Claims Receivable - Hyundai', ['227A'], { indent: 1 }),
    gl(14, 'Warranty Claims Receivable - Other', ['227B'], { indent: 1 }),
    gl(15, 'Accrued Incentives Receivable', ['228'], { indent: 1 }),
    gl(16, 'Holdbacks Receivable', ['229'], { indent: 1 }),
    gl(17, 'Sundry Receivables', ['230'], { indent: 1 }),
    sub(18, 'TOTAL RECEIVABLES (Lines 7 to 17)', 'SUM(7:17)', { isTotal: true }),
    gl(19, 'Allowance for Doubtful Accounts', ['232'], { indent: 1, isContra: true }),
    gl(20, 'Employee Receivables', ['233'], { indent: 1 }),
    gl(21, 'Amounts Due from Officers/Owners', ['236'], { indent: 1 }),
    gl(22, 'Amounts Due from Affiliates', ['237'], { indent: 1 }),
    gl(23, 'LIFO Reserve - A/R', ['238'], { indent: 1, isContra: true }),
    sub(24, 'NET RECEIVABLES (Lines 18 to 23)', 'SUM(18:23)', { isTotal: true }),
    hdr(25, 'FEDERAL TAX'),
    gl(26, 'Federal Income Tax Receivable', ['260'], { indent: 1 }),
    gl(27, 'State Income Tax Receivable', ['261'], { indent: 1 }),
    gl(28, 'Taxes - Other', ['262'], { indent: 1 }),
    sub(29, 'TOTAL TAXES RECEIVABLE (Lines 26 to 28)', 'SUM(26:28)', { isTotal: true }),
    hdr(30, 'INVENTORIES'),
    gl(31, 'New Vehicles - Hyundai', ['231A'], { indent: 1, hasUnits: true }),
    gl(32, 'New Vehicles - Other Franchise', ['231B'], { indent: 1, hasUnits: true }),
    gl(33, 'LIFO Reserve - New Vehicles', ['234'], { indent: 1, isContra: true }),
    gl(34, 'Long Term Debt / Capital Loans', ['334']),
    gl(35, 'Mortgages Payable', ['335']),
    sub(36, 'TOTAL NEW VEHICLES (Lines 31 to 35)', 'SUM(31:35)', { isTotal: true, hasUnits: true }),
    gl(37, 'Certified Used Vehicles - Hyundai', ['252'], { indent: 1, hasUnits: true }),
    gl(38, 'Used Vehicles - Hyundai', ['239'], { indent: 1, hasUnits: true }),
    gl(39, 'Used Vehicles - Other Franchise', ['240'], { indent: 1, hasUnits: true }),
    gl(40, 'LIFO Reserve - Used Vehicles', ['235'], { indent: 1, isContra: true }),
    gl(41, 'Lease & Rental Units - Current', ['287B'], { indent: 1 }),
    gl(42, 'Parts & Accessories - Hyundai', ['242A'], { indent: 1 }),
    gl(43, 'Parts & Accessories - Other Franchise', ['242B'], { indent: 1 }),
    gl(44, 'Tires', ['244A'], { indent: 1 }),
    gl(45, 'Gas, Oil, and Grease', ['244'], { indent: 1 }),
    gl(46, 'Paint and Body Shop Materials', ['245'], { indent: 1 }),
    gl(47, 'LIFO Reserve - Parts & Accessories', ['251'], { indent: 1, isContra: true }),
    gl(48, 'Sublet Repairs', ['246'], { indent: 1 }),
    gl(49, 'Work in Process - Labor', ['247'], { indent: 1 }),
    gl(50, 'Non-Automotive Inventory (for resale)', ['248'], { indent: 1 }),
    gl(51, 'Parts Inventory Adjustment', ['249'], { indent: 1 }),
    gl(52, 'Miscellaneous Inventories', ['243'], { indent: 1 }),
    sub(53, 'TOTAL INVENTORIES (Lines 36 to 52)', 'SUM(36:52)', { isTotal: true }),
    gl(54, 'Prepaid Expenses: Advertising', ['269'], { indent: 1 }),
    gl(55, 'Prepaid Expenses: Taxes Insurance', ['270', '271'], { indent: 1 }),
    gl(56, 'Prepaid Expenses: Rent Interest', ['272', '273'], { indent: 1 }),
    gl(57, 'Prepaid Expenses: Other', ['274'], { indent: 1 }),
    sub(58, 'TOTAL CURRENT ASSETS (Lines 5 + 29 + 53 to 57)', '5+29+53+54+55+56+57', { isTotal: true }),
    hdr(59, 'FIXED ASSETS - AUTO BUSINESS ONLY'),
    gl(62, 'Land', ['280']),
    gl(63, 'Buildings & Improvements', ['281', '351']),
    gl(64, 'Service Equipment', ['282', '352']),
    gl(65, 'P & A Equipment', ['283', '353']),
    gl(66, 'Furniture & Fixtures', ['284', '354']),
    gl(67, 'Company Vehicles / Lease & Rentals', ['285', '355', '287', '357']),
    gl(68, 'Leaseholds', ['286', '356']),
    sub(69, 'TOTAL FIXED ASSETS (Lines 62 to 68)', 'SUM(62:68)', { isTotal: true }),
    hdr(73, 'OTHER ASSETS'),
    gl(74, 'Deposits on Contracts', ['290'], { indent: 1 }),
    gl(75, 'Life Insurance - Cash Value', ['291'], { indent: 1 }),
    gl(76, 'Notes & Accounts Receivable - Officers/Owners', ['293'], { indent: 1 }),
    gl(77, 'Advances to Employees, Affiliates & Others', ['294'], { indent: 1 }),
    gl(78, 'Other Notes and Accounts Receivable', ['295'], { indent: 1 }),
    gl(79, 'Intangibles, Other Investments & Misc Assets', ['296'], { indent: 1 }),
    sub(80, 'TOTAL ASSETS (Lines 58 + 69 + 74 to 79)', '58+69+SUM(74:79)', { isTotal: true }),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// PAGE 2 — Total Income & Expenses (New Vehicle Department Column A)
// ═══════════════════════════════════════════════════════════════════════════
// Data source: GL balances mapped to expense account numbers.
// Salespeople compensation (11) comes from Payroll posting wages.
// Advertising (46/47) comes from AP posting vendor invoices.
// All expense lines are GL_BALANCE — the GL already has departmental coding.

const PAGE_2_LINES: FSFormLine[] = [
  calc(1, 'NET SALES (From Page 5, Page 6)', 'P5L21_SALES+P6L67_SALES'),
  calc(2, 'GROSS PROFIT (From Page 5, Page 6)', 'P5L21_GP+P6L67_GP'),
  pct(3, 'GROSS PROFIT PERCENT OF SALES', 'L2/L1*100'),
  hdr(4, 'VARIABLE SELLING EXPENSES'),
  gl(5, 'Salespeople: Compensation and Incentive', ['11'], { indent: 1 }),
  gl(6, 'F&I Managers: Compensation and Incentive', ['12'], { indent: 1 }),
  gl(7, 'Delivery Expense', ['13'], { indent: 1 }),
  gl(8, 'Policy Expense', ['14'], { indent: 1 }),
  gl(9, 'Interest - Floor Planning', ['15'], { indent: 1 }),
  gl(10, 'Less: Floorplan Assistance', ['18'], { indent: 1, isContra: true }),
  gl(11, 'Demonstrator Expense', ['16'], { indent: 1 }),
  gl(12, 'Used Vehicle Maintenance Expense', ['17'], { indent: 1 }),
  gl(13, 'Advertising - Hyundai', ['46', '47'], { indent: 1 }),
  gl(14, 'Less: Advertising Support from Hyundai (Co-Op)', ['48'], { indent: 1, isContra: true }),
  gl(15, 'Advertising - Other Franchise', ['49'], { indent: 1 }),
  sub(16, 'TOTAL VARIABLE SELLING EXPENSE (Lines 5 to 15)', 'SUM(5:15)', { isTotal: true }),
  hdr(17, 'FIXED OVERHEAD EXPENSES'),
  gl(18, 'Salaries - Owners/General Managers', ['20'], { indent: 1 }),
  gl(19, 'Salaries - Supervision', ['21'], { indent: 1 }),
  gl(20, 'Salaries - Clerical', ['22'], { indent: 1 }),
  gl(21, 'Other Salaries and Wages', ['23'], { indent: 1 }),
  gl(22, 'Leave - Vacation, Sick & Holiday Compensation', ['24'], { indent: 1 }),
  gl(23, 'Employee Benefits', ['25'], { indent: 1 }),
  gl(24, "Worker's Compensation", ['28'], { indent: 1 }),
  gl(25, 'Pension & Profit Sharing', ['26'], { indent: 1 }),
  gl(26, 'Taxes Payroll', ['27'], { indent: 1 }),
  sub(27, 'TOTAL SALARIES AND WAGES (Lines 18 to 26)', 'SUM(18:26)', { isTotal: true }),
  gl(28, 'Training', ['50'], { indent: 1 }),
  gl(29, 'Company Vehicle Expense', ['51'], { indent: 1 }),
  gl(30, 'Stationery, Office Supplies & Postage', ['60'], { indent: 1 }),
  gl(31, 'Small Tools & Other Supplies', ['61'], { indent: 1 }),
  gl(32, 'Contributions', ['66'], { indent: 1 }),
  gl(33, 'Outside Services', ['68'], { indent: 1 }),
  gl(34, 'Laundry & Uniforms', ['69'], { indent: 1 }),
  gl(35, 'Travel and Entertainment', ['70'], { indent: 1 }),
  gl(36, 'Membership, Dues and Publications', ['71'], { indent: 1 }),
  gl(37, 'Legal, Accounting and Auditing Expense', ['72'], { indent: 1 }),
  gl(38, 'Freight, Express and Cartage - Parts Dept', ['73'], { indent: 1 }),
  gl(39, 'Telephone', ['74'], { indent: 1 }),
  gl(40, 'Data Processing', ['77'], { indent: 1 }),
  gl(41, 'Adjustments for Doubtful Accounts', ['852'], { indent: 1 }),
  gl(42, 'Less: Bad Debts Recovered', ['802'], { indent: 1, isContra: true }),
  gl(43, 'Miscellaneous', ['78'], { indent: 1 }),
  sub(44, 'TOTAL SEMI-FIXED EXPENSE (Lines 28 to 43)', 'SUM(28:43)', { isTotal: true }),
  gl(45, 'Rent', ['80'], { indent: 1 }),
  gl(46, 'Amortization - Leaseholds', ['81'], { indent: 1 }),
  gl(47, 'Repairs - Real Estate', ['82'], { indent: 1 }),
  gl(48, 'Depreciation - Buildings and Improvements', ['83'], { indent: 1 }),
  gl(49, 'Taxes - Real Estate', ['84'], { indent: 1 }),
  gl(50, 'Insurance - Building and Improvements', ['85'], { indent: 1 }),
  gl(51, 'Interest - Real Estate Mortgage', ['86'], { indent: 1 }),
  sub(52, 'SUB TOTAL - OCCUPANCY EXPENSES (Lines 45 to 51)', 'SUM(45:51)', { isTotal: true }),
  gl(53, 'Heat, Light, Power and Water', ['87'], { indent: 1 }),
  gl(54, 'Insurance - Other than Bldg. & Improvements', ['88'], { indent: 1 }),
  gl(55, 'Taxes - Other than Real Estate, Income & Payroll', ['89'], { indent: 1 }),
  gl(56, 'Repairs - Equipment', ['90'], { indent: 1 }),
  gl(57, 'Depreciation - Other than Bldg. & Improvements', ['91'], { indent: 1 }),
  gl(58, 'Equipment Rental', ['92'], { indent: 1 }),
  sub(59, 'TOTAL FIXED EXPENSE (Lines 52 to 58)', '52+SUM(53:58)', { isTotal: true }),
  sub(60, 'TOTAL FIXED OVERHEAD EXPENSE (Lines 27 + 44 + 59)', '27+44+59', { isTotal: true }),
  sub(61, 'TOTAL EXPENSES (Lines 16 + 60)', '16+60', { isTotal: true }),
  calc(62, 'OPERATING PROFIT OR LOSS (Line 2 minus Line 61)', 'L2-L61'),
  gl(63, 'Accelerate Facilities Bonus - Hyundai', ['652B'], { indent: 1 }),
  gl(64, 'Account Reserved for Future Use', ['652C'], { indent: 1 }),
  gl(65, 'Ambassador: Brand Representation', ['652D'], { indent: 1 }),
  gl(66, 'Account Reserved for Future Use', ['652E'], { indent: 1 }),
  gl(67, 'Account Reserved for Future Use', ['652F'], { indent: 1 }),
  calc(68, 'OPERATING PROFIT (LOSS) After Hyundai Bonuses (Lines 62 to 67)', 'L62+SUM(63:67)'),
  calc(69, 'Net Additions and Deductions (Page 7, Lines 14 + 30)', 'P7L14+P7L30'),
  calc(70, 'NET PROFIT OR (LOSS) - Before Bonuses & Income Taxes (Lines 68 + 69)', 'L68+L69'),
  gl(71, 'Bonuses - Employees', ['97'], { indent: 1, isContra: true }),
  gl(72, 'Bonuses - Owners', ['98'], { indent: 1, isContra: true }),
  calc(73, 'NET PROFIT OR (LOSS) - After Bonuses & Before Income Taxes (Lines 70 to 72)', 'L70+L71+L72'),
  gl(74, 'Income Taxes', ['99'], { indent: 1, isContra: true }),
  gl(75, 'Rounding Adjustments', ['100'], { indent: 1 }),
  calc(76, 'NET PROFIT OR (LOSS) - After Bonuses and Income Taxes (Lines 73 to 75)', 'L73+L74+L75', { isTotal: true }),
];

const PAGE_2: FSFormPage = {
  pageNumber: 2,
  pageTitle: 'Total Income and Expenses — New Vehicle Department (Column A)',
  departments: [Department.TOTAL, Department.NEW_VEHICLE],
  lines: PAGE_2_LINES,
};

// ═══════════════════════════════════════════════════════════════════════════
// PAGE 3 — Departmental Income and Direct Expense
//          (Used / Service / Parts / Body Shop — Columns B, C, D, E)
// ═══════════════════════════════════════════════════════════════════════════
// Same line structure as Page 2 but with 4 department columns.
// Service column gets data from Service module postings to GL (journal source 30).
// Parts column gets data from Parts module postings to GL (journal source 40).
// Body Shop column gets data from Body Shop module postings to GL (source 60).

const PAGE_3: FSFormPage = {
  pageNumber: 3,
  pageTitle: 'Departmental Income and Direct Expense',
  departments: [Department.USED_VEHICLE, Department.SERVICE, Department.PARTS, Department.BODY_SHOP],
  lines: PAGE_2_LINES, // Same expense structure, different department columns
};

// ═══════════════════════════════════════════════════════════════════════════
// PAGE 4 — New Vehicle Gross Profit Analysis by Model
// ═══════════════════════════════════════════════════════════════════════════
// Data source: Vehicle Sales module posts each deal with model-specific GL accounts.
// When a Sonata deal closes → GL 401 (via journal source 50) → OEM line 401.
// Each line has UNITS SOLD, SALES, and GROSS PROFIT columns.

const PAGE_4: FSFormPage = {
  pageNumber: 4,
  pageTitle: 'New Vehicle Department — Gross Profit Analysis by Model',
  departments: [Department.NEW_VEHICLE],
  lines: [
    hdr(0, 'HYUNDAI CAR RETAIL'),
    gl(1, 'Sonata', ['401'], { indent: 1, hasUnits: true }),
    gl(2, 'Sonata N', ['401N'], { indent: 1, hasUnits: true }),
    gl(3, 'Sonata HEV', ['401H'], { indent: 1, hasUnits: true }),
    gl(4, 'Elantra', ['403'], { indent: 1, hasUnits: true }),
    gl(5, 'Elantra N', ['403N'], { indent: 1, hasUnits: true }),
    gl(6, 'Elantra HEV', ['403H'], { indent: 1, hasUnits: true }),
    gl(7, 'IONIQ 6', ['509'], { indent: 1, hasUnits: true }),
    gl(8, 'IONIQ 6 N', ['509N'], { indent: 1, hasUnits: true }),
    gl(9, 'Hyundai Car Future Product', ['518'], { indent: 1, hasUnits: true }),
    sub(10, 'Hyundai Car Retail Subtotal (Lines 1 to 9)', 'SUM(1:9)', { isTotal: true, hasUnits: true }),
    hdr(0, 'HYUNDAI TRUCK/SUV RETAIL'),
    gl(11, 'Santa Fe', ['406'], { indent: 1, hasUnits: true }),
    gl(12, 'Santa Fe HEV', ['406H'], { indent: 1, hasUnits: true }),
    gl(13, 'Tucson', ['408'], { indent: 1, hasUnits: true }),
    gl(14, 'Tucson HEV', ['408H'], { indent: 1, hasUnits: true }),
    gl(15, 'Tucson PHEV', ['408P'], { indent: 1, hasUnits: true }),
    gl(16, 'Kona', ['428'], { indent: 1, hasUnits: true }),
    gl(17, 'Kona EV', ['428E'], { indent: 1, hasUnits: true }),
    gl(18, 'IONIQ 5', ['519'], { indent: 1, hasUnits: true }),
    gl(19, 'IONIQ 5 N', ['550'], { indent: 1, hasUnits: true }),
    gl(20, 'Nexo', ['429'], { indent: 1, hasUnits: true }),
    gl(21, 'Palisade', ['514'], { indent: 1, hasUnits: true }),
    gl(22, 'Palisade HEV', ['514H'], { indent: 1, hasUnits: true }),
    gl(23, 'Venue', ['515'], { indent: 1, hasUnits: true }),
    gl(24, 'Santa Cruz', ['516'], { indent: 1, hasUnits: true }),
    gl(25, 'IONIQ 9', ['520'], { indent: 1, hasUnits: true }),
    gl(26, 'Hyundai Truck Future Product', ['522'], { indent: 1, hasUnits: true }),
    sub(27, 'Hyundai Truck Retail Subtotal (Lines 11 to 26)', 'SUM(11:26)', { isTotal: true, hasUnits: true }),
    sub(28, 'Total New Hyundai Retail Subtotal (Lines 10 + 27)', '10+27', { isTotal: true, hasUnits: true }),
    hdr(0, 'HYUNDAI CAR LEASE'),
    gl(29, 'Sonata Lease', ['401L'], { indent: 1, hasUnits: true }),
    gl(30, 'Sonata N Lease', ['401LN'], { indent: 1, hasUnits: true }),
    gl(31, 'Sonata HEV Lease', ['401LH'], { indent: 1, hasUnits: true }),
    gl(32, 'Elantra Lease', ['403L'], { indent: 1, hasUnits: true }),
    gl(33, 'Elantra N Lease', ['403LN'], { indent: 1, hasUnits: true }),
    gl(34, 'Elantra HEV Lease', ['403LH'], { indent: 1, hasUnits: true }),
    gl(35, 'IONIQ 6 Lease', ['509L'], { indent: 1, hasUnits: true }),
    gl(36, 'IONIQ 6 N Lease', ['509LN'], { indent: 1, hasUnits: true }),
    gl(37, 'Hyundai Car Future Product Lease', ['518L'], { indent: 1, hasUnits: true }),
    sub(38, 'Hyundai Car Lease Subtotal (Lines 29 to 37)', 'SUM(29:37)', { isTotal: true, hasUnits: true }),
    hdr(0, 'HYUNDAI TRUCK/SUV LEASE'),
    gl(39, 'Santa Fe Lease', ['406L'], { indent: 1, hasUnits: true }),
    gl(40, 'Santa Fe HEV Lease', ['406LH'], { indent: 1, hasUnits: true }),
    gl(41, 'Tucson Lease', ['408L'], { indent: 1, hasUnits: true }),
    gl(42, 'Tucson HEV Lease', ['408LH'], { indent: 1, hasUnits: true }),
    gl(43, 'Tucson PHEV Lease', ['408LP'], { indent: 1, hasUnits: true }),
    gl(44, 'Kona Lease', ['428L'], { indent: 1, hasUnits: true }),
    gl(45, 'Kona EV Lease', ['428LE'], { indent: 1, hasUnits: true }),
    gl(46, 'IONIQ 5 Lease', ['519L'], { indent: 1, hasUnits: true }),
    gl(47, 'IONIQ 5 N Lease', ['550L'], { indent: 1, hasUnits: true }),
    gl(48, 'Nexo Lease', ['429L'], { indent: 1, hasUnits: true }),
    gl(49, 'Palisade Lease', ['514L'], { indent: 1, hasUnits: true }),
    gl(50, 'Palisade HEV Lease', ['514LH'], { indent: 1, hasUnits: true }),
    gl(51, 'Venue Lease', ['515L'], { indent: 1, hasUnits: true }),
    gl(52, 'Santa Cruz Lease', ['516L'], { indent: 1, hasUnits: true }),
    gl(53, 'IONIQ 9 Lease', ['520L'], { indent: 1, hasUnits: true }),
    gl(54, 'Hyundai Truck Future Product Lease', ['522L'], { indent: 1, hasUnits: true }),
    sub(55, 'Hyundai Truck Lease Subtotal (Lines 39 to 54)', 'SUM(39:54)', { isTotal: true, hasUnits: true }),
    sub(56, 'Total Hyundai Lease Subtotal (Lines 38 + 55)', '38+55', { isTotal: true, hasUnits: true }),
    hdr(0, 'POWERTRAIN TYPE SUBTOTALS'),
    calc(57, 'Hyundai ICE Subtotal', 'ICE_SUBTOTAL', { hasUnits: true }),
    calc(58, 'Total Hyundai Hybrid Subtotal', 'HEV_SUBTOTAL', { hasUnits: true }),
    calc(59, 'Hyundai EV Subtotal', 'EV_SUBTOTAL', { hasUnits: true }),
    sub(60, 'Total Hyundai Car & Truck Retail + Lease (Lines 28 + 56)', '28+56', { isTotal: true, hasUnits: true }),
    gl(61, 'Hyundai Car & Truck Fleet', ['409'], { indent: 1, hasUnits: true }),
    gl(62, 'Discontinued Models - Hyundai', ['517'], { indent: 1, hasUnits: true }),
    sub(63, 'Total Hyundai Car & Truck + Fleet + Discontinued (Lines 60 to 62)', 'SUM(60:62)', { isTotal: true, hasUnits: true }),
    gl(64, 'Incentives - Hyundai', ['616A'], { indent: 1 }),
    gl(65, 'Performance Engagement Program (PEP)', ['652A'], { indent: 1 }),
    gl(66, 'Ambassador: Sales Pillar', ['452A'], { indent: 1 }),
    gl(67, 'Account Reserved for Future Use', ['452B'], { indent: 1 }),
    sub(68, 'Total Hyundai Car & Truck Front-End (Lines 63 to 67)', 'SUM(63:67)', { isTotal: true }),
    hdr(0, 'F&I — HYUNDAI'),
    gl(69, 'Finance Income - Hyundai', ['611A'], { indent: 1 }),
    gl(70, 'Insurance Income - Hyundai', ['613A'], { indent: 1 }),
    gl(71, 'Extended Service Contract - Hyundai', ['415A'], { indent: 1 }),
    gl(72, 'GAP Income - Hyundai', ['440A'], { indent: 1 }),
    gl(73, 'Hyundai Vehicle Care (HVC)', ['447'], { indent: 1 }),
    gl(74, 'Misc Warranty Product Income - Hyundai', ['419A'], { indent: 1 }),
    gl(75, 'Aftermarket Income - Hyundai', ['417A'], { indent: 1 }),
    gl(76, 'Less: Chargebacks - Hyundai', ['618A'], { indent: 1, isContra: true }),
    sub(77, 'F&I Subtotal - Hyundai (Lines 69 to 76)', 'SUM(69:76)', { isTotal: true }),
    sub(78, 'Total New Vehicle - Hyundai (Lines 68 + 77)', '68+77', { isTotal: true }),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// PAGE 5 — Other Franchise New + Used Vehicle Detail + F&I
// ═══════════════════════════════════════════════════════════════════════════

const PAGE_5: FSFormPage = {
  pageNumber: 5,
  pageTitle: 'New Vehicle Other Franchise + Used Vehicle Department',
  departments: [Department.NEW_VEHICLE, Department.USED_VEHICLE],
  lines: [
    hdr(0, 'NEW VEHICLE — OTHER FRANCHISE'),
    gl(1, 'New Car Retail - Other Franchise', ['420'], { indent: 1, hasUnits: true }),
    gl(2, 'New Car Fleet - Other Franchise', ['421'], { indent: 1, hasUnits: true }),
    gl(3, 'New Car Lease - Other Franchise', ['422'], { indent: 1, hasUnits: true }),
    gl(4, 'New Truck Retail - Other Franchise', ['423'], { indent: 1, hasUnits: true }),
    gl(5, 'New Truck Fleet - Other Franchise', ['424'], { indent: 1, hasUnits: true }),
    gl(6, 'New Truck Lease - Other Franchise', ['492'], { indent: 1, hasUnits: true }),
    sub(7, 'Subtotal New Vehicle - Other Franchise (Lines 1-6)', 'SUM(1:6)', { isTotal: true, hasUnits: true }),
    gl(8, 'Incentives - Other Franchise', ['616B'], { indent: 1 }),
    sub(9, 'Subtotal w/ Incentives (Lines 7+8)', '7+8', { isTotal: true }),
    hdr(0, 'F&I — OTHER FRANCHISE'),
    gl(10, 'Finance Income - Other Franchise', ['611B'], { indent: 1 }),
    gl(11, 'Insurance Income - Other Franchise', ['613B'], { indent: 1 }),
    gl(12, 'Extended Service Contract - Other Franchise', ['415B'], { indent: 1 }),
    gl(13, 'GAP Income - Other Franchise', ['440B'], { indent: 1 }),
    gl(14, 'Prepaid Maintenance - Other Franchise', ['447B'], { indent: 1 }),
    gl(15, 'Misc Warranty Product Income - Other Franchise', ['419B'], { indent: 1 }),
    gl(16, 'Aftermarket Income - Other Franchise', ['417B'], { indent: 1 }),
    gl(17, 'Less: Chargebacks - Other Franchise', ['618B'], { indent: 1, isContra: true }),
    sub(18, 'F&I Subtotal - Other Franchise (Lines 10 to 17)', 'SUM(10:17)', { isTotal: true }),
    sub(19, 'Total New Vehicle - Other Franchise (Lines 9 + 18)', '9+18', { isTotal: true }),
    gl(20, 'Less: Cost of Sales Adj.: New Vehicle LIFO', ['625'], { isContra: true }),
    sub(21, 'TOTAL NEW VEHICLE DEPARTMENT (P4:L78 + 19 + 20)', 'P4L78+19+20', { isTotal: true }),
    hdr(0, 'USED VEHICLE DEPARTMENT'),
    hdr(0, 'HYUNDAI CERTIFIED USED'),
    gl(24, 'Hyundai Certified Used Vehicles - Cars', ['442A'], { indent: 1, hasUnits: true }),
    gl(25, 'Hyundai Certified Used Vehicles - EV/HEV Cars', ['442AG'], { indent: 1, hasUnits: true }),
    gl(26, 'Hyundai Certified Used Vehicles - SUV/CUV', ['442B'], { indent: 1, hasUnits: true }),
    gl(27, 'Hyundai Certified Used Vehicles - EV/HEV SUV/CUV', ['442BG'], { indent: 1, hasUnits: true }),
    gl(28, 'Hyundai Certified Used - Reconditioning', ['632'], { indent: 1, isContra: true }),
    sub(29, 'Subtotal Hyundai CUV (Lines 24 to 28)', 'SUM(24:28)', { isTotal: true, hasUnits: true }),
    gl(30, 'Used Retail Hyundai - Cars', ['441A'], { indent: 1, hasUnits: true }),
    gl(31, 'Used Retail Hyundai - EV/HEV Cars', ['441AG'], { indent: 1, hasUnits: true }),
    gl(32, 'Used Retail Hyundai - SUV/CUV', ['441B'], { indent: 1, hasUnits: true }),
    gl(33, 'Used Retail Hyundai - EV/HEV SUV/CUV', ['441BG'], { indent: 1, hasUnits: true }),
    gl(34, 'Used Retail Hyundai - Reconditioning', ['631'], { indent: 1, isContra: true }),
    sub(35, 'Subtotal Used Retail - Hyundai (Lines 30 to 34)', 'SUM(30:34)', { isTotal: true, hasUnits: true }),
    sub(36, 'Subtotal Hyundai CUV & Used Retail (Lines 29 + 35)', '29+35', { isTotal: true, hasUnits: true }),
    gl(37, 'Used Retail - Other Franchise - Cars', ['430A'], { indent: 1, hasUnits: true }),
    gl(38, 'Used Retail - Other Franchise - Trucks', ['430B'], { indent: 1, hasUnits: true }),
    gl(39, 'Used Retail - Other Franchise - SUV/CUV', ['430C'], { indent: 1, hasUnits: true }),
    gl(40, 'Used Retail - Other Franchise - Hybrid/EV', ['430G'], { indent: 1, hasUnits: true }),
    gl(41, 'Used Retail - Other Franchise - Reconditioning', ['631A'], { indent: 1, isContra: true }),
    sub(42, 'Subtotal Other Franchise Used Retail (Lines 37 to 41)', 'SUM(37:41)', { isTotal: true, hasUnits: true }),
    sub(43, 'Subtotal CUV, Used Retail & Other Franchise (Lines 36 + 42)', '36+42', { isTotal: true, hasUnits: true }),
    hdr(0, 'F&I — USED'),
    gl(44, 'Finance Income - Used', ['635'], { indent: 1 }),
    gl(45, 'Insurance Income - Used', ['636'], { indent: 1 }),
    gl(46, 'Extended Service Contract - Used', ['437'], { indent: 1 }),
    gl(47, 'GAP Income - Used', ['440C'], { indent: 1 }),
    gl(48, 'Prepaid Maintenance - Used', ['447C'], { indent: 1 }),
    gl(49, 'Misc Warranty Product Income - Used', ['419C'], { indent: 1 }),
    gl(50, 'Aftermarket Product Income - Used', ['417C'], { indent: 1 }),
    gl(51, 'Less: Chargebacks - Used', ['638'], { indent: 1, isContra: true }),
    sub(52, 'F&I Subtotal - Used (Lines 44 to 51)', 'SUM(44:51)', { isTotal: true }),
    sub(53, 'Subtotal Used Retail with F&I (Lines 43 + 52)', '43+52', { isTotal: true }),
    gl(54, 'Used Wholesale', ['433'], { indent: 1, hasUnits: true }),
    gl(55, 'Less: Adj. Used Vehicle Inventory', ['634'], { indent: 1, isContra: true }),
    gl(56, 'Less: Cost of Sales Adj.: Used Vehicle LIFO', ['639'], { indent: 1, isContra: true }),
    sub(57, 'TOTAL USED VEHICLE DEPARTMENT (Lines 53 to 56)', 'SUM(53:56)', { isTotal: true }),
    sub(58, 'TOTAL NEW & USED VEHICLE DEPARTMENTS (Lines 21 + 57)', '21+57', { isTotal: true }),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// PAGE 6 — Service, Parts & Accessories, Body Shop Gross Profit
// ═══════════════════════════════════════════════════════════════════════════
// SERVICE: Data from Service module → POST /service-invoice → GL 450A-455G
// PARTS: Data from Parts module → POST /parts-invoice → GL 460A-467G
// BODY: Data from Body Shop module → GL 500-507

const PAGE_6: FSFormPage = {
  pageNumber: 6,
  pageTitle: 'Service, Parts & Accessories, Body Shop Departments',
  departments: [Department.SERVICE, Department.PARTS, Department.BODY_SHOP],
  lines: [
    hdr(0, 'SERVICE DEPARTMENT'),
    gl(1, 'Customer Mech. Labor - Hyundai', ['450A'], { indent: 1 }),
    gl(2, 'Assurance Car Care Express - Hyundai', ['451A'], { indent: 1 }),
    gl(3, 'Complimentary Maintenance - Hyundai', ['493A'], { indent: 1 }),
    gl(4, 'Warranty Claim Mech. Labor - Hyundai', ['454A'], { indent: 1 }),
    gl(5, 'Internal Mech. Labor - Hyundai', ['455A'], { indent: 1 }),
    gl(6, 'Customer Mech. Labor - Hyundai EV', ['450G'], { indent: 1 }),
    gl(7, 'Car Care Express - Hyundai EV', ['451G'], { indent: 1 }),
    gl(8, 'Complimentary Maintenance - Hyundai EV', ['493G'], { indent: 1 }),
    gl(9, 'Warranty Claim Mech. Labor - Hyundai EV', ['454G'], { indent: 1 }),
    gl(10, 'Internal Mech. Labor - Hyundai EV', ['455G'], { indent: 1 }),
    calc(11, 'Subtotal All Customer Mech. Labor Type - Hyundai', '1+2+3+6+7+8'),
    calc(12, 'Subtotal All Warranty Mech. Labor Type - Hyundai', '4+9'),
    calc(13, 'Subtotal All Internal Mech. Labor Type - Hyundai', '5+10'),
    sub(14, 'Subtotal All Labor Types - Hyundai (Lines 1 to 10)', 'SUM(1:10)', { isTotal: true }),
    gl(15, 'Customer Mech. Labor - Other Franchise', ['450B'], { indent: 1 }),
    gl(16, 'Car Care Express - Other Franchise', ['451B'], { indent: 1 }),
    gl(17, 'Complimentary Maintenance - Other Franchise', ['493B'], { indent: 1 }),
    gl(18, 'Warranty Claim Mech. Labor - Other Franchise', ['454B'], { indent: 1 }),
    gl(19, 'Internal Mech. Labor - Other Franchise', ['455B'], { indent: 1 }),
    sub(20, 'Subtotal Labor - Other Franchise (Lines 15 to 19)', 'SUM(15:19)', { isTotal: true }),
    gl(21, 'Sublet Repairs - Mech.', ['456'], { indent: 1 }),
    gl(22, 'Less: Unapplied Labor', ['657'], { indent: 1, isContra: true }),
    gl(23, 'Miscellaneous', ['459'], { indent: 1 }),
    gl(24, 'Ambassador: After-Sales Pillar', ['459A'], { indent: 1 }),
    sub(25, 'TOTAL SERVICE DEPARTMENT (Lines 14+20 to 24)', '14+20+21+22+23+24', { isTotal: true }),
    hdr(0, 'PARTS & ACCESSORIES DEPARTMENT'),
    gl(26, 'P&A - Customer - Hyundai', ['460A'], { indent: 1 }),
    gl(27, 'P&A - Car Care Express - Hyundai', ['472A'], { indent: 1 }),
    gl(28, 'P&A Complimentary Maintenance - Hyundai', ['494A'], { indent: 1 }),
    gl(29, 'P&A - Warranty Claims - Hyundai', ['464A'], { indent: 1 }),
    gl(30, 'P&A - Internal - Hyundai', ['465A'], { indent: 1 }),
    gl(31, 'P&A - Counter - Hyundai', ['466A'], { indent: 1 }),
    gl(32, 'P&A - Wholesale - Hyundai', ['467A'], { indent: 1 }),
    gl(33, 'P&A - Customer - Hyundai EV', ['460G'], { indent: 1 }),
    gl(34, 'P&A - Car Care Express - Hyundai EV', ['472G'], { indent: 1 }),
    gl(35, 'P&A Complimentary Maintenance - Hyundai EV', ['494G'], { indent: 1 }),
    gl(36, 'P&A - Warranty Claims - Hyundai EV', ['464G'], { indent: 1 }),
    gl(37, 'P&A - Internal - Hyundai EV', ['465G'], { indent: 1 }),
    gl(38, 'P&A - Counter - Hyundai EV', ['466G'], { indent: 1 }),
    gl(39, 'P&A - Wholesale - Hyundai EV', ['467G'], { indent: 1 }),
    calc(40, 'Subtotal All P&A Customer Type - Hyundai', '26+27+28+33+34+35'),
    calc(41, 'Subtotal All P&A Warranty Type - Hyundai', '29+36'),
    calc(42, 'Subtotal All P&A Internal Type - Hyundai', '30+37'),
    sub(43, 'Subtotal P&A - Hyundai (Lines 26 to 39)', 'SUM(26:39)', { isTotal: true }),
    gl(44, 'P&A - Customer - Other Franchise', ['460B'], { indent: 1 }),
    gl(45, 'P&A - Car Care Express - Other Franchise', ['472B'], { indent: 1 }),
    gl(46, 'P&A - Complimentary Maintenance - Other Franchise', ['494B'], { indent: 1 }),
    gl(47, 'P&A - Warranty Claims - Other Franchise', ['464B'], { indent: 1 }),
    gl(48, 'P&A - Internal - Other Franchise', ['465B'], { indent: 1 }),
    gl(49, 'P&A - Counter - Other Franchise', ['466B'], { indent: 1 }),
    gl(50, 'P&A - Wholesale - Other Franchise', ['467B'], { indent: 1 }),
    sub(51, 'Subtotal P&A - Other Franchise (Lines 44 to 50)', 'SUM(44:50)', { isTotal: true }),
    gl(52, 'Less: P&A Inventory Adjustments', ['675'], { isContra: true }),
    gl(53, 'Non-Auto & Aftermarket Merchandise, Misc.', ['481'], { indent: 1 }),
    gl(54, 'Tires', ['491'], { indent: 1 }),
    gl(55, 'Gas, Oil, & Grease', ['490'], { indent: 1 }),
    gl(56, 'Less: Cost of Sales Adj.: P&A LIFO', ['680'], { isContra: true }),
    sub(57, 'TOTAL PARTS & ACCESSORIES DEPARTMENT (Lines 43+51 to 56)', '43+51+52+53+54+55+56', { isTotal: true }),
    hdr(0, 'BODY SHOP DEPARTMENT'),
    gl(58, 'Customer Body Shop Labor', ['500'], { indent: 1 }),
    gl(59, 'Warranty Claims Body Shop Labor', ['504'], { indent: 1 }),
    gl(60, 'Internal Body Shop Labor', ['505'], { indent: 1 }),
    gl(61, 'P&A - R.O. - Body Shop - Hyundai', ['462A'], { indent: 1 }),
    gl(62, 'P&A - R.O. - Body Shop - Other Franchise', ['462B'], { indent: 1 }),
    gl(63, 'Sublet Repairs - Body Shop', ['506'], { indent: 1 }),
    gl(64, 'Paint, Materials & Misc. - Body Shop', ['507'], { indent: 1 }),
    gl(65, 'Less: Unapplied Labor - Body Shop', ['708'], { indent: 1, isContra: true }),
    sub(66, 'TOTAL BODY SHOP DEPARTMENT (Lines 58 to 65)', 'SUM(58:65)', { isTotal: true }),
    sub(67, 'TOTAL SERVICE, PARTS & BODY SHOP (Lines 25 + 57 + 66)', '25+57+66', { isTotal: true }),
    sub(68, 'TOTAL ALL DEPARTMENTS (P5:L58 + P6:L67)', 'P5L58+67', { isTotal: true }),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// PAGE 7 — Management Operating Information
// ═══════════════════════════════════════════════════════════════════════════
// Other Income/Deductions come from GL (journal entries, AP, Cash Receipts).
// Personnel counts and technician hours are SUPPLEMENTAL data — entered
// manually or pushed from Payroll/Service modules via API.

const PAGE_7: FSFormPage = {
  pageNumber: 7,
  pageTitle: 'Management Operating Information',
  lines: [
    hdr(0, 'ADDITIONS TO INCOME'),
    gl(1, 'Other Income - Doc Fees', ['805A'], { indent: 1 }),
    gl(2, 'Other Income - Packs', ['805B'], { indent: 1 }),
    gl(3, 'Other Income - License Tags and Titles', ['805C'], { indent: 1 }),
    gl(4, 'Other Income - Dealer Trades', ['805D'], { indent: 1 }),
    gl(5, 'Other Income - Incentives', ['805E'], { indent: 1 }),
    gl(6, 'Other Income - Management Fees', ['805F'], { indent: 1 }),
    gl(7, 'Other Income - Chargers', ['805H'], { indent: 1 }),
    gl(8, 'Other Income - Miscellaneous', ['805G'], { indent: 1 }),
    sub(9, 'Other Income Subtotal (Lines 1 to 8)', 'SUM(1:8)', { isTotal: true }),
    gl(10, 'Cash Discount Earned', ['800'], { indent: 1 }),
    gl(11, 'Interest Earned', ['801'], { indent: 1 }),
    gl(12, 'Capital Assets, Gains', ['803'], { indent: 1 }),
    gl(13, 'Lease and Rental Units Income', ['809'], { indent: 1 }),
    sub(14, 'TOTAL ADDITIONS (Lines 9 to 13)', '9+10+11+12+13', { isTotal: true }),
    hdr(15, 'DEDUCTIONS FROM INCOME'),
    gl(16, 'Other Deductions - Doc Fees', ['855A'], { indent: 1 }),
    gl(17, 'Other Deductions - Packs', ['855B'], { indent: 1 }),
    gl(18, 'Other Deductions - License Tags and Titles', ['855C'], { indent: 1 }),
    gl(19, 'Other Deductions - Dealer Trades', ['855D'], { indent: 1 }),
    gl(20, 'Other Deductions - Incentives', ['855E'], { indent: 1 }),
    gl(21, 'Other Deductions - Management Fees', ['855F'], { indent: 1 }),
    gl(22, 'Other Deductions - Chargers', ['855H'], { indent: 1 }),
    gl(23, 'Other Deductions - Miscellaneous', ['855G'], { indent: 1 }),
    sub(24, 'Other Deductions Subtotal (Lines 16 to 23)', 'SUM(16:23)', { isTotal: true }),
    gl(25, 'Interest Expense', ['851'], { indent: 1 }),
    gl(26, 'Capital Assets, Losses', ['853'], { indent: 1 }),
    gl(27, 'Repossession Losses', ['857'], { indent: 1 }),
    gl(28, 'Casualty Losses', ['858'], { indent: 1 }),
    gl(29, 'Lease and Rental Units Expense', ['859'], { indent: 1 }),
    sub(30, 'TOTAL DEDUCTIONS (Lines 24 to 29)', '24+25+26+27+28+29', { isTotal: true }),
    hdr(0, 'PERSONNEL SUMMARY'),
    sup(31, 'Owners', 'personnel_owners', { department: Department.TOTAL }),
    sup(32, 'Management', 'personnel_management', { department: Department.TOTAL }),
    sup(33, 'F&I Managers', 'personnel_fi', { department: Department.TOTAL }),
    sup(34, 'Salespeople', 'personnel_sales', { department: Department.TOTAL }),
    sup(35, 'Technicians', 'personnel_techs', { department: Department.TOTAL }),
    sup(36, 'Service Advisors', 'personnel_advisors', { department: Department.TOTAL }),
    sup(37, 'Clerical', 'personnel_clerical', { department: Department.TOTAL }),
    sup(38, 'Other Employees', 'personnel_other', { department: Department.TOTAL }),
    hdr(0, 'SERVICE TECHNICIAN HOURS'),
    sup(39, 'Total Available Hours', 'tech_hours_available'),
    sup(40, 'Actual Hours Worked (Incl. OT)', 'tech_hours_worked'),
    sup(41, 'Total Hours Sold', 'tech_hours_sold'),
    calc(42, 'Total Effective Labor Rate', 'tech_hours_rate'),
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE FORM DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

export const HYUNDAI_006: OEMFormDefinition = {
  oem: 'HYUNDAI',
  formCode: '006',
  formVersion: '2026',
  totalPages: 7,
  pages: [PAGE_1, PAGE_2, PAGE_3, PAGE_4, PAGE_5, PAGE_6, PAGE_7],
};

export default HYUNDAI_006;
