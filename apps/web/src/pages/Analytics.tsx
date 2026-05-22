import { useQuery } from '@tanstack/react-query';
import { glApi, agentApi, eomApi, payrollApi } from '../api/client';
import HelpButton from '../components/HelpButton';
import PageLoader from '../components/PageLoader';
import PageError from '../components/PageError';
import SCREEN_HELP from '../data/screenHelp';
import AIInsight from '../components/AIInsight';

export default function Analytics() {
  const { data: entries, isLoading, error, refetch } = useQuery({ queryKey: ['gl-entries-analytics'], queryFn: () => glApi.getEntries('limit=500'), retry: false });
  const { data: logs } = useQuery({ queryKey: ['agent-logs-analytics'], queryFn: agentApi.getLog, retry: false });
  const { data: closes } = useQuery({ queryKey: ['eom-analytics'], queryFn: eomApi.list, retry: false });
  const { data: batches } = useQuery({ queryKey: ['payroll-analytics'], queryFn: payrollApi.getBatches, retry: false });

  // Group entries by date
  const entriesByDate = new Map<string, number>();
  (entries ?? []).forEach((e: any) => {
    const date = new Date(e.entryDate).toLocaleDateString();
    entriesByDate.set(date, (entriesByDate.get(date) ?? 0) + 1);
  });

  // Agent interventions by type
  const agentCounts = new Map<string, number>();
  (logs ?? []).forEach((l: any) => {
    agentCounts.set(l.agentName, (agentCounts.get(l.agentName) ?? 0) + 1);
  });

  if (isLoading) return <PageLoader page="Analytics" service="gl-service" port={3010} />;
  if (error) return <PageError error={error} serviceName="GL Service" port={3010} retry={refetch} />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between"><div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Financial analytics and trend visualizations. Source: GL Service, EOM Service, Payroll Service.</p>
        </div><HelpButton help={SCREEN_HELP['analytics']} /></div>

      <div className="grid grid-cols-2 gap-6">
        {/* GL Posting Volume */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-3">GL Posting Volume by Day</h3>
          <div className="space-y-2">
            {[...entriesByDate.entries()].slice(0, 10).map(([date, count]) => (
              <div key={date} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-24">{date}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-4">
                  <div className="bg-amacc-600 h-4 rounded-full" style={{ width: `${Math.min(count * 10, 100)}%` }} />
                </div>
                <span className="text-sm font-medium w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Interventions */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-3">Agent Interventions by Type</h3>
          <div className="space-y-3">
            {[...agentCounts.entries()].map(([name, count]) => (
              <div key={name} className="flex items-center gap-3">
                <span className="text-sm w-40">{name}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-4">
                  <div className="bg-brand-light0 h-4 rounded-full" style={{ width: `${Math.min(count * 15, 100)}%` }} />
                </div>
                <span className="text-sm font-medium w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* EOM Close Duration */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-3">EOM Close Duration</h3>
          <div className="space-y-2">
            {(Array.isArray(closes) ? closes : []).filter((c: any) => c.completedAt).map((c: any) => {
              const duration = Math.round((new Date(c.completedAt).getTime() - new Date(c.startedAt).getTime()) / 3600000);
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-24">{c.periodYear}-{String(c.periodMonth).padStart(2, '0')}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-4">
                    <div className="bg-green-500 h-4 rounded-full" style={{ width: `${Math.min(duration * 2, 100)}%` }} />
                  </div>
                  <span className="text-sm font-medium w-16 text-right">{duration}h</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Payroll Variance */}
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-3">Payroll Batch Summary</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-green-50 rounded">
              <div className="text-2xl font-bold text-green-700">
                {(batches ?? []).filter((b: any) => b.status === 'POSTED').length}
              </div>
              <div className="text-xs text-green-600">Posted</div>
            </div>
            <div className="text-center p-3 bg-yellow-50 rounded">
              <div className="text-2xl font-bold text-yellow-700">
                {(batches ?? []).filter((b: any) => b.status === 'HELD').length}
              </div>
              <div className="text-xs text-yellow-600">Held</div>
            </div>
            <div className="text-center p-3 bg-brand-light rounded">
              <div className="text-2xl font-bold text-brand">
                {(batches ?? []).filter((b: any) => b.status === 'VALIDATED').length}
              </div>
              <div className="text-xs text-brand">Validated</div>
            </div>
            <div className="text-center p-3 bg-red-50 rounded">
              <div className="text-2xl font-bold text-red-700">
                {(batches ?? []).filter((b: any) => b.status === 'REJECTED').length}
              </div>
              <div className="text-xs text-red-600">Rejected</div>
            </div>
          </div>
        </div>
      </div>

      <AIInsight pageType="analytics" context="Analytics" data={{ entriesByDate: Object.fromEntries(entriesByDate), agentCounts: Object.fromEntries(agentCounts) }} />
    </div>
  );
}
