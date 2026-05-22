// ══════════════════════════════════════════════════════════════════
// Journal Source Types — Company 01 (Lee Motor Co. — Ford + Nissan)
// Program 6203 "Other Files Sub-Menu" → Journal Source File
// Enriched from Confluence: Deep Analysis §2.5, Batch 3/5, KT 1/5/7/22
// ══════════════════════════════════════════════════════════════════

export enum BalanceMethod {
  DOCUMENT = 'D', // Each reference number (transaction) must net to 0.00
  SOURCE   = 'S', // Entire posting batch must net to 0.00 — used for intercompany sweeps
}

export enum ReservedType {
  THIRTEENTH_MONTH = '13th Month',
  YEAR_END         = 'Year End',
  INTERCOMPANY     = 'Intercompany',
  SYSTEM           = 'System',
}

export enum OEMBrand {
  FORD    = 'Ford',
  NISSAN  = 'Nissan',
  HYUNDAI = 'Hyundai',
  GENESIS = 'Genesis',
  GM      = 'GM',
}

export type SourceTag = 'production' | 'test';

export interface JournalSource {
  companyId: string;
  code: string;                   // 2-char, unique per company (enforced at DB level)
  name: string;                   // Max 30 chars
  balanceMethod: BalanceMethod;   // D=Document (default+safe), S=Source (batch-level)
  countUnits: boolean;
  autoPost: boolean;
  autoPostAtEOM: boolean;         // Source 88: auto-posts at EOM Step 300 if true
  reservedType: ReservedType | null;
  oemBrand: OEMBrand | null;      // Derived from name or explicit tag
  isSystemSource: boolean;        // Derived: reservedType != null or code in protected set
  sourceTag: SourceTag;           // Production vs test — test sources must not autoPost
  lastPostDate: string | null;    // ISO date
  transactionCount: number;       // Lifetime transaction count
  pendingCount: number;           // Count of office.pending_transaction records
  notes: string;
}

// Intercompany configuration (for schedule 02 A/R INTERCOMPANY)
export interface IntercompanyConfig {
  companyId: string;
  intercompanyGLAccount: string;
  partnerCompanyId: string;
  partnerGLAccount: string;
  autoReconcile: boolean;
  reconciliationSchedule: 'Daily' | 'Weekly' | 'Monthly';
}

// ── Protected source codes (cannot be deleted/renamed) ────────────
export const PROTECTED_SOURCE_CODES = new Set(['09', '80', '85', '88', 'TM', 'YE']);

// ── Balance method labels for display ─────────────────────────────
export const BALANCE_METHOD_LABELS: Record<BalanceMethod, string> = {
  [BalanceMethod.DOCUMENT]: 'Document — each transaction must net to $0.00',
  [BalanceMethod.SOURCE]:   'Source — entire posting batch must net to $0.00',
};

// ── OEM brand pairs (Ford=even, Nissan=odd for Lee Motor Co.) ─────
export const OEM_BRAND_PAIRS: { ford: string; nissan: string; purpose: string }[] = [
  { ford: '10', nissan: '11', purpose: 'New Vehicle Sales' },
  { ford: '15', nissan: '16', purpose: 'Wholesale & DTs' },
  { ford: '20', nissan: '21', purpose: 'Used Vehicle Sales' },
  { ford: '30', nissan: '31', purpose: 'Service Sales' },
  { ford: '32', nissan: '33', purpose: 'Parts Sales' },
  { ford: '56', nissan: '57', purpose: 'Cash Receipts' },
  { ford: '70', nissan: '71', purpose: 'Vehicle Purchases' },
];

// ── Seed Data: Lee Motor Co. (Company 01) — 26 sources ───────────

export const LEE_MOTOR_CO_SOURCES: JournalSource[] = [
  // ── Protected / System Sources ──────────────────────────────────
  { companyId: '01', code: '09', name: 'PRIOR MONTH',                balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: null,           isSystemSource: true,  sourceTag: 'production', lastPostDate: '2026-02-28', transactionCount: 14,   pendingCount: 0, notes: 'Posts to PRIOR CLOSED PERIOD ending balances — requires dual authorization + justification. Ripples into current period opening balance.' },
  { companyId: '01', code: '80', name: 'GENERAL JOURNAL',            balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: null,           isSystemSource: true,  sourceTag: 'production', lastPostDate: '2026-03-18', transactionCount: 1520, pendingCount: 0, notes: 'Core infrastructure — do not modify flags. Count Units = No: do NOT post vehicle transactions here.' },
  { companyId: '01', code: '85', name: 'INTERCOMPANY AUTOMATIC',     balanceMethod: BalanceMethod.SOURCE,   countUnits: false, autoPost: false, autoPostAtEOM: false, reservedType: ReservedType.INTERCOMPANY,  oemBrand: null,           isSystemSource: true,  sourceTag: 'production', lastPostDate: '2026-03-01', transactionCount: 48,   pendingCount: 0, notes: 'System-generated intercompany sweep entries. Source-level (S) balancing: batch must net to $0.' },
  { companyId: '01', code: '88', name: 'STANDARD JOURNAL ENTRIES',   balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: true,  autoPostAtEOM: true,  reservedType: null,                       oemBrand: null,           isSystemSource: true,  sourceTag: 'production', lastPostDate: '2026-03-01', transactionCount: 288,  pendingCount: 0, notes: 'Recurring/template entries. Auto-posts at EOM Step 300 when configured.' },
  { companyId: '01', code: 'TM', name: '13TH MONTH ENTRIES',         balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: true,  autoPostAtEOM: false, reservedType: ReservedType.THIRTEENTH_MONTH, oemBrand: null,       isSystemSource: true,  sourceTag: 'production', lastPostDate: null,         transactionCount: 0,    pendingCount: 0, notes: 'Reserved — 13th accounting period only. Reads from snapshot files (gl13thmo/sched13thmo/detail13thmo).' },
  { companyId: '01', code: 'YE', name: 'YEAR END',                   balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: true,  autoPostAtEOM: false, reservedType: ReservedType.YEAR_END,      oemBrand: null,           isSystemSource: true,  sourceTag: 'production', lastPostDate: '2025-12-31', transactionCount: 24,   pendingCount: 0, notes: 'Reserved — year-end close orchestrator only. YR is the true production code; YE is the test equivalent at Auto/Mate Motors.' },

  // ── Ford Sources (even numbers) ─────────────────────────────────
  { companyId: '01', code: '10', name: 'NEW FORD VEHICLE SALES',     balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.FORD,  isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-18', transactionCount: 1842, pendingCount: 0, notes: '' },
  { companyId: '01', code: '15', name: 'FORD WHOLESALE AND DT\'S',   balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.FORD,  isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-12', transactionCount: 320,  pendingCount: 0, notes: '' },
  { companyId: '01', code: '20', name: 'USED FORD VEHICLE SALES',    balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.FORD,  isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-17', transactionCount: 2105, pendingCount: 0, notes: '' },
  { companyId: '01', code: '30', name: 'FORD SERVICE SALES',         balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: false, autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.FORD,  isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-17', transactionCount: 4320, pendingCount: 12, notes: '' },
  { companyId: '01', code: '32', name: 'FORD PARTS SALES',           balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: false, autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.FORD,  isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-18', transactionCount: 5410, pendingCount: 23, notes: '' },
  { companyId: '01', code: '56', name: 'FORD CASH RECEIPTS',         balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: false, autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.FORD,  isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-17', transactionCount: 1950, pendingCount: 5, notes: '' },
  { companyId: '01', code: '70', name: 'FORD VEHICLE PURCHASES',     balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.FORD,  isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-15', transactionCount: 890,  pendingCount: 0, notes: '' },

  // ── Nissan Sources (odd numbers) ────────────────────────────────
  { companyId: '01', code: '11', name: 'NEW NISSAN VEHICLE SALES',   balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.NISSAN, isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-15', transactionCount: 1106, pendingCount: 0, notes: '' },
  { companyId: '01', code: '16', name: 'NISSAN WHOLESALE AND DT\'S', balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.NISSAN, isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-10', transactionCount: 185,  pendingCount: 0, notes: '' },
  { companyId: '01', code: '21', name: 'USED NISSAN VEHICLE SALES',  balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.NISSAN, isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-16', transactionCount: 1320, pendingCount: 0, notes: '' },
  { companyId: '01', code: '31', name: 'NISSAN SERVICE SALES',       balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: false, autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.NISSAN, isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-17', transactionCount: 2890, pendingCount: 8, notes: '' },
  { companyId: '01', code: '33', name: 'NISSAN PARTS SALES',         balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: false, autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.NISSAN, isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-18', transactionCount: 3270, pendingCount: 15, notes: '' },
  { companyId: '01', code: '57', name: 'NISSAN CASH RECEIPTS',       balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: false, autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.NISSAN, isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-16', transactionCount: 1180, pendingCount: 3, notes: '' },
  { companyId: '01', code: '71', name: 'NISSAN VEHICLE PURCHASES',   balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: OEMBrand.NISSAN, isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-13', transactionCount: 540,  pendingCount: 0, notes: '' },

  // ── Shared Sources (brand-agnostic) ─────────────────────────────
  { companyId: '01', code: '25', name: 'RENTAL INCOME',              balanceMethod: BalanceMethod.DOCUMENT, countUnits: true,  autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: null,           isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-14', transactionCount: 460,  pendingCount: 0, notes: '' },
  { companyId: '01', code: '40', name: 'PAYROLL',                    balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: false, autoPostAtEOM: false, reservedType: null,                       oemBrand: null,           isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-02-28', transactionCount: 312,  pendingCount: 0, notes: 'Controller must approve before posting' },
  { companyId: '01', code: '58', name: 'WARRANTY CREDITS',           balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: false, autoPostAtEOM: false, reservedType: null,                       oemBrand: null,           isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-14', transactionCount: 680,  pendingCount: 2, notes: 'Shared across OEMs — not brand-split' },
  { companyId: '01', code: '60', name: 'CASH DISBURSEMENTS',         balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: null,           isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-18', transactionCount: 3890, pendingCount: 0, notes: '' },
  { companyId: '01', code: '75', name: 'GENERAL PURCHASES',          balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: null,           isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-18', transactionCount: 2150, pendingCount: 0, notes: '' },
  { companyId: '01', code: '77', name: 'OPEN ITEM',                  balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: null,           isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-11', transactionCount: 430,  pendingCount: 0, notes: '' },
  { companyId: '01', code: 'FC', name: 'FINANCE CHARGE',             balanceMethod: BalanceMethod.DOCUMENT, countUnits: false, autoPost: true,  autoPostAtEOM: false, reservedType: null,                       oemBrand: null,           isSystemSource: false, sourceTag: 'production', lastPostDate: '2026-03-15', transactionCount: 156,  pendingCount: 0, notes: 'Alpha code — system-calculated. Missing source permission blocks month-close (ref AMMAINT-29975).' },
];

// ── Brand filter for UI ───────────────────────────────────────────
export type BrandFilter = 'all' | 'ford' | 'nissan' | 'shared' | 'reserved';

export function getSourceBrandFilter(s: JournalSource): BrandFilter {
  if (s.reservedType || s.isSystemSource) return 'reserved';
  if (s.oemBrand === OEMBrand.FORD) return 'ford';
  if (s.oemBrand === OEMBrand.NISSAN) return 'nissan';
  return 'shared';
}

// ── Validation helpers ────────────────────────────────────────────

export interface SourceValidationIssue {
  code: string;
  severity: 'warning' | 'error' | 'info';
  message: string;
}

export function validateSources(sources: JournalSource[]): SourceValidationIssue[] {
  const issues: SourceValidationIssue[] = [];

  // Check for missing brand pairs
  for (const pair of OEM_BRAND_PAIRS) {
    const hasFord = sources.some(s => s.code === pair.ford);
    const hasNissan = sources.some(s => s.code === pair.nissan);
    if (hasFord && !hasNissan) {
      issues.push({ code: pair.ford, severity: 'warning', message: `No Nissan equivalent for source ${pair.ford} (${pair.purpose}). Expected: ${pair.nissan}` });
    }
    if (hasNissan && !hasFord) {
      issues.push({ code: pair.nissan, severity: 'warning', message: `No Ford equivalent for source ${pair.nissan} (${pair.purpose}). Expected: ${pair.ford}` });
    }
  }

  // Check for payroll with zero posts this month (March 2026)
  const payroll = sources.find(s => s.code === '40');
  if (payroll && payroll.lastPostDate && !payroll.lastPostDate.startsWith('2026-03')) {
    issues.push({ code: '40', severity: 'warning', message: 'Source 40 (Payroll) has 0 transactions this month. Verify payroll is posted.' });
  }

  // Duplicate name detection (Confluence §1.6: COBOL ISAM allows duplicate codes)
  const nameMap = new Map<string, string[]>();
  for (const s of sources) {
    const key = s.name.toUpperCase();
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key)!.push(s.code);
  }
  for (const [name, codes] of nameMap) {
    if (codes.length > 1) {
      issues.push({ code: codes[0], severity: 'warning', message: `Duplicate source name "${name}" on codes: ${codes.join(', ')}` });
    }
  }

  // Duplicate code detection (Confluence §1.6: ISAM does NOT enforce uniqueness)
  const codeMap = new Map<string, number>();
  for (const s of sources) {
    codeMap.set(s.code, (codeMap.get(s.code) ?? 0) + 1);
  }
  for (const [code, count] of codeMap) {
    if (count > 1) {
      issues.push({ code, severity: 'error', message: `Duplicate source code "${code}" appears ${count} times. Must resolve before migration — DB enforces unique constraint.` });
    }
  }

  // TEST sources with auto-post = true (Confluence §1.5: YE auto-posts in production)
  for (const s of sources) {
    if (s.name.toUpperCase().includes('TEST') && s.autoPost) {
      issues.push({ code: s.code, severity: 'error', message: `Source "${s.name}" contains TEST in name but has Auto-Post = Yes. Test sources must not auto-post.` });
    }
  }

  // UNKNOWN sources with auto-post (Confluence §8 security checklist)
  for (const s of sources) {
    if (s.name.toUpperCase().includes('UNKNOWN') && s.autoPost) {
      issues.push({ code: s.code, severity: 'error', message: `Source "${s.name}" is UNKNOWN but has Auto-Post = Yes. Block auto-post on unidentified sources.` });
    }
  }

  // Source-level balancing warning (Confluence §1.1: S allows unbalanced individual transactions)
  for (const s of sources) {
    if (s.balanceMethod === BalanceMethod.SOURCE) {
      issues.push({ code: s.code, severity: 'info', message: `Source uses batch-level (S) balancing. Individual transactions may be unbalanced — only the entire batch must net to $0.` });
    }
  }

  // Source 09 prior-period posting awareness (Confluence §1.2)
  const src09 = sources.find(s => s.code === '09');
  if (src09) {
    issues.push({ code: '09', severity: 'info', message: 'Posts to PRIOR CLOSED PERIOD ending balances, not current month. Recalculates current period opening balance after post.' });
  }

  // Pending transactions stuck > 15 min detection placeholder
  for (const s of sources) {
    if (!s.autoPost && s.pendingCount > 0) {
      issues.push({ code: s.code, severity: 'info', message: `${s.pendingCount} pending transactions awaiting review. Batches stuck > 15 min will trigger alert.` });
    }
  }

  return issues;
}
