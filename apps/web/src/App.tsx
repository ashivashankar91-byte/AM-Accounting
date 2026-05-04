import { useState, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
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

interface NavSection { title: string; items: { path: string; label: string; icon: string }[]; }

interface ServiceCheck { name: string; url: string; critical: boolean; port: number; }
const MONITORED_SERVICES: ServiceCheck[] = [
  { name: 'GL', url: '/api/v1/gl/accounts', critical: true, port: 3010 },
  { name: 'Payroll', url: '/api/v1/payroll/batches', critical: true, port: 3012 },
  { name: 'EOM', url: '/api/v1/eom/readiness', critical: true, port: 3011 },
  { name: 'Auth', url: '/api/v1/auth/health', critical: false, port: 3001 },
];

function SidebarServiceStatus() {
  const [results, setResults] = useState<{ name: string; up: boolean; port: number }[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const check = async () => {
      const res = await Promise.allSettled(
        MONITORED_SERVICES.map(s =>
          fetch(s.url, {
            signal: AbortSignal.timeout(3000),
            headers: { 'x-tenant-id': localStorage.getItem('tenantId') || 'tenant-kunes' },
          })
        )
      );
      setResults(MONITORED_SERVICES.map((s, i) => ({
        name: s.name,
        up: res[i].status === 'fulfilled' && (res[i] as PromiseFulfilledResult<Response>).value.ok,
        port: s.port,
      })));
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  if (results.length === 0) return null;
  const allUp = results.every(r => r.up);

  return (
    <div style={{ borderTop: '1px solid #1E293B', padding: '12px 20px' }}>
      <button onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}>
        <span className="pulse-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: allUp ? '#22C55E' : '#EF4444' }} />
        <span>{allUp ? 'All systems operational' : `${results.filter(r => !r.up).length} service${results.filter(r => !r.up).length > 1 ? 's' : ''} down`}</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </button>
      {expanded && (
        <div style={{ marginTop: 8 }}>
          {results.map(r => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0', color: '#94A3B8' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.up ? '#22C55E' : '#EF4444' }} />
              <span>{r.name}</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 10, color: '#475569' }}>:{r.port}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const NAV_SECTIONS: NavSection[] = [
  { title: 'Core', items: [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/command-center', label: 'Command Center', icon: '🎛️' },
    { path: '/gl', label: 'General Ledger', icon: '📒' },
    { path: '/gl/entries', label: 'Journal Entries', icon: '✏️' },
    { path: '/gl/accounts/inquiry', label: 'Account Inquiry', icon: '🔎' },
    { path: '/transactions', label: 'Transactions', icon: '📝' },
    { path: '/trial-balance', label: 'Trial Balance', icon: '⚖️' },
    { path: '/manual-entry', label: 'Manual Journal Entry', icon: '📋' },
    { path: '/coa', label: 'Chart of Accounts', icon: '🗂️' },
    { path: '/financial-statements', label: 'Financial Statements', icon: '📊' },
    { path: '/fs', label: 'FS Preview (OEM)', icon: '📄' },
    { path: '/reports', label: 'Reports', icon: '📋' },
  ]},
  { title: 'Operations', items: [
    { path: '/ap', label: 'Accounts Payable', icon: '💳' },
    { path: '/cash-receipts', label: 'Cash Receipts', icon: '💵' },
    { path: '/bank-deposits', label: 'Bank Deposits', icon: '🏦' },
    { path: '/po', label: 'Purchase Orders', icon: '📦' },
    { path: '/vendors', label: 'Vendors', icon: '🏪' },
    { path: '/payroll', label: 'Payroll', icon: '💰' },
    { path: '/recon', label: 'Reconciliation', icon: '⚖️' },
  ]},
  { title: 'Advanced', items: [
    { path: '/intercompany', label: 'Intercompany', icon: '🔄' },
    { path: '/warranty', label: 'Warranty & DCS', icon: '🛡️' },
    { path: '/journal-sources', label: 'Journal Sources', icon: '🏷️' },
    { path: '/eom/close', label: 'EOM Close Dashboard', icon: '📅' },
    { path: '/eom', label: 'EOM (Legacy)', icon: '📆' },
    { path: '/year-end', label: 'Year-End Close', icon: '🎯' },
    { path: '/approvals', label: 'Approvals', icon: '✅' },
    { path: '/group-dashboard', label: 'Group Dashboard', icon: '🏢' },
  ]},
  { title: 'Admin', items: [
    { path: '/system-settings', label: 'System Settings', icon: '🏗️' },
    { path: '/setup', label: 'Setup', icon: '⚙️' },
    { path: '/utilities', label: 'Utilities', icon: '🔧' },
    { path: '/agents', label: 'AI Agents', icon: '🤖' },
    { path: '/tenants', label: 'Tenants', icon: '🏢' },
    { path: '/onboarding', label: 'Onboarding', icon: '🚀' },
    { path: '/analytics', label: 'Analytics', icon: '📈' },
    { path: '/ml', label: 'ML Intelligence', icon: '🧠' },
    { path: '/query', label: 'Query Explorer', icon: '🔍' },
    { path: '/amacc-sync', label: 'AMACC Sync', icon: '🔗' },
    { path: '/settings', label: 'Settings', icon: '👤' },
  ]},
];

export default function App() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleSection = (title: string) => setCollapsed(prev => ({ ...prev, [title]: !prev[title] }));

  // Resolve current page title from route
  const currentPage = NAV_SECTIONS.flatMap(s => s.items).find(i => i.path === location.pathname);
  const dynamicTitles: { test: (p: string) => boolean; label: string }[] = [
    { test: p => /^\/gl\/accounts\/.+\/inquiry$/.test(p), label: 'Account Inquiry' },
    { test: p => p === '/gl/entries', label: 'Journal Entries' },
    { test: p => p === '/eom/close', label: 'EOM Close Dashboard' },
  ];
  const dynamicTitle = dynamicTitles.find(d => d.test(location.pathname))?.label;
  const pageTitle = currentPage?.label ?? dynamicTitle ?? 'Dashboard';
  const tenantId = localStorage.getItem('tenantId') || 'tenant-kunes';
  const tenantNames: Record<string, string> = { 'tenant-kunes': 'Kunes Auto Group', 'tenant-premier': 'Premier Motors', 'tenant-sunrise': 'Sunrise Dealerships' };
  const tenantName = tenantNames[tenantId] ?? tenantId;

  return (
    <ErrorBoundary>
    <div className="flex h-screen overflow-hidden">
      {/* ═══ Sidebar ═══ */}
      <nav style={{ width: 256, background: '#0F172A', height: '100vh', position: 'fixed', left: 0, top: 0, display: 'flex', flexDirection: 'column', zIndex: 40 }}>
        {/* Logo area */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #1E293B' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#1B4FE4', flexShrink: 0 }} />
            <span style={{ color: '#FFFFFF', fontSize: 18, fontWeight: 800 }}>AutoMate</span>
          </div>
          <div style={{ color: '#64748B', fontSize: 11, fontWeight: 500, letterSpacing: '0.05em', marginTop: 2, paddingLeft: 16 }}>Accounting Cloud</div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto scrollbar-thin" style={{ padding: '16px 12px' }}>
          {NAV_SECTIONS.map((section, sectionIdx) => (
            <div key={section.title}>
              {sectionIdx > 0 && <div style={{ height: 1, background: '#1E293B', margin: '8px 12px' }} />}
              <button onClick={() => toggleSection(section.title)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', color: '#475569', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '8px 12px 4px 12px', marginTop: 8, cursor: 'pointer', background: 'none', border: 'none' }}>
                {section.title}
                <span style={{ fontSize: 10 }}>{collapsed[section.title] ? '▸' : '▾'}</span>
              </button>
              {!collapsed[section.title] && section.items.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <Link key={item.path} to={item.path}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8,
                      color: active ? '#FFFFFF' : '#94A3B8', fontSize: 13, fontWeight: active ? 600 : 500,
                      background: active ? '#1B4FE4' : 'transparent', marginBottom: 2,
                      textDecoration: 'none', transition: 'all 150ms',
                      borderLeft: active ? '3px solid #93B4FF' : '3px solid transparent',
                    }}
                    onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = '#1E293B'; e.currentTarget.style.color = '#E2E8F0'; e.currentTarget.style.borderLeft = '3px solid #1B4FE4'; }}}
                    onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.borderLeft = '3px solid transparent'; }}}
                  >
                    <span style={{ width: 16, height: 16, fontSize: 14, lineHeight: '16px' }}>{item.icon}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Service Status */}
        <SidebarServiceStatus />

        {/* Tenant selector */}
        <div style={{ borderTop: '1px solid #1E293B', padding: '16px 20px' }}>
          <select
            style={{ width: '100%', background: '#1E293B', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px', color: '#94A3B8', fontSize: 12 }}
            onChange={(e) => { localStorage.setItem('tenantId', e.target.value); window.location.reload(); }}
            defaultValue={tenantId}
            ref={(el) => { if (el && !localStorage.getItem('tenantId')) { localStorage.setItem('tenantId', 'tenant-kunes'); } }}
          >
            <option value="tenant-kunes">Kunes Auto Group</option>
            <option value="tenant-premier">Premier Motors</option>
            <option value="tenant-sunrise">Sunrise Dealerships</option>
          </select>
        </div>
      </nav>

      {/* ═══ Main Area ═══ */}
      <div style={{ marginLeft: 256, flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Top Header Bar */}
        <header style={{
          height: 60, background: '#FFFFFF', borderBottom: '1px solid #E2E8F0',
          boxShadow: '0 1px 3px rgba(15,23,42,0.04)', display: 'flex', alignItems: 'center',
          padding: '0 32px', position: 'sticky', top: 0, zIndex: 30, flexShrink: 0,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>{pageTitle}</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
            <span style={{
              background: 'var(--primary-light)', color: 'var(--primary)',
              fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 999,
            }}>{tenantName}</span>
            <span style={{
              background: '#F1F5F9', borderRadius: 8, padding: '6px 12px',
              fontSize: 13, color: '#374151',
            }}>April 2026</span>
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
          </Routes>
        </main>
      </div>

      {/* T1 Copilot — persistent floating sidebar on every page */}
      <T1Sidebar />
    </div>
    </ErrorBoundary>
  );
}
