/**
 * Program 28 — Monthly Transaction Journals
 * Route: /accounting/reports/monthly-trans-journals
 *
 * BR-GL-007: fromDate and toDate must be within the same calendar month/year.
 * BR-GL-004: Unauthorized source codes are excluded entirely (not shown as ACCESS DENIED).
 * BR-GL-008: Report output grouped by posting_batch_id.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, FileText, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { glApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';

// ─── helpers ────────────────────────────────────────────────────────────────

const today = new Date();
const firstOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
const lastOfMonth = (() => {
  const d = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const fmt = (n: number | string | undefined | null): string => {
  const num = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (isNaN(num)) return '0.00';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtTs = (ts: string | undefined | null): string => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return ts;
  }
};

// ─── types ───────────────────────────────────────────────────────────────────

interface JournalLine {
  id: string;
  posting_batch_id?: string;
  posted_at?: string;
  posted_by?: string;
  posted_date?: string;
  source_code?: string;
  ref_number?: string;
  account_number?: string;
  description?: string;
  debit?: number | string;
  credit?: number | string;
  control_number?: string;
}

interface BatchGroup {
  batchId: string;
  postedAt?: string;
  postedBy?: string;
  lines: JournalLine[];
}

// ─── component ───────────────────────────────────────────────────────────────

export default function MonthlyTransJournals() {
  const [fromDate, setFromDate] = useState<string>(firstOfMonth);
  const [toDate, setToDate] = useState<string>(lastOfMonth);
  const [sourceCode, setSourceCode] = useState<string>('');
  const [company, setCompany] = useState<string>('01');
  const [dateError, setDateError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<boolean>(false);
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());

  // ─── date validation (BR-GL-007) ──────────────────────────────────────────

  const validateDates = (from: string, to: string) => {
    if (!from || !to) {
      setDateError(null);
      return;
    }
    const d1 = new Date(from);
    const d2 = new Date(to);
    if (
      isNaN(d1.getTime()) || isNaN(d2.getTime()) ||
      d1.getMonth() !== d2.getMonth() ||
      d1.getFullYear() !== d2.getFullYear()
    ) {
      setDateError(
        'From and To dates must be within the same calendar month (BR-GL-007)'
      );
    } else {
      setDateError(null);
    }
  };

  // ─── query ────────────────────────────────────────────────────────────────

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('fromDate', fromDate);
    p.set('toDate', toDate);
    p.set('company', company);
    if (sourceCode) p.set('sourceCode', sourceCode);
    return p.toString();
  }, [fromDate, toDate, company, sourceCode]);

  const { data: rawEntries, isLoading, isError, error, refetch } = useQuery<JournalLine[]>({
    queryKey: ['monthly-trans-journals', queryParams],
    queryFn: () => glApi.getEntries(queryParams),
    enabled: generated && !dateError,
    staleTime: 0,
  });

  // ─── group by batch (BR-GL-008) ───────────────────────────────────────────

  const batches = useMemo<BatchGroup[]>(() => {
    if (!rawEntries) return [];
    const map = new Map<string, BatchGroup>();
    for (const line of rawEntries) {
      const batchId = line.posting_batch_id ?? '__ungrouped__';
      if (!map.has(batchId)) {
        map.set(batchId, {
          batchId,
          postedAt: line.posted_at,
          postedBy: line.posted_by,
          lines: [],
        });
      }
      map.get(batchId)!.lines.push(line);
    }
    return Array.from(map.values());
  }, [rawEntries]);

  const totalDebit = useMemo(() =>
    (rawEntries ?? []).reduce((s, l) => s + (parseFloat(String(l.debit ?? 0)) || 0), 0),
    [rawEntries]
  );
  const totalCredit = useMemo(() =>
    (rawEntries ?? []).reduce((s, l) => s + (parseFloat(String(l.credit ?? 0)) || 0), 0),
    [rawEntries]
  );

  // ─── CSV export ───────────────────────────────────────────────────────────

  const exportCsv = () => {
    if (!rawEntries || rawEntries.length === 0) return;
    const header = ['Batch ID', 'Posted Date', 'Posted By', 'Source', 'Ref#', 'Account#', 'Description', 'Debit', 'Credit', 'Control#'];
    const rows = rawEntries.map(l => [
      l.posting_batch_id ?? '',
      l.posted_date ?? '',
      l.posted_by ?? '',
      l.source_code ?? '',
      l.ref_number ?? '',
      l.account_number ?? '',
      `"${(l.description ?? '').replace(/"/g, '""')}"`,
      fmt(l.debit),
      fmt(l.credit),
      l.control_number ?? '',
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monthly-trans-journals-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  const toggleBatch = (batchId: string) => {
    setCollapsedBatches(prev => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 p-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 font-['Inter']">
            Monthly Transaction Journals
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Program 28 — Grouped by posting batch</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={!rawEntries || rawEntries.length === 0}
            className="flex items-center gap-1.5 px-3 h-8 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-['Inter']"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 h-8 text-sm border border-gray-300 rounded-md hover:bg-gray-50 font-['Inter']"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
        </div>
      </div>

      {/* Parameters Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4 font-['Inter']">Report Parameters</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {/* From Date */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 font-['Inter']">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              onBlur={() => validateDates(fromDate, toDate)}
              className="h-8 px-2 border border-gray-300 rounded-md text-sm font-['Inter'] focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          {/* To Date */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 font-['Inter']">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              onBlur={() => validateDates(fromDate, toDate)}
              className="h-8 px-2 border border-gray-300 rounded-md text-sm font-['Inter'] focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          {/* Source Code */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 font-['Inter']">Source Code <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="text"
              value={sourceCode}
              onChange={e => setSourceCode(e.target.value.replace(/\D/g, '').slice(0, 2))}
              placeholder="e.g. 88"
              maxLength={2}
              className="h-8 px-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          {/* Company */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 font-['Inter']">Company</label>
            <input
              type="text"
              value={company}
              onChange={e => setCompany(e.target.value)}
              maxLength={4}
              className="h-8 px-2 border border-gray-300 rounded-md text-sm font-['Inter'] focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
        </div>

        {/* Date error (BR-GL-007) */}
        {dateError && (
          <div className="mt-3 flex items-start gap-2 text-red-600 text-xs font-['Inter']">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{dateError}</span>
          </div>
        )}

        <div className="mt-4">
          <button
            onClick={() => { setGenerated(false); setTimeout(() => setGenerated(true), 0); }}
            disabled={!!dateError || !fromDate || !toDate}
            className="px-4 h-8 bg-brand hover:bg-brand-hover disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors font-['Inter']"
          >
            Generate Report
          </button>
        </div>
      </div>

      {/* Report output */}
      {generated && (
        <>
          {isLoading && <PageLoader page="Monthly Transaction Journals" service="gl-service" port={3001} />}
          {isError && (
            <PageError
              error={error as Error}
              serviceName="gl-service"
              port={3001}
              retry={() => refetch()}
            />
          )}

          {!isLoading && !isError && rawEntries && (
            <>
              {rawEntries.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-lg flex flex-col items-center justify-center py-16">
                  <FileText className="w-10 h-10 text-gray-300 mb-3" />
                  <p className="text-sm text-gray-500 font-['Inter']">No transactions found for the selected period.</p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm font-['Inter']">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[120px]">Posted Date</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[110px]">Posted By</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[64px]">Source</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[90px]">Ref#</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[110px]">Account#</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Description</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-[110px]">Debit</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-[110px]">Credit</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[100px]">Control#</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map((batch, bi) => {
                        const collapsed = collapsedBatches.has(batch.batchId);
                        const batchDebit = batch.lines.reduce((s, l) => s + (parseFloat(String(l.debit ?? 0)) || 0), 0);
                        const batchCredit = batch.lines.reduce((s, l) => s + (parseFloat(String(l.credit ?? 0)) || 0), 0);
                        return (
                          <>
                            {/* Group header row (BR-GL-008) */}
                            <tr
                              key={`batch-hdr-${bi}`}
                              className="bg-brand-light border-l-4 border-blue-500 cursor-pointer select-none hover:bg-brand-light"
                              onClick={() => toggleBatch(batch.batchId)}
                            >
                              <td colSpan={7} className="px-3 h-9 text-xs font-semibold text-blue-800">
                                <span className="flex items-center gap-1.5">
                                  {collapsed
                                    ? <ChevronRight className="w-3.5 h-3.5" />
                                    : <ChevronDown className="w-3.5 h-3.5" />
                                  }
                                  Posted: {fmtTs(batch.postedAt)}
                                  {batch.postedBy ? ` · by ${batch.postedBy}` : ''}
                                  <span className="text-blue-500 font-normal ml-2">
                                    ({batch.lines.length} {batch.lines.length === 1 ? 'line' : 'lines'})
                                  </span>
                                </span>
                              </td>
                              <td className="px-3 h-9 text-right text-xs font-mono font-semibold text-blue-800">{fmt(batchDebit)}</td>
                              <td className="px-3 h-9 text-right text-xs font-mono font-semibold text-blue-800">{fmt(batchCredit)}</td>
                            </tr>
                            {/* Transaction rows — per BR-GL-004, restricted rows are excluded entirely */}
                            {!collapsed && batch.lines.map((line, li) => (
                              <tr
                                key={`line-${bi}-${li}`}
                                className="h-9 border-b border-gray-100 hover:bg-gray-50"
                              >
                                <td className="px-3 text-gray-700 text-xs">{line.posted_date ?? '—'}</td>
                                <td className="px-3 text-gray-700 text-xs truncate max-w-[110px]">{line.posted_by ?? '—'}</td>
                                <td className="px-3 font-mono text-xs text-gray-700">{line.source_code ?? '—'}</td>
                                <td className="px-3 font-mono text-xs text-gray-700">{line.ref_number ?? '—'}</td>
                                <td className="px-3 font-mono text-xs text-gray-700">{line.account_number ?? '—'}</td>
                                <td className="px-3 text-gray-700 text-xs truncate max-w-[260px]">{line.description ?? ''}</td>
                                <td className="px-3 text-right font-mono text-xs text-gray-900">{fmt(line.debit)}</td>
                                <td className="px-3 text-right font-mono text-xs text-gray-900">{fmt(line.credit)}</td>
                                <td className="px-3 font-mono text-xs text-gray-500">{line.control_number ?? '—'}</td>
                              </tr>
                            ))}
                          </>
                        );
                      })}
                    </tbody>
                    {/* Grand totals */}
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-gray-50">
                        <td colSpan={6} className="px-3 h-9 text-xs font-semibold text-gray-700 font-['Inter']">
                          Grand Total — {rawEntries.length} transaction{rawEntries.length !== 1 ? 's' : ''}
                        </td>
                        <td className="px-3 h-9 text-right font-mono text-xs font-bold text-gray-900">{fmt(totalDebit)}</td>
                        <td className="px-3 h-9 text-right font-mono text-xs font-bold text-gray-900">{fmt(totalCredit)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* BR-GL-004 footnote */}
              <p className="text-xs text-gray-400 italic font-['Inter']">
                Note: Transactions for restricted source codes are excluded per journal source security policy (BR-GL-004).
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
