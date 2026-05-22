import { Routes, Route, useLocation, useNavigate, Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, BookOpen, CreditCard, Users, Calendar,
  Wrench, Settings as SettingsIcon, Terminal,
} from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';
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
import VendorManagement from './pages/VendorManagement';
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
import VendorMaintenance from './pages/accounting/VendorMaintenance';
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
import TransactionInquiry from './pages/accounting/TransactionInquiry';
import GLInquiry from './pages/accounting/GLInquiry';
import MFGDCSCommunications from './pages/accounting/MFGDCSCommunications';
import PartsGLAccounts from './pages/accounting/admin/PartsGLAccounts';
import ServiceGLAccounts from './pages/accounting/admin/ServiceGLAccounts';
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

// ─── Module / navigation types ───────────────────────────────────────────────

interface NavItem { path: string; label: string }
interface ModuleSection { title: string; items: NavItem[] }
interface Module {
  key: string;
  Icon: LucideIcon;
  label: string;
  defaultPath: string;
  matchPrefixes: string[];
  sections: ModuleSection[];
}

// ─── Module definitions ───────────────────────────────────────────────────────

const MODULES: Module[] = [
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
      '/accounting/gl', '/accounting/inquiry', '/accounting/reports/gl',
      '/gl', '/trial-balance', '/manual-entry', '/coa', '/standard-journal-entries',
    ],
    sections: [
      { title: 'Journal Entry', items: [
        { path: '/accounting/gl',           label: 'Journal Entries' },
        { path: '/accounting/gl/entry',     label: 'New Entry' },
        { path: '/accounting/gl/templates', label: 'Templates' },
      ]},
      { title: 'Inquiry', items: [
        { path: '/accounting/inquiry',                label: 'Inquiry Menu' },
        { path: '/accounting/inquiry/gl',             label: 'GL Inquiry' },
        { path: '/accounting/inquiry/schedules',      label: 'Schedule Inquiry' },
        { path: '/accounting/inquiry/transactions',   label: 'Transaction Inquiry' },
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
      '/vendors', '/po',
    ],
    sections: [
      { title: 'Accounts Receivable', items: [
        { path: '/accounting/ar',           label: 'Cash Receipts' },
        { path: '/accounting/ar/customers', label: 'Customer Master' },
      ]},
      { title: 'Accounts Payable', items: [
        { path: '/accounting/ap',          label: 'AP Invoices' },
        { path: '/accounting/ap/vendors',  label: 'Vendor Master' },
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
      '/eom', '/financial-statements', '/fs', '/year-end',
    ],
    sections: [
      { title: 'Close', items: [
        { path: '/accounting/eom',                    label: 'End of Month Close' },
        { path: '/accounting/financial-statements',   label: 'Financial Statements' },
        { path: '/accounting/recurring',              label: 'Recurring Entries' },
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

// ─── Icon Rail (64 px, #3B1082 purple) ───────────────────────────────────────

function IconRail({ activeKey, onSelect }: { activeKey: string; onSelect: (key: string) => void }) {
  return (
    <nav
      className="fixed left-0 top-0 h-screen flex flex-col items-center py-3 gap-0.5 z-50"
      style={{ width: 64, background: '#3B1082' }}
    >
      {/* Logo */}
      <div
        className="mb-5 w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-[15px] flex-shrink-0"
        style={{ background: '#194FA1' }}
      >
        A
      </div>

      {MODULES.map(({ key, Icon, label }) => {
        const active = activeKey === key;
        return (
          <button
            key={key}
            title={label}
            onClick={() => onSelect(key)}
            className="relative w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-100 flex-shrink-0"
            style={{
              background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
              color: active ? '#FFFFFF' : 'rgba(255,255,255,0.48)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {active && (
              <span
                className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full"
                style={{ background: '#60AFFF' }}
              />
            )}
            <Icon size={19} />
          </button>
        );
      })}
    </nav>
  );
}

// ─── Sub-Nav (192 px, white, left=64) ────────────────────────────────────────

function SubNav({ module, pathname }: { module: Module; pathname: string }) {
  return (
    <nav
      className="fixed top-0 h-screen flex flex-col z-40 overflow-hidden"
      style={{ left: 64, width: 192, background: '#FFFFFF', borderRight: '1px solid #E2E8F0' }}
    >
      {/* Module title */}
      <div className="flex-shrink-0 px-4 h-14 flex items-center border-b border-slate-100">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          {module.label}
        </span>
      </div>

      {/* Scrollable nav items */}
      <div className="flex-1 overflow-y-auto py-2 scrollbar-thin">
        {module.sections.map(section => (
          <div key={section.title} className="mb-1">
            <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-300 select-none">
              {section.title}
            </p>
            {section.items.map(item => {
              const active = pathname === item.path ||
                (item.path !== '/' && pathname.startsWith(item.path + '/'));
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className="flex items-center mx-2 rounded-lg no-underline transition-colors duration-100"
                  style={{
                    padding: '6px 12px 6px ' + (active ? '10px' : '12px'),
                    color: active ? '#194FA1' : '#374151',
                    background: active ? '#EBF3FF' : 'transparent',
                    fontWeight: active ? 600 : 400,
                    fontSize: 12,
                    borderLeft: active ? '2px solid #194FA1' : '2px solid transparent',
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const location = useLocation();
  const navigate  = useNavigate();

  const activeKey    = getActiveModuleKey(location.pathname);
  const activeModule = MODULES.find(m => m.key === activeKey) ?? MODULES[0];
  const pageTitle    = resolveTitle(location.pathname);

  const tenantId = localStorage.getItem('tenantId') || 'tenant-kunes';
  const tenantNames: Record<string, string> = {
    'tenant-kunes':   'Kunes Auto Group',
    'tenant-premier': 'Premier Motors',
    'tenant-sunrise': 'Sunrise Dealerships',
  };
  const tenantName = tenantNames[tenantId] ?? tenantId;

  function handleModuleSelect(key: string) {
    const mod = MODULES.find(m => m.key === key);
    if (mod) navigate(mod.defaultPath);
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen overflow-hidden" style={{ background: '#F8FAFC' }}>

        {/* ── 64 px Icon Rail ── */}
        <IconRail activeKey={activeKey} onSelect={handleModuleSelect} />

        {/* ── 192 px Sub-Nav ── */}
        <SubNav module={activeModule} pathname={location.pathname} />

        {/* ── Main content (offset 256 px = 64 + 192) ── */}
        <div className="flex-1 flex flex-col min-h-screen" style={{ marginLeft: 256 }}>

          {/* Top Header */}
          <header className="h-14 bg-white border-b border-slate-200 flex items-center px-6 sticky top-0 z-30 flex-shrink-0 gap-2">
            <span className="text-[13px] font-medium text-slate-400 select-none">
              AutoMate · Dealer Platform
            </span>
            <span className="text-slate-200 select-none">|</span>
            <h2 className="text-[15px] font-semibold text-slate-900 truncate">{pageTitle}</h2>
            <div className="ml-auto flex items-center gap-2">
              <span className="bg-blue-50 text-blue-700 text-[11px] font-semibold px-3 py-[3px] rounded-full border border-blue-200 select-none">
                {tenantName}
              </span>
              <div className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-semibold select-none">SA</span>
              </div>
            </div>
          </header>

          {/* Page Content */}
          <main className="flex-1 overflow-y-auto overflow-x-hidden">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/command-center" element={<AccountingCommandCenter />} />
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
              <Route path="/vendors" element={<VendorManagement />} />
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
              <Route path="/group-dashboard" element={<GroupDashboard />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/query" element={<QueryExplorer />} />
              <Route path="/amacc-sync" element={<AMACCSync />} />
              <Route path="/mobile-approvals" element={<MobileApprovals />} />

              {/* WF-A001 through WF-A010 */}
              <Route path="/accounting/dashboard" element={<DashboardWorkflow />} />
              <Route path="/accounting/gl" element={<JournalEntryList />} />
              <Route path="/accounting/gl/entry" element={<JournalEntry />} />
              <Route path="/accounting/gl/entry/:id" element={<JournalEntry />} />
              <Route path="/accounting/gl/templates" element={<JournalTemplateList />} />
              <Route path="/accounting/gl/templates/new" element={<JournalTemplateEdit />} />
              <Route path="/accounting/gl/templates/:id" element={<JournalTemplateEdit />} />
              <Route path="/accounting/ap" element={<APWorkflow />} />
              <Route path="/accounting/ap/vendors" element={<VendorMaintenance />} />
              <Route path="/accounting/ap/vendors/:id" element={<VendorMaintenance />} />
              <Route path="/accounting/ar/customers" element={<CustomerMaintenance />} />
              <Route path="/accounting/ar/customers/:id" element={<CustomerMaintenance />} />
              <Route path="/accounting/vehicle-transfers" element={<VehicleTransfers />} />
              <Route path="/accounting/ar" element={<ARWorkflow />} />
              <Route path="/accounting/bank-recon" element={<BankReconWorkflow />} />
              <Route path="/accounting/payroll" element={<PayrollWorkflow />} />
              <Route path="/accounting/eom" element={<EOMWorkflow />} />
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

              {/* Sprint C — Admin Config */}
              <Route path="/accounting/admin/mfg-dcs" element={<MFGDCSCommunications />} />
              <Route path="/accounting/admin/parts-gl-accounts" element={<PartsGLAccounts />} />
              <Route path="/accounting/admin/service-gl-accounts" element={<ServiceGLAccounts />} />

              {/* Sprint C — Service */}
              <Route path="/service/admin/technicians" element={<TechnicianMasterFile />} />
              <Route path="/service/history" element={<ServiceHistory />} />

              {/* Sprint C — Reporting Tools */}
              <Route path="/reporting/report-mate" element={<ReportMate />} />
              <Route path="/reporting/doc-mate" element={<DocMate />} />
            </Routes>
          </main>
        </div>

        {/* T1 Copilot — persistent on every page */}
        <T1Sidebar />
      </div>
    </ErrorBoundary>
  );
}
