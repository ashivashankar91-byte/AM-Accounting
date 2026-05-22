/**
 * Program 29 Option 2 — Cross Post Report
 * Route: /accounting/reports/cross-post
 *
 * BR-GL-011: Cross Post = same base account number on both debit and credit
 *            sides of a journal entry (after stripping leading alpha prefix).
 *            E.g. "A-1234" and "B-1234" → base "1234" → cross-post detected.
 *
 * Client-side detection: fetch all entries for the period, group by journal_id,
 * then find entries where the same base# appears on both sides.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Info, Download, Printer } from 'lucide-react';
import { glApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';

// ─── helpers ─────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1; // 1-based

/** Strip leading letter prefixes and dashes from an account string, return numeric base. */
const extractBase = (account: string): string => {
  if (!account) return '';
  // Remove leading alpha characters and any immediately following dash/space
  return account.replace(/^[A-Za-z]+[-\s]?/, '').trim();
};

const fmt = (n: number | string | undefined | null): string => {
  const num = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (isNaN(num)) return '0.00';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtSigned = (n: number): string => {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n === 0) return '0.00';
  return n < 0 ? `(${abs})` : abs;
};

// ─── types ───────────────────────────────────────────────────────────────────

interface JournalLine {
  id?: string;
  journal_id?: string;
  entry_date?: string;
  source_code?: string;
  ref_number?: string;
  account_number?: string;
  description?: string;
  debit?: number | string;
  credit?: number | string;
}

interface CrossPostLine extends JournalLine {
  baseNumber: string;
  netAmount: number;
}

interface CrossPostGroup {
  journalId: string;
  date?: string;
  source?: string;
  refNumber?: string;
  lines: CrossPostLine[];
}

// ─── component ───────────────────────────────────────────────────────────────

export default function CrossPostReport() {
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [company, setCompany] = useState<string>('01');
  const [generated, setGenerated] = useState<boolean>(false);

  // Build query params for the period
  const params = useMemo(() => {
    const mm = String(selectedMonth).padStart(2, '0');
    // Last day of selected month
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
    const fromDate = `${selectedYear}-${mm}-01`;
    const toDate = `${selectedYear}-${mm}-${String(lastDay).padStart(2, '0')}`;
    return `fromDate=${fromDate}&toDate=${toDate}&company=${encodeURIComponent(company)}`;
  }, [selectedYear, selectedMonth, company]);

  const {
    data: rawEntries,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<JournalLine[]>({
    queryKey: ['cross-post-entries', params],
    queryFn: () => glApi.getEntries(params),
    enabled: generated,
    staleTime: 0,
  });

  // ─── client-side cross-post detection (BR-GL-011) ─────────────────────────

  const crossPostGroups = useMemo<CrossPostGroup[]>(() => {
    if (!rawEntries || rawEntries.length === 0) return [];

    // Group lines by journal_id
    const byJournal = new Map<string, JournalLine[]>();
    for (const line of rawEntries) {
      const jid = line.journal_id ?? line.id ?? '__unknown__';
      if (!byJournal.has(jid)) byJournal.set(jid, []);
      byJournal.get(jid)!.push(line);
    }

    const result: CrossPostGroup[] = [];

    for (const [journalId, lines] of byJournal) {
      // Collect base account numbers on debit and credit sides
      const debitBases = new Set<string>();
      const creditBases = new Set<string>();

      for (const line of lines) {
        const base = extractBase(line.account_number ?? '');
        if (!base) continue;
        const debitAmt = parseFloat(String(line.debit ?? 0)) || 0;
        const creditAmt = parseFloat(String(line.credit ?? 0)) || 0;
        if (debitAmt > 0) debitBases.add(base);
        if (creditAmt > 0) creditBases.add(base);
      }

      // Find intersection (same base on both sides)
      const crossBases = new Set<string>();
      for (const base of debitBases) {
        if (creditBases.has(base)) crossBases.add(base);
      }

      if (crossBases.size === 0) continue;

      // Collect only the lines whose base is in the cross-post set
      const crossLines: CrossPostLine[] = lines
        .filter(l => crossBases.has(extractBase(l.account_number ?? '')))
        .map(l => {
          const debitAmt = parseFloat(String(l.debit ?? 0)) || 0;
          const creditAmt = parseFloat(String(l.credit ?? 0)) || 0;
          return {
            ...l,
            baseNumber: extractBase(l.account_number ?? ''),
            netAmount: debitAmt - creditAmt,
          };
        });

      // Sort: group by base#, then debit first
      crossLines.sort((a, b) => {
        if (a.baseNumber < b.baseNumber) return -1;
        if (a.baseNumber > b.baseNumber) return 1;
        return b.netAmount - a.netAmount; // debit (positive net) first
      });

      const firstLine = lines[0];
      result.push({
        journalId,
        date: firstLine.entry_date,
        source: firstLine.source_code,
        refNumber: firstLine.ref_number,
        lines: crossLines,
      });
    }

    // Sort groups by date, then journalId
    result.sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date);
      return a.journalId.localeCompare(b.journalId);
    });

    return result;
  }, [rawEntries]);

  const totalLines = useMemo(() => crossPostGroups.reduce((s, g) => s + g.lines.length, 0), [crossPostGroups]);

  // ─── CSV export ───────────────────────────────────────────────────────────

  const exportCsv = () => {
    if (crossPostGroups.length === 0) return;
    const header = ['Journal ID', 'Date', 'Source', 'Ref#', 'Account# (w/ prefix)', 'Base#', 'Debit', 'Credit', 'Net', 'Description'];
    const rows: string[][] = [];
    for (const group of crossPostGroups) {
      for (const line of group.lines) {
        const debitAmt = parseFloat(String(line.debit ?? 0)) || 0;
        const creditAmt = parseFloat(String(line.credit ?? 0)) || 0;
        rows.push([
          group.journalId,
          group.date ?? '',
          group.source ?? '',
          group.refNumber ?? '',
          line.account_number ?? '',
          line.baseNumber,
          fmt(debitAmt),
          fmt(creditAmt),
          fmtSigned(line.netAmount),
          `"${(line.description ?? '').replace(/"/g, '""')}"`,
        ]);
      }
    }
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cross-post-report-${selectedYear}-${String(selectedMonth).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── year options ─────────────────────────────────────────────────────────

  const yearOptions = Array.from({ length: 8 }, (_, i) => currentYear - i);

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 p-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 font-['Inter']">
            Cross Post Report
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Program 29 Option 2 — Identifies entries with same base GL account on both sides</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={crossPostGroups.length === 0}
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

      {/* Explanation card — always visible (BR-GL-011) */}
      <div className="flex items-start gap-3 bg-brand-light border border-brand-border rounded-lg px-4 py-3">
        <Info className="w-4 h-4 text-brand mt-0.5 shrink-0" />
        <p className="text-xs text-blue-800 font-['Inter'] leading-relaxed">
          <span className="font-semibold">Cross Post Report</span> identifies journal entries that post to the same base GL
          account number on both the debit and credit side. This typically indicates an error or a specific
          inter-department clearing transaction. Base account number is determined by stripping leading letter
          prefixes — for example, account{' '}
          <span className="font-mono">A-1234</span> and{' '}
          <span className="font-mono">B-1234</span> share base number{' '}
          <span className="font-mono">1234</span> and would be flagged (BR-GL-011).
        </p>
      </div>

      {/* Parameters Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4 font-['Inter']">Report Parameters</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {/* Month */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 font-['Inter']">Month</label>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(Number(e.target.value))}
              className="h-8 px-2 border border-gray-300 rounded-md text-sm font-['Inter'] focus:outline-none focus:ring-2 focus:ring-brand bg-white"
            >
              {MONTHS.map((name, idx) => (
                <option key={idx + 1} value={idx + 1}>{name}</option>
              ))}
            </select>
          </div>
          {/* Year */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 font-['Inter']">Year</label>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="h-8 px-2 border border-gray-300 rounded-md text-sm font-['Inter'] focus:outline-none focus:ring-2 focus:ring-brand bg-white"
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
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
            onClick={() => { setGenerated(false); setTimeout(() => setGenerated(true), 0); }}
            className="px-4 h-8 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-md transition-colors font-['Inter']"
          >
            Generate Report
          </button>
        </div>
      </div>

      {/* Report output */}
      {generated && (
        <>
          {isLoading && <PageLoader page="Cross Post Report" service="gl-service" port={3001} />}
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
              {/* Summary badge */}
              {crossPostGroups.length > 0 && (
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 border border-amber-300 text-amber-800 text-xs font-semibold rounded-full font-['Inter']">
                    <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                    {crossPostGroups.length} {crossPostGroups.length === 1 ? 'journal entry' : 'journal entries'} with cross-posted accounts
                    ({totalLines} total lines)
                  </span>
                  <span className="text-xs text-gray-400 font-['Inter']">
                    Period: {MONTHS[selectedMonth - 1]} {selectedYear}
                  </span>
                </div>
              )}

              {crossPostGroups.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-lg flex flex-col items-center justify-center py-16">
                  <FileText className="w-10 h-10 text-gray-300 mb-3" />
                  <p className="text-sm font-semibold text-gray-700 font-['Inter']">No cross-posted entries found</p>
                  <p className="text-xs text-gray-400 mt-1 font-['Inter']">
                    {MONTHS[selectedMonth - 1]} {selectedYear} — all journal entries pass the cross-post check.
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm font-['Inter']">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[130px]">Journal ID</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[100px]">Date</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[64px]">Source</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[90px]">Ref#</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[120px]">Account# (with prefix)</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-[80px]">Base#</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-[100px]">Debit</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-[100px]">Credit</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 w-[100px]">Net</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crossPostGroups.map((group, gi) => {
                        // Track which base numbers are flagged for this group (shown in amber)
                        const crossBasesInGroup = new Set<string>();
                        const debitBases = new Set<string>();
                        const creditBases = new Set<string>();
                        for (const line of group.lines) {
                          const d = parseFloat(String(line.debit ?? 0)) || 0;
                          const c = parseFloat(String(line.credit ?? 0)) || 0;
                          if (d > 0) debitBases.add(line.baseNumber);
                          if (c > 0) creditBases.add(line.baseNumber);
                        }
                        for (const b of debitBases) {
                          if (creditBases.has(b)) crossBasesInGroup.add(b);
                        }

                        return (
                          <>
                            {/* Group separator / journal header */}
                            {gi > 0 && (
                              <tr key={`sep-${gi}`}>
                                <td colSpan={10} className="h-px bg-gray-200 p-0" />
                              </tr>
                            )}
                            {group.lines.map((line, li) => {
                              const debitAmt = parseFloat(String(line.debit ?? 0)) || 0;
                              const creditAmt = parseFloat(String(line.credit ?? 0)) || 0;
                              const isCrossLine = crossBasesInGroup.has(line.baseNumber);
                              return (
                                <tr
                                  key={`g${gi}-l${li}`}
                                  className={`h-9 border-b border-gray-100 ${isCrossLine ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'}`}
                                >
                                  {/* Journal ID — only on first line of the group */}
                                  <td className="px-3 font-mono text-xs text-gray-700">
                                    {li === 0 ? (
                                      <span className="inline-flex items-center gap-1">
                                        {group.journalId}
                                      </span>
                                    ) : ''}
                                  </td>
                                  <td className="px-3 text-xs text-gray-700">{li === 0 ? (group.date ?? '—') : ''}</td>
                                  <td className="px-3 font-mono text-xs text-gray-700">{li === 0 ? (group.source ?? '—') : ''}</td>
                                  <td className="px-3 font-mono text-xs text-gray-700">{li === 0 ? (group.refNumber ?? '—') : ''}</td>
                                  <td className="px-3 font-mono text-xs text-gray-900">
                                    {line.account_number ?? '—'}
                                  </td>
                                  <td className="px-3 font-mono text-xs text-gray-500">
                                    {line.baseNumber || '—'}
                                  </td>
                                  <td className="px-3 text-right font-mono text-xs text-gray-900">
                                    {debitAmt > 0 ? fmt(debitAmt) : ''}
                                  </td>
                                  <td className="px-3 text-right font-mono text-xs text-gray-900">
                                    {creditAmt > 0 ? fmt(creditAmt) : ''}
                                  </td>
                                  <td className={`px-3 text-right font-mono text-xs ${line.netAmount < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                                    {fmtSigned(line.netAmount)}
                                  </td>
                                  <td className="px-3 text-xs text-gray-700 truncate max-w-[220px]">{line.description ?? ''}</td>
                                </tr>
                              );
                            })}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Legend */}
              {crossPostGroups.length > 0 && (
                <div className="flex items-center gap-3 text-xs text-gray-500 font-['Inter']">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 bg-amber-100 border border-amber-300 rounded-sm inline-block" />
                    Cross-posted line (same base account on debit and credit side)
                  </span>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
