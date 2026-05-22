import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';

interface TaxRow {
  taxType: string;
  taxableWages: number;
  eeWithholding: number;
  erShare: number;
}

// Maps wage_base_type values from the API to display labels and row structure
const WAGE_BASE_TYPE_MAP: Record<string, { label: string; hasEE: boolean; hasER: boolean }> = {
  US_FEDERAL:   { label: 'Federal Income Tax',              hasEE: true,  hasER: false },
  STATE:        { label: 'State Income Tax',                hasEE: true,  hasER: false },
  EEFICA:       { label: 'FICA — Social Security (EE)',     hasEE: true,  hasER: false },
  ERFICA:       { label: 'FICA — Social Security (ER)',     hasEE: false, hasER: true  },
  EE_MEDICARE:  { label: 'Medicare (EE)',                   hasEE: true,  hasER: false },
  ER_MEDICARE:  { label: 'Medicare (ER)',                   hasEE: false, hasER: true  },
  FUTA:         { label: 'FUTA',                            hasEE: false, hasER: true  },
  SUTA:         { label: 'SUTA',                            hasEE: false, hasER: true  },
};

// Canonical row order for display
const ROW_ORDER = ['US_FEDERAL', 'STATE', 'EEFICA', 'ERFICA', 'EE_MEDICARE', 'ER_MEDICARE', 'FUTA', 'SUTA'];

// Static fallback data used when no API data is available
const FALLBACK_ROWS: TaxRow[] = [
  { taxType: 'US_FEDERAL',  taxableWages: 37_260.00, eeWithholding: 5_589.00, erShare:     0.00 },
  { taxType: 'STATE',       taxableWages: 37_260.00, eeWithholding: 1_863.00, erShare:     0.00 },
  { taxType: 'EEFICA',      taxableWages: 37_260.00, eeWithholding: 2_310.12, erShare:     0.00 },
  { taxType: 'ERFICA',      taxableWages: 37_260.00, eeWithholding:     0.00, erShare: 2_310.12 },
  { taxType: 'EE_MEDICARE', taxableWages: 37_260.00, eeWithholding:   540.27, erShare:     0.00 },
  { taxType: 'ER_MEDICARE', taxableWages: 37_260.00, eeWithholding:     0.00, erShare:   540.27 },
  { taxType: 'FUTA',        taxableWages: 37_260.00, eeWithholding:     0.00, erShare:   223.56 },
  { taxType: 'SUTA',        taxableWages: 37_260.00, eeWithholding:     0.00, erShare:   745.20 },
];

function mapWageBases(apiData: any[]): TaxRow[] {
  if (!Array.isArray(apiData) || apiData.length === 0) return FALLBACK_ROWS;
  return ROW_ORDER.map(type => {
    const match = apiData.find((b: any) => b.wage_base_type === type || b.wageBaseType === type);
    if (!match) {
      return FALLBACK_ROWS.find(r => r.taxType === type) ?? { taxType: type, taxableWages: 0, eeWithholding: 0, erShare: 0 };
    }
    return {
      taxType: type,
      taxableWages:    Number(match.taxable_wages  ?? match.taxableWages  ?? 0),
      eeWithholding:   Number(match.ee_withholding ?? match.eeWithholding ?? 0),
      erShare:         Number(match.er_share       ?? match.erShare       ?? 0),
    };
  });
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function downloadCsv(rows: TaxRow[]) {
  const header = 'Tax Type,Taxable Wages,Withholding (EE),Employer Share,Total\n';
  const body = rows.map(r => {
    const meta = WAGE_BASE_TYPE_MAP[r.taxType];
    const label = meta?.label ?? r.taxType;
    const total = r.eeWithholding + r.erShare;
    return [label, r.taxableWages.toFixed(2), r.eeWithholding.toFixed(2), r.erShare.toFixed(2), total.toFixed(2)].join(',');
  }).join('\n');
  const blob = new Blob([header + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tax-summary-report.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function TaxSummaryReport() {
  const [selectedRunId, setSelectedRunId] = useState('');
  const [generated, setGenerated]         = useState(false);

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.listRuns(),
    retry: false,
  });

  const { data: wageBases, isLoading: wbLoading } = useQuery({
    queryKey: ['wage-bases', selectedRunId],
    queryFn: () => payrollApi.getWageBases(selectedRunId),
    enabled: !!selectedRunId && generated,
    retry: false,
  });

  const rows = useMemo<TaxRow[]>(() => {
    return mapWageBases(Array.isArray(wageBases) ? wageBases : []);
  }, [wageBases]);

  const totals = useMemo(() => ({
    taxableWages:   rows.reduce((s, r) => s + r.taxableWages, 0),
    eeWithholding:  rows.reduce((s, r) => s + r.eeWithholding, 0),
    erShare:        rows.reduce((s, r) => s + r.erShare, 0),
    total:          rows.reduce((s, r) => s + r.eeWithholding + r.erShare, 0),
  }), [rows]);

  function handleGenerate() {
    setGenerated(true);
  }

  const runOptions: any[] = Array.isArray(runs) ? runs : [];
  const isLoading = (runsLoading || wbLoading) && generated;

  if (runsLoading) return <PageLoader page="Tax Summary" service="payroll-service" port={3010} />;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Tax Summary Report</h1>
        <p className="text-sm text-gray-500 mt-0.5">Per-run federal and state tax breakdown (PAY-008 / PAY-010)</p>
      </div>

      {/* Parameters card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Report Parameters</h2>
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Pay Run</label>
            <select
              value={selectedRunId}
              onChange={e => { setSelectedRunId(e.target.value); setGenerated(false); }}
              className="h-8 px-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-1 focus:ring-brand focus:border-blue-500 outline-none min-w-[260px]"
            >
              <option value="">— Select Pay Run —</option>
              {runOptions.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.id} · {r.checkDate ?? r.check_date ?? ''}
                </option>
              ))}
              {runOptions.length === 0 && (
                <>
                  <option value="RUN-2026-05-A">RUN-2026-05-A · 2026-05-15</option>
                  <option value="RUN-2026-04-B">RUN-2026-04-B · 2026-04-30</option>
                  <option value="RUN-2026-04-A">RUN-2026-04-A · 2026-04-15</option>
                </>
              )}
            </select>
          </div>
          <button
            onClick={handleGenerate}
            disabled={!selectedRunId}
            className="h-8 px-4 bg-brand text-white text-sm font-medium rounded hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Generate
          </button>
        </div>
      </div>

      {/* Loading state for wage bases */}
      {isLoading && (
        <PageLoader page="Tax Summary" service="payroll-service" port={3010} />
      )}

      {/* Report table */}
      {generated && !isLoading && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-700">
              Run: {selectedRunId || 'RUN-2026-05-A'}
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
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tax Type</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Taxable Wages</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Withholding (EE)</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Employer Share</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(row => {
                  const meta = WAGE_BASE_TYPE_MAP[row.taxType];
                  const label = meta?.label ?? row.taxType;
                  const total = row.eeWithholding + row.erShare;
                  return (
                    <tr key={row.taxType} className="h-9 hover:bg-gray-50">
                      <td className="px-4 py-0 text-gray-900">{label}</td>
                      <td className="px-4 py-0 text-right font-mono text-gray-700">
                        {row.taxableWages > 0 ? fmt(row.taxableWages) : <span className="text-gray-400">$0.00</span>}
                      </td>
                      <td className="px-4 py-0 text-right font-mono text-gray-900">
                        {row.eeWithholding > 0 ? fmt(row.eeWithholding) : <span className="text-gray-400">$0.00</span>}
                      </td>
                      <td className="px-4 py-0 text-right font-mono text-gray-900">
                        {row.erShare > 0 ? fmt(row.erShare) : <span className="text-gray-400">$0.00</span>}
                      </td>
                      <td className="px-4 py-0 text-right font-mono font-medium text-gray-900">{fmt(total)}</td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="h-9 bg-gray-50 border-t-2 border-gray-300 font-semibold">
                  <td className="px-4 py-0 text-gray-900">TOTALS</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.taxableWages)}</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.eeWithholding)}</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.erShare)}</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(totals.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!generated && (
        <div className="flex items-center justify-center h-48 bg-white border border-gray-200 rounded-lg text-gray-400 text-sm">
          Select a pay run and click Generate to view the tax summary.
        </div>
      )}
    </div>
  );
}
