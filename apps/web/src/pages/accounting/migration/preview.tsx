/**
 * CE-16 Transformation Preview — S130.
 *
 * A dry run of the transformation engine: pick an extract and a mapping set and
 * see exactly what would be staged, and which rows would land in the exception
 * queue, before anything is written. Nothing on this screen mutates state.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { Banner, EmptyState, SectionLabel } from '../../../components/report';
import { MigrationPage, Card, Table, KeyValue, MutationError, stateVariant, useRunIdFromQuery } from './shared';

export default function MigrationPreview() {
  const queryRunId = useRunIdFromQuery();
  const [runId, setRunId] = useState(queryRunId ?? '');
  const [snapshotId, setSnapshotId] = useState('');
  const [mappingSetId, setMappingSetId] = useState('');
  const [submitted, setSubmitted] = useState<{ runId: string; snapshotId: string; mappingSetId: string } | null>(null);

  const runs = useQuery({ queryKey: ['migration', 'runs'], queryFn: () => migrationApi.listRuns(), retry: false });
  const sets = useQuery({ queryKey: ['migration', 'mapping-sets'], queryFn: () => migrationApi.listMappingSets(), retry: false });

  const preview = useQuery({
    queryKey: ['migration', 'preview', submitted],
    queryFn: () => migrationApi.preview(submitted!.runId, {
      snapshotId: submitted!.snapshotId,
      mappingSetId: submitted!.mappingSetId,
      limit: 25,
    }),
    enabled: Boolean(submitted),
    retry: false,
  });

  const data = preview.data;
  const canSubmit = runId.trim() && snapshotId.trim() && mappingSetId.trim();

  return (
    <MigrationPage
      title="Transformation Preview"
      story="S130"
      subtitle="See what would be staged before anything is written"
      testId="migration-preview"
      permission="migration.staging.read"
      loading={runs.isLoading}
      error={runs.error}
      retry={() => runs.refetch()}
    >
      <Card title="Preview inputs" testId="preview-inputs-card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-[12px] text-slate-600">
            Run
            <select
              data-testid="preview-run-select"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
            >
              <option value="">Select a run…</option>
              {(runs.data?.items ?? []).map((r: any) => <option key={r.id} value={r.runId}>{r.runId}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-slate-600">
            Snapshot id
            <input
              data-testid="preview-snapshot-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={snapshotId}
              onChange={(e) => setSnapshotId(e.target.value)}
            />
          </label>
          <label className="text-[12px] text-slate-600">
            Mapping set
            <select
              data-testid="preview-mapping-select"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={mappingSetId}
              onChange={(e) => setMappingSetId(e.target.value)}
            >
              <option value="">Select a mapping set…</option>
              {(sets.data?.items ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>v{s.version} · {s.status}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Btn
              variant="primary"
              size="md"
              data-testid="preview-run-btn"
              disabled={!canSubmit}
              loading={preview.isFetching}
              onClick={() => setSubmitted({ runId: runId.trim(), snapshotId: snapshotId.trim(), mappingSetId: mappingSetId.trim() })}
            >
              Preview transformation
            </Btn>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mt-3" data-testid="preview-readonly-note">
          Preview is read-only. It never writes to staging and never marks a source row consumed.
        </p>
      </Card>

      {!submitted && (
        <EmptyState
          testId="preview-empty"
          title="No preview requested"
          message="Choose a run, an extract and a mapping set to see the transformation output."
        />
      )}

      {submitted && preview.isLoading && (
        <p className="text-[13px] text-slate-500" data-testid="preview-loading">Running the transformation engine…</p>
      )}
      {submitted && preview.error && <MutationError error={preview.error} testId="preview-error" />}

      {data && (
        <>
          <Card title="Transformation summary" testId="preview-summary-card">
            <KeyValue label="Transformation version" value={<span className="font-mono">{data.transformationVersion}</span>} testId="preview-version" />
            <KeyValue label="Mapping set status" value={<Badge variant={stateVariant(data.mappingSetStatus)}>{data.mappingSetStatus}</Badge>} testId="preview-mapping-status" />
            <KeyValue label="Source rows read" value={data.previewedRows} testId="preview-rows-read" />
            <KeyValue label="Rows that would stage" value={data.transformedCount} testId="preview-transformed" />
            <KeyValue label="Rows that would raise an exception" value={data.exceptionCount} testId="preview-exceptions-count" />
            {data.mappingSetStatus !== 'FROZEN' && (
              <Banner kind="warning" title="Mapping set is not frozen" testId="preview-not-frozen">
                <span className="text-[12.5px]">
                  A preview may run against a draft, but staging requires a frozen mapping set so the run stays
                  reproducible against a pinned version.
                </span>
              </Banner>
            )}
          </Card>

          <Card title="Transformed rows" testId="preview-rows-card">
            <SectionLabel>Deterministic output — the same extract and version always produce this result</SectionLabel>
            {(data.rows ?? []).length === 0 ? (
              <EmptyState testId="preview-rows-empty" title="No rows would stage" message="Every source row in this extract was diverted to the exception queue." />
            ) : (
              <Table testId="preview-rows-table" headers={['Source row', 'Row hash', 'Staged data', 'Validation errors']}>
                {(data.rows ?? []).map((r: any) => (
                  <tr key={r.sourceRowId} data-testid={`preview-row-${r.sourceRowId}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 font-mono text-[11px]">{r.sourceRowId}</td>
                    <td className="py-2 pr-4 font-mono text-[11px]">{String(r.rowHash ?? '').slice(0, 16)}…</td>
                    <td className="py-2 pr-4 font-mono text-[11px] max-w-lg truncate">{JSON.stringify(r.stagedData)}</td>
                    <td className="py-2 pr-4 text-[12px] text-red-600">
                      {(r.validationErrors ?? []).length === 0 ? '—' : JSON.stringify(r.validationErrors)}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="Would-be exceptions" testId="preview-exceptions-card">
            {(data.exceptions ?? []).length === 0 ? (
              <EmptyState testId="preview-exceptions-empty" title="No exceptions" message="Every source row has an unambiguous, mapped disposition." />
            ) : (
              <Table testId="preview-exceptions-table" headers={['Type', 'Source field', 'Source value', 'Reason']}>
                {(data.exceptions ?? []).map((e: any, i: number) => (
                  <tr key={i} data-testid={`preview-exception-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4"><Badge variant="warning">{e.exceptionType}</Badge></td>
                    <td className="py-2 pr-4 font-mono text-[12px]">{e.sourceField ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[12px]">{e.sourceValue ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px]">{e.reason}</td>
                  </tr>
                ))}
              </Table>
            )}
            <p className="text-[11px] text-slate-500 mt-3">
              A legacy field whose meaning is ambiguous, invalid or unmapped is never guessed — it is queued for a human decision.
            </p>
          </Card>
        </>
      )}
    </MigrationPage>
  );
}
