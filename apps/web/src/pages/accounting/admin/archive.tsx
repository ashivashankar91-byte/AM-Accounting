import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Btn, EmptyState, Badge } from '../../../components/ui';
import DataTable from '../../../components/DataTable';

export default function WormArchiveBrowser() {
  const queryClient = useQueryClient();
  const [recordClass, setRecordClass] = useState('JOURNAL');
  const [retentionDays, setRetentionDays] = useState('2555');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['archive-objects-browser'],
    queryFn: () => closeApi.listArchiveObjects(),
    retry: false,
  });

  const createRetentionMutation = useMutation({
    mutationFn: () => closeApi.createRetentionSchedule({ recordClass, retentionDays: parseInt(retentionDays), effectiveFrom: new Date().toISOString() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['archive-objects-browser'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => closeApi.deleteArchiveObject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['archive-objects-browser'] }),
  });

  if (isLoading) return <PageLoader page="WORM Archive Browser" service="close-service" port={3052} />;
  if (error) return <PageError error={error as Error} serviceName="close-service" port={3052} retry={refetch} />;

  const objects: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="WORM Archive Browser (S017)" subtitle="Browse and manage WORM-protected archive objects." actions={<Btn variant="secondary" size="md" onClick={() => refetch()}>Refresh</Btn>} />

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm max-w-md">
        <h2 className="font-bold mb-4">Create Retention Schedule</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Record Class</label>
            <input className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm" value={recordClass} onChange={e => setRecordClass(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Retention Days</label>
            <input type="number" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm" value={retentionDays} onChange={e => setRetentionDays(e.target.value)} />
          </div>
          <Btn variant="primary" size="md" onClick={() => createRetentionMutation.mutate()} loading={createRetentionMutation.isPending}>Save Schedule</Btn>
        </div>
      </div>

      {objects.length === 0 ? (
        <EmptyState icon="🗄️" title="No archive objects" description="No WORM archive objects have been created." />
      ) : (
        <DataTable
          columns={[
            { key: 'objectKey', label: 'Object Key', render: r => <span className="font-mono text-xs">{r.objectKey}</span> },
            { key: 'objectClass', label: 'Class' },
            { key: 'retentionClass', label: 'Retention' },
            { key: 'isHeld', label: 'Hold', render: r => <Badge variant={r.isHeld ? 'success' : 'neutral'}>{r.isHeld ? 'HELD' : 'RELEASED'}</Badge> },
            { key: 'sizeBytes', label: 'Size', render: r => `${Number(r.sizeBytes).toLocaleString()} B` },
            { key: 'actions', label: '', render: r => !r.isHeld ? (
              <Btn variant="danger" size="md" onClick={() => deleteMutation.mutate(r.id)} loading={deleteMutation.isPending}>Delete</Btn>
            ) : null },
          ]}
          data={objects}
          emptyIcon="🗄️"
          emptyTitle="No objects"
        />
      )}
    </div>
  );
}
