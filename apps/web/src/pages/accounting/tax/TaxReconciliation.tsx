import { useState } from 'react';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { taxApi, type TaxReconciliationResult } from '../../../api/client';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd, TotalsRow,
  Banner, EmptyState, ErrorState, LoadingState, UnauthorizedState, ExportMenu,
} from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

const now = new Date();
const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// CE-10 / S124 — Tax Liability Reconciliation. Period × entity × jurisdiction
// three-way tie: engine Σ = posted Σ = GL movement. A jurisdiction row that
// doesn't tie shows a loud variance, never a silently-averaged/estimated
// number. Report-screen pattern per the Fable package. Permission:
// tax.reconciliation.view.
export default function TaxReconciliation() {
  const { entityId: contextEntityId, entityLabel } = useEntityScope();
  const [entityId, setEntityId] = useState(contextEntityId ?? '');
  const [period, setPeriod] = useState(defaultPeriod);
  const [jurisdiction, setJurisdiction] = useState('');
  const [result, setResult] = useState<TaxReconciliationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function run() {
    if (!entityId.trim()) {
      setError('Select a legal entity to run the reconciliation.');
      return;
    }
    setBusy(true);
    setError(null);
    setUnauthorized(null);
    setResult(null);
    try {
      const data = await taxApi.getReconciliation({ period, entityId: entityId.trim(), jurisdiction: jurisdiction || undefined });
      setResult(data);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    if (!entityId.trim()) return;
    setExportBusy(true);
    setExportError(null);
    try {
      await taxApi.getReconciliationReport({ period, entityId: entityId.trim(), jurisdiction: jurisdiction || undefined });
    } catch (err: any) {
      setExportError(err.message);
    } finally {
      setExportBusy(false);
    }
  }

  const allBalanced = result ? result.rows.every((r) => r.balanced) : false;
  const status = result
    ? { label: allBalanced ? 'Balanced' : 'Variance', variant: allBalanced ? ('success' as const) : ('danger' as const) }
    : undefined;

  return (
    <ReportShell
      title="Tax Liability Reconciliation"
      description="Period × entity × jurisdiction three-way tie: engine result Σ = posted tax-line Σ = GL tax-liability account movement."
      status={status}
      scopeFields={[
        { label: 'Legal entity', value: entityLabel ?? entityId ?? 'Not selected', muted: !entityId },
        { label: 'Period', value: period },
      ]}
      actions={
        <ExportMenu
          disabled={exportBusy || !result}
          formats={[{ key: 'csv', label: exportBusy ? 'Exporting…' : 'Export', onSelect: doExport, testId: 'tax-reconciliation-export' }]}
        />
      }
    >
      <FilterBar>
        <FilterField label="Legal entity" width={200}>
          <input className={FILTER_CONTROL_CLASS} value={entityId} onChange={(e) => setEntityId(e.target.value)} data-testid="tax-reconciliation-entity" />
        </FilterField>
        <FilterField label="Period (YYYY-MM)" width={140}>
          <input className={FILTER_CONTROL_CLASS} value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="tax-reconciliation-period" />
        </FilterField>
        <FilterField label="Jurisdiction (optional)" width={160}>
          <input className={FILTER_CONTROL_CLASS} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} data-testid="tax-reconciliation-jurisdiction" />
        </FilterField>
        <Btn size="sm" onClick={run} disabled={busy} loading={busy} data-testid="tax-reconciliation-run">
          {busy ? 'Loading…' : 'Run reconciliation'}
        </Btn>
      </FilterBar>

      {error && <ErrorState testId="tax-reconciliation-error" message={error} onRetry={run} />}
      {unauthorized && <UnauthorizedState testId="tax-reconciliation-unauthorized" message={unauthorized} />}
      {exportError && <ErrorState testId="tax-reconciliation-export-error" message={exportError} />}
      {busy && <LoadingState testId="tax-reconciliation-loading" label="Building three-way tie…" />}

      {result && result.glMovementSourceIsPending && (
        <Banner kind="info" testId="tax-reconciliation-gl-pending-banner" title="GL movement source pending upstream reconciliation (CE-07) — showing engine and stored-result totals only.">
          The tax-liability GL account movement figure is not yet available from the upstream close reconciliation. Engine and posted-result totals below are real; the GL movement column will populate once CE-07's reconciliation feed is live.
        </Banner>
      )}

      {result && result.rows.length === 0 && (
        <EmptyState testId="tax-reconciliation-empty" title="No jurisdiction activity for this period/entity" message="No engine results or posted tax lines exist for this scope." />
      )}

      {result && result.rows.length > 0 && (
        <FinancialTable testId="tax-reconciliation-table">
          <ReportThead>
            <tr>
              <ReportTh>Jurisdiction</ReportTh>
              <ReportTh align="right">Engine Σ</ReportTh>
              <ReportTh align="right">Posted Σ</ReportTh>
              <ReportTh align="right">GL movement</ReportTh>
              <ReportTh align="right">Variance</ReportTh>
              <ReportTh>Status</ReportTh>
            </tr>
          </ReportThead>
          <tbody>
            {result.rows.map((row) => (
              <ReportTr key={row.jurisdiction} testId={`tax-reconciliation-row-${row.jurisdiction}`}>
                <ReportTd>{row.jurisdiction}</ReportTd>
                <ReportTd align="right" className="font-mono tabular-nums">{row.engineSum}</ReportTd>
                <ReportTd align="right" className="font-mono tabular-nums">{row.postedSum}</ReportTd>
                <ReportTd align="right" className="font-mono tabular-nums">{row.glMovement ?? '—'}</ReportTd>
                <ReportTd align="right" className="font-mono tabular-nums">{row.variance}</ReportTd>
                <ReportTd>
                  <Badge variant={row.balanced ? 'success' : 'danger'} dot>{row.balanced ? 'BALANCED' : 'VARIANCE'}</Badge>
                </ReportTd>
              </ReportTr>
            ))}
          </tbody>
          {!allBalanced && (
            <tfoot>
              <TotalsRow testId="tax-reconciliation-variance-banner-row">
                <ReportTd colSpan={6}>
                  <span className="text-red-700 font-semibold">Unreconciled tax variance detected — drill into the discrepant jurisdiction row(s) above before period close.</span>
                </ReportTd>
              </TotalsRow>
            </tfoot>
          )}
        </FinancialTable>
      )}

      {!result && !busy && !error && !unauthorized && (
        <EmptyState testId="tax-reconciliation-initial-state" title="Enter a scope and run the reconciliation." />
      )}
    </ReportShell>
  );
}
