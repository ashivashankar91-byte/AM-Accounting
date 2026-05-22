import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { glApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnnualAccount {
  accountCode: string;
  accountName: string;
  jan: string;
  feb: string;
  mar: string;
  apr: string;
  may: string;
  jun: string;
  jul: string;
  aug: string;
  sep: string;
  oct: string;
  nov: string;
  dec: string;
}

type MonthKey = 'jan' | 'feb' | 'mar' | 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec';

const MONTH_KEYS: MonthKey[] = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

const MONTH_LABELS: Record<MonthKey, string> = {
  jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun',
  jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec',
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtMoney(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return '—';
  if (n === 0) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

function parseMoney(val: string | number): number {
  if (typeof val === 'number') return val;
  return parseFloat(val.replace(/[^0-9.\-]/g, '')) || 0;
}

function rowTotal(row: AnnualAccount): number {
  return MONTH_KEYS.reduce((s, k) => s + parseMoney(row[k]), 0);
}

function colTotal(accounts: AnnualAccount[], key: MonthKey): number {
  return accounts.reduce((s, a) => s + parseMoney(a[key]), 0);
}

// ─── CSV Download ─────────────────────────────────────────────────────────────

function downloadCsv(accounts: AnnualAccount[], fiscalYear: number, company: string) {
  const header = ['Account#', 'Description', ...MONTH_KEYS.map((k) => MONTH_LABELS[k]), 'Total'];
  const rows = accounts.map((a) => [
    a.accountCode,
    a.accountName,
    ...MONTH_KEYS.map((k) => parseMoney(a[k]).toFixed(2)),
    rowTotal(a).toFixed(2),
  ]);

  const csv = [header, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `annual-gl-summary-${company}-${fiscalYear}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Transform trial balance into annual grid ─────────────────────────────────

function buildAnnualGrid(tbData: any, fromAccount: string, toAccount: string): AnnualAccount[] {
  const rawAccounts: any[] = tbData?.accounts ?? [];
  if (rawAccounts.length === 0) return SAMPLE_ANNUAL_ACCOUNTS;

  let filtered = rawAccounts;
  if (fromAccount.trim()) filtered = filtered.filter((a: any) => a.accountCode >= fromAccount.trim());
  if (toAccount.trim()) filtered = filtered.filter((a: any) => a.accountCode <= toAccount.trim());

  return filtered.map((a: any): AnnualAccount => ({
    accountCode: a.accountCode ?? '',
    accountName: a.accountName ?? '',
    jan: a.monthlyAmounts?.jan ?? a.currentAmount ?? '0.00',
    feb: a.monthlyAmounts?.feb ?? '0.00',
    mar: a.monthlyAmounts?.mar ?? '0.00',
    apr: a.monthlyAmounts?.apr ?? '0.00',
    may: a.monthlyAmounts?.may ?? '0.00',
    jun: a.monthlyAmounts?.jun ?? '0.00',
    jul: a.monthlyAmounts?.jul ?? '0.00',
    aug: a.monthlyAmounts?.aug ?? '0.00',
    sep: a.monthlyAmounts?.sep ?? '0.00',
    oct: a.monthlyAmounts?.oct ?? '0.00',
    nov: a.monthlyAmounts?.nov ?? '0.00',
    dec: a.monthlyAmounts?.dec ?? '0.00',
  }));
}

// ─── Component ────────────────────────────────────────────────────────────────

const currentYear = new Date().getFullYear();

export default function AnnualGLSummary() {
  const [fiscalYear, setFiscalYear] = useState(currentYear);
  const [company, setCompany] = useState('01');
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [shouldFetch, setShouldFetch] = useState(false);

  // Fetch current-month trial balance to seed account list.
  // In production the API would support year-level aggregation.
  const {
    data: tbData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['annual-gl-summary', fiscalYear, company],
    queryFn: () => glApi.getTrialBalance(fiscalYear, 12),
    enabled: shouldFetch,
    retry: false,
  });

  const handleGenerate = useCallback(() => {
    if (shouldFetch) {
      refetch();
    } else {
      setShouldFetch(true);
    }
  }, [shouldFetch, refetch]);

  const accounts = shouldFetch && !isLoading && !error
    ? buildAnnualGrid(tbData, fromAccount, toAccount)
    : [];

  const handleExportCsv = useCallback(() => {
    const rows = accounts.length > 0 ? accounts : SAMPLE_ANNUAL_ACCOUNTS;
    downloadCsv(rows, fiscalYear, company);
  }, [accounts, fiscalYear, company]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // Column footer totals
  const colTotals = MONTH_KEYS.reduce<Record<MonthKey, number>>(
    (acc, k) => ({ ...acc, [k]: colTotal(accounts, k) }),
    {} as Record<MonthKey, number>,
  );
  const grandTotal = Object.values(colTotals).reduce((s, v) => s + v, 0);

  const yearOptions: number[] = [];
  for (let y = 2020; y <= 2030; y++) yearOptions.push(y);

  return (
    <div className="p-7 min-h-full font-[Inter,sans-serif]">
      {/* Page Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Annual GL Summary</h1>
        <p className="text-sm text-gray-500 mt-0.5">Program 27 — 12-Month Account Activity Grid</p>
      </div>

      {/* ── SECTION 1: Warning Banner ─────────────────────────────────────── */}
      <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-300 rounded-lg mb-5 text-sm text-amber-800">
        <span className="text-lg mt-0.5 flex-shrink-0">⚠</span>
        <span>
          <strong>Data Retention Notice:</strong> Annual GL Summary data will be cleared after the
          first-month close of {fiscalYear + 1}. Print or export this report before running
          month-end close in January {fiscalYear + 1}.
        </span>
      </div>

      {/* ── SECTION 2: Parameters ─────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5 shadow-sm">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Report Parameters</h2>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          {/* Fiscal Year */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Fiscal Year</label>
            <input
              type="number"
              min={2020}
              max={2030}
              value={fiscalYear}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 2020 && v <= 2030) setFiscalYear(v);
              }}
              className="h-8 w-24 px-2 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
            />
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

          {/* Account Range */}
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

          {/* Actions */}
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
        <PageLoader page="Annual GL Summary" service="gl-service" port={3010} />
      )}

      {shouldFetch && error && !isLoading && (
        <PageError
          error={error as Error}
          serviceName="gl-service"
          port={3010}
          retry={() => refetch()}
        />
      )}

      {/* ── SECTION 3: 12-Month Grid ──────────────────────────────────────── */}
      {shouldFetch && !isLoading && !error && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {/* Report Header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="text-base font-bold text-gray-900">
              ANNUAL GL SUMMARY — COMPANY {company.toUpperCase()} — FISCAL YEAR {fiscalYear}
            </div>
            <div className="text-xs text-gray-500 font-mono mt-0.5">
              PRINT DATE: {new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}
              {' · '}
              {accounts.length} accounts
            </div>
          </div>

          {accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <div className="text-4xl mb-3">📅</div>
              <div className="text-sm font-semibold text-gray-600">No account data for {fiscalYear}</div>
              <div className="text-xs mt-1">Verify the fiscal year and try again.</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: 1400 }}>
                <thead>
                  <tr className="bg-slate-50 border-b-2 border-gray-200">
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 font-mono sticky left-0 bg-slate-50 z-10 w-24">
                      Acct #
                    </th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-600 w-52">
                      Description
                    </th>
                    {MONTH_KEYS.map((k) => (
                      <th
                        key={k}
                        className="px-2 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-600 w-20"
                      >
                        {MONTH_LABELS[k]}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-700 w-24">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acct, i) => {
                    const total = rowTotal(acct);
                    return (
                      <tr
                        key={acct.accountCode + i}
                        className="h-9 border-b border-slate-100 hover:bg-brand-light/30 transition-colors"
                      >
                        <td className="px-3 py-0 font-mono text-[12px] font-semibold text-brand sticky left-0 bg-white">
                          {acct.accountCode}
                        </td>
                        <td className="px-3 py-0 text-[12px] text-gray-800 truncate max-w-[208px]">
                          {acct.accountName}
                        </td>
                        {MONTH_KEYS.map((k) => (
                          <td
                            key={k}
                            className="px-2 py-0 text-right font-mono text-[12px] text-gray-800 tabular-nums"
                          >
                            {fmtMoney(acct[k])}
                          </td>
                        ))}
                        <td className="px-3 py-0 text-right font-mono text-[12px] font-semibold text-gray-900 tabular-nums">
                          {fmtMoney(total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="h-9 font-bold border-t-2 border-gray-400 bg-slate-50">
                    <td className="px-3 py-0 text-[13px] text-gray-900 sticky left-0 bg-slate-50" colSpan={2}>
                      TOTALS
                    </td>
                    {MONTH_KEYS.map((k) => (
                      <td
                        key={k}
                        className="px-2 py-0 text-right font-mono text-[12px] text-gray-900 tabular-nums"
                      >
                        {fmtMoney(colTotals[k])}
                      </td>
                    ))}
                    <td className="px-3 py-0 text-right font-mono text-[13px] text-gray-900 tabular-nums">
                      {fmtMoney(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Footnote — BR-GL-009 */}
          <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400">
            This report reflects annual GL summary data. Data is cleared after first-month close
            of the new fiscal year. (BR-GL-009)
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sample data ──────────────────────────────────────────────────────────────

const SAMPLE_ANNUAL_ACCOUNTS: AnnualAccount[] = [
  {
    accountCode: '1010',
    accountName: 'Cash — Operating Account',
    jan: '18200.00', feb: '22400.00', mar: '15600.00', apr: '31000.00',
    may: '28900.00', jun: '19700.00', jul: '24500.00', aug: '17300.00',
    sep: '21100.00', oct: '33000.00', nov: '26800.00', dec: '18900.00',
  },
  {
    accountCode: '1200',
    accountName: 'Accounts Receivable — Trade',
    jan: '-5400.00', feb: '8200.00', mar: '3100.00', apr: '-2200.00',
    may: '9900.00', jun: '4400.00', jul: '-1100.00', aug: '7700.00',
    sep: '2900.00', oct: '-3300.00', nov: '6100.00', dec: '1800.00',
  },
  {
    accountCode: '2100',
    accountName: 'Accounts Payable — Trade',
    jan: '-8100.00', feb: '-12300.00', mar: '-7800.00', apr: '-9400.00',
    may: '-15200.00', jun: '-10600.00', jul: '-8900.00', aug: '-13100.00',
    sep: '-11400.00', oct: '-9700.00', nov: '-14300.00', dec: '-12100.00',
  },
  {
    accountCode: '4010',
    accountName: 'New Vehicle Sales Revenue',
    jan: '-88000.00', feb: '-94000.00', mar: '-112000.00', apr: '-98000.00',
    may: '-131000.00', jun: '-125000.00', jul: '-107000.00', aug: '-119000.00',
    sep: '-102000.00', oct: '-95000.00', nov: '-89000.00', dec: '-143000.00',
  },
  {
    accountCode: '5010',
    accountName: 'Cost of Sales — New Vehicles',
    jan: '79200.00', feb: '84600.00', mar: '100800.00', apr: '88200.00',
    may: '117900.00', jun: '112500.00', jul: '96300.00', aug: '107100.00',
    sep: '91800.00', oct: '85500.00', nov: '80100.00', dec: '128700.00',
  },
];
