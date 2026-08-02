import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Badge, Btn, EmptyState } from '../../../components/ui';
import DataTable from '../../../components/DataTable';

function statusVariant(status: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  return status === 'RECONCILED' ? 'success' : status === 'IN_REVIEW' ? 'info' : 'neutral';
}

export default function ReconciliationRegister() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['recon-register'],
    queryFn: () => closeApi.listRegister(),
    retry: false,
  });

  const signOffMutation = useMutation({
    mutationFn: (id: string) => closeApi.signOffRegister(id, { reviewerId: 'current-user' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recon-register'] }),
  });

  if (isLoading) return <PageLoader page="Reconciliation Register" service="close-service" port={3052} />;
  if (error) return <PageError error={error as Error} serviceName="close-service" port={3052} retry={refetch} />;

  const items: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Reconciliation Register (S115)" subtitle="Manage account reconciliations for the close period." actions={<Btn variant="secondary" size="md" onClick={() => refetch()}>Refresh</Btn>} />
      {items.length === 0 ? (
        <EmptyState icon="📋" title="No reconciliation items" description="No reconciliation items exist for this period." />
      ) : (
        <DataTable
          columns={[
            { key: 'moduleCode', label: 'Module' },
            { key: 'accountCode', label: 'Account Code' },
            { key: 'status', label: 'Status', render: (r) => <Badge variant={statusVariant(r.status)}>{r.status}</Badge> },
            { key: 'actions', label: 'Actions', render: (r) => (
              <Btn variant="secondary" size="md" onClick={() => signOffMutation.mutate(r.id)} loading={signOffMutation.isPending}>Sign Off</Btn>
            )},
          ]}
          data={items}
          emptyIcon="📋"
          emptyTitle="No items"
        />
      )}
    </div>
  );
}
