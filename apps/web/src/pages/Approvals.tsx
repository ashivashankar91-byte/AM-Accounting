import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { approvalApi } from '../api/client';
import HelpButton from '../components/HelpButton';
import PageLoader from '../components/PageLoader';
import PageError from '../components/PageError';
import SCREEN_HELP from '../data/screenHelp';

export default function Approvals() {
  const tenantId = localStorage.getItem('tenantId') ?? '';
  const queryClient = useQueryClient();
  const [rejectModal, setRejectModal] = useState<{ show: boolean; reason: string; id: string }>({ show: false, reason: '', id: '' });

  const { data: pending, isLoading, error, refetch } = useQuery({
    queryKey: ['approvals-pending', tenantId],
    queryFn: () => approvalApi.getPending(tenantId),
    enabled: !!tenantId,
    retry: false,
    refetchInterval: 10_000,
  });

  const { data: history } = useQuery({
    queryKey: ['approvals-history', tenantId],
    queryFn: () => approvalApi.getHistory(tenantId),
    enabled: !!tenantId,
    retry: false,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => approvalApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals-pending'] });
      queryClient.invalidateQueries({ queryKey: ['approvals-history'] });
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => approvalApi.reject(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals-pending'] });
      queryClient.invalidateQueries({ queryKey: ['approvals-history'] });
    },
  });

  if (isLoading) return <PageLoader page="Approvals" service="approval-service" port={3033} />;
  if (error) return <PageError error={error} serviceName="Approval Service" port={3033} retry={refetch} />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">Approvals</h1><p className="text-sm text-gray-500 mt-0.5">Review and action pending approval requests. Source: Approval Service.</p></div><HelpButton help={SCREEN_HELP['approvals']} /></div>

      {/* Pending */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Pending Approvals ({(pending ?? []).length})</h3>
        {(pending ?? []).length === 0 && (
          <p className="text-gray-500 text-sm">No pending approvals.</p>
        )}
        <div className="space-y-3">
          {(pending ?? []).map((req: any) => (
            <div key={req.id} className="bg-white rounded-lg shadow p-4 border-l-4 border-amber-400">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">{req.agentName} — {req.actionType}</div>
                  <div className="text-sm text-gray-600 mt-1">{req.reasoning}</div>
                  <div className="text-xs text-gray-400 mt-1">Entity: {req.entityRef}</div>
                  {(req.evidence ?? []).length > 0 && (
                    <ul className="text-xs text-gray-500 mt-1 list-disc list-inside">
                      {(req.evidence ?? []).map((e: string, i: number) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    Expires: {new Date(req.expiresAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button onClick={() => approveMut.mutate(req.id)}
                    disabled={approveMut.isPending || rejectMut.isPending}
                    className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    {approveMut.isPending ? 'Approving\u2026' : 'Approve'}
                  </button>
                  <button onClick={() => setRejectModal({ show: true, reason: '', id: req.id })}
                    disabled={approveMut.isPending || rejectMut.isPending}
                    className="bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* History */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Approval History</h3>
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left">
                <th className="p-3">Agent</th>
                <th className="p-3">Action</th>
                <th className="p-3">Entity</th>
                <th className="p-3">Status</th>
                <th className="p-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {(history ?? []).map((req: any) => (
                <tr key={req.id} className="border-b">
                  <td className="p-3">{req.agentName}</td>
                  <td className="p-3">{req.actionType}</td>
                  <td className="p-3 font-mono text-xs">{req.entityRef}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      req.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                      req.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                      req.status === 'EXPIRED' ? 'bg-gray-100 text-gray-500' :
                      'bg-amber-100 text-amber-700'
                    }`}>{req.status}</span>
                  </td>
                  <td className="p-3 text-xs text-gray-500">{new Date(req.proposedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mutation error banner */}
      {(approveMut.isError || rejectMut.isError) && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
          <strong>Error:</strong> {(approveMut.error as Error)?.message ?? (rejectMut.error as Error)?.message ?? 'Unknown error'}
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectModal.show && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-96">
            <h3 className="font-semibold mb-3">Reject Approval</h3>
            <p className="text-sm text-gray-600 mb-3">Provide a reason for rejection:</p>
            <textarea
              value={rejectModal.reason}
              onChange={e => setRejectModal(prev => ({ ...prev, reason: e.target.value }))}
              placeholder="Reason for rejection…"
              className="w-full border rounded px-3 py-2 text-sm mb-4 h-24 resize-none"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRejectModal({ show: false, reason: '', id: '' })}
                className="text-sm px-4 py-2 text-gray-700 hover:bg-gray-100 rounded"
              >Cancel</button>
              <button
                onClick={() => {
                  rejectMut.mutate({ id: rejectModal.id, reason: rejectModal.reason || 'Rejected by user' });
                  setRejectModal({ show: false, reason: '', id: '' });
                }}
                disabled={rejectMut.isPending}
                className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 disabled:opacity-50"
              >{rejectMut.isPending ? 'Rejecting\u2026' : 'Reject'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
