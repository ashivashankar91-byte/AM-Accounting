import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { oemApi } from '../../../api/client';
import { PageHeader, Btn, Badge, MoneyCell } from '../../../components/ui';
import { LoadingState, EmptyState, ErrorState, UnauthorizedState, Banner } from '../../../components/report';

// CE-14 S105 — Warranty Audit Chargeback & Reserve. Chargeback assessments
// (accept/dispute per line), dispute evidence packs, reserve workbench
// (rate config, previews, draws, rollforward). Permissions:
// oem.warranty.view / oem.warranty.chargeback.dispose / oem.warranty.reserve.manage.
export default function OemWarrantyAudit() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('STORE-1');
  const [ratePercent, setRatePercent] = useState('2.5');
  const [period, setPeriod] = useState('2026-07');
  const [paidVolume, setPaidVolume] = useState('10000.00');
  const [evidenceTarget, setEvidenceTarget] = useState<string | null>(null);
  const [evidenceRef, setEvidenceRef] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const noticesQ = useQuery({ queryKey: ['oem-warranty-notices', storeId], queryFn: () => oemApi.listChargebackNotices(storeId), retry: false });
  const rollforwardQ = useQuery({ queryKey: ['oem-warranty-rollforward', storeId], queryFn: () => oemApi.getReserveRollforward(storeId), retry: false });

  async function dispose(lineId: string, disposition: 'ACCEPTED' | 'DISPUTED') {
    setActionError(null);
    try {
      await oemApi.disposeChargebackLine(lineId, disposition);
      qc.invalidateQueries({ queryKey: ['oem-warranty-notices'] });
    } catch (err: any) { setActionError(err.message); }
  }

  async function draw(chargebackLineId: string) {
    setActionError(null);
    try {
      await oemApi.drawReserve(storeId, chargebackLineId);
      qc.invalidateQueries({ queryKey: ['oem-warranty-rollforward'] });
    } catch (err: any) { setActionError(err.message); }
  }

  async function submitEvidence() {
    if (!evidenceTarget || !evidenceRef.trim()) return;
    await oemApi.addChargebackEvidence(evidenceTarget, evidenceRef.trim());
    setEvidenceTarget(null); setEvidenceRef('');
    qc.invalidateQueries({ queryKey: ['oem-warranty-notices'] });
  }

  async function setRate() {
    await oemApi.setReserveConfig(storeId, ratePercent, new Date().toISOString().slice(0, 10));
  }

  async function preview() {
    await oemApi.previewReserve(storeId, period, paidVolume);
    qc.invalidateQueries({ queryKey: ['oem-warranty-rollforward'] });
  }

  if (noticesQ.error) {
    const status = (noticesQ.error as any)?.status;
    if (status === 401 || status === 403) {
      return <div className="p-7"><UnauthorizedState testId="oem-warranty-unauthorized" message="You do not have the oem.warranty.view permission required to view Audit & Reserve." /></div>;
    }
    return <div className="p-7"><ErrorState testId="oem-warranty-error" message={(noticesQ.error as Error).message} onRetry={() => noticesQ.refetch()} /></div>;
  }

  return (
    <div className="p-7 min-h-full" data-testid="oem-warranty-page">
      <PageHeader title="Warranty Audit — Chargeback & Reserve" subtitle="Accepted chargebacks always create a new contra item — applied claim history is never mutated (S105)." />

      <div className="flex items-center gap-2 mb-4">
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-28" value={storeId} onChange={(e) => setStoreId(e.target.value)} data-testid="oem-warranty-store-input" />
      </div>
      {actionError && <ErrorState testId="oem-warranty-action-error" message={actionError} />}

      {noticesQ.isLoading ? (
        <LoadingState label="Loading chargeback notices..." testId="oem-warranty-notices-loading" />
      ) : !noticesQ.data?.length ? (
        <EmptyState testId="oem-warranty-notices-empty" title="No chargeback notices" message="Import a chargeback notice via the OEM Profiles staging import." />
      ) : (
        <div className="space-y-3 mb-6" data-testid="oem-warranty-notices-list">
          {noticesQ.data.map((n: any) => (
            <div key={n.id} className="border border-slate-200 rounded-lg p-3" data-testid={`oem-warranty-notice-${n.id}`}>
              <div className="text-sm font-medium mb-2">{n.make} chargeback notice — {new Date(n.noticeDate).toLocaleDateString()}</div>
              <table className="w-full text-sm">
                <tbody>
                  {n.lines?.map((l: any) => (
                    <tr key={l.id} className="border-t border-slate-100" data-testid={`oem-warranty-line-${l.id}`}>
                      <td className="p-2 font-mono text-xs">{l.originalClaimItemRef}</td>
                      <td className="p-2"><MoneyCell value={Number(l.amount)} /></td>
                      <td className="p-2"><Badge variant={l.disposition === 'ACCEPTED' ? 'success' : l.disposition === 'DISPUTED' ? 'danger' : 'neutral'}>{l.disposition}</Badge></td>
                      <td className="p-2 text-xs">{l.contraItemRef && <span>contra: {l.contraItemRef}</span>}</td>
                      <td className="p-2">
                        {l.disposition === 'PENDING' && (
                          <div className="flex gap-1">
                            <Btn size="sm" variant="secondary" onClick={() => dispose(l.id, 'ACCEPTED')} data-testid={`oem-warranty-accept-${l.id}`}>Accept</Btn>
                            <Btn size="sm" variant="secondary" onClick={() => dispose(l.id, 'DISPUTED')} data-testid={`oem-warranty-dispute-${l.id}`}>Dispute</Btn>
                          </div>
                        )}
                        {l.disposition === 'DISPUTED' && (evidenceTarget === l.id ? (
                          <div className="flex gap-1">
                            <input className="h-7 w-28 px-1 text-xs border border-slate-200 rounded" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} data-testid={`oem-warranty-evidence-input-${l.id}`} />
                            <Btn size="sm" variant="primary" onClick={submitEvidence} data-testid={`oem-warranty-evidence-submit-${l.id}`}>Attach</Btn>
                          </div>
                        ) : (
                          <Btn size="sm" variant="ghost" onClick={() => setEvidenceTarget(l.id)} data-testid={`oem-warranty-evidence-open-${l.id}`}>Attach evidence</Btn>
                        ))}
                        {l.disposition === 'ACCEPTED' && (
                          <Btn size="sm" variant="secondary" onClick={() => draw(l.id)} data-testid={`oem-warranty-draw-${l.id}`}>Draw reserve</Btn>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <PageHeader title="Reserve workbench" />
      <div className="flex items-center gap-2 mb-4">
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-20" value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} placeholder="Rate %" data-testid="oem-reserve-rate-input" />
        <Btn size="sm" variant="secondary" onClick={setRate} data-testid="oem-reserve-set-rate-btn">Set rate config</Btn>
        <span className="text-slate-300">|</span>
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-24" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="oem-reserve-period-input" />
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-32" value={paidVolume} onChange={(e) => setPaidVolume(e.target.value)} placeholder="Paid volume" data-testid="oem-reserve-volume-input" />
        <Btn size="sm" variant="primary" onClick={preview} data-testid="oem-reserve-preview-btn">Preview accrual</Btn>
      </div>

      {rollforwardQ.data && (
        <div className="border border-slate-200 rounded-lg p-4 grid grid-cols-3 gap-4" data-testid="oem-reserve-rollforward">
          <div><div className="text-xs text-slate-500">Total approved</div><MoneyCell value={rollforwardQ.data.totalApproved} /></div>
          <div><div className="text-xs text-slate-500">Total drawn</div><MoneyCell value={rollforwardQ.data.totalDrawn} /></div>
          <div><div className="text-xs text-slate-500">Balance</div><strong><MoneyCell value={rollforwardQ.data.balance} /></strong></div>
        </div>
      )}
      {rollforwardQ.data?.balance === 0 && rollforwardQ.data?.totalDrawn > 0 && (
        <Banner kind="info" testId="oem-reserve-exhausted-banner" title="Reserve balance is zero — excess draws spill to expense, the balance never goes negative." />
      )}
    </div>
  );
}
