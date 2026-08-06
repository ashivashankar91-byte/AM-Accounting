/**
 * AMACC-CH04 S044 — Use Tax Assessments & Register
 * Lists use-tax assessments and a register view as tabs.
 * Displays assessment detail with jurisdiction/amount fields.
 * No client-side tax calculation — display only.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldOff } from 'lucide-react';
import { useTaxApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import DataTable from '../../components/DataTable';
import { Badge } from '../../components/ui';

type Tab = 'assessments' | 'register';

function AssessmentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['use-tax-assessment', id],
    queryFn: () => useTaxApi.getAssessment(id),
    retry: false,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[36rem] p-6 space-y-4 max-h-[80vh] overflow-auto">
        <div className="flex items-start justify-between">
          <h3 className="font-bold text-lg" data-testid="usetax-detail-modal">Assessment Detail</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
        {isError && <p className="text-sm text-red-500">Failed to load assessment detail.</p>}
        {data && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {Object.entries(data as Record<string, any>).map(([key, val]) => (
              <div key={key}>
                <dt className="text-xs font-semibold text-gray-500 uppercase">{key}</dt>
                <dd className="text-gray-800 font-mono text-xs mt-0.5">{val != null ? String(val) : '—'}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function UseTaxAssessments() {
  const [tab, setTab] = useState<Tab>('assessments');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const assessmentsQuery = useQuery({
    queryKey: ['use-tax-assessments'],
    queryFn: () => useTaxApi.getAssessments(),
    retry: false,
    enabled: tab === 'assessments',
  });

  const registerQuery = useQuery({
    queryKey: ['use-tax-register', period],
    queryFn: () => useTaxApi.getRegister(`period=${period}`),
    retry: false,
    enabled: tab === 'register',
  });

  const activeQuery = tab === 'assessments' ? assessmentsQuery : registerQuery;
  const err = activeQuery.error as any;

  if (activeQuery.isLoading) return <PageLoader page="Use Tax" service="apar-service" port={3013} />;
  if (activeQuery.isError) {
    if (err?.status === 401 || err?.status === 403) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <ShieldOff className="w-10 h-10 mx-auto mb-3 text-amber-400" />
            <p className="text-sm text-gray-600">You do not have permission to view use-tax data.</p>
          </div>
        </div>
      );
    }
    return <PageError error={activeQuery.error as Error} retry={activeQuery.refetch} serviceName="apar-service" port={3013} />;
  }

  const assessments: any[] = Array.isArray(assessmentsQuery.data) ? assessmentsQuery.data : [];
  const register: any[] = Array.isArray(registerQuery.data) ? registerQuery.data : [];

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Use Tax</h1>
        <p className="text-sm text-gray-500 mt-0.5">Assessments and register — display only, no client-side calculation</p>
      </div>

      {/* Tab bar */}
      <div className="border-b flex gap-0">
        {(['assessments', 'register'] as Tab[]).map((t) => (
          <button
            key={t}
            data-testid={`usetax-tab-${t}`}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t === 'assessments' ? 'Assessments' : 'Register'}
          </button>
        ))}
      </div>

      {tab === 'assessments' && (
        <DataTable
          columns={[
            { key: 'id', label: 'ID', mono: true },
            { key: 'invoiceId', label: 'Invoice ID', mono: true },
            { key: 'jurisdiction', label: 'Jurisdiction' },
            { key: 'taxableAmount', label: 'Taxable Amount', align: 'right', render: (row) => row.taxableAmount != null ? `$${Number(row.taxableAmount).toFixed(2)}` : '—' },
            { key: 'taxAmount', label: 'Tax Amount', align: 'right', render: (row) => row.taxAmount != null ? `$${Number(row.taxAmount).toFixed(2)}` : '—' },
            { key: 'taxRate', label: 'Tax Rate', align: 'right', render: (row) => row.taxRate != null ? `${Number(row.taxRate).toFixed(4)}%` : '—' },
            { key: 'status', label: 'Status', render: (row) => <Badge variant={row.status === 'POSTED' ? 'success' : 'neutral'}>{row.status ?? '—'}</Badge> },
            { key: 'detail', label: '', render: (row) => (
              <button data-testid={`usetax-detail-open-${row.id}`} onClick={(e) => { e.stopPropagation(); setSelectedId(row.id); }} className="text-xs text-brand hover:underline font-medium">Detail</button>
            )},
          ]}
          data={assessments}
          rowTestIdPrefix="usetax-assessment-row"
          emptyIcon="📋"
          emptyTitle="No use-tax assessments"
          emptySubtitle="No assessments have been recorded yet."
        />
      )}

      {tab === 'register' && (
        <>
          <div className="flex items-center gap-3 pb-2">
            <label className="text-sm font-medium text-gray-700">Period</label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="border border-gray-300 rounded-md px-2 h-8 text-sm font-mono"
            />
          </div>
          <DataTable
          columns={[
            { key: 'id', label: 'ID', mono: true },
            { key: 'period', label: 'Period' },
            { key: 'jurisdiction', label: 'Jurisdiction' },
            { key: 'taxableAmount', label: 'Taxable Amount', align: 'right', render: (row) => row.taxableAmount != null ? `$${Number(row.taxableAmount).toFixed(2)}` : '—' },
            { key: 'taxAmount', label: 'Tax Amount', align: 'right', render: (row) => row.taxAmount != null ? `$${Number(row.taxAmount).toFixed(2)}` : '—' },
            { key: 'status', label: 'Status', render: (row) => <Badge variant={row.status === 'FILED' ? 'success' : 'neutral'}>{row.status ?? '—'}</Badge> },
          ]}
          data={register}
          rowTestIdPrefix="usetax-register-row"
          emptyIcon="📑"
          emptyTitle="No register entries"
          emptySubtitle="No use-tax register entries found."
        />
        </>
      )}

      {selectedId && <AssessmentDetail id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
