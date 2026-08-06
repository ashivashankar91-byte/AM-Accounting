/**
 * CE-17 S091B — experience-rated chargeback model.
 *
 * Two structural facts govern everything on this screen:
 *
 * 1. The ceiling is RECOMMEND. This capability has no posting client and no
 *    execution path. It cannot and will never produce a journal entry on its
 *    own. A model output is a recommendation about a *rate*, nothing more.
 *
 * 2. Adopting a recommended rate requires an explicit adoption ceremony
 *    performed by a person. Adoption records which S091 configuration version
 *    the rate entered so there is an unambiguous audit link from the rate to
 *    its effect. An unadopted recommendation is not in effect, and this screen
 *    never presents it as though it were.
 *
 * A drift-flagged output warns that the sample is thin or fragmented and
 * requires explicit acknowledgement before it can be adopted.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, StateBadge, Empty, money, dateTime,
} from './shared';

export default function AutomationChargeback() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const [stateFilter, setStateFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRunForm, setShowRunForm] = useState(false);
  const [showAdoptForm, setShowAdoptForm] = useState(false);

  // Run model form
  const [modelVersion, setModelVersion] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [flatRateComparison, setFlatRateComparison] = useState('');
  const [runActor, setRunActor] = useState('');

  // Adopt form
  const [adoptedBy, setAdoptedBy] = useState('');
  const [s091ConfigVersion, setS091ConfigVersion] = useState('');
  const [acknowledgeDrift, setAcknowledgeDrift] = useState(false);

  const list = useQuery({
    queryKey: ['automation', 'chargeback', 'models', stateFilter],
    queryFn: () => automationApi.listChargebackModels(stateFilter ? { state: stateFilter } : {}),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'chargeback', 'model', selectedId],
    queryFn: () => automationApi.getChargebackModel(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const runModel = useMutation({
    mutationFn: (data: any) => automationApi.runChargebackModel(data),
    onSuccess: () => {
      setShowRunForm(false);
      setModelVersion(''); setWindowStart(''); setWindowEnd('');
      setFlatRateComparison(''); setRunActor('');
      invalidate();
    },
  });

  const adoptModel = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => automationApi.adoptChargebackModel(id, data),
    onSuccess: () => {
      setShowAdoptForm(false);
      setAdoptedBy(''); setS091ConfigVersion(''); setAcknowledgeDrift(false);
      invalidate();
    },
  });

  const rows: any[] = list.data?.items ?? [];
  const item: any = detail.data ?? null;
  const fitDiag: any = item?.fitDiagnostics ?? {};
  const cohortData: any[] = item?.cohortData ?? [];

  return (
    <AutomationPage
      title="Chargeback Model"
      story="S091B"
      subtitle="Recommend only — adopting a rate requires a person, always"
      testId="automation-chargeback"
      permission="automation.read"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="secondary" size="md" data-testid="run-model-toggle" onClick={() => setShowRunForm((v) => !v)}>
          {showRunForm ? 'Cancel' : 'Run model'}
        </Btn>
      }
    >
      <Card title="Authority ceiling: RECOMMEND — this capability cannot execute, ever" testId="chargeback-authority-notice">
        <p className="text-[12.5px] text-slate-600 leading-relaxed">
          The experience-rated chargeback model has a structural ceiling of <strong>RECOMMEND</strong>. It has no
          posting client and no execution path. Every output on this screen is a recommendation about a rate; none of
          them are in effect until a person performs the adoption ceremony below and records the target S091
          configuration version. An unadopted recommendation changes nothing. An ADOPTED output becomes current; prior
          ADOPTED outputs are moved to SUPERSEDED automatically.
        </p>
      </Card>

      {showRunForm && (
        <Card title="Run chargeback model" testId="run-model-form">
          <p className="text-[12.5px] text-slate-600 mb-3">
            The model computes an experience-rated chargeback ratio from the deal cohorts in the training window. It
            stores fit diagnostics alongside the recommended rate so the reader can evaluate sample adequacy. A thin
            sample (fewer than 30 deals or fewer than 2 cohorts) will be drift-flagged.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <label className="text-[12px] text-slate-600">
              Model version tag *
              <input
                data-testid="run-model-version"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={modelVersion}
                onChange={(e) => setModelVersion(e.target.value)}
                placeholder="cb-model-2024-q4"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Actor (who is running the model) *
              <input
                data-testid="run-actor"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={runActor}
                onChange={(e) => setRunActor(e.target.value)}
                placeholder="analyst@dealership.com"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Training window start *
              <input
                data-testid="run-window-start"
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={windowStart}
                onChange={(e) => setWindowStart(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Training window end *
              <input
                data-testid="run-window-end"
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={windowEnd}
                onChange={(e) => setWindowEnd(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-slate-600 md:col-span-2">
              Flat rate comparison (optional — shown alongside the recommended rate)
              <input
                data-testid="run-flat-rate"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={flatRateComparison}
                onChange={(e) => setFlatRateComparison(e.target.value)}
                placeholder="0.025000"
              />
            </label>
          </div>
          <Btn
            variant="primary"
            size="md"
            data-testid="run-model-submit"
            disabled={
              !modelVersion.trim() || !windowStart || !windowEnd || !runActor.trim() ||
              runModel.isPending
            }
            onClick={() =>
              runModel.mutate({
                modelVersion: modelVersion.trim(),
                trainingWindowStart: windowStart,
                trainingWindowEnd: windowEnd,
                flatRateComparison: flatRateComparison.trim() || undefined,
                actor: runActor.trim(),
              })
            }
          >
            {runModel.isPending ? 'Running…' : 'Run model'}
          </Btn>
          <div className="mt-3"><MutationError error={runModel.error} testId="run-model-error" /></div>
        </Card>
      )}

      <Card
        title="Model outputs"
        testId="chargeback-models-card"
        actions={
          <select
            data-testid="model-state-filter"
            className="border border-slate-300 rounded px-2 py-1 text-[13px]"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">All states</option>
            {['RECOMMENDATION_READY', 'ADOPTED', 'SUPERSEDED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        }
      >
        {rows.length === 0 ? (
          <Empty
            testId="chargeback-models-empty"
            title={stateFilter ? `No model outputs in state ${stateFilter}` : 'No model outputs yet'}
            message={
              stateFilter
                ? 'Change the state filter to see outputs in other states.'
                : 'Run the model to produce a recommendation. The output is a rate proposal, not a rate in effect.'
            }
          />
        ) : (
          <Table
            headers={['Model version', 'State', 'Recommended rate', 'Flat rate comparison', 'Drift', 'Training window', 'Adopted by', 'Adopted at', '']}
            testId="chargeback-models-table"
          >
            {rows.map((r) => (
              <tr
                key={r.id}
                data-testid={`chargeback-model-row-${r.id}`}
                className={[
                  'border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50',
                  selectedId === r.id ? 'bg-blue-50' : '',
                ].join(' ')}
                onClick={() => { setSelectedId(r.id); setShowAdoptForm(false); }}
              >
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`model-version-${r.id}`}>{r.modelVersion}</td>
                <td className="py-2 pr-4"><StateBadge state={r.state} testId={`model-state-${r.id}`} /></td>
                <td className="py-2 pr-4 tabular-nums font-mono font-semibold" data-testid={`model-rate-${r.id}`}>
                  {r.recommendedRate != null ? `${(Number(r.recommendedRate) * 100).toFixed(4)}%` : '—'}
                  <span className="ml-1 text-[11px] text-slate-500 font-normal">(proposal only)</span>
                </td>
                <td className="py-2 pr-4 tabular-nums font-mono text-[12px]" data-testid={`model-flat-rate-${r.id}`}>
                  {r.flatRateComparison != null ? `${(Number(r.flatRateComparison) * 100).toFixed(4)}%` : '—'}
                </td>
                <td className="py-2 pr-4">
                  {r.driftFlagged ? (
                    <Badge variant="warning" data-testid={`model-drift-${r.id}`}>Drift flagged</Badge>
                  ) : (
                    <Badge variant="success" data-testid={`model-drift-${r.id}`}>OK</Badge>
                  )}
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-500">
                  {r.trainingWindowStart ? new Date(r.trainingWindowStart).toLocaleDateString() : '—'} –{' '}
                  {r.trainingWindowEnd ? new Date(r.trainingWindowEnd).toLocaleDateString() : '—'}
                </td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`model-adopted-by-${r.id}`}>{r.adoptedBy ?? '—'}</td>
                <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(r.adoptedAt)}</td>
                <td className="py-2 pr-4">
                  {r.state === 'RECOMMENDATION_READY' && (
                    <Btn variant="secondary" size="sm" data-testid={`inspect-model-${r.id}`} onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); setShowAdoptForm(true); }}>
                      Adopt
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {item && (
        <>
          <Card title="Model output detail" testId="model-detail-card" actions={<StateBadge state={item.state} testId="model-detail-state" />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <KeyValue label="Model version" value={<code className="text-[11px]">{item.modelVersion}</code>} testId="detail-model-version" />
              <KeyValue
                label="State"
                value={
                  <span data-testid="detail-state-note" className="text-[12px]">
                    {item.state === 'ADOPTED' ? 'Adopted — rate is now in the S091 config' :
                     item.state === 'SUPERSEDED' ? 'Superseded by a later adoption' :
                     'Recommendation ready — not in effect until adopted by a person'}
                  </span>
                }
              />
              <KeyValue
                label="Recommended rate (proposal only)"
                value={
                  <span data-testid="detail-recommended-rate" className="tabular-nums font-mono">
                    {item.recommendedRate != null ? `${(Number(item.recommendedRate) * 100).toFixed(4)}%` : '—'}
                  </span>
                }
              />
              <KeyValue
                label="Flat rate comparison"
                value={
                  <span data-testid="detail-flat-rate" className="tabular-nums font-mono">
                    {item.flatRateComparison != null ? `${(Number(item.flatRateComparison) * 100).toFixed(4)}%` : '—'}
                  </span>
                }
              />
              <KeyValue label="Training window start" value={dateTime(item.trainingWindowStart)} testId="detail-window-start" />
              <KeyValue label="Training window end" value={dateTime(item.trainingWindowEnd)} testId="detail-window-end" />
              <KeyValue
                label="Drift flagged"
                value={
                  item.driftFlagged
                    ? <Badge variant="warning" data-testid="detail-drift-badge">Yes — thin or fragmented sample</Badge>
                    : <Badge variant="success" data-testid="detail-drift-badge">No</Badge>
                }
              />
              <KeyValue label="S091 config version (on adoption)" value={item.s091ConfigVersion ?? '—'} testId="detail-s091-version" />
              <KeyValue label="Adopted by" value={item.adoptedBy ?? '—'} testId="detail-adopted-by" />
              <KeyValue label="Adopted at" value={dateTime(item.adoptedAt)} testId="detail-adopted-at" />
            </div>

            <div className="mt-4">
              <h3 className="text-[13px] font-semibold text-slate-700 mb-2">Fit diagnostics</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8">
                <KeyValue label="Originated count" value={fitDiag.originatedCount ?? '—'} testId="diag-originated-count" />
                <KeyValue label="Charged-back count" value={fitDiag.chargedBackCount ?? '—'} testId="diag-cb-count" />
                <KeyValue label="Originated amount" value={money(fitDiag.originatedAmount)} testId="diag-originated-amount" />
                <KeyValue label="Charged-back amount" value={money(fitDiag.chargedBackAmount)} testId="diag-cb-amount" />
                <KeyValue label="Cohort count" value={fitDiag.cohortCount ?? '—'} testId="diag-cohort-count" />
                <KeyValue
                  label="Sample adequate"
                  value={
                    fitDiag.sampleAdequate != null
                      ? <Badge variant={fitDiag.sampleAdequate ? 'success' : 'warning'} data-testid="diag-sample-adequate">{fitDiag.sampleAdequate ? 'Yes' : 'No — thin'}</Badge>
                      : '—'
                  }
                />
              </div>
            </div>
          </Card>

          {cohortData.length > 0 && (
            <Card title="Cohort data used in training" testId="cohort-data-card">
              <Table
                headers={['Cohort key', 'Originated count', 'Originated amount', 'Charged-back count', 'Charged-back amount']}
                testId="cohort-data-table"
              >
                {cohortData.map((c: any, i) => (
                  <tr key={i} data-testid={`cohort-row-${c.cohortKey ?? i}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 font-mono text-[12px]">{c.cohortKey}</td>
                    <td className="py-2 pr-4 tabular-nums">{c.originatedCount}</td>
                    <td className="py-2 pr-4 tabular-nums font-mono">{money(c.originatedAmount)}</td>
                    <td className="py-2 pr-4 tabular-nums">{c.chargedBackCount}</td>
                    <td className="py-2 pr-4 tabular-nums font-mono">{money(c.chargedBackAmount)}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {showAdoptForm && item.state === 'RECOMMENDATION_READY' && (
            <Card title="Adoption ceremony — requires a person and a target S091 config version" testId="adopt-form">
              <p className="text-[12.5px] text-slate-600 mb-3">
                Adoption is a deliberate human act. It requires:
              </p>
              <ul className="list-disc list-inside text-[12.5px] text-slate-600 mb-3 space-y-1">
                <li>An adopter who is a real person identity (automation identities are refused).</li>
                <li>The exact S091 configuration version the rate is being adopted into — the rate cannot enter the
                  system without a configuration target to land in.</li>
                {item.driftFlagged && (
                  <li className="text-amber-700 font-medium">
                    This output is drift-flagged (thin or fragmented sample). You must explicitly acknowledge the
                    drift finding before adoption is permitted.
                  </li>
                )}
              </ul>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <label className="text-[12px] text-slate-600">
                  Adopted by (person identity) *
                  <input
                    data-testid="adopt-by"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={adoptedBy}
                    onChange={(e) => setAdoptedBy(e.target.value)}
                    placeholder="controller@dealership.com"
                  />
                </label>
                <label className="text-[12px] text-slate-600">
                  Target S091 config version *
                  <input
                    data-testid="adopt-s091-config-version"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={s091ConfigVersion}
                    onChange={(e) => setS091ConfigVersion(e.target.value)}
                    placeholder="s091-config-v12"
                  />
                </label>
              </div>
              {item.driftFlagged && (
                <label className="flex items-center gap-2 mb-3 text-[12.5px] text-amber-700 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="adopt-acknowledge-drift"
                    checked={acknowledgeDrift}
                    onChange={(e) => setAcknowledgeDrift(e.target.checked)}
                  />
                  I acknowledge that this model output is drift-flagged and understand the sample is thin or
                  fragmented
                </label>
              )}
              <div className="flex gap-2">
                <Btn
                  variant="primary"
                  size="md"
                  data-testid="adopt-submit"
                  disabled={
                    !adoptedBy.trim() || !s091ConfigVersion.trim() ||
                    (item.driftFlagged && !acknowledgeDrift) ||
                    adoptModel.isPending
                  }
                  onClick={() =>
                    adoptModel.mutate({
                      id: item.id,
                      data: {
                        adoptedBy: adoptedBy.trim(),
                        s091ConfigVersion: s091ConfigVersion.trim(),
                        ...(item.driftFlagged ? { acknowledgeDrift } : {}),
                      },
                    })
                  }
                >
                  {adoptModel.isPending ? 'Adopting…' : 'Adopt rate into S091 config'}
                </Btn>
                <Btn variant="secondary" size="md" data-testid="adopt-cancel" onClick={() => setShowAdoptForm(false)}>
                  Cancel
                </Btn>
              </div>
              <div className="mt-3"><MutationError error={adoptModel.error} testId="adopt-error" /></div>
            </Card>
          )}
        </>
      )}
    </AutomationPage>
  );
}
