import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Badge, Btn, EmptyState } from '../../../components/ui';

export default function YearEndCeremony() {
  const queryClient = useQueryClient();
  const fiscalYear = new Date().getFullYear() - 1;

  const { data: archives, isLoading, error, refetch } = useQuery({
    queryKey: ['year-end-archive'],
    queryFn: () => closeApi.listArchiveObjects(),
    retry: false,
  });

  const previewMutation = useMutation({
    mutationFn: () => closeApi.previewYearEnd({ legalEntityId: 'default', fiscalYear }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['year-end-archive'] }),
  });

  if (isLoading) return <PageLoader page="Year-End Close Ceremony" service="close-service" port={3052} />;
  if (error) return <PageError error={error as Error} serviceName="close-service" port={3052} retry={refetch} />;

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Year-End Close Ceremony (S116)" subtitle={`Fiscal Year: ${fiscalYear}`} actions={<Btn variant="secondary" size="md" onClick={() => refetch()}>Refresh</Btn>} />

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="font-bold mb-4">Year-End Actions</h2>
        <div className="flex gap-2">
          <Btn variant="primary" size="md" onClick={() => previewMutation.mutate()} loading={previewMutation.isPending}>Preview Year-End</Btn>
        </div>
        {previewMutation.isSuccess && (
          <div className="mt-4">
            <p className="text-sm text-green-700">Preview created successfully.</p>
            <div className="flex gap-2 mt-2">
              <Btn variant="secondary" size="md" onClick={() => closeApi.approveYearEnd((previewMutation.data as any)?.id, {})}>Approve</Btn>
              <Btn variant="secondary" size="md" onClick={() => closeApi.postYearEnd((previewMutation.data as any)?.id, {})}>Post</Btn>
            </div>
          </div>
        )}
      </div>

      {(!archives || (archives as any[]).length === 0) && <EmptyState icon="📅" title="No year-end runs" description="Preview a year-end to get started." />}
    </div>
  );
}
