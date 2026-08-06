/**
 * CE-16 Parallel-Run Comparison Harness — S131.
 *
 * The exit criterion is not zero differences; it is that every difference is
 * explained and dispositioned. An unexplained difference blocks the cutover
 * recommendation, and the controller who signs off cannot be the operator who
 * ran the comparison.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { Banner, EmptyState, SectionLabel } from '../../../components/report';
import {
  MigrationPage, Card, Table, KeyValue, MutationError, stateVariant, money, NoRuns, useRunIdFromQuery,
} from './shared';

const CLASSIFICATIONS = ['TIMING', 'MAPPING', 'LEGACY_ERROR', 'MODERN_ERROR', 'UNEXPLAINED'] as const;

function diffVariant(c: string) {
  return c === 'UNEXPLAINED' ? ('danger' as const) : ('info' as const);
}

export default function MigrationParallel() {
  const qc = useQueryClient();
  const queryRunId = useRunIdFromQuery();
  const [runId, setRunId] = useState(queryRunId ?? '');
  const [comparisonRunId, setComparisonRunId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { classification: string; reason: string }>>({});
  const [signOffEvidence, setSignOffEvidence] = useState('');

  const runs = useQuery({ queryKey: ['migration', 'runs'], queryFn: () => migrationApi.listRuns(), retry: false });

  const comparisons = useQuery({
    queryKey: ['migration', 'comparisons', runId],
    queryFn: () => migrationApi.listComparisons(runId),
    enabled: Boolean(runId),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['migration', 'comparison', runId, comparisonRunId],
    queryFn: () => migrationApi.getComparison(runId, comparisonRunId as string),
    enabled: Boolean(runId && comparisonRunId),
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['migration', 'comparisons', runId] });
    qc.invalidateQueries({ queryKey: ['migration', 'comparison', runId] });
  };

  const classify = useMutation({
    mutationFn: ({ diffId, body }: { diffId: string; body: any }) =>
      migrationApi.classifyDiff(runId, diffId, { ...body, comparisonRunId }),
    onSuccess: invalidate,
  });

  const signOff = useMutation({
    mutationFn: () => migrationApi.signOffComparison(runId, {
      comparisonRunId,
      evidence: signOffEvidence.trim() ? { note: signOffEvidence.trim() } : undefined,
    }),
    onSuccess: invalidate,
  });

  const comparisonList: any[] = comparisons.data?.items ?? [];
  const comparison = detail.data?.comparison;
  const diffs: any[] = detail.data?.diffs ?? [];
  const summary = detail.data?.summary;

  return (
    <MigrationPage
      title="Parallel Run Comparison"
      story="S131"
      subtitle="Legacy vs modern, every difference explained and dispositioned"
      testId="migration-parallel"
      permission="migration.reconcile.view"
      loading={runs.isLoading}
      error={runs.error}
      retry={() => runs.refetch()}
    >
      <Card
        title="Comparison periods"
        testId="comparisons-card"
        actions={
          <select
            data-testid="parallel-run-select"
            className="border border-slate-300 rounded px-2 py-1 text-[12px]"
            value={runId}
            onChange={(e) => { setRunId(e.target.value); setComparisonRunId(null); }}
          >
            <option value="">Select a run…</option>
            {(runs.data?.items ?? []).map((r: any) => <option key={r.id} value={r.runId}>{r.runId}</option>)}
          </select>
        }
      >
        {!runId ? <NoRuns testId="parallel-no-run" /> : (
          <>
            {comparisons.isLoading && <p className="text-[13px] text-slate-500" data-testid="comparisons-loading">Loading comparisons…</p>}
            {comparisons.error && <MutationError error={comparisons.error} testId="comparisons-error" />}
            {!comparisons.isLoading && !comparisons.error && comparisonList.length === 0 && (
              <EmptyState
                testId="comparisons-empty"
                title="No comparison periods"
                message="Ingest a legacy period output to compare it against the modern equivalent."
              />
            )}
            {comparisonList.length > 0 && (
              <Table testId="comparisons-table" headers={['Period', 'State', 'Total diffs', 'Unexplained', 'Signed off by', 'Signed off at', '']}>
                {comparisonList.map((c) => (
                  <tr key={c.id} data-testid={`comparison-row-${c.id}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 font-mono text-[12px]">{c.periodYear}-{String(c.periodMonth).padStart(2, '0')}</td>
                    <td className="py-2 pr-4"><Badge variant={stateVariant(c.state)}>{c.state}</Badge></td>
                    <td className="py-2 pr-4">{c.totalDiffs}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={c.unexplainedDiffs > 0 ? 'danger' : 'success'} data-testid={`comparison-unexplained-${c.id}`}>
                        {c.unexplainedDiffs}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-[12px]">{c.signedOffBy ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px]">{c.signedOffAt ? new Date(c.signedOffAt).toLocaleString() : '—'}</td>
                    <td className="py-2 pr-4">
                      <Btn
                        variant={comparisonRunId === c.id ? 'primary' : 'secondary'}
                        size="sm"
                        data-testid={`comparison-open-${c.id}`}
                        onClick={() => setComparisonRunId(c.id)}
                      >
                        Open
                      </Btn>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </>
        )}
      </Card>

      {comparisonRunId && detail.isLoading && <p className="text-[13px] text-slate-500" data-testid="comparison-detail-loading">Loading differences…</p>}
      {comparisonRunId && detail.error && <MutationError error={detail.error} testId="comparison-detail-error" />}

      {comparison && (
        <Card title="Exit criterion" testId="exit-criterion-card">
          <KeyValue label="Period" value={`${comparison.periodYear}-${String(comparison.periodMonth).padStart(2, '0')}`} />
          <KeyValue label="Total differences" value={summary?.totalDiffs ?? 0} testId="summary-total" />
          <KeyValue label="Explained" value={summary?.explainedDiffs ?? 0} testId="summary-explained" />
          <KeyValue label="Unexplained" value={summary?.unexplainedDiffs ?? 0} testId="summary-unexplained" />
          <KeyValue
            label="Exit criterion met"
            value={<Badge variant={summary?.exitCriterionMet ? 'success' : 'danger'}>{summary?.exitCriterionMet ? 'YES' : 'NO'}</Badge>}
            testId="summary-exit-criterion"
          />
          <div className="flex flex-wrap gap-2 mt-2">
            {CLASSIFICATIONS.map((c) => (
              <Badge key={c} variant={diffVariant(c)}>{c}: {summary?.byClassification?.[c] ?? 0}</Badge>
            ))}
          </div>
          {!summary?.exitCriterionMet && (
            <Banner kind="error" title="Unexplained differences block the cutover recommendation" testId="exit-criterion-blocked">
              <span className="text-[12.5px]">
                The exit criterion is that 100% of differences are explained and dispositioned — not that there are no
                differences. {summary?.unexplainedDiffs ?? 0} difference(s) still lack an explanation.
              </span>
            </Banner>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-slate-600 flex-1 min-w-[220px]">
              Controller sign-off evidence
              <input
                data-testid="signoff-evidence-input"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={signOffEvidence}
                onChange={(e) => setSignOffEvidence(e.target.value)}
                placeholder="reference to the reviewed working papers"
              />
            </label>
            <Btn
              variant="primary"
              size="md"
              data-testid="signoff-btn"
              loading={signOff.isPending}
              disabled={comparison.state === 'SIGNED_OFF'}
              onClick={() => signOff.mutate()}
            >
              {comparison.state === 'SIGNED_OFF' ? 'Signed off' : 'Controller sign-off'}
            </Btn>
          </div>
          <MutationError error={signOff.error} testId="signoff-error" />
          <p className="text-[11px] text-slate-500 mt-2" data-testid="parallel-sod-note">
            Segregation of duties: the operator who ran the comparison cannot be the controller who signs it off.
          </p>
        </Card>
      )}

      {comparison && (
        <Card title="Differences" testId="diffs-card">
          <SectionLabel>Each difference is classified as timing, mapping, legacy error, modern error or unexplained</SectionLabel>
          {diffs.length === 0 ? (
            <EmptyState testId="diffs-empty" title="No differences" message="Legacy and modern figures agreed on every compared dimension." />
          ) : (
            <Table
              testId="diffs-table"
              headers={['Type', 'Dimension', 'Legacy', 'Modern', 'Variance', 'Classification', 'Disposition', 'Reason', 'Action']}
            >
              {diffs.map((d) => {
                const draftEntry = draft[d.id] ?? { classification: d.classification ?? 'TIMING', reason: d.reason ?? '' };
                return (
                  <tr key={d.id} data-testid={`diff-row-${d.id}`} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="py-2 pr-4 font-mono text-[12px]">{d.diffType}</td>
                    <td className="py-2 pr-4 font-mono text-[12px]">{d.dimension}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{money(d.sourceValue)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{money(d.targetValue)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums" data-testid={`diff-variance-${d.id}`}>{money(d.variance)}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={diffVariant(d.classification)} data-testid={`diff-classification-${d.id}`}>{d.classification}</Badge>
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={d.disposition === 'APPROVED' ? 'success' : 'warning'} data-testid={`diff-disposition-${d.id}`}>
                        {d.disposition}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-[12px] max-w-xs">{d.reason ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-col gap-1">
                        <select
                          data-testid={`diff-classify-select-${d.id}`}
                          className="border border-slate-300 rounded px-1.5 py-1 text-[12px]"
                          value={draftEntry.classification}
                          onChange={(e) => setDraft({ ...draft, [d.id]: { ...draftEntry, classification: e.target.value } })}
                        >
                          {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input
                          data-testid={`diff-reason-${d.id}`}
                          className="border border-slate-300 rounded px-1.5 py-1 text-[12px]"
                          placeholder="explanation (min 5 chars)"
                          value={draftEntry.reason}
                          onChange={(e) => setDraft({ ...draft, [d.id]: { ...draftEntry, reason: e.target.value } })}
                        />
                        <div className="flex gap-1">
                          <Btn
                            variant="secondary"
                            size="sm"
                            data-testid={`diff-classify-${d.id}`}
                            disabled={draftEntry.reason.trim().length < 5}
                            onClick={() => classify.mutate({ diffId: d.id, body: { classification: draftEntry.classification, reason: draftEntry.reason.trim() } })}
                          >
                            Classify
                          </Btn>
                          <Btn
                            variant="ghost"
                            size="sm"
                            data-testid={`diff-approve-${d.id}`}
                            disabled={draftEntry.reason.trim().length < 5}
                            onClick={() => classify.mutate({
                              diffId: d.id,
                              body: { classification: draftEntry.classification, reason: draftEntry.reason.trim(), disposition: 'APPROVED' },
                            })}
                          >
                            Approve
                          </Btn>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
          <MutationError error={classify.error} testId="classify-error" />
        </Card>
      )}
    </MigrationPage>
  );
}
