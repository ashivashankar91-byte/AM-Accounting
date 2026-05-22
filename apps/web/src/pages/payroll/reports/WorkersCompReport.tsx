import { useState, useMemo } from 'react';
import PageLoader from '../../../components/PageLoader';

type Department = 'ALL' | 'NEW' | 'USED' | 'SERVICE' | 'PARTS' | 'FINANCE' | 'BODY';

interface WCRow {
  employeeId: string;
  employeeName: string;
  dept: Department;
  grossWages: number;
  excludedEarnings: number;
  wcRate: number; // decimal, e.g. 0.025 = 2.50%
}

const MOCK_DATA: WCRow[] = [
  { employeeId: 'E-1042', employeeName: 'Marcus Delgado',    dept: 'SERVICE', grossWages: 8_420.00, excludedEarnings: 320.00, wcRate: 0.0450 },
  { employeeId: 'E-1017', employeeName: 'Priya Nair',        dept: 'PARTS',   grossWages: 6_200.00, excludedEarnings: 0.00,   wcRate: 0.0220 },
  { employeeId: 'E-2003', employeeName: 'Sandra Kuznetsov',  dept: 'FINANCE', grossWages: 9_750.00, excludedEarnings: 750.00, wcRate: 0.0080 },
  { employeeId: 'E-1088', employeeName: 'Trevor Washington', dept: 'NEW',     grossWages: 7_300.00, excludedEarnings: 0.00,   wcRate: 0.0150 },
  { employeeId: 'E-1055', employeeName: 'Linda Okonkwo',     dept: 'BODY',    grossWages: 5_640.00, excludedEarnings: 140.00, wcRate: 0.0580 },
];

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtPct(rate: number): string {
  return (rate * 100).toFixed(2) + '%';
}

function downloadCsv(rows: (WCRow & { taxableWages: number; wcPremium: number })[]) {
  const header = 'Employee ID,Employee Name,Dept,Gross Wages,Excluded Earnings,Taxable Wages,WC Rate,WC Premium\n';
  const body = rows.map(r =>
    [r.employeeId, r.employeeName, r.dept,
      r.grossWages.toFixed(2), r.excludedEarnings.toFixed(2),
      r.taxableWages.toFixed(2), fmtPct(r.wcRate),
      r.wcPremium.toFixed(2)].join(',')
  ).join('\n');
  const blob = new Blob([header + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'workers-comp-report.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function WorkersCompReport() {
  const today = new Date().toISOString().split('T')[0];
  const firstOfMonth = today.slice(0, 8) + '01';

  const [periodFrom, setPeriodFrom]   = useState(firstOfMonth);
  const [periodTo, setPeriodTo]       = useState(today);
  const [department, setDepartment]   = useState<Department>('ALL');
  const [generated, setGenerated]     = useState(false);
  const [loading, setLoading]         = useState(false);

  const filteredBase = useMemo<WCRow[]>(() => {
    if (department === 'ALL') return MOCK_DATA;
    return MOCK_DATA.filter(r => r.dept === department);
  }, [department]);

  const rows = useMemo(() => filteredBase.map(r => ({
    ...r,
    taxableWages: r.grossWages - r.excludedEarnings,
    wcPremium: (r.grossWages - r.excludedEarnings) * r.wcRate,
  })), [filteredBase]);

  const totals = useMemo(() => ({
    grossWages:       rows.reduce((s, r) => s + r.grossWages, 0),
    excludedEarnings: rows.reduce((s, r) => s + r.excludedEarnings, 0),
    taxableWages:     rows.reduce((s, r) => s + r.taxableWages, 0),
    wcPremium:        rows.reduce((s, r) => s + r.wcPremium, 0),
  }), [rows]);

  function handleGenerate() {
    setLoading(true);
    setTimeout(() => { setLoading(false); setGenerated(true); }, 400);
  }

  if (loading) return <PageLoader page="Workers' Comp Report" service="payroll-service" port={3010} />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Workers' Compensation Report</h1>
        <p className="text-sm text-gray-500 mt-0.5">WC premium calculation per BR-PAY-006</p>
      </div>

      {/* Parameters card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Report Parameters</h2>

        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Period From</label>
            <input
              type="date"
              value={periodFrom}
              onChange={e => setPeriodFrom(e.target.value)}
              className="h-8 px-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-1 focus:ring-brand focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Period To</label>
            <input
              type="date"
              value={periodTo}
              onChange={e => setPeriodTo(e.target.value)}
              className="h-8 px-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-1 focus:ring-brand focus:border-blue-500 outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Department</label>
            <select
              value={department}
              onChange={e => setDepartment(e.target.value as Department)}
              className="h-8 px-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-1 focus:ring-brand focus:border-blue-500 outline-none"
            >
              <option value="ALL">All Departments</option>
              <option value="NEW">New</option>
              <option value="USED">Used</option>
              <option value="SERVICE">Service</option>
              <option value="PARTS">Parts</option>
              <option value="FINANCE">Finance</option>
              <option value="BODY">Body</option>
            </select>
          </div>
          <button
            onClick={handleGenerate}
            className="h-8 px-4 bg-brand text-white text-sm font-medium rounded hover:bg-brand-hover transition-colors"
          >
            Generate
          </button>
        </div>

        {/* BR-PAY-006 info note */}
        <div className="flex items-start gap-2 bg-brand-light border border-brand-border rounded p-3 text-sm text-blue-800">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <span>
            Workers' compensation excludes earning codes defined in the exclusion table (up to 18 types per BR-PAY-006).
            Excluded amounts are subtracted from gross wages before applying the WC rate.
          </span>
        </div>
      </div>

      {/* Report table */}
      {generated && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-700">
              Report Period: {periodFrom} — {periodTo}
              {department !== 'ALL' ? ` · ${department}` : ' · All Departments'}
            </span>
            <button
              onClick={() => downloadCsv(rows)}
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
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee ID</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee Name</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Dept</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Gross Wages</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Excluded Earnings</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Taxable Wages</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">WC Rate</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">WC Premium</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(row => (
                  <tr key={row.employeeId} className="h-9 hover:bg-gray-50">
                    <td className="px-4 py-0 font-mono text-xs text-gray-600">{row.employeeId}</td>
                    <td className="px-4 py-0 text-gray-900">{row.employeeName}</td>
                    <td className="px-4 py-0 text-gray-600">{row.dept}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(row.grossWages)}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-600">{fmt(row.excludedEarnings)}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(row.taxableWages)}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-600">{fmtPct(row.wcRate)}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-900 font-medium">{fmt(row.wcPremium)}</td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="h-9 bg-gray-50 border-t-2 border-gray-300 font-semibold">
                  <td className="px-4 py-0 text-gray-900">TOTALS</td>
                  <td className="px-4 py-0" />
                  <td className="px-4 py-0" />
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.grossWages)}</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.excludedEarnings)}</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.taxableWages)}</td>
                  <td className="px-4 py-0" />
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.wcPremium)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!generated && (
        <div className="flex items-center justify-center h-48 bg-white border border-gray-200 rounded-lg text-gray-400 text-sm">
          Set parameters above and click Generate to view the report.
        </div>
      )}
    </div>
  );
}
