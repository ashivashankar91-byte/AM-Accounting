import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { glApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrialBalanceAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
  priorBalance: string;
  currentAmount: string;
  ytdAmount: string;
}

interface TrialBalanceResponse {
  totalDebits: string;
  totalCredits: string;
  accounts?: TrialBalanceAccount[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEPARTMENT_OPTIONS = [
  { value: 'ALL', label: 'All Departments' },
  { value: 'NEW', label: 'New Vehicle' },
  { value: 'USED', label: 'Used Vehicle' },
  { value: 'SERVICE', label: 'Service' },
  { value: 'PARTS', label: 'Parts' },
  { value: 'FINANCE', label: 'Finance & Insurance' },
  { value: 'BODY_SHOP', label: 'Body Shop' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtMoney(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return '0.00';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

function parseMoney(val: string | number | undefined | null): number {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  return parseFloat(val.replace(/[^0-9.\-]/g, '')) || 0;
}

// ─── CSV Download ─────────────────────────────────────────────────────────────

function downloadCsv(
  accounts: TrialBalanceAccount[],
  company: string,
  year: number,
  month: number,
) {
  // BR-GL-002: 7 fixed columns: COMPNO, GL-ACCTN, GL-TYPE, TOT-PRIOR, TOT-CUR, TOT-YTD-I, CONTNO
  const header = ['COMPNO', 'GL-ACCTN', 'GL-TYPE', 'TOT-PRIOR', 'TOT-CUR', 'TOT-YTD-I', 'CONTNO'];
  const rows = accounts.map((a) => [
    company,
    a.accountCode,
    a.accountType,
    parseMoney(a.priorBalance).toFixed(2),
    parseMoney(a.currentAmount).toFixed(2),
    parseMoney(a.ytdAmount).toFixed(2),
    `${year}${String(month).padStart(2, '0')}`,
  ]);

  const csv = [header, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gl-trial-balance-${company}-${year}-${String(month).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ────────────────────────────────────────────────────────────────

const now = new Date();

export default function GLTrialBalance() {
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [yearType, setYearType] = useState<'calendar' | 'fiscal'>('calendar');
  const [company, setCompany] = useState('01');
  const [department, setDepartment] = useState('ALL');
  const [printZeroBalances, setPrintZeroBalances] = useState(false);
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [shouldFetch, setShouldFetch] = useState(true);

  const {
    data: tbData,
    isLoading,
    error,
    refetch,
  } = useQuery<TrialBalanceResponse>({
    queryKey: ['gl-trial-balance', selectedYear, selectedMonth],
    queryFn: () => glApi.getTrialBalance(selectedYear, selectedMonth),
    enabled: shouldFetch,
    retry: false,
    select: (raw: any): TrialBalanceResponse => ({
      totalDebits: String(raw.totalDebits ?? 0),
      totalCredits: String(raw.totalCredits ?? 0),
      accounts: (raw.accounts ?? []).map((a: any) => ({
        accountCode: a.accountCode,
        accountName: a.accountName,
        accountType: a.accountType,
        priorBalance: String(a.priorBalance ?? a.openingBalance ?? 0),
        currentAmount: String(a.currentAmount ?? a.periodDebits ?? a.debit ?? 0),
        ytdAmount: String(a.ytdAmount ?? (Number(a.openingBalance ?? 0) + Number(a.periodDebits ?? a.debit ?? 0))),
      })),
    }),
  });

  const handleGenerate = useCallback(() => {
    if (shouldFetch) {
      refetch();
    } else {
      setShouldFetch(true);
    }
  }, [shouldFetch, refetch]);

  const handleExportCsv = useCallback(() => {
    const accounts = getFilteredAccounts();
    if (accounts.length > 0) {
      downloadCsv(accounts, company, selectedYear, selectedMonth);
    } else {
      // Fallback — open API export endpoint with query params
      const params = new URLSearchParams({
        year: String(selectedYear),
        month: String(selectedMonth),
        company,
        department,
        fromAccount,
        toAccount,
      });
      window.open(`/api/v1/gl/trial-balance/export?${params.toString()}`, '_blank');
    }
  }, [tbData, company, department, fromAccount, toAccount, selectedYear, selectedMonth]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // Filter and compute accounts
  function getFilteredAccounts(): TrialBalanceAccount[] {
    const raw = tbData?.accounts ?? SAMPLE_ACCOUNTS;

    let filtered = raw;

    if (fromAccount.trim()) {
      filtered = filtered.filter((a) => a.accountCode >= fromAccount.trim());
    }
    if (toAccount.trim()) {
      filtered = filtered.filter((a) => a.accountCode <= toAccount.trim());
    }
    if (!printZeroBalances) {
      filtered = filtered.filter(
        (a) =>
          parseMoney(a.priorBalance) !== 0 ||
          parseMoney(a.currentAmount) !== 0 ||
          parseMoney(a.ytdAmount) !== 0,
      );
    }

    return filtered;
  }

  const filteredAccounts = getFilteredAccounts();

  const totalPrior = filteredAccounts.reduce((s, a) => s + parseMoney(a.priorBalance), 0);
  const totalCurrent = filteredAccounts.reduce((s, a) => s + parseMoney(a.currentAmount), 0);
  const totalYtd = filteredAccounts.reduce((s, a) => s + parseMoney(a.ytdAmount), 0);

  const totalDebits = tbData?.totalDebits != null ? parseMoney(tbData.totalDebits) : null;
  const totalCredits = tbData?.totalCredits != null ? parseMoney(tbData.totalCredits) : null;
  const outOfBalance =
    totalDebits !== null &&
    totalCredits !== null &&
    Math.abs(totalDebits - totalCredits) > 0.005;
  const outOfBalanceAmt = outOfBalance ? Math.abs((totalDebits ?? 0) - (totalCredits ?? 0)) : 0;

  const today = new Date().toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });

  const yearOptions: number[] = [];
  for (let y = 2020; y <= 2030; y++) yearOptions.push(y);

  return (
    <div className="p-7 min-h-full font-[Inter,sans-serif]">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">GL Trial Balance</h1>
        <p className="text-sm text-gray-500 mt-0.5">Program 24 — Print GL Trial Balance</p>
      </div>

      {/* ── SECTION 1: Parameters ────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5 shadow-sm">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Report Parameters</h2>

        <div className="grid grid-cols-[auto_auto_1fr_auto_auto] gap-x-6 gap-y-4 items-end">
          {/* Period */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Month</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="h-8 px-2 border border-gray-300 rounded text-sm font-[Inter,sans-serif] focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} – {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Year</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="h-8 px-2 border border-gray-300 rounded text-sm font-[Inter,sans-serif] focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Year type toggle */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Year Type</label>
            <div className="flex h-8 rounded border border-gray-300 overflow-hidden w-fit">
              <button
                onClick={() => setYearType('calendar')}
                className={`px-3 text-sm font-medium transition-colors ${
                  yearType === 'calendar'
                    ? 'bg-brand text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Calendar
              </button>
              <button
                onClick={() => setYearType('fiscal')}
                className={`px-3 text-sm font-medium border-l border-gray-300 transition-colors ${
                  yearType === 'fiscal'
                    ? 'bg-brand text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Fiscal
              </button>
            </div>
          </div>

          {/* Company */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Company</label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value.slice(0, 4))}
              className="h-8 w-16 px-2 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent uppercase"
              maxLength={4}
              placeholder="01"
            />
          </div>

          {/* Department */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="h-8 px-2 border border-gray-300 rounded text-sm font-[Inter,sans-serif] focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
            >
              {DEPARTMENT_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Second row */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4 mt-4">
          {/* Account range */}
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Account From</label>
              <input
                type="text"
                value={fromAccount}
                onChange={(e) => setFromAccount(e.target.value)}
                placeholder="e.g. 1000"
                className="h-8 w-28 px-2 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
              />
            </div>
            <span className="text-gray-400 text-sm pb-1.5">—</span>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Account To</label>
              <input
                type="text"
                value={toAccount}
                onChange={(e) => setToAccount(e.target.value)}
                placeholder="e.g. 9999"
                className="h-8 w-28 px-2 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
              />
            </div>
          </div>

          {/* Print zero balances */}
          <div className="flex items-center gap-2 pb-1">
            <input
              id="printZero"
              type="checkbox"
              checked={printZeroBalances}
              onChange={(e) => setPrintZeroBalances(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-blue-700"
            />
            <label htmlFor="printZero" className="text-sm text-gray-600 select-none cursor-pointer">
              Include zero-balance accounts
            </label>
          </div>

          {/* Actions — pushed to right */}
          <div className="flex items-center gap-2 ml-auto pb-0.5">
            <button
              onClick={handleGenerate}
              disabled={isLoading}
              className="h-8 px-4 bg-brand text-white text-sm font-semibold rounded hover:bg-brand-hover active:bg-blue-900 disabled:opacity-60 transition-colors"
            >
              {isLoading ? 'Generating…' : 'Generate Report'}
            </button>
            <button
              onClick={handleExportCsv}
              className="h-8 px-4 border border-gray-300 text-gray-700 text-sm font-semibold rounded hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              Export CSV
            </button>
            <button
              onClick={handlePrint}
              className="h-8 px-4 border border-gray-300 text-gray-700 text-sm font-semibold rounded hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              Print
            </button>
          </div>
        </div>
      </div>

      {/* ── Loading / Error ───────────────────────────────────────────────── */}
      {shouldFetch && isLoading && (
        <PageLoader page="Trial Balance" service="gl-service" port={3010} />
      )}

      {shouldFetch && error && !isLoading && (
        <PageError
          error={error as Error}
          serviceName="gl-service"
          port={3010}
          retry={() => refetch()}
        />
      )}

      {/* ── SECTION 2 + 3: Report output ─────────────────────────────────── */}
      {shouldFetch && !isLoading && !error && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {/* Report Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <div className="text-base font-bold text-gray-900 tracking-tight">
                GL TRIAL BALANCE — COMPANY {company.toUpperCase()} — {String(selectedMonth).padStart(2, '0')}/{selectedYear}
              </div>
              <div className="text-xs text-gray-500 mt-0.5 font-mono">
                {yearType === 'fiscal' ? 'FISCAL YEAR' : 'CALENDAR YEAR'} ·{' '}
                DEPT: {department}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 font-mono">PRINT DATE: {today}</div>
              {filteredAccounts.length > 0 && (
                <div className="text-xs text-gray-400 mt-0.5">{filteredAccounts.length} accounts</div>
              )}
            </div>
          </div>

          {/* Report Table */}
          {filteredAccounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <div className="text-4xl mb-3">📊</div>
              <div className="text-sm font-semibold text-gray-600">No accounts match the selected criteria</div>
              <div className="text-xs mt-1">
                {!printZeroBalances && 'Zero-balance accounts are hidden — check "Include zero-balance accounts" to show all.'}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b-2 border-gray-200">
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 font-mono">
                      Account #
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600">
                      Account Description
                    </th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 font-mono">
                      Type
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-600">
                      Prior Balance
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-600">
                      Current Amount
                    </th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-600">
                      YTD Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((acct, i) => (
                    <tr
                      key={acct.accountCode + i}
                      className="h-9 border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-0 font-mono text-[13px] font-semibold text-brand">
                        {acct.accountCode}
                      </td>
                      <td className="px-4 py-0 text-[13px] text-gray-800">
                        {acct.accountName}
                      </td>
                      <td className="px-4 py-0 font-mono text-[12px] text-gray-600">
                        {acct.accountType}
                      </td>
                      <td className="px-4 py-0 text-right font-mono text-[13px] text-gray-800 tabular-nums">
                        {fmtMoney(acct.priorBalance)}
                      </td>
                      <td className="px-4 py-0 text-right font-mono text-[13px] text-gray-800 tabular-nums">
                        {fmtMoney(acct.currentAmount)}
                      </td>
                      <td className="px-4 py-0 text-right font-mono text-[13px] text-gray-800 tabular-nums">
                        {fmtMoney(acct.ytdAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="h-9 font-bold border-t-2 border-gray-400 bg-slate-50">
                    <td className="px-4 py-0 text-[13px] text-gray-900" colSpan={3}>
                      TOTALS
                    </td>
                    <td className="px-4 py-0 text-right font-mono text-[13px] text-gray-900 tabular-nums">
                      {fmtMoney(totalPrior)}
                    </td>
                    <td className="px-4 py-0 text-right font-mono text-[13px] text-gray-900 tabular-nums">
                      {fmtMoney(totalCurrent)}
                    </td>
                    <td className="px-4 py-0 text-right font-mono text-[13px] text-gray-900 tabular-nums">
                      {fmtMoney(totalYtd)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Out of Balance Alert */}
          {outOfBalance && (
            <div className="mx-6 my-3 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-300 rounded-lg text-sm text-red-700 font-semibold">
              <span className="text-lg">⚠</span>
              OUT OF BALANCE by ${fmtMoney(outOfBalanceAmt)} — Debits: ${fmtMoney(totalDebits ?? 0)} | Credits: ${fmtMoney(totalCredits ?? 0)}
            </div>
          )}

          {/* Footnote */}
          <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400">
            * Account balances reflect posted transactions only (BR-GL-001)
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sample data (used when API returns no accounts array) ────────────────────

const SAMPLE_ACCOUNTS: TrialBalanceAccount[] = [
  {
    accountCode: '1010',
    accountName: 'Cash — Operating Account',
    accountType: 'ASSET',
    priorBalance: '125430.00',
    currentAmount: '18200.00',
    ytdAmount: '143630.00',
  },
  {
    accountCode: '1200',
    accountName: 'Accounts Receivable — Trade',
    accountType: 'ASSET',
    priorBalance: '87650.00',
    currentAmount: '-5400.00',
    ytdAmount: '82250.00',
  },
  {
    accountCode: '2100',
    accountName: 'Accounts Payable — Trade',
    accountType: 'LIABILITY',
    priorBalance: '-42300.00',
    currentAmount: '-8100.00',
    ytdAmount: '-50400.00',
  },
  {
    accountCode: '3000',
    accountName: 'Retained Earnings',
    accountType: 'EQUITY',
    priorBalance: '-95000.00',
    currentAmount: '0.00',
    ytdAmount: '-95000.00',
  },
  {
    accountCode: '4010',
    accountName: 'New Vehicle Sales Revenue',
    accountType: 'REVENUE',
    priorBalance: '-520000.00',
    currentAmount: '-88000.00',
    ytdAmount: '-608000.00',
  },
  {
    accountCode: '5010',
    accountName: 'Cost of Sales — New Vehicles',
    accountType: 'COGS',
    priorBalance: '468000.00',
    currentAmount: '79200.00',
    ytdAmount: '547200.00',
  },
];
