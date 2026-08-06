// CE-11 S063 gap-closure — approved unapplied-time absorption labor-rate
// policy. Governed configuration of the effective-dated BURDENED labor-cost
// rate that converts unapplied/guarantee-shortfall hours into dollars —
// technician-specific, else department-default, no dealership-wide
// fallback. Never the customer labor selling rate, never hardcoded.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { fixedopsApi } from '../../../api/fixedopsApi';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd,
  Banner, EmptyState, ErrorState, LoadingState, UnauthorizedState,
} from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

const todayIso = () => new Date().toISOString().slice(0, 10);

function LaborRateForm({ legalEntityId, onSaved }: { legalEntityId: string; onSaved: () => void }) {
  const [scope, setScope] = useState<'TECHNICIAN' | 'DEPARTMENT'>('TECHNICIAN');
  const [subjectKey, setSubjectKey] = useState('');
  const [burdenedRate, setBurdenedRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!subjectKey.trim() || !burdenedRate.trim()) { setError('Subject and rate are required.'); return; }
    setBusy(true); setError(null);
    try {
      await fixedopsApi.setLaborRate({ legalEntityId, scope, subjectKey: subjectKey.trim(), burdenedRate, effectiveFrom });
      setSubjectKey(''); setBurdenedRate('');
      onSaved();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="border border-slate-200 rounded-md p-3 mt-3" data-testid="labor-rate-form">
      <p className="text-[13px] font-semibold text-slate-800 mb-2">Set a burdened labor-cost rate</p>
      <div className="flex items-end gap-3 flex-wrap">
        <FilterField label="Scope" width={160}>
          <select className={FILTER_CONTROL_CLASS} value={scope} onChange={(e) => setScope(e.target.value as any)} data-testid="labor-rate-scope">
            <option value="TECHNICIAN">Technician-specific</option>
            <option value="DEPARTMENT">Department-default</option>
          </select>
        </FilterField>
        <FilterField label={scope === 'TECHNICIAN' ? 'Technician ID' : 'Department code'} width={180}>
          <input className={FILTER_CONTROL_CLASS} value={subjectKey} onChange={(e) => setSubjectKey(e.target.value)} data-testid="labor-rate-subject-key" />
        </FilterField>
        <FilterField label="Burdened rate ($/hr)" width={140}>
          <input className={FILTER_CONTROL_CLASS} value={burdenedRate} onChange={(e) => setBurdenedRate(e.target.value)} placeholder="0.00" data-testid="labor-rate-amount" />
        </FilterField>
        <FilterField label="Effective from" width={140}>
          <input type="date" className={FILTER_CONTROL_CLASS} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="labor-rate-effective-from" />
        </FilterField>
        <Btn size="sm" onClick={submit} loading={busy} data-testid="labor-rate-submit">Set rate</Btn>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}

function GuaranteeConfigForm({ legalEntityId, onSaved }: { legalEntityId: string; onSaved: () => void }) {
  const [techId, setTechId] = useState('');
  const [guaranteedHoursPerPeriod, setHours] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!techId.trim() || !guaranteedHoursPerPeriod.trim()) { setError('Technician and guaranteed hours are required.'); return; }
    setBusy(true); setError(null);
    try {
      await fixedopsApi.setTechGuaranteeConfig({ legalEntityId, techId: techId.trim(), guaranteedHoursPerPeriod, effectiveFrom });
      setTechId(''); setHours('');
      onSaved();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="border border-slate-200 rounded-md p-3 mt-3" data-testid="guarantee-config-form">
      <p className="text-[13px] font-semibold text-slate-800 mb-2">Set a technician guaranteed-hours target</p>
      <div className="flex items-end gap-3 flex-wrap">
        <FilterField label="Technician ID" width={180}>
          <input className={FILTER_CONTROL_CLASS} value={techId} onChange={(e) => setTechId(e.target.value)} data-testid="guarantee-tech-id" />
        </FilterField>
        <FilterField label="Guaranteed hours / period" width={180}>
          <input className={FILTER_CONTROL_CLASS} value={guaranteedHoursPerPeriod} onChange={(e) => setHours(e.target.value)} placeholder="0.00" data-testid="guarantee-hours" />
        </FilterField>
        <FilterField label="Effective from" width={140}>
          <input type="date" className={FILTER_CONTROL_CLASS} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="guarantee-effective-from" />
        </FilterField>
        <Btn size="sm" onClick={submit} loading={busy} data-testid="guarantee-submit">Set guarantee</Btn>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}

export default function LaborRateConfig() {
  const { entityId, entityLabel } = useEntityScope();

  const rates = useQuery({
    queryKey: ['fixedops-labor-rate', entityId],
    queryFn: () => fixedopsApi.listLaborRates(entityId ?? ''),
    enabled: !!entityId,
  });
  const guarantees = useQuery({
    queryKey: ['fixedops-tech-guarantee-config', entityId],
    queryFn: () => fixedopsApi.listTechGuaranteeConfig(entityId ?? ''),
    enabled: !!entityId,
  });
  const qc = useQueryClient();

  const rateUnauthorized = (rates.error as any)?.status === 401 || (rates.error as any)?.status === 403;
  const rateRows = rates.data?.items ?? [];
  const guaranteeRows = guarantees.data?.items ?? [];

  return (
    <ReportShell
      title="Labor Rate Configuration"
      description="Governed, effective-dated burdened labor-cost rates and technician guaranteed-hours targets that feed the unapplied-time absorption computation. Resolution order is technician-specific, then department-default — never a dealership-wide fallback, never the customer labor selling rate."
      scopeFields={[{ label: 'Legal entity', value: entityLabel ?? entityId ?? 'Not selected', muted: !entityId }]}
    >
      <Banner kind="info" testId="labor-rate-policy-banner" title="Burdened labor-cost rate, not the customer selling rate">
        Rates set here feed only the unapplied-time / guarantee-shortfall absorption posting — they are entirely separate from the labor SALE rate charged on a repair order. A technician with no rate of their own inherits their department&rsquo;s default; a technician/department with no rate at all produces an explicit RATE_GAP refusal on absorption, never an estimated or zero rate.
      </Banner>

      {!entityId && <EmptyState testId="labor-rate-no-entity" title="Select a legal entity to configure labor rates." />}
      {rateUnauthorized && <UnauthorizedState testId="labor-rate-unauthorized" message="You do not have permission to view labor-rate configuration (fixedops.laborrate.view)." />}

      {entityId && !rateUnauthorized && (
        <>
          <LaborRateForm legalEntityId={entityId} onSaved={() => qc.invalidateQueries({ queryKey: ['fixedops-labor-rate', entityId] })} />

          {rates.isLoading && <LoadingState testId="labor-rate-loading" label="Loading labor rates…" />}
          {rates.error && !rateUnauthorized && <ErrorState testId="labor-rate-error" message={(rates.error as Error).message} onRetry={() => rates.refetch()} />}
          {!rates.isLoading && !rates.error && rateRows.length === 0 && (
            <EmptyState testId="labor-rate-empty" title="No labor rates configured" message="No technician-specific or department-default rates exist for this legal entity yet." />
          )}
          {!rates.isLoading && !rates.error && rateRows.length > 0 && (
            <FinancialTable testId="labor-rate-table">
              <ReportThead>
                <tr>
                  <ReportTh>Scope</ReportTh>
                  <ReportTh>Subject</ReportTh>
                  <ReportTh align="right">Burdened rate ($/hr)</ReportTh>
                  <ReportTh>Effective from</ReportTh>
                </tr>
              </ReportThead>
              <tbody>
                {rateRows.map((r) => (
                  <ReportTr key={r.id} testId={`labor-rate-row-${r.id}`}>
                    <ReportTd><Badge variant={r.scope === 'TECHNICIAN' ? 'success' : 'neutral'} dot>{r.scope}</Badge></ReportTd>
                    <ReportTd className="font-mono">{r.subjectKey}</ReportTd>
                    <ReportTd align="right" className="font-mono tabular-nums">{r.burdenedRate}</ReportTd>
                    <ReportTd>{r.effectiveFrom?.slice(0, 10)}</ReportTd>
                  </ReportTr>
                ))}
              </tbody>
            </FinancialTable>
          )}

          <GuaranteeConfigForm legalEntityId={entityId} onSaved={() => qc.invalidateQueries({ queryKey: ['fixedops-tech-guarantee-config', entityId] })} />

          {guarantees.isLoading && <LoadingState testId="guarantee-loading" label="Loading guarantee configuration…" />}
          {guarantees.error && <ErrorState testId="guarantee-error" message={(guarantees.error as Error).message} onRetry={() => guarantees.refetch()} />}
          {!guarantees.isLoading && !guarantees.error && guaranteeRows.length === 0 && (
            <EmptyState testId="guarantee-empty" title="No guaranteed-hours targets configured" />
          )}
          {!guarantees.isLoading && !guarantees.error && guaranteeRows.length > 0 && (
            <FinancialTable testId="guarantee-table">
              <ReportThead>
                <tr>
                  <ReportTh>Technician</ReportTh>
                  <ReportTh align="right">Guaranteed hours / period</ReportTh>
                  <ReportTh>Effective from</ReportTh>
                </tr>
              </ReportThead>
              <tbody>
                {guaranteeRows.map((g) => (
                  <ReportTr key={g.id} testId={`guarantee-row-${g.id}`}>
                    <ReportTd className="font-mono">{g.techId}</ReportTd>
                    <ReportTd align="right" className="font-mono tabular-nums">{g.guaranteedHoursPerPeriod}</ReportTd>
                    <ReportTd>{g.effectiveFrom?.slice(0, 10)}</ReportTd>
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
