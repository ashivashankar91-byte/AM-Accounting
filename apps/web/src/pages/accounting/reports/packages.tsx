import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Btn, EmptyState, Badge } from '../../../components/ui';
import DataTable from '../../../components/DataTable';

export default function StatementPackages() {
  const queryClient = useQueryClient();
  const [capturing, setCapturing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['archive-objects'],
    queryFn: () => closeApi.listArchiveObjects(),
    retry: false,
  });

  const captureMutation = useMutation({
    mutationFn: () => closeApi.captureSnapshot({
      legalEntityId: 'default',
      periodYear: new Date().getFullYear(),
      periodMonth: new Date().getMonth() + 1,
      statementType: 'BS',
      definitionVersion: '1.0',
      sourceTbHash: 'hash-placeholder',
      journalLineage: [],
    }),
    onSuccess: () => { setCapturing(false); queryClient.invalidateQueries({ queryKey: ['archive-objects'] }); },
  });

  if (isLoading) return <PageLoader page="Statement Packages" service="close-service" port={3052} />;
  if (error) return <PageError error={error as Error} serviceName="close-service" port={3052} retry={refetch} />;

  const items: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Statement Packages (S120)" subtitle="Capture and sign financial statement snapshots." actions={<Btn variant="primary" size="md" onClick={() => captureMutation.mutate()} loading={captureMutation.isPending}>Capture Snapshot</Btn>} />
      {items.length === 0 ? (
        <EmptyState icon="📦" title="No statement packages" description="Capture a snapshot to begin." />
      ) : (
        <DataTable
          columns={[
            { key: 'id', label: 'ID', render: r => <span className="font-mono text-xs">{r.id?.slice(0, 8)}</span> },
            { key: 'objectClass', label: 'Class' },
            { key: 'retentionClass', label: 'Retention' },
            { key: 'isHeld', label: 'Held', render: r => <Badge variant={r.isHeld ? 'success' : 'neutral'}>{r.isHeld ? 'Yes' : 'No'}</Badge> },
            { key: 'createdAt', label: 'Created', render: r => new Date(r.createdAt).toLocaleDateString() },
          ]}
          data={items}
          emptyIcon="📦"
          emptyTitle="No packages"
        />
      )}
    </div>
  );
}
