// S010 — Canonical COA skeleton (interim = BP 3.2, PO-signed assumption, UQ-14).
// Pure data + helpers; no I/O. Final content decision is blocked on UQ-14
// (production COA vs NADA-90 vs BP 3.2); this ships the BP 3.2 skeleton.

export interface SeedAccount {
  number: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  normalBalance: 'DR' | 'CR';
  postable: boolean;
  parentNumber: string | null;
  contraReason?: string;
}

export interface SeedManifest {
  version: string;
  accounts: SeedAccount[];
}

// BP 3.2 dealership skeleton. Summary (subtotal) nodes are postable=false.
export const BP_3_2_MANIFEST: SeedManifest = {
  version: 'BP-3.2',
  accounts: [
    // ── Assets ────────────────────────────────────────────────────────────────
    { number: '10000', name: 'Current Assets', type: 'ASSET', normalBalance: 'DR', postable: false, parentNumber: null },
    { number: '11000', name: 'Cash & Equivalents', type: 'ASSET', normalBalance: 'DR', postable: false, parentNumber: '10000' },
    { number: '11100', name: 'Operating Cash', type: 'ASSET', normalBalance: 'DR', postable: true, parentNumber: '11000' },
    { number: '11200', name: 'Petty Cash', type: 'ASSET', normalBalance: 'DR', postable: true, parentNumber: '11000' },
    { number: '12000', name: 'Receivables', type: 'ASSET', normalBalance: 'DR', postable: false, parentNumber: '10000' },
    { number: '12100', name: 'Accounts Receivable', type: 'ASSET', normalBalance: 'DR', postable: true, parentNumber: '12000' },
    { number: '12430', name: 'Allowance for Doubtful Accounts', type: 'ASSET', normalBalance: 'CR', postable: true, parentNumber: '12000', contraReason: 'Contra-asset valuation allowance' },
    { number: '13000', name: 'Inventory', type: 'ASSET', normalBalance: 'DR', postable: false, parentNumber: '10000' },
    { number: '13100', name: 'Vehicle Inventory', type: 'ASSET', normalBalance: 'DR', postable: true, parentNumber: '13000' },
    { number: '13200', name: 'Parts Inventory', type: 'ASSET', normalBalance: 'DR', postable: true, parentNumber: '13000' },
    { number: '15000', name: 'Fixed Assets', type: 'ASSET', normalBalance: 'DR', postable: false, parentNumber: null },
    { number: '15100', name: 'Equipment', type: 'ASSET', normalBalance: 'DR', postable: true, parentNumber: '15000' },
    { number: '15900', name: 'Accumulated Depreciation', type: 'ASSET', normalBalance: 'CR', postable: true, parentNumber: '15000', contraReason: 'Contra-asset accumulated depreciation' },
    // ── Liabilities ───────────────────────────────────────────────────────────
    { number: '20000', name: 'Liabilities', type: 'LIABILITY', normalBalance: 'CR', postable: false, parentNumber: null },
    { number: '21000', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CR', postable: true, parentNumber: '20000' },
    { number: '22000', name: 'Accrued Liabilities', type: 'LIABILITY', normalBalance: 'CR', postable: true, parentNumber: '20000' },
    { number: '23000', name: 'Notes Payable', type: 'LIABILITY', normalBalance: 'CR', postable: true, parentNumber: '20000' },
    // ── Equity ────────────────────────────────────────────────────────────────
    { number: '30000', name: 'Equity', type: 'EQUITY', normalBalance: 'CR', postable: false, parentNumber: null },
    { number: '31000', name: 'Common Stock', type: 'EQUITY', normalBalance: 'CR', postable: true, parentNumber: '30000' },
    { number: '32000', name: 'Retained Earnings', type: 'EQUITY', normalBalance: 'CR', postable: true, parentNumber: '30000' },
    // ── Revenue ───────────────────────────────────────────────────────────────
    { number: '40000', name: 'Revenue', type: 'REVENUE', normalBalance: 'CR', postable: false, parentNumber: null },
    { number: '41000', name: 'Vehicle Sales', type: 'REVENUE', normalBalance: 'CR', postable: true, parentNumber: '40000' },
    { number: '42000', name: 'Parts Sales', type: 'REVENUE', normalBalance: 'CR', postable: true, parentNumber: '40000' },
    { number: '43000', name: 'Service Revenue', type: 'REVENUE', normalBalance: 'CR', postable: true, parentNumber: '40000' },
    // ── Cost of Sales & Expenses ───────────────────────────────────────────────
    { number: '50000', name: 'Cost of Sales', type: 'EXPENSE', normalBalance: 'DR', postable: false, parentNumber: null },
    { number: '51000', name: 'Vehicle Cost of Sales', type: 'EXPENSE', normalBalance: 'DR', postable: true, parentNumber: '50000' },
    { number: '52000', name: 'Parts Cost of Sales', type: 'EXPENSE', normalBalance: 'DR', postable: true, parentNumber: '50000' },
    { number: '60000', name: 'Operating Expenses', type: 'EXPENSE', normalBalance: 'DR', postable: false, parentNumber: null },
    { number: '61000', name: 'Salaries & Wages', type: 'EXPENSE', normalBalance: 'DR', postable: true, parentNumber: '60000' },
    { number: '62000', name: 'Rent', type: 'EXPENSE', normalBalance: 'DR', postable: true, parentNumber: '60000' },
    { number: '63000', name: 'Depreciation Expense', type: 'EXPENSE', normalBalance: 'DR', postable: true, parentNumber: '60000' },
  ],
};

/** Registry of supported manifests by version. */
export const MANIFESTS: Record<string, SeedManifest> = {
  'BP-3.2': BP_3_2_MANIFEST,
};

export const DEFAULT_MANIFEST_VERSION = 'BP-3.2';

/** Manifest accounts ordered so every parent precedes its children (roots first). */
export function orderedForSeed(manifest: SeedManifest): SeedAccount[] {
  const byNumber = new Map(manifest.accounts.map((a) => [a.number, a]));
  const ordered: SeedAccount[] = [];
  const seen = new Set<string>();
  const visit = (a: SeedAccount) => {
    if (seen.has(a.number)) return;
    if (a.parentNumber && byNumber.has(a.parentNumber)) visit(byNumber.get(a.parentNumber)!);
    seen.add(a.number);
    ordered.push(a);
  };
  for (const a of manifest.accounts) visit(a);
  return ordered;
}

/** Canonical fields compared for merge/diff (excludes parentId resolution). */
export function canonicalFields(a: SeedAccount) {
  return { name: a.name, type: a.type, normalBalance: a.normalBalance, postable: a.postable };
}
