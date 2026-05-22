// ══════════════════════════════════════════════════════════════════
// System Settings Types — SYSUPCHO Module
// Company Config · Warranty Remittance · RBAC · Service EOD · DealerCONNECT
// ══════════════════════════════════════════════════════════════════

// ── Company Config (Module 1) ─────────────────────────────────────

export enum AccountTypeCode {
  Y_HYUNDAI     = 'Y',
  F_FORD        = 'F',
  G_GM          = 'G',
  T_TOYOTA      = 'T',
  N_NISSAN      = 'N',
  S_STELLANTIS  = 'S',
  V_VOLVO       = 'V',
  I_INDEPENDENT = 'I',
  M_MULTI       = 'M',
}

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  Y: 'Hyundai',
  F: 'Ford',
  G: 'GM',
  T: 'Toyota',
  N: 'Nissan',
  S: 'Stellantis',
  V: 'Volvo',
  I: 'Independent',
  M: 'Multi-Brand',
};

export enum JournalPrintCode {
  PRINT_PREVIEW   = 'P',
  EDIT_CHECK_ONLY = 'E',
}

export const JOURNAL_PRINT_LABELS: Record<string, string> = {
  P: 'Print Preview',
  E: 'Edit Check Only',
};

export enum LIFOMethod {
  NONE             = 'None',
  LINK_CHAIN       = 'Link Chain',
  DOUBLE_EXTENSION = 'Double Extension',
}

export interface AccountingCompanyConfig {
  companyId: string;
  companyName: string;
  accountTypeCode: AccountTypeCode;
  phoneAreaCode: string;
  transactionAudit: boolean;
  ncm20DataSend: boolean;
  ncmDealerCode: string | null;
  fiscalYearBegins: number;
  lastCloseMonth: string;       // ISO date
  lastCloseTrack: string;
  cutoffDate: string;           // ISO date
  postAheadMonths: number;
  useDecimalInTransactions: boolean;
  suppressZeroYTDOnTrialBalance: boolean;
  transactionJournalPrintCode: JournalPrintCode;
  lifoValuationMethod: LIFOMethod;
}

// ── Warranty Remittance (Module 4) ────────────────────────────────

export interface RepairTypeMapping {
  code: string;
  description: string;
  warrantyGLAccount: string;
  smallBalanceWriteoffMax: number;
  writeOffCRBalance: boolean;
  writeOffGLAccount: string;
  claimType: string | null;
}

export interface WarrantyRemittanceConfig {
  companyId: string;
  manufacturerCode: string;
  manufacturerName: string;
  sourceJournal: number;
  factoryReceivableAccount: string;
  vendorNumber: string;
  repairTypeMappings: RepairTypeMapping[];
}

// Ford Motors seed repair types (Code: FM)
export const FORD_REPAIR_TYPES: RepairTypeMapping[] = [
  { code: '11', description: 'Vehicle Coverages',           warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '65400', claimType: null },
  { code: '12', description: 'Pre-Delivery',                warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '65400', claimType: null },
  { code: '13', description: 'Policy',                      warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '03303', claimType: null },
  { code: '14', description: 'Mis-Built',                   warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '65400', claimType: null },
  { code: '21', description: 'Service Parts',               warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '66400', claimType: null },
  { code: '22', description: 'Over the Counter Parts',      warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '66400', claimType: null },
  { code: '23', description: 'Accessories',                 warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '66400', claimType: null },
  { code: '31', description: 'Field Service Action',        warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '65400', claimType: null },
  { code: '51', description: 'Transit Damage',              warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '65400', claimType: null },
  { code: '61', description: 'Fleet',                       warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '65400', claimType: null },
  { code: '71', description: 'Extended Service Contra',     warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '65400', claimType: null },
  { code: 'A1', description: 'Appeal',                      warrantyGLAccount: '22200', smallBalanceWriteoffMax: 15.00, writeOffCRBalance: false, writeOffGLAccount: '65400', claimType: null },
];

// ── Access Control / RBAC (Modules 5 & 6) ─────────────────────────

export interface SchedulePermission {
  scheduleNumber: number;
  canView: boolean;
  canPrint: boolean;
  canEdit: boolean;
}

export interface JournalSourcePermission {
  sourceCode: number;
  sourceName: string;
  canPost: boolean;
  canReverse: boolean;
  requiresDualApproval: boolean;
}

export interface AccountingRole {
  roleId: string;
  roleName: string;
  companyId: string;
  userCount: number;
  schedulePermissions: SchedulePermission[];
  journalSourcePermissions: JournalSourcePermission[];
}

// Default journal source codes
export const JOURNAL_SOURCE_CODES: { code: number; name: string; description: string }[] = [
  { code: 10, name: 'Parts Invoices',          description: 'Parts counter and wholesale invoices' },
  { code: 20, name: 'Service Repair Orders',   description: 'Service department RO postings' },
  { code: 30, name: 'Vehicle Deals / F&I',     description: 'Deal posting and F&I product entries' },
  { code: 50, name: 'Payroll Postings',         description: 'Payroll journal entries' },
  { code: 58, name: 'Recurring Manual',         description: 'Floorplan interest, insurance accruals' },
  { code: 88, name: 'Standard / Template',      description: 'Period-end closing templates' },
  { code: 99, name: 'System-Generated',         description: 'Auto-posted — read-only, no manual post' },
];

// Default role templates
export const DEFAULT_ROLE_TEMPLATES: Omit<AccountingRole, 'companyId' | 'userCount'>[] = [
  {
    roleId: 'controller', roleName: 'Controller',
    schedulePermissions: [], // Full access — generated dynamically
    journalSourcePermissions: JOURNAL_SOURCE_CODES.map(s => ({
      sourceCode: s.code, sourceName: s.name, canPost: s.code !== 99, canReverse: s.code !== 99, requiresDualApproval: false,
    })),
  },
  {
    roleId: 'acct-clerk', roleName: 'Accounting Clerk',
    schedulePermissions: [], // Operational schedules only — no payroll
    journalSourcePermissions: JOURNAL_SOURCE_CODES.map(s => ({
      sourceCode: s.code, sourceName: s.name,
      canPost: [10, 20, 58].includes(s.code),
      canReverse: false,
      requiresDualApproval: false,
    })),
  },
  {
    roleId: 'payroll-admin', roleName: 'Payroll Admin',
    schedulePermissions: [],
    journalSourcePermissions: JOURNAL_SOURCE_CODES.map(s => ({
      sourceCode: s.code, sourceName: s.name,
      canPost: s.code === 50,
      canReverse: s.code === 50,
      requiresDualApproval: false,
    })),
  },
  {
    roleId: 'auditor', roleName: 'Auditor',
    schedulePermissions: [],
    journalSourcePermissions: JOURNAL_SOURCE_CODES.map(s => ({
      sourceCode: s.code, sourceName: s.name, canPost: false, canReverse: false, requiresDualApproval: false,
    })),
  },
  {
    roleId: 'svc-manager', roleName: 'Service Manager',
    schedulePermissions: [],
    journalSourcePermissions: JOURNAL_SOURCE_CODES.map(s => ({
      sourceCode: s.code, sourceName: s.name,
      canPost: s.code === 20,
      canReverse: false,
      requiresDualApproval: false,
    })),
  },
];

// Payroll-restricted schedule numbers
export const PAYROLL_SCHEDULE_NUMBERS = new Set([2, 6, 15, 23, 24, 29, 32]);

// Service-visible schedule numbers
export const SERVICE_SCHEDULE_NUMBERS = new Set([12, 13, 36, 38]);

// ── Service EOD (Module 7) ────────────────────────────────────────

export enum ServiceEODMethod {
  MANUAL    = 'M',
  AUTOMATIC = 'A',
  BATCH     = 'B',
}

export const EOD_METHOD_LABELS: Record<string, string> = {
  M: 'Manual',
  A: 'Automatic',
  B: 'Batch (Nightly)',
};

export interface ServiceEODConfig {
  companyId: string;
  eodMethod: ServiceEODMethod;
  autoRunTime: string | null;      // HH:MM
  lastRunTimestamp: string | null;  // ISO datetime
  lastRunStatus: 'success' | 'failed' | null;
  notifyUserIds: string[];
}

// ── DealerCONNECT (Module 8 — Stellantis only) ───────────────────

export interface DealerConnectConfig {
  companyId: string;
  dealerCode: string;
  username: string;
  partsOrderingEnabled: boolean;
  warrantySubmissionEnabled: boolean;
  vehicleOrderingEnabled: boolean;
  lastSyncTimestamp: string | null;
  syncStatus: 'connected' | 'error' | 'not_configured';
}

// ── Lee Hyundai Seed Data ─────────────────────────────────────────

export const LEE_HYUNDAI_CONFIG: AccountingCompanyConfig = {
  companyId: '03',
  companyName: 'LEE HYUNDAI INC.',
  accountTypeCode: AccountTypeCode.Y_HYUNDAI,
  phoneAreaCode: '770',
  transactionAudit: true,
  ncm20DataSend: false,
  ncmDealerCode: null,
  fiscalYearBegins: 1,
  lastCloseMonth: '2026-02-28',
  lastCloseTrack: '000',
  cutoffDate: '2026-02-28',
  postAheadMonths: 4,
  useDecimalInTransactions: true,
  suppressZeroYTDOnTrialBalance: true,
  transactionJournalPrintCode: JournalPrintCode.PRINT_PREVIEW,
  lifoValuationMethod: LIFOMethod.NONE,
};

export const LEE_HYUNDAI_EOD: ServiceEODConfig = {
  companyId: '03',
  eodMethod: ServiceEODMethod.AUTOMATIC,
  autoRunTime: '23:30',
  lastRunTimestamp: '2026-03-17T23:30:12Z',
  lastRunStatus: 'success',
  notifyUserIds: ['svc-mgr-kim', 'controller-park'],
};

export const LEE_HYUNDAI_ROLES: AccountingRole[] = [
  {
    roleId: 'controller', roleName: 'Controller', companyId: '03', userCount: 2,
    schedulePermissions: [],
    journalSourcePermissions: JOURNAL_SOURCE_CODES.map(s => ({
      sourceCode: s.code, sourceName: s.name, canPost: s.code !== 99, canReverse: s.code !== 99, requiresDualApproval: false,
    })),
  },
  {
    roleId: 'acct-clerk', roleName: 'Accounting Clerk', companyId: '03', userCount: 3,
    schedulePermissions: [],
    journalSourcePermissions: JOURNAL_SOURCE_CODES.map(s => ({
      sourceCode: s.code, sourceName: s.name, canPost: [10, 20, 58].includes(s.code), canReverse: false, requiresDualApproval: false,
    })),
  },
  {
    roleId: 'payroll-admin', roleName: 'Payroll Admin', companyId: '03', userCount: 1,
    schedulePermissions: [],
    journalSourcePermissions: JOURNAL_SOURCE_CODES.map(s => ({
      sourceCode: s.code, sourceName: s.name, canPost: s.code === 50, canReverse: s.code === 50, requiresDualApproval: false,
    })),
  },
  {
    roleId: 'auditor', roleName: 'Auditor', companyId: '03', userCount: 1,
    schedulePermissions: [],
    journalSourcePermissions: JOURNAL_SOURCE_CODES.map(s => ({
      sourceCode: s.code, sourceName: s.name, canPost: false, canReverse: false, requiresDualApproval: false,
    })),
  },
  {
    roleId: 'svc-manager', roleName: 'Service Manager', companyId: '03', userCount: 2,
    schedulePermissions: [],
    journalSourcePermissions: JOURNAL_SOURCE_CODES.map(s => ({
      sourceCode: s.code, sourceName: s.name, canPost: s.code === 20, canReverse: false, requiresDualApproval: false,
    })),
  },
];

// Month labels
export const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
