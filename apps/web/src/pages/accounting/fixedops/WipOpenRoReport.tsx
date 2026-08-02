// CE-11 mandatory UI screen #3 — WIP Inquiry / Open-RO Report.
// /accounting/fixedops/wip — Controller persona.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { fixedopsApi } from '../../../api/fixedopsApi';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd,
  Banner, EmptyState, ErrorState, LoadingState, UnauthorizedState,
} from '../../../components/report';
import { Btn, Badge, MoneyCell } from '../../../components/ui';

const TIE_LABEL: Record<string, { label: string; variant: 'success' | 'danger' | 'neutral' }> = {
  BALANCED: { label: 'BALANCED', variant: 'success' },
  VARIANCE: { label: 'VARIANCE', variant: 'danger' },
  GL_BALANCE_UNAVAILABLE: { label: 'GL BALANCE NOT SUPPLIED', variant: 'neutral' },
};

function ElectModeDialog({ legalEntityId, onClose }: { legalEntityId: string; onClose: () => void }) {
  const [mode, setMode] = useState<'WIP_MODE' | 'DIRECT_MODE'>('WIP_MODE');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  async function submit() {
    setBusy(true); setError(null);
    try {
      await fixedopsApi.electWipMode({ legalEntityId, mode, effectiveFrom, impactPreview: preview || undefined });
      await qc.invalidateQueries({ queryKey: ['fixedops-wip'] });
      onClose();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center">
      <div className="bg-white rounded shadow-xl p-4 w-full max-w-md" data-testid="wip-elect-dialog">
        <p className="text-sm font-semibold mb-3">WIP mode election ceremony</p>
        <label className="text-xs font-medium text-gray-600">Mode</label>
        <select className={`${FILTER_CONTROL_CLASS} w-full mb-2`} value={mode} onChange={(e) => setMode(e.target.value as any)} data-testid="wip-elect-mode-select">
          <option value="WIP_MODE">WIP mode (labor accrues, relieved at close)</option>
          <option value="DIRECT_MODE">Direct mode (labor hits COS only at close)</option>
        </select>
        <label className="text-xs font-medium text-gray-600">Effective from</label>
        <input type="date" className={`${FILTER_CONTROL_CLASS} w-full mb-2`} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="wip-elect-effective-from" />
        <label className="text-xs font-medium text-gray-600">Impact preview notes</label>
        <textarea className={`${FILTER_CONTROL_CLASS} w-full mb-2 h-16`} value={preview} onChange={(e) => setPreview(e.target.value)} placeholder="Describe reviewed impact before approving" data-testid="wip-elect-preview-notes" />
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <Btn size="sm" variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" onClick={submit} loading={busy} data-testid="wip-elect-submit">Elect (prospective)</Btn>
        </div>
      </div>
    </div>
  );
}

export default function WipOpenRoReport() {
  const { entityId, entityLabel } = useEntityScope();
  const [storeId, setStoreId] = useState('');
  const [glWipBalance, setGlWipBalance] = useState('');
  const [showElect, setShowElect] = useState(false);

  const { data: history } = useQuery({
    queryKey: ['fixedops-wip-mode-history', entityId],
    queryFn: () => fixedopsApi.wipModeHistory(entityId ?? ''),
    enabled: !!entityId,
  });
  const activeMode = history?.items?.[0]?.mode ?? 'DIRECT_MODE';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fixedops-wip', entityId, storeId, glWipBalance],
    queryFn: () => fixedopsApi.wipReport({ legalEntityId: entityId ?? undefined, storeId: storeId || undefined, glWipBalance: glWipBalance || undefined }),
    enabled: !!entityId,
  });

  const unauthorized = (error as any)?.status === 401 || (error as any)?.status === 403;
  const rows = data?.rows ?? [];
  const tie = data?.tie;
  const tieMeta = tie ? TIE_LABEL[tie.status] : null;

  return (
    <ReportShell
      title="WIP Inquiry / Open-RO Report"
      description="Open repair orders with age, accumulated value, and pay-type mix. WIP-mode tie strip compares accrued labor value against the WIP GL account balance."
      scopeFields={[{ label: 'Legal entity', value: entityLabel ?? entityId ?? 'Not selected', muted: !entityId }]}
      actions={<Btn size="sm" onClick={() => setShowElect(true)} data-testid="wip-elect-open-button">Elect WIP mode</Btn>}
    >
      <Banner kind="info" testId="wip-mode-banner" title={`Active mode: ${activeMode.replace('_', ' ')}`}>
        {history?.items?.[0] && `Effective ${new Date(history.items[0].effectiveFrom).toLocaleDateString()}`}
      </Banner>

      <FilterBar>
        <FilterField label="Store" width={140}>
          <input className={FILTER_CONTROL_CLASS} value={storeId} onChange={(e) => setStoreId(e.target.value)} data-testid="wip-store-filter" />
        </FilterField>
        <FilterField label="GL WIP balance (manual, pending live GL inquiry)" width={260}>
          <input className={FILTER_CONTROL_CLASS} value={glWipBalance} onChange={(e) => setGlWipBalance(e.target.value)} placeholder="0.00" data-testid="wip-gl-balance-input" />
        </FilterField>
        <Btn size="sm" onClick={() => refetch()} data-testid="wip-refresh">Refresh</Btn>
      </FilterBar>

      {tie && (
        <div className="flex items-center gap-2 mb-3" data-testid="wip-tie-strip">
          <span className="text-xs text-gray-600">Report Σ:</span> <MoneyCell value={tie.reportTotal} />
          <span className="text-xs text-gray-600 ml-4">GL WIP:</span> {tie.glWipBalance !== null ? <MoneyCell value={tie.glWipBalance} /> : <span className="text-gray-400">not supplied</span>}
          {tieMeta && <Badge variant={tieMeta.variant} dot>{tieMeta.label}</Badge>}
        </div>
      )}

      {isLoading && <LoadingState testId="wip-loading" label="Loading open ROs…" />}
      {error && !unauthorized && <ErrorState testId="wip-error" message={(error as Error).message} onRetry={() => refetch()} />}
      {unauthorized && <UnauthorizedState testId="wip-unauthorized" message="You do not have permission to view WIP (fixedops.wip.view)." />}
      {!entityId && <EmptyState testId="wip-no-entity" title="Select a legal entity to view the WIP report." />}

      {!isLoading && !error && entityId && rows.length === 0 && (
        <EmptyState testId="wip-empty" title="No open repair orders" message="No ROs are currently open for this scope." />
      )}

      {!isLoading && !error && rows.length > 0 && (
        <FinancialTable testId="wip-table">
          <ReportThead>
            <tr>
              <ReportTh>RO#</ReportTh>
              <ReportTh>Store</ReportTh>
              <ReportTh>Status</ReportTh>
              <ReportTh align="right">Age (days)</ReportTh>
              <ReportTh align="right">Accumulated value</ReportTh>
              <ReportTh>Pay mix</ReportTh>
              <ReportTh>WIP mode</ReportTh>
            </tr>
          </ReportThead>
          <tbody>
            {rows.map((r) => (
              <ReportTr key={r.roNumber} testId={`wip-row-${r.roNumber}`}>
                <ReportTd><Link to={`/accounting/fixedops/ro/${encodeURIComponent(r.roNumber)}?storeId=${encodeURIComponent(r.storeId)}`} className="text-brand hover:underline font-mono">{r.roNumber}</Link></ReportTd>
                <ReportTd>{r.storeId}</ReportTd>
                <ReportTd>{r.status}</ReportTd>
                <ReportTd align="right">{r.ageDays}</ReportTd>
                <ReportTd align="right"><MoneyCell value={r.accumulatedValue} /></ReportTd>
                <ReportTd>{r.payTypeMix ?? '—'}</ReportTd>
                <ReportTd>{r.wipMode ?? '—'}</ReportTd>
              </ReportTr>
            ))}
          </tbody>
        </FinancialTable>
      )}

      {showElect && entityId && <ElectModeDialog legalEntityId={entityId} onClose={() => setShowElect(false)} />}
    </ReportShell>
  );
}
