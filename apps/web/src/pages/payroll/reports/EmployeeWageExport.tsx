import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';

type Mode = 'SIMPLE' | 'ADVANCED';

const AVAILABLE_COLUMNS: { key: string; label: string }[] = [
  { key: 'gross_pay', label: 'Gross Pay' },
  { key: 'net_pay', label: 'Net Pay' },
  { key: 'federal_withholding', label: 'Federal Withholding' },
  { key: 'state_withholding', label: 'State Withholding' },
  { key: 'fica_employee', label: 'FICA (Employee)' },
  { key: 'fica_employer', label: 'FICA (Employer)' },
  { key: 'medicare_employee', label: 'Medicare (Employee)' },
  { key: 'medicare_employer', label: 'Medicare (Employer)' },
  { key: 'regular_hours', label: 'Regular Hours' },
  { key: 'overtime_hours', label: 'Overtime Hours' },
  { key: 'vacation_hours', label: 'Vacation Hours' },
  { key: 'sick_hours', label: 'Sick Hours' },
  { key: 'health_insurance', label: 'Health Insurance' },
  { key: '401k_contribution', label: '401(k) Contribution' },
  { key: 'dental', label: 'Dental' },
  { key: 'vision', label: 'Vision' },
];

export default function EmployeeWageExport() {
  const [mode, setMode] = useState<Mode>('SIMPLE');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { data: runs, isLoading, error } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.listRuns(),
    retry: false,
  });

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  function toggleColumn(key: string) {
    setSelectedColumns(prev =>
      prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]
    );
  }

  function selectAll() {
    setSelectedColumns(AVAILABLE_COLUMNS.map(c => c.key));
  }

  function clearAll() {
    setSelectedColumns([]);
  }

  async function handleDownload() {
    if (!selectedRunId) {
      showToast('Please select a pay run.', 'error');
      return;
    }
    if (mode === 'ADVANCED' && selectedColumns.length === 0) {
      showToast('Select at least one column before downloading.', 'error');
      return;
    }

    setDownloading(true);
    try {
      const reportType = mode === 'SIMPLE' ? 'WAGE_EXPORT_SIMPLE' : 'WAGE_EXPORT_ADVANCED';
      const result = await payrollApi.exportReport(selectedRunId, reportType);
      // Trigger browser download from blob/url
      const url = result?.downloadUrl ?? result?.url ?? '';
      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `wage-export-${selectedRunId}-${mode.toLowerCase()}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      showToast('Download started.', 'success');
    } catch (err: any) {
      showToast(err.message ?? 'Export failed.', 'error');
    } finally {
      setDownloading(false);
    }
  }

  if (isLoading) return <PageLoader page="Employee Wage Export" service="payroll-service" port={3012} />;

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          Failed to load pay runs. Please check that payroll-service is running.
        </div>
      </div>
    );
  }

  const runList: any[] = Array.isArray(runs) ? runs : [];
  const canDownload = !!selectedRunId && (mode === 'SIMPLE' || selectedColumns.length > 0);

  return (
    <div className="p-6 max-w-3xl mx-auto font-['Inter',sans-serif]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Employee Wage Export</h1>
        <p className="text-sm text-gray-500 mt-1">Export employee wage data for a payroll run.</p>
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

      {/* Mode Toggle */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Export Mode
        </label>
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
          <button
            type="button"
            onClick={() => setMode('SIMPLE')}
            className={`px-5 h-8 text-sm font-medium transition-colors ${
              mode === 'SIMPLE'
                ? 'bg-brand text-white border-r border-blue-800'
                : 'bg-white text-gray-700 hover:bg-gray-50 border-r border-gray-300'
            }`}
          >
            Simple
          </button>
          <button
            type="button"
            onClick={() => setMode('ADVANCED')}
            className={`px-5 h-8 text-sm font-medium transition-colors ${
              mode === 'ADVANCED'
                ? 'bg-brand text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            Advanced
          </button>
        </div>
      </div>

      {/* Pay Run Selector */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
          Pay Run
        </label>
        <select
          value={selectedRunId}
          onChange={e => setSelectedRunId(e.target.value)}
          className="h-8 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-brand"
        >
          <option value="">— Select a Pay Run —</option>
          {runList.map((r: any) => (
            <option key={r.id} value={r.id}>
              {r.id} — {r.checkDate ?? r.check_date ?? 'N/A'} ({r.status ?? 'UNKNOWN'})
            </option>
          ))}
        </select>
      </div>

      {/* Simple Mode Info */}
      {mode === 'SIMPLE' && (
        <div className="mb-6 bg-brand-light border border-brand-border rounded-lg px-4 py-3 text-sm text-blue-800">
          Exports <span className="font-semibold">Employee, Gross Pay, Net Pay, Check Date</span> as CSV.
        </div>
      )}

      {/* Advanced Mode Column Selector */}
      {mode === 'ADVANCED' && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Select columns to include:</span>
            <div className="flex items-center gap-2">
              {selectedColumns.length > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-light text-brand">
                  {selectedColumns.length} column{selectedColumns.length !== 1 ? 's' : ''} selected
                </span>
              )}
              <button
                type="button"
                onClick={selectAll}
                className="text-xs font-medium text-brand hover:text-blue-900 underline"
              >
                Select All
              </button>
              <span className="text-gray-300">|</span>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 underline"
              >
                Clear All
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-y-2 gap-x-6 border border-gray-200 rounded-lg bg-white p-4">
            {AVAILABLE_COLUMNS.map(col => (
              <label
                key={col.key}
                className="flex items-center gap-2.5 h-9 cursor-pointer group"
              >
                <input
                  type="checkbox"
                  checked={selectedColumns.includes(col.key)}
                  onChange={() => toggleColumn(col.key)}
                  className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand cursor-pointer"
                />
                <span className="text-sm text-gray-700 group-hover:text-gray-900 select-none">
                  {col.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Download Button */}
      <button
        type="button"
        onClick={handleDownload}
        disabled={!canDownload || downloading}
        className={`h-9 px-6 rounded text-sm font-semibold transition-colors ${
          canDownload && !downloading
            ? 'bg-brand hover:bg-brand-hover text-white'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
        }`}
      >
        {downloading ? 'Preparing Download…' : 'Download CSV'}
      </button>
    </div>
  );
}
