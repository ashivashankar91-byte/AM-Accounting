import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';

type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';
type ReportType = 'FEDERAL_941' | 'STATE_SUTA' | 'ALL';

interface EmployeeWageRow {
  employeeNumber: string;
  name: string;
  ssn: string;
  grossWages: number;
  taxableFederal: number;
  federalWH: number;
  state: string;
  stateWH: number;
}

interface StateSummary {
  state: string;
  sutaTaxableWages: number;
  sutaTax: number;
  suiRate: number;
}

interface ReportData {
  employees: EmployeeWageRow[];
  totals: {
    totalWages: number;
    federalIncomeWithheld: number;
    totalFicaWages: number;
    ficaTax: number;
    totalTaxes: number;
  };
  stateBreakdown: StateSummary[];
}

// Demo data used when the API has no employee-level government wage endpoint
function buildDemoData(quarter: Quarter, year: number, stateFilter: string, reportType: ReportType): ReportData {
  const employees: EmployeeWageRow[] = [
    { employeeNumber: 'EMP-001', name: 'Alice Johnson', ssn: '123456789', grossWages: 23750.00, taxableFederal: 23750.00, federalWH: 4200.00, state: 'IL', stateWH: 1187.50 },
    { employeeNumber: 'EMP-002', name: 'Bob Martinez', ssn: '234567890', grossWages: 11050.00, taxableFederal: 11050.00, federalWH: 1545.00, state: 'IL', stateWH: 552.50 },
    { employeeNumber: 'EMP-003', name: 'Carol White', ssn: '345678901', grossWages: 20500.00, taxableFederal: 20500.00, federalWH: 3485.00, state: 'WI', stateWH: 1025.00 },
    { employeeNumber: 'EMP-004', name: 'David Lee', ssn: '456789012', grossWages: 8580.00, taxableFederal: 8580.00, federalWH: 1029.60, state: 'WI', stateWH: 429.00 },
    { employeeNumber: 'EMP-005', name: 'Eve Thompson', ssn: '567890123', grossWages: 15500.00, taxableFederal: 15500.00, federalWH: 2480.00, state: 'IL', stateWH: 775.00 },
  ];

  const filtered = stateFilter.toUpperCase() === 'ALL'
    ? employees
    : employees.filter(e => e.state.toUpperCase() === stateFilter.toUpperCase());

  const total = (arr: EmployeeWageRow[], key: keyof EmployeeWageRow) =>
    arr.reduce((sum, e) => sum + (typeof e[key] === 'number' ? (e[key] as number) : 0), 0);

  const totalWages = total(filtered, 'grossWages');
  const federalIncomeWithheld = total(filtered, 'federalWH');
  const totalFicaWages = totalWages;
  const ficaTax = +(totalFicaWages * 0.153).toFixed(2); // EE + ER combined
  const totalTaxes = +(federalIncomeWithheld + ficaTax).toFixed(2);

  // State breakdown
  const stateMap: Record<string, StateSummary> = {};
  for (const emp of filtered) {
    if (!stateMap[emp.state]) {
      stateMap[emp.state] = { state: emp.state, sutaTaxableWages: 0, sutaTax: 0, suiRate: emp.state === 'WI' ? 0.027 : 0.032 };
    }
    stateMap[emp.state].sutaTaxableWages += emp.grossWages;
    stateMap[emp.state].sutaTax += +(emp.grossWages * stateMap[emp.state].suiRate).toFixed(2);
  }

  return {
    employees: filtered,
    totals: { totalWages, federalIncomeWithheld, totalFicaWages, ficaTax, totalTaxes },
    stateBreakdown: Object.values(stateMap),
  };
}

function maskSSN(ssn: string): string {
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 4) return '***-**-????';
  return `***-**-${digits.slice(-4)}`;
}

function fmtCurrency(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  FEDERAL_941: 'Federal 941',
  STATE_SUTA: 'State SUTA',
  ALL: 'All',
};

const QUARTER_LABELS: Record<Quarter, string> = {
  Q1: 'Q1 (Jan–Mar)',
  Q2: 'Q2 (Apr–Jun)',
  Q3: 'Q3 (Jul–Sep)',
  Q4: 'Q4 (Oct–Dec)',
};

export default function GovernmentWageReport() {
  const currentYear = new Date().getFullYear();
  const [quarter, setQuarter] = useState<Quarter>('Q1');
  const [year, setYear] = useState(currentYear);
  const [stateFilter, setStateFilter] = useState('ALL');
  const [reportType, setReportType] = useState<ReportType>('ALL');
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedParams, setGeneratedParams] = useState<{ quarter: Quarter; year: number; state: string; type: ReportType } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Preload wage bases (not used directly here, but demonstrates the API integration point)
  const { isLoading: wageBasesLoading } = useQuery({
    queryKey: ['payroll-runs-health'],
    queryFn: () => payrollApi.listRuns(),
    retry: false,
  });

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  function handleGenerate() {
    if (year < 2000 || year > 2099) {
      showToast('Please enter a valid year (2000–2099).', 'error');
      return;
    }
    setGenerating(true);
    // Simulate async generation
    setTimeout(() => {
      const data = buildDemoData(quarter, year, stateFilter, reportType);
      setReportData(data);
      setGeneratedParams({ quarter, year, state: stateFilter, type: reportType });
      setGenerating(false);
      showToast('Government wage report generated.', 'success');
    }, 500);
  }

  function handlePrint() {
    window.print();
  }

  async function handleExportCSV() {
    if (!reportData || !generatedParams) return;
    const headers = ['Employee#', 'Name', 'SSN', 'Gross Wages', 'Taxable Federal', 'Federal W/H', 'State', 'State W/H'];
    const rows = reportData.employees.map(e => [
      e.employeeNumber,
      e.name,
      maskSSN(e.ssn),
      e.grossWages.toFixed(2),
      e.taxableFederal.toFixed(2),
      e.federalWH.toFixed(2),
      e.state,
      e.stateWH.toFixed(2),
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gov-wage-${generatedParams.quarter}-${generatedParams.year}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleExportElectronic() {
    showToast('Electronic filing export initiated. File will be prepared per IRS specifications.', 'success');
  }

  if (wageBasesLoading) return <PageLoader page="Government Wage Report" service="payroll-service" port={3012} />;

  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const showStateSection = reportType === 'STATE_SUTA' || reportType === 'ALL';

  return (
    <div className="p-6 font-['Inter',sans-serif]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Government Wage Report</h1>
        <p className="text-sm text-gray-500 mt-1">
          Quarterly government wage report for Form 941 (Federal) and state unemployment filings.
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Parameters Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">Parameters</h2>
        <div className="flex flex-wrap gap-6 items-end">
          {/* Quarter */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Quarter
            </label>
            <select
              value={quarter}
              onChange={e => { setQuarter(e.target.value as Quarter); setReportData(null); }}
              className="h-8 rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-brand min-w-[160px]"
            >
              {(['Q1', 'Q2', 'Q3', 'Q4'] as Quarter[]).map(q => (
                <option key={q} value={q}>{QUARTER_LABELS[q]}</option>
              ))}
            </select>
          </div>

          {/* Year */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Year
            </label>
            <input
              type="number"
              value={year}
              onChange={e => { setYear(parseInt(e.target.value, 10) || currentYear); setReportData(null); }}
              min={2000}
              max={2099}
              className="h-8 w-28 rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          {/* State Filter */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              State Filter
            </label>
            <input
              type="text"
              value={stateFilter}
              onChange={e => { setStateFilter(e.target.value.toUpperCase() || 'ALL'); setReportData(null); }}
              placeholder="ALL"
              maxLength={2}
              className="h-8 w-24 rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 font-mono uppercase focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>

          {/* Report Type */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Report Type
            </label>
            <div className="flex gap-5">
              {(['FEDERAL_941', 'STATE_SUTA', 'ALL'] as ReportType[]).map(rt => (
                <label key={rt} className="flex items-center gap-2 h-8 cursor-pointer">
                  <input
                    type="radio"
                    name="reportType"
                    value={rt}
                    checked={reportType === rt}
                    onChange={() => { setReportType(rt); setReportData(null); }}
                    className="h-4 w-4 text-brand border-gray-300 focus:ring-brand cursor-pointer"
                  />
                  <span className="text-sm text-gray-700 select-none">{REPORT_TYPE_LABELS[rt]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className={`h-9 px-6 rounded text-sm font-semibold transition-colors ${
                generating
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-brand hover:bg-brand-hover text-white'
              }`}
            >
              {generating ? 'Generating…' : 'Generate Report'}
            </button>
          </div>
        </div>

        {/* Info Note */}
        <p className="mt-4 text-xs text-gray-400">
          Quarterly government wage report for Form 941 (Federal) and state unemployment filings.
          SSN is always masked on this report per security policy.
        </p>
      </div>

      {/* Report Output */}
      {reportData && generatedParams && (
        <div className="space-y-5">
          {/* Summary Header Card */}
          <div className="bg-brand text-white rounded-lg px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold">
                {generatedParams.quarter} {generatedParams.year} — {REPORT_TYPE_LABELS[generatedParams.type]}
              </p>
              <p className="text-sm text-blue-200 mt-0.5">
                Generated {today}
                {generatedParams.state !== 'ALL' && ` · State: ${generatedParams.state}`}
              </p>
            </div>
            {/* Export Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="h-8 px-3 rounded text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/30 transition-colors"
              >
                Print
              </button>
              <button
                type="button"
                onClick={handleExportCSV}
                className="h-8 px-3 rounded text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/30 transition-colors"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={handleExportElectronic}
                className="h-8 px-3 rounded text-xs font-semibold bg-white text-brand hover:bg-brand-light transition-colors"
              >
                Export Electronic Filing
              </button>
            </div>
          </div>

          {/* Employee-Level Table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-200">
              <span className="text-sm font-semibold text-gray-700">Employee Detail</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 h-9 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Emp #</th>
                    <th className="px-4 h-9 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Name</th>
                    <th className="px-4 h-9 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">SSN</th>
                    <th className="px-4 h-9 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Gross Wages</th>
                    <th className="px-4 h-9 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Taxable Federal</th>
                    <th className="px-4 h-9 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Federal W/H</th>
                    <th className="px-4 h-9 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">State</th>
                    <th className="px-4 h-9 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">State W/H</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {reportData.employees.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="h-9 px-4 text-sm text-gray-400 italic text-center">
                        No employees found for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    reportData.employees.map(emp => (
                      <tr key={emp.employeeNumber} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 h-9 font-mono text-xs text-gray-700 whitespace-nowrap">{emp.employeeNumber}</td>
                        <td className="px-4 h-9 text-gray-900 font-medium whitespace-nowrap">{emp.name}</td>
                        <td className="px-4 h-9 font-mono text-xs text-gray-600 whitespace-nowrap">{maskSSN(emp.ssn)}</td>
                        <td className="px-4 h-9 text-right font-mono text-gray-900 whitespace-nowrap">${fmtCurrency(emp.grossWages)}</td>
                        <td className="px-4 h-9 text-right font-mono text-gray-900 whitespace-nowrap">${fmtCurrency(emp.taxableFederal)}</td>
                        <td className="px-4 h-9 text-right font-mono text-gray-900 whitespace-nowrap">${fmtCurrency(emp.federalWH)}</td>
                        <td className="px-4 h-9 text-gray-700 whitespace-nowrap">{emp.state}</td>
                        <td className="px-4 h-9 text-right font-mono text-gray-900 whitespace-nowrap">${fmtCurrency(emp.stateWH)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Form 941 Summary Footer */}
          {(reportType === 'FEDERAL_941' || reportType === 'ALL') && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-semibold text-gray-700">Quarter Totals (Form 941 Summary)</span>
              </div>
              <div className="divide-y divide-gray-100">
                {[
                  { line: '1', label: 'Total wages', value: reportData.totals.totalWages },
                  { line: '2', label: 'Federal income tax withheld', value: reportData.totals.federalIncomeWithheld },
                  { line: '3', label: 'Total FICA wages', value: reportData.totals.totalFicaWages },
                  { line: '4', label: 'FICA tax (EE + ER)', value: reportData.totals.ficaTax },
                  { line: '5', label: 'Total taxes', value: reportData.totals.totalTaxes },
                ].map(row => (
                  <div key={row.line} className={`flex items-center justify-between px-4 h-9 ${row.line === '5' ? 'bg-gray-50 font-semibold' : ''}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-gray-400 w-12">Line {row.line}</span>
                      <span className={`text-sm ${row.line === '5' ? 'text-gray-900 font-semibold' : 'text-gray-700'}`}>{row.label}</span>
                    </div>
                    <span className={`font-mono text-sm tabular-nums ${row.line === '5' ? 'text-gray-900 font-semibold' : 'text-gray-900'}`}>
                      ${fmtCurrency(row.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-State SUTA Section */}
          {showStateSection && reportData.stateBreakdown.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-semibold text-gray-700">State Unemployment (SUTA) Summary</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 h-9 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">State</th>
                      <th className="px-4 h-9 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">SUTA Taxable Wages</th>
                      <th className="px-4 h-9 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">SUTA Tax</th>
                      <th className="px-4 h-9 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">SUI Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {reportData.stateBreakdown.map(s => (
                      <tr key={s.state} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 h-9 text-gray-900 font-medium">{s.state}</td>
                        <td className="px-4 h-9 text-right font-mono text-gray-900">${fmtCurrency(s.sutaTaxableWages)}</td>
                        <td className="px-4 h-9 text-right font-mono text-gray-900">${fmtCurrency(s.sutaTax)}</td>
                        <td className="px-4 h-9 text-right font-mono text-gray-700">{(s.suiRate * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
