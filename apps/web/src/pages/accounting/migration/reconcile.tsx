/**
 * CE-16 Reconciliation & Lineage — S129/S130.
 *
 * The drill path the auditor actually asks for: a source row, the staging
 * record it became, the mapping decision that shaped it, the posting execution
 * that made it authoritative, the journal it landed in and the open item or
 * reconciliation it now supports.
 */
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { EmptyState, SectionLabel } from '../../../components/report';
import {
  MigrationPage, Card, Table, KeyValue, MutationError, stateVariant, money, NoRuns, useRunIdFromQuery,
} from './shared';

export default function MigrationReconcile() {
  const queryRunId = useRunIdFromQuery();
  const [runId, setRunId] = useState(queryRunId ?? '');
  const [sourceRowRef, setSourceRowRef] = useState('');
  const [journalRef, setJournalRef] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const runs = useQuery({ queryKey: ['migration', 'runs'], queryFn: () => migrationApi.listRuns(), retry: false });

  const totals = useQuery({
    queryKey: ['migration', 'control-totals', runId],
    queryFn: () => migrationApi.listControlTotals(runId),
    enabled: Boolean(runId),
    retry: false,
  });

  const gates = useQuery({
    queryKey: ['migration', 'gates', runId],
    queryFn: () => migrationApi.listGates(runId),
    enabled: Boolean(runId),
    retry: false,
  });

  const lineage = useQuery({
    queryKey: ['migration', 'lineage', runId, sourceRowRef, journalRef],
    queryFn: () => migrationApi.listLineage(runId, {
      sourceRowRef: sourceRowRef.trim() || undefined,
      journalRef: journalRef.trim() || undefined,
    }),
    enabled: Boolean(runId),
    retry: false,
  });

  const lineageItems: any[] = lineage.data?.items ?? [];
  const g2 = (gates.data?.items ?? []).find((g: any) => g.gateCode === 'G2');

  return (
    <MigrationPage
      title="Reconciliation & Lineage"
      story="S129 · S130"
      subtitle="Source row → staging → mapping → posting → journal → schedule"
      testId="migration-reconcile"
      permission="migration.reconcile.view"
      loading={runs.isLoading}
      error={runs.error}
      retry={() => runs.refetch()}
    >
      <Card
        title="Run"
        testId="reconcile-run-card"
        actions={
          <select
            data-testid="reconcile-run-select"
            className="border border-slate-300 rounded px-2 py-1 text-[12px]"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
          >
            <option value="">Select a run…</option>
            {(runs.data?.items ?? []).map((r: any) => <option key={r.id} value={r.runId}>{r.runId}</option>)}
          </select>
        }
      >
        {!runId ? <NoRuns testId="reconcile-no-run" /> : (
          <>
            <KeyValue
              label="G2 subledger conservation"
              value={g2 ? <Badge variant={stateVariant(g2.result)}>{g2.result}</Badge> : <span className="text-slate-500">Not evaluated</span>}
              testId="reconcile-g2"
            />
            {g2 && (
              <p className="text-[11.5px] text-slate-500 mt-1 font-mono break-all" data-testid="reconcile-g2-detail">
                {JSON.stringify(g2.details)}
              </p>
            )}
          </>
        )}
      </Card>

      {runId && (
        <Card title="Control totals by phase" testId="reconcile-totals-card">
          <SectionLabel>Extract → staging → transform → load. Conservation is asserted by the service.</SectionLabel>
          {totals.error && <MutationError error={totals.error} testId="reconcile-totals-error" />}
          {!totals.error && (totals.data?.items ?? []).length === 0 && (
            <EmptyState testId="reconcile-totals-empty" title="No control totals" message="Stage a dataset to capture control totals for this run." />
          )}
          {(totals.data?.items ?? []).length > 0 && (
            <Table
              testId="reconcile-totals-table"
              headers={['Phase', 'Rows', 'Accepted', 'Rejected', 'Debit', 'Credit', 'Open items', 'Schedule balance', 'Captured']}
            >
              {(totals.data?.items ?? []).map((t: any) => (
                <tr key={t.id} data-testid={`reconcile-total-${t.id}`} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4 font-mono text-[12px]">{t.phase}</td>
                  <td className="py-2 pr-4">{t.rowCount}</td>
                  <td className="py-2 pr-4">{t.acceptedCount}</td>
                  <td className="py-2 pr-4">{t.rejectedCount}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{money(t.totalDebit)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{money(t.totalCredit)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{money(t.openItemTotal)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{money(t.scheduleBalance)}</td>
                  <td className="py-2 pr-4 text-[12px]">{t.capturedAt ? new Date(t.capturedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {runId && (
        <Card
          title="Lineage drill"
          testId="lineage-card"
          actions={
            <div className="flex gap-2">
              <input
                data-testid="lineage-source-filter"
                className="border border-slate-300 rounded px-2 py-1 text-[12px]"
                placeholder="source row ref"
                value={sourceRowRef}
                onChange={(e) => setSourceRowRef(e.target.value)}
              />
              <input
                data-testid="lineage-journal-filter"
                className="border border-slate-300 rounded px-2 py-1 text-[12px]"
                placeholder="journal ref"
                value={journalRef}
                onChange={(e) => setJournalRef(e.target.value)}
              />
            </div>
          }
        >
          {lineage.isLoading && <p className="text-[13px] text-slate-500" data-testid="lineage-loading">Loading lineage…</p>}
          {lineage.error && <MutationError error={lineage.error} testId="lineage-error" />}
          {!lineage.isLoading && !lineage.error && lineageItems.length === 0 && (
            <EmptyState
              testId="lineage-empty"
              title="No lineage records"
              message="Lineage is opened when a row is staged and extended when it is promoted through governed posting."
            />
          )}
          {lineageItems.length > 0 && (
            <Table
              testId="lineage-table"
              headers={['Source system', 'Source file', 'Source row', 'Staging record', 'Transformation', 'Target', 'Journal', '']}
            >
              {lineageItems.map((l) => (
                <Fragment key={l.id}>
                  <tr data-testid={`lineage-row-${l.id}`} className="border-b border-slate-100">
                    <td className="py-2 pr-4 font-mono text-[11px]">{l.sourceSystemRef ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[11px]">{l.sourceFileRef ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[11px]">{l.sourceRowRef ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[11px]">{l.stagingRecordId ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[11px]">{l.transformationVersion ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[11px]">
                      {l.targetRecordId ? `${l.targetRecordType}: ${l.targetRecordId}` : <Badge variant="neutral">Not promoted</Badge>}
                    </td>
                    <td className="py-2 pr-4 font-mono text-[11px]" data-testid={`lineage-journal-${l.id}`}>{l.journalRef ?? '—'}</td>
                    <td className="py-2 pr-4">
                      <Btn variant="ghost" size="sm" data-testid={`lineage-expand-${l.id}`} onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                        {expanded === l.id ? 'Hide' : 'Drill'}
                      </Btn>
                    </td>
                  </tr>
                  {expanded === l.id && (
                    <tr data-testid={`lineage-detail-${l.id}`}>
                      <td colSpan={8} className="py-3 pr-4 bg-slate-50">
                        <KeyValue label="Mapping decision" value={<span className="font-mono">{l.mappingDecisionRef ?? '—'}</span>} />
                        <KeyValue label="Posting execution" value={<span className="font-mono">{l.postingExecutionRef ?? '—'}</span>} />
                        <KeyValue label="Journal" value={<span className="font-mono">{l.journalRef ?? '—'}</span>} />
                        <KeyValue label="Open item" value={<span className="font-mono">{l.openItemRef ?? '—'}</span>} />
                        <KeyValue label="Reconciliation" value={<span className="font-mono">{l.reconciliationRef ?? '—'}</span>} />
                        <KeyValue label="Evidence" value={<span className="font-mono text-[11px] break-all">{JSON.stringify(l.evidence ?? {})}</span>} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </Table>
          )}
          <p className="text-[11px] text-slate-500 mt-3">
            Reversal lineage is recorded as an additional row; original lineage is never modified or deleted.
          </p>
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
