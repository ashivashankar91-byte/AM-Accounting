/**
 * CE-16 Exception Queue — S129 gate G5.
 *
 * Nothing ambiguous is silently resolved. Every queued exception must be
 * approved, rejected or corrected with a stated reason before G5 is satisfiable
 * and the run can progress toward cutover.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { Banner, EmptyState } from '../../../components/report';
import { MigrationPage, Card, Table, KeyValue, MutationError, NoRuns, useRunIdFromQuery } from './shared';

const DISPOSITIONS = ['APPROVED', 'REJECTED', 'CORRECTED'] as const;
const TYPES = ['AMBIGUOUS', 'INVALID', 'UNMAPPED', 'DUPLICATE', 'CONSERVATION_FAILED', 'MAPPING_INCOMPLETE'] as const;

export default function MigrationExceptions() {
  const qc = useQueryClient();
  const queryRunId = useRunIdFromQuery();
  const [runId, setRunId] = useState(queryRunId ?? '');
  const [typeFilter, setTypeFilter] = useState('');
  const [dispositionFilter, setDispositionFilter] = useState('');
  const [draft, setDraft] = useState<Record<string, { disposition: string; reason: string }>>({});

  const runs = useQuery({ queryKey: ['migration', 'runs'], queryFn: () => migrationApi.listRuns(), retry: false });

  const exceptions = useQuery({
    queryKey: ['migration', 'exceptions', runId, typeFilter, dispositionFilter],
    queryFn: () => migrationApi.listExceptions(runId, {
      exceptionType: typeFilter || undefined,
      disposition: dispositionFilter || undefined,
    }),
    enabled: Boolean(runId),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const disposition = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => migrationApi.dispositionException(runId, id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migration', 'exceptions'] }),
  });

  const data = exceptions.data;
  const items: any[] = data?.items ?? [];

  return (
    <MigrationPage
      title="Exception Queue"
      story="S129 · Gate G5"
      subtitle="Every ambiguous, invalid or unmapped record needs a stated human decision"
      testId="migration-exceptions"
      permission="migration.exception.view"
      loading={runs.isLoading}
      error={runs.error}
      retry={() => runs.refetch()}
    >
      <Card
        title="Run"
        testId="exceptions-run-card"
        actions={
          <div className="flex flex-wrap gap-2">
            <select
              data-testid="exceptions-run-select"
              className="border border-slate-300 rounded px-2 py-1 text-[12px]"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
            >
              <option value="">Select a run…</option>
              {(runs.data?.items ?? []).map((r: any) => <option key={r.id} value={r.runId}>{r.runId}</option>)}
            </select>
            <select
              data-testid="exceptions-type-filter"
              className="border border-slate-300 rounded px-2 py-1 text-[12px]"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">All types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              data-testid="exceptions-disposition-filter"
              className="border border-slate-300 rounded px-2 py-1 text-[12px]"
              value={dispositionFilter}
              onChange={(e) => setDispositionFilter(e.target.value)}
            >
              <option value="">All dispositions</option>
              <option value="PENDING">PENDING</option>
              {DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        }
      >
        {!runId ? <NoRuns testId="exceptions-no-run" /> : (
          <>
            <KeyValue label="Total exceptions" value={data?.total ?? 0} testId="exceptions-total" />
            <KeyValue label="Blocking and still pending" value={data?.blockingPending ?? 0} testId="exceptions-blocking-pending" />
            <KeyValue
              label="G5 satisfiable"
              value={<Badge variant={data?.g5Satisfiable ? 'success' : 'warning'}>{data?.g5Satisfiable ? 'YES' : 'NO'}</Badge>}
              testId="exceptions-g5"
            />
            {data && !data.g5Satisfiable && (
              <Banner kind="warning" title="Gate G5 is not satisfiable" testId="exceptions-g5-blocked">
                <span className="text-[12.5px]">
                  {data.blockingPending} blocking exception(s) are still pending. The exception queue must be zero or
                  fully dispositioned before this run can reach READY_FOR_CUTOVER.
                </span>
              </Banner>
            )}
          </>
        )}
      </Card>

      {runId && exceptions.isLoading && <p className="text-[13px] text-slate-500" data-testid="exceptions-loading">Loading exceptions…</p>}
      {runId && exceptions.error && <MutationError error={exceptions.error} testId="exceptions-error" />}

      {runId && !exceptions.isLoading && !exceptions.error && (
        <Card title="Exceptions" testId="exceptions-card">
          {items.length === 0 ? (
            <EmptyState
              testId="exceptions-empty"
              title="No exceptions"
              message="No record in this run was ambiguous, invalid, unmapped or duplicated under the pinned mapping version."
            />
          ) : (
            <Table
              testId="exceptions-table"
              headers={['Type', 'Source field', 'Source value', 'Reason', 'Disposition', 'Dispositioned by', 'Action']}
            >
              {items.map((e) => {
                const d = draft[e.id] ?? { disposition: 'APPROVED', reason: '' };
                const pending = e.disposition === 'PENDING';
                return (
                  <tr key={e.id} data-testid={`exception-row-${e.id}`} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="py-2 pr-4"><Badge variant="warning">{e.exceptionType}</Badge></td>
                    <td className="py-2 pr-4 font-mono text-[12px]">{e.sourceField ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`exception-value-${e.id}`}>{e.sourceValue ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px] max-w-xs">{e.reason}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={e.disposition === 'PENDING' ? 'warning' : 'success'} data-testid={`exception-disposition-${e.id}`}>
                        {e.disposition}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-[12px]">{e.dispositionedBy ?? '—'}</td>
                    <td className="py-2 pr-4">
                      {pending ? (
                        <div className="flex flex-col gap-1">
                          <select
                            data-testid={`exception-select-${e.id}`}
                            className="border border-slate-300 rounded px-1.5 py-1 text-[12px]"
                            value={d.disposition}
                            onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, disposition: ev.target.value } })}
                          >
                            {DISPOSITIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                          <input
                            data-testid={`exception-reason-${e.id}`}
                            className="border border-slate-300 rounded px-1.5 py-1 text-[12px]"
                            placeholder="reason (min 5 chars)"
                            value={d.reason}
                            onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, reason: ev.target.value } })}
                          />
                          <Btn
                            variant="secondary"
                            size="sm"
                            data-testid={`exception-submit-${e.id}`}
                            disabled={d.reason.trim().length < 5}
                            onClick={() => disposition.mutate({ id: e.id, body: { disposition: d.disposition, reason: d.reason.trim() } })}
                          >
                            Disposition
                          </Btn>
                        </div>
                      ) : (
                        <span className="text-[12px] text-slate-500">{e.dispositionReason ?? '—'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
          <MutationError error={disposition.error} testId="exception-disposition-error" />
        </Card>
      )}
    </MigrationPage>
  );
}
