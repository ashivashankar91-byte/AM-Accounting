import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { closeApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { PageHeader, Btn, EmptyState } from '../../../components/ui';
import DataTable from '../../../components/DataTable';

const LEGAL_ENTITY_ID = 'default';

export default function CurrencyConfig() {
  const queryClient = useQueryClient();
  const [fromCurrency, setFromCurrency] = useState('EUR');
  const [toCurrency, setToCurrency] = useState('USD');
  const [rate, setRate] = useState('');
  const [rateDate, setRateDate] = useState(new Date().toISOString().split('T')[0]);

  const { data: config, isLoading: configLoading, error: configError, refetch } = useQuery({
    queryKey: ['currency-config', LEGAL_ENTITY_ID],
    queryFn: () => closeApi.getCurrencyConfig(LEGAL_ENTITY_ID),
    retry: false,
  });

  const { data: rates, isLoading: ratesLoading } = useQuery({
    queryKey: ['currency-rates'],
    queryFn: () => closeApi.listRates(),
    retry: false,
  });

  const setConfigMutation = useMutation({
    mutationFn: () => closeApi.setCurrencyConfig({ legalEntityId: LEGAL_ENTITY_ID, functionalCurrency: 'USD', policyElection: 'TRANSLATE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['currency-config'] }),
  });

  const addRateMutation = useMutation({
    mutationFn: () => closeApi.addRate({ fromCurrency, toCurrency, rate: parseFloat(rate), rateDate }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['currency-rates'] }); setRate(''); },
  });

  if (configLoading) return <PageLoader page="Currency Config" service="close-service" port={3052} />;
  if (configError) return <PageError error={configError as Error} serviceName="close-service" port={3052} retry={refetch} />;

  const rateList: any[] = Array.isArray(rates) ? rates : [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Currency Configuration (S015)" subtitle="Configure functional currency and translation rates." />

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="font-bold mb-2">Functional Currency Config</h2>
        {config ? (
          <p className="text-sm text-slate-700">Functional Currency: <strong>{(config as any).functionalCurrency}</strong> — Policy: {(config as any).policyElection}</p>
        ) : (
          <Btn variant="primary" size="md" onClick={() => setConfigMutation.mutate()} loading={setConfigMutation.isPending}>Set USD as Functional Currency</Btn>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="font-bold mb-4">Add Translation Rate</h2>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">From</label>
            <input className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm" value={fromCurrency} onChange={e => setFromCurrency(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">To</label>
            <input className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm" value={toCurrency} onChange={e => setToCurrency(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Rate</label>
            <input type="number" step="0.000001" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm font-mono" value={rate} onChange={e => setRate(e.target.value)} placeholder="1.000000" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Rate Date</label>
            <input type="date" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm" value={rateDate} onChange={e => setRateDate(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Btn variant="primary" size="md" onClick={() => addRateMutation.mutate()} loading={addRateMutation.isPending}>Add Rate</Btn>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="font-bold mb-4">Translation Rates</h2>
        {ratesLoading ? <p>Loading…</p> : rateList.length === 0 ? (
          <EmptyState icon="💱" title="No rates configured" description="Add translation rates above." />
        ) : (
          <DataTable
            columns={[
              { key: 'fromCurrency', label: 'From' },
              { key: 'toCurrency', label: 'To' },
              { key: 'rate', label: 'Rate', render: r => <span className="font-mono">{Number(r.rate).toFixed(6)}</span> },
              { key: 'rateDate', label: 'Date', render: r => new Date(r.rateDate).toLocaleDateString() },
            ]}
            data={rateList}
            emptyIcon="💱"
            emptyTitle="No rates"
          />
        )}
      </div>
    </div>
  );
}
