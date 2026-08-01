import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { oemApi } from '../../../api/client';
import { PageHeader, Btn, Badge, MoneyCell } from '../../../components/ui';
import { LoadingState, EmptyState, ErrorState, UnauthorizedState } from '../../../components/report';

// CE-14 S106 — Co-op Center. Programs, claim builder (spend selection w/
// evidence), export, response entry, denial ceremonies, accrual previews.
// Permissions: oem.coop.view / oem.coop.claim.manage / oem.coop.accrual.manage.
export default function OemCoop() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('STORE-1');
  const [make, setMake] = useState('FORD');
  const [programId, setProgramId] = useState('');
  const [ratePercent, setRatePercent] = useState('5.0');
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
  const [spendRef, setSpendRef] = useState('');
  const [spendAmount, setSpendAmount] = useState('');
  const [spendEvidence, setSpendEvidence] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [responseAmounts, setResponseAmounts] = useState<Record<string, string>>({});

  const programsQ = useQuery({ queryKey: ['oem-coop-programs'], queryFn: () => oemApi.listCoopPrograms(), retry: false });
  const claimsQ = useQuery({ queryKey: ['oem-coop-claims', storeId], queryFn: () => oemApi.listCoopClaims(storeId), retry: false });
  const claimQ = useQuery({ queryKey: ['oem-coop-claim', selectedClaimId], queryFn: () => oemApi.getCoopClaim(selectedClaimId!), enabled: !!selectedClaimId, retry: false });

  async function registerProgram() {
    if (!programId.trim()) return;
    await oemApi.registerCoopProgram({ make, programId: programId.trim(), accrualBasis: 'PERCENT_OF_SALES', ratePercent });
    setProgramId('');
    qc.invalidateQueries({ queryKey: ['oem-coop-programs'] });
  }

  async function createClaim() {
    if (!selectedProgramId) return;
    const claim = await oemApi.createCoopClaim(storeId, selectedProgramId);
    setSelectedClaimId(claim.id);
    qc.invalidateQueries({ queryKey: ['oem-coop-claims'] });
  }

  async function addLine() {
    if (!selectedClaimId || !spendRef || !spendAmount || !spendEvidence) return;
    setActionError(null);
    try {
      await oemApi.addCoopClaimLine(selectedClaimId, { spendItemRef: spendRef, description: 'Fixture spend', amount: spendAmount, evidenceRef: spendEvidence });
      setSpendRef(''); setSpendAmount(''); setSpendEvidence('');
      qc.invalidateQueries({ queryKey: ['oem-coop-claim', selectedClaimId] });
    } catch (err: any) { setActionError(err.message); }
  }

  async function doExport() {
    if (!selectedClaimId) return;
    await oemApi.exportCoopClaim(selectedClaimId);
    qc.invalidateQueries({ queryKey: ['oem-coop-claim', selectedClaimId] });
  }

  async function recordResponse(lineId: string, status: string) {
    const amount = status === 'DENIED' ? undefined : responseAmounts[lineId];
    await oemApi.recordCoopResponse(lineId, status, amount);
    qc.invalidateQueries({ queryKey: ['oem-coop-claim', selectedClaimId] });
  }

  async function writeOff(lineId: string) {
    await oemApi.writeOffCoopLine(lineId);
    qc.invalidateQueries({ queryKey: ['oem-coop-claim', selectedClaimId] });
  }

  if (programsQ.error) {
    const status = (programsQ.error as any)?.status;
    if (status === 401 || status === 403) {
      return <div className="p-7"><UnauthorizedState testId="oem-coop-unauthorized" message="You do not have the oem.coop.view permission required to view the Co-op Center." /></div>;
    }
    return <div className="p-7"><ErrorState testId="oem-coop-error" message={(programsQ.error as Error).message} onRetry={() => programsQ.refetch()} /></div>;
  }

  const claim = claimQ.data;

  return (
    <div className="p-7 min-h-full" data-testid="oem-coop-page">
      <PageHeader title="Co-op Advertising Center" subtitle="Claim package totals equal selected spend exactly; every line requires evidence (S106)." />

      <div className="flex items-center gap-2 mb-4">
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-24" value={make} onChange={(e) => setMake(e.target.value)} data-testid="oem-coop-make-input" />
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg" value={programId} onChange={(e) => setProgramId(e.target.value)} placeholder="Program ID" data-testid="oem-coop-programid-input" />
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-20" value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} placeholder="Rate %" data-testid="oem-coop-rate-input" />
        <Btn size="sm" variant="secondary" onClick={registerProgram} data-testid="oem-coop-register-btn">Register program</Btn>
      </div>

      {programsQ.isLoading ? (
        <LoadingState label="Loading co-op programs..." testId="oem-coop-programs-loading" />
      ) : !programsQ.data?.length ? (
        <EmptyState testId="oem-coop-programs-empty" title="No co-op programs registered" message="Register a program above." />
      ) : (
        <div className="flex items-center gap-2 mb-4">
          <select className="h-8 px-2 text-sm border border-slate-200 rounded-lg" value={selectedProgramId} onChange={(e) => setSelectedProgramId(e.target.value)} data-testid="oem-coop-program-select">
            <option value="">Select program...</option>
            {programsQ.data.map((p: any) => <option key={p.id} value={p.id}>{p.make} — {p.programId}</option>)}
          </select>
          <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-24" value={storeId} onChange={(e) => setStoreId(e.target.value)} data-testid="oem-coop-store-input" />
          <Btn size="sm" variant="primary" onClick={createClaim} disabled={!selectedProgramId} data-testid="oem-coop-create-claim-btn">New claim</Btn>
        </div>
      )}

      {claimsQ.isLoading ? (
        <LoadingState label="Loading claims..." testId="oem-coop-claims-loading" />
      ) : !claimsQ.data?.length ? (
        <EmptyState testId="oem-coop-claims-empty" title="No co-op claims yet" message="Select a program and click New claim." />
      ) : (
        <div className="flex gap-2 mb-4 flex-wrap" data-testid="oem-coop-claims-list">
          {claimsQ.data.map((c: any) => (
            <button key={c.id} onClick={() => setSelectedClaimId(c.id)} className={`text-xs px-3 py-1.5 rounded-full border ${selectedClaimId === c.id ? 'border-brand bg-brand-light text-brand' : 'border-slate-200'}`} data-testid={`oem-coop-claim-chip-${c.id}`}>
              {c.status} — <MoneyCell value={Number(c.totalSpend)} />
            </button>
          ))}
        </div>
      )}

      {actionError && <ErrorState testId="oem-coop-action-error" message={actionError} />}

      {claim && (
        <div data-testid="oem-coop-claim-detail">
          {claim.status === 'DRAFT' && (
            <div className="flex items-center gap-2 mb-3 border border-slate-200 rounded-lg p-3">
              <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg" placeholder="Spend ref (AP doc)" value={spendRef} onChange={(e) => setSpendRef(e.target.value)} data-testid="oem-coop-spend-ref-input" />
              <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-28" placeholder="Amount" value={spendAmount} onChange={(e) => setSpendAmount(e.target.value)} data-testid="oem-coop-spend-amount-input" />
              <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg" placeholder="Evidence ref" value={spendEvidence} onChange={(e) => setSpendEvidence(e.target.value)} data-testid="oem-coop-spend-evidence-input" />
              <Btn size="sm" variant="secondary" onClick={addLine} data-testid="oem-coop-add-line-btn">Add spend line</Btn>
              <Btn size="sm" variant="primary" onClick={doExport} disabled={!claim.lines?.length} data-testid="oem-coop-export-btn">Export claim</Btn>
            </div>
          )}
          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="text-left p-2">Spend ref</th><th className="text-left p-2">Amount</th><th className="text-left p-2">Response</th><th className="text-left p-2">Action</th></tr></thead>
            <tbody>
              {claim.lines?.map((l: any) => (
                <tr key={l.id} className="border-t border-slate-100" data-testid={`oem-coop-line-${l.id}`}>
                  <td className="p-2 font-mono text-xs">{l.spendItemRef}</td>
                  <td className="p-2"><MoneyCell value={Number(l.amount)} /></td>
                  <td className="p-2"><Badge variant={l.responseStatus === 'APPROVED' ? 'success' : l.responseStatus === 'DENIED' ? 'danger' : l.responseStatus === 'PARTIAL' ? 'warning' : 'neutral'}>{l.responseStatus}</Badge></td>
                  <td className="p-2">
                    {claim.status === 'EXPORTED' && l.responseStatus === 'PENDING' && (
                      <div className="flex gap-1">
                        <input className="h-7 w-20 px-1 text-xs border border-slate-200 rounded" placeholder="amt" value={responseAmounts[l.id] ?? ''} onChange={(e) => setResponseAmounts({ ...responseAmounts, [l.id]: e.target.value })} data-testid={`oem-coop-response-amount-${l.id}`} />
                        <Btn size="sm" variant="secondary" onClick={() => recordResponse(l.id, 'APPROVED')} data-testid={`oem-coop-approve-${l.id}`}>Approve</Btn>
                        <Btn size="sm" variant="secondary" onClick={() => recordResponse(l.id, 'PARTIAL')} data-testid={`oem-coop-partial-${l.id}`}>Partial</Btn>
                        <Btn size="sm" variant="danger" onClick={() => recordResponse(l.id, 'DENIED')} data-testid={`oem-coop-deny-${l.id}`}>Deny</Btn>
                      </div>
                    )}
                    {l.responseStatus === 'DENIED' && !l.writeOffAmount && (
                      <Btn size="sm" variant="secondary" onClick={() => writeOff(l.id)} data-testid={`oem-coop-writeoff-${l.id}`}>Write off</Btn>
                    )}
                    {l.receivableItemRef && <span className="text-xs text-slate-500">recv: {l.receivableItemRef}</span>}
                    {l.writeOffAmount && <span className="text-xs text-slate-500">written off: {l.writeOffAmount}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
