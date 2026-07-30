// Golden R0 UI convergence — Phase 1 (global shell).
// Title/breadcrumb resolution for /golden-path/* routes. These screens are
// deliberately NOT added to the primary left-nav taxonomy (see per-screen
// comments in App.tsx / pages/goldenpath/*.tsx: several are "directly
// reachable" certification-journey screens, not steps in the main Accounting
// nav) — this map exists only so the shell header/breadcrumb shows an
// accurate title instead of falling back to a generic one when a user lands
// on one directly.

export interface GoldenPathRouteInfo {
  /** Exact pathname to match (no params). */
  path: string;
  /** Page title shown in the header and as the last breadcrumb crumb. */
  title: string;
  /** Second-level breadcrumb crumb, e.g. "General Ledger". */
  group: string;
}

export const GOLDEN_PATH_ROUTES: GoldenPathRouteInfo[] = [
  { path: '/golden-path/select-entity', title: 'Select Legal Entity', group: 'Golden Path Setup' },
  { path: '/golden-path/org-hierarchy', title: 'Organization Hierarchy', group: 'Golden Path Setup' },
  { path: '/golden-path/role-templates', title: 'Role Templates', group: 'Golden Path Setup' },
  { path: '/golden-path/fiscal', title: 'Fiscal Calendar & Period', group: 'Golden Path Setup' },
  { path: '/golden-path/coa', title: 'Chart of Accounts', group: 'Golden Path Setup' },
  { path: '/golden-path/journal', title: 'Journal Entry', group: 'General Ledger' },
  { path: '/golden-path/gl-search', title: 'GL Search', group: 'General Ledger' },
  { path: '/golden-path/trial-balance', title: 'Trial Balance', group: 'General Ledger' },
  { path: '/golden-path/balance-sheet', title: 'Balance Sheet', group: 'Financial Reports' },
  { path: '/golden-path/income-statement', title: 'Income Statement', group: 'Financial Reports' },
  // S052 — POS Cash Receipts, Cashier Drawers, Blind Close and Over/Short.
  { path: '/golden-path/cash', title: 'Cashier Drawer', group: 'Cashiering' },
  { path: '/golden-path/cash/open', title: 'Open Drawer', group: 'Cashiering' },
  { path: '/golden-path/cash/receive', title: 'Receive Payment', group: 'Cashiering' },
  { path: '/golden-path/cash/receipts', title: 'Receipt Search', group: 'Cashiering' },
];

/** /golden-path/audit/:entityType/:entityId doesn't have a fixed pathname, matched separately. */
export const GOLDEN_PATH_AUDIT_PREFIX = '/golden-path/audit/';

export function resolveGoldenPathRoute(pathname: string): GoldenPathRouteInfo | null {
  if (pathname.startsWith(GOLDEN_PATH_AUDIT_PREFIX)) {
    return { path: pathname, title: 'Audit History', group: 'General Ledger' };
  }
  // S052 param routes — receipts/:id(/print) and drawers/:id/(blind-close|reconciliation).
  if (/^\/golden-path\/cash\/receipts\/[^/]+\/print$/.test(pathname)) {
    return { path: pathname, title: 'Print Receipt', group: 'Cashiering' };
  }
  if (/^\/golden-path\/cash\/receipts\/[^/]+$/.test(pathname)) {
    return { path: pathname, title: 'Receipt Details', group: 'Cashiering' };
  }
  if (/^\/golden-path\/cash\/drawers\/[^/]+\/blind-close$/.test(pathname)) {
    return { path: pathname, title: 'Blind Drawer Close', group: 'Cashiering' };
  }
  if (/^\/golden-path\/cash\/drawers\/[^/]+\/reconciliation$/.test(pathname)) {
    return { path: pathname, title: 'Supervisor Drawer Reconciliation', group: 'Cashiering' };
  }
  return GOLDEN_PATH_ROUTES.find((r) => r.path === pathname) ?? null;
}
