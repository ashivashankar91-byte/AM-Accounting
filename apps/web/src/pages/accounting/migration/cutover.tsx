/**
 * CE-16 Cutover Ceremony — S131 exit / migration cutover rules.
 *
 * Cutover is irreversible domain authority. Preparation is not approval: the
 * user who prepares the ceremony can never grant final approval, the
 * irreversible-effect statement must be acknowledged verbatim, and a second
 * execution returns the same result rather than repeating the work.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { Banner, EmptyState, SectionLabel } from '../../../components/report';
import {
  MigrationPage, Card, Table, KeyValue, MutationError, stateVariant, NoRuns, useRunIdFromQuery,
} from './shared';

const ROLLBACK_KINDS = ['PRE_PROMOTION_CANCEL', 'STAGED_DATA_RESET', 'PROMOTED_FINANCIAL_REVERSAL'] as const;

export default function MigrationCutover() {
  const qc = useQueryClient();
  const queryRunId = useRunIdFromQuery();
  const [runId, setRunId] = useState(queryRunId ?? '');
  const [prepare, setPrepare] = useState({ targetEnvironment: 'PRODUCTION', rollbackBoundary: '', backupRef: '', rollbackPlanRef: '' });
  const [acknowledgement, setAcknowledgement] = useState('');
  const [freezeAttestation, setFreezeAttestation] = useState('');
  const [deltaRef, setDeltaRef] = useState('');
  const [rollback, setRollback] = useState({ kind: 'PROMOTED_FINANCIAL_REVERSAL', reason: '' });

  const runs = useQuery({ queryKey: ['migration', 'runs'], queryFn: () => migrationApi.listRuns(), retry: false });

  const ceremony = useQuery({
    queryKey: ['migration', 'ceremony', runId],
    queryFn: () => migrationApi.getCeremony(runId),
    enabled: Boolean(runId),
    retry: false,
  });

  const readiness = useQuery({
    queryKey: ['migration', 'readiness', runId],
    queryFn: () => migrationApi.getReadiness(runId),
    enabled: Boolean(runId),
    retry: false,
  });

  const restartPlan = useQuery({
    queryKey: ['migration', 'restart-plan', runId],
    queryFn: () => migrationApi.getRestartPlan(runId),
    enabled: Boolean(runId),
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['migration', 'ceremony', runId] });
    qc.invalidateQueries({ queryKey: ['migration', 'readiness', runId] });
    qc.invalidateQueries({ queryKey: ['migration', 'restart-plan', runId] });
    qc.invalidateQueries({ queryKey: ['migration', 'runs'] });
  };

  const attestFreeze = useMutation({
    mutationFn: () => migrationApi.attestFreeze(runId, { attestation: freezeAttestation.trim() }),
    onSuccess: invalidate,
  });
  const markDelta = useMutation({
    mutationFn: () => migrationApi.markDeltaComplete(runId, { deltaSnapshotRef: deltaRef.trim() }),
    onSuccess: invalidate,
  });
  const doPrepare = useMutation({
    mutationFn: () => migrationApi.prepareCutover(runId, {
      targetEnvironment: prepare.targetEnvironment,
      rollbackBoundary: prepare.rollbackBoundary.trim(),
      backupEvidence: prepare.backupRef.trim() ? { backupRef: prepare.backupRef.trim() } : {},
      rollbackPlanEvidence: prepare.rollbackPlanRef.trim() ? { planRef: prepare.rollbackPlanRef.trim() } : {},
    }),
    onSuccess: invalidate,
  });
  const doApprove = useMutation({
    mutationFn: () => migrationApi.approveCutover(runId, { acknowledgedStatement: acknowledgement }),
    onSuccess: invalidate,
  });
  const doExecute = useMutation({ mutationFn: () => migrationApi.executeCutover(runId, {}), onSuccess: invalidate });
  const doRollback = useMutation({
    mutationFn: () => migrationApi.rollback(runId, { kind: rollback.kind, reason: rollback.reason.trim() }),
    onSuccess: invalidate,
  });

  const c = ceremony.data;
  const statement = c?.irreversibleEffectStatement ?? '';
  const ready = readiness.data?.ready;
  const unmet: string[] = readiness.data?.unmet ?? [];

  return (
    <MigrationPage
      title="Cutover Ceremony"
      story="S131"
      subtitle="Irreversible domain authority under dual segregation of duties"
      testId="migration-cutover"
      permission="migration.cutover.prepare"
      loading={runs.isLoading}
      error={runs.error}
      retry={() => runs.refetch()}
    >
      <Card
        title="Run"
        testId="cutover-run-card"
        actions={
          <select
            data-testid="cutover-run-select"
            className="border border-slate-300 rounded px-2 py-1 text-[12px]"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
          >
            <option value="">Select a run…</option>
            {(runs.data?.items ?? []).map((r: any) => <option key={r.id} value={r.runId}>{r.runId} · {r.state}</option>)}
          </select>
        }
      >
        {!runId ? <NoRuns testId="cutover-no-run" /> : (
          <>
            <KeyValue
              label="Readiness"
              value={<Badge variant={ready ? 'success' : 'warning'} data-testid="cutover-readiness-badge">{ready ? 'ALL PREREQUISITES MET' : `${unmet.length} UNMET`}</Badge>}
            />
            {unmet.length > 0 && (
              <Banner kind="warning" title="Cutover prerequisites are not satisfied" testId="cutover-unmet">
                <ul className="text-[12.5px] list-disc pl-4">{unmet.map((u) => <li key={u}>{u}</li>)}</ul>
              </Banner>
            )}
            <p className="text-[11px] text-slate-500 mt-2" data-testid="cutover-no-autocut-note">
              Cutover is never triggered automatically by a successful test. It requires this explicit ceremony.
            </p>
          </>
        )}
      </Card>

      {runId && (
        <Card title="Freeze and delta" testId="freeze-card">
          <SectionLabel>The legacy system must be frozen and the delta extraction completed before cutover</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] text-slate-600">
                Freeze attestation (min 10 characters)
                <input
                  data-testid="freeze-attestation-input"
                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                  value={freezeAttestation}
                  onChange={(e) => setFreezeAttestation(e.target.value)}
                  placeholder="legacy posting disabled at ..."
                />
              </label>
              <Btn
                variant="secondary"
                size="md"
                className="mt-2"
                data-testid="freeze-attest-btn"
                loading={attestFreeze.isPending}
                disabled={freezeAttestation.trim().length < 10}
                onClick={() => attestFreeze.mutate()}
              >
                Attest freeze
              </Btn>
              <MutationError error={attestFreeze.error} testId="freeze-error" />
            </div>
            <div>
              <label className="text-[12px] text-slate-600">
                Delta extract reference
                <input
                  data-testid="delta-ref-input"
                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                  value={deltaRef}
                  onChange={(e) => setDeltaRef(e.target.value)}
                  placeholder="delta-snapshot-2026-08-02"
                />
              </label>
              <Btn
                variant="secondary"
                size="md"
                className="mt-2"
                data-testid="delta-complete-btn"
                loading={markDelta.isPending}
                disabled={!deltaRef.trim()}
                onClick={() => markDelta.mutate()}
              >
                Mark delta complete
              </Btn>
              <MutationError error={markDelta.error} testId="delta-error" />
            </div>
          </div>
        </Card>
      )}

      {runId && ceremony.isLoading && <p className="text-[13px] text-slate-500" data-testid="ceremony-loading">Loading ceremony…</p>}
      {runId && ceremony.error && <MutationError error={ceremony.error} testId="ceremony-error" />}

      {runId && !ceremony.isLoading && !ceremony.error && !c && (
        <EmptyState testId="ceremony-empty" title="No ceremony prepared" message="Prepare the cutover ceremony below to record its scope, freeze point and rollback boundary." />
      )}

      {runId && (
        <Card title="1 · Prepare" testId="prepare-card">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="text-[12px] text-slate-600">
              Target environment
              <input
                data-testid="prepare-env-input"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={prepare.targetEnvironment}
                onChange={(e) => setPrepare({ ...prepare, targetEnvironment: e.target.value })}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Rollback boundary
              <input
                data-testid="prepare-boundary-input"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={prepare.rollbackBoundary}
                onChange={(e) => setPrepare({ ...prepare, rollbackBoundary: e.target.value })}
                placeholder="conversion journals only"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Backup evidence reference
              <input
                data-testid="prepare-backup-input"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={prepare.backupRef}
                onChange={(e) => setPrepare({ ...prepare, backupRef: e.target.value })}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Rollback plan reference
              <input
                data-testid="prepare-plan-input"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={prepare.rollbackPlanRef}
                onChange={(e) => setPrepare({ ...prepare, rollbackPlanRef: e.target.value })}
              />
            </label>
          </div>
          <Btn
            variant="primary"
            size="md"
            className="mt-3"
            data-testid="prepare-btn"
            loading={doPrepare.isPending}
            onClick={() => doPrepare.mutate()}
          >
            Prepare ceremony
          </Btn>
          <MutationError error={doPrepare.error} testId="prepare-error" />
        </Card>
      )}

      {c && (
        <Card title="2 · Irreversible effect statement" testId="statement-card">
          <KeyValue label="Ceremony state" value={<Badge variant={stateVariant(c.state)} data-testid="ceremony-state">{c.state}</Badge>} />
          <KeyValue label="Prepared by" value={<span data-testid="ceremony-prepared-by">{c.preparedBy ?? '—'}</span>} />
          <KeyValue label="Prepared at" value={c.preparedAt ? new Date(c.preparedAt).toLocaleString() : '—'} />
          <KeyValue label="Approver" value={<span data-testid="ceremony-approver">{c.approverIdentity ?? '—'}</span>} />
          <KeyValue label="Freeze timestamp" value={c.freezeTimestamp ? new Date(c.freezeTimestamp).toLocaleString() : '—'} />
          <KeyValue label="Rollback boundary" value={c.rollbackBoundary || '—'} />
          <KeyValue label="Target environment" value={c.targetEnvironment ?? '—'} />

          <Banner kind="error" title="This action is irreversible" testId="irreversible-statement">
            <span className="text-[12.5px] whitespace-pre-wrap" data-testid="irreversible-statement-text">{statement || 'Prepare the ceremony to generate the irreversible-effect statement.'}</span>
          </Banner>

          <div className="mt-3">
            <label className="text-[12px] text-slate-600">
              Type the statement above verbatim to acknowledge it
              <textarea
                data-testid="acknowledgement-input"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                rows={3}
                value={acknowledgement}
                onChange={(e) => setAcknowledgement(e.target.value)}
              />
            </label>
            <div className="flex gap-2 mt-2">
              <Btn
                variant="danger"
                size="md"
                data-testid="approve-cutover-btn"
                loading={doApprove.isPending}
                disabled={!acknowledgement.trim()}
                onClick={() => doApprove.mutate()}
              >
                Approve cutover
              </Btn>
              <Btn variant="ghost" size="sm" data-testid="copy-statement-btn" onClick={() => setAcknowledgement(statement)}>
                Fill from statement
              </Btn>
            </div>
            <MutationError error={doApprove.error} testId="approve-error" />
            <p className="text-[11px] text-slate-500 mt-2" data-testid="cutover-sod-note">
              Segregation of duties: the preparer cannot grant final approval. A separate authorised user must approve.
            </p>
          </div>
        </Card>
      )}

      {c && (
        <Card title="3 · Execute" testId="execute-card">
          <Btn
            variant="danger"
            size="lg"
            data-testid="execute-cutover-btn"
            loading={doExecute.isPending}
            disabled={c.state !== 'APPROVED' && c.state !== 'EXECUTING' && c.state !== 'COMPLETE'}
            onClick={() => doExecute.mutate()}
          >
            Execute cutover
          </Btn>
          <MutationError error={doExecute.error} testId="execute-error" />
          {doExecute.data && (
            <div className="mt-3" data-testid="execute-result">
              <KeyValue label="Ceremony state" value={<Badge variant={stateVariant(doExecute.data.state)}>{doExecute.data.state}</Badge>} testId="execute-result-state" />
              <KeyValue label="Run state" value={<Badge variant={stateVariant(doExecute.data.runState)}>{doExecute.data.runState}</Badge>} />
              <KeyValue
                label="Idempotent replay"
                value={<Badge variant={doExecute.data.idempotentReplay ? 'info' : 'neutral'} data-testid="execute-idempotent">{doExecute.data.idempotentReplay ? 'YES' : 'NO'}</Badge>}
              />
              {doExecute.data.idempotentReplay && (
                <Banner kind="info" title="Cutover already executed" testId="idempotent-banner">
                  <span className="text-[12.5px]">
                    The ceremony was already executed. This request returned the same result without repeating any
                    irreversible work.
                  </span>
                </Banner>
              )}
            </div>
          )}
        </Card>
      )}

      {runId && (
        <Card title="Rollback and restart" testId="rollback-card">
          <SectionLabel>A financial rollback posts governed reversal entries; it never deletes evidence</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-[12px] text-slate-600">
              Rollback kind
              <select
                data-testid="rollback-kind-select"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={rollback.kind}
                onChange={(e) => setRollback({ ...rollback, kind: e.target.value })}
              >
                {ROLLBACK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-slate-600 md:col-span-2">
              Reason
              <input
                data-testid="rollback-reason-input"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={rollback.reason}
                onChange={(e) => setRollback({ ...rollback, reason: e.target.value })}
                placeholder="why this run is being rolled back"
              />
            </label>
          </div>
          <Btn
            variant="danger"
            size="md"
            className="mt-3"
            data-testid="rollback-btn"
            loading={doRollback.isPending}
            disabled={!rollback.reason.trim()}
            onClick={() => doRollback.mutate()}
          >
            Roll back
          </Btn>
          <MutationError error={doRollback.error} testId="rollback-error" />
          {doRollback.data && (
            <div className="mt-3" data-testid="rollback-result">
              <KeyValue label="Rollback kind" value={<Badge variant="info" data-testid="rollback-result-kind">{doRollback.data.plan?.kind}</Badge>} />
              <KeyValue label="Rationale" value={doRollback.data.plan?.rationale ?? '—'} />
              <KeyValue label="Reversal entries" value={(doRollback.data.reversals ?? []).length} testId="rollback-reversal-count" />
              <KeyValue
                label="Evidence preserved"
                value={<Badge variant="success" data-testid="rollback-evidence-preserved">{doRollback.data.evidencePreserved ? 'YES' : 'NO'}</Badge>}
              />
              {(doRollback.data.reversals ?? []).length > 0 && (
                <Table testId="rollback-reversals-table" headers={['Original journal', 'Status', 'Reversal journal', 'Posting execution']}>
                  {(doRollback.data.reversals ?? []).map((r: any, i: number) => (
                    <tr key={i} data-testid={`reversal-row-${i}`} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 font-mono text-[11px]">{r.originalJournalRef ?? '—'}</td>
                      <td className="py-2 pr-4"><Badge variant={stateVariant(r.status)}>{r.status}</Badge></td>
                      <td className="py-2 pr-4 font-mono text-[11px]">{r.reversalJournalRef ?? '—'}</td>
                      <td className="py-2 pr-4 font-mono text-[11px]">{r.postingExecutionRef ?? '—'}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          )}
          {restartPlan.data && (
            <div className="mt-4" data-testid="restart-plan">
              <SectionLabel>Restart plan</SectionLabel>
              <KeyValue label="Restartable" value={<Badge variant={restartPlan.data.restartable ? 'success' : 'neutral'}>{restartPlan.data.restartable ? 'YES' : 'NO'}</Badge>} testId="restart-restartable" />
              <KeyValue label="Resume from state" value={<span className="font-mono">{restartPlan.data.resumeFromState ?? '—'}</span>} testId="restart-resume-from" />
              <KeyValue label="Completed phases" value={(restartPlan.data.completedPhases ?? []).join(' → ') || '—'} testId="restart-completed-phases" />
            </div>
          )}
        </Card>
      )}

      {runId && (
        <div className="flex gap-2">
          <Link to={`/accounting/migration/runs/${runId}`}><Btn variant="secondary" size="md">Run detail</Btn></Link>
          <Link to={`/accounting/migration/parallel?runId=${runId}`}><Btn variant="ghost" size="md">Parallel run</Btn></Link>
        </div>
      )}
    </MigrationPage>
  );
}
