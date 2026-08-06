import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { taxApi } from '../../../api/client';
import { PageHeader, Btn } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';
import { EffectiveDateHistoryTab } from '../../../components/tax/EffectiveDateHistoryTab';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { EmptyState, Banner } from '../../../components/report';

// CE-10 / S124 — Tax Vendor / Adapter Status. Connection status card
// (engine, engine version, content version, last successful call), a
// truthful NOT_CONFIGURED banner (NullEngine default per the Fable
// package — never estimate, never fabricate a "configured" state), an
// audited "Test connection" action, and the effective-dated connection
// config history (shared EffectiveDateHistoryTab, keyed by the synthetic
// 'tax-adapter' entity since the adapter connection is a tenant-singleton,
// not a per-row registry). Permissions: tax.adapter.view (read this
// screen at all), tax.adapter.manage (test-connection).
export default function TaxAdapterStatus() {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; testedAt: string } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [tab, setTab] = useState<'status' | 'history'>('status');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tax-adapter-status'],
    queryFn: () => taxApi.getAdapterStatus(),
    retry: false,
  });

  async function runTestConnection() {
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await taxApi.testAdapterConnection();
      setTestResult(result);
      await queryClient.invalidateQueries({ queryKey: ['tax-adapter-status'] });
    } catch (err: any) {
      setTestError(err.message);
    } finally {
      setTestBusy(false);
    }
  }

  if (isLoading) return <PageLoader page="Tax Vendor / Adapter Status" service="tax-service" port={3040} />;

  if (error) {
    const status = (error as any)?.status;
    if (status === 401 || status === 403) {
      return (
        <div className="p-7">
          <EmptyState
            testId="tax-adapter-unauthorized"
            title="Unauthorized"
            message="You do not have the tax.adapter.view permission required to view Tax Vendor / Adapter Status. Contact your Controller or Admin."
          />
        </div>
      );
    }
    return <PageError error={error as Error} serviceName="tax-service" port={3040} retry={() => refetch()} />;
  }

  const status = data!;
  const notConfigured = status.status === 'NOT_CONFIGURED';
  const unavailable = status.status === 'ENGINE_UNAVAILABLE';

  return (
    <div className="p-7 min-h-full" data-testid="tax-adapter-page">
      <PageHeader
        title="Tax Vendor / Adapter Status"
        subtitle="Certified tax engine adapter connection (S124). When an authoritative tax result is unavailable, transactions block or park in the exception queue — never a silent estimate."
        actions={
          <Btn variant="primary" size="md" icon={<Radio size={14} />} onClick={runTestConnection} loading={testBusy} data-testid="tax-adapter-test-connection">
            Test connection
          </Btn>
        }
      />

      {notConfigured && (
        <Banner kind="warning" testId="tax-adapter-not-configured-banner" title="NOT_CONFIGURED — no certified tax engine is connected for this tenant.">
          Every taxable request blocks or parks in the Tax Exception Queue truthfully. Nothing calculates or posts until a real engine is configured.
        </Banner>
      )}
      {unavailable && (
        <Banner kind="error" testId="tax-adapter-unavailable-banner" title="ENGINE_UNAVAILABLE — the configured engine is not currently answering.">
          {typeof status.queueDepth === 'number' ? (
            <>
              {status.queueDepth} transaction{status.queueDepth === 1 ? '' : 's'} parked awaiting recovery —{' '}
              <a href="/accounting/tax/exceptions" className="underline">view the Exception Queue</a>.
            </>
          ) : (
            <a href="/accounting/tax/exceptions" className="underline">View the Exception Queue</a>
          )}
        </Banner>
      )}

      {testResult && (
        <Banner kind={testResult.success ? 'success' : 'error'} testId="tax-adapter-test-result" title={testResult.success ? 'Connection succeeded' : 'Connection failed'}>
          {testResult.message} (tested {testResult.testedAt})
        </Banner>
      )}
      {testError && (
        <Banner kind="error" testId="tax-adapter-test-error" title="Test connection failed">
          {testError}
        </Banner>
      )}

      <div className="flex items-center gap-1 border-b border-slate-200 mt-6 mb-4">
        <button
          className={`px-3 py-2 text-[13px] font-semibold border-b-2 ${tab === 'status' ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}
          onClick={() => setTab('status')}
          data-testid="tax-adapter-tab-status"
        >
          Connection status
        </button>
        <button
          className={`px-3 py-2 text-[13px] font-semibold border-b-2 ${tab === 'history' ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}
          onClick={() => setTab('history')}
          data-testid="tax-adapter-tab-history"
        >
          Effective-date history
        </button>
      </div>

      {tab === 'status' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6" data-testid="tax-adapter-status-card">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status</div>
              <div className="mt-1"><StatusBadge status={status.status} /></div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Engine</div>
              <div className="mt-1 text-sm text-slate-900" data-testid="tax-adapter-engine">{status.engine ?? '—'}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Engine version</div>
              <div className="mt-1 text-sm text-slate-900">{status.engineVersion ?? '—'}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Content version</div>
              <div className="mt-1 text-sm text-slate-900">{status.contentVersion ?? '—'}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Last successful call</div>
              <div className="mt-1 text-sm text-slate-900" data-testid="tax-adapter-last-call">{status.lastSuccessfulCallAt ?? 'Never'}</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <EffectiveDateHistoryTab entityType="tax_engine_config" entityId="tenant" testId="tax-adapter-history" />
        </div>
      )}
    </div>
  );
}
