import { useState, useMemo } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';
import {
  AccountTypeCode, ACCOUNT_TYPE_LABELS, JournalPrintCode, JOURNAL_PRINT_LABELS,
  LIFOMethod, ServiceEODMethod, EOD_METHOD_LABELS, MONTH_NAMES,
  JOURNAL_SOURCE_CODES, PAYROLL_SCHEDULE_NUMBERS, SERVICE_SCHEDULE_NUMBERS,
  FORD_REPAIR_TYPES,
  LEE_HYUNDAI_CONFIG, LEE_HYUNDAI_EOD, LEE_HYUNDAI_ROLES,
  type AccountingCompanyConfig, type WarrantyRemittanceConfig, type RepairTypeMapping,
  type AccountingRole, type ServiceEODConfig,
} from '../types/system-settings';
import { LEE_HYUNDAI_SCHEDULES } from '../types/file-maintenance';

// ═══════════════════════════════════════════════════════════════════
// Tab definitions
// ═══════════════════════════════════════════════════════════════════

type TabId = 'company' | 'fiscal' | 'behavior' | 'warranty' | 'access' | 'eod';

interface Tab { id: TabId; label: string; icon: string; hidden?: boolean }

const buildTabs = (accountTypeCode: AccountTypeCode): Tab[] => [
  { id: 'company',  label: 'Company Profile',           icon: '🏢' },
  { id: 'fiscal',   label: 'Fiscal & Period',           icon: '📅' },
  { id: 'behavior', label: 'Accounting Behavior',       icon: '⚙️' },
  { id: 'warranty', label: 'OEM Warranty Remittance',   icon: '🛡️' },
  { id: 'access',   label: 'Access & Permissions',      icon: '🔐' },
  { id: 'eod',      label: 'Service EOD',               icon: '🔄' },
  // DealerCONNECT: hidden for Lee Hyundai (accountTypeCode=Y, no Stellantis franchise)
];

// ═══════════════════════════════════════════════════════════════════
// Seed data — Lee Hyundai has NO warranty remittance entries
// Ford rooftop (Co.04) example shown in expandable reference
// ═══════════════════════════════════════════════════════════════════

const FORD_EXAMPLE: WarrantyRemittanceConfig = {
  companyId: '04',
  manufacturerCode: 'FM',
  manufacturerName: 'Ford Motors',
  sourceJournal: 58,
  factoryReceivableAccount: '30002',
  vendorNumber: 'V542',
  repairTypeMappings: FORD_REPAIR_TYPES,
};

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
};

const fmtDatetime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Check if period is overdue (> 30 days past cutoff and EOM not run)
const isPeriodOverdue = (cutoffDate: string) => {
  const cutoff = new Date(cutoffDate);
  const now = new Date();
  const diffDays = (now.getTime() - cutoff.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays > 30;
};

// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════

export default function SystemSettings() {
  const [activeTab, setActiveTab] = useState<TabId>('company');
  const [config, setConfig] = useState<AccountingCompanyConfig>({ ...LEE_HYUNDAI_CONFIG });
  const [eodConfig, setEodConfig] = useState<ServiceEODConfig>({ ...LEE_HYUNDAI_EOD });
  const [roles] = useState<AccountingRole[]>(LEE_HYUNDAI_ROLES);
  const [warrantyConfigs] = useState<WarrantyRemittanceConfig[]>([]); // Lee Hyundai = empty — correct
  const [editingConfig, setEditingConfig] = useState(false);
  const [showFordReference, setShowFordReference] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>('controller');
  const [editingEod, setEditingEod] = useState(false);

  const tabs = useMemo(() => buildTabs(config.accountTypeCode), [config.accountTypeCode]);
  const overdue = isPeriodOverdue(config.cutoffDate);

  const help = SCREEN_HELP['system-settings'];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">System Settings</h1>
            {help && <HelpButton help={help} />}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Company {config.companyId} — {config.companyName} ·{' '}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
              {ACCOUNT_TYPE_LABELS[config.accountTypeCode]} ({config.accountTypeCode})
            </span>
          </p>
        </div>
        {overdue && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-800 font-medium animate-pulse">
            ⚠ Period {new Date(config.lastCloseMonth).toLocaleDateString('en-US', { month: '2-digit', year: 'numeric' })} is overdue for close. Contact controller.
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-6 overflow-x-auto">
        {tabs.filter(t => !t.hidden).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === 'company' && <CompanyProfileTab config={config} setConfig={setConfig} editing={editingConfig} setEditing={setEditingConfig} />}
      {activeTab === 'fiscal' && <FiscalPeriodTab config={config} />}
      {activeTab === 'behavior' && <AccountingBehaviorTab config={config} setConfig={setConfig} />}
      {activeTab === 'warranty' && <WarrantyRemittanceTab configs={warrantyConfigs} accountTypeCode={config.accountTypeCode} showFordRef={showFordReference} setShowFordRef={setShowFordReference} />}
      {activeTab === 'access' && <AccessPermissionsTab roles={roles} selectedRole={selectedRole} setSelectedRole={setSelectedRole} />}
      {activeTab === 'eod' && <ServiceEODTab config={eodConfig} setConfig={setEodConfig} editing={editingEod} setEditing={setEditingEod} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 1: Company Profile
// ═══════════════════════════════════════════════════════════════════

function CompanyProfileTab({ config, setConfig, editing, setEditing }: {
  config: AccountingCompanyConfig; setConfig: (c: AccountingCompanyConfig) => void;
  editing: boolean; setEditing: (b: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Company Profile</h2>
        <button
          onClick={() => setEditing(!editing)}
          className={`px-4 py-2 text-sm font-medium rounded-lg ${
            editing ? 'bg-gray-200 text-gray-700' : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <FieldRow label="Company ID" value={config.companyId} readonly />
          <FieldRow label="Company Name" value={config.companyName} editing={editing}
            onChange={v => setConfig({ ...config, companyName: v })} />
          <FieldRow label="Phone Area Code" value={config.phoneAreaCode} editing={editing}
            onChange={v => setConfig({ ...config, phoneAreaCode: v })} hint="Used on printed reports only" />

          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Account Type (OEM Brand)</label>
            {editing ? (
              <div>
                <select value={config.accountTypeCode}
                  onChange={e => setConfig({ ...config, accountTypeCode: e.target.value as AccountTypeCode })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([code, label]) => (
                    <option key={code} value={code}>{code} — {label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-red-500 font-medium">
                  ⚠ Changing account type on a live company is DESTRUCTIVE — orphans OEM-specific GL accounts and schedules.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-semibold bg-blue-100 text-blue-800">
                  {config.accountTypeCode} — {ACCOUNT_TYPE_LABELS[config.accountTypeCode]}
                </span>
                {config.accountTypeCode === AccountTypeCode.Y_HYUNDAI && (
                  <span className="text-xs text-gray-500">Enables HMA DDS, Genesis G-prefix accounts, HMA holdback/rebate processing</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right column — NCM Reporting */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">NCM 20-Group Reporting</h3>

          <div className="flex items-center gap-3">
            <ToggleSwitch checked={config.ncm20DataSend} onChange={v => setConfig({ ...config, ncm20DataSend: v })} disabled={!editing} />
            <div>
              <span className="text-sm font-medium text-gray-900">{config.ncm20DataSend ? 'Enabled' : 'Disabled'}</span>
              <p className="text-xs text-gray-500">NADA National Composite Monitor — P&L and balance sheet transmit monthly</p>
            </div>
          </div>

          {config.ncm20DataSend && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-xs text-amber-800 font-medium mb-2">📋 Data Sharing Disclosure</p>
              <p className="text-xs text-amber-700">When enabled, your P&L and balance sheet data will be transmitted monthly to NADA's National Composite Monitor for 20-group peer comparison reporting.</p>
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">NCM Dealer Code</label>
                <input
                  type="text" value={config.ncmDealerCode ?? ''} readOnly={!editing}
                  onChange={e => setConfig({ ...config, ncmDealerCode: e.target.value || null })}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48 focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter NCM dealer code"
                />
              </div>
            </div>
          )}

          {!config.ncm20DataSend && (
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500">Lee Hyundai does not participate in NCM 20-group reporting. Enable to transmit monthly financials to NADA.</p>
            </div>
          )}

          <div className="pt-4 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Multi-Rooftop Context</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-1.5 px-3 rounded bg-blue-50">
                <span className="text-sm font-medium text-blue-800">Co. 03 — Lee Hyundai Inc.</span>
                <div className="flex gap-1">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-200 text-blue-800">Hyundai</span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-200 text-purple-800">Genesis</span>
                </div>
              </div>
              <div className="flex items-center justify-between py-1.5 px-3 rounded bg-gray-50">
                <span className="text-sm text-gray-600">Co. 04 — Lee Ford Inc.</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">Ford</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <div className="flex justify-end gap-3">
          <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 2: Fiscal & Period
// ═══════════════════════════════════════════════════════════════════

function FiscalPeriodTab({ config }: { config: AccountingCompanyConfig }) {
  const currentPeriod = new Date(config.lastCloseMonth);
  const nextPeriod = new Date(currentPeriod);
  nextPeriod.setMonth(nextPeriod.getMonth() + 1);
  const overdue = isPeriodOverdue(config.cutoffDate);

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Fiscal & Period Configuration</h2>

      {/* Period status banner */}
      <div className={`rounded-xl p-5 ${overdue ? 'bg-red-50 border-2 border-red-300' : 'bg-green-50 border border-green-200'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${overdue ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
          <span className={`text-sm font-semibold ${overdue ? 'text-red-800' : 'text-green-800'}`}>
            {overdue ? 'PERIOD OVERDUE FOR CLOSE' : 'Current Period Open'}
          </span>
        </div>
        <p className={`text-sm mt-2 ${overdue ? 'text-red-700' : 'text-green-700'}`}>
          Current open period: <strong>{nextPeriod.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>
          {' '}· Last close: {fmtDate(config.lastCloseMonth)} · Cutoff: {fmtDate(config.cutoffDate)}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Fiscal Year */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Fiscal Year Begins</h3>
          <div className="text-3xl font-bold text-gray-900">{MONTH_NAMES[config.fiscalYearBegins - 1]}</div>
          <p className="text-xs text-gray-500 mt-1">Month {config.fiscalYearBegins} of 12</p>
          <div className="mt-3 bg-amber-50 rounded-lg px-3 py-2">
            <p className="text-xs text-amber-700">⚠ Changing mid-year CORRUPTS YTD calculations. Contact system admin.</p>
          </div>
        </div>

        {/* Last Close */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Last Close</h3>
          <div className="text-2xl font-bold text-gray-900">{fmtDate(config.lastCloseMonth)}</div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-gray-500">Track:</span>
            <span className="px-2 py-0.5 rounded bg-gray-100 text-xs font-mono text-gray-700">{config.lastCloseTrack}</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">🔒 Read-only — updated by EOM close orchestrator</p>
        </div>

        {/* Cutoff Date */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Cutoff Date</h3>
          <div className="text-2xl font-bold text-gray-900">{fmtDate(config.cutoffDate)}</div>
          <p className="text-xs text-gray-500 mt-1">No transaction can post before this date</p>
          <p className="text-xs text-gray-400 mt-2">🔒 Read-only — derived from last close</p>
        </div>

        {/* Post-Ahead Months */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Post-Ahead Months</h3>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-gray-900">{config.postAheadMonths}</span>
            <span className="text-sm text-gray-500">months</span>
          </div>
          {config.postAheadMonths > 4 && (
            <div className="mt-3 bg-amber-50 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-700">⚠ Value exceeds recommended maximum of 4. Max allowed: 6.</p>
            </div>
          )}
          <div className="mt-3">
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5, 6].map(m => (
                <div key={m} className={`flex-1 h-2 rounded-sm ${m <= config.postAheadMonths ? (m > 4 ? 'bg-amber-400' : 'bg-blue-500') : 'bg-gray-200'}`} />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>1</span><span>6 (max)</span>
            </div>
          </div>
        </div>

        {/* Timeline visualization */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 md:col-span-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Period Timeline</h3>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {Array.from({ length: 8 }, (_, i) => {
              const d = new Date(config.cutoffDate);
              d.setMonth(d.getMonth() + i - 1);
              const isClosed = i === 0;
              const isCurrent = i === 1;
              const isPostAhead = i > 1 && i <= config.postAheadMonths + 1;
              const isBeyond = i > config.postAheadMonths + 1;
              return (
                <div key={i} className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs text-center min-w-[80px] border ${
                  isClosed ? 'bg-gray-100 text-gray-500 border-gray-200'
                  : isCurrent ? 'bg-blue-100 text-blue-800 border-blue-300 ring-2 ring-blue-400'
                  : isPostAhead ? 'bg-green-50 text-green-700 border-green-200'
                  : isBeyond ? 'bg-red-50 text-red-400 border-red-200 opacity-50'
                  : 'bg-gray-50 text-gray-400 border-gray-200'
                }`}>
                  <div className="font-medium">{d.toLocaleDateString('en-US', { month: 'short' })}</div>
                  <div className="text-[10px] mt-0.5">
                    {isClosed ? '🔒 Closed' : isCurrent ? '📂 Current' : isPostAhead ? '→ Open' : '🚫 Locked'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 3: Accounting Behavior
// ═══════════════════════════════════════════════════════════════════

function AccountingBehaviorTab({ config, setConfig }: {
  config: AccountingCompanyConfig; setConfig: (c: AccountingCompanyConfig) => void;
}) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Accounting Behavior</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transaction Audit */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Transaction Audit Trail</h3>
            <StatusPill active={config.transactionAudit} />
          </div>
          <p className="text-xs text-gray-500 mb-3">Every GL post writes an audit record. In the new system, audit is always ON at infrastructure level (event sourcing). This flag controls whether the detailed audit trail is surfaced in the UI.</p>
          <div className="flex items-center gap-3">
            <ToggleSwitch checked={config.transactionAudit} onChange={v => setConfig({ ...config, transactionAudit: v })} />
            <span className="text-sm text-gray-700">{config.transactionAudit ? 'Visible to accounting users' : 'Hidden from accounting users'}</span>
          </div>
          {!config.transactionAudit && (
            <div className="mt-3 bg-red-50 rounded-lg px-3 py-2">
              <p className="text-xs text-red-700">⚠ Disabling requires system administrator credentials. Audit data is still collected at infrastructure level.</p>
            </div>
          )}
        </div>

        {/* Decimal in Transactions */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Decimal in Transactions</h3>
            <StatusPill active={config.useDecimalInTransactions} />
          </div>
          <p className="text-xs text-gray-500 mb-3">Allow cents in dollar amounts. When disabled, all amounts are rounded to whole dollars.</p>
          <div className="flex items-center gap-3">
            <ToggleSwitch checked={config.useDecimalInTransactions} onChange={v => setConfig({ ...config, useDecimalInTransactions: v })} />
            <span className="text-sm text-gray-700">{config.useDecimalInTransactions ? 'Cents allowed ($1,234.56)' : 'Whole dollars only ($1,235)'}</span>
          </div>
        </div>

        {/* Suppress Zero YTD */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Suppress Zero YTD on Trial Balance</h3>
            <StatusPill active={config.suppressZeroYTDOnTrialBalance} />
          </div>
          <p className="text-xs text-gray-500 mb-3">Hide accounts with zero year-to-date balance from trial balance reports for a cleaner output.</p>
          <div className="flex items-center gap-3">
            <ToggleSwitch checked={config.suppressZeroYTDOnTrialBalance} onChange={v => setConfig({ ...config, suppressZeroYTDOnTrialBalance: v })} />
            <span className="text-sm text-gray-700">{config.suppressZeroYTDOnTrialBalance ? 'Zero-balance lines hidden' : 'All accounts shown'}</span>
          </div>
        </div>

        {/* Journal Print Code */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Transaction Journal Print Code</h3>
          <p className="text-xs text-gray-500 mb-3">Controls whether journal prints show a preview before printing or generate edit check only.</p>
          <div className="flex gap-3">
            {Object.entries(JOURNAL_PRINT_LABELS).map(([code, label]) => (
              <button key={code}
                onClick={() => setConfig({ ...config, transactionJournalPrintCode: code as JournalPrintCode })}
                className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                  config.transactionJournalPrintCode === code
                    ? 'border-blue-500 bg-blue-50 text-blue-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <div>{label}</div>
                <div className="text-[10px] text-gray-400 mt-1">Code: {code}</div>
              </button>
            ))}
          </div>
        </div>

        {/* LIFO Valuation */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">LIFO Valuation Method</h3>
          <p className="text-xs text-gray-500 mb-3">
            Applies to <strong>parts inventory</strong> valuation only. Vehicle inventory uses specific identification. Most dealers use NONE.
          </p>
          <div className="flex gap-3">
            {Object.values(LIFOMethod).map(method => (
              <button key={method}
                onClick={() => setConfig({ ...config, lifoValuationMethod: method })}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium border-2 transition-colors ${
                  config.lifoValuationMethod === method
                    ? 'border-blue-500 bg-blue-50 text-blue-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {method}
              </button>
            ))}
          </div>
          {config.lifoValuationMethod !== LIFOMethod.NONE && (
            <div className="mt-3 bg-amber-50 rounded-lg px-3 py-2">
              <p className="text-xs text-amber-700">⚠ Changing LIFO method mid-year requires an accounting adjustment entry.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 4: OEM Warranty Remittance
// ═══════════════════════════════════════════════════════════════════

function WarrantyRemittanceTab({ configs, accountTypeCode, showFordRef, setShowFordRef }: {
  configs: WarrantyRemittanceConfig[]; accountTypeCode: AccountTypeCode;
  showFordRef: boolean; setShowFordRef: (b: boolean) => void;
}) {
  const [expandedMfr, setExpandedMfr] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">OEM Warranty Remittance</h2>
        <button className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + Add Manufacturer
        </button>
      </div>

      {/* Empty state for Lee Hyundai */}
      {configs.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🛡️</div>
          <h3 className="text-lg font-semibold text-blue-900 mb-2">No Warranty Remittance Configured</h3>
          <p className="text-sm text-blue-700 max-w-lg mx-auto mb-4">
            Hyundai warranty is processed via <strong>HMA DDS direct-posting</strong>, not via the remittance batch process.
            Add a manufacturer here only if using remittance batch processing.
          </p>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-100 text-xs font-medium text-blue-800">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            HMA DDS Integration Active
          </div>
        </div>
      )}

      {/* Manufacturer grid */}
      {configs.length > 0 && (
        <div className="space-y-4">
          {configs.map(cfg => (
            <div key={cfg.manufacturerCode} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button onClick={() => setExpandedMfr(expandedMfr === cfg.manufacturerCode ? null : cfg.manufacturerCode)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center gap-4">
                  <span className="px-3 py-1 rounded-lg bg-gray-100 font-mono text-sm font-bold text-gray-800">{cfg.manufacturerCode}</span>
                  <span className="font-medium text-gray-900">{cfg.manufacturerName}</span>
                  <span className="text-xs text-gray-500">Source {cfg.sourceJournal} · GL {cfg.factoryReceivableAccount} · Vendor {cfg.vendorNumber}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">{cfg.repairTypeMappings.length} repair types</span>
                  <span className="text-gray-400">{expandedMfr === cfg.manufacturerCode ? '▾' : '▸'}</span>
                </div>
              </button>
              {expandedMfr === cfg.manufacturerCode && (
                <RepairTypeMappingTable mappings={cfg.repairTypeMappings} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Ford reference (cross-rooftop example) */}
      <div className="border-t border-gray-200 pt-6">
        <button onClick={() => setShowFordRef(!showFordRef)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <span>{showFordRef ? '▾' : '▸'}</span>
          <span className="font-medium">Ford Motors Reference (Co. 04 — Lee Ford Inc.)</span>
          <span className="text-xs text-gray-400">— cross-rooftop example with 12 repair types</span>
        </button>

        {showFordRef && (
          <div className="mt-4 bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 bg-gray-100 border-b border-gray-200">
              <div className="flex items-center gap-4">
                <span className="px-3 py-1 rounded-lg bg-blue-100 font-mono text-sm font-bold text-blue-800">FM</span>
                <div>
                  <span className="font-medium text-gray-900">Ford Motors</span>
                  <span className="text-xs text-gray-500 ml-3">Source 58 · Factory Recv GL 30002 · Vendor V542</span>
                </div>
              </div>
            </div>
            <RepairTypeMappingTable mappings={FORD_EXAMPLE.repairTypeMappings} reference />
          </div>
        )}
      </div>

      {/* Business rules reference */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Remittance Rules</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-600">
          <div className="flex gap-2">
            <span className="text-amber-500">●</span>
            <span>Each manufacturer code unique per rooftop. Hyundai+Genesis dual = HMA + GMA entries.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-amber-500">●</span>
            <span>Factory Receivable must be type=ASSET in Chart of Accounts.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-amber-500">●</span>
            <span>Small balance write-off: defaults to $15.00. Warn if $0.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-amber-500">●</span>
            <span>Repair type codes are OEM-defined — users can only edit GL routing and thresholds.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-amber-500">●</span>
            <span>Vendor# must exist in AP Vendor file as active OEM/Manufacturer type.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-amber-500">●</span>
            <span>On GL inactivation, cascade check all warranty configs referencing the GL.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RepairTypeMappingTable({ mappings, reference }: { mappings: RepairTypeMapping[]; reference?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className={`text-left text-xs uppercase tracking-wider ${reference ? 'bg-gray-100 text-gray-500' : 'bg-gray-50 text-gray-500'}`}>
            <th className="px-5 py-2">Code</th>
            <th className="px-5 py-2">Description</th>
            <th className="px-5 py-2">Warranty GL</th>
            <th className="px-5 py-2">Write-off Max</th>
            <th className="px-5 py-2">CR Write-off</th>
            <th className="px-5 py-2">Write-off GL</th>
          </tr>
        </thead>
        <tbody>
          {mappings.map((rt, i) => (
            <tr key={rt.code} className={`border-t border-gray-100 ${i % 2 === 0 ? '' : 'bg-gray-50/50'}`}>
              <td className="px-5 py-2 font-mono font-medium text-gray-800">{rt.code}</td>
              <td className="px-5 py-2 text-gray-700">{rt.description}</td>
              <td className="px-5 py-2 font-mono text-blue-700">{rt.warrantyGLAccount}</td>
              <td className="px-5 py-2 text-right">${rt.smallBalanceWriteoffMax.toFixed(2)}</td>
              <td className="px-5 py-2">{rt.writeOffCRBalance ? '✓' : '—'}</td>
              <td className="px-5 py-2 font-mono">
                <span className={rt.writeOffGLAccount === '65400' ? 'text-gray-700' : 'text-amber-700 font-semibold'}>
                  {rt.writeOffGLAccount}
                </span>
                {rt.writeOffGLAccount !== '65400' && (
                  <span className="text-[10px] text-amber-500 ml-1">≠ default</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TAB 5: Access & Permissions
// ═══════════════════════════════════════════════════════════════════

function AccessPermissionsTab({ roles, selectedRole, setSelectedRole }: {
  roles: AccountingRole[]; selectedRole: string | null; setSelectedRole: (r: string | null) => void;
}) {
  const activeRole = roles.find(r => r.roleId === selectedRole);
  const schedules = LEE_HYUNDAI_SCHEDULES;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Access & Permissions</h2>
        <button className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + New Role
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Role list */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Roles</h3>
          {roles.map(role => (
            <button key={role.roleId}
              onClick={() => setSelectedRole(role.roleId)}
              className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                selectedRole === role.roleId
                  ? 'border-blue-500 bg-blue-50 text-blue-800'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <div className="font-medium text-sm">{role.roleName}</div>
              <div className="text-xs text-gray-500 mt-0.5">{role.userCount} user{role.userCount !== 1 ? 's' : ''}</div>
            </button>
          ))}
        </div>

        {/* Permission matrices */}
        {activeRole && (
          <div className="lg:col-span-3 space-y-6">
            {/* Journal Source Permissions */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">Journal Source Permissions — {activeRole.roleName}</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-100">
                    <th className="px-5 py-2">Source</th>
                    <th className="px-5 py-2">Name</th>
                    <th className="px-5 py-2 text-center">Can Post</th>
                    <th className="px-5 py-2 text-center">Can Reverse</th>
                    <th className="px-5 py-2 text-center">Dual Approval</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRole.journalSourcePermissions.map(perm => (
                    <tr key={perm.sourceCode} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-2 font-mono font-medium text-gray-800">{perm.sourceCode}</td>
                      <td className="px-5 py-2 text-gray-700">{perm.sourceName}</td>
                      <td className="px-5 py-2 text-center">
                        <PermissionBadge allowed={perm.canPost} />
                      </td>
                      <td className="px-5 py-2 text-center">
                        <PermissionBadge allowed={perm.canReverse} />
                      </td>
                      <td className="px-5 py-2 text-center">
                        {perm.requiresDualApproval
                          ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Required</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Schedule Access Matrix */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">Schedule Permissions — {activeRole.roleName}</h3>
                <p className="text-xs text-gray-500 mt-1">43 schedules · Payroll-restricted: {[...PAYROLL_SCHEDULE_NUMBERS].join(', ')} · Service-visible: {[...SERVICE_SCHEDULE_NUMBERS].join(', ')}</p>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {schedules.map(sched => {
                    const isPayroll = PAYROLL_SCHEDULE_NUMBERS.has(sched.scheduleNumber);
                    const isService = SERVICE_SCHEDULE_NUMBERS.has(sched.scheduleNumber);
                    const hasAccess = activeRole.roleId === 'controller' ||
                      (activeRole.roleId === 'payroll-admin' && isPayroll) ||
                      (activeRole.roleId === 'svc-manager' && isService) ||
                      (activeRole.roleId === 'acct-clerk' && !isPayroll) ||
                      activeRole.roleId === 'auditor';
                    const viewOnly = activeRole.roleId === 'auditor' || activeRole.roleId === 'svc-manager';

                    return (
                      <div key={sched.scheduleNumber}
                        className={`px-2 py-1.5 rounded text-xs border ${
                          !hasAccess ? 'bg-gray-50 border-gray-200 text-gray-400'
                          : viewOnly ? 'bg-blue-50 border-blue-200 text-blue-700'
                          : 'bg-green-50 border-green-200 text-green-800'
                        }`}
                        title={sched.title}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-medium">#{sched.scheduleNumber}</span>
                          <span>
                            {!hasAccess ? '🚫' : viewOnly ? '👁️' : '✏️'}
                          </span>
                        </div>
                        <div className="truncate mt-0.5 text-[10px]">{sched.title}</div>
                        {isPayroll && <span className="text-[9px] text-amber-600">💰 Payroll</span>}
                        {isService && <span className="text-[9px] text-blue-600">🔧 Service</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-4 text-xs text-gray-500">
                  <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-300" /> Full Access (view/print/edit)</div>
                  <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-300" /> View/Print Only</div>
                  <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-200" /> No Access</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PermissionBadge({ allowed }: { allowed: boolean }) {
  return allowed
    ? <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs">✓</span>
    : <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-400 text-xs">✗</span>;
}

// ═══════════════════════════════════════════════════════════════════
// TAB 6: Service EOD
// ═══════════════════════════════════════════════════════════════════

function ServiceEODTab({ config, setConfig, editing, setEditing }: {
  config: ServiceEODConfig; setConfig: (c: ServiceEODConfig) => void;
  editing: boolean; setEditing: (b: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Service End-of-Day Configuration</h2>
        <button
          onClick={() => setEditing(!editing)}
          className={`px-4 py-2 text-sm font-medium rounded-lg ${
            editing ? 'bg-gray-200 text-gray-700' : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {/* Last run status */}
      <div className={`rounded-xl p-5 border ${
        config.lastRunStatus === 'success' ? 'bg-green-50 border-green-200' :
        config.lastRunStatus === 'failed' ? 'bg-red-50 border-red-300' :
        'bg-gray-50 border-gray-200'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            config.lastRunStatus === 'success' ? 'bg-green-500' :
            config.lastRunStatus === 'failed' ? 'bg-red-500 animate-pulse' :
            'bg-gray-400'
          }`} />
          <span className={`text-sm font-semibold ${
            config.lastRunStatus === 'success' ? 'text-green-800' :
            config.lastRunStatus === 'failed' ? 'text-red-800' :
            'text-gray-600'
          }`}>
            Last EOD: {config.lastRunTimestamp ? fmtDatetime(config.lastRunTimestamp) : 'Never Run'}
            {config.lastRunStatus && ` — ${config.lastRunStatus === 'success' ? 'Completed Successfully' : 'FAILED'}`}
          </span>
        </div>
        {config.lastRunStatus === 'failed' && (
          <p className="text-sm text-red-700 mt-2">⚠ Service EOD failed. Check notification recipients. Open ROs may not have been closed to WIP (GL 2470).</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* EOD Method */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">EOD Method</h3>
          <div className="space-y-2">
            {Object.entries(EOD_METHOD_LABELS).map(([code, label]) => (
              <button key={code}
                onClick={() => editing && setConfig({ ...config, eodMethod: code as ServiceEODMethod })}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                  config.eodMethod === code
                    ? 'border-blue-500 bg-blue-50'
                    : editing ? 'border-gray-200 hover:border-gray-300' : 'border-gray-200 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{label}</span>
                    <span className="text-xs text-gray-400 ml-2">({code})</span>
                  </div>
                  {config.eodMethod === code && <span className="text-blue-600">●</span>}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {code === 'M' && 'Controller manually initiates end-of-day processing'}
                  {code === 'A' && 'Runs automatically at a configured time each day'}
                  {code === 'B' && 'Runs as part of the nightly batch processing window'}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Auto Run Time & Password */}
        <div className="space-y-6">
          {/* Auto-run time (only for Automatic method) */}
          {config.eodMethod === ServiceEODMethod.AUTOMATIC && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Automatic Run Time</h3>
              <input
                type="time"
                value={config.autoRunTime ?? ''}
                onChange={e => setConfig({ ...config, autoRunTime: e.target.value || null })}
                readOnly={!editing}
                className="border border-gray-300 rounded-lg px-3 py-2 text-lg font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {config.autoRunTime === null && (
                <div className="mt-2 bg-red-50 rounded-lg px-3 py-2">
                  <p className="text-xs text-red-700">⚠ Auto run time is required when method is Automatic.</p>
                </div>
              )}
              <div className="mt-3">
                <p className="text-xs text-gray-500">Service EOD closes open ROs to WIP (GL 2470) and updates service loaner schedule (13).</p>
              </div>
            </div>
          )}

          {/* EOD Process Password */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">EOD Process Password</h3>
            <p className="text-xs text-gray-500 mb-3">Separate from user login — process password known to the service manager. Minimum 8 characters.</p>
            <button className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
              🔑 Reset EOD Password
            </button>
          </div>

          {/* Notification List */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Notification Recipients</h3>
            <p className="text-xs text-gray-500 mb-3">Notified when EOD runs or fails. Failed EOD notifications are critical — do not fail silently.</p>
            <div className="space-y-2">
              {config.notifyUserIds.map((uid, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-200 text-blue-800 text-xs flex items-center justify-center font-medium">
                      {uid.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm text-gray-700">{uid}</span>
                  </div>
                  {editing && (
                    <button onClick={() => setConfig({ ...config, notifyUserIds: config.notifyUserIds.filter((_, j) => j !== i) })}
                      className="text-xs text-red-500 hover:text-red-700">Remove</button>
                  )}
                </div>
              ))}
            </div>
            {editing && (
              <button className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium">
                + Add Recipient
              </button>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <div className="flex justify-end gap-3 pt-4">
          <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
            Save Changes
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Shared Components
// ═══════════════════════════════════════════════════════════════════

function FieldRow({ label, value, editing, onChange, readonly, hint }: {
  label: string; value: string; editing?: boolean; onChange?: (v: string) => void;
  readonly?: boolean; hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</label>
      {editing && !readonly ? (
        <input type="text" value={value} onChange={e => onChange?.(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{value}</span>
          {readonly && <span className="text-[10px] text-gray-400">🔒</span>}
        </div>
      )}
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange?.(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
      active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
    }`}>
      {active ? 'ON' : 'OFF'}
    </span>
  );
}
