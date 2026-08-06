import { useQuery } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Badge, EmptyState } from '../../../components/ui';
import DataTable from '../../../components/DataTable';

function statusVariant(status: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'DONE': return 'success';
    case 'IN_PROGRESS': return 'info';
    case 'BLOCKED': return 'danger';
    default: return 'neutral';
  }
}

export default function CloseCalendar() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['close-register-calendar'],
    queryFn: () => closeApi.listRegister(),
    retry: false,
  });

  if (isLoading) return <PageLoader page="Close Calendar" service="close-service" port={3052} />;
  if (error) return <PageError error={error as Error} serviceName="close-service" port={3052} retry={refetch} />;

  const tasks: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Close Calendar & Task Board (S114)" subtitle="Close tasks and due dates for the current period." />
      {tasks.length === 0 ? (
        <EmptyState icon="📅" title="No tasks found" description="No close tasks exist for this period." />
      ) : (
        <DataTable
          columns={[
            { key: 'id', label: 'ID', render: (r) => <span className="font-mono text-xs">{r.id?.slice(0, 8)}</span> },
            { key: 'moduleCode', label: 'Module' },
            { key: 'accountCode', label: 'Account' },
            { key: 'status', label: 'Status', render: (r) => <Badge variant={statusVariant(r.status)}>{r.status}</Badge> },
          ]}
          data={tasks}
          emptyIcon="📅"
          emptyTitle="No tasks"
        />
      )}
    </div>
  );
}
