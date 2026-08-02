// CE-11 S063 gap-closure — approved unapplied-time absorption labor-rate
// policy. Real absorption inquiry + action screen. RATE_GAP and
// ACCOUNT_MAPPING_PENDING are explicit, named unavailable states — never a
// silent retry, never a fabricated/estimated result.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { fixedopsApi, type TechTimeAbsorption } from '../../../api/fixedopsApi';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd,
  Banner, EmptyState, ErrorState, LoadingState, UnauthorizedState,
} from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

const todayIso = () => new Date().toISOString().slice(0, 10);

const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'neutral'> = {
  POSTED: 'success', EXCEPTION: 'danger',
};

function AbsorbForm({ legalEntityId, onPosted, onUnavailable }: {
  legalEntityId: string; onPosted: () => void;
  onUnavailable: (kind: 'RATE_GAP' | 'ACCOUNT_MAPPING_PENDING', message: string) => void;
}) {
  const [techId, setTechId] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [payrollPeriodId, setPayrollPeriodId] = useState('');
  const [clockedHours, setClockedHours] = useState('');
  const [flaggedAppliedHours, setFlaggedAppliedHours] = useState('');
  const [businessDate, setBusinessDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!techId.trim() || !deptCode.trim() || !payrollPeriodId.trim() || !clockedHours.trim() || !flaggedAppliedHours.trim()) {
      setError('Technician, department, period, and both hour fields are required.'); return;
    }
    setBusy(true); setError(null);
    try {
      await fixedopsApi.absorbTechTime({
        legalEntityId, techId: techId.trim(), deptCode: deptCode.trim(), payrollPeriodId: payrollPeriodId.trim(),
        clockedHours, flaggedAppliedHours, businessDate,
        sourceEventId: crypto.randomUUID(), correlationId: crypto.randomUUID(),
      });
      setTechId(''); setDeptCode(''); setPayrollPeriodId(''); setClockedHours(''); setFlaggedAppliedHours('');
      onPosted();
    } catch (err: any) {
      if (err.body?.error === 'RATE_GAP') onUnavailable('RATE_GAP', err.message);
      else if (err.body?.error === 'ACCOUNT_MAPPING_PENDING') onUnavailable('ACCOUNT_MAPPING_PENDING', err.message);
      else setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="border border-slate-200 rounded-md p-3 mt-3" data-testid="tech-time-absorb-form">
      <p className="text-[13px] font-semibold text-slate-800 mb-2">Absorb period-boundary time</p>
      <div className="flex items-end gap-3 flex-wrap">
        <FilterField label="Technician ID" width={150}>
          <input className={FILTER_CONTROL_CLASS} value={techId} onChange={(e) => setTechId(e.target.value)} data-testid="absorb-tech-id" />
        </FilterField>
        <FilterField label="Department code" width={140}>
          <input className={FILTER_CONTROL_CLASS} value={deptCode} onChange={(e) => setDeptCode(e.target.value)} data-testid="absorb-dept-code" />
        </FilterField>
        <FilterField label="Payroll period" width={160}>
          <input className={FILTER_CONTROL_CLASS} value={payrollPeriodId} onChange={(e) => setPayrollPeriodId(e.target.value)} data-testid="absorb-payroll-period" />
        </FilterField>
        <FilterField label="Clocked hours" width={120}>
          <input className={FILTER_CONTROL_CLASS} value={clockedHours} onChange={(e) => setClockedHours(e.target.value)} data-testid="absorb-clocked-hours" />
        </FilterField>
        <FilterField label="Flagged applied hours" width={140}>
          <input className={FILTER_CONTROL_CLASS} value={flaggedAppliedHours} onChange={(e) => setFlaggedAppliedHours(e.target.value)} data-testid="absorb-flagged-hours" />
        </FilterField>
        <FilterField label="Business date" width={140}>
          <input type="date" className={FILTER_CONTROL_CLASS} value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} data-testid="absorb-business-date" />
        </FilterField>
        <Btn size="sm" onClick={submit} loading={busy} data-testid="absorb-submit">Absorb time</Btn>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}

function ReverseButton({ legalEntityId, row, onReversed }: { legalEntityId: string; row: TechTimeAbsorption; onReversed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reverse() {
    setBusy(true); setError(null);
    try {
      await fixedopsApi.reverseTechTime({
        legalEntityId, techId: row.techId, payrollPeriodId: row.payrollPeriodId,
        sourceEventId: crypto.randomUUID(), correlationId: crypto.randomUUID(),
      });
      onReversed();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-2">
      <Btn size="sm" variant="secondary" onClick={reverse} loading={busy} data-testid={`reverse-${row.id}`}>Reverse</Btn>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

export default function TechTimeAbsorption() {
  const { entityId, entityLabel } = useEntityScope();
  const [techIdFilter, setTechIdFilter] = useState('');
  const [unavailable, setUnavailable] = useState<{ kind: 'RATE_GAP' | 'ACCOUNT_MAPPING_PENDING'; message: string } | null>(null);
  const qc = useQueryClient();

  const absorptions = useQuery({
    queryKey: ['fixedops-tech-time', entityId, techIdFilter],
    queryFn: () => fixedopsApi.listTechTimeAbsorptions({ legalEntityId: entityId ?? '', techId: techIdFilter || undefined }),
    enabled: !!entityId,
  });

  const unauthorized = (absorptions.error as any)?.status === 401 || (absorptions.error as any)?.status === 403;
  const rows = absorptions.data?.items ?? [];

  function refetchAll() {
    qc.invalidateQueries({ queryKey: ['fixedops-tech-time', entityId] });
  }

  return (
    <ReportShell
      title="Unapplied Time Absorption"
      description="Period-boundary absorption of unapplied and guarantee-shortfall technician hours, converted to dollars via the governed burdened labor-cost rate (see Labor Rate Configuration)."
      scopeFields={[{ label: 'Legal entity', value: entityLabel ?? entityId ?? 'Not selected', muted: !entityId }]}
    >
      {!entityId && <EmptyState testId="tech-time-no-entity" title="Select a legal entity to view or absorb time." />}
      {unauthorized && <UnauthorizedState testId="tech-time-unauthorized" message="You do not have permission to view unapplied-time absorption (fixedops.techtime.view)." />}

      {entityId && !unauthorized && (
        <>
          <AbsorbForm
            legalEntityId={entityId}
            onPosted={() => { setUnavailable(null); refetchAll(); }}
            onUnavailable={(kind, message) => setUnavailable({ kind, message })}
          />

          {unavailable?.kind === 'RATE_GAP' && (
            <ErrorState
              testId="tech-time-rate-gap"
              message={`Labor rate unavailable — ${unavailable.message}`}
              onRetry={() => setUnavailable(null)}
            />
          )}
          {unavailable?.kind === 'ACCOUNT_MAPPING_PENDING' && (
            <ErrorState
              testId="tech-time-mapping-pending"
              message={`Account mapping unresolved — ${unavailable.message}`}
              onRetry={() => setUnavailable(null)}
            />
          )}

          <FilterBar>
            <FilterField label="Technician ID" width={180}>
              <input className={FILTER_CONTROL_CLASS} value={techIdFilter} onChange={(e) => setTechIdFilter(e.target.value)} data-testid="tech-time-tech-filter" />
            </FilterField>
            <Btn size="sm" variant="secondary" onClick={() => absorptions.refetch()} data-testid="tech-time-refresh">Refresh</Btn>
          </FilterBar>

          {absorptions.isLoading && <LoadingState testId="tech-time-loading" label="Loading absorption history…" />}
          {absorptions.error && !unauthorized && <ErrorState testId="tech-time-error" message={(absorptions.error as Error).message} onRetry={() => absorptions.refetch()} />}
          {!absorptions.isLoading && !absorptions.error && rows.length === 0 && (
            <EmptyState testId="tech-time-empty" title="No absorption runs yet" message="Absorb time for a technician above, or adjust the filter." />
          )}

          {!absorptions.isLoading && !absorptions.error && rows.length > 0 && (
            <FinancialTable testId="tech-time-table">
              <ReportThead>
                <tr>
                  <ReportTh>Technician</ReportTh>
                  <ReportTh>Period</ReportTh>
                  <ReportTh align="right">Unapplied hrs</ReportTh>
                  <ReportTh align="right">Shortfall hrs</ReportTh>
                  <ReportTh>Rate source</ReportTh>
                  <ReportTh align="right">Rate ($/hr)</ReportTh>
                  <ReportTh align="right">Unapplied $</ReportTh>
                  <ReportTh align="right">Shortfall $</ReportTh>
                  <ReportTh>Status</ReportTh>
                  <ReportTh>Journal</ReportTh>
                  <ReportTh>Actions</ReportTh>
                </tr>
              </ReportThead>
              <tbody>
                {rows.map((r) => (
                  <ReportTr key={r.id} testId={`tech-time-row-${r.id}`}>
                    <ReportTd className="font-mono">{r.techId}</ReportTd>
                    <ReportTd>{r.payrollPeriodId}</ReportTd>
                    <ReportTd align="right" className="font-mono tabular-nums">{r.unappliedHours}</ReportTd>
                    <ReportTd align="right" className="font-mono tabular-nums">{r.shortfallHours}</ReportTd>
                    <ReportTd>{r.rateSource ? <Badge variant={r.rateSource === 'TECHNICIAN' ? 'success' : 'neutral'} dot>{r.rateSource}</Badge> : '—'}</ReportTd>
                    <ReportTd align="right" className="font-mono tabular-nums">{r.rateAmount ?? '—'}</ReportTd>
                    <ReportTd align="right" className="font-mono tabular-nums">{r.unappliedAmount ?? '—'}</ReportTd>
                    <ReportTd align="right" className="font-mono tabular-nums">{r.shortfallAmount ?? '—'}</ReportTd>
                    <ReportTd><Badge variant={STATUS_VARIANT[r.status] ?? 'neutral'} dot>{r.status}</Badge></ReportTd>
                    <ReportTd className="font-mono text-xs">{r.journalEntryId ?? '—'}</ReportTd>
                    <ReportTd>{r.status === 'POSTED' && <ReverseButton legalEntityId={entityId} row={r} onReversed={refetchAll} />}</ReportTd>
                  </ReportTr>
                ))}
              </tbody>
            </FinancialTable>
          )}
        </>
      )}
    </ReportShell>
  );
}
