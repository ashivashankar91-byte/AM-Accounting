// ══════════════════════════════════════════════════════════════════
// File Maintenance Types — Lee Hyundai Inc. (Company 03)
// GLACC · INVACC · STDJNL · SCHEDPR
// ══════════════════════════════════════════════════════════════════

// ── GL Account ────────────────────────────────────────────────────

export enum AccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EXPENSE = 'EXPENSE',
  INCOME = 'INCOME',
  DIST = 'DIST',
}

export enum ControlType {
  NONE = '',
  LOOKUP_CONTROL = 'Lookup Control',
  APPLY_TO = 'Apply To',
  DO_NOT_LOOKUP = 'Do Not Lookup',
  STOCK_NUMBER = 'Stock Number',
  LAST_6_VIN = 'Last 6 of VIN',
}

export enum OEMPrefix {
  HYUNDAI = 'HYU',
  GENESIS = 'GEN',
}

export interface DistributionEntry {
  targetAcct: string;
  percentage: number;
}

export interface GLAccount {
  acctNum: string;
  name: string;
  costGL: string | null;
  inventoryGL: string | null;
  schedule: string;
  controlRequired: ControlType;
  addUnits: boolean;
  type: AccountType;
  inactive: boolean;
  oemPrefix: OEMPrefix | null;
  isDistAccount: boolean;
  distributionTargets?: DistributionEntry[];
}

// OEM-critical accounts that must NOT be modified without compliance review
export const OEM_CRITICAL_ACCOUNTS = new Set([
  '2260','2262','2265','2270','G2270','2280','G2280','2290',
  '2310','2311','G2310','3000','3006','3007','2320',
]);

// Accounts with addUnits = true
export const ADD_UNITS_ACCOUNTS = new Set([
  '2310','G2310','2400','2403','2403L','2410','2411','G2390',
]);

// ── Schedule Format ───────────────────────────────────────────────

export enum ScheduleType {
  TYPE_1 = 1, // Current Month Detail Only
  TYPE_2 = 2, // Aged Balance Forward
  TYPE_3 = 3, // Open Item — Multiple Accts (HIGHEST RISK)
  TYPE_4 = 4, // Credit Aged Balance Forward
  TYPE_5 = 5, // Open Item by Apply-To#
}

export const SCHEDULE_TYPE_LABELS: Record<number, string> = {
  1: 'Current Month Detail',
  2: 'Aged Balance Forward',
  3: 'Open Item (Multi-Acct)',
  4: 'Credit Aged Bal Fwd',
  5: 'Open Item (Apply-To)',
};

export const SCHEDULE_TYPE_RISK: Record<number, 'low' | 'medium' | 'high'> = {
  1: 'low', 2: 'medium', 3: 'high', 4: 'medium', 5: 'high',
};

export enum PurgeCode {
  CODE_1 = 1, // Purge All — BalFwd by GL Acct#
  CODE_2 = 2, // Aged BalFwd
  CODE_3 = 3, // Purge When Bal=0
  CODE_4 = 4, // Aged BalFwd (Type 4)
  CODE_5 = 5, // Apply#=0 Bal
  CODE_6 = 6, // BalFwd — Cont#
  CODE_7 = 7, // Purge All Prior Month Detail
}

export const PURGE_CODE_LABELS: Record<number, string> = {
  1: 'Purge All — BalFwd by GL#',
  2: 'Aged BalFwd',
  3: 'Purge When Bal=0',
  4: 'Aged BalFwd (Type 4)',
  5: 'Apply#=0 Bal',
  6: 'BalFwd — Cont# (carry forever)',
  7: 'Purge All Prior Month Detail',
};

export enum NameDisplayCode {
  Y = 'Y',
  TWO = '2',
  O = 'O',
  V = 'V',
  N = 'N',
  D = 'D',
}

export enum ReportSequence {
  CONTROL = 'C',
  NAME = 'N',
  AGE = 'A',
}

export interface ScheduleGLLink {
  glAccount: string;
  controlSuffix: string; // L=Lookup, S=Stock, D=Detail, A=Apply-To, ''=default
}

export interface ScheduleFormat {
  scheduleNumber: number;
  title: string;
  scheduleType: ScheduleType;
  glAccounts: ScheduleGLLink[];
  purgeCode: PurgeCode;
  nameDisplay: NameDisplayCode;
  controlRequired: boolean;
  reportSequence: ReportSequence;
}

// ── Standard Journal Entry ────────────────────────────────────────

export enum SJEType {
  MANUAL = 'Manual',
  AUTOMATIC = 'Automatic',
}

export interface SJELine {
  lineNumber: number;
  glAccount: string;
  description: string;
  debit: number;
  credit: number;
  controlNumber: string | null;
}

export interface StandardJournalEntry {
  id: string;
  name: string;
  sourceCode: number;
  referenceNumber: string;
  lastPostDate: string | null;
  entryType: SJEType;
  notes: string;
  lines: SJELine[];
  postingType: string | null;
  nextPostDate: string | null;
  numberOfTimes: number | null;
  lockedBy: string | null;
  lockedAt: string | null;
}

// ── Vehicle Inventory ─────────────────────────────────────────────

export enum VehicleStatus {
  AVAILABLE = 'Available',
  SOLD = 'Sold',
  DEMO = 'Demo',
  LOANER = 'Loaner',
  WHOLESALE = 'Wholesale',
  TRANSIT = 'In Transit',
  TRADE = 'Trade-In',
}

export interface VehicleOption {
  code: string;
  description: string;
  msrp: number;
  invoice: number;
}

export interface VehicleInventory {
  stockNumber: string;
  vin: string;
  year: number;
  make: string;
  model: string;
  bodyStyle: string;
  modelNumber: string;
  lot: number;
  exteriorColor: string;
  interiorColor: string;
  colorCode: string;
  trim: string;
  mileage: number;
  status: VehicleStatus;
  statusDate: string;
  inventoryDate: string;
  age: number;
  inServiceDate: string | null;
  originalPrice: number;
  priceChange: number;
  totalPrice: number;
  originalCost: number;
  costChange: number;
  totalCost: number;
  holdback: number;
  advertising: number;
  commissionExclusion: number;
  costBump: number;
  salesCost: number;
  baseValue: number;
  invoiceAmount: number;
  marketValue: number;
  advertisedPrice: number;
  invGL: string;
  certified: boolean;
  fleet: boolean;
  commercial: boolean;
  options: VehicleOption[];
}

// ── Seed Data: 43 Active Schedules for Co.03 ─────────────────────

export const LEE_HYUNDAI_SCHEDULES: ScheduleFormat[] = [
  { scheduleNumber: 2, title: 'SALES COMMISSION (ACCRU)', scheduleType: ScheduleType.TYPE_4, glAccounts: [{ glAccount: '3211', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_4, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 3, title: 'NEW HYUNDAI INVENTORY', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2300', controlSuffix: 'S' }, { glAccount: '2310', controlSuffix: 'S' }, { glAccount: '2311', controlSuffix: 'S' }, { glAccount: '3100', controlSuffix: 'S' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.TWO, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 4, title: 'USED CAR INVENTORY', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2400', controlSuffix: 'S' }, { glAccount: '2403', controlSuffix: 'S' }, { glAccount: '3120', controlSuffix: 'S' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.TWO, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 5, title: 'PREPAID EXPENSES', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2740', controlSuffix: '' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 6, title: "EMPLOYEE'S BONUS", scheduleType: ScheduleType.TYPE_4, glAccounts: [{ glAccount: '3280', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_4, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 8, title: 'HMA/GMA PAYABLE', scheduleType: ScheduleType.TYPE_4, glAccounts: [{ glAccount: '3000', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_4, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 9, title: 'REBATES (HYU/GEN)', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2270', controlSuffix: '' }, { glAccount: 'G2270', controlSuffix: '' }], purgeCode: PurgeCode.CODE_6, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.AGE },
  { scheduleNumber: 10, title: 'WARRANTY REC', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2260', controlSuffix: 'D' }, { glAccount: 'G2260', controlSuffix: 'D' }, { glAccount: '2265', controlSuffix: 'D' }, { glAccount: '2262', controlSuffix: 'D' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 11, title: 'DEAL SETTLEMENT', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2050', controlSuffix: 'L' }, { glAccount: '2220', controlSuffix: 'L' }, { glAccount: '3020', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 12, title: 'SUBLET REPAIRS', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2460', controlSuffix: 'D' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 13, title: 'SERVICE LOANERS', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2410', controlSuffix: 'S' }, { glAccount: '2411', controlSuffix: '' }, { glAccount: '2312', controlSuffix: '' }, { glAccount: '3130', controlSuffix: 'S' }, { glAccount: '2403L', controlSuffix: 'S' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.TWO, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 14, title: 'TAX & TAG FEES', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '3010', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 15, title: 'EMPLOYEES ADVANCE', scheduleType: ScheduleType.TYPE_2, glAccounts: [{ glAccount: '2940', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_2, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 16, title: 'LEASE TAX', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '3050', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 17, title: 'TRUIST CASH IN BANK', scheduleType: ScheduleType.TYPE_1, glAccounts: [{ glAccount: '2020', controlSuffix: '' }], purgeCode: PurgeCode.CODE_1, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 18, title: 'PREPAID SOR PARTS', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2200P', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 19, title: 'ACCOUNTS RECEIVABLE', scheduleType: ScheduleType.TYPE_5, glAccounts: [{ glAccount: '2200', controlSuffix: 'A' }], purgeCode: PurgeCode.CODE_5, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 20, title: 'ACCRUED OTHER', scheduleType: ScheduleType.TYPE_4, glAccounts: [{ glAccount: '3310', controlSuffix: '' }], purgeCode: PurgeCode.CODE_4, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 21, title: 'WELLSFARGO CASH IN BANK', scheduleType: ScheduleType.TYPE_1, glAccounts: [{ glAccount: '2027', controlSuffix: '' }], purgeCode: PurgeCode.CODE_1, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 22, title: 'JMA PAYABLE', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '3006', controlSuffix: '' }], purgeCode: PurgeCode.CODE_6, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 23, title: 'ACCRUED PAYROLL', scheduleType: ScheduleType.TYPE_4, glAccounts: [{ glAccount: '3210', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_4, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 24, title: 'FINANCE RESERVE', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2620', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 25, title: 'HYU/GEN HOLDBACK', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2280', controlSuffix: 'D' }, { glAccount: 'G2280', controlSuffix: 'D' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 27, title: 'FLOORING ASSISTANCE', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2290', controlSuffix: '' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 28, title: 'F&I CANCELLATION REC', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2640', controlSuffix: 'D' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 29, title: '401K', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '3234', controlSuffix: 'L' }, { glAccount: '3235', controlSuffix: 'L' }, { glAccount: '3238', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_6, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 30, title: 'OTHER NOTES & A/R', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2950', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 31, title: 'A/P HPP', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '3007', controlSuffix: '' }], purgeCode: PurgeCode.CODE_6, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 32, title: 'FSA (FLEXIBLE SPENDING)', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '3239', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_6, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 33, title: 'WHOLESALE D/T A/R', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2240', controlSuffix: 'S' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.TWO, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 34, title: 'WE OWE', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '3090', controlSuffix: 'S' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.TWO, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 35, title: 'ACCOUNTS PAYABLE', scheduleType: ScheduleType.TYPE_4, glAccounts: [{ glAccount: '3001', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_4, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 36, title: 'WORK IN PROCESS', scheduleType: ScheduleType.TYPE_4, glAccounts: [{ glAccount: '2470', controlSuffix: 'D' }], purgeCode: PurgeCode.CODE_4, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 37, title: 'DLR CASH HYU/GEN', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2320', controlSuffix: '' }, { glAccount: 'G2320', controlSuffix: '' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.AGE },
  { scheduleNumber: 38, title: 'INTERNET PARTS SALES', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2259', controlSuffix: 'D' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 39, title: 'A/P OTHER (MISC)', scheduleType: ScheduleType.TYPE_4, glAccounts: [{ glAccount: '3005', controlSuffix: 'L' }], purgeCode: PurgeCode.CODE_4, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 40, title: 'NEW GENESIS INVENTORY', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: 'G2310', controlSuffix: 'S' }, { glAccount: 'G2311', controlSuffix: 'S' }, { glAccount: 'G3100', controlSuffix: 'S' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.TWO, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 41, title: 'USED GENESIS INVENTORY', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: 'G2390', controlSuffix: 'S' }, { glAccount: 'G3110', controlSuffix: 'S' }, { glAccount: 'G2403', controlSuffix: 'S' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.TWO, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 42, title: 'CASH SALES', scheduleType: ScheduleType.TYPE_3, glAccounts: [{ glAccount: '2250', controlSuffix: 'D' }], purgeCode: PurgeCode.CODE_3, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
  { scheduleNumber: 43, title: 'SOUTHERN CASH IN BANK', scheduleType: ScheduleType.TYPE_1, glAccounts: [{ glAccount: '2030', controlSuffix: '' }], purgeCode: PurgeCode.CODE_1, nameDisplay: NameDisplayCode.Y, controlRequired: true, reportSequence: ReportSequence.CONTROL },
];
