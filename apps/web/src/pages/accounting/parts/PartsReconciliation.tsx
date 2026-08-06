import { useState } from 'react';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { partsApi, type PartsReconciliationRun } from '../../../api/partsApi';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd,
  Banner, EmptyState, ErrorState, LoadingState, UnauthorizedState,
} from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

const todayIso = () => new Date().toISOString().slice(0, 10);

// CE-11 / S066 — Parts Perpetual-to-GL Reconciliation. Per entity/store:
// perpetual Σ (from PartsPerpetualBalance, priced per the active S072
// valuation config) vs GL control balance. $0 = BALANCED, any nonzero
// variance is shown loud with a movement-level drill — never hidden,
// never averaged away. Permission: parts.reconciliation.view /
// parts.reconciliation.run.
export default function PartsReconciliation() {
  const { entityId: contextEntityId, entityLabel, storeId } = useEntityScope();
  const [entityId, setEntityId] = useState(contextEntityId ?? '');
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [runs, setRuns] = useState<PartsReconciliationRun[]>([]);
  const [selected, setSelected] = useState<PartsReconciliationRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [glUnavailable, setGlUnavailable] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  async function loadHistory() {
    if (!entityId.trim()) { setError('Select a legal entity first.'); return; }
    setBusy(true); setError(null); setUnauthorized(null); setGlUnavailable(null);
    try {
      const res = await partsApi.listReconciliationRuns(entityId.trim(), storeId ?? undefined);
      setRuns(res.items);
      setSelected(res.items[0] ?? null);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
      else setError(err.message);
    } finally { setBusy(false); }
  }

  async function runNow() {
    if (!entityId.trim()) { setError('Select a legal entity first.'); return; }
    setBusy(true); setError(null); setUnauthorized(null); setGlUnavailable(null);
    try {
      // No client-supplied GL figure — the server resolves the real
      // coa-service ending balance for the tenant-configured
      // inventory-control account and returns it verbatim below.
      const run = await partsApi.runReconciliation({
        legalEntityId: entityId.trim(), storeId: storeId ?? undefined, asOfDate, triggeredBy: 'ON_DEMAND',
      });
      setRuns((prev) => [run, ...prev]);
      setSelected(run);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
      else if (err.body?.error === 'GL_BALANCE_UNAVAILABLE') setGlUnavailable(err.message);
      else if (err.body?.error === 'ACCOUNT_MAPPING_VALUES_PENDING') setGlUnavailable(`Inventory-control GL account is not yet configured for this legal entity (${err.message}). Resolve the PARTS_RECONCILIATION / INVENTORY_CONTROL account mapping before running a reconciliation.`);
      else setError(err.message);
    } finally { setBusy(false); }
  }

  const status = selected ? { label: selected.status === 'BALANCED' ? 'Balanced' : 'Variance', variant: selected.status === 'BALANCED' ? ('success' as const) : ('danger' as const) } : undefined;

  return (
    <ReportShell
      title="Parts Perpetual-to-GL Reconciliation"
      description="Perpetual inventory Σ (priced per the active S072 valuation config) vs GL inventory-control balance, per legal entity / store / date."
      status={status}
      scopeFields={[
        { label: 'Legal entity', value: entityLabel ?? entityId ?? 'Not selected', muted: !entityId },
        { label: 'Store', value: storeId ?? 'All stores', muted: !storeId },
        { label: 'As of', value: asOfDate },
      ]}
    >
      <Banner kind="info" testId="parts-reconciliation-authoritative-banner" title="GL control balance is the real coa-service ending balance">
        The server resolves the tenant-configured inventory-control account (PARTS_RECONCILIATION / INVENTORY_CONTROL mapping) and asks coa-service's real GL Account Activity Inquiry for its ending balance as of the selected date — rendered below verbatim. No figure is entered here or computed in the browser; if the mapping is unresolved or coa-service is unreachable, the run is refused with an explicit unavailable state, never a fabricated result.
      </Banner>

      <FilterBar>
        <FilterField label="Legal entity" width={200}>
          <input className={FILTER_CONTROL_CLASS} value={entityId} onChange={(e) => setEntityId(e.target.value)} data-testid="parts-reconciliation-entity" />
        </FilterField>
        <FilterField label="As of date" width={140}>
          <input type="date" className={FILTER_CONTROL_CLASS} value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} data-testid="parts-reconciliation-asof" />
        </FilterField>
        <Btn size="sm" onClick={runNow} disabled={busy} loading={busy} data-testid="parts-reconciliation-run">
          {busy ? 'Running…' : 'Run reconciliation'}
        </Btn>
        <Btn size="sm" variant="secondary" onClick={loadHistory} disabled={busy} data-testid="parts-reconciliation-history">
          Load history
        </Btn>
      </FilterBar>

      {error && <ErrorState testId="parts-reconciliation-error" message={error} onRetry={loadHistory} />}
      {unauthorized && <UnauthorizedState testId="parts-reconciliation-unauthorized" message={unauthorized} />}
      {glUnavailable && (
        <ErrorState
          testId="parts-reconciliation-gl-unavailable"
          message={`GL balance unavailable — ${glUnavailable}`}
          onRetry={runNow}
        />
      )}
      {busy && <LoadingState testId="parts-reconciliation-loading" label="Computing tie-out…" />}

      {!busy && runs.length === 0 && !error && !unauthorized && (
        <EmptyState testId="parts-reconciliation-empty" title="No reconciliation runs yet" message="Run a reconciliation for this scope, or load history if one already exists." />
      )}

      {selected && (
        <FinancialTable testId="parts-reconciliation-summary-table">
          <ReportThead>
            <tr>
              <ReportTh>Run date</ReportTh>
              <ReportTh align="right">Perpetual Σ</ReportTh>
              <ReportTh align="right">GL control</ReportTh>
              <ReportTh align="right">Variance</ReportTh>
              <ReportTh>Status</ReportTh>
            </tr>
          </ReportThead>
          <tbody>
            {runs.map((r) => (
              <ReportTr key={r.id} testId={`parts-reconciliation-row-${r.id}`} onClick={() => setSelected(r)}>
                <ReportTd>{r.asOfDate?.slice(0, 10)}</ReportTd>
                <ReportTd align="right" className="font-mono tabular-nums">{r.perpetualTotal}</ReportTd>
                <ReportTd align="right" className="font-mono tabular-nums">{r.glControlTotal}</ReportTd>
                <ReportTd align="right" className="font-mono tabular-nums">{r.varianceAmount}</ReportTd>
                <ReportTd><Badge variant={r.status === 'BALANCED' ? 'success' : 'danger'} dot>{r.status}</Badge></ReportTd>
              </ReportTr>
            ))}
          </tbody>
        </FinancialTable>
      )}

      {selected && selected.status === 'VARIANCE' && (
        <div className="mt-4">
          <div className="text-sm font-semibold text-red-700 mb-2">Variance drill — movement-level explanation (never hidden)</div>
          {(!selected.varianceLines || selected.varianceLines.length === 0) ? (
            <EmptyState testId="parts-reconciliation-no-drill" title="No drill lines recorded for this run" />
          ) : (
            <FinancialTable testId="parts-reconciliation-drill-table">
              <ReportThead>
                <tr>
                  <ReportTh>Part</ReportTh>
                  <ReportTh>Movement</ReportTh>
                  <ReportTh align="right">Explained</ReportTh>
                  <ReportTh align="right">Unexplained</ReportTh>
                </tr>
              </ReportThead>
              <tbody>
                {selected.varianceLines.map((l) => (
                  <ReportTr key={l.id} testId={`parts-reconciliation-drill-${l.id}`}>
                    <ReportTd>{l.partNumber}</ReportTd>
                    <ReportTd>
                      {l.movementId ? (
                        <a className="text-brand underline" href={`/accounting/parts/movements?movementId=${encodeURIComponent(l.movementId)}`}>{l.movementId}</a>
                      ) : '—'}
                    </ReportTd>
                    <ReportTd align="right" className="font-mono tabular-nums">{l.explainedAmount}</ReportTd>
                    <ReportTd align="right" className="font-mono tabular-nums text-red-700 font-semibold">{l.unexplainedAmount}</ReportTd>
                  </ReportTr>
                ))}
              </tbody>
            </FinancialTable>
          )}
        </div>
      )}
    </ReportShell>
  );
}
