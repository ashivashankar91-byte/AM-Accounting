import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Badge } from '../../../components/ui';

function signalVariant(signal: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (signal === 'READY') return 'success';
  if (signal === 'ELIMINATIONS_PENDING') return 'warning';
  return 'danger';
}

export default function DailyOperatingControl() {
  const [legalEntityId] = useState('default');
  const [asOfDate] = useState(new Date().toISOString().split('T')[0]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['doc', legalEntityId, asOfDate],
    queryFn: () => closeApi.getDoc(legalEntityId, asOfDate),
    retry: false,
  });

  if (isLoading) return <PageLoader page="Daily Operating Control" service="close-service" port={3052} />;
  if (error) return <PageError error={error as Error} serviceName="close-service" port={3052} retry={refetch} />;

  const signals: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Daily Operating Control (S119)" subtitle={`As of: ${asOfDate} — Legal Entity: ${legalEntityId}`} />
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="font-bold mb-4">Module Signals</h2>
        <div className="space-y-2">
          {signals.map((s: any) => (
            <div key={s.moduleCode} className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div>
                <span className="font-mono text-sm font-semibold">{s.moduleCode}</span>
                <span className="text-slate-500 text-sm ml-2">{s.label}</span>
              </div>
              <Badge variant={signalVariant(s.signal)}>{s.signal.replace(/_/g, ' ')}</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
