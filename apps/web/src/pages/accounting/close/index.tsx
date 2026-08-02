import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Badge, Btn } from '../../../components/ui';

const LEGAL_ENTITY_ID = 'default';
const PERIOD_YEAR = new Date().getFullYear();
const PERIOD_MONTH = new Date().getMonth() + 1;

function stateBadgeVariant(state: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (state) {
    case 'FINAL_CLOSED': return 'success';
    case 'PRELIMINARY_CLOSED': return 'info';
    case 'READY': return 'info';
    case 'READY_WITH_EXCEPTIONS': return 'warning';
    case 'REOPEN_PENDING_APPROVAL': return 'warning';
    default: return 'neutral';
  }
}

function signalBadge(signal: string) {
  if (signal === 'READY') return <Badge variant="success">READY</Badge>;
  if (signal === 'ELIMINATIONS_PENDING') return <Badge variant="warning">ELIMINATIONS PENDING</Badge>;
  return <Badge variant="danger">{signal.replace(/_/g, ' ')}</Badge>;
}

export default function CloseCommandCenter() {
  const queryClient = useQueryClient();

  const { data: state, isLoading: stateLoading, error: stateError, refetch } = useQuery({
    queryKey: ['close-state', LEGAL_ENTITY_ID, PERIOD_YEAR, PERIOD_MONTH],
    queryFn: () => closeApi.getState(LEGAL_ENTITY_ID, PERIOD_YEAR, PERIOD_MONTH),
    retry: false,
  });

  const { data: readiness, isLoading: readinessLoading } = useQuery({
    queryKey: ['close-readiness', LEGAL_ENTITY_ID, PERIOD_YEAR, PERIOD_MONTH],
    queryFn: () => closeApi.getReadiness(LEGAL_ENTITY_ID, PERIOD_YEAR, PERIOD_MONTH),
    retry: false,
  });

  const transitionMutation = useMutation({
    mutationFn: (toState: string) => closeApi.transition({ legalEntityId: LEGAL_ENTITY_ID, periodYear: PERIOD_YEAR, periodMonth: PERIOD_MONTH, toState }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['close-state'] }),
  });

  if (stateLoading || readinessLoading) return <PageLoader page="Close Command Center" service="close-service" port={3052} />;
  if (stateError) return <PageError error={stateError as Error} serviceName="close-service" port={3052} retry={refetch} />;

  const currentState = (state as any)?.state ?? 'NOT_READY';
  const signals: any[] = (readiness as any)?.signals ?? [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Close Command Center (S113)"
        subtitle={`Period: ${PERIOD_YEAR}-${String(PERIOD_MONTH).padStart(2, '0')}`}
        actions={<Btn variant="secondary" size="md" onClick={() => refetch()}>Refresh</Btn>}
      />

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-base font-bold mb-2">Current State</h2>
        <Badge variant={stateBadgeVariant(currentState)}>{currentState}</Badge>
        <div className="flex gap-2 mt-4 flex-wrap">
          <Btn variant="primary" size="md" onClick={() => transitionMutation.mutate('READY')} loading={transitionMutation.isPending}>Mark Ready</Btn>
          <Btn variant="secondary" size="md" onClick={() => transitionMutation.mutate('PRELIMINARY_CLOSED')} loading={transitionMutation.isPending}>Preliminary Close</Btn>
          <Btn variant="secondary" size="md" onClick={() => transitionMutation.mutate('FINAL_CLOSED')} loading={transitionMutation.isPending}>Final Close</Btn>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-base font-bold mb-4">Module Readiness</h2>
        {signals.length === 0 ? (
          <p className="text-slate-500 text-sm">No signals available.</p>
        ) : (
          <div className="space-y-2">
            {signals.map((s: any) => (
              <div key={s.moduleCode} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-sm font-mono">{s.moduleCode}</span>
                {signalBadge(s.signal)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
