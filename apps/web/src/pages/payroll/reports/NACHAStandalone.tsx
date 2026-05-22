import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';

export default function NACHAStandalone() {
  const [selectedRunId, setSelectedRunId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
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

  const finalizedRuns: any[] = Array.isArray(runs)
    ? runs.filter((r: any) => (r.status ?? '').toUpperCase() === 'FINALIZED')
    : [];

  async function handleRegenerate() {
    if (!selectedRunId) {
      showToast('Please select a finalized pay run.', 'error');
      return;
    }
    setGenerating(true);
    try {
      await payrollApi.generateNacha(selectedRunId);
      setLastGenerated(selectedRunId);
      showToast(`NACHA file regenerated for run ${selectedRunId}.`, 'success');
    } catch (err: any) {
      showToast(err.message ?? 'NACHA regeneration failed.', 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownload() {
    if (!lastGenerated) return;
    setDownloading(true);
    try {
      const result = await payrollApi.exportReport(lastGenerated, 'NACHA');
      const url = result?.downloadUrl ?? result?.url ?? '';
      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `nacha-${lastGenerated}.ach`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      showToast('NACHA file download started.', 'success');
    } catch (err: any) {
      showToast(err.message ?? 'Download failed.', 'error');
    } finally {
      setDownloading(false);
    }
  }

  if (isLoading) return <PageLoader page="NACHA File Regeneration" service="payroll-service" port={3012} />;

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          Failed to load pay runs. Please check that payroll-service is running.
        </div>
      </div>
    );
  }

  const canRegenerate = !!selectedRunId && !generating;

  return (
    <div className="p-6 max-w-2xl mx-auto font-['Inter',sans-serif]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">NACHA / ACH File Regeneration</h1>
        <p className="text-sm text-gray-500 mt-1">Regenerate an ACH file for an already-finalized payroll run.</p>
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

      {/* Warning Banner */}
      <div className="mb-6 flex gap-3 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
        <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <div className="text-sm text-amber-800">
          <p className="font-semibold mb-0.5">Standalone NACHA Regeneration</p>
          <p>
            This screen regenerates the NACHA/ACH file for an already-finalized payroll run.
            Use this <span className="font-semibold">only if the bank rejected the original file</span>.
            This is separate from the NACHA generation in the payroll wizard (BR-PAY-008).
          </p>
        </div>
      </div>

      {/* Parameters Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Parameters</h2>

        {/* Finalized Run Selector */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
            Finalized Pay Run
          </label>
          {finalizedRuns.length === 0 ? (
            <div className="h-8 flex items-center text-sm text-gray-500 italic">
              No finalized runs found.
            </div>
          ) : (
            <select
              value={selectedRunId}
              onChange={e => {
                setSelectedRunId(e.target.value);
                setLastGenerated(null);
              }}
              className="h-8 w-full rounded border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-brand"
            >
              <option value="">— Select a Finalized Run —</option>
              {finalizedRuns.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.id} — {r.checkDate ?? r.check_date ?? 'N/A'} (FINALIZED)
                </option>
              ))}
            </select>
          )}
          <p className="mt-1.5 text-xs text-gray-400">Only FINALIZED runs are eligible for NACHA regeneration.</p>
        </div>

        {/* Regenerate Button */}
        <div className="pt-1">
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={!canRegenerate || finalizedRuns.length === 0}
            className={`h-9 px-6 rounded text-sm font-semibold transition-colors ${
              canRegenerate && finalizedRuns.length > 0
                ? 'bg-brand hover:bg-brand-hover text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {generating ? 'Regenerating…' : 'Regenerate NACHA File'}
          </button>
        </div>
      </div>

      {/* Success Result */}
      {lastGenerated && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-800">
                NACHA file regenerated for run{' '}
                <span className="font-mono">{lastGenerated}</span>. Download ready.
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className={`h-8 px-4 rounded text-sm font-semibold transition-colors ${
                    downloading
                      ? 'bg-green-200 text-green-500 cursor-not-allowed'
                      : 'bg-green-700 hover:bg-green-800 text-white'
                  }`}
                >
                  {downloading ? 'Downloading…' : 'Download NACHA File'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
