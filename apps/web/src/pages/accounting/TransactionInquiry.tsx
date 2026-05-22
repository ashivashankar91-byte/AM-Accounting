import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { glApi } from '../../api/client';
import TransactionDetailPopup from '../../components/accounting/TransactionDetailPopup';

let JournalSourceLookup: any = null;
try {
  JournalSourceLookup = require('../../components/accounting/JournalSourceLookup').default;
} catch {
  JournalSourceLookup = null;
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type DatePreset =
  | 'TODAY' | 'YESTERDAY' | 'MTD' | 'THIS_MONTH' | 'OPEN_MONTH'
  | 'LAST_OPEN_NEXT' | 'LAST_MONTH' | 'LAST_YEAR' | 'NEXT_MONTH'
  | 'THIS_YEAR' | 'YTD' | 'CUSTOM';

const DATE_PRESETS: DatePreset[] = [
  'TODAY', 'YESTERDAY', 'MTD', 'THIS_MONTH', 'OPEN_MONTH',
  'LAST_OPEN_NEXT', 'LAST_MONTH', 'LAST_YEAR', 'NEXT_MONTH',
  'THIS_YEAR', 'YTD', 'CUSTOM',
];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const firstOfMonth = (y: number, m: number) => new Date(y, m, 1);
const lastOfMonth = (y: number, m: number) => new Date(y, m + 1, 0);

function computePresetDates(
  preset: DatePreset,
  openMonthDate?: string,
): { from: string; thru: string } | null {
  if (preset === 'CUSTOM') return null;
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();

  switch (preset) {
    case 'TODAY':
      return { from: isoDate(today), thru: isoDate(today) };
    case 'YESTERDAY': {
      const yd = new Date(today);
      yd.setDate(yd.getDate() - 1);
      return { from: isoDate(yd), thru: isoDate(yd) };
    }
    case 'MTD':
      return { from: isoDate(firstOfMonth(y, m)), thru: isoDate(today) };
    case 'THIS_MONTH':
      return { from: isoDate(firstOfMonth(y, m)), thru: isoDate(lastOfMonth(y, m)) };
    case 'OPEN_MONTH': {
      if (openMonthDate) {
        const d = new Date(openMonthDate);
        return { from: isoDate(firstOfMonth(d.getFullYear(), d.getMonth())), thru: isoDate(lastOfMonth(d.getFullYear(), d.getMonth())) };
      }
      return { from: isoDate(firstOfMonth(y, m)), thru: isoDate(lastOfMonth(y, m)) };
    }
    case 'LAST_MONTH':
      return { from: isoDate(firstOfMonth(y, m - 1)), thru: isoDate(lastOfMonth(y, m - 1)) };
    case 'LAST_YEAR':
      return { from: `${y - 1}-01-01`, thru: `${y - 1}-12-31` };
    case 'THIS_YEAR':
      return { from: `${y}-01-01`, thru: `${y}-12-31` };
    case 'YTD':
      return { from: `${y}-01-01`, thru: isoDate(today) };
    case 'NEXT_MONTH':
      return { from: isoDate(firstOfMonth(y, m + 1)), thru: isoDate(lastOfMonth(y, m + 1)) };
    case 'LAST_OPEN_NEXT': {
      if (openMonthDate) {
        const d = new Date(openMonthDate);
        const om = d.getMonth();
        const oy = d.getFullYear();
        return { from: isoDate(firstOfMonth(oy, om - 1)), thru: isoDate(lastOfMonth(oy, om + 1)) };
      }
      return { from: isoDate(firstOfMonth(y, m - 1)), thru: isoDate(lastOfMonth(y, m + 1)) };
    }
    default:
      return null;
  }
}

export default function TransactionInquiry() {
  const paramAreaRef = useRef<HTMLDivElement>(null);

  const [company, setCompany] = useState('01');
  const [sourceCode, setSourceCode] = useState('');
  const [referenceNum, setReferenceNum] = useState('');
  const [controlNum, setControlNum] = useState('');
  const [dateRange, setDateRange] = useState<DatePreset>('MTD');
  const [fromDate, setFromDate] = useState('');
  const [thruDate, setThruDate] = useState('');
  const [isSearched, setIsSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [showSourceLookup, setShowSourceLookup] = useState(false);
  const [selectedTxnId, setSelectedTxnId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: sysConfig } = useQuery<any>({
    queryKey: ['sys-config'],
    queryFn: glApi.getSystemConfig,
    retry: false,
  });

  const openMonthDate: string | undefined = sysConfig?.lastCloseDate
    ? (() => {
        const d = new Date(sysConfig.lastCloseDate);
        d.setMonth(d.getMonth() + 1);
        return isoDate(d);
      })()
    : undefined;

  useEffect(() => {
    if (dateRange !== 'CUSTOM') {
      const computed = computePresetDates(dateRange, openMonthDate);
      if (computed) {
        setFromDate(computed.from);
        setThruDate(computed.thru);
      }
    }
  }, [dateRange, openMonthDate]);

  useEffect(() => {
    const computed = computePresetDates('MTD', openMonthDate);
    if (computed) {
      setFromDate(computed.from);
      setThruDate(computed.thru);
    }
  }, []);

  const buildParams = () => {
    const parts: string[] = [];
    if (company) parts.push(`company=${encodeURIComponent(company)}`);
    if (sourceCode) parts.push(`sourceCode=${encodeURIComponent(sourceCode)}`);
    if (referenceNum) parts.push(`referenceNumber=${encodeURIComponent(referenceNum)}`);
    if (controlNum) parts.push(`controlNum=${encodeURIComponent(controlNum)}`);
    if (fromDate) parts.push(`fromDate=${fromDate}`);
    if (thruDate) parts.push(`thruDate=${thruDate}`);
    return parts.join('&');
  };

  const { data: results, isLoading, error: queryError, refetch } = useQuery<any[]>({
    queryKey: ['txn-inquiry', company, sourceCode, referenceNum, controlNum, fromDate, thruDate],
    queryFn: () => glApi.getEntries(buildParams()),
    enabled: false,
    retry: false,
  });

  const doSearch = () => {
    if (!fromDate || !thruDate) { setSearchError('From and Thru dates are required.'); return; }
    setSearchError(null);
    setIsSearched(true);
    refetch();
  };

  const handleParamKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey && e.key === 's') { e.preventDefault(); doSearch(); }
  };

  const rows: any[] = Array.isArray(results) ? results : [];

  const renderAccounts = (row: any): string => {
    if (row.accounts && Array.isArray(row.accounts)) {
      return row.accounts.map((a: any) => a.accountCode ?? a.code ?? a).join(', ');
    }
    if (row.lines && Array.isArray(row.lines)) {
      const codes = [...new Set(row.lines.map((l: any) => l.accountCode ?? l.acct ?? l.account ?? '').filter(Boolean))];
      return codes.join(', ');
    }
    return row.accountCode ?? row.account ?? '—';
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">

      {/* Parameter bar */}
      <div
        ref={paramAreaRef}
        className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3"
        onKeyDown={handleParamKeyDown}
      >
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Company:</label>
          <input
            className="h-8 w-20 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Source:</label>
          {JournalSourceLookup ? (
            <>
              <input
                className="h-8 w-20 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
                value={sourceCode}
                onChange={(e) => setSourceCode(e.target.value)}
                placeholder="#"
              />
              <button
                className="h-8 px-2 border border-gray-300 rounded text-xs hover:bg-gray-100"
                onClick={() => setShowSourceLookup(true)}
              >
                Source
              </button>
            </>
          ) : (
            <input
              className="h-8 w-20 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value)}
              placeholder="Code"
            />
          )}
        </div>

        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Reference#:</label>
          <input
            className="h-8 w-32 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={referenceNum}
            onChange={(e) => setReferenceNum(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Control#:</label>
          <input
            className="h-8 w-32 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={controlNum}
            onChange={(e) => setControlNum(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Period:</label>
          <select
            className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DatePreset)}
          >
            {DATE_PRESETS.map((p) => (
              <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">From:</label>
          <input
            type="date"
            className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setDateRange('CUSTOM'); }}
          />
        </div>

        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Thru:</label>
          <input
            type="date"
            className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
            value={thruDate}
            onChange={(e) => { setThruDate(e.target.value); setDateRange('CUSTOM'); }}
          />
        </div>

        <button
          className="h-8 px-4 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium"
          onClick={doSearch}
        >
          <Search size={13} />
          Search
          <span className="text-blue-300 font-normal ml-0.5">Alt+S</span>
        </button>

        {searchError && (
          <span className="text-xs text-red-600 flex items-center gap-1">
            <AlertCircle size={13} /> {searchError}
          </span>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {!isSearched && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Set parameters and click Search to find transactions.
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-brand" />
          </div>
        )}

        {queryError && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} />
            {(queryError as Error).message}
          </div>
        )}

        {isSearched && !isLoading && !queryError && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-14">Src</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Date</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Reference</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-32">Posted By</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Account</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-28">Amount</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Comments</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    No transactions found for the selected criteria.
                  </td>
                </tr>
              )}
              {rows.map((row: any, i: number) => {
                const lines: any[] = row.lines ?? row.entries ?? [];
                const netAmount = lines.reduce((sum: number, l: any) => {
                  const a = l.amount ?? (l.debit ?? 0) - (l.credit ?? 0);
                  return sum + Number(a);
                }, row.amount != null ? Number(row.amount) : 0);
                const isNeg = netAmount < 0;
                const txnDate = row.entryDate ?? row.transactionDate ?? row.date ?? '';
                const formattedDate = txnDate
                  ? new Date(txnDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
                  : '—';
                const acctDisplay = renderAccounts(row);

                return (
                  <tr
                    key={row.id ?? i}
                    className="h-9 border-b border-gray-100 hover:bg-brand-light cursor-pointer"
                    onDoubleClick={() => {
                      setSelectedTxnId(row.id ?? null);
                      setDetailOpen(true);
                    }}
                  >
                    <td className="px-3 font-mono tabular-nums">{row.sourceCode ?? row.source ?? '—'}</td>
                    <td className="px-3 font-mono">{formattedDate}</td>
                    <td className="px-3 font-mono">{row.referenceNumber ?? row.refNo ?? '—'}</td>
                    <td className="px-3">{row.postedBy ?? row.createdBy ?? '—'}</td>
                    <td className="px-3 font-mono text-xs">{acctDisplay}</td>
                    <td className={`px-3 text-right font-mono tabular-nums ${isNeg ? 'text-red-600' : ''}`}>
                      {isNeg ? `(${fmt(Math.abs(netAmount))})` : fmt(netAmount)}
                    </td>
                    <td className="px-3">{row.description ?? row.comments ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Journal Source Lookup */}
      {showSourceLookup && JournalSourceLookup && (
        <JournalSourceLookup
          isOpen={showSourceLookup}
          onClose={() => setShowSourceLookup(false)}
          onSelect={(src: any) => {
            setSourceCode(src.sourceCode ?? '');
            setShowSourceLookup(false);
          }}
        />
      )}

      <TransactionDetailPopup
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        transactionId={selectedTxnId}
      />
    </div>
  );
}
