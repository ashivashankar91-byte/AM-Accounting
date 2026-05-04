import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { eomApi } from '../api/client';
import HelpButton from '../components/HelpButton';
import PageLoader from '../components/PageLoader';
import PageError from '../components/PageError';
import SCREEN_HELP from '../data/screenHelp';

export default function EOMClose() {
  const queryClient = useQueryClient();
  const { data: closes, isLoading, error, refetch } = useQuery({
    queryKey: ['eom-closes'],
    queryFn: eomApi.list,
    retry: false,
    refetchInterval: (query) => {
      const first = (query.state.data as any)?.[0];
      return first?.status === 'IN_PROGRESS' ? 5_000 : false;
    },
  });

  const current = (closes ?? [])[0];

  const advanceMut = useMutation({
    mutationFn: (id: string) => eomApi.advance(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['eom-closes'] }),
  });

  const retryMut = useMutation({
    mutationFn: (id: string) => eomApi.retry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['eom-closes'] }),
  });

  const initMut = useMutation({
    mutationFn: () => {
      const now = new Date();
      return eomApi.initiate(now.getFullYear(), now.getMonth() + 1);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['eom-closes'] }),
  });

  if (isLoading) return <PageLoader page="EOM Close" service="eom-service" port={3011} />;
  if (error) return <PageError error={error} serviceName="EOM Service" port={3011} retry={refetch} />;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center justify-between"><div>
          <h1 className="text-2xl font-bold">EOM Close</h1>
          <p className="text-sm text-gray-500 mt-0.5">End-of-month close orchestration with step-by-step validation. Source: EOM Service.</p>
        </div><HelpButton help={SCREEN_HELP['eom-close']} /></div>
        <button onClick={() => initMut.mutate()} disabled={initMut.isPending} className="bg-amacc-600 text-white px-4 py-2 rounded text-sm hover:bg-amacc-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {initMut.isPending ? 'Initiating\u2026' : 'Initiate Close'}
        </button>
      </div>

      {current && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-lg">{current.periodYear}-{String(current.periodMonth).padStart(2, '0')}</h3>
              <StatusBadge status={current.status} />
            </div>
            <div className="flex gap-2">
              {current.status !== 'COMPLETED' && (
                <button onClick={() => advanceMut.mutate(current.id)} disabled={advanceMut.isPending || retryMut.isPending} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed">{advanceMut.isPending ? 'Advancing\u2026' : 'Advance'}</button>
              )}
              {current.status === 'BLOCKED' && (
                <button onClick={() => retryMut.mutate(current.id)} disabled={retryMut.isPending || advanceMut.isPending} className="bg-orange-600 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed">{retryMut.isPending ? 'Retrying\u2026' : 'Retry'}</button>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            {(current.steps ?? []).map((step: any) => (
              <div key={step.id} className={`flex-1 rounded-lg p-3 text-center ${
                step.status === 'DONE' ? 'bg-green-50 border-2 border-green-300' :
                step.status === 'RUNNING' ? 'bg-blue-50 border-2 border-blue-300 animate-pulse' :
                step.status === 'BLOCKED' ? 'bg-red-50 border-2 border-red-300' :
                'bg-gray-50 border border-gray-200'
              }`}>
                <div className="font-bold text-lg">{step.stepCode}</div>
                <div className="text-xs mt-1">{step.stepName}</div>
                <div className="text-xs mt-1 font-medium">{step.status}</div>
                {step.errorMessage && <div className="text-xs text-red-600 mt-1">{step.errorMessage}</div>}
                {step.retryCount > 0 && <div className="text-xs text-orange-500">Retries: {step.retryCount}</div>}
              </div>
            ))}
          </div>

          {current.blockedReason && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
              <strong>Blocked:</strong> {current.blockedReason}
            </div>
          )}
        </div>
      )}

      {/* Mutation error banner */}
      {(initMut.isError || advanceMut.isError || retryMut.isError) && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
          <strong>Error:</strong> {(initMut.error as Error)?.message ?? (advanceMut.error as Error)?.message ?? (retryMut.error as Error)?.message ?? 'Unknown error'}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold mb-3">Historical Closes</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b">
            <th className="pb-2">Period</th><th className="pb-2">Status</th><th className="pb-2">Started</th><th className="pb-2">Completed</th>
          </tr></thead>
          <tbody>
            {(closes ?? []).length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-gray-400"><div className="text-2xl mb-1">📅</div><span className="text-xs">No historical closes</span></td></tr>
            ) : (closes ?? []).map((c: any) => (
              <tr key={c.id} className="border-b border-gray-50">
                <td className="py-2">{c.periodYear}-{String(c.periodMonth).padStart(2, '0')}</td>
                <td><StatusBadge status={c.status} /></td>
                <td>{new Date(c.startedAt).toLocaleDateString()}</td>
                <td>{c.completedAt ? new Date(c.completedAt).toLocaleDateString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    NOT_STARTED: 'bg-gray-100 text-gray-700', IN_PROGRESS: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700', BLOCKED: 'bg-red-100 text-red-700',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? 'bg-gray-100'}`}>{status}</span>;
}
