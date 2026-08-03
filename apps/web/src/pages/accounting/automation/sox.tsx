/**
 * CE-17 S128 SOX Evidence Automation.
 *
 * Two authority levels live on this page:
 * - Harvesting: PREPARE_DRAFT. The automation assembles evidence binders from
 *   deterministic queries against the control's system mapping. Harvesting
 *   gathers evidence — it never asserts that a control was effective.
 * - Attestation: EXECUTE_WITH_APPROVAL. Attestation is always a human act.
 *   Only an attester says whether a control was effective; the system only
 *   surfaces the evidence.
 *
 * Separation of duties: the person who assembles a binder must not be the
 * person who attests it.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, Empty, StateBadge,
  dateTime, useLegalEntityFromQuery,
} from './shared';

const BINDER_STATES = ['ASSEMBLING', 'COMPLETE', 'EXCEPTION', 'ATTESTED'];
const CONTROL_TYPES = ['SOD', 'APPROVAL_CEREMONY', 'TIE_OUT', 'CLOSE_SIGN_OFF', 'RLS_ATTESTATION'];

export default function AutomationSox() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;

  const [controlTypeFilter, setControlTypeFilter] = useState('');
  const [binderStateFilter, setBinderStateFilter] = useState('');
  const [binderYearFilter, setBinderYearFilter] = useState('');
  const [binderMonthFilter, setBinderMonthFilter] = useState('');
  const [selectedBinderId, setSelectedBinderId] = useState<string | null>(null);

  // Register control form
  const [showRegister, setShowRegister] = useState(false);
  const [regCode, setRegCode] = useState('');
  const [regName, setRegName] = useState('');
  const [regType, setRegType] = useState<string>('SOD');
  const [regEvidenceQuery, setRegEvidenceQuery] = useState('');

  // Harvest binder form
  const [showHarvest, setShowHarvest] = useState(false);
  const [harvestControlId, setHarvestControlId] = useState('');
  const [harvestLegalEntity, setHarvestLegalEntity] = useState(legalEntityId ?? '');
  const [harvestYear, setHarvestYear] = useState(String(new Date().getFullYear()));
  const [harvestMonth, setHarvestMonth] = useState(String(new Date().getMonth() + 1));

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const controls = useQuery({
    queryKey: ['automation', 'sox-controls', controlTypeFilter],
    queryFn: () => automationApi.listControls({
      legalEntityId,
      controlType: controlTypeFilter || undefined,
    }),
    retry: false,
  });

  const binders = useQuery({
    queryKey: ['automation', 'sox-binders', legalEntityId, binderStateFilter, binderYearFilter, binderMonthFilter],
    queryFn: () => automationApi.listBinders({
      legalEntityId,
      state: binderStateFilter || undefined,
      periodYear: binderYearFilter ? Number(binderYearFilter) : undefined,
      periodMonth: binderMonthFilter ? Number(binderMonthFilter) : undefined,
    }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const binderDetail = useQuery({
    queryKey: ['automation', 'sox-binder', selectedBinderId],
    queryFn: () => automationApi.getBinder(selectedBinderId as string),
    enabled: Boolean(selectedBinderId),
    retry: false,
  });

  const register = useMutation({
    mutationFn: () => automationApi.registerControl({
      controlCode: regCode,
      controlName: regName,
      controlType: regType,
      evidenceQuery: regEvidenceQuery || undefined,
      legalEntityId,
    }),
    onSuccess: () => { setShowRegister(false); invalidate(); },
  });

  const harvest = useMutation({
    mutationFn: () => automationApi.harvestBinder({
      controlId: harvestControlId,
      legalEntityId: harvestLegalEntity,
      periodYear: Number(harvestYear),
      periodMonth: Number(harvestMonth),
    }),
    onSuccess: () => { setShowHarvest(false); invalidate(); },
  });

  const attest = useMutation({
    mutationFn: (id: string) => automationApi.attestBinder(id, {}),
    onSuccess: invalidate,
  });

  const controlRows: any[] = controls.data?.items ?? [];
  const binderRows: any[] = binders.data?.items ?? [];
  const binder: any = binderDetail.data ?? null;
  const evidenceRecords: any[] = binder?.evidenceRecords ?? [];
  const missingFlags: any[] = binder?.missingEvidenceFlags ?? [];

  return (
    <AutomationPage
      title="SOX Evidence Automation"
      story="S128"
      subtitle="Harvesting gathers evidence (PREPARE_DRAFT). Attestation is always a human act (EXECUTE_WITH_APPROVAL)."
      testId="automation-sox"
      permission="automation.read"
      capabilityCode="S128_SOX_EVIDENCE"
      loading={controls.isLoading || binders.isLoading}
      error={controls.error ?? binders.error}
      retry={() => { controls.refetch(); binders.refetch(); }}
      actions={
        <div className="flex gap-2">
          <Btn variant="secondary" size="md" data-testid="register-control-btn" onClick={() => setShowRegister((v) => !v)}>
            Register control
          </Btn>
          <Btn variant="primary" size="md" data-testid="harvest-binder-btn" onClick={() => setShowHarvest((v) => !v)}>
            Harvest binder
          </Btn>
        </div>
      }
    >
      {/* Authority notices */}
      <div className="mb-4 space-y-2">
        <div
          data-testid="sox-harvest-notice"
          className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-900"
        >
          <strong>Harvesting: PREPARE_DRAFT.</strong> The automation runs deterministic queries against each
          control's configured system mapping and assembles the results into a binder.{' '}
          <strong>Harvesting gathers evidence and never asserts that a control was effective.</strong> Only an
          attester makes that assertion.
        </div>
        <div
          data-testid="sox-attest-notice"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"
        >
          <strong>Attestation: EXECUTE_WITH_APPROVAL — always a human act.</strong> The person who assembled the
          binder must not be the person who attests it (separation of duties). Attestation records the attester's
          conclusion on the evidence; the system records who attested and when, but the judgment is theirs alone.
        </div>
      </div>

      {showRegister && (
        <Card title="Register a control" testId="register-control-panel">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <label className="text-[12px] text-slate-600">
              Control code
              <input
                data-testid="reg-code"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={regCode}
                onChange={(e) => setRegCode(e.target.value)}
                placeholder="e.g. SOD-001"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Control name
              <input
                data-testid="reg-name"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Human-readable name"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Control type
              <select
                data-testid="reg-type"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={regType}
                onChange={(e) => setRegType(e.target.value)}
              >
                {CONTROL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              Evidence query (optional)
              <input
                data-testid="reg-evidence-query"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={regEvidenceQuery}
                onChange={(e) => setRegEvidenceQuery(e.target.value)}
                placeholder="Deterministic query definition"
              />
            </label>
          </div>
          <Btn
            variant="primary"
            size="md"
            data-testid="register-control-confirm"
            disabled={!regCode.trim() || !regName.trim() || register.isPending}
            onClick={() => register.mutate()}
          >
            {register.isPending ? 'Registering…' : 'Register control'}
          </Btn>
          <MutationError error={register.error} testId="register-control-error" />
        </Card>
      )}

      {showHarvest && (
        <Card title="Harvest an evidence binder" testId="harvest-binder-panel">
          <p className="text-[12.5px] text-slate-600 mb-3">
            Harvesting runs the control's evidence query and assembles the results into an immutable binder. The binder
            is in state ASSEMBLING until the harvest completes, then COMPLETE or EXCEPTION. It does not assert
            effectiveness — only an attester does that.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <label className="text-[12px] text-slate-600">
              Control ID
              <input
                data-testid="harvest-control-id"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={harvestControlId}
                onChange={(e) => setHarvestControlId(e.target.value)}
                placeholder="Control registry ID"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Legal entity ID
              <input
                data-testid="harvest-legal-entity"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={harvestLegalEntity}
                onChange={(e) => setHarvestLegalEntity(e.target.value)}
                placeholder="e.g. LE-001"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Period year
              <input
                data-testid="harvest-year"
                type="number"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={harvestYear}
                onChange={(e) => setHarvestYear(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Period month
              <input
                data-testid="harvest-month"
                type="number"
                min={1}
                max={12}
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={harvestMonth}
                onChange={(e) => setHarvestMonth(e.target.value)}
              />
            </label>
          </div>
          <Btn
            variant="primary"
            size="md"
            data-testid="harvest-binder-confirm"
            disabled={!harvestControlId.trim() || !harvestLegalEntity.trim() || harvest.isPending}
            onClick={() => harvest.mutate()}
          >
            {harvest.isPending ? 'Harvesting…' : 'Harvest binder'}
          </Btn>
          <MutationError error={harvest.error} testId="harvest-binder-error" />
        </Card>
      )}

      {/* Control register */}
      <Card
        title="Control register"
        testId="sox-controls-card"
        actions={
          <select
            data-testid="control-type-filter"
            className="border border-slate-300 rounded px-2 py-1 text-[13px]"
            value={controlTypeFilter}
            onChange={(e) => setControlTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {CONTROL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        }
      >
        {controlRows.length === 0 ? (
          <Empty
            testId="sox-controls-empty"
            title="No controls registered"
            message="No controls are registered for this legal entity and type filter. Register controls before harvesting evidence binders."
          />
        ) : (
          <Table
            headers={['Code', 'Name', 'Type', 'Evidence query', 'Active', 'Created']}
            testId="sox-controls-table"
          >
            {controlRows.map((c: any) => (
              <tr key={c.id} data-testid={`control-row-${c.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`control-code-${c.id}`}>{c.controlCode}</td>
                <td className="py-2 pr-4 text-[13px]" data-testid={`control-name-${c.id}`}>{c.controlName}</td>
                <td className="py-2 pr-4">
                  <Badge variant="info" data-testid={`control-type-${c.id}`}>{c.controlType}</Badge>
                </td>
                <td className="py-2 pr-4 font-mono text-[11px] text-slate-500 max-w-xs truncate" data-testid={`control-query-${c.id}`}>
                  {c.evidenceQuery ?? '—'}
                </td>
                <td className="py-2 pr-4">
                  <Badge variant={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge>
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(c.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Evidence binders */}
      <Card
        title="Evidence binders"
        testId="sox-binders-card"
        actions={
          <div className="flex gap-2">
            <select
              data-testid="binder-state-filter"
              className="border border-slate-300 rounded px-2 py-1 text-[13px]"
              value={binderStateFilter}
              onChange={(e) => setBinderStateFilter(e.target.value)}
            >
              <option value="">All states</option>
              {BINDER_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              data-testid="binder-year-filter"
              type="number"
              placeholder="Year"
              className="w-20 border border-slate-300 rounded px-2 py-1 text-[13px]"
              value={binderYearFilter}
              onChange={(e) => setBinderYearFilter(e.target.value)}
            />
            <input
              data-testid="binder-month-filter"
              type="number"
              placeholder="Mo"
              min={1}
              max={12}
              className="w-16 border border-slate-300 rounded px-2 py-1 text-[13px]"
              value={binderMonthFilter}
              onChange={(e) => setBinderMonthFilter(e.target.value)}
            />
          </div>
        }
      >
        {binderRows.length === 0 ? (
          <Empty
            testId="sox-binders-empty"
            title="No evidence binders for these filters"
            message="No binders match the current period, state, and legal entity filters. Harvest a binder to begin collecting evidence for a registered control."
          />
        ) : (
          <Table
            headers={['Control', 'Legal entity', 'Period', 'State', 'Evidence items', 'Assembled by', 'Attested by', 'Attested at', '']}
            testId="sox-binders-table"
          >
            {binderRows.map((b: any) => (
              <tr key={b.id} data-testid={`binder-row-${b.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`binder-control-${b.id}`}>
                  {b.control?.controlCode ?? b.controlId}
                </td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`binder-entity-${b.id}`}>{b.legalEntityId}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`binder-period-${b.id}`}>
                  {b.periodYear}-{String(b.periodMonth).padStart(2, '0')}
                </td>
                <td className="py-2 pr-4">
                  <StateBadge state={b.state} testId={`binder-state-${b.id}`} />
                </td>
                <td className="py-2 pr-4 text-[12px] tabular-nums" data-testid={`binder-evidence-count-${b.id}`}>
                  {Array.isArray(b.evidenceRecords) ? b.evidenceRecords.length : '—'}
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-600" data-testid={`binder-assembled-by-${b.id}`}>
                  {b.assembledBy ?? '—'}
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-600" data-testid={`binder-attested-by-${b.id}`}>
                  {b.attestedBy ?? '—'}
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-500" data-testid={`binder-attested-at-${b.id}`}>
                  {dateTime(b.attestedAt)}
                </td>
                <td className="py-2 pr-4">
                  <Btn
                    variant="secondary"
                    size="sm"
                    data-testid={`inspect-binder-${b.id}`}
                    onClick={() => setSelectedBinderId(b.id)}
                  >
                    Open
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {binder && (
        <>
          <Card
            title="Binder"
            testId="binder-detail"
            actions={<StateBadge state={binder.state} testId="binder-detail-state" />}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 mb-4">
              <KeyValue label="Control ID" value={binder.controlId} testId="binder-detail-control" />
              <KeyValue label="Legal entity" value={binder.legalEntityId} testId="binder-detail-entity" />
              <KeyValue
                label="Period"
                value={`${binder.periodYear}-${String(binder.periodMonth).padStart(2, '0')}`}
                testId="binder-detail-period"
              />
              <KeyValue label="Binder hash" value={binder.binderHash ?? '—'} testId="binder-detail-hash" />
              <KeyValue label="Assembled by" value={binder.assembledBy ?? '—'} testId="binder-detail-assembled-by" />
              <KeyValue label="Attested by" value={binder.attestedBy ?? '—'} testId="binder-detail-attested-by" />
              <KeyValue label="Attested at" value={dateTime(binder.attestedAt)} testId="binder-detail-attested-at" />
              <KeyValue label="Retention class" value={binder.s017ClassRef ?? '—'} testId="binder-detail-retention" />
            </div>

            {missingFlags.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3" data-testid="binder-missing-flags">
                <p className="text-[12.5px] text-amber-900 font-semibold mb-1">Missing evidence flags</p>
                <ul className="list-disc list-inside space-y-1">
                  {missingFlags.map((f: any, i: number) => (
                    <li key={i} className="text-[12px] text-amber-800" data-testid={`missing-flag-${i}`}>
                      {typeof f === 'string' ? f : JSON.stringify(f)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Btn
                variant="primary"
                size="md"
                data-testid="attest-binder-btn"
                disabled={
                  attest.isPending ||
                  binder.state === 'ATTESTED' ||
                  binder.state === 'ASSEMBLING'
                }
                onClick={() => attest.mutate(binder.id)}
              >
                {attest.isPending ? 'Attesting…' : 'Attest binder (human act)'}
              </Btn>
            </div>
            <p className="mt-2 text-[11.5px] text-slate-500" data-testid="attest-notice">
              Attestation is always a human act. The attester's identity is recorded and must differ from the
              person who assembled the binder (separation of duties). Attesting states that the attester has
              reviewed the evidence — not that the system verified control effectiveness.
            </p>
            <MutationError error={attest.error} testId="attest-binder-error" />
          </Card>

          {/* Evidence records */}
          <Card title="Evidence records" testId="binder-evidence-card">
            <p className="text-[12.5px] text-slate-600 mb-3" data-testid="evidence-immutable-notice">
              Evidence records are immutable once the binder is sealed. They represent what the system observed at
              harvest time. They do not constitute an opinion on control effectiveness.
            </p>
            {evidenceRecords.length === 0 ? (
              <Empty
                testId="binder-evidence-empty"
                title="No evidence records in this binder"
                message="The binder contains no evidence records. This may indicate the harvest is still running, that the control's evidence query returned nothing, or that an exception occurred during harvesting."
              />
            ) : (
              <Table headers={['#', 'Source', 'Ref', 'Recorded at', 'Detail']} testId="binder-evidence-table">
                {evidenceRecords.map((e: any, i: number) => (
                  <tr key={i} data-testid={`evidence-row-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 text-[12px] text-slate-500">{i + 1}</td>
                    <td className="py-2 pr-4 text-[12px]" data-testid={`evidence-source-${i}`}>{e.source ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[11px]" data-testid={`evidence-ref-${i}`}>{e.ref ?? e.id ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px] text-slate-500" data-testid={`evidence-at-${i}`}>
                      {dateTime(e.recordedAt ?? e.at)}
                    </td>
                    <td className="py-2 pr-4 text-[12px] text-slate-600 max-w-xs truncate">
                      {e.detail ?? '—'}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </AutomationPage>
  );
}
