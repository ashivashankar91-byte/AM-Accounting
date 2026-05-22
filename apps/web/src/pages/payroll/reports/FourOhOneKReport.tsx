import { useState, useMemo } from 'react';
import PageLoader from '../../../components/PageLoader';

interface FourOhOneKRow {
  employeeNumber: string;
  employeeName: string;
  contributionAmount: number;
  employerMatch: number;
  ytdContribution: number;
  ytdMatch: number;
}

const MOCK_DATA: FourOhOneKRow[] = [
  { employeeNumber: 'E-1042', employeeName: 'Marcus Delgado',    contributionAmount:  336.80, employerMatch:  168.40, ytdContribution: 1_684.00, ytdMatch:  842.00 },
  { employeeNumber: 'E-1017', employeeName: 'Priya Nair',        contributionAmount:  248.00, employerMatch:  124.00, ytdContribution: 1_240.00, ytdMatch:  620.00 },
  { employeeNumber: 'E-2003', employeeName: 'Sandra Kuznetsov',  contributionAmount:  780.00, employerMatch:  390.00, ytdContribution: 3_900.00, ytdMatch: 1_950.00 },
  { employeeNumber: 'E-1088', employeeName: 'Trevor Washington', contributionAmount:  292.00, employerMatch:  146.00, ytdContribution: 1_460.00, ytdMatch:  730.00 },
  { employeeNumber: 'E-1055', employeeName: 'Linda Okonkwo',     contributionAmount:  225.60, employerMatch:  112.80, ytdContribution: 1_128.00, ytdMatch:  564.00 },
  { employeeNumber: 'E-2011', employeeName: 'David Park',        contributionAmount:  520.00, employerMatch:  260.00, ytdContribution: 2_600.00, ytdMatch: 1_300.00 },
];

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function withinRange(checkDate: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (from && checkDate < from) return false;
  if (to && checkDate > to) return false;
  return true;
}

function downloadCsv(rows: FourOhOneKRow[], fromDate: string, toDate: string) {
  const header = 'Employee#,Employee Name,Contribution Amount,Employer Match,YTD Contribution,YTD Match\n';
  const body = rows.map(r =>
    [r.employeeNumber, r.employeeName,
      r.contributionAmount.toFixed(2), r.employerMatch.toFixed(2),
      r.ytdContribution.toFixed(2), r.ytdMatch.toFixed(2)].join(',')
  ).join('\n');
  const filename = `401k-report${fromDate ? `-${fromDate}` : ''}${toDate ? `-${toDate}` : ''}.csv`;
  const blob = new Blob([header + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FourOhOneKReport() {
  const today = new Date().toISOString().split('T')[0];
  const yearStart = today.slice(0, 4) + '-01-01';

  const [fromDate, setFromDate]   = useState(yearStart);
  const [toDate, setToDate]       = useState(today);
  const [generated, setGenerated] = useState(false);
  const [loading, setLoading]     = useState(false);

  // In a real implementation the date range would filter server-side.
  // Here we display all mock rows when generated (they are YTD figures already).
  const rows: FourOhOneKRow[] = useMemo(() => {
    if (!generated) return [];
    return MOCK_DATA;
  }, [generated]);

  const totals = useMemo(() => ({
    contributionAmount: rows.reduce((s, r) => s + r.contributionAmount, 0),
    employerMatch:      rows.reduce((s, r) => s + r.employerMatch, 0),
    ytdContribution:    rows.reduce((s, r) => s + r.ytdContribution, 0),
    ytdMatch:           rows.reduce((s, r) => s + r.ytdMatch, 0),
  }), [rows]);

  function handleGenerate() {
    setLoading(true);
    setTimeout(() => { setLoading(false); setGenerated(true); }, 350);
  }

  if (loading) return <PageLoader page="401(k) Report" service="payroll-service" port={3010} />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">401(k) Contribution Report</h1>
        <p className="text-sm text-gray-500 mt-0.5">Employee and employer 401(k) contributions for the selected pay period range</p>
      </div>

      {/* Parameters card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Report Parameters</h2>

        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setGenerated(false); }}
              className="h-8 px-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-1 focus:ring-brand focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setGenerated(false); }}
              className="h-8 px-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-1 focus:ring-brand focus:border-blue-500 outline-none"
            />
          </div>
          <button
            onClick={handleGenerate}
            className="h-8 px-4 bg-brand text-white text-sm font-medium rounded hover:bg-brand-hover transition-colors"
          >
            Generate
          </button>
        </div>

        <div className="flex items-start gap-2 bg-brand-light border border-brand-border rounded p-3 text-sm text-blue-800">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <span>401(k) contribution report for the selected pay period range. YTD figures reflect the full calendar year.</span>
        </div>
      </div>

      {/* Report table */}
      {generated && rows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-700">
              Period: {fromDate} — {toDate} · {rows.length} employees
            </span>
            <button
              onClick={() => downloadCsv(rows, fromDate, toDate)}
              className="h-8 px-3 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee #</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee Name</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Contribution</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Employer Match</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">YTD Contribution</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">YTD Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(row => (
                  <tr key={row.employeeNumber} className="h-9 hover:bg-gray-50">
                    <td className="px-4 py-0 font-mono text-xs text-gray-600">{row.employeeNumber}</td>
                    <td className="px-4 py-0 text-gray-900">{row.employeeName}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(row.contributionAmount)}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(row.employerMatch)}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-600">{fmt(row.ytdContribution)}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-600">{fmt(row.ytdMatch)}</td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="h-9 bg-gray-50 border-t-2 border-gray-300 font-semibold">
                  <td className="px-4 py-0 text-gray-900" colSpan={2}>TOTALS</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.contributionAmount)}</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.employerMatch)}</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.ytdContribution)}</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.ytdMatch)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!generated && (
        <div className="flex items-center justify-center h-48 bg-white border border-gray-200 rounded-lg text-gray-400 text-sm">
          Set a date range and click Generate to view 401(k) contribution data.
        </div>
      )}
    </div>
  );
}
