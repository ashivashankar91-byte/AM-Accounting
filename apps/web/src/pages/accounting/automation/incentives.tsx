/**
 * CE-17 S103B — Probability-Weighted Incentive Accruals.
 *
 * Compute (preview) → Approve → Reject. EXECUTE_WITH_APPROVAL: nothing posts
 * until a different person approves. The double-accrual guard (isDoubleAccrualGuarded)
 * is what stops the same period being accrued twice — when it is true, the
 * service refused to produce a second recommendation for that period. The
 * weighting method shown is the one from the configuration, never invented here.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, StateBadge, Empty,
  money, confidence, dateTime, useLegalEntityFromQuery,
} from './shared';

export default function AutomationIncentives() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [periodYear, setPeriodYear] = useState<number | ''>(currentYear);
  const [periodMonth, setPeriodMonth] = useState<number | ''>(currentMonth);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showCompute, setShowCompute] = useState(false);
  const [computeForm, setComputeForm] = useState({
    programRef: '',
    periodYear: String(currentYear),
    periodMonth: String(currentMonth),
  });

  const list = useQuery({
    queryKey: ['automation', 'incentives', 'recommendations', legalEntityId, periodYear, periodMonth],
    queryFn: () => automationApi.listIncentiveRecommendations({
      legalEntityId,
      periodYear: periodYear !== '' ? Number(periodYear) : undefined,
      periodMonth: periodMonth !== '' ? Number(periodMonth) : undefined,
    }),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'incentives', 'recommendation', selectedId],
    queryFn: () => automationApi.getIncentiveRecommendation(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const compute = useMutation({
    mutationFn: () => automationApi.computeIncentiveRecommendation({
      legalEntityId,
      programRef: computeForm.programRef,
      periodYear: Number(computeForm.periodYear),
      periodMonth: Number(computeForm.periodMonth),
    }),
    onSuccess: () => {
      setShowCompute(false);
      setComputeForm({ programRef: '', periodYear: String(currentYear), periodMonth: String(currentMonth) });
      invalidate();
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) => automationApi.approveIncentiveRecommendation(id, {}),
    onSuccess: invalidate,
  });

  const reject = useMutation({
    mutationFn: (id: string) => automationApi.rejectIncentiveRecommendation(id, { reason: rejectReason.trim() }),
    onSuccess: () => { setRejectReason(''); invalidate(); },
  });

  const rows: any[] = list.data?.items ?? [];
  const rec: any = detail.data ?? null;

  return (
    <AutomationPage
      title="Incentive Accruals"
      story="S103B"
      subtitle="Probability-weighted preview → approve. EXECUTE_WITH_APPROVAL — nothing posts unattended."
      testId="automation-incentives"
      permission="automation.read"
      capabilityCode="S103B_INCENTIVE_ACCRUALS"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="compute-incentive-toggle" onClick={() => setShowCompute((v) => !v)}>
          Compute (preview)
        </Btn>
      }
    >
      {/* ── Compute panel ─────────────────────────────────────────────────── */}
      {showCompute && (
        <Card title="Compute incentive recommendation (preview)" testId="compute-incentive-panel">
          <p className="text-[12.5px] text-slate-600 mb-3">
            Compute produces a preview recommendation only — it does not post anything. The double-accrual guard will
            refuse to compute a second recommendation for a period that already has an approved one. EXECUTE_WITH_APPROVAL:
            a different person must approve before anything reaches the ledger.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <label className="text-[12px] text-slate-600">
              Program ref
              <input
                data-testid="compute-program-ref"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={computeForm.programRef}
                placeholder="PROG-001"
                onChange={(e) => setComputeForm((f) => ({ ...f, programRef: e.target.value }))}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Period year
              <input
                data-testid="compute-period-year"
                type="number"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={computeForm.periodYear}
                onChange={(e) => setComputeForm((f) => ({ ...f, periodYear: e.target.value }))}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Period month
              <input
                data-testid="compute-period-month"
                type="number"
                min={1}
                max={12}
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={computeForm.periodMonth}
                onChange={(e) => setComputeForm((f) => ({ ...f, periodMonth: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Btn
              variant="primary"
              size="md"
              data-testid="compute-incentive-submit"
              disabled={compute.isPending || !computeForm.programRef}
              onClick={() => compute.mutate()}
            >
              {compute.isPending ? 'Computing…' : 'Compute'}
            </Btn>
            <Btn variant="secondary" size="md" data-testid="compute-incentive-cancel" onClick={() => setShowCompute(false)}>
              Cancel
            </Btn>
          </div>
          <div className="mt-3"><MutationError error={compute.error} testId="compute-incentive-error" /></div>
        </Card>
      )}

      {/* ── Period filter ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-3">
        <label className="text-[12px] text-slate-600">
          Year
          <input
            data-testid="filter-period-year"
            type="number"
            className="ml-2 border border-slate-300 rounded px-2 py-1 text-[13px] w-24"
            value={periodYear}
            onChange={(e) => setPeriodYear(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </label>
        <label className="text-[12px] text-slate-600">
          Month
          <input
            data-testid="filter-period-month"
            type="number"
            min={1}
            max={12}
            className="ml-2 border border-slate-300 rounded px-2 py-1 text-[13px] w-20"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </label>
        <Btn variant="secondary" size="sm" data-testid="filter-period-clear" onClick={() => { setPeriodYear(''); setPeriodMonth(''); }}>
          Clear
        </Btn>
      </div>

      {/* ── Recommendations list ───────────────────────────────────────────── */}
      <Card title="Incentive accrual recommendations" testId="incentives-list-card">
        {rows.length === 0 ? (
          <Empty
            testId="incentives-list-empty"
            title="No recommendations for this period"
            message={
              periodYear && periodMonth
                ? `No incentive accrual recommendations for ${periodYear}-${String(periodMonth).padStart(2, '0')}. Use Compute (preview) to generate one. The double-accrual guard will refuse a second computation for any period that already has an approved recommendation.`
                : 'No incentive accrual recommendations. Select a period and use Compute (preview) to generate one.'
            }
          />
        ) : (
          <Table
            headers={['Program', 'Period', 'Attainment pace', 'Weighting method', 'Recommended amount', 'Rule ver', 'Guard', 'State', '']}
            testId="incentives-list-table"
          >
            {rows.map((r) => (
              <tr key={r.id} data-testid={`incentive-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`incentive-program-${r.id}`}>{r.programRef}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`incentive-period-${r.id}`}>{r.periodYear}-{String(r.periodMonth).padStart(2, '0')}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`incentive-pace-${r.id}`}>{confidence(r.attainmentPace)}</td>
                <td className="py-2 pr-4 text-[12px]">{r.weightingMethod}</td>
                <td className="py-2 pr-4 tabular-nums" data-testid={`incentive-amount-${r.id}`}>{money(r.recommendedAmount)}</td>
                <td className="py-2 pr-4 font-mono text-[11px]">{r.ruleVersion}</td>
                <td className="py-2 pr-4">
                  {r.isDoubleAccrualGuarded
                    ? <Badge variant="info" data-testid={`incentive-guard-${r.id}`}>Guarded</Badge>
                    : <Badge variant="neutral">—</Badge>}
                </td>
                <td className="py-2 pr-4"><StateBadge state={r.state} testId={`incentive-state-${r.id}`} /></td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`incentive-inspect-${r.id}`} onClick={() => setSelectedId(r.id)}>
                    Inspect
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Recommendation detail ──────────────────────────────────────────── */}
      {rec && (
        <Card
          title="Recommendation detail"
          testId="incentive-detail-card"
          actions={<StateBadge state={rec.state} testId="incentive-detail-state" />}
        >
          {rec.isDoubleAccrualGuarded && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Badge variant="info" data-testid="incentive-detail-guard-banner">Double-accrual guard active</Badge>
              <p className="mt-1 text-[12.5px] text-blue-800">
                This recommendation is guarded: the service refused to produce a second recommendation for this
                period. The guard is what stops the same period being accrued twice. If a re-compute is needed,
                the existing approved recommendation must first be reversed by an appropriate approver.
              </p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <KeyValue label="Program ref" value={rec.programRef} testId="detail-program-ref" />
            <KeyValue label="Period" value={`${rec.periodYear}-${String(rec.periodMonth).padStart(2, '0')}`} testId="detail-period" />
            <KeyValue label="Attainment pace" value={confidence(rec.attainmentPace)} testId="detail-attainment-pace" />
            <KeyValue label="Weighting method (from config)" value={rec.weightingMethod} testId="detail-weighting-method" />
            <KeyValue label="Recommended amount" value={money(rec.recommendedAmount)} testId="detail-recommended-amount" />
            <KeyValue label="Rule version" value={rec.ruleVersion} testId="detail-rule-version" />
            <KeyValue label="Double-accrual guard" value={rec.isDoubleAccrualGuarded ? 'Active' : 'Not active'} testId="detail-double-accrual-guard" />
            <KeyValue label="Approved by" value={rec.approvedBy ?? 'Not yet approved'} testId="detail-approved-by" />
            <KeyValue label="Approved at" value={dateTime(rec.approvedAt)} testId="detail-approved-at" />
            <KeyValue label="Posting item" value={rec.postingItemId ?? '—'} testId="detail-posting-item" />
          </div>

          {rec.tierData && Array.isArray(rec.tierData) && rec.tierData.length > 0 && (
            <div className="mt-4">
              <h3 className="text-[13px] font-semibold text-slate-700 mb-2">Tier data</h3>
              <Table headers={['Tier', 'Threshold', 'Rate', 'Weight']} testId="detail-tier-table">
                {rec.tierData.map((t: any, i: number) => (
                  <tr key={i} data-testid={`tier-row-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 text-[12px]">{t.tier ?? i + 1}</td>
                    <td className="py-2 pr-4 tabular-nums">{money(t.threshold)}</td>
                    <td className="py-2 pr-4 text-[12px]">{t.rate !== undefined ? `${(Number(t.rate) * 100).toFixed(2)}%` : '—'}</td>
                    <td className="py-2 pr-4 text-[12px]">{confidence(t.weight)}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {rec.weightingInputs && typeof rec.weightingInputs === 'object' && Object.keys(rec.weightingInputs).length > 0 && (
            <div className="mt-4">
              <h3 className="text-[13px] font-semibold text-slate-700 mb-2">Weighting inputs</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                {Object.entries(rec.weightingInputs).map(([k, v]) => (
                  <KeyValue key={k} label={k} value={String(v)} testId={`weighting-input-${k}`} />
                ))}
              </div>
            </div>
          )}

          {(rec.state === 'RECOMMENDATION_READY' || rec.state === 'APPROVAL_REQUIRED') && (
            <div className="mt-4 space-y-3">
              <div className="flex gap-2">
                <Btn
                  variant="primary"
                  size="md"
                  data-testid="approve-incentive"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(rec.id)}
                >
                  {approve.isPending ? 'Approving…' : 'Approve'}
                </Btn>
                <span className="text-[12px] text-slate-500 self-center">
                  EXECUTE_WITH_APPROVAL — you must be a different person than the one who computed this recommendation.
                </span>
              </div>
              <div className="flex items-end gap-2">
                <label className="text-[12px] text-slate-600 flex-1">
                  Reject reason
                  <input
                    data-testid="reject-incentive-reason"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={rejectReason}
                    placeholder="Why is this recommendation being rejected?"
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                </label>
                <Btn
                  variant="danger"
                  size="md"
                  data-testid="reject-incentive"
                  disabled={!rejectReason.trim() || reject.isPending}
                  onClick={() => reject.mutate(rec.id)}
                >
                  {reject.isPending ? 'Rejecting…' : 'Reject'}
                </Btn>
              </div>
              <MutationError error={approve.error} testId="approve-incentive-error" />
              <MutationError error={reject.error} testId="reject-incentive-error" />
            </div>
          )}
        </Card>
      )}
    </AutomationPage>
  );
}
