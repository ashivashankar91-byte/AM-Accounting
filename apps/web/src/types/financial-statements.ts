/**
 * Financial Statement Types — AMACC Accounting Cloud
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                    AMACC DATA FLOW ARCHITECTURE                        │
 * │                                                                        │
 * │  External DMS Modules (independent applications):                      │
 * │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
 * │  │  Parts   │ │ Service  │ │ Vehicle  │ │ Body     │ │  F&I     │    │
 * │  │  Module  │ │  Module  │ │  Sales   │ │  Shop    │ │  Module  │    │
 * │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘    │
 * │       │            │            │            │            │            │
 * │       ▼            ▼            ▼            ▼            ▼            │
 * │  POST /api/v2/accounting/{module}-invoice                              │
 * │  (Each module pushes financial transactions TO AMACC)                  │
 * │       │                                                                │
 * │       ▼                                                                │
 * │  ┌─────────────────────────────────────────┐                          │
 * │  │     AMACC General Ledger (GL)           │                          │
 * │  │  Journal Sources:                       │                          │
 * │  │    30 = Service Sales                   │                          │
 * │  │    40 = Parts Department                │                          │
 * │  │    50 = Vehicle Sales (New)             │                          │
 * │  │    55 = Vehicle Sales (Used)            │                          │
 * │  │    60 = Body Shop                       │                          │
 * │  │    70 = F&I Income                      │                          │
 * │  │  Each posting carries the GL account    │                          │
 * │  │  (e.g., 450A = Customer Mech Labor HY)  │                          │
 * │  └────────────────┬────────────────────────┘                          │
 * │                   │                                                    │
 * │                   ▼                                                    │
 * │  ┌─────────────────────────────────────────┐                          │
 * │  │     GL Relate Mapping (gl_relate)       │                          │
 * │  │  Dealer GL Account → OEM Line Number    │                          │
 * │  │  e.g., GL 450A  → OEM Line 450A (P6)   │                          │
 * │  │  e.g., GL 2310  → OEM Line 231A (P1)   │                          │
 * │  │  e.g., GL 0613  → OEM Line 613A (P4)   │                          │
 * │  └────────────────┬────────────────────────┘                          │
 * │                   │                                                    │
 * │                   ▼                                                    │
 * │  ┌─────────────────────────────────────────┐                          │
 * │  │  Financial Statement Data Service       │                          │
 * │  │  GET /{company}/financial-statement/data │                          │
 * │  │  Aggregates GL trial balance by OEM     │                          │
 * │  │  line, computes subtotals/totals,       │                          │
 * │  │  returns structured statement data      │                          │
 * │  └────────────────┬────────────────────────┘                          │
 * │                   │                                                    │
 * │                   ▼                                                    │
 * │  ┌─────────────────────────────────────────┐                          │
 * │  │  FSPreview.tsx (React Frontend)         │                          │
 * │  │  Renders all 7 pages of Hyundai 006     │                          │
 * │  │  with departmental breakdowns           │                          │
 * │  └─────────────────────────────────────────┘                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * KEY PRINCIPLE: AMACC owns NO external module data. It only knows about
 * GL accounts and their balances. When Parts creates an invoice, Parts posts
 * the journal entry to AMACC. When Service closes an RO, Service posts to
 * AMACC. The Financial Statement reads GL balances — it never queries
 * Parts, Service, or Vehicle databases directly.
 */

// ── Supported OEM Franchises ─────────────────────────────────────────────

export type OEMFranchise =
  | 'HYUNDAI' | 'GENESIS' | 'GM' | 'FORD' | 'FCA' | 'TOYOTA' | 'HONDA'
  | 'NISSAN' | 'BMW' | 'MERCEDES' | 'ACURA' | 'AUDI' | 'KIA' | 'SUBARU'
  | 'MAZDA' | 'VW' | 'VOLVO' | 'PORSCHE' | 'LEXUS' | 'INFINITI' | 'JAGUAR';

export const OEM_FS_CODES: Record<OEMFranchise, string> = {
  HYUNDAI: 'HY', GENESIS: 'GA', GM: 'GM', FORD: 'FO', FCA: 'CH',
  TOYOTA: 'TY', HONDA: 'HO', NISSAN: 'NI', BMW: 'BM', MERCEDES: 'MB',
  ACURA: 'AC', AUDI: 'AU', KIA: '60', SUBARU: 'SU', MAZDA: 'MZ',
  VW: 'VW', VOLVO: 'VO', PORSCHE: 'PO', LEXUS: 'LX', INFINITI: 'IN',
  JAGUAR: 'JG',
};

// ── Financial Statement Line Types ───────────────────────────────────────

/** Where the data for a given FS line comes from */
export enum FSLineSource {
  /** Single GL account balance (mapped via gl_relate) */
  GL_BALANCE = 'GL_BALANCE',
  /** Computed as sum of other lines */
  SUBTOTAL = 'SUBTOTAL',
  /** Computed as difference/formula of other lines */
  FORMULA = 'FORMULA',
  /** Percentage calculation (line / line * 100) */
  PERCENT = 'PERCENT',
  /** Manually entered supplemental data (headcount, hours, etc.) */
  SUPPLEMENTAL = 'SUPPLEMENTAL',
  /** Data from external module (unit counts, RO counts) — pushed via API */
  EXTERNAL_MODULE = 'EXTERNAL_MODULE',
  /** Section header (no value) */
  HEADER = 'HEADER',
  /** Blank separator line */
  BLANK = 'BLANK',
}

/** A single line on an OEM financial statement form */
export interface FSFormLine {
  /** Line number as shown on the OEM form (1, 2, 3...) */
  lineNumber: number;
  /** Label shown on the form */
  label: string;
  /** OEM account number(s) — the gl_relate target (e.g., '231A', '450A') */
  oemAccounts: string[];
  /** Where this line's value comes from */
  source: FSLineSource;
  /** For SUBTOTAL: which lines to sum. For FORMULA: expression using line refs */
  formula?: string;
  /** Indentation level for display (0=top, 1=indent, 2=double-indent) */
  indent: number;
  /** Is this a total/subtotal line (renders bold) */
  isTotal: boolean;
  /** Is contra/deduction (value is negated in display) */
  isContra: boolean;
  /** Department code for departmental lines (NEW, USED, SERVICE, PARTS, BODY, ADMIN) */
  department?: Department;
  /** For lines with units (vehicle counts, RO counts) */
  hasUnits?: boolean;
  /** For lines with per-unit calculations */
  hasPerUnit?: boolean;
}

/** Departments as defined by Hyundai 006 form structure */
export enum Department {
  NEW_VEHICLE = 'NEW',
  USED_VEHICLE = 'USED',
  SERVICE = 'SERVICE',
  PARTS = 'PARTS',
  BODY_SHOP = 'BODY',
  ADMIN = 'ADMIN',
  TOTAL = 'TOTAL',
}

/** A page on the OEM financial statement form */
export interface FSFormPage {
  pageNumber: number;
  pageTitle: string;
  /** For departmental pages (P2/P3), which departments are columns */
  departments?: Department[];
  lines: FSFormLine[];
}

/** Complete OEM form definition — defines the structure, NOT the data */
export interface OEMFormDefinition {
  oem: OEMFranchise;
  formCode: string;        // e.g., '006' for Hyundai
  formVersion: string;     // e.g., '2026'
  totalPages: number;
  pages: FSFormPage[];
}

// ── Statement Data (populated from GL) ───────────────────────────────────

/** Computed amount for one OEM line, one time period */
export interface FSLineAmount {
  oemAccount: string;
  month: number;
  ytd: number;
}

/** Computed data for one department column on P2/P3 */
export interface FSDeptColumn {
  department: Department;
  amounts: Record<string, FSLineAmount>; // keyed by oemAccount
}

/**
 * Complete financial statement data returned by the aggregation API.
 *
 * This represents the OUTPUT of:
 *   GL Trial Balance → gl_relate mapping → OEM line aggregation
 *
 * Every dollar here originated from a journal entry posted BY an external
 * module (Parts invoice → GL 460A, Service RO → GL 450A, Vehicle deal → GL 401).
 * AMACC does not query those modules — it reads its own GL.
 */
export interface FinancialStatementData {
  company: number;
  companyName: string;
  oem: OEMFranchise;
  periodStart: string;        // ISO date
  periodEnd: string;          // ISO date
  generatedAt: string;        // ISO timestamp

  /** All OEM line amounts — keyed by OEM account number */
  lineAmounts: Record<string, FSLineAmount>;

  /** Departmental breakdown (for P2/P3 rendering) */
  departmentAmounts: Record<Department, Record<string, FSLineAmount>>;

  /** Supplemental data (manually entered: headcount, tech hours, etc.) */
  supplementalData: Record<string, number>;

  /** External module data (unit counts, RO counts — pushed via API) */
  externalModuleData: Record<string, number>;

  /** Mapping completeness: GL accounts with no OEM relate */
  unmappedAccounts: string[];

  /** Validation warnings */
  warnings: string[];
}

// ── Data Source Documentation ────────────────────────────────────────────
// Each department's data flows into AMACC through specific journal sources:
//
// NEW VEHICLE DEPARTMENT (Pages 1, 2, 4, 5)
//   Source: Vehicle Sales module posts deal closings
//   Journal Source: 50 (New Vehicle Sales)
//   GL Accounts: 231A (New Inventory), 401-522 (model lines), 611A (F&I)
//   → Maps to OEM lines: P4 L1-L78, P5 L1-L21
//
// USED VEHICLE DEPARTMENT (Pages 1, 3, 5)
//   Source: Vehicle Sales module posts used car deals
//   Journal Source: 55 (Used Vehicle Sales)
//   GL Accounts: 239/240 (Used Inventory), 430-442 (used by type), 635/636 (F&I)
//   → Maps to OEM lines: P5 L24-L57
//
// SERVICE DEPARTMENT (Pages 1, 3, 6)
//   Source: Service module posts closed ROs via POST /service-invoice
//   Journal Source: 30 (Service Sales)
//   GL Accounts: 450A-455G (labor by type), 456 (sublet), 459 (misc)
//   → Maps to OEM lines: P6 L1-L25
//
// PARTS & ACCESSORIES DEPARTMENT (Pages 1, 3, 6)
//   Source: Parts module posts invoices via POST /parts-invoice
//   Journal Source: 40 (Parts Department)
//   GL Accounts: 460A-467G (parts by type), 481 (non-auto), 491 (tires)
//   → Maps to OEM lines: P6 L26-L57
//
// BODY SHOP DEPARTMENT (Pages 1, 3, 6)
//   Source: Body Shop module posts closed ROs
//   Journal Source: 60 (Body Shop)
//   GL Accounts: 500-507 (body labor/parts/materials)
//   → Maps to OEM lines: P6 L58-L66
//
// F&I DEPARTMENT (Pages 4, 5)
//   Source: F&I module posts product sales
//   Journal Source: 70 (F&I Income)
//   GL Accounts: 611A/B (finance), 613A/B (insurance), 415A/B (ESC), etc.
//   → Maps to OEM lines: P4 L69-L77, P5 L10-L18, L44-L52
//
// FIXED EXPENSES (Pages 2, 3)
//   Source: AP module posts vendor invoices, Payroll posts wages
//   Journal Sources: 10 (Cash Disbursements), 20 (Payroll)
//   GL Accounts: 11-99 (expense accounts)
//   → Maps to OEM lines: P2/P3 L5-L60
//
// OTHER INCOME/DEDUCTIONS (Page 7)
//   Source: Various — JE, AP, Cash Receipts
//   GL Accounts: 800-859
//   → Maps to OEM lines: P7 L1-L30
