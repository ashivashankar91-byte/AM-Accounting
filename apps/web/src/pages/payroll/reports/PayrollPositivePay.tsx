import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';

type Format = 'CSV' | 'TSV' | 'FIXED';

export default function PayrollPositivePay() {
  const [selectedRunId, setSelectedRunId] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [format, setFormat] = useState<Format>('CSV');
  const [generating, setGenerating] = useState(false);
  const [success, setSuccess] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { data: runs, isLoading, error } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.listRuns(),
    retry: false,
  });

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }

  async function handleGenerate() {
    if (!selectedRunId) {
      showToast('Please select a pay run.', 'error');
      return;
    }
    if (!bankAccount.trim()) {
      showToast('Please enter a bank account number.', 'error');
      return;
    }

    setGenerating(true);
    setSuccess(false);
    try {
      const reportType = `POSITIVE_PAY_${format}` as const;
      const result = await payrollApi.exportReport(selectedRunId, reportType);
      const url = result?.downloadUrl ?? result?.url ?? '';
      if (url) {
        const ext = format === 'CSV' ? 'csv' : format === 'TSV' ? 'tsv' : 'txt';
        const a = document.createElement('a');
        a.href = url;
        a.download = `positive-pay-${selectedRunId}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setSuccess(true);
      showToast('Positive pay file generated. Download started.', 'success');
    } catch (err: any) {
      showToast(err.message ?? 'Generation failed.', 'error');
    } finally {
      setGenerating(false);
    }
  }

  if (isLoading) return <PageLoader page="Payroll Positive Pay" service="payroll-service" port={3012} />;

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
  const canGenerate = !!selectedRunId && bankAccount.trim().length > 0 && !generating;

  return (
    <div className="p-6 max-w-2xl mx-auto font-['Inter',sans-serif]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Payroll Positive Pay</h1>
        <p className="text-sm text-gray-500 mt-1">Generate positive pay file for bank check verification.</p>
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

      {/* Info Banner */}
      <div className="mb-6 flex gap-3 bg-brand-light border border-brand-border rounded-lg px-4 py-3">
        <svg className="w-5 h-5 text-brand flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
        </svg>
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Payroll Positive Pay is separate from Accounts Payable Positive Pay.</span>{' '}
          This file contains payroll check data for bank verification (BR-PAY-008).
        </p>
      </div>

      {/* Parameters Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Parameters</h2>

        {/* Pay Run */}
        <div>
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

        {/* Bank Account */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Bank Account Number
          </label>
          <input
            type="text"
            value={bankAccount}
            onChange={e => setBankAccount(e.target.value)}
            placeholder="Enter bank account number"
            className="h-8 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-brand font-mono"
          />
        </div>

        {/* Format */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            File Format
          </label>
          <div className="flex gap-6">
            {(['CSV', 'TSV', 'FIXED'] as Format[]).map(f => (
              <label key={f} className="flex items-center gap-2 h-9 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  value={f}
                  checked={format === f}
                  onChange={() => setFormat(f)}
                  className="h-4 w-4 text-brand border-gray-300 focus:ring-brand cursor-pointer"
                />
                <span className="text-sm text-gray-700 select-none">
                  {f === 'FIXED' ? 'Fixed Width' : f}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Generate Button */}
        <div className="pt-1">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={`h-9 px-6 rounded text-sm font-semibold transition-colors ${
              canGenerate
                ? 'bg-brand hover:bg-brand-hover text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {generating ? 'Generating…' : 'Generate Positive Pay File'}
          </button>
        </div>
      </div>

      {/* Success State */}
      {success && (
        <div className="mt-4 flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm text-green-800 font-medium">File generated. Download started.</p>
        </div>
      )}
    </div>
  );
}
