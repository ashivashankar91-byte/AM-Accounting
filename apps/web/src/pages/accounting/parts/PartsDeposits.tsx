import { useState } from 'react';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { partsApi } from '../../../api/partsApi';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd,
  EmptyState, ErrorState, LoadingState, UnauthorizedState, Drawer, DrawerRow,
} from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

const STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'neutral', APPLIED: 'success', REFUNDED: 'neutral', ABANDONED: 'warning', ESCHEATED: 'danger', REFUND_REFUSED: 'danger',
};

// CE-11 / S070 — Special-Order Deposits & Escheat. Deposit item lifecycle
// (open -> applied/refunded, or aged into the abandoned queue -> escheat per
// jurisdiction config). Second apply/refund attempts are refused
// deterministically by the backend (race-safe under serializable retry).
// Permission: parts.deposit.view / parts.deposit.manage.
export default function PartsDeposits() {
  const { entityId: contextEntityId, entityLabel } = useEntityScope();
  const [tab, setTab] = useState<'active' | 'abandoned'>('active');
  const [status, setStatus] = useState('');
  const [deposits, setDeposits] = useState<any[]>([]);
  const [abandoned, setAbandoned] = useState<any>(null);
  const [selected, setSelected] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadActive() {
    if (!contextEntityId) { setError('Select a legal entity first.'); return; }
    setBusy(true); setError(null); setUnauthorized(null);
    try { setDeposits((await partsApi.listDeposits(contextEntityId, status || undefined)).items); }
    catch (err: any) { if (err.status === 401 || err.status === 403) setUnauthorized(err.message); else setError(err.message); }
    finally { setBusy(false); }
  }

  async function loadAbandoned() {
    if (!contextEntityId) { setError('Select a legal entity first.'); return; }
    setBusy(true); setError(null); setUnauthorized(null);
    try { setAbandoned(await partsApi.abandonedDepositQueue(contextEntityId)); }
    catch (err: any) { if (err.status === 401 || err.status === 403) setUnauthorized(err.message); else setError(err.message); }
    finally { setBusy(false); }
  }

  async function refund(orderNumber: string) {
    if (!contextEntityId) { setActionError('Select a legal entity first.'); return; }
    setActionError(null);
    try {
      const result = await partsApi.refundDeposit(orderNumber, { legalEntityId: contextEntityId, reason: 'Customer requested refund' });
      setSelected(result);
      setDeposits((prev) => prev.map((d) => (d.orderNumber === orderNumber ? result : d)));
    } catch (err: any) { setActionError(err.message ?? 'Refund refused.'); }
  }

  async function escheat(orderNumber: string) {
    if (!contextEntityId) { setActionError('Select a legal entity first.'); return; }
    setActionError(null);
    try {
      const result = await partsApi.escheatDeposit(orderNumber, { legalEntityId: contextEntityId });
      setSelected(result);
      setDeposits((prev) => prev.map((d) => (d.orderNumber === orderNumber ? result : d)));
    } catch (err: any) { setActionError(err.message ?? 'Escheat refused — no jurisdiction config for this scope.'); }
  }

  const items = tab === 'active' ? deposits : (abandoned?.items ?? []);

  return (
    <ReportShell
      title="Special-Order Deposit Inquiry"
      description="Deposit item lifecycle: open -> applied at sale/RO, or refunded. Aged unapplied deposits surface in the abandoned queue and escheat per jurisdiction configuration."
      scopeFields={[{ label: 'Legal entity', value: entityLabel ?? contextEntityId ?? 'Not selected', muted: !contextEntityId }]}
    >
      <div className="flex gap-4 mb-3 border-b border-slate-200">
        <button className={`pb-2 text-xs font-medium border-b-2 ${tab === 'active' ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`} onClick={() => { setTab('active'); loadActive(); }} data-testid="deposits-tab-active">
          Active deposits
        </button>
        <button className={`pb-2 text-xs font-medium border-b-2 ${tab === 'abandoned' ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`} onClick={() => { setTab('abandoned'); loadAbandoned(); }} data-testid="deposits-tab-abandoned">
          Aging / abandoned
        </button>
      </div>

      {tab === 'active' && (
        <FilterBar>
          <FilterField label="Status" width={160}>
            <select className={FILTER_CONTROL_CLASS} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="deposits-status-filter">
              <option value="">All</option>
              <option value="OPEN">Open</option>
              <option value="APPLIED">Applied</option>
              <option value="REFUNDED">Refunded</option>
            </select>
          </FilterField>
          <Btn size="sm" onClick={loadActive} disabled={busy} loading={busy} data-testid="deposits-search">Search</Btn>
        </FilterBar>
      )}

      {error && <ErrorState testId="deposits-error" message={error} onRetry={tab === 'active' ? loadActive : loadAbandoned} />}
      {unauthorized && <UnauthorizedState testId="deposits-unauthorized" message={unauthorized} />}
      {busy && <LoadingState testId="deposits-loading" label="Loading deposits…" />}

      {!busy && tab === 'abandoned' && items.length === 0 && !error && !unauthorized && (
        <EmptyState testId="deposits-abandoned-empty" title="No abandoned deposits" message="No deposits currently qualify for the abandoned/escheat queue at this scope." />
      )}
      {!busy && tab === 'active' && items.length === 0 && !error && !unauthorized && (
        <EmptyState testId="deposits-active-empty" title="No deposits found" message="Search above, or create a deposit from the operational Parts module." />
      )}

      {!busy && items.length > 0 && (
        <FinancialTable testId="deposits-table">
          <ReportThead>
            <tr>
              <ReportTh>Order #</ReportTh>
              <ReportTh>Customer</ReportTh>
              <ReportTh align="right">Amount</ReportTh>
              <ReportTh>Aging since</ReportTh>
              <ReportTh>Status</ReportTh>
              <ReportTh>Actions</ReportTh>
            </tr>
          </ReportThead>
          <tbody>
            {items.map((d: any) => (
              <ReportTr key={d.id} testId={`deposit-row-${d.orderNumber}`}>
                <ReportTd className="font-mono">{d.orderNumber}</ReportTd>
                <ReportTd>{d.customerRef}</ReportTd>
                <ReportTd align="right" className="font-mono tabular-nums">{d.depositAmount}</ReportTd>
                <ReportTd>{d.agingSinceDate?.slice(0, 10)}</ReportTd>
                <ReportTd><Badge variant={STATUS_VARIANT[d.status] ?? 'neutral'} dot>{d.status.replace(/_/g, ' ')}</Badge></ReportTd>
                <ReportTd>
                  <div className="flex gap-1">
                    <Btn size="sm" variant="secondary" onClick={() => setSelected(d)} data-testid={`deposit-view-${d.orderNumber}`}>View</Btn>
                    {tab === 'abandoned' && (
                      <Btn size="sm" variant="danger" onClick={() => escheat(d.orderNumber)} data-testid={`deposit-escheat-${d.orderNumber}`}>Escheat</Btn>
                    )}
                  </div>
                </ReportTd>
              </ReportTr>
            ))}
          </tbody>
        </FinancialTable>
      )}

      {selected && (
        <Drawer open title={`Deposit ${selected.orderNumber}`} onClose={() => { setSelected(null); setActionError(null); }} testId="deposit-drawer">
          <DrawerRow label="Status" value={<Badge variant={STATUS_VARIANT[selected.status] ?? 'neutral'} dot>{selected.status.replace(/_/g, ' ')}</Badge>} />
          <DrawerRow label="Amount" value={selected.depositAmount} />
          <DrawerRow label="Deposit journal" value={selected.depositJournalEntryId ?? '—'} />
          <DrawerRow label="Applied journal" value={selected.appliedJournalEntryId ?? '—'} />
          <DrawerRow label="Refund journal" value={selected.refundJournalEntryId ?? '—'} />
          {actionError && <div className="text-xs text-red-600 mt-2" data-testid="deposit-action-error">{actionError}</div>}
          {selected.status === 'OPEN' && (
            <div className="mt-3 flex gap-2">
              <Btn size="sm" variant="danger" onClick={() => refund(selected.orderNumber)} data-testid="deposit-refund">Refund</Btn>
            </div>
          )}
          {selected.status !== 'OPEN' && (
            <div className="mt-3 text-[11px] text-slate-500">
              Refund is refused once a deposit is applied or already refunded — this is the same action that would run above, shown here disabled by state rather than hidden.
            </div>
          )}
        </Drawer>
      )}
    </ReportShell>
  );
}
