import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { partsApi, type PartsMovement } from '../../../api/partsApi';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd,
  EmptyState, ErrorState, LoadingState, UnauthorizedState,
} from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

// "ADJUSTMENT" is deliberately excluded — adjustment movements can only be
// created via the real S069 physical-inventory ceremony (see Parts
// Physical Inventory Adjustment screen), never posted through this generic
// movements endpoint, so no row here will ever carry that family.
const FAMILIES = ['RECEIPT', 'RO_ISSUE', 'COUNTER_SALE', 'RETURN_TO_STOCK', 'RETURN_TO_VENDOR', 'INTERNAL_ISSUE'];

// CE-11 / S066 — Parts Movement Accounting Inquiry. Every posted movement by
// family/part/store/date, journal + rule-pack-version linkage per row, and a
// visually loud negative-on-hand badge (D-CE11-02: allow + flag, never
// silent, never hard-blocked). Permission: parts.movement.view.
export default function PartsMovements() {
  const { entityId: contextEntityId, entityLabel, storeId } = useEntityScope();
  const [searchParams] = useSearchParams();
  const [family, setFamily] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [negativeOnly, setNegativeOnly] = useState(searchParams.get('movementId') ? false : false);
  const [movements, setMovements] = useState<PartsMovement[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function search() {
    setBusy(true); setError(null); setUnauthorized(null); setSearched(true);
    try {
      const res = await partsApi.listMovements({
        legalEntityId: contextEntityId ?? undefined, storeId: storeId ?? undefined,
        partNumber: partNumber || undefined, movementFamily: family || undefined,
        negativeOnHandFlag: negativeOnly ? 'true' : undefined,
      });
      setMovements(res.items);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
      else setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <ReportShell
      title="Parts Movement Accounting Inquiry"
      description="Every posted parts movement — receipt, issue, sale, return, adjustment — with journal linkage and negative-on-hand exception visibility."
      scopeFields={[
        { label: 'Legal entity', value: entityLabel ?? contextEntityId ?? 'All entities', muted: !contextEntityId },
        { label: 'Store', value: storeId ?? 'All stores', muted: !storeId },
      ]}
    >
      <FilterBar>
        <FilterField label="Family" width={160}>
          <select className={FILTER_CONTROL_CLASS} value={family} onChange={(e) => setFamily(e.target.value)} data-testid="parts-movements-family">
            <option value="">All</option>
            {FAMILIES.map((f) => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
          </select>
        </FilterField>
        <FilterField label="Part #" width={140}>
          <input className={FILTER_CONTROL_CLASS} value={partNumber} onChange={(e) => setPartNumber(e.target.value)} data-testid="parts-movements-part" />
        </FilterField>
        <FilterField label="Negative on-hand only" width={160}>
          <label className="flex items-center gap-1.5 h-8 text-xs">
            <input type="checkbox" checked={negativeOnly} onChange={(e) => setNegativeOnly(e.target.checked)} data-testid="parts-movements-negative-filter" />
            Show exceptions only
          </label>
        </FilterField>
        <Btn size="sm" onClick={search} disabled={busy} loading={busy} data-testid="parts-movements-search">
          {busy ? 'Searching…' : 'Search'}
        </Btn>
      </FilterBar>

      {error && <ErrorState testId="parts-movements-error" message={error} onRetry={search} />}
      {unauthorized && <UnauthorizedState testId="parts-movements-unauthorized" message={unauthorized} />}
      {busy && <LoadingState testId="parts-movements-loading" label="Loading movements…" />}

      {!busy && searched && movements.length === 0 && !error && !unauthorized && (
        <EmptyState testId="parts-movements-empty" title="No movements match this filter" />
      )}
      {!searched && !busy && (
        <EmptyState testId="parts-movements-initial" title="Enter filters and search." />
      )}

      {!busy && movements.length > 0 && (
        <FinancialTable testId="parts-movements-table">
          <ReportThead>
            <tr>
              <ReportTh>Business date</ReportTh>
              <ReportTh>Part</ReportTh>
              <ReportTh>Family</ReportTh>
              <ReportTh align="right">Qty</ReportTh>
              <ReportTh align="right">Value</ReportTh>
              <ReportTh>Journal #</ReportTh>
              <ReportTh>Status</ReportTh>
              <ReportTh>Exception</ReportTh>
            </tr>
          </ReportThead>
          <tbody>
            {movements.map((m) => (
              <ReportTr key={m.id} testId={`parts-movement-row-${m.movementId}`}>
                <ReportTd>{m.businessDate?.slice(0, 10)}</ReportTd>
                <ReportTd className="font-mono">{m.partNumber}</ReportTd>
                <ReportTd>{m.movementFamily.replace(/_/g, ' ')}</ReportTd>
                <ReportTd align="right" className="font-mono tabular-nums">{m.quantity}</ReportTd>
                <ReportTd align="right" className="font-mono tabular-nums">{m.totalValue}</ReportTd>
                <ReportTd className="font-mono">{m.journalNumber ?? '—'}</ReportTd>
                <ReportTd><Badge variant={m.status === 'POSTED' ? 'success' : m.status === 'EXCEPTION' ? 'danger' : 'warning'} dot>{m.status}</Badge></ReportTd>
                <ReportTd>
                  {m.negativeOnHandFlag ? (
                    <Badge variant="danger" dot data-testid={`parts-movement-negative-badge-${m.movementId}`}>NEGATIVE ON-HAND</Badge>
                  ) : '—'}
                </ReportTd>
              </ReportTr>
            ))}
          </tbody>
        </FinancialTable>
      )}
    </ReportShell>
  );
}
