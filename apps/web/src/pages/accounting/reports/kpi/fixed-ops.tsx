import { useQuery } from '@tanstack/react-query';
import { closeApi } from '../../../../api/client';
import PageLoader from '../../../../components/PageLoader';
import PageError from '../../../../components/PageError';
import { PageHeader, EmptyState } from '../../../../components/ui';
import DataTable from '../../../../components/DataTable';

export default function FixedOpsKpi() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['kpi-formulas-fixed-ops'],
    queryFn: () => closeApi.listFormulas(),
    retry: false,
  });

  if (isLoading) return <PageLoader page="Fixed Ops KPI" service="close-service" port={3052} />;
  if (error) return <PageError error={error as Error} serviceName="close-service" port={3052} retry={refetch} />;

  const formulas: any[] = Array.isArray(data) ? data.filter((f: any) => f.formulaCode?.startsWith('FIXED_OPS')) : [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Fixed Ops KPI (S121)" subtitle="Key performance indicators for fixed operations." />
      {formulas.length === 0 ? (
        <EmptyState icon="📊" title="No fixed ops KPI formulas" description="No KPI formulas have been configured for fixed operations." />
      ) : (
        <DataTable
          columns={[
            { key: 'formulaCode', label: 'Formula Code' },
            { key: 'version', label: 'Version' },
            { key: 'effectiveFrom', label: 'Effective From', render: r => new Date(r.effectiveFrom).toLocaleDateString() },
          ]}
          data={formulas}
          emptyIcon="📊"
          emptyTitle="No formulas"
        />
      )}
    </div>
  );
}
