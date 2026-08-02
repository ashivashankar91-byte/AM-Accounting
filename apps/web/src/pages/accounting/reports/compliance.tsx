import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Btn, EmptyState, Badge } from '../../../components/ui';
import DataTable from '../../../components/DataTable';

export default function CompliancePack() {
  const queryClient = useQueryClient();
  const [legalEntityId] = useState('default');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['compliance-packs'],
    queryFn: () => closeApi.listCompliancePacks(),
    retry: false,
  });

  const generateMutation = useMutation({
    mutationFn: () => closeApi.generateCompliancePack({ legalEntityId, periodYear: new Date().getFullYear(), periodMonth: new Date().getMonth() + 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['compliance-packs'] }),
  });

  if (isLoading) return <PageLoader page="Compliance Pack" service="close-service" port={3052} />;
  if (error) return <PageError error={error as Error} serviceName="close-service" port={3052} retry={refetch} />;

  const packs: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Compliance Pack (S123)" subtitle="Generate and manage statutory compliance packages." actions={<Btn variant="primary" size="md" onClick={() => generateMutation.mutate()} loading={generateMutation.isPending}>Generate Pack</Btn>} />
      {packs.length === 0 ? (
        <EmptyState icon="📑" title="No compliance packs" description="Generate a compliance pack to get started." />
      ) : (
        <DataTable
          columns={[
            { key: 'id', label: 'ID', render: r => <span className="font-mono text-xs">{r.id}</span> },
            { key: 'status', label: 'Status', render: r => <Badge variant={r.status === 'GENERATED' ? 'success' : 'neutral'}>{r.status}</Badge> },
            { key: 'generatedAt', label: 'Generated', render: r => new Date(r.generatedAt).toLocaleDateString() },
          ]}
          data={packs}
          emptyIcon="📑"
          emptyTitle="No packs"
        />
      )}
    </div>
  );
}
