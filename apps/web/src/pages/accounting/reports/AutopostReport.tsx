/**
 * Program 29 Option 1 — Autopost Report
 * Route: /accounting/reports/autopost
 *
 * BR-GL-010: One-time print per date for prior dates.
 *            Today's date is always allowed.
 *            After generating, backend inserts into autopost_report_log.
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, FileText, Download, Printer } from 'lucide-react';
import { glApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';

// ─── helpers ─────────────────────────────────────────────────────────────────

const todayStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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

interface AutopostLogResponse {
  printed: boolean;
  printedAt?: string;
  printedBy?: string;
}

interface AutopostEntry {
  id?: string;
  source_code?: string;
  ref_number?: string;
  account_number?: string;
  description?: string;
  debit?: number | string;
  credit?: number | string;
  journal_source_name?: string;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function AutopostReport() {
  const TODAY = todayStr();
  const queryClient = useQueryClient();

  const [reportDate, setReportDate] = useState<string>(TODAY);
  const [company, setCompany] = useState<string>('01');
  const [generated, setGenerated] = useState<boolean>(false);

  const isToday = reportDate === TODAY;

  // ─── check autopost log (BR-GL-010) ────────────────────────────────────────

  const {
    data: logData,
    isLoading: logLoading,
  } = useQuery<any>({
    queryKey: ['autopost-report-log', reportDate],
    queryFn: () => glApi.getEntries(`type=autopost-log&date=${reportDate}&company=${company}`),
    enabled: !!reportDate && !isToday,
    staleTime: 30_000,
    retry: 1,
  });

  // The log endpoint may return an object or an array with one element
  const logRecord: AutopostLogResponse | null = !isToday
    ? (Array.isArray(logData) ? (logData[0] ?? null) : (logData ?? null))
    : null;

  const alreadyPrinted = logRecord?.printed
    ? {
        printedAt: logRecord.printedAt ?? '',
        printedBy: logRecord.printedBy ?? '',
      }
    : null;

  const generateDisabled = !isToday && !!alreadyPrinted;

  // ─── report data query ────────────────────────────────────────────────────

  const params = `source=AUTOPOST&date=${reportDate}&company=${encodeURIComponent(company)}`;

  const {
    data: entries,
    isLoading: entriesLoading,
    isError: entriesError,
    error: entriesErrorObj,
    refetch,
  } = useQuery<AutopostEntry[]>({
    queryKey: ['autopost-entries', reportDate, company],
    queryFn: () => glApi.getEntries(params),
    enabled: generated && !generateDisabled,
    staleTime: 0,
  });

  // ─── totals ───────────────────────────────────────────────────────────────

  const totalDebit = useMemo(() =>
    (entries ?? []).reduce((s, e) => s + (parseFloat(String(e.debit ?? 0)) || 0), 0),
    [entries]
  );
  const totalCredit = useMemo(() =>
    (entries ?? []).reduce((s, e) => s + (parseFloat(String(e.credit ?? 0)) || 0), 0),
    [entries]
  );

  // ─── CSV export ───────────────────────────────────────────────────────────

  const exportCsv = () => {
    if (!entries || entries.length === 0) return;
    const header = ['Source', 'Ref#', 'Account#', 'Description', 'Debit', 'Credit', 'Journal Source Name'];
    const rows = entries.map(e => [
      e.source_code ?? '',
      e.ref_number ?? '',
      e.account_number ?? '',
      `"${(e.description ?? '').replace(/"/g, '""')}"`,
      fmt(e.debit),
      fmt(e.credit),
      `"${(e.journal_source_name ?? '').replace(/"/g, '""')}"`,
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autopost-report-${reportDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerate = () => {
    setGenerated(false);
    // Invalidate the log cache so a fresh check runs on next visit
    queryClient.invalidateQueries({ queryKey: ['autopost-report-log', reportDate] });
    setTimeout(() => setGenerated(true), 0);
  };

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 p-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 font-['Inter']">
            Autopost Report
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Program 29 Option 1 — Auto-posted journal entries</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={!entries || entries.length === 0}
            className="flex items-center gap-1.5 px-3 h-8 text-sm border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-['Inter']"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 h-8 text-sm border border-gray-300 rounded-md hover:bg-gray-50 font-['Inter']"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
        </div>
      </div>

      {/* Already-printed amber banner (BR-GL-010) */}
      {!isToday && alreadyPrinted && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
          <Lock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm font-['Inter']">
            <p className="font-semibold text-amber-800">One-time print restriction (BR-GL-010)</p>
            <p className="text-amber-700 mt-0.5">
              This report was already printed on{' '}
              <span className="font-medium">{fmtTs(alreadyPrinted.printedAt)}</span>
              {alreadyPrinted.printedBy ? (
                <> by <span className="font-medium">{alreadyPrinted.printedBy}</span></>
              ) : null}.
              {' '}One-time print only (BR-GL-010).
            </p>
          </div>
        </div>
      )}

      {/* Parameters Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4 font-['Inter']">Report Parameters</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {/* Report Date */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 font-['Inter']">Report Date</label>
            <input
              type="date"
              value={reportDate}
              max={TODAY}
              onChange={e => {
                setReportDate(e.target.value);
                setGenerated(false);
              }}
              className="h-8 px-2 border border-gray-300 rounded-md text-sm font-['Inter'] focus:outline-none focus:ring-2 focus:ring-brand"
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

        <div className="mt-4">
          <button
            onClick={handleGenerate}
            disabled={generateDisabled || logLoading || !reportDate}
            className="px-4 h-8 bg-brand hover:bg-brand-hover disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors font-['Inter']"
          >
            {logLoading && !isToday ? 'Checking print log…' : 'Generate Report'}
          </button>
          {generateDisabled && (
            <span className="ml-3 text-xs text-amber-700 font-['Inter']">
              Disabled — this date has already been printed (BR-GL-010).
            </span>
          )}
        </div>
      </div>

      {/* Report output */}
      {generated && !generateDisabled && (
        <>
          {entriesLoading && <PageLoader page="Autopost Report" service="gl-service" port={3001} />}
          {entriesError && (
            <PageError
              error={entriesErrorObj as Error}
              serviceName="gl-service"
              port={3001}
              retry={() => refetch()}
            />
          )}

          {!entriesLoading && !entriesError && entries && (
            <>
              {entries.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-lg flex flex-col items-center justify-center py-16">
                  <FileText className="w-10 h-10 text-gray-300 mb-3" />
                  <p className="text-sm text-gray-500 font-['Inter']">
                    No auto-posted entries found for {reportDate}.
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm font-['Inter']">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[64px]">Source</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[90px]">Ref#</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[110px]">Account#</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Description</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-[110px]">Debit</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-[110px]">Credit</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[180px]">Journal Source Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry, i) => (
                        <tr key={i} className="h-9 border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-3 font-mono text-xs text-gray-700">{entry.source_code ?? '—'}</td>
                          <td className="px-3 font-mono text-xs text-gray-700">{entry.ref_number ?? '—'}</td>
                          <td className="px-3 font-mono text-xs text-gray-700">{entry.account_number ?? '—'}</td>
                          <td className="px-3 text-xs text-gray-700 truncate max-w-[260px]">{entry.description ?? ''}</td>
                          <td className="px-3 text-right font-mono text-xs text-gray-900">{fmt(entry.debit)}</td>
                          <td className="px-3 text-right font-mono text-xs text-gray-900">{fmt(entry.credit)}</td>
                          <td className="px-3 text-xs text-gray-700 truncate max-w-[180px]">{entry.journal_source_name ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-gray-50">
                        <td colSpan={4} className="px-3 h-9 text-xs font-semibold text-gray-700 font-['Inter']">
                          Total — {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                        </td>
                        <td className="px-3 h-9 text-right font-mono text-xs font-bold text-gray-900">{fmt(totalDebit)}</td>
                        <td className="px-3 h-9 text-right font-mono text-xs font-bold text-gray-900">{fmt(totalCredit)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
