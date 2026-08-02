/**
 * CE-16 Migration Run Detail.
 *
 * One run, its staged datasets, its gates, its control totals and its audit
 * trail. Every action offered here is executed by the service; the browser
 * performs no financial calculation and asserts no outcome of its own.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { Banner, EmptyState, SectionLabel } from '../../../components/report';
import {
  MigrationPage, Card, Table, KeyValue, MutationError, stateVariant, money, PENDING_UPSTREAM,
} from './shared';

const DATASET_TYPES = [
  'TB', 'OPEN_ITEMS', 'SCHEDULES', 'BEGINNING_BALANCES', 'COMPARATIVE',
  'JOURNAL_HISTORY', 'BANK_REC', 'PAYROLL', 'VEHICLE', 'OEM', 'STATEMENTS', 'CONFIG', 'ATTACHMENTS',
] as const;

const READINESS_LABELS: Record<string, string> = {
  allGatesPassed: 'All gates G1–G5 pass',
  unexplainedDiffs: 'Zero unexplained parallel-run differences',
  blockingExceptions: 'Zero blocking exceptions',
  freezeDeclared: 'Legacy freeze attested',
  deltaExtractionComplete: 'Delta extraction complete',
  allComparisonPeriodsSignedOff: 'All comparison periods signed off',
  ce15ReadinessApproved: 'CE-15 close readiness approved',
  backupRestoreEvidence: 'Backup / restore evidence captured',
  rollbackPlanDemonstrated: 'Rollback plan demonstrated',
};

export default function MigrationRunDetail() {
  const { runId = '' } = useParams();
  const qc = useQueryClient();
  const [stageForm, setStageForm] = useState({ snapshotId: '', mappingSetId: '', datasetType: 'TB' });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['migration', 'run', runId] });
    qc.invalidateQueries({ queryKey: ['migration', 'gates', runId] });
    qc.invalidateQueries({ queryKey: ['migration', 'control-totals', runId] });
    qc.invalidateQueries({ queryKey: ['migration', 'audit', runId] });
  };

  const run = useQuery({ queryKey: ['migration', 'run', runId], queryFn: () => migrationApi.getRun(runId), retry: false });
  const gates = useQuery({ queryKey: ['migration', 'gates', runId], queryFn: () => migrationApi.listGates(runId), retry: false });
  const totals = useQuery({ queryKey: ['migration', 'control-totals', runId], queryFn: () => migrationApi.listControlTotals(runId), retry: false });
  const audit = useQuery({ queryKey: ['migration', 'audit', runId], queryFn: () => migrationApi.getRunAudit(runId), retry: false });

  const stage = useMutation({ mutationFn: () => migrationApi.stage(runId, stageForm), onSuccess: invalidate });
  const validate = useMutation({ mutationFn: () => migrationApi.validate(runId, {}), onSuccess: invalidate });
  const promote = useMutation({ mutationFn: () => migrationApi.promote(runId, {}), onSuccess: invalidate });

  const data = run.data;
  const detail = data?.run;
  const readiness = data?.readiness;
  const datasets: any[] = data?.datasets ?? [];
  const promoteResults: any[] = promote.data?.results ?? [];
  const pendingUpstream = promoteResults.filter((r) => r.status === PENDING_UPSTREAM);

  return (
    <MigrationPage
      title={`Migration Run ${runId}`}
      story="S129 · S130"
      subtitle="Staging, validation, gates and governed promotion"
      testId="migration-run-detail"
      permission="migration.run.read"
      loading={run.isLoading}
      error={run.error}
      retry={() => run.refetch()}
      actions={<Link to="/accounting/migration"><Btn variant="secondary" size="md">All runs</Btn></Link>}
    >
      {detail && (
        <Card title="Run" testId="run-summary-card">
          <KeyValue label="Run id" value={<span className="font-mono">{detail.runId}</span>} testId="run-id" />
          <KeyValue label="State" value={<Badge variant={stateVariant(detail.state)}>{detail.state}</Badge>} testId="run-state" />
          <KeyValue label="Mode" value={detail.mode} testId="run-mode" />
          <KeyValue label="Legal entity" value={detail.legalEntityId} testId="run-le" />
          <KeyValue label="Transformation version" value={<span className="font-mono">{detail.transformationVersion}</span>} testId="run-version" />
          <KeyValue label="Freeze attested" value={detail.frozenAt ? new Date(detail.frozenAt).toLocaleString() : 'Not attested'} testId="run-frozen" />
          <KeyValue label="Prepared by" value={detail.preparedBy ?? '—'} />
          <KeyValue label="Approved by" value={detail.approvedBy ?? '—'} />
          <KeyValue label="Rolled back" value={detail.rolledBackAt ? new Date(detail.rolledBackAt).toLocaleString() : '—'} />
        </Card>
      )}

      <Card title="Cutover readiness" testId="readiness-card">
        {!readiness ? (
          <p className="text-[13px] text-slate-500">Readiness is computed by the service once the run exists.</p>
        ) : (
          <>
            <div className="mb-3">
              <Badge variant={readiness.ready ? 'success' : 'warning'} data-testid="readiness-verdict">
                {readiness.ready ? 'READY_FOR_CUTOVER prerequisites met' : `${(readiness.unmet ?? []).length} prerequisite(s) unmet`}
              </Badge>
            </div>
            <Table testId="readiness-table" headers={['Prerequisite', 'Status']}>
              {Object.keys(READINESS_LABELS).map((key) => {
                const unmet = (readiness.unmet ?? []).some((u: string) => u.includes(key));
                return (
                  <tr key={key} data-testid={`readiness-${key}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4">{READINESS_LABELS[key]}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={unmet ? 'warning' : 'success'}>{unmet ? 'UNMET' : 'MET'}</Badge>
                    </td>
                  </tr>
                );
              })}
            </Table>
            {(readiness.unmet ?? []).length > 0 && (
              <Banner kind="warning" title="Cutover is blocked" testId="readiness-unmet">
                <ul className="text-[12.5px] list-disc pl-4">
                  {(readiness.unmet ?? []).map((u: string) => <li key={u}>{u}</li>)}
                </ul>
              </Banner>
            )}
            {readiness.ce15Detail && (
              <p className="text-[11.5px] text-slate-500 mt-2" data-testid="ce15-detail">CE-15: {readiness.ce15Detail}</p>
            )}
          </>
        )}
      </Card>

      <Card title="Stage a dataset" testId="stage-card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-[12px] text-slate-600">
            Snapshot id
            <input
              data-testid="stage-snapshot-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={stageForm.snapshotId}
              onChange={(e) => setStageForm({ ...stageForm, snapshotId: e.target.value })}
            />
          </label>
          <label className="text-[12px] text-slate-600">
            Mapping set id
            <input
              data-testid="stage-mapping-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={stageForm.mappingSetId}
              onChange={(e) => setStageForm({ ...stageForm, mappingSetId: e.target.value })}
            />
          </label>
          <label className="text-[12px] text-slate-600">
            Dataset type
            <select
              data-testid="stage-dataset-type"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={stageForm.datasetType}
              onChange={(e) => setStageForm({ ...stageForm, datasetType: e.target.value })}
            >
              {DATASET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Btn
              variant="primary"
              size="md"
              data-testid="stage-btn"
              loading={stage.isPending}
              disabled={!stageForm.snapshotId.trim() || !stageForm.mappingSetId.trim()}
              onClick={() => stage.mutate()}
            >
              Stage
            </Btn>
          </div>
        </div>
        <MutationError error={stage.error} testId="stage-error" />
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn variant="secondary" size="md" data-testid="validate-btn" loading={validate.isPending} onClick={() => validate.mutate()}>
            Validate (G1–G5)
          </Btn>
          <Btn variant="primary" size="md" data-testid="promote-btn" loading={promote.isPending} onClick={() => promote.mutate()}>
            Promote through CE-07
          </Btn>
          <Link to={`/accounting/migration/exceptions?runId=${runId}`}><Btn variant="ghost" size="md">Exceptions</Btn></Link>
          <Link to={`/accounting/migration/reconcile?runId=${runId}`}><Btn variant="ghost" size="md">Lineage</Btn></Link>
        </div>
        <MutationError error={validate.error} testId="validate-error" />
        <MutationError error={promote.error} testId="promote-error" />
        {pendingUpstream.length > 0 && (
          <Banner kind="warning" title="Upstream migration contract not yet reconciled" testId="promote-pending-upstream">
            <ul className="text-[12.5px] list-disc pl-4">
              {pendingUpstream.map((r: any, i: number) => (
                <li key={i}>{r.datasetType ?? r.moduleCode}: {r.detail ?? PENDING_UPSTREAM}</li>
              ))}
            </ul>
          </Banner>
        )}
      </Card>

      <Card title="Staged datasets" testId="datasets-card">
        {datasets.length === 0 ? (
          <EmptyState testId="datasets-empty" title="Nothing staged" message="Stage an extract against a frozen mapping set to populate controlled staging." />
        ) : (
          <Table
            testId="datasets-table"
            headers={['Type', 'State', 'Rows', 'Accepted', 'Rejected', 'Skipped', 'Debit', 'Credit', 'Checksum']}
          >
            {datasets.map((d) => (
              <tr key={d.id} data-testid={`dataset-row-${d.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{d.datasetType}</td>
                <td className="py-2 pr-4"><Badge variant={stateVariant(d.state)}>{d.state}</Badge></td>
                <td className="py-2 pr-4">{d.rowCount}</td>
                <td className="py-2 pr-4">{d.acceptedCount}</td>
                <td className="py-2 pr-4">{d.rejectedCount}</td>
                <td className="py-2 pr-4">{d.skippedCount}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{money(d.totalDebit)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{money(d.totalCredit)}</td>
                <td className="py-2 pr-4 font-mono text-[11px]">{String(d.controlChecksum ?? '').slice(0, 12)}…</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Gates G1–G5" testId="gates-card">
        {gates.isLoading && <p className="text-[13px] text-slate-500" data-testid="gates-loading">Loading gates…</p>}
        {gates.error && <MutationError error={gates.error} testId="gates-error" />}
        {!gates.isLoading && !gates.error && (gates.data?.items ?? []).length === 0 && (
          <EmptyState testId="gates-empty" title="No gate evaluations" message="Validate a staged dataset to evaluate G1 through G5." />
        )}
        {(gates.data?.items ?? []).length > 0 && (
          <Table testId="gates-table" headers={['Gate', 'Result', 'Evaluated', 'Detail']}>
            {(gates.data?.items ?? []).map((g: any) => (
              <tr key={g.id} data-testid={`gate-row-${g.gateCode}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{g.gateCode}</td>
                <td className="py-2 pr-4"><Badge variant={stateVariant(g.result)} data-testid={`gate-result-${g.gateCode}`}>{g.result}</Badge></td>
                <td className="py-2 pr-4 text-[12px]">{g.evaluatedAt ? new Date(g.evaluatedAt).toLocaleString() : '—'}</td>
                <td className="py-2 pr-4 font-mono text-[11px] max-w-lg truncate">{JSON.stringify(g.details)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Control totals" testId="control-totals-card">
        <SectionLabel>Captured at each phase by the service; the browser only formats them</SectionLabel>
        {(totals.data?.items ?? []).length === 0 ? (
          <EmptyState testId="control-totals-empty" title="No control totals" message="Control totals are captured when a dataset is extracted, staged, transformed and loaded." />
        ) : (
          <Table
            testId="control-totals-table"
            headers={['Phase', 'Rows', 'Accepted', 'Rejected', 'Debit', 'Credit', 'Open items', 'Exceptions', 'Duplicates']}
          >
            {(totals.data?.items ?? []).map((t: any) => (
              <tr key={t.id} data-testid={`control-total-${t.phase}-${t.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{t.phase}</td>
                <td className="py-2 pr-4">{t.rowCount}</td>
                <td className="py-2 pr-4">{t.acceptedCount}</td>
                <td className="py-2 pr-4">{t.rejectedCount}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{money(t.totalDebit)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{money(t.totalCredit)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{money(t.openItemTotal)}</td>
                <td className="py-2 pr-4">{t.exceptionCount}</td>
                <td className="py-2 pr-4">{t.duplicateCount}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Run audit" testId="run-audit-card">
        {audit.error && <MutationError error={audit.error} testId="run-audit-error" />}
        {!audit.error && (audit.data?.items ?? []).length === 0 && (
          <EmptyState testId="run-audit-empty" title="No audit entries" message="Every state transition and governed action is recorded here." />
        )}
        {(audit.data?.items ?? []).length > 0 && (
          <Table testId="run-audit-table" headers={['When', 'Action', 'Actor', 'From', 'To', 'Reason']}>
            {(audit.data?.items ?? []).map((a: any) => (
              <tr key={a.id} data-testid={`audit-row-${a.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 text-[12px]">{a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">{a.action}</td>
                <td className="py-2 pr-4 text-[12px]">{a.actor}</td>
                <td className="py-2 pr-4 text-[12px]">{a.fromState ?? '—'}</td>
                <td className="py-2 pr-4 text-[12px]">{a.toState ?? '—'}</td>
                <td className="py-2 pr-4 text-[12px]">{a.reason ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </MigrationPage>
  );
}
