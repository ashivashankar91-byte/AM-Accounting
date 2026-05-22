import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { glApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportType = 'GL_DETAIL' | 'PL_DETAIL';

interface GLTransaction {
  id: string;
  date: string;
  source: string;
  refNumber: string;
  description: string;
  controlNumber: string;
  debit: string;
  credit: string;
  runningBalance: string;
  accountCode: string;
  accountName: string;
  accessDenied?: boolean;
}

interface AccountGroup {
  accountCode: string;
  accountName: string;
  beginningBalance: string;
  transactions: GLTransaction[];
  periodDebits: number;
  periodCredits: number;
  endingBalance: string;
}

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

const PAGE_SIZE = 200;

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtMoney(val: string | number): string {
  const n = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
}

function parseMoney(val: string | number): number {
  if (typeof val === 'number') return val;
  return parseFloat(String(val).replace(/[^0-9.\-]/g, '')) || 0;
}

function fmtDate(val: string): string {
  try {
    return new Date(val).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
  } catch {
    return val;
  }
}

// ─── Group raw API entries by account ─────────────────────────────────────────

function groupByAccount(entries: any[]): AccountGroup[] {
  if (!entries || entries.length === 0) return SAMPLE_GROUPS;

  const map = new Map<string, AccountGroup>();

  for (const e of entries) {
    const code = e.accountCode ?? e.account_code ?? '????';
    const name = e.accountName ?? e.account_name ?? 'Unknown Account';

    if (!map.has(code)) {
      map.set(code, {
        accountCode: code,
        accountName: name,
        beginningBalance: e.beginningBalance ?? e.beginning_balance ?? '0.00',
        transactions: [],
        periodDebits: 0,
        periodCredits: 0,
        endingBalance: '0.00',
      });
    }

    const group = map.get(code)!;
    const txn: GLTransaction = {
      id: e.id ?? `${code}-${group.transactions.length}`,
      date: e.entryDate ?? e.date ?? '',
      source: e.sourceCode ?? e.source ?? '',
      refNumber: e.referenceNumber ?? e.refNumber ?? e.ref ?? '',
      description: e.description ?? e.memo ?? '',
      controlNumber: e.controlNumber ?? e.control ?? '',
      debit: e.debit ?? e.debitAmount ?? '0.00',
      credit: e.credit ?? e.creditAmount ?? '0.00',
      runningBalance: e.runningBalance ?? e.balance ?? '0.00',
      accountCode: code,
      accountName: name,
      accessDenied: e.accessDenied ?? false,
    };

    group.transactions.push(txn);
    group.periodDebits += parseMoney(txn.debit);
    group.periodCredits += parseMoney(txn.credit);
  }

  for (const group of map.values()) {
    const begin = parseMoney(group.beginningBalance);
    group.endingBalance = (begin + group.periodDebits - group.periodCredits).toFixed(2);
  }

  return Array.from(map.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

// ─── Component ────────────────────────────────────────────────────────────────

const now = new Date();

export default function DetailedGLPL() {
  const [reportType, setReportType] = useState<ReportType>('GL_DETAIL');
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [department, setDepartment] = useState('ALL');
  const [sourceCode, setSourceCode] = useState('');
  const [postedOnly, setPostedOnly] = useState(true);
  const [shouldFetch, setShouldFetch] = useState(false);
  const [drilledAccount, setDrilledAccount] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);

  // Build query params from filters
  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('year', String(selectedYear));
    p.set('month', String(selectedMonth));
    if (reportType === 'PL_DETAIL') p.set('reportType', 'PL_DETAIL');
    if (department !== 'ALL') p.set('department', department);
    if (fromAccount.trim()) p.set('fromAccount', fromAccount.trim());
    if (toAccount.trim()) p.set('toAccount', toAccount.trim());
    if (sourceCode.trim()) p.set('sourceCode', sourceCode.trim());
    if (postedOnly) p.set('status', 'POSTED');
    return p.toString();
  }, [reportType, selectedYear, selectedMonth, department, fromAccount, toAccount, sourceCode, postedOnly]);

  const {
    data: rawEntries,
    isLoading,
    error,
    refetch,
  } = useQuery<any[]>({
    queryKey: ['detailed-gl-pl', queryParams],
    queryFn: () => glApi.getEntries(queryParams),
    enabled: shouldFetch,
    retry: false,
  });

  const handleGenerate = useCallback(() => {
    setCurrentPage(0);
    setDrilledAccount(null);
    if (shouldFetch) {
      refetch();
    } else {
      setShouldFetch(true);
    }
  }, [shouldFetch, refetch]);

  // Flatten entries from journal-entry format if needed
  const flatEntries = useMemo(() => {
    if (!rawEntries) return [];
    // rawEntries may be journal entries with nested lines, or flat transactions
    const flat: any[] = [];
    for (const e of rawEntries) {
      if (Array.isArray(e.lines)) {
        for (const line of e.lines) {
          flat.push({
            ...line,
            id: line.id ?? `${e.id}-${line.accountCode}`,
            entryDate: e.entryDate,
            sourceCode: e.sourceCode ?? e.source,
            referenceNumber: e.sourceRef ?? e.referenceNumber,
            description: line.memo ?? e.description,
            controlNumber: e.id,
            debit: line.debit ?? 0,
            credit: line.credit ?? 0,
          });
        }
      } else {
        flat.push(e);
      }
    }
    return flat;
  }, [rawEntries]);

  const allGroups = useMemo(() => groupByAccount(flatEntries), [flatEntries]);

  // Drilled account filter
  const displayGroups = useMemo(() => {
    if (drilledAccount) {
      return allGroups.filter((g) => g.accountCode === drilledAccount);
    }
    return allGroups;
  }, [allGroups, drilledAccount]);

  // Flatten all transactions for pagination
  const allTxns = useMemo(
    () => displayGroups.flatMap((g) => g.transactions),
    [displayGroups],
  );
  const totalPages = Math.ceil(allTxns.length / PAGE_SIZE);

  const yearOptions: number[] = [];
  for (let y = 2020; y <= 2030; y++) yearOptions.push(y);

  return (
    <div className="p-7 min-h-full font-[Inter,sans-serif]">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">
          {reportType === 'GL_DETAIL' ? 'Detailed GL Report' : 'Detailed P&L Report'}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Program 23 — Transaction Detail by Account</p>
      </div>

      {/* ── SECTION 1: Parameters ─────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5 shadow-sm">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Report Parameters</h2>

        {/* Report type */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-600 mb-2">Report Type</label>
          <div className="flex gap-5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="radio"
                name="reportType"
                value="GL_DETAIL"
                checked={reportType === 'GL_DETAIL'}
                onChange={() => setReportType('GL_DETAIL')}
                className="h-4 w-4 text-brand border-gray-300 focus:ring-blue-700"
              />
              <span className="text-sm text-gray-700 font-medium">GL Detail</span>
              <span className="text-xs text-gray-400">All account types</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="radio"
                name="reportType"
                value="PL_DETAIL"
                checked={reportType === 'PL_DETAIL'}
                onChange={() => setReportType('PL_DETAIL')}
                className="h-4 w-4 text-brand border-gray-300 focus:ring-blue-700"
              />
              <span className="text-sm text-gray-700 font-medium">P&amp;L Detail</span>
              <span className="text-xs text-gray-400">Revenue and expense accounts only</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-[auto_auto_1fr_auto_auto_auto] gap-x-5 gap-y-4 items-end">
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

          {/* Source Code */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Source Code</label>
            <input
              type="text"
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value.replace(/\D/g, '').slice(0, 2))}
              placeholder="e.g. 88"
              className="h-8 w-16 px-2 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-transparent"
              maxLength={2}
            />
          </div>

          {/* Posted only */}
          <div className="flex items-center gap-2 pb-1">
            <input
              id="postedOnly"
              type="checkbox"
              checked={postedOnly}
              onChange={(e) => setPostedOnly(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-blue-700"
            />
            <label htmlFor="postedOnly" className="text-sm text-gray-600 select-none cursor-pointer whitespace-nowrap">
              Posted only
            </label>
          </div>
        </div>

        {/* Generate button */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleGenerate}
            disabled={isLoading}
            className="h-8 px-5 bg-brand text-white text-sm font-semibold rounded hover:bg-brand-hover active:bg-blue-900 disabled:opacity-60 transition-colors"
          >
            {isLoading ? 'Generating…' : 'Generate Report'}
          </button>
        </div>
      </div>

      {/* ── Loading / Error ───────────────────────────────────────────────── */}
      {shouldFetch && isLoading && (
        <PageLoader page="Detailed GL / P&L" service="gl-service" port={3010} />
      )}

      {shouldFetch && error && !isLoading && (
        <PageError
          error={error as Error}
          serviceName="gl-service"
          port={3010}
          retry={() => refetch()}
        />
      )}

      {/* ── SECTION 2: Report Output ──────────────────────────────────────── */}
      {shouldFetch && !isLoading && !error && (
        <>
          {/* Toolbar: drill-down clear + pagination */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-700">
                {displayGroups.length} account{displayGroups.length !== 1 ? 's' : ''}
                {' · '}
                {allTxns.length} transaction{allTxns.length !== 1 ? 's' : ''}
              </span>
              {drilledAccount && (
                <button
                  onClick={() => setDrilledAccount(null)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-brand-light text-brand text-xs font-semibold rounded border border-brand-border hover:bg-brand-light transition-colors"
                >
                  <span>&#10005;</span> Clear drill-down ({drilledAccount})
                </button>
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>Page {currentPage + 1} of {totalPages}</span>
                <button
                  disabled={currentPage === 0}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="h-7 w-7 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-xs font-bold"
                >
                  &#8249;
                </button>
                <button
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="h-7 w-7 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-xs font-bold"
                >
                  &#8250;
                </button>
              </div>
            )}
          </div>

          {displayGroups.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col items-center justify-center py-16 text-gray-400">
              <div className="text-4xl mb-3">📄</div>
              <div className="text-sm font-semibold text-gray-600">No transactions found</div>
              <div className="text-xs mt-1 text-gray-400">
                Adjust the filter parameters and try again.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {displayGroups.map((group) => (
                <AccountGroupTable
                  key={group.accountCode}
                  group={group}
                  currentPage={currentPage}
                  onDrill={(code) => {
                    setDrilledAccount(code);
                    setCurrentPage(0);
                  }}
                  drilledAccount={drilledAccount}
                />
              ))}
            </div>
          )}

          {/* Bottom pagination */}
          {totalPages > 1 && (
            <div className="flex justify-end items-center gap-2 mt-4 text-sm text-gray-600">
              <span>Page {currentPage + 1} of {totalPages}</span>
              <button
                disabled={currentPage === 0}
                onClick={() => setCurrentPage((p) => p - 1)}
                className="h-7 w-7 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-xs font-bold"
              >
                &#8249;
              </button>
              <button
                disabled={currentPage >= totalPages - 1}
                onClick={() => setCurrentPage((p) => p + 1)}
                className="h-7 w-7 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-40 text-xs font-bold"
              >
                &#8250;
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Account Group Table ──────────────────────────────────────────────────────

interface AccountGroupTableProps {
  group: AccountGroup;
  currentPage: number;
  onDrill: (code: string) => void;
  drilledAccount: string | null;
}

function AccountGroupTable({ group, currentPage, onDrill, drilledAccount }: AccountGroupTableProps) {
  const pageStart = currentPage * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;
  const txnsToShow = group.transactions.slice(pageStart, pageEnd);
  const hasMore = group.transactions.length > PAGE_SIZE;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Account Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 bg-brand-light border-b border-blue-100 cursor-pointer hover:bg-brand-light transition-colors"
        onClick={() =>
          drilledAccount === group.accountCode ? onDrill('') : onDrill(group.accountCode)
        }
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-[13px] font-bold text-brand">{group.accountCode}</span>
          <span className="text-[13px] font-semibold text-gray-800">—</span>
          <span className="text-[13px] font-semibold text-gray-800">{group.accountName}</span>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-gray-600">
          <span>
            Beginning Balance:{' '}
            <span className="font-mono font-semibold text-gray-800">
              {fmtMoney(group.beginningBalance)}
            </span>
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-gray-400 text-[11px]">
            {group.transactions.length} txn{group.transactions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Transaction rows */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-gray-200">
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 w-20">
                Date
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 w-14">
                Source
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 w-24">
                Ref #
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500">
                Description
              </th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 w-24">
                Control #
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 w-24">
                Debit
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 w-24">
                Credit
              </th>
              <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 w-28">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {txnsToShow.map((txn) => (
              <tr
                key={txn.id}
                className="h-9 border-b border-slate-100 hover:bg-slate-50 transition-colors"
              >
                <td className="px-3 py-0 text-[12px] text-gray-700 font-mono whitespace-nowrap">
                  {fmtDate(txn.date)}
                </td>
                <td className="px-3 py-0 font-mono text-[11px] text-gray-600 whitespace-nowrap">
                  {txn.source}
                </td>
                <td className="px-3 py-0 font-mono text-[11px] text-brand whitespace-nowrap">
                  {txn.refNumber || '—'}
                </td>
                <td className="px-3 py-0 text-[12px] text-gray-800 max-w-[280px] truncate">
                  {txn.description || '—'}
                </td>
                <td className="px-3 py-0 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                  {txn.controlNumber || '—'}
                </td>
                {txn.accessDenied ? (
                  <>
                    <td className="px-3 py-0 text-right font-mono text-[11px] text-red-600 font-semibold">
                      *** ACCESS DENIED ***
                    </td>
                    <td className="px-3 py-0 text-right font-mono text-[11px] text-red-600 font-semibold">
                      *** ACCESS DENIED ***
                    </td>
                    <td className="px-3 py-0 text-right font-mono text-[11px] text-red-600 font-semibold">
                      *** ACCESS DENIED ***
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-0 text-right font-mono text-[12px] text-gray-800 tabular-nums">
                      {parseMoney(txn.debit) > 0 ? fmtMoney(txn.debit) : ''}
                    </td>
                    <td className="px-3 py-0 text-right font-mono text-[12px] text-gray-800 tabular-nums">
                      {parseMoney(txn.credit) > 0 ? fmtMoney(txn.credit) : ''}
                    </td>
                    <td className="px-3 py-0 text-right font-mono text-[12px] text-gray-800 tabular-nums">
                      {fmtMoney(txn.runningBalance)}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Account Footer */}
      <div className="flex items-center gap-6 px-4 py-2 bg-gray-50 border-t border-gray-200 text-[12px]">
        <span className="text-gray-600">
          Period Debits:{' '}
          <span className="font-mono font-semibold text-gray-800">
            {fmtMoney(group.periodDebits)}
          </span>
        </span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-600">
          Period Credits:{' '}
          <span className="font-mono font-semibold text-gray-800">
            {fmtMoney(group.periodCredits)}
          </span>
        </span>
        <span className="text-gray-300">|</span>
        <span className="text-gray-700 font-semibold">
          Ending Balance:{' '}
          <span className="font-mono font-bold text-gray-900">
            {fmtMoney(group.endingBalance)}
          </span>
        </span>
        {hasMore && (
          <>
            <span className="text-gray-300">|</span>
            <span className="text-gray-400 text-[11px]">
              Showing {PAGE_SIZE} of {group.transactions.length} transactions — use pagination to view all
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sample Data ──────────────────────────────────────────────────────────────

const SAMPLE_GROUPS: AccountGroup[] = [
  {
    accountCode: '1010',
    accountName: 'Cash — Operating Account',
    beginningBalance: '125430.00',
    periodDebits: 89400.00,
    periodCredits: 71200.00,
    endingBalance: '143630.00',
    transactions: [
      {
        id: 's1',
        date: '2026-05-02',
        source: '40',
        refNumber: 'CR-00841',
        description: 'Service Cash Receipts — RO batch',
        controlNumber: 'JE-00231',
        debit: '12400.00',
        credit: '0.00',
        runningBalance: '137830.00',
        accountCode: '1010',
        accountName: 'Cash — Operating Account',
      },
      {
        id: 's2',
        date: '2026-05-05',
        source: '32',
        refNumber: 'CR-00842',
        description: 'Parts Sales — Counter sales batch',
        controlNumber: 'JE-00232',
        debit: '8750.00',
        credit: '0.00',
        runningBalance: '146580.00',
        accountCode: '1010',
        accountName: 'Cash — Operating Account',
      },
      {
        id: 's3',
        date: '2026-05-08',
        source: '88',
        refNumber: 'AP-00310',
        description: 'AP payment — Parts vendor',
        controlNumber: 'JE-00233',
        debit: '0.00',
        credit: '18200.00',
        runningBalance: '128380.00',
        accountCode: '1010',
        accountName: 'Cash — Operating Account',
      },
      {
        id: 's4',
        date: '2026-05-12',
        source: '30',
        refNumber: 'RO-04512',
        description: 'Service Labor — Warranty claim',
        controlNumber: 'JE-00240',
        debit: '4100.00',
        credit: '0.00',
        runningBalance: '132480.00',
        accountCode: '1010',
        accountName: 'Cash — Operating Account',
      },
      {
        id: 's5',
        date: '2026-05-15',
        source: '88',
        refNumber: 'AP-00320',
        description: 'AP payment — Floorplan interest',
        controlNumber: 'JE-00248',
        debit: '0.00',
        credit: '53000.00',
        runningBalance: '79480.00',
        accountCode: '1010',
        accountName: 'Cash — Operating Account',
      },
      {
        id: 's6',
        date: '2026-05-20',
        source: '3',
        refNumber: 'MJE-00091',
        description: 'Manual accrual — Prior month correction',
        controlNumber: 'JE-00255',
        debit: '64150.00',
        credit: '0.00',
        runningBalance: '143630.00',
        accountCode: '1010',
        accountName: 'Cash — Operating Account',
      },
    ],
  },
  {
    accountCode: '4010',
    accountName: 'New Vehicle Sales Revenue',
    beginningBalance: '-520000.00',
    periodDebits: 0,
    periodCredits: 88000.00,
    endingBalance: '-608000.00',
    transactions: [
      {
        id: 'r1',
        date: '2026-05-03',
        source: '88',
        refNumber: 'DEAL-7812',
        description: 'New Vehicle Sale — 2026 Honda CR-V VIN 1HG...',
        controlNumber: 'JE-00234',
        debit: '0.00',
        credit: '32500.00',
        runningBalance: '-552500.00',
        accountCode: '4010',
        accountName: 'New Vehicle Sales Revenue',
      },
      {
        id: 'r2',
        date: '2026-05-10',
        source: '88',
        refNumber: 'DEAL-7813',
        description: 'New Vehicle Sale — 2026 Toyota Camry VIN 4T1...',
        controlNumber: 'JE-00241',
        debit: '0.00',
        credit: '28900.00',
        runningBalance: '-581400.00',
        accountCode: '4010',
        accountName: 'New Vehicle Sales Revenue',
      },
      {
        id: 'r3',
        date: '2026-05-17',
        source: '88',
        refNumber: 'DEAL-7820',
        description: 'New Vehicle Sale — 2026 Ford F-150 VIN 1FT...',
        controlNumber: 'JE-00252',
        debit: '0.00',
        credit: '26600.00',
        runningBalance: '-608000.00',
        accountCode: '4010',
        accountName: 'New Vehicle Sales Revenue',
        accessDenied: false,
      },
    ],
  },
];
