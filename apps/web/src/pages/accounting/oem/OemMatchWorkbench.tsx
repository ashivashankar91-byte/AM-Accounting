import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { oemApi } from '../../../api/client';
import { PageHeader, Btn, Badge } from '../../../components/ui';
import { Banner, LoadingState, EmptyState, ErrorState, UnauthorizedState } from '../../../components/report';

// CE-14 S101A — Statement Match Workbench. Session list + session view;
// match/short-pay/dispute/investigate ceremonies; 100%-disposition
// completion gate with a progress strip. Permissions: oem.match.view /
// oem.match.dispose.
const DISPOSITION_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  PENDING: 'neutral', MATCHED: 'success', SHORT_PAID: 'warning', DISPUTED: 'danger', INVESTIGATION: 'info',
};

export default function OemMatchWorkbench() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('STORE-1');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const sessionsQ = useQuery({ queryKey: ['oem-match-sessions', storeId], queryFn: () => oemApi.listMatchSessions(storeId), retry: false });
  const stagedQ = useQuery({ queryKey: ['oem-staged-for-match'], queryFn: () => oemApi.listStagedDocuments(), retry: false });
  const sessionQ = useQuery({
    queryKey: ['oem-match-session', selectedSessionId],
    queryFn: () => oemApi.getMatchSession(selectedSessionId!),
    enabled: !!selectedSessionId,
    retry: false,
  });

  async function openSession() {
    if (!selectedDocId) return;
    setActionError(null);
    try {
      const session = await oemApi.createMatchSession(storeId, selectedDocId);
      setSelectedSessionId(session.id);
      qc.invalidateQueries({ queryKey: ['oem-match-sessions'] });
    } catch (err: any) { setActionError(err.message); }
  }

  async function dispose(rowId: string, disposition: string) {
    setActionError(null);
    try {
      await oemApi.disposeMatchRow(selectedSessionId!, rowId, disposition);
      qc.invalidateQueries({ queryKey: ['oem-match-session', selectedSessionId] });
    } catch (err: any) { setActionError(err.message); }
  }

  async function complete() {
    setActionError(null);
    try {
      await oemApi.completeMatchSession(selectedSessionId!);
      qc.invalidateQueries({ queryKey: ['oem-match-session', selectedSessionId] });
      qc.invalidateQueries({ queryKey: ['oem-match-sessions'] });
    } catch (err: any) { setActionError(err.message); }
  }

  if (sessionsQ.error) {
    const status = (sessionsQ.error as any)?.status;
    if (status === 401 || status === 403) {
      return <div className="p-7"><UnauthorizedState testId="oem-match-unauthorized" message="You do not have the oem.match.view permission required to view the Statement Match Workbench." /></div>;
    }
    return <div className="p-7"><ErrorState testId="oem-match-error" message={(sessionsQ.error as Error).message} onRetry={() => sessionsQ.refetch()} /></div>;
  }

  const session = sessionQ.data;
  const dispositionedCount = session?.rows.filter((r: any) => r.disposition !== 'PENDING').length ?? 0;
  const totalCount = session?.rows.length ?? 0;

  return (
    <div className="p-7 min-h-full" data-testid="oem-match-page">
      <PageHeader title="Statement Match Workbench" subtitle="Session completion requires 100% row disposition — no silent leftovers (S101A)." />

      <div className="flex items-center gap-2 mb-4">
        <input className="h-8 px-3 text-sm border border-slate-200 rounded-lg" value={storeId} onChange={(e) => setStoreId(e.target.value)} data-testid="oem-match-store-input" placeholder="Store ID" />
        <select className="h-8 px-2 text-sm border border-slate-200 rounded-lg" value={selectedDocId} onChange={(e) => setSelectedDocId(e.target.value)} data-testid="oem-match-doc-select">
          <option value="">Select a staged statement...</option>
          {(stagedQ.data ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.make} / {d.kind} / {new Date(d.importedAt).toLocaleDateString()}</option>)}
        </select>
        <Btn size="sm" variant="primary" onClick={openSession} disabled={!selectedDocId} data-testid="oem-match-open-session-btn">Open match session</Btn>
      </div>

      {actionError && <ErrorState testId="oem-match-action-error" message={actionError} />}

      {sessionsQ.isLoading ? (
        <LoadingState label="Loading sessions..." testId="oem-match-sessions-loading" />
      ) : !sessionsQ.data?.length ? (
        <EmptyState testId="oem-match-sessions-empty" title="No match sessions yet" message="Select a staged statement above to open one." />
      ) : (
        <div className="flex gap-2 mb-4 flex-wrap" data-testid="oem-match-sessions-list">
          {sessionsQ.data.map((s: any) => (
            <button
              key={s.id}
              onClick={() => setSelectedSessionId(s.id)}
              className={`text-xs px-3 py-1.5 rounded-full border ${selectedSessionId === s.id ? 'border-brand bg-brand-light text-brand' : 'border-slate-200 text-slate-600'}`}
              data-testid={`oem-match-session-chip-${s.id}`}
            >
              {s.status} — {new Date(s.openedAt).toLocaleDateString()}
            </button>
          ))}
        </div>
      )}

      {session && (
        <div data-testid="oem-match-session-detail">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-slate-600">Progress: {dispositionedCount}/{totalCount} rows dispositioned</div>
            <Btn size="sm" variant="primary" icon={<CheckCircle2 size={14} />} onClick={complete} disabled={session.status === 'COMPLETE' || dispositionedCount < totalCount} data-testid="oem-match-complete-btn">
              {session.status === 'COMPLETE' ? 'Session complete' : 'Complete session'}
            </Btn>
          </div>
          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr><th className="text-left p-2">Item</th><th className="text-left p-2">Type</th><th className="text-left p-2">Amount</th><th className="text-left p-2">Disposition</th><th className="text-left p-2">Actions</th></tr>
            </thead>
            <tbody>
              {session.rows.map((r: any) => (
                <tr key={r.id} className="border-t border-slate-100" data-testid={`oem-match-row-${r.id}`}>
                  <td className="p-2 font-mono text-xs">{r.openItemRef ?? '(factory-only)'}{r.isSystemGenerated && <span className="text-slate-400"> · system</span>}</td>
                  <td className="p-2 text-xs">{r.openItemType ?? '-'}</td>
                  <td className="p-2">{Number(r.statementAmount).toFixed(2)}</td>
                  <td className="p-2"><Badge variant={DISPOSITION_VARIANT[r.disposition]}>{r.disposition}</Badge></td>
                  <td className="p-2">
                    {r.disposition === 'PENDING' && session.status === 'OPEN' && (
                      <div className="flex gap-1">
                        <Btn size="sm" variant="secondary" onClick={() => dispose(r.id, 'MATCHED')} data-testid={`oem-match-row-matched-${r.id}`}>Match</Btn>
                        <Btn size="sm" variant="secondary" onClick={() => dispose(r.id, 'SHORT_PAY')} data-testid={`oem-match-row-shortpay-${r.id}`}>Short-pay</Btn>
                        <Btn size="sm" variant="secondary" onClick={() => dispose(r.id, 'DISPUTED')} data-testid={`oem-match-row-dispute-${r.id}`}>Dispute</Btn>
                        <Btn size="sm" variant="secondary" onClick={() => dispose(r.id, 'INVESTIGATION')} data-testid={`oem-match-row-investigate-${r.id}`}>Investigate</Btn>
                      </div>
                    )}
                    {r.appliedAmount !== null && <span className="text-xs text-slate-500">applied {Number(r.appliedAmount).toFixed(2)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {session.status === 'COMPLETE' && <Banner kind="success" testId="oem-match-complete-banner" title="Session complete — every row dispositioned." />}
        </div>
      )}
    </div>
  );
}
