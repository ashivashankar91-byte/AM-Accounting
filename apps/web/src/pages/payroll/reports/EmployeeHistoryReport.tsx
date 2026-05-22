import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';

interface CheckRow {
  runId: string;
  checkDate: string;
  checkNumber: string;
  grossPay: number;
  netPay: number;
  federalWH: number;
  stateWH: number;
  fica: number;
  medicare: number;
}

// Mock check data keyed by employee ID
const MOCK_CHECKS: Record<string, CheckRow[]> = {
  'E-1042': [
    { runId: 'r1', checkDate: '2026-05-15', checkNumber: 'CHK-08821', grossPay: 4210.00, netPay: 2980.14, federalWH: 632.00, stateWH: 210.50, fica: 260.86, medicare: 61.05 },
    { runId: 'r2', checkDate: '2026-04-30', checkNumber: 'CHK-08654', grossPay: 4210.00, netPay: 3012.33, federalWH: 590.00, stateWH: 210.50, fica: 260.86, medicare: 61.05 },
    { runId: 'r3', checkDate: '2026-04-15', checkNumber: 'CHK-08512', grossPay: 4100.00, netPay: 2940.77, federalWH: 580.00, stateWH: 205.00, fica: 254.20, medicare: 59.45 },
  ],
  'E-1017': [
    { runId: 'r1', checkDate: '2026-05-15', checkNumber: 'CHK-08822', grossPay: 3100.00, netPay: 2210.55, federalWH: 465.00, stateWH: 155.00, fica: 192.20, medicare: 44.95 },
    { runId: 'r2', checkDate: '2026-04-30', checkNumber: 'CHK-08655', grossPay: 3100.00, netPay: 2220.11, federalWH: 450.00, stateWH: 155.00, fica: 192.20, medicare: 44.95 },
  ],
};

const DEFAULT_CHECKS: CheckRow[] = [
  { runId: 'r1', checkDate: '2026-05-15', checkNumber: 'CHK-09001', grossPay: 5000.00, netPay: 3550.00, federalWH: 750.00, stateWH: 250.00, fica: 310.00, medicare: 72.50 },
  { runId: 'r2', checkDate: '2026-04-30', checkNumber: 'CHK-08901', grossPay: 5000.00, netPay: 3560.00, federalWH: 740.00, stateWH: 250.00, fica: 310.00, medicare: 72.50 },
  { runId: 'r3', checkDate: '2026-04-15', checkNumber: 'CHK-08780', grossPay: 4800.00, netPay: 3420.00, federalWH: 710.00, stateWH: 240.00, fica: 297.60, medicare: 69.60 },
];

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function withinRange(dateStr: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  const d = dateStr;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function downloadCsv(rows: CheckRow[], employeeId: string) {
  const header = 'Check Date,Check#,Gross Pay,Net Pay,Federal W/H,State W/H,FICA,Medicare\n';
  const body = rows.map(r =>
    [r.checkDate, r.checkNumber,
      r.grossPay.toFixed(2), r.netPay.toFixed(2),
      r.federalWH.toFixed(2), r.stateWH.toFixed(2),
      r.fica.toFixed(2), r.medicare.toFixed(2)].join(',')
  ).join('\n');
  const blob = new Blob([header + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `employee-history-${employeeId || 'unknown'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EmployeeHistoryReport() {
  const today = new Date().toISOString().split('T')[0];
  const yearStart = today.slice(0, 4) + '-01-01';

  const [employeeId, setEmployeeId]     = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [fromDate, setFromDate]         = useState(yearStart);
  const [toDate, setToDate]             = useState(today);
  const [generated, setGenerated]       = useState(false);
  const [queryKey, setQueryKey]         = useState(0);

  const { isLoading: runsLoading } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.listRuns(),
    retry: false,
  });

  const rawChecks: CheckRow[] = useMemo(() => {
    if (!employeeId.trim()) return DEFAULT_CHECKS;
    const id = employeeId.trim().toUpperCase();
    return MOCK_CHECKS[id] ?? DEFAULT_CHECKS;
  }, [employeeId, queryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredChecks = useMemo(() =>
    rawChecks.filter(c => withinRange(c.checkDate, fromDate, toDate)),
    [rawChecks, fromDate, toDate]
  );

  const ytd = useMemo(() => ({
    grossPay:   filteredChecks.reduce((s, r) => s + r.grossPay, 0),
    netPay:     filteredChecks.reduce((s, r) => s + r.netPay, 0),
    federalWH:  filteredChecks.reduce((s, r) => s + r.federalWH, 0),
    stateWH:    filteredChecks.reduce((s, r) => s + r.stateWH, 0),
    fica:       filteredChecks.reduce((s, r) => s + r.fica, 0),
    medicare:   filteredChecks.reduce((s, r) => s + r.medicare, 0),
  }), [filteredChecks]);

  function handleGenerate() {
    setQueryKey(k => k + 1);
    setGenerated(true);
  }

  function handleIdChange(val: string) {
    setEmployeeId(val);
    const id = val.trim().toUpperCase();
    if (id === 'E-1042') setEmployeeName('Marcus Delgado');
    else if (id === 'E-1017') setEmployeeName('Priya Nair');
    else setEmployeeName('');
    setGenerated(false);
  }

  if (runsLoading) return <PageLoader page="Employee History" service="payroll-service" port={3010} />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Employee History Report</h1>
        <p className="text-sm text-gray-500 mt-0.5">All payroll checks for a selected employee within a date range</p>
      </div>

      {/* Parameters card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Report Parameters</h2>

        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Employee ID</label>
            <input
              type="text"
              placeholder="e.g. E-1042"
              value={employeeId}
              onChange={e => handleIdChange(e.target.value)}
              className="h-8 w-36 px-2 border border-gray-300 rounded text-sm text-gray-900 font-mono focus:ring-1 focus:ring-brand focus:border-blue-500 outline-none placeholder-gray-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Employee Name</label>
            <input
              type="text"
              placeholder="Name (auto-fills)"
              value={employeeName}
              onChange={e => setEmployeeName(e.target.value)}
              className="h-8 w-48 px-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-1 focus:ring-brand focus:border-blue-500 outline-none placeholder-gray-400 bg-gray-50"
            />
          </div>
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
          <span>Shows all payroll checks for the selected employee within the date range.</span>
        </div>
      </div>

      {/* Check table */}
      {generated && (
        <>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <span className="text-sm font-semibold text-gray-700">
                {employeeName || employeeId || 'All Employees'} — {filteredChecks.length} check(s)
              </span>
              <button
                onClick={() => downloadCsv(filteredChecks, employeeId)}
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
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Check Date</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Check #</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross Pay</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Net Pay</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Federal W/H</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">State W/H</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">FICA</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Medicare</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredChecks.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-400 text-sm">No checks found for selected criteria.</td>
                    </tr>
                  ) : filteredChecks.map(row => (
                    <tr key={row.checkNumber} className="h-9 hover:bg-gray-50">
                      <td className="px-4 py-0 font-mono text-xs text-gray-700">{row.checkDate}</td>
                      <td className="px-4 py-0 font-mono text-xs text-gray-600">{row.checkNumber}</td>
                      <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(row.grossPay)}</td>
                      <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(row.netPay)}</td>
                      <td className="px-4 py-0 text-right font-mono text-gray-700">{fmt(row.federalWH)}</td>
                      <td className="px-4 py-0 text-right font-mono text-gray-700">{fmt(row.stateWH)}</td>
                      <td className="px-4 py-0 text-right font-mono text-gray-700">{fmt(row.fica)}</td>
                      <td className="px-4 py-0 text-right font-mono text-gray-700">{fmt(row.medicare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* YTD Totals */}
          {filteredChecks.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">YTD Totals</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                {([
                  ['Gross Pay',   ytd.grossPay],
                  ['Net Pay',     ytd.netPay],
                  ['Federal W/H', ytd.federalWH],
                  ['State W/H',   ytd.stateWH],
                  ['FICA',        ytd.fica],
                  ['Medicare',    ytd.medicare],
                ] as [string, number][]).map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-500">{label}</span>
                    <span className="font-mono font-semibold text-gray-900 text-sm">{fmt(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!generated && (
        <div className="flex items-center justify-center h-48 bg-white border border-gray-200 rounded-lg text-gray-400 text-sm">
          Enter employee ID, set a date range, and click Generate.
        </div>
      )}
    </div>
  );
}
