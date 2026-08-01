import { useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard, BookOpen, CreditCard, Users, Calendar,
  Wrench, Settings as SettingsIcon, Terminal, Search, Bell, Landmark,
} from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
import { useAuth } from './auth/AuthContext';
import { NavRail, EXPANDED_WIDTH, COLLAPSED_WIDTH } from './components/shell/NavRail';
import { Breadcrumb } from './components/shell/Breadcrumb';
import { ContextBar } from './components/shell/ContextBar';
import { resolveGoldenPathRoute } from './components/shell/goldenPathRoutes';
import type { AppModule } from './components/shell/types';
import Dashboard from './pages/Dashboard';
import GeneralLedger from './pages/GeneralLedger';
import EOMClose from './pages/EOMClose';
import Payroll from './pages/Payroll';
import Reconciliation from './pages/Reconciliation';
import Agents from './pages/Agents';
import Tenants from './pages/Tenants';
import Analytics from './pages/Analytics';
import FSPreview from './pages/FSPreview';
import Approvals from './pages/Approvals';
import Onboarding from './pages/Onboarding';
import Transactions from './pages/Transactions';
import Schedules from './pages/Schedules';
import AccountsPayable from './pages/AccountsPayable';
import CashReceipts from './pages/CashReceipts';
import Reports from './pages/Reports';
import JournalSources from './pages/JournalSources';
import Setup from './pages/Setup';
import ChartOfAccounts from './pages/ChartOfAccounts';
import PurchaseOrders from './pages/PurchaseOrders';
import Intercompany from './pages/Intercompany';
import GroupDashboard from './pages/GroupDashboard';
import WarrantyDCS from './pages/WarrantyDCS';
import YearEnd from './pages/YearEnd';
import Utilities from './pages/Utilities';
import BankDeposits from './pages/BankDeposits';
import StandardJournalEntries from './pages/StandardJournalEntries';
import VehicleInventory from './pages/VehicleInventory';
import SystemSettings from './pages/SystemSettings';
import AccountingCommandCenter from './pages/AccountingCommandCenter';
import FinancialStatements from './pages/FinancialStatements';
import T1Sidebar from './components/T1Sidebar';
import Settings from './pages/Settings';
import QueryExplorer from './pages/QueryExplorer';
import MobileApprovals from './pages/MobileApprovals';
import GoldenPathLogin from './pages/goldenpath/Login';
import GoldenPathProtectedRoute from './pages/goldenpath/ProtectedRoute';
import GoldenPathSelectEntity from './pages/goldenpath/SelectEntity';
import GoldenPathOrgHierarchy from './pages/goldenpath/OrgHierarchy';
import GoldenPathEntityElimination from './pages/goldenpath/EntityElimination';
import GoldenPathRoleTemplates from './pages/goldenpath/RoleTemplates';
import GoldenPathFiscalPeriod from './pages/goldenpath/FiscalPeriod';
import GoldenPathChartOfAccounts from './pages/goldenpath/ChartOfAccounts';
import GoldenPathJournalWorkflow from './pages/goldenpath/JournalWorkflow';
import GoldenPathAuditHistory from './pages/goldenpath/AuditHistory';
import GoldenPathTrialBalance from './pages/goldenpath/TrialBalance';
import GoldenPathGLSearch from './pages/goldenpath/GLSearch';
import GoldenPathBalanceSheet from './pages/goldenpath/BalanceSheet';
import GoldenPathIncomeStatement from './pages/goldenpath/IncomeStatement';
// S052 — POS Cash Receipts, Cashier Drawers, Blind Close and Over/Short.
import CashDrawerHome from './pages/goldenpath/cash/DrawerHome';
import CashOpenDrawer from './pages/goldenpath/cash/OpenDrawer';
import CashReceivePayment from './pages/goldenpath/cash/ReceivePayment';
import CashReceiptSearch from './pages/goldenpath/cash/ReceiptSearch';
import CashReceiptDetails from './pages/goldenpath/cash/ReceiptDetails';
import CashReceiptPrint from './pages/goldenpath/cash/ReceiptPrint';
import CashBlindClose from './pages/goldenpath/cash/BlindClose';
import CashSupervisorReconciliation from './pages/goldenpath/cash/SupervisorReconciliation';
import AnalysisCodeRegistry from './pages/accounting/admin/AnalysisCodeRegistry';
// CE-10 — Tax (S124 Certified Tax Engine Adapter + S125 Regulatory Fee Tables).
import TaxAdapterStatus from './pages/accounting/tax/TaxAdapterStatus';
import TaxJurisdictionAdmin from './pages/accounting/tax/TaxJurisdictionAdmin';
import TaxExemptions from './pages/accounting/tax/TaxExemptions';
import TaxResultInquiry from './pages/accounting/tax/TaxResultInquiry';
import TaxExceptionQueue from './pages/accounting/tax/TaxExceptionQueue';
import TaxReconciliation from './pages/accounting/tax/TaxReconciliation';
import TaxFeeAdmin from './pages/accounting/tax/TaxFeeAdmin';
import GoldenPathPostingRules from './pages/goldenpath/PostingRules';
import GoldenPathPostingExecutions from './pages/goldenpath/PostingExecutions';
import GoldenPathPostingRecoveryQueue from './pages/goldenpath/PostingRecoveryQueue';
import GoldenPathPostingRecoveryCaseDetail from './pages/goldenpath/PostingRecoveryCaseDetail';
import TrialBalance from './pages/TrialBalance';
import ManualJournalEntry from './pages/ManualJournalEntry';
import AMACCSync from './pages/AMACCSync';
import MLDashboard from './pages/MLDashboard';
import GLAccountInquiry from './pages/GLAccountInquiry';
import JournalEntryManagement from './pages/JournalEntryManagement';
import EOMCloseDashboard from './pages/EOMCloseDashboard';
import JournalEntryList from './pages/accounting/JournalEntryList';
import JournalEntry from './pages/accounting/JournalEntry';
import JournalTemplateList from './pages/accounting/JournalTemplateList';
import JournalTemplateEdit from './pages/accounting/JournalTemplateEdit';
import RecurringJournalTemplates from './pages/accounting/RecurringJournalTemplates';
import RecurringJournalTemplateEditor from './pages/accounting/RecurringJournalTemplateEditor';
import VendorMaintenance from './pages/accounting/VendorMaintenance';
import VendorInvoices from './pages/accounting/VendorInvoices';
import ApprovalMatrixConfig from './pages/accounting/ApprovalMatrixConfig';
import CustomerMaintenance from './pages/accounting/CustomerMaintenance';
import VehicleTransfers from './pages/accounting/VehicleTransfers';
import APWorkflow from './pages/accounting/AccountsPayable';
import ARWorkflow from './pages/accounting/AccountsReceivable';
import BankReconWorkflow from './pages/accounting/BankReconciliation';
import PayrollWorkflow from './pages/accounting/PayrollProcessing';
import EOMWorkflow from './pages/accounting/EndOfMonthClose';
import FSWorkflow from './pages/accounting/FinancialStatements';
import POWorkflow from './pages/accounting/PurchaseOrders';
import RecurringWorkflow from './pages/accounting/RecurringEntries';
import DashboardWorkflow from './pages/accounting/FinancialDashboard';
import DayEndClose from './pages/service/DayEndClose';
import InquiryMenu from './pages/accounting/InquiryMenu';
import ScheduleInquiry from './pages/accounting/ScheduleInquiry';
import ScheduleOpenItems from './pages/accounting/ScheduleOpenItems';
import TransactionInquiry from './pages/accounting/TransactionInquiry';
// FINAL-R0 / UXMAP-02 (Golden R0 UI convergence): the /accounting/inquiry/gl
// route previously rendered the legacy prototype at
// ./pages/accounting/GLInquiry.tsx, which called the legacy gl-service
// /api/v1/gl/inquiry endpoint -- disconnected from the certified S220
// coa-service contract. Rewired to the goldenpath implementation, which
// consumes GET /api/v1/coa/inquiry/accounts/:id/activity only. The legacy
// file is left on disk, unrouted (isolated, not deleted).
import GLInquiry from './pages/goldenpath/GLInquiry';
import MFGDCSCommunications from './pages/accounting/MFGDCSCommunications';
import PartsGLAccounts from './pages/accounting/admin/PartsGLAccounts';
import ServiceGLAccounts from './pages/accounting/admin/ServiceGLAccounts';
import PeriodControl from './pages/accounting/admin/PeriodControl';
import StatementMetadata from './pages/accounting/admin/StatementMetadata';
import TechnicianMasterFile from './pages/service/TechnicianMasterFile';
import ServiceHistory from './pages/service/ServiceHistory';
import ReportMate from './pages/reporting/ReportMate';
import DocMate from './pages/reporting/DocMate';
import GLTrialBalance from './pages/accounting/reports/GLTrialBalance';
import AnnualGLSummary from './pages/accounting/reports/AnnualGLSummary';
import DetailedGLPL from './pages/accounting/reports/DetailedGLPL';
import MonthlyTransJournals from './pages/accounting/reports/MonthlyTransJournals';
import AutopostReport from './pages/accounting/reports/AutopostReport';
import CrossPostReport from './pages/accounting/reports/CrossPostReport';
import WorkersCompReport from './pages/payroll/reports/WorkersCompReport';
import EmployeeHistoryReport from './pages/payroll/reports/EmployeeHistoryReport';
import EarningsDeductionsReport from './pages/payroll/reports/EarningsDeductionsReport';
import TaxSummaryReport from './pages/payroll/reports/TaxSummaryReport';
import FourOhOneKReport from './pages/payroll/reports/FourOhOneKReport';
import EMPOWERExport from './pages/payroll/reports/EMPOWERExport';
import EmployeeWageExport from './pages/payroll/reports/EmployeeWageExport';
import PayrollPositivePay from './pages/payroll/reports/PayrollPositivePay';
import NACHAStandalone from './pages/payroll/reports/NACHAStandalone';
import EmployeeInfoReport from './pages/payroll/reports/EmployeeInfoReport';
import GovernmentWageReport from './pages/payroll/reports/GovernmentWageReport';

// ─── Module definitions ───────────────────────────────────────────────────────
// Types moved to components/shell/types.ts (shared with NavRail).

const MODULES: AppModule[] = [
  {
    key: 'dashboard',
    Icon: LayoutDashboard,
    label: 'Dashboard',
    defaultPath: '/accounting/dashboard',
    matchPrefixes: ['/accounting/dashboard', '/command-center', '/group-dashboard', '/'],
    sections: [
      { title: 'Overview', items: [
        { path: '/accounting/dashboard', label: 'Financial Dashboard' },
        { path: '/command-center',       label: 'Command Center' },
        { path: '/group-dashboard',      label: 'Group Dashboard' },
      ]},
    ],
  },
  {
    key: 'gl',
    Icon: BookOpen,
    label: 'General Ledger',
    defaultPath: '/accounting/gl',
    matchPrefixes: [
      // NOTE: was '/accounting/reports/gl' — only matched the one leaf path
      // that happens to literally start with "gl" (gl-trial-balance), and
      // even that failed the startsWith(p + '/') check since there's no
      // slash after "gl" (it's "gl-trial-balance", a hyphen). The other 5
      // GL Reports items (annual-gl-summary, detailed-gl-pl, etc.) never
      // matched at all. Because getActiveModuleKey() falls back to
      // 'dashboard' when nothing matches, clicking any GL Reports link
      // collapsed the whole GL section in NavRail (it stopped being the
      // active module) instead of staying expanded — see also the
      // items-based fallback added to getActiveModuleKey() below as a
      // second line of defense against this class of drift.
      '/accounting/gl', '/accounting/inquiry', '/accounting/reports',
      '/gl', '/trial-balance', '/manual-entry', '/coa', '/standard-journal-entries',
      '/accounting/journals', '/accounting/schedules',
    ],
    sections: [
      { title: 'Journal Entry', items: [
        { path: '/accounting/gl',           label: 'Journal Entries' },
        { path: '/accounting/gl/entry',     label: 'New Entry' },
        { path: '/accounting/gl/templates', label: 'Templates' },
        { path: '/accounting/journals/templates', label: 'Recurring Templates (S032)' },
      ]},
      { title: 'Inquiry', items: [
        { path: '/accounting/inquiry',                label: 'Inquiry Menu' },
        { path: '/accounting/inquiry/gl',             label: 'GL Inquiry' },
        { path: '/accounting/inquiry/schedules',      label: 'Schedule Inquiry' },
        { path: '/accounting/inquiry/transactions',   label: 'Transaction Inquiry' },
        { path: '/accounting/schedules/open-items',   label: 'Schedule Open Items' },
      ]},
      { title: 'Posting Engine', items: [
        { path: '/accounting/gl/posting-rules',       label: 'Posting Rules' },
        { path: '/accounting/gl/posting-executions',  label: 'Posting Executions' },
        { path: '/accounting/gl/posting-recovery',    label: 'Posting Recovery (DLQ)' },
      ]},
      { title: 'GL Reports', items: [
        { path: '/accounting/reports/gl-trial-balance',     label: 'Trial Balance' },
        { path: '/accounting/reports/annual-gl-summary',    label: 'Annual GL Summary' },
        { path: '/accounting/reports/detailed-gl-pl',       label: 'Detailed GL / P&L' },
        { path: '/accounting/reports/monthly-trans-journals', label: 'Monthly Journals' },
        { path: '/accounting/reports/autopost',             label: 'Autopost Report' },
        { path: '/accounting/reports/cross-post',           label: 'Cross Post Report' },
      ]},
    ],
  },
  {
    key: 'apar',
    Icon: CreditCard,
    label: 'AP / AR',
    defaultPath: '/accounting/ar',
    matchPrefixes: [
      '/accounting/ap', '/accounting/ar', '/accounting/bank-recon',
      '/accounting/purchase-orders', '/ap', '/cash-receipts', '/bank-deposits',
      '/vendors', '/po', '/accounting/cash',
    ],
    sections: [
      { title: 'Accounts Receivable', items: [
        { path: '/accounting/ar',           label: 'Cash Receipts' },
        { path: '/accounting/ar/customers', label: 'Customer Master' },
      ]},
      { title: 'Cashiering (S052)', items: [
        { path: '/accounting/cash',          label: 'Cashier Drawer' },
        { path: '/accounting/cash/receive',  label: 'Cash Receipts (POS)' },
        { path: '/accounting/cash/receipts', label: 'Receipt Search' },
      ]},
      { title: 'Accounts Payable', items: [
        { path: '/accounting/ap',                 label: 'AP Invoices' },
        { path: '/accounting/ap/invoices',         label: 'Vendor Invoice Match (S039)' },
        { path: '/accounting/ap/approval-matrix',  label: 'Approval Matrix (S041)' },
        { path: '/accounting/ap/vendors',          label: 'Vendor Master' },
      ]},
      { title: 'Banking', items: [
        { path: '/accounting/bank-recon',       label: 'Bank Reconciliation' },
        { path: '/accounting/purchase-orders',  label: 'Purchase Orders' },
      ]},
    ],
  },
  {
    key: 'payroll',
    Icon: Users,
    label: 'Payroll',
    defaultPath: '/accounting/payroll',
    matchPrefixes: ['/accounting/payroll', '/payroll'],
    sections: [
      { title: 'Payroll', items: [
        { path: '/accounting/payroll', label: 'Process Payroll' },
      ]},
      { title: 'Payroll Reports', items: [
        { path: '/payroll/reports/workers-comp',        label: 'Workers Comp' },
        { path: '/payroll/reports/employee-history',    label: 'Employee History' },
        { path: '/payroll/reports/earnings-deductions', label: 'Earnings / Deductions' },
        { path: '/payroll/reports/tax-summary',         label: 'Tax Summary' },
        { path: '/payroll/reports/401k',                label: '401k Deductions' },
        { path: '/payroll/reports/empower-export',      label: 'EMPOWER Export' },
        { path: '/payroll/reports/employee-wage-export', label: 'Employee / Wage Export' },
        { path: '/payroll/reports/positive-pay',        label: 'Positive Pay' },
        { path: '/payroll/reports/nacha',               label: 'NACHA Regeneration' },
        { path: '/payroll/reports/employee-info',       label: 'Employee Info' },
        { path: '/payroll/reports/government-wage',     label: 'Government Wage' },
      ]},
    ],
  },
  {
    key: 'eom',
    Icon: Calendar,
    label: 'Period Close',
    defaultPath: '/accounting/eom',
    matchPrefixes: [
      '/accounting/eom', '/accounting/financial-statements', '/accounting/recurring',
      '/accounting/admin/periods',
      '/eom', '/financial-statements', '/fs', '/year-end',
    ],
    sections: [
      { title: 'Close', items: [
        { path: '/accounting/eom',                    label: 'End of Month Close' },
        { path: '/accounting/admin/periods',          label: 'Fiscal Period Control' },
        { path: '/accounting/financial-statements',   label: 'Financial Statements' },
        { path: '/accounting/recurring',              label: 'Recurring Entries' },
        { path: '/accounting/eom/entity-elimination', label: 'Entity Elimination' },
        { path: '/year-end',                          label: 'Year-End Close' },
      ]},
    ],
  },
  {
    key: 'service',
    Icon: Wrench,
    label: 'Service',
    defaultPath: '/service/day-end-close',
    matchPrefixes: ['/service', '/accounting/vehicle-transfers'],
    sections: [
      { title: 'Service', items: [
        { path: '/service/day-end-close',       label: 'Day-End Close' },
        { path: '/service/admin/technicians',   label: 'Technician Master' },
        { path: '/service/history',             label: 'Service History' },
        { path: '/accounting/vehicle-transfers', label: 'Vehicle Transfers' },
      ]},
    ],
  },
  {
    // CE-10 — Tax (S124 Certified Tax Engine Adapter + S125 Regulatory Fee
    // Tables). New top-level nav module, same pattern as 'service' — these
    // are not steps in an existing sequential workflow, they're standalone
    // Controller/Admin/Accountant screens spanning adapter config through
    // reconciliation and fee administration.
    key: 'tax',
    Icon: Landmark,
    label: 'Tax',
    defaultPath: '/accounting/tax/adapter',
    matchPrefixes: ['/accounting/tax'],
    sections: [
      { title: 'Configuration', items: [
        { path: '/accounting/tax/adapter',      label: 'Vendor / Adapter Status' },
        { path: '/accounting/tax/jurisdictions', label: 'Jurisdiction Administration' },
        { path: '/accounting/tax/exemptions',    label: 'Exemption Configuration' },
        { path: '/accounting/tax/fees',          label: 'Regulatory Fee Administration' },
      ]},
      { title: 'Operate', items: [
        { path: '/accounting/tax/results',       label: 'Calculation / Result Inquiry' },
        { path: '/accounting/tax/exceptions',    label: 'Exception & Outage Queue' },
        { path: '/accounting/tax/reconciliation', label: 'Tax Liability Reconciliation' },
      ]},
    ],
  },
  {
    key: 'admin',
    Icon: SettingsIcon,
    label: 'Admin',
    defaultPath: '/setup',
    matchPrefixes: [
      '/setup', '/accounting/admin', '/tenants', '/system-settings',
      '/journal-sources', '/onboarding', '/settings', '/approvals',
    ],
    sections: [
      { title: 'Configuration', items: [
        { path: '/setup',                               label: 'Setup' },
        { path: '/journal-sources',                     label: 'Journal Sources' },
        { path: '/accounting/admin/parts-gl-accounts',  label: 'Parts GL Accounts' },
        { path: '/accounting/admin/service-gl-accounts', label: 'Service GL Accounts' },
        { path: '/accounting/admin/mfg-dcs',            label: 'MFG/DCS Comms' },
        { path: '/accounting/admin/statement-metadata', label: 'Statement Metadata' },
        { path: '/accounting/admin/analysis-codes',     label: 'Analysis Codes' },
      ]},
      { title: 'System', items: [
        { path: '/tenants',        label: 'Tenants' },
        { path: '/system-settings', label: 'System Settings' },
        { path: '/approvals',      label: 'Approvals' },
        { path: '/settings',       label: 'User Settings' },
      ]},
    ],
  },
  {
    key: 'tools',
    Icon: Terminal,
    label: 'Tools',
    defaultPath: '/reporting/report-mate',
    matchPrefixes: [
      '/reporting', '/query', '/agents', '/analytics', '/ml',
      '/amacc-sync', '/mobile-approvals', '/utilities',
    ],
    sections: [
      { title: 'Reporting', items: [
        { path: '/reporting/report-mate', label: 'Report/Mate' },
        { path: '/reporting/doc-mate',    label: 'DOC/Mate' },
      ]},
      { title: 'Intelligence', items: [
        { path: '/agents',      label: 'AI Agents' },
        { path: '/analytics',   label: 'Analytics' },
        { path: '/ml',          label: 'ML Dashboard' },
        { path: '/query',       label: 'Query Explorer' },
        { path: '/amacc-sync',  label: 'AMACC Sync' },
      ]},
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActiveModuleKey(pathname: string): string {
  // More specific prefixes must win — sort by length desc
  const sorted = [...MODULES].sort(
    (a, b) => Math.max(...b.matchPrefixes.map(p => p.length)) - Math.max(...a.matchPrefixes.map(p => p.length)),
  );
  for (const mod of sorted) {
    if (mod.matchPrefixes.some(p => pathname === p || (p !== '/' && pathname.startsWith(p + '/')))) {
      return mod.key;
    }
  }
  // Fallback: match directly against each module's own nav item paths. A
  // module's `matchPrefixes` list is maintained by hand and can silently
  // drift out of sync with its `sections` items (see the GL Reports fix
  // above, where 5 of 6 report paths had no matching prefix at all) — when
  // that happens, falling through to 'dashboard' here made NavRail collapse
  // whatever module the user was actually in. Checking items directly
  // catches that regardless of matchPrefixes correctness.
  for (const mod of MODULES) {
    for (const section of mod.sections) {
      for (const item of section.items) {
        if (pathname === item.path || pathname.startsWith(item.path + '/')) {
          return mod.key;
        }
      }
    }
  }
  return 'dashboard';
}

const ALL_NAV_ITEMS = MODULES.flatMap(m => m.sections.flatMap(s => s.items));

function resolveTitle(pathname: string): string {
  const exact = ALL_NAV_ITEMS.find(i => i.path === pathname);
  if (exact) return exact.label;
  if (/^\/gl\/accounts\/.+\/inquiry$/.test(pathname)) return 'Account Inquiry';
  if (pathname === '/gl/entries') return 'Journal Entries';
  if (pathname === '/eom/close') return 'EOM Close Dashboard';
  return 'AutoMate Accounting';
}

// ─── App ──────────────────────────────────────────────────────────────────────

const RAIL_COLLAPSED_KEY = 'amacc.railCollapsed';

// Legacy-route redirect helper for old /golden-path/* URLs that had params
// (e.g. :receiptId, :drawerId). <Navigate to="..."> can't interpolate route
// params on its own, so this reads them via useParams and builds the target
// path for the new canonical /accounting/* route.
function RedirectWithParams({ to }: { to: (params: Record<string, string | undefined>) => string }) {
  const params = useParams();
  return <Navigate to={to(params)} replace />;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function App() {
  const location = useLocation();
  const navigate  = useNavigate();
  const { isAuthenticated, user, legalEntityLabel, tenantId: sessionTenantId } = useAuth();

  const activeKey    = getActiveModuleKey(location.pathname);
  const activeModule = MODULES.find(m => m.key === activeKey) ?? MODULES[0];
  const pageTitle    = resolveTitle(location.pathname);
  const goldenPathRoute = resolveGoldenPathRoute(location.pathname);
  const effectiveTitle = goldenPathRoute?.title ?? pageTitle;

  // Golden R0 UI convergence — Phase 1: no authenticated shell/navigation
  // around the sign-in screen (no rail, no header, no tenant/user context).
  // /golden-path/login is the legacy URL, preserved as a redirect to /login
  // (see Route below) — included here too so the bare shell (no rail/header)
  // still applies for the one render tick before the redirect resolves.
  const isLoginRoute = location.pathname === '/login' || location.pathname === '/golden-path/login';

  // AMACC-CH04: every backend service enforces real JWT auth unconditionally
  // (packages/shared-kernel/src/middleware/auth.ts — fail-closed, no
  // NODE_ENV-based bypass). The legacy (pre-Golden-Path) pages were built
  // assuming an unauthenticated 'tenant-kunes' demo mode that the backend no
  // longer honors, so every one of them 401'd exactly like the root
  // Dashboard did (e.g. /accounting/ar -> GET /api/v1/apar/ar 401). Rather
  // than wrapping each of the ~100 legacy routes individually in
  // GoldenPathProtectedRoute (as already done per-route for /golden-path/*),
  // gate the whole authenticated shell here: any route other than the login
  // screen requires a real session.
  const needsLoginRedirect = !isLoginRoute && !isAuthenticated;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(RAIL_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem(RAIL_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* best-effort persistence only */ }
      return next;
    });
  }
  const railWidth = collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  const tenantId = localStorage.getItem('tenantId') || 'tenant-kunes';
  const tenantNames: Record<string, string> = {
    'tenant-kunes':   'Kunes Auto Group',
    'tenant-premier': 'Premier Motors',
    'tenant-sunrise': 'Sunrise Dealerships',
  };
  const tenantName = tenantNames[tenantId] ?? tenantId;

  // Real signed-in session (golden-path auth) takes precedence over the
  // legacy demo tenant-badge mechanism used by the rest of the app, which has
  // no real login of its own.
  const contextTenantId = sessionTenantId ?? tenantId;
  const contextUserLabel = isAuthenticated && user ? user.displayName : 'Not signed in';
  const avatarLabel = isAuthenticated && user ? initials(user.displayName) : 'SA';
  const avatarTitle = isAuthenticated && user
    ? `${user.displayName}${legalEntityLabel ? ' · ' + legalEntityLabel : ''}`
    : undefined;

  const crumbs = goldenPathRoute
    ? [{ label: 'Accounting' }, { label: goldenPathRoute.group }, { label: goldenPathRoute.title }]
    : [{ label: 'Accounting' }, { label: activeModule.label }, { label: pageTitle }];

  function handleModuleSelect(key: string) {
    const mod = MODULES.find(m => m.key === key);
    if (mod) navigate(mod.defaultPath);
  }

  if (needsLoginRedirect) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden" style={{ background: '#F8FAFC' }}>

        {!isLoginRoute && (
          <NavRail
            modules={MODULES}
            activeKey={activeKey}
            pathname={location.pathname}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onSelectModule={handleModuleSelect}
          />
        )}

        {/* ── Main content ── */}
        <div className="flex-1 flex flex-col min-h-screen" style={{ marginLeft: isLoginRoute ? 0 : railWidth, transition: 'margin-left 150ms ease-out' }}>

          {!isLoginRoute && (
            <>
              {/* Top Header — platform identity, module name, global search,
                  notifications, dealership-group selector, user (Section 03,
                  line 608). Search/notifications are visual affordances only
                  in this phase; no backend search/notification feature exists
                  yet. */}
              <header className="h-[52px] bg-white border-b border-slate-200 flex items-center px-6 sticky top-0 z-30 flex-shrink-0 gap-3">
                <span className="text-[13px] font-medium text-slate-400 select-none">
                  AutoMate · Dealer Platform
                </span>
                <span className="text-slate-200 select-none">|</span>
                <h2 className="text-[15px] font-semibold text-slate-900 truncate">{effectiveTitle}</h2>
                <div className="ml-auto flex items-center gap-3">
                  <button
                    type="button"
                    title="Search (not yet wired to a backend search feature)"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  >
                    <Search size={16} />
                  </button>
                  <button
                    type="button"
                    title="Notifications — none yet"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  >
                    <Bell size={16} />
                  </button>
                  <span className="bg-blue-50 text-blue-700 text-[11px] font-semibold px-3 py-[3px] rounded-full border border-blue-200 select-none">
                    {tenantName}
                  </span>
                  <div
                    title={avatarTitle}
                    className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center flex-shrink-0"
                  >
                    <span className="text-white text-xs font-semibold select-none">{avatarLabel}</span>
                  </div>
                </div>
              </header>

              <div className="px-6 py-2 bg-white border-b border-slate-100 flex-shrink-0">
                <Breadcrumb crumbs={crumbs} />
              </div>

              <div className="flex-shrink-0 sticky top-[52px] z-20">
                <ContextBar
                  tenantId={contextTenantId}
                  userDisplayName={contextUserLabel}
                />
              </div>
            </>
          )}

          {/* Page Content */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden">
            <Routes>
              <Route path="/" element={<GoldenPathProtectedRoute><Dashboard /></GoldenPathProtectedRoute>} />
              <Route path="/command-center" element={<GoldenPathProtectedRoute><AccountingCommandCenter /></GoldenPathProtectedRoute>} />
              <Route path="/gl" element={<GeneralLedger />} />
              <Route path="/gl/entries" element={<JournalEntryManagement />} />
              <Route path="/gl/accounts/:code/inquiry" element={<GLAccountInquiry />} />
              <Route path="/gl/accounts/inquiry" element={<GLAccountInquiry />} />
              <Route path="/eom/close" element={<EOMCloseDashboard />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/coa" element={<ChartOfAccounts />} />
              <Route path="/schedules" element={<Schedules />} />
              <Route path="/vehicle-inventory" element={<VehicleInventory />} />
              <Route path="/standard-journal-entries" element={<StandardJournalEntries />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/trial-balance" element={<TrialBalance />} />
              <Route path="/manual-entry" element={<ManualJournalEntry />} />
              <Route path="/financial-statements" element={<FinancialStatements />} />
              <Route path="/fs" element={<FSPreview />} />
              <Route path="/ap" element={<AccountsPayable />} />
              <Route path="/cash-receipts" element={<CashReceipts />} />
              <Route path="/bank-deposits" element={<BankDeposits />} />
              <Route path="/po" element={<PurchaseOrders />} />
              {/* AMACC-CH04 S036A: /vendors was a disconnected mock page (VendorManagement.tsx,
                  hardcoded sample data, no API calls, unlinked from nav) — converged onto the
                  one real, wired vendor-master surface at /accounting/ap/vendors. */}
              <Route path="/vendors" element={<Navigate to="/accounting/ap/vendors" replace />} />
              <Route path="/payroll" element={<Payroll />} />
              <Route path="/recon" element={<Reconciliation />} />
              <Route path="/intercompany" element={<Intercompany />} />
              <Route path="/warranty" element={<WarrantyDCS />} />
              <Route path="/journal-sources" element={<JournalSources />} />
              <Route path="/eom" element={<EOMClose />} />
              <Route path="/year-end" element={<YearEnd />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/system-settings" element={<SystemSettings />} />
              <Route path="/setup" element={<Setup />} />
              <Route path="/utilities" element={<Utilities />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/tenants" element={<Tenants />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/ml" element={<MLDashboard />} />
              <Route path="/group-dashboard" element={<GoldenPathProtectedRoute><GroupDashboard /></GoldenPathProtectedRoute>} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/query" element={<QueryExplorer />} />
              <Route path="/amacc-sync" element={<AMACCSync />} />
              <Route path="/mobile-approvals" element={<MobileApprovals />} />

              {/* Single unified sign-in route for the whole application (was
                  /golden-path/login). Old URL kept working as a redirect
                  below so existing bookmarks/links don't break. */}
              <Route path="/login" element={<GoldenPathLogin />} />
              <Route path="/golden-path/login" element={<Navigate to="/login" replace />} />
              <Route path="/golden-path/select-entity" element={<GoldenPathProtectedRoute><GoldenPathSelectEntity /></GoldenPathProtectedRoute>} />
              {/* S202/S004A — minimal Golden Path browser-journey screens,
                  added for the Golden R0 final closure browser certification
                  (steps 3/4 of the required 16-step journey). */}
              <Route path="/golden-path/org-hierarchy" element={<GoldenPathProtectedRoute><GoldenPathOrgHierarchy /></GoldenPathProtectedRoute>} />
              {/* Entity Elimination moved into the normal Accounting sidebar
                  (Period Close > Entity Elimination). Old URL redirects. */}
              <Route path="/accounting/eom/entity-elimination" element={<GoldenPathProtectedRoute><GoldenPathEntityElimination /></GoldenPathProtectedRoute>} />
              <Route path="/golden-path/entity-elimination" element={<Navigate to="/accounting/eom/entity-elimination" replace />} />
              <Route path="/golden-path/role-templates" element={<GoldenPathProtectedRoute><GoldenPathRoleTemplates /></GoldenPathProtectedRoute>} />
              <Route path="/golden-path/fiscal" element={<GoldenPathProtectedRoute><GoldenPathFiscalPeriod /></GoldenPathProtectedRoute>} />
              <Route path="/golden-path/coa" element={<GoldenPathProtectedRoute><GoldenPathChartOfAccounts /></GoldenPathProtectedRoute>} />
              <Route path="/golden-path/journal" element={<GoldenPathProtectedRoute><GoldenPathJournalWorkflow /></GoldenPathProtectedRoute>} />
              <Route path="/golden-path/audit/:entityType/:entityId" element={<GoldenPathProtectedRoute><GoldenPathAuditHistory /></GoldenPathProtectedRoute>} />
              {/* S222 — Trial Balance Screen. Not a step in the sequential
                  login->...->audit-history Golden Path (TB isn't one of its
                  11 steps); a directly-reachable Controller reporting screen
                  consuming the real S014 gl-service API. */}
              <Route path="/golden-path/trial-balance" element={<GoldenPathProtectedRoute><GoldenPathTrialBalance /></GoldenPathProtectedRoute>} />
              <Route path="/golden-path/gl-search" element={<GoldenPathProtectedRoute><GoldenPathGLSearch /></GoldenPathProtectedRoute>} />
              {/* S227 — Balance Sheet & Income Statement Screens. Same
                  reachability model as S222 above (direct Controller
                  reporting screens, not sequential Golden Path steps),
                  consuming the real gl-service FinancialStatementService
                  API only. */}
              <Route path="/golden-path/balance-sheet" element={<GoldenPathProtectedRoute><GoldenPathBalanceSheet /></GoldenPathProtectedRoute>} />
              <Route path="/golden-path/income-statement" element={<GoldenPathProtectedRoute><GoldenPathIncomeStatement /></GoldenPathProtectedRoute>} />
              {/* S011 — Analysis Code Registry (P01-SCR-04). Route matches
                  the P01 Story Contract literally (/accounting/admin/
                  analysis-codes), wrapped in the same real-auth Golden Path
                  guard as every other certified P01 screen. */}
              <Route path="/accounting/admin/analysis-codes" element={<GoldenPathProtectedRoute><AnalysisCodeRegistry /></GoldenPathProtectedRoute>} />
              {/* CE-10 — Tax (S124 Certified Tax Engine Adapter + S125
                  Regulatory Fee Tables). All seven screens render inside the
                  unified Accounting app shell, same GoldenPathProtectedRoute
                  guard as every other real-auth screen. */}
              <Route path="/accounting/tax/adapter" element={<GoldenPathProtectedRoute><TaxAdapterStatus /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/tax/jurisdictions" element={<GoldenPathProtectedRoute><TaxJurisdictionAdmin /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/tax/exemptions" element={<GoldenPathProtectedRoute><TaxExemptions /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/tax/results" element={<GoldenPathProtectedRoute><TaxResultInquiry /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/tax/exceptions" element={<GoldenPathProtectedRoute><TaxExceptionQueue /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/tax/reconciliation" element={<GoldenPathProtectedRoute><TaxReconciliation /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/tax/fees" element={<GoldenPathProtectedRoute><TaxFeeAdmin /></GoldenPathProtectedRoute>} />
              {/* Posting Rules / Posting Executions moved into the normal
                  Accounting sidebar (General Ledger > Posting Engine). Old
                  URLs redirect. */}
              <Route path="/accounting/gl/posting-rules" element={<GoldenPathProtectedRoute><GoldenPathPostingRules /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/gl/posting-executions" element={<GoldenPathProtectedRoute><GoldenPathPostingExecutions /></GoldenPathProtectedRoute>} />
              <Route path="/golden-path/posting-rules" element={<Navigate to="/accounting/gl/posting-rules" replace />} />
              <Route path="/golden-path/posting-executions" element={<Navigate to="/accounting/gl/posting-executions" replace />} />
              {/* S021 — Posting Recovery (DLQ inspection + replay). Integrated
                  directly under the canonical Accounting sidebar (General
                  Ledger > Posting Engine), following the same convention
                  established for Posting Rules/Executions above — this story
                  never had an integrated golden-path-only route to redirect
                  from in production, but the redirect is kept for parity with
                  every other migrated screen and for any bookmarks made
                  against the unmerged S021 branches' own dev environment. */}
              <Route path="/accounting/gl/posting-recovery" element={<GoldenPathProtectedRoute><GoldenPathPostingRecoveryQueue /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/gl/posting-recovery/:id" element={<GoldenPathProtectedRoute><GoldenPathPostingRecoveryCaseDetail /></GoldenPathProtectedRoute>} />
              <Route path="/golden-path/posting-recovery" element={<Navigate to="/accounting/gl/posting-recovery" replace />} />
              <Route path="/golden-path/posting-recovery/:id" element={<RedirectWithParams to={(p) => `/accounting/gl/posting-recovery/${p.id}`} />} />
              {/* Golden R0 Phase — routing alias only, no second implementation.
                  The canonical GL Inquiry screen/route is /accounting/inquiry/gl
                  (registered below); this path never had a real route at all,
                  so it fell through to the app shell's default/dashboard view. */}
              <Route path="/golden-path/gl-inquiry" element={<Navigate to="/accounting/inquiry/gl" replace />} />

              {/* S052 — POS Cash Receipts, Cashier Drawers, Blind Close and
                  Over/Short. Moved into the normal Accounting sidebar
                  (AP / AR > Cashiering). Old /golden-path/cash/* URLs below
                  redirect to these canonical paths so old bookmarks/links
                  keep working. */}
              <Route path="/accounting/cash" element={<GoldenPathProtectedRoute><CashDrawerHome /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/cash/open" element={<GoldenPathProtectedRoute><CashOpenDrawer /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/cash/receive" element={<GoldenPathProtectedRoute><CashReceivePayment /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/cash/receipts" element={<GoldenPathProtectedRoute><CashReceiptSearch /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/cash/receipts/:receiptId" element={<GoldenPathProtectedRoute><CashReceiptDetails /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/cash/receipts/:receiptId/print" element={<GoldenPathProtectedRoute><CashReceiptPrint /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/cash/drawers/:drawerId/blind-close" element={<GoldenPathProtectedRoute><CashBlindClose /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/cash/drawers/:drawerId/reconciliation" element={<GoldenPathProtectedRoute><CashSupervisorReconciliation /></GoldenPathProtectedRoute>} />

              <Route path="/golden-path/cash" element={<Navigate to="/accounting/cash" replace />} />
              <Route path="/golden-path/cash/open" element={<Navigate to="/accounting/cash/open" replace />} />
              <Route path="/golden-path/cash/receive" element={<Navigate to="/accounting/cash/receive" replace />} />
              <Route path="/golden-path/cash/receipts" element={<Navigate to="/accounting/cash/receipts" replace />} />
              <Route path="/golden-path/cash/receipts/:receiptId" element={<RedirectWithParams to={(p) => `/accounting/cash/receipts/${p.receiptId}`} />} />
              <Route path="/golden-path/cash/receipts/:receiptId/print" element={<RedirectWithParams to={(p) => `/accounting/cash/receipts/${p.receiptId}/print`} />} />
              <Route path="/golden-path/cash/drawers/:drawerId/blind-close" element={<RedirectWithParams to={(p) => `/accounting/cash/drawers/${p.drawerId}/blind-close`} />} />
              <Route path="/golden-path/cash/drawers/:drawerId/reconciliation" element={<RedirectWithParams to={(p) => `/accounting/cash/drawers/${p.drawerId}/reconciliation`} />} />

              {/* WF-A001 through WF-A010 */}
              <Route path="/accounting/dashboard" element={<GoldenPathProtectedRoute><DashboardWorkflow /></GoldenPathProtectedRoute>} />
              <Route path="/accounting/gl" element={<JournalEntryList />} />
              <Route path="/accounting/gl/entry" element={<JournalEntry />} />
              <Route path="/accounting/gl/entry/:id" element={<JournalEntry />} />
              <Route path="/accounting/gl/templates" element={<JournalTemplateList />} />
              <Route path="/accounting/gl/templates/new" element={<JournalTemplateEdit />} />
              <Route path="/accounting/gl/templates/:id" element={<JournalTemplateEdit />} />
              {/* S032 — Recurring Journal Templates (real coa-service integration, distinct from the legacy gl-service templates above) */}
              <Route path="/accounting/journals/templates" element={<RecurringJournalTemplates />} />
              <Route path="/accounting/journals/templates/new" element={<RecurringJournalTemplateEditor />} />
              <Route path="/accounting/journals/templates/:id" element={<RecurringJournalTemplateEditor />} />
              <Route path="/accounting/ap" element={<APWorkflow />} />
              <Route path="/accounting/ap/invoices" element={<VendorInvoices />} />
              <Route path="/accounting/ap/invoices/:id" element={<VendorInvoices />} />
              <Route path="/accounting/ap/approval-matrix" element={<ApprovalMatrixConfig />} />
              <Route path="/accounting/ap/vendors" element={<VendorMaintenance />} />
              <Route path="/accounting/ap/vendors/:id" element={<VendorMaintenance />} />
              <Route path="/accounting/ar/customers" element={<CustomerMaintenance />} />
              <Route path="/accounting/ar/customers/:id" element={<CustomerMaintenance />} />
              <Route path="/accounting/vehicle-transfers" element={<VehicleTransfers />} />
              <Route path="/accounting/ar" element={<ARWorkflow />} />
              <Route path="/accounting/bank-recon" element={<BankReconWorkflow />} />
              <Route path="/accounting/payroll" element={<PayrollWorkflow />} />
              <Route path="/accounting/eom" element={<EOMWorkflow />} />
              <Route path="/accounting/admin/periods" element={<PeriodControl />} />
              <Route path="/accounting/financial-statements" element={<FSWorkflow />} />
              <Route path="/accounting/purchase-orders" element={<POWorkflow />} />
              <Route path="/accounting/recurring" element={<RecurringWorkflow />} />

              {/* Service Module */}
              <Route path="/service/day-end-close" element={<DayEndClose />} />

              {/* Sprint B — GL Reports */}
              <Route path="/accounting/reports/gl-trial-balance" element={<GLTrialBalance />} />
              <Route path="/accounting/reports/annual-gl-summary" element={<AnnualGLSummary />} />
              <Route path="/accounting/reports/detailed-gl-pl" element={<DetailedGLPL />} />
              <Route path="/accounting/reports/monthly-trans-journals" element={<MonthlyTransJournals />} />
              <Route path="/accounting/reports/autopost" element={<AutopostReport />} />
              <Route path="/accounting/reports/cross-post" element={<CrossPostReport />} />

              {/* Sprint B — Payroll Reports */}
              <Route path="/payroll/reports/workers-comp" element={<WorkersCompReport />} />
              <Route path="/payroll/reports/employee-history" element={<EmployeeHistoryReport />} />
              <Route path="/payroll/reports/earnings-deductions" element={<EarningsDeductionsReport />} />
              <Route path="/payroll/reports/tax-summary" element={<TaxSummaryReport />} />
              <Route path="/payroll/reports/401k" element={<FourOhOneKReport />} />
              <Route path="/payroll/reports/empower-export" element={<EMPOWERExport />} />
              <Route path="/payroll/reports/employee-wage-export" element={<EmployeeWageExport />} />
              <Route path="/payroll/reports/positive-pay" element={<PayrollPositivePay />} />
              <Route path="/payroll/reports/nacha" element={<NACHAStandalone />} />
              <Route path="/payroll/reports/employee-info" element={<EmployeeInfoReport />} />
              <Route path="/payroll/reports/government-wage" element={<GovernmentWageReport />} />

              {/* Sprint C — Inquiry */}
              <Route path="/accounting/inquiry" element={<InquiryMenu />} />
              <Route path="/accounting/inquiry/gl" element={<GLInquiry />} />
              <Route path="/accounting/inquiry/schedules" element={<ScheduleInquiry />} />
              <Route path="/accounting/inquiry/transactions" element={<TransactionInquiry />} />

              {/* S026 — Schedule Open-Item Core (open items + GL tie-out) */}
              <Route path="/accounting/schedules/open-items" element={<ScheduleOpenItems />} />

              {/* Sprint C — Admin Config */}
              <Route path="/accounting/admin/mfg-dcs" element={<MFGDCSCommunications />} />
              <Route path="/accounting/admin/parts-gl-accounts" element={<PartsGLAccounts />} />
              <Route path="/accounting/admin/service-gl-accounts" element={<ServiceGLAccounts />} />
              <Route path="/accounting/admin/statement-metadata" element={<StatementMetadata />} />

              {/* Sprint C — Service */}
              <Route path="/service/admin/technicians" element={<TechnicianMasterFile />} />
              <Route path="/service/history" element={<ServiceHistory />} />

              {/* Sprint C — Reporting Tools */}
              <Route path="/reporting/report-mate" element={<ReportMate />} />
              <Route path="/reporting/doc-mate" element={<DocMate />} />
            </Routes>
          </main>
        </div>

        {/* T1 Copilot — persistent on every authenticated page; hidden pre-login */}
        {!isLoginRoute && <T1Sidebar />}
      </div>
    </ErrorBoundary>
  );
}
