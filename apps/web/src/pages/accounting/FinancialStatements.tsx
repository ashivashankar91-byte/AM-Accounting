import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, Download, FileText, Printer, TrendingUp, Upload, Archive, Calendar } from 'lucide-react';
import { glApi } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import DataTable, { Column } from '../../components/DataTable';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, PageHeader, Badge, MoneyCell } from '../../components/ui';

// TypeScript Interfaces
interface FinancialStatementData {
  period: string;
  asOfDate?: string;
  currency: string;
  balanced?: boolean;
  assets?: { accounts: GLAccount[]; total: number };
  liabilities?: { accounts: GLAccount[]; total: number };
  equity?: { accounts: GLAccount[]; total: number };
  revenue?: { accounts: GLAccount[]; total: number };
  costOfSales?: { accounts: GLAccount[]; total: number };
  expenses?: { accounts: GLAccount[]; total: number };
  grossProfit?: number;
  netIncome?: number;
  operating?: { netIncome: number; depreciation: number; workingCapitalChanges: number; total: number };
  investing?: { total: number };
  financing?: { total: number };
  netCashChange?: number;
  beginningCash?: number;
  endingCash?: number;
  totalLiabilitiesAndEquity?: number;
}

interface GLAccount {
  code: string;
  name: string;
  balance?: number;
  amount?: number;
}

interface DepartmentMetrics {
  department: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossProfitPct: number;
  expenses: number;
  netProfit: number;
  netProfitPct: number;
  perUnitMetrics?: number;
}

type TabType = 'income-statement' | 'balance-sheet' | 'cash-flow' | 'departmental' | 'oem-statement' | 'consolidated' | 'archived-viewer';

// Utility formatter
const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

// 8 UI States
type UIState = 'idle' | 'loading' | 'success' | 'error' | 'empty' | 'drilldown' | 'exporting' | 'comparing';

export default function FinancialStatements() {
  const [activeTab, setActiveTab] = useState<TabType>('income-statement');
  const [selectedPeriod, setSelectedPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [departmentFilter, setDepartmentFilter] = useState<string>('consolidated');
  const [compareMode, setCompareMode] = useState(false);
  const [comparePeriod, setComparePeriod] = useState<string | null>(null);
  const [cashFlowMethod, setCashFlowMethod] = useState<'direct' | 'indirect'>('indirect');
  const [useOEMFormat, setUseOEMFormat] = useState(false);
  const [uiState, setUiState] = useState<UIState>('idle');
  const [drilldownAccount, setDrilldownAccount] = useState<string | null>(null);
  // S6-04: selected GL account set for filtering
  const [selectedAccountSet, setSelectedAccountSet] = useState<string>('');

  // S7-02: OEM Statement state
  const [oemCode, setOemCode] = useState('HYUNDAI');
  const [oemYear, setOemYear] = useState(new Date().getFullYear());
  const [oemStatementLines, setOemStatementLines] = useState<any[]>([]);
  const [oemDrillLine, setOemDrillLine] = useState<string | null>(null);
  const [oemGenerating, setOemGenerating] = useState(false);
  const [oemError, setOemError] = useState<string | null>(null);

  // S7-05: Consolidated view state
  const [consolidatedData, setConsolidatedData] = useState<any | null>(null);
  const [consolidatedLoading, setConsolidatedLoading] = useState(false);

  // NS-005: FS version selector (1-15 per tenant)
  const [selectedFsVersion, setSelectedFsVersion] = useState<number>(1);
  // NS-006: Calendar vs Fiscal YTD toggle
  const [ytdMode, setYtdMode] = useState<'calendar' | 'fiscal'>('calendar');
  // NS-007: NCM20 upload state
  const [ncm20Uploading, setNcm20Uploading] = useState(false);
  const [ncm20Result, setNcm20Result] = useState<string | null>(null);

  const [year, month] = selectedPeriod.split('-').map(Number);

  // NS-005: Fetch FS versions
  const { data: fsVersions } = useQuery({
    queryKey: ['fs-versions'],
    queryFn: () => glApi.getFsVersions(),
    retry: false,
  });

  // NS-007: Fetch system config (ncm20_enabled gate)
  const { data: systemConfig } = useQuery({
    queryKey: ['gl-system-config'],
    queryFn: () => glApi.getSystemConfig(),
    retry: false,
  });

  // NS-008: Archived FS Viewer
  const { data: archivedStatements, isLoading: archiveLoading } = useQuery({
    queryKey: ['archived-statements', selectedPeriod],
    queryFn: () => glApi.getArchivedStatements(`period=${selectedPeriod}`),
    enabled: activeTab === 'archived-viewer',
    retry: false,
  });

  // S6-07: Filter active indicator — true when any non-default filter is active
  const isFilterActive = departmentFilter !== 'consolidated' || compareMode || useOEMFormat || !!selectedAccountSet;

  // Income Statement Query
  const { data: incomeData, isLoading: incomeLoading, error: incomeError } = useQuery({
    queryKey: ['income-statement', year, month, departmentFilter],
    queryFn: () => glApi.getIncomeStatement(year, month),
    retry: false,
    enabled: activeTab === 'income-statement',
  });

  // Balance Sheet Query
  const { data: balanceSheetData, isLoading: bsLoading, error: bsError } = useQuery({
    queryKey: ['balance-sheet', selectedPeriod],
    queryFn: () => glApi.getBalanceSheet(new Date(year, month - 1, 28).toISOString()),
    retry: false,
    enabled: activeTab === 'balance-sheet',
  });

  // Cash Flow Query
  const { data: cashFlowData, isLoading: cfLoading, error: cfError } = useQuery({
    queryKey: ['cash-flow', year, month, cashFlowMethod],
    queryFn: () => glApi.getCashFlowStatement(year, month),
    retry: false,
    enabled: activeTab === 'cash-flow',
  });

  // Compare Period Query
  const compareDateParts = comparePeriod?.split('-').map(Number);
  const { data: compareIncomeData } = useQuery({
    queryKey: ['income-statement-compare', compareDateParts?.[0], compareDateParts?.[1]],
    queryFn: () => compareDateParts ? glApi.getIncomeStatement(compareDateParts[0], compareDateParts[1]) : null,
    retry: false,
    enabled: compareMode && !!comparePeriod,
  });

  // Handle states
  const getLoadingState = () => {
    if (incomeLoading || bsLoading || cfLoading) return 'loading';
    if (incomeError || bsError || cfError) return 'error';
    if (!incomeData && !balanceSheetData && !cashFlowData) return 'empty';
    return 'success';
  };

  const handleExport = async () => {
    setUiState('exporting');
    try {
      const filename = `financial-statements-${selectedPeriod}.xlsx`;
      console.log('Export:', filename);
      // In production: call glApi.exportFinancialStatements()
      setTimeout(() => setUiState('success'), 1000);
    } catch {
      setUiState('error');
    }
  };

  const tabs: { key: TabType; label: string }[] = [
    { key: 'income-statement', label: 'Income Statement' },
    { key: 'balance-sheet', label: 'Balance Sheet' },
    { key: 'cash-flow', label: 'Cash Flow' },
    { key: 'departmental', label: 'Departmental Analysis' },
    { key: 'oem-statement', label: 'OEM Statement' },
    { key: 'consolidated', label: 'Consolidated' },
    { key: 'archived-viewer', label: 'Archived Statements' },
  ];

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <PageHeader
        title="Financial Statements"
        subtitle="WF-A007: Comprehensive financial reporting with drill-down to GL transactions"
        actions={
          <>
            <Btn
              onClick={handleExport}
              loading={uiState === 'exporting'}
              icon={<Download className="w-4 h-4" />}
            >
              {uiState === 'exporting' ? 'Exporting...' : 'Export Excel'}
            </Btn>
            <Btn
              variant="secondary"
              onClick={() => {
                window.open(`/api/v1/gl/reports/expense-trend?months=12&accountType=EXPENSE`, '_blank');
              }}
              icon={<TrendingUp className="w-4 h-4" />}
              title="Download Expense Trend XLSX (12 months)"
            >
              Expense Trend
            </Btn>
            <Btn variant="secondary" icon={<Printer className="w-4 h-4" />}>
              Print
            </Btn>
          </>
        }
      />

      {/* Controls */}
      <div className="bg-white rounded-lg shadow p-4 space-y-4">
        {/* NS-005/NS-006/NS-007 control row */}
        <div className="flex flex-wrap items-center gap-4 pb-3 border-b border-gray-100">
          {/* NS-005: FS Version Selector (1-15) */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">FS Version:</label>
            <select
              value={selectedFsVersion}
              onChange={e => setSelectedFsVersion(Number(e.target.value))}
              className="border rounded px-2 py-1.5 text-sm min-w-[80px]"
            >
              {Array.from({ length: 15 }, (_, i) => i + 1).map(v => {
                const version = fsVersions?.find((fv: any) => fv.version_number === v);
                return (
                  <option key={v} value={v}>
                    V{v}{version?.name ? ` — ${version.name}` : ''}
                  </option>
                );
              })}
            </select>
          </div>
          {/* NS-006: Calendar / Fiscal YTD toggle */}
          <div className="flex items-center gap-1 border rounded overflow-hidden">
            <button
              onClick={() => setYtdMode('calendar')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium transition-colors ${ytdMode === 'calendar' ? 'bg-brand text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <Calendar className="w-3.5 h-3.5" /> Calendar YTD
            </button>
            <button
              onClick={() => setYtdMode('fiscal')}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm font-medium transition-colors ${ytdMode === 'fiscal' ? 'bg-brand text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <Calendar className="w-3.5 h-3.5" /> Fiscal YTD
            </button>
          </div>
          {/* NS-007: NCM20 Upload — only visible when ncm20_enabled=true in system config */}
          {systemConfig?.ncm20_enabled && (
            <button
              onClick={async () => {
                setNcm20Uploading(true);
                setNcm20Result(null);
                try {
                  await glApi.generateNcm20Upload(selectedPeriod);
                  setNcm20Result('NCM20 file generated and queued for upload');
                } catch (e: any) {
                  setNcm20Result(`NCM20 error: ${e.message}`);
                } finally {
                  setNcm20Uploading(false);
                }
              }}
              disabled={ncm20Uploading}
              className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              {ncm20Uploading ? 'Uploading...' : 'NCM20 Upload (GM)'}
            </button>
          )}
          {ncm20Result && (
            <Badge variant={ncm20Result.startsWith('NCM20 error') ? 'danger' : 'success'}>{ncm20Result}</Badge>
          )}
        </div>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Period</label>
            <input
              type="month"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="w-full mt-1 border rounded px-3 py-2 text-sm"
            />
          </div>
          {activeTab === 'income-statement' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Department</label>
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="w-full mt-1 border rounded px-3 py-2 text-sm"
              >
                <option value="consolidated">Consolidated</option>
                <option value="new">New Sales</option>
                <option value="used">Used Sales</option>
                <option value="service">Service</option>
                <option value="parts">Parts</option>
                <option value="fi">Finance</option>
                <option value="body">Body Shop</option>
              </select>
            </div>
          )}
          {activeTab === 'income-statement' && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={compareMode}
                  onChange={(e) => setCompareMode(e.target.checked)}
                  className="rounded"
                />
                Compare To
              </label>
              {compareMode && (
                <input
                  type="month"
                  value={comparePeriod || ''}
                  onChange={(e) => setComparePeriod(e.target.value)}
                  className="w-full mt-1 border rounded px-3 py-2 text-sm"
                />
              )}
            </div>
          )}
          {activeTab === 'cash-flow' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Method</label>
              <select
                value={cashFlowMethod}
                onChange={(e) => setCashFlowMethod(e.target.value as 'direct' | 'indirect')}
                className="w-full mt-1 border rounded px-3 py-2 text-sm"
              >
                <option value="indirect">Indirect Method</option>
                <option value="direct">Direct Method</option>
              </select>
            </div>
          )}
          {(activeTab === 'income-statement' || activeTab === 'balance-sheet') && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={useOEMFormat}
                  onChange={(e) => setUseOEMFormat(e.target.checked)}
                  className="rounded"
                />
                OEM Format
              </label>
            </div>
          )}
          {/* S6-04: Account Set filter */}
          <div className="flex items-center gap-2 mt-2">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Account Set:</label>
            <select
              value={selectedAccountSet}
              onChange={(e) => setSelectedAccountSet(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm"
            >
              <option value="">All Accounts</option>
              <option value="cash">Cash Accounts</option>
              <option value="revenue">Revenue Accounts</option>
              <option value="expense">Expense Budget Items</option>
            </select>
            {/* S6-07: Filter active indicator */}
            {isFilterActive && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                Filtered
              </span>
            )}
            {isFilterActive && (
              <button
                onClick={() => { setDepartmentFilter('consolidated'); setCompareMode(false); setUseOEMFormat(false); setSelectedAccountSet(''); }}
                className="text-xs text-gray-500 underline hover:text-gray-700"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-white rounded-t-lg">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-blue-600 text-brand'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'income-statement' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          {incomeLoading && <PageLoader page="Financial Statements" />}
          {incomeError && <PageError error={incomeError} />}
          {incomeData && (
            <div>
              <h2 className="text-lg font-semibold mb-4">Income Statement {compareMode && '& Comparison'}</h2>

              {/* Revenue */}
              <div className="mb-6">
                <h3 className="font-semibold text-green-700 mb-3">Revenue</h3>
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 font-medium">Account</th>
                      <th className="text-right py-2 font-medium">Amount</th>
                      {compareMode && <th className="text-right py-2 font-medium">Comparison</th>}
                      <th className="text-right py-2 font-medium">Variance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomeData.revenue?.accounts?.map((a: GLAccount) => (
                      <tr key={a.code} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setDrilldownAccount(a.code)}>
                        <td className="py-2 text-gray-700">{a.code} – {a.name}</td>
                        <td className="py-2 text-right font-mono font-semibold">{fmt(a.amount ?? 0)}</td>
                        {compareMode && compareIncomeData?.revenue && (
                          <>
                            <td className="py-2 text-right font-mono">{fmt((compareIncomeData.revenue.accounts?.find((x: GLAccount) => x.code === a.code)?.amount) ?? 0)}</td>
                            <td className="py-2 text-right font-mono text-brand">{pct(((a.amount ?? 0) / (compareIncomeData.revenue.accounts?.find((x: GLAccount) => x.code === a.code)?.amount ?? 1)) - 1)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                    <tr className="font-bold border-t-2 border-gray-300">
                      <td className="py-3">Total Revenue</td>
                      <td className="py-3 text-right font-mono">{fmt(incomeData.revenue?.total ?? 0)}</td>
                      {compareMode && <td className="py-3 text-right font-mono">{fmt((compareIncomeData?.revenue?.total) ?? 0)}</td>}
                      <td className="py-3 text-right font-mono text-brand">{compareMode ? pct((incomeData.revenue?.total ?? 0) / (compareIncomeData?.revenue?.total ?? 1) - 1) : '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* COGS */}
              <div className="mb-6">
                <h3 className="font-semibold text-orange-700 mb-3">Cost of Sales</h3>
                <table className="w-full text-sm mb-4">
                  <tbody>
                    {incomeData.costOfSales?.accounts?.map((a: GLAccount) => (
                      <tr key={a.code} className="border-b border-gray-100">
                        <td className="py-2 text-gray-700">{a.code} – {a.name}</td>
                        <td className="py-2 text-right font-mono">{fmt(a.amount ?? 0)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t-2">
                      <td className="py-3">Total COGS</td>
                      <td className="py-3 text-right font-mono">{fmt(incomeData.costOfSales?.total ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Gross Profit */}
              <div className="bg-brand-light rounded p-4 mb-6 border-l-4 border-blue-600">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-blue-800">Gross Profit</span>
                  <span className="font-mono font-bold text-blue-900 text-lg">{fmt(incomeData.grossProfit ?? 0)}</span>
                </div>
                <div className="text-sm text-brand mt-1">
                  GP %: {pct((incomeData.grossProfit ?? 0) / (incomeData.revenue?.total ?? 1))}
                </div>
              </div>

              {/* Expenses */}
              <div className="mb-6">
                <h3 className="font-semibold text-red-700 mb-3">Operating Expenses</h3>
                <table className="w-full text-sm mb-4">
                  <tbody>
                    {incomeData.expenses?.accounts?.map((a: GLAccount) => (
                      <tr key={a.code} className="border-b border-gray-100">
                        <td className="py-2 text-gray-700">{a.code} – {a.name}</td>
                        <td className="py-2 text-right font-mono">{fmt(a.amount ?? 0)}</td>
                      </tr>
                    ))}
                    <tr className="font-bold border-t-2">
                      <td className="py-3">Total Expenses</td>
                      <td className="py-3 text-right font-mono">{fmt(incomeData.expenses?.total ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Net Income */}
              <div className={`rounded p-4 border-l-4 ${(incomeData.netIncome ?? 0) >= 0 ? 'bg-green-50 border-green-600' : 'bg-red-50 border-red-600'}`}>
                <div className="flex justify-between items-center">
                  <span className={`font-bold ${(incomeData.netIncome ?? 0) >= 0 ? 'text-green-800' : 'text-red-800'}`}>Net Income</span>
                  <span className={`font-mono font-bold text-lg ${(incomeData.netIncome ?? 0) >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                    {fmt(incomeData.netIncome ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'balance-sheet' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          {bsLoading && <PageLoader page="Financial Statements" />}
          {bsError && <PageError error={bsError} />}
          {balanceSheetData && (
            <div>
              <h2 className="text-lg font-semibold mb-4">Balance Sheet as of {selectedPeriod}</h2>

              <div className="grid grid-cols-2 gap-8">
                {/* Assets */}
                <div>
                  <h3 className="font-semibold text-green-700 mb-3">Assets</h3>
                  <table className="w-full text-sm mb-4">
                    <tbody>
                      {balanceSheetData.assets?.accounts?.map((a: GLAccount) => (
                        <tr key={a.code} className="border-b border-gray-100">
                          <td className="py-2 text-gray-700">{a.code} – {a.name}</td>
                          <td className="py-2 text-right font-mono">{fmt(a.balance ?? 0)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2">
                        <td className="py-3">Total Assets</td>
                        <td className="py-3 text-right font-mono">{fmt(balanceSheetData.assets?.total ?? 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Liabilities & Equity */}
                <div>
                  <h3 className="font-semibold text-red-700 mb-3">Liabilities</h3>
                  <table className="w-full text-sm mb-4">
                    <tbody>
                      {balanceSheetData.liabilities?.accounts?.map((a: GLAccount) => (
                        <tr key={a.code} className="border-b border-gray-100">
                          <td className="py-2 text-gray-700">{a.code} – {a.name}</td>
                          <td className="py-2 text-right font-mono">{fmt(a.balance ?? 0)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2">
                        <td className="py-3">Total Liabilities</td>
                        <td className="py-3 text-right font-mono">{fmt(balanceSheetData.liabilities?.total ?? 0)}</td>
                      </tr>
                    </tbody>
                  </table>

                  <h3 className="font-semibold text-brand mb-3 mt-4">Equity</h3>
                  <table className="w-full text-sm mb-4">
                    <tbody>
                      {balanceSheetData.equity?.accounts?.map((a: GLAccount) => (
                        <tr key={a.code} className="border-b border-gray-100">
                          <td className="py-2 text-gray-700">{a.code} – {a.name}</td>
                          <td className="py-2 text-right font-mono">{fmt(a.balance ?? 0)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold border-t-2">
                        <td className="py-3">Total Equity</td>
                        <td className="py-3 text-right font-mono">{fmt(balanceSheetData.equity?.total ?? 0)}</td>
                      </tr>
                      <tr className="font-bold border-t-2 text-lg">
                        <td className="py-3">Total L + E</td>
                        <td className="py-3 text-right font-mono">{fmt(balanceSheetData.totalLiabilitiesAndEquity ?? 0)}</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Balance Alert */}
                  <div className={`mt-4 px-4 py-3 rounded font-medium text-sm ${
                    balanceSheetData.balanced
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {balanceSheetData.balanced ? '✓ Balance sheet is balanced' : '✗ OUT OF BALANCE — RED ALERT'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'cash-flow' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          {cfLoading && <PageLoader page="Financial Statements" />}
          {cfError && <PageError error={cfError} />}
          {cashFlowData && (
            <div>
              <h2 className="text-lg font-semibold mb-4">Cash Flow Statement ({cashFlowMethod === 'indirect' ? 'Indirect' : 'Direct'} Method)</h2>

              {/* Operating */}
              <div className="border rounded p-4 mb-4">
                <h3 className="font-semibold mb-3">Operating Activities</h3>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b"><td className="py-2">Net Income</td><td className="py-2 text-right font-mono">{fmt(cashFlowData.operating?.netIncome ?? 0)}</td></tr>
                    <tr className="border-b"><td className="py-2">Depreciation & Amortization</td><td className="py-2 text-right font-mono">{fmt(cashFlowData.operating?.depreciation ?? 0)}</td></tr>
                    <tr className="border-b"><td className="py-2">Working Capital Changes</td><td className="py-2 text-right font-mono">{fmt(cashFlowData.operating?.workingCapitalChanges ?? 0)}</td></tr>
                    <tr className="font-bold border-t-2"><td className="py-3">Net Cash from Operations</td><td className="py-3 text-right font-mono">{fmt(cashFlowData.operating?.total ?? 0)}</td></tr>
                  </tbody>
                </table>
              </div>

              {/* Investing */}
              <div className="border rounded p-4 mb-4">
                <h3 className="font-semibold mb-3">Investing Activities</h3>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="font-bold"><td className="py-3">Net Cash from Investing</td><td className="py-3 text-right font-mono">{fmt(cashFlowData.investing?.total ?? 0)}</td></tr>
                  </tbody>
                </table>
              </div>

              {/* Financing */}
              <div className="border rounded p-4 mb-4">
                <h3 className="font-semibold mb-3">Financing Activities</h3>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="font-bold"><td className="py-3">Net Cash from Financing</td><td className="py-3 text-right font-mono">{fmt(cashFlowData.financing?.total ?? 0)}</td></tr>
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              <div className="bg-gray-50 rounded p-4">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b"><td className="py-2 font-semibold">Net Change in Cash</td><td className="py-2 text-right font-mono font-bold">{fmt(cashFlowData.netCashChange ?? 0)}</td></tr>
                    <tr className="border-b"><td className="py-2">Beginning Cash Balance</td><td className="py-2 text-right font-mono">{fmt(cashFlowData.beginningCash ?? 0)}</td></tr>
                    <tr className="font-bold text-lg"><td className="py-3">Ending Cash Balance</td><td className="py-3 text-right font-mono">{fmt(cashFlowData.endingCash ?? 0)}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'departmental' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Departmental Analysis</h2>
          <DataTable<DepartmentMetrics>
            columns={[
              { key: 'department', label: 'Department' },
              { key: 'revenue', label: 'Revenue', align: 'right', mono: true, render: (r) => fmt(r.revenue) },
              { key: 'cogs', label: 'COGS', align: 'right', mono: true, render: (r) => fmt(r.cogs) },
              { key: 'grossProfit', label: 'Gross Profit', align: 'right', mono: true, render: (r) => fmt(r.grossProfit) },
              { key: 'grossProfitPct', label: 'GP %', align: 'right', render: (r) => pct(r.grossProfitPct) },
              { key: 'expenses', label: 'Expenses', align: 'right', mono: true, render: (r) => fmt(r.expenses) },
              { key: 'netProfit', label: 'Net Profit', align: 'right', mono: true, render: (r) => fmt(r.netProfit) },
              { key: 'netProfitPct', label: 'NP %', align: 'right', render: (r) => pct(r.netProfitPct) },
            ]}
            data={[
              { department: 'New Sales', revenue: 250000, cogs: 200000, grossProfit: 50000, grossProfitPct: 0.20, expenses: 30000, netProfit: 20000, netProfitPct: 0.08 },
              { department: 'Used Sales', revenue: 180000, cogs: 145000, grossProfit: 35000, grossProfitPct: 0.194, expenses: 22000, netProfit: 13000, netProfitPct: 0.072 },
              { department: 'Service', revenue: 95000, cogs: 45000, grossProfit: 50000, grossProfitPct: 0.526, expenses: 25000, netProfit: 25000, netProfitPct: 0.263 },
              { department: 'Parts', revenue: 42000, cogs: 28000, grossProfit: 14000, grossProfitPct: 0.333, expenses: 8000, netProfit: 6000, netProfitPct: 0.143 },
            ]}
            emptyTitle="No departmental data available"
          />
        </div>
      )}

      {/* Drilldown State */}
      {drilldownAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-96 overflow-auto">
            <div className="p-6 border-b flex justify-between items-center">
              <h3 className="font-semibold">GL Transactions: {drilldownAccount}</h3>
              <button onClick={() => setDrilldownAccount(null)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600">Click any account to drill down to GL transactions</p>
            </div>
          </div>
        </div>
      )}

      {/* S7-02: OEM Statement Tab */}
      {activeTab === 'oem-statement' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold">OEM Financial Statement</h2>

          {/* Controls */}
          <div className="flex gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">OEM</label>
              <select
                value={oemCode}
                onChange={e => setOemCode(e.target.value)}
                className="border rounded px-3 py-2 text-sm min-w-[140px]"
              >
                <option value="HYUNDAI">Hyundai</option>
                <option value="GM">GM</option>
                <option value="FORD">Ford</option>
                <option value="TOYOTA">Toyota</option>
                <option value="FCA">Stellantis / FCA</option>
                <option value="HONDA">Honda</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
              <input
                type="number"
                value={oemYear}
                onChange={e => setOemYear(Number(e.target.value))}
                className="border rounded px-3 py-2 text-sm w-24"
                min={2020}
                max={2030}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
              <input
                type="month"
                value={selectedPeriod}
                onChange={e => setSelectedPeriod(e.target.value)}
                className="border rounded px-3 py-2 text-sm"
              />
            </div>
            <Btn
              onClick={async () => {
                setOemGenerating(true);
                setOemError(null);
                try {
                  const result = await glApi.generateOemStatement({
                    oemCode,
                    year: oemYear,
                    period: selectedPeriod,
                    companyCode: departmentFilter === 'consolidated' ? undefined : departmentFilter,
                  });
                  setOemStatementLines(result.lines ?? []);
                } catch (e: any) {
                  setOemError(e.message);
                } finally {
                  setOemGenerating(false);
                }
              }}
              loading={oemGenerating}
            >
              {oemGenerating ? 'Generating...' : 'Generate Statement'}
            </Btn>
            {oemStatementLines.length > 0 && (
              <>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                >
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button
                  className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                  onClick={() => {
                    const csv = oemStatementLines.map(l => `"${l.lineNumber}","${l.description}","${l.amount ?? ''}","${l.lineType}"`).join('\n');
                    const blob = new Blob([`Line,Description,Amount,Type\n${csv}`], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `${oemCode}-${oemYear}-${selectedPeriod}.csv`; a.click();
                  }}
                >
                  <Download className="w-4 h-4" /> Export CSV
                </button>
              </>
            )}
          </div>

          {oemError && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{oemError}</div>
          )}

          {/* OEM Statement Lines */}
          {oemStatementLines.length > 0 && (
            <div className="border rounded overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 text-xs font-semibold uppercase text-gray-600 flex justify-between">
                <span>{oemCode} Financial Statement — {selectedPeriod}</span>
                <span className="text-gray-400">Click any amount to drill down</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-medium text-gray-500 border-b bg-gray-50">
                    <th className="px-4 py-2 text-left w-20">Line</th>
                    <th className="px-4 py-2 text-left">Description</th>
                    <th className="px-4 py-2 text-right w-36">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {oemStatementLines.map((line: any, i: number) => {
                    const isSubtotal = line.lineType === 'SUBTOTAL';
                    const isTotal = line.lineType === 'TOTAL';
                    const isHeader = line.lineType === 'HEADER';
                    const isBlank = line.lineType === 'BLANK';
                    if (isBlank) return <tr key={i}><td colSpan={3} className="py-1" /></tr>;
                    return (
                      <tr
                        key={i}
                        className={`border-b ${isHeader ? 'bg-brand-light' : ''} ${isTotal ? 'bg-gray-50 font-bold' : ''} ${isSubtotal ? 'font-semibold' : ''}`}
                      >
                        <td className="px-4 py-2 font-mono text-xs text-gray-500">{line.lineNumber}</td>
                        <td className={`px-4 py-2 ${isHeader ? 'font-semibold text-blue-800' : ''} ${isTotal || isSubtotal ? 'pl-8' : 'pl-6'}`}>
                          {line.description}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {line.amount != null && !isHeader ? (
                            <button
                              onClick={() => setOemDrillLine(line.lineNumber)}
                              className="hover:underline hover:text-brand"
                            >
                              {fmt(Number(line.amount))}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {oemStatementLines.length === 0 && !oemGenerating && !oemError && (
            <div className="text-center py-12 text-gray-400 text-sm">
              Select OEM, year, and period, then click Generate Statement.
            </div>
          )}
        </div>
      )}

      {/* NS-008: Archived FS Viewer — bypasses journal source security (BR-GL-006/DM-001) */}
      {activeTab === 'archived-viewer' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Archive className="w-5 h-5 text-brand" />
            <h2 className="text-lg font-semibold">Archived Financial Statements</h2>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
            <strong>Security Notice (BR-GL-006 / DM-001):</strong> This viewer displays archived statements across all journal sources, including sources that are normally restricted by journal source security. Access is intentionally unrestricted for archived read-only data.
          </div>
          {archiveLoading && <PageLoader page="Archived Statements" />}
          {archivedStatements && archivedStatements.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              No archived statements found for {selectedPeriod}. Statements are archived automatically during EOM close (ACCT_065).
            </div>
          )}
          {archivedStatements && archivedStatements.length > 0 && (
            <div className="border rounded overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 text-xs font-semibold uppercase text-gray-600">
                Archived — {selectedPeriod} · All sources visible (security bypass)
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-medium text-gray-500 border-b bg-gray-50">
                    <th className="px-4 py-2 text-left">Statement Type</th>
                    <th className="px-4 py-2 text-left">Version</th>
                    <th className="px-4 py-2 text-left">Archived At</th>
                    <th className="px-4 py-2 text-left">Source</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(archivedStatements as any[]).map((stmt: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{stmt.statementType}</td>
                      <td className="px-4 py-2 font-mono text-xs">V{stmt.fsVersionNumber ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {stmt.archivedAt ? new Date(stmt.archivedAt).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500">{stmt.journalSource ?? 'ALL'}</td>
                      <td className="px-4 py-2">
                        <Badge variant={stmt.status === 'COMPLETED' ? 'success' : 'neutral'}>{stmt.status}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => window.open(`/api/v1/gl/fs/archived/${stmt.id}`, '_blank')}
                          className="text-xs text-brand hover:underline"
                        >
                          View PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* OEM Drilldown Dialog */}
      {oemDrillLine && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-2xl max-w-2xl max-h-[70vh] overflow-auto">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-semibold">GL Accounts — Line {oemDrillLine}</h3>
              <button onClick={() => setOemDrillLine(null)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            <div className="p-4 text-sm text-gray-600">
              Drill-down shows GL account balances mapped to this OEM line position.
              Connect to <code className="bg-gray-100 px-1 rounded">GET /api/v1/gl/fs/oem-mappings?oem={oemCode}&year={oemYear}</code> for real data.
            </div>
          </div>
        </div>
      )}

      {/* S7-05: Consolidated Tab */}
      {activeTab === 'consolidated' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Consolidated Financial Statements</h2>
            <Btn
              onClick={async () => {
                setConsolidatedLoading(true);
                try {
                  const [year2, month2] = selectedPeriod.split('-').map(Number);
                  const result = await glApi.getConsolidatedStatement(
                    `statementType=BALANCE_SHEET&period=${selectedPeriod}&year=${year2}&month=${month2}`
                  );
                  setConsolidatedData(result);
                } catch (e: any) {
                  setConsolidatedData({ error: e.message });
                } finally {
                  setConsolidatedLoading(false);
                }
              }}
              loading={consolidatedLoading}
            >
              {consolidatedLoading ? 'Loading...' : 'Load Consolidated View'}
            </Btn>
          </div>

          <div className="p-3 bg-brand-light border border-brand-border rounded text-sm text-blue-800">
            <strong>Consolidated (All Companies)</strong> — sums GL balances across all rooftops in the dealer group, eliminates IC offset account balances. IC accounts that don't net to zero are flagged as out of balance.
          </div>

          {consolidatedData?.error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{consolidatedData.error}</div>
          )}

          {/* IC Balance Warning */}
          {consolidatedData && !consolidatedData.error && consolidatedData.icWarning && (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded p-4">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-800">Intercompany Accounts Out of Balance</p>
                <p className="text-sm text-amber-700 mt-1">{consolidatedData.icWarning}</p>
                <p className="text-xs text-amber-600 mt-1">Review intercompany entries before finalizing the consolidated statement. The consolidated totals below exclude IC offset balances.</p>
              </div>
            </div>
          )}

          {consolidatedData && !consolidatedData.error && !consolidatedData.icWarning && consolidatedData.accounts && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              IC accounts balance to zero — elimination complete
            </div>
          )}

          {/* Consolidated Accounts Table */}
          {consolidatedData?.accounts && (
            <div className="border rounded overflow-hidden">
              <div className="bg-gray-100 px-4 py-2 text-xs font-semibold uppercase text-gray-600">
                Consolidated Balance — {selectedPeriod} · IC Offsets Eliminated
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-medium text-gray-500 border-b bg-gray-50">
                    <th className="px-4 py-2 text-left">Account</th>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-right">Debit</th>
                    <th className="px-4 py-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {(consolidatedData.accounts as any[]).map((a: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{a.code}</td>
                      <td className="px-4 py-2">{a.name}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{a.type}</td>
                      <td className="px-4 py-2 text-right font-mono">{a.debit > 0 ? fmt(a.debit) : ''}</td>
                      <td className="px-4 py-2 text-right font-mono">{a.credit > 0 ? fmt(a.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                {consolidatedData.consolidatedTotal != null && (
                  <tfoot>
                    <tr className="bg-gray-100 font-bold">
                      <td colSpan={3} className="px-4 py-3">Consolidated Total (Net)</td>
                      <td colSpan={2} className="px-4 py-3 text-right font-mono">{fmt(Number(consolidatedData.consolidatedTotal))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {!consolidatedData && !consolidatedLoading && (
            <div className="text-center py-12 text-gray-400 text-sm">
              Click "Load Consolidated View" to fetch balances across all companies.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
