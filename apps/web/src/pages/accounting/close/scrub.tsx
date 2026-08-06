import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Badge, Btn, EmptyState } from '../../../components/ui';
import DataTable from '../../../components/DataTable';

function severityVariant(sev: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (sev) {
    case 'CRITICAL': case 'ERROR': return 'danger';
    case 'WARNING': return 'warning';
    case 'INFO': return 'info';
    default: return 'neutral';
  }
}

export default function PreCloseScrub() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: runs, isLoading, error, refetch } = useQuery({
    queryKey: ['scrub-runs'],
    queryFn: () => closeApi.listScrubRuns(),
    retry: false,
  });

  const { data: findings, isLoading: findingsLoading } = useQuery({
    queryKey: ['scrub-findings', selectedRunId],
    queryFn: () => closeApi.getScrubFindings(selectedRunId!),
    enabled: !!selectedRunId,
  });

  const runScrubMutation = useMutation({
    mutationFn: () => closeApi.runScrub({ legalEntityId: 'default', periodYear: new Date().getFullYear(), periodMonth: new Date().getMonth() + 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scrub-runs'] }),
  });

  const disposeMutation = useMutation({
    mutationFn: ({ id, action, reason }: any) => closeApi.disposeFinding(id, { action, reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scrub-findings'] }),
  });

  if (isLoading) return <PageLoader page="Pre-Close Scrub" service="close-service" port={3052} />;
  if (error) return <PageError error={error as Error} serviceName="close-service" port={3052} retry={refetch} />;

  const runList: any[] = Array.isArray(runs) ? runs : [];
  const findingList: any[] = Array.isArray(findings) ? findings : [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Pre-Close Scrub (S113)" subtitle="Run and review pre-close validation checks." actions={<Btn variant="primary" size="md" onClick={() => runScrubMutation.mutate()} loading={runScrubMutation.isPending}>Run Scrub</Btn>} />

      {runList.length === 0 ? (
        <EmptyState icon="🔍" title="No scrub runs" description="Run a scrub to validate the period." />
      ) : (
        <DataTable
          columns={[
            { key: 'id', label: 'Run ID', render: (r) => <span className="font-mono text-xs cursor-pointer text-blue-600" onClick={() => setSelectedRunId(r.id)}>{r.id?.slice(0, 8)}</span> },
            { key: 'status', label: 'Status', render: (r) => <Badge variant={r.status === 'COMPLETED' ? 'success' : 'info'}>{r.status}</Badge> },
            { key: 'findingsCount', label: 'Findings' },
            { key: 'createdAt', label: 'Run At', render: (r) => new Date(r.createdAt).toLocaleString() },
          ]}
          data={runList}
          emptyIcon="🔍"
          emptyTitle="No runs"
        />
      )}

      {selectedRunId && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h2 className="font-bold mb-4">Findings for run {selectedRunId.slice(0, 8)}</h2>
          {findingsLoading ? <p>Loading…</p> : findingList.length === 0 ? (
            <p className="text-slate-500 text-sm">No findings for this run.</p>
          ) : (
            <DataTable
              columns={[
                { key: 'ruleCode', label: 'Rule' },
                { key: 'severity', label: 'Severity', render: (r) => <Badge variant={severityVariant(r.severity)}>{r.severity}</Badge> },
                { key: 'description', label: 'Description' },
                { key: 'status', label: 'Status' },
                { key: 'actions', label: 'Actions', render: (r) => r.status === 'OPEN' ? (
                  <Btn variant="secondary" size="md" onClick={() => disposeMutation.mutate({ id: r.id, action: 'OVERRIDE', reason: 'Reviewed' })}>Override</Btn>
                ) : null },
              ]}
              data={findingList}
              emptyIcon="🔍"
              emptyTitle="No findings"
            />
          )}
        </div>
      )}
    </div>
  );
}
