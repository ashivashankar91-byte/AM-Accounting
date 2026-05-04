import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reconApi } from '../api/client';
import HelpButton from '../components/HelpButton';
import PageLoader from '../components/PageLoader';
import PageError from '../components/PageError';
import SCREEN_HELP from '../data/screenHelp';

export default function Reconciliation() {
  const queryClient = useQueryClient();
  const { data: recons, isLoading, error, refetch } = useQuery({ queryKey: ['recons'], queryFn: reconApi.list, retry: false });

  const completeMut = useMutation({
    mutationFn: (id: string) => reconApi.complete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recons'] }),
  });

  if (isLoading) return <PageLoader page="Bank Reconciliation" service="recon-service" port={3014} />;
  if (error) return <PageError error={error} serviceName="Recon Service" port={3014} retry={refetch} />;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between"><div>
          <h1 className="text-2xl font-bold">Bank Reconciliation</h1>
          <p className="text-sm text-gray-500 mt-0.5">Reconcile bank transactions against journal entries. Source: Recon Service.</p>
        </div><HelpButton help={SCREEN_HELP['reconciliation']} /></div>

      <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
        <h3 className="font-semibold mb-3">Recon Sessions</h3>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b">
            <th className="pb-2">Account</th><th className="pb-2">Date</th><th className="pb-2 text-right">GL Balance</th>
            <th className="pb-2 text-right">Bank Balance</th><th className="pb-2 text-right">Variance</th><th className="pb-2">Status</th><th className="pb-2">Actions</th>
          </tr></thead>
          <tbody>
            {(recons ?? []).length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400"><div className="text-2xl mb-1">⚖️</div><span className="text-xs">No reconciliation sessions. Create one to get started.</span></td></tr>
            ) : (recons ?? []).map((r: any) => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="py-2">{r.accountName}</td>
                <td>{new Date(r.reconDate).toLocaleDateString()}</td>
                <td className="text-right">${r.glBalance.toLocaleString()}</td>
                <td className="text-right">${r.bankBalance.toLocaleString()}</td>
                <td className={`text-right font-medium ${Math.abs(r.variance) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  ${r.variance.toLocaleString()}
                </td>
                <td><StatusBadge status={r.status} /></td>
                <td>
                  {r.status !== 'COMPLETED' && (
                    <button onClick={() => completeMut.mutate(r.id)} className="text-xs text-green-600 hover:underline">Complete</button>
                  )}
                </td>
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
    OPEN: 'bg-gray-100 text-gray-700', IN_PROGRESS: 'bg-blue-100 text-blue-700', COMPLETED: 'bg-green-100 text-green-700',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? 'bg-gray-100'}`}>{status}</span>;
}
