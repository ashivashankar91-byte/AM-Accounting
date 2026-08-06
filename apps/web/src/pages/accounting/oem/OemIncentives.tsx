import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { oemApi } from '../../../api/client';
import { PageHeader, Btn, Badge, MoneyCell } from '../../../components/ui';
import { LoadingState, EmptyState, ErrorState, UnauthorizedState, Banner } from '../../../components/report';

// CE-14 S103A — Incentive Registry & Flat RDR Accruals. Program registry
// (flat amounts, effective dates), RDR accrual feed, true-up ceremonies,
// receivable tie strip. Permissions: oem.incentive.view / oem.incentive.manage
// / oem.incentive.trueup.
export default function OemIncentives() {
  const qc = useQueryClient();
  const [storeId, setStoreId] = useState('STORE-1');
  const [make, setMake] = useState('FORD');
  const [programId, setProgramId] = useState('');
  const [flatAmount, setFlatAmount] = useState('');
  const [trueUpTarget, setTrueUpTarget] = useState<string | null>(null);
  const [trueUpAmount, setTrueUpAmount] = useState('');

  const programsQ = useQuery({ queryKey: ['oem-incentive-programs'], queryFn: () => oemApi.listIncentivePrograms(), retry: false });
  const accrualsQ = useQuery({ queryKey: ['oem-incentive-accruals', storeId], queryFn: () => oemApi.listIncentiveAccruals(storeId), retry: false });
  const tieQ = useQuery({ queryKey: ['oem-incentive-tie', storeId], queryFn: () => oemApi.getIncentiveReceivableTie(storeId), retry: false });

  async function registerProgram() {
    if (!programId.trim() || !flatAmount.trim()) return;
    await oemApi.registerIncentiveProgram({ make, programId: programId.trim(), amountType: 'FLAT', flatAmountPerUnit: flatAmount, effectiveFrom: new Date().toISOString().slice(0, 10) });
    setProgramId(''); setFlatAmount('');
    qc.invalidateQueries({ queryKey: ['oem-incentive-programs'] });
  }

  async function runAccrual() {
    await oemApi.accrueIncentives(storeId, '1970-01-01');
    qc.invalidateQueries({ queryKey: ['oem-incentive-accruals'] });
    qc.invalidateQueries({ queryKey: ['oem-incentive-tie'] });
  }

  async function submitTrueUp() {
    if (!trueUpTarget || !trueUpAmount) return;
    await oemApi.trueUpIncentiveAccrual(trueUpTarget, { adjustmentAmount: trueUpAmount, reason: 'Factory statement true-up' });
    setTrueUpTarget(null); setTrueUpAmount('');
    qc.invalidateQueries({ queryKey: ['oem-incentive-accruals'] });
    qc.invalidateQueries({ queryKey: ['oem-incentive-tie'] });
  }

  if (programsQ.error) {
    const status = (programsQ.error as any)?.status;
    if (status === 401 || status === 403) {
      return <div className="p-7"><UnauthorizedState testId="oem-incentives-unauthorized" message="You do not have the oem.incentive.view permission required to view Incentives." /></div>;
    }
    return <div className="p-7"><ErrorState testId="oem-incentives-error" message={(programsQ.error as Error).message} onRetry={() => programsQ.refetch()} /></div>;
  }

  return (
    <div className="p-7 min-h-full" data-testid="oem-incentives-page">
      <PageHeader title="Incentive Registry" subtitle="Flat programs only in Pass-1. Unregistered/untagged deliveries never silently accrue (S103A)." />

      <div className="flex items-center gap-2 mb-4">
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-24" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Make" data-testid="oem-incentive-make-input" />
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg" value={programId} onChange={(e) => setProgramId(e.target.value)} placeholder="Program ID" data-testid="oem-incentive-programid-input" />
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-32" value={flatAmount} onChange={(e) => setFlatAmount(e.target.value)} placeholder="Flat $/unit" data-testid="oem-incentive-flatamount-input" />
        <Btn size="sm" variant="secondary" onClick={registerProgram} data-testid="oem-incentive-register-btn">Register program</Btn>
        <span className="text-slate-300">|</span>
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-28" value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="Store ID" data-testid="oem-incentive-store-input" />
        <Btn size="sm" variant="primary" onClick={runAccrual} data-testid="oem-incentive-accrue-btn">Accrue fixture deliveries</Btn>
      </div>

      {programsQ.isLoading ? (
        <LoadingState label="Loading programs..." testId="oem-incentive-programs-loading" />
      ) : !programsQ.data?.length ? (
        <EmptyState testId="oem-incentive-programs-empty" title="No incentive programs registered" message="Register a flat program above." />
      ) : (
        <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden mb-6" data-testid="oem-incentive-programs-table">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="text-left p-2">Make</th><th className="text-left p-2">Program</th><th className="text-left p-2">Type</th><th className="text-left p-2">Flat $/unit</th></tr></thead>
          <tbody>
            {programsQ.data.map((p: any) => (
              <tr key={p.id} className="border-t border-slate-100" data-testid={`oem-incentive-program-${p.id}`}>
                <td className="p-2">{p.make}</td><td className="p-2">{p.programId}</td><td className="p-2"><Badge variant={p.amountType === 'FLAT' ? 'success' : 'neutral'}>{p.amountType}</Badge></td>
                <td className="p-2">{p.flatAmountPerUnit ? <MoneyCell value={Number(p.flatAmountPerUnit)} /> : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tieQ.data && (
        <div className="border border-slate-200 rounded-lg p-3 mb-4 flex items-center justify-between" data-testid="oem-incentive-tie-strip">
          <span className="text-sm text-slate-600">Open incentive receivable ({tieQ.data.itemCount} items): <strong><MoneyCell value={Number(tieQ.data.totalOpenIncentiveReceivable)} /></strong></span>
          {tieQ.data.glMovementSourceIsPending && <Badge variant="warning">GL tie: PENDING_UPSTREAM_TECHNICAL_RECONCILIATION</Badge>}
        </div>
      )}

      <PageHeader title="Accruals" />
      {accrualsQ.isLoading ? (
        <LoadingState label="Loading accruals..." testId="oem-incentive-accruals-loading" />
      ) : !accrualsQ.data?.length ? (
        <EmptyState testId="oem-incentive-accruals-empty" title="No accruals yet" message="Run 'Accrue fixture deliveries' above." />
      ) : (
        <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden" data-testid="oem-incentive-accruals-table">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="text-left p-2">Deal</th><th className="text-left p-2">Apply #</th><th className="text-left p-2">Amount</th><th className="text-left p-2">Status</th><th className="text-left p-2">True-up</th></tr></thead>
          <tbody>
            {accrualsQ.data.map((a: any) => (
              <tr key={a.id} className="border-t border-slate-100" data-testid={`oem-incentive-accrual-${a.id}`}>
                <td className="p-2">{a.dealNumber}</td><td className="p-2 font-mono text-xs">{a.applyNumber}</td>
                <td className="p-2"><MoneyCell value={Number(a.accruedAmount)} /></td>
                <td className="p-2"><Badge variant={a.status === 'TRUED_UP' ? 'info' : 'neutral'}>{a.status}</Badge></td>
                <td className="p-2">
                  {trueUpTarget === a.id ? (
                    <div className="flex gap-1">
                      <input className="h-7 w-20 px-1 text-xs border border-slate-200 rounded" value={trueUpAmount} onChange={(e) => setTrueUpAmount(e.target.value)} data-testid={`oem-trueup-amount-${a.id}`} />
                      <Btn size="sm" variant="primary" onClick={submitTrueUp} data-testid={`oem-trueup-submit-${a.id}`}>Save</Btn>
                    </div>
                  ) : (
                    <Btn size="sm" variant="ghost" onClick={() => setTrueUpTarget(a.id)} data-testid={`oem-trueup-open-${a.id}`}>True-up</Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Banner kind="info" testId="oem-incentive-boundary-banner" title="RDR deliveries source (CE-12) — PENDING_UPSTREAM_TECHNICAL_RECONCILIATION">
        Fixture deliveries drive accrual until CE-12's deal.finalized feed is wired.
      </Banner>
    </div>
  );
}
