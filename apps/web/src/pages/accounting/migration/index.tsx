/**
 * CE-16 Migration Command Center — S129/S130/S131/S132.
 *
 * The single place where a migration run is created and where its position in
 * the DISCOVERED → CUTOVER_COMPLETE lifecycle is stated without embellishment.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { EmptyState } from '../../../components/report';
import {
  MigrationPage, Card, Table, KeyValue, MutationError, stateVariant, MIGRATION_STATES,
} from './shared';

const MODES = ['REHEARSAL', 'PARALLEL', 'CUTOVER'] as const;

export default function MigrationCommandCenter() {
  const qc = useQueryClient();
  const [stateFilter, setStateFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ legalEntityId: '', mode: 'REHEARSAL', transformationVersion: 'v1', runId: '' });

  const runs = useQuery({
    queryKey: ['migration', 'runs', stateFilter],
    queryFn: () => migrationApi.listRuns(stateFilter ? { state: stateFilter } : {}),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => migrationApi.createRun({
      legalEntityId: form.legalEntityId.trim(),
      mode: form.mode,
      transformationVersion: form.transformationVersion.trim(),
      runId: form.runId.trim() || undefined,
    }),
    onSuccess: () => {
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['migration', 'runs'] });
    },
  });

  const items: any[] = runs.data?.items ?? [];
  const byState = MIGRATION_STATES.map((s) => ({ state: s, count: items.filter((r) => r.state === s).length }))
    .filter((x) => x.count > 0);

  return (
    <MigrationPage
      title="Accounting Migration"
      story="S129 · S130 · S131 · S132"
      subtitle="Legacy conversion, item-level schedules, parallel run and cutover"
      testId="migration-command-center"
      permission="migration.run.read"
      loading={runs.isLoading}
      error={runs.error}
      retry={() => runs.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="new-run-btn" onClick={() => setShowCreate((v) => !v)}>
          New run
        </Btn>
      }
    >
      {showCreate && (
        <Card title="Create migration run" testId="create-run-panel">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="text-[12px] text-slate-600">
              Legal entity
              <input
                data-testid="create-run-le"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={form.legalEntityId}
                onChange={(e) => setForm({ ...form, legalEntityId: e.target.value })}
                placeholder="legal entity id"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Mode
              <select
                data-testid="create-run-mode"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
              >
                {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              Transformation version
              <input
                data-testid="create-run-version"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={form.transformationVersion}
                onChange={(e) => setForm({ ...form, transformationVersion: e.target.value })}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Run id (optional)
              <input
                data-testid="create-run-id"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={form.runId}
                onChange={(e) => setForm({ ...form, runId: e.target.value })}
                placeholder="auto-generated when blank"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Btn
              variant="primary"
              size="md"
              data-testid="create-run-submit"
              loading={create.isPending}
              disabled={!form.legalEntityId.trim() || !form.transformationVersion.trim()}
              onClick={() => create.mutate()}
            >
              Create run
            </Btn>
            <Btn variant="ghost" size="md" onClick={() => setShowCreate(false)}>Cancel</Btn>
          </div>
          <MutationError error={create.error} testId="create-run-error" />
        </Card>
      )}

      <Card title="Lifecycle" testId="lifecycle-summary">
        {byState.length === 0 ? (
          <p className="text-[13px] text-slate-500" data-testid="lifecycle-empty">
            No runs exist yet in any migration state.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" data-testid="lifecycle-badges">
            {byState.map((x) => (
              <Badge key={x.state} variant={stateVariant(x.state)}>{x.state}: {x.count}</Badge>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Migration runs"
        testId="runs-card"
        actions={
          <select
            data-testid="runs-state-filter"
            className="border border-slate-300 rounded px-2 py-1 text-[12px]"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">All states</option>
            {MIGRATION_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        }
      >
        {items.length === 0 ? (
          <EmptyState
            testId="runs-empty"
            title="No migration runs"
            message="Create a rehearsal run to begin discovery against a registered legacy source."
          />
        ) : (
          <Table testId="runs-table" headers={['Run', 'Legal entity', 'Mode', 'State', 'Transformation', 'Frozen', 'Created', '']}>
            {items.map((run) => (
              <tr key={run.id} data-testid={`run-row-${run.runId}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{run.runId}</td>
                <td className="py-2 pr-4">{run.legalEntityId}</td>
                <td className="py-2 pr-4">{run.mode}</td>
                <td className="py-2 pr-4">
                  <Badge variant={stateVariant(run.state)} data-testid={`run-state-${run.runId}`}>{run.state}</Badge>
                </td>
                <td className="py-2 pr-4 font-mono text-[12px]">{run.transformationVersion}</td>
                <td className="py-2 pr-4 text-[12px]">{run.frozenAt ? new Date(run.frozenAt).toLocaleString() : '—'}</td>
                <td className="py-2 pr-4 text-[12px]">{run.createdAt ? new Date(run.createdAt).toLocaleDateString() : '—'}</td>
                <td className="py-2 pr-4">
                  <Link to={`/accounting/migration/runs/${run.runId}`} data-testid={`run-open-${run.runId}`}>
                    <Btn variant="secondary" size="sm">Open</Btn>
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Migration principles enforced by the service" testId="principles-card">
        <KeyValue label="Staging only" value="Extraction writes to controlled staging; never to production GL or schedule tables" />
        <KeyValue label="Governed promotion" value="staged → conversion transaction → CE-07 posting → conversion journal" />
        <KeyValue label="Idempotency" value="Reruns are keyed on source-row hash and cannot double-load" />
        <KeyValue label="Lineage" value="source system → file → row → staging → mapping → target → posting → journal" />
        <KeyValue label="Cutover" value="Irreversible; requires dual segregation of duties and an explicit ceremony" />
      </Card>
    </MigrationPage>
  );
}
