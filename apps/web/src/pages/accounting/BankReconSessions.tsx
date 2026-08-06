/**
 * S054A/S054B — Bank Reconciliation Sessions list + create-session form.
 * Navigates to /accounting/bank-recon/sessions/:id on successful creation.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { reconSessionApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, PageHeader, Badge, EmptyState } from '../../components/ui';
import DataTable from '../../components/DataTable';

const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-US') : '—';

function statusVariant(status: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'OPEN':       return 'info';
    case 'COMPLETED':  return 'success';
    case 'LOCKED':     return 'warning';
    default:           return 'neutral';
  }
}

interface CreateForm {
  entityId: string;
  bankAccountCode: string;
  periodStart: string;
  periodEnd: string;
  statementBeginningBalance: string;
  statementEndingBalance: string;
}

const emptyForm = (): CreateForm => ({
  entityId: '',
  bankAccountCode: '',
  periodStart: '',
  periodEnd: '',
  statementBeginningBalance: '',
  statementEndingBalance: '',
});

export default function BankReconSessions() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['recon-sessions'],
    queryFn: () => reconSessionApi.list(),
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      reconSessionApi.create({
        entityId: form.entityId.trim(),
        bankAccountCode: form.bankAccountCode.trim(),
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        statementBeginningBalance: parseFloat(form.statementBeginningBalance),
        statementEndingBalance: parseFloat(form.statementEndingBalance),
      }),
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ['recon-sessions'] });
      navigate(`/accounting/bank-recon/sessions/${created.id}`);
    },
    onError: (err: any) => {
      setFormError(err.message ?? 'Failed to create session');
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    createMutation.mutate();
  }

  const sessions: any[] = Array.isArray(data) ? data : (data as any)?.items ?? [];

  // 401/403 handling — apiFetch sets err.status
  const errAny = error as any;
  if (errAny?.status === 401 || errAny?.status === 403) {
    return (
      <div className="p-6">
        <PageHeader title="Bank Reconciliation Sessions (S054)" />
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700 font-semibold">Unauthorized</p>
          <p className="text-red-600 text-sm mt-1">You do not have permission to view reconciliation sessions.</p>
        </div>
      </div>
    );
  }

  if (isLoading) return <PageLoader page="Bank Reconciliation Sessions" service="recon-service" />;
  if (error) return <PageError error={error as Error} serviceName="recon-service" retry={refetch} />;

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Bank Reconciliation Sessions (S054)"
        subtitle="Create and manage bank reconciliation sessions against the recon-service."
        actions={
          <div className="flex gap-2">
            <Btn variant="secondary" size="md" icon={<RefreshCw className="w-4 h-4" />} onClick={() => refetch()}>
              Refresh
            </Btn>
            <Btn variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={() => { setShowCreate(true); setForm(emptyForm()); setFormError(null); }} data-testid="recon-new-session-open">
              New Session
            </Btn>
          </div>
        }
      />

      {showCreate && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 mb-4">Create Reconciliation Session</h2>
          {formError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError}
            </div>
          )}
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Entity ID *</label>
              <input
                required
                className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                data-testid="recon-entity-id"
                value={form.entityId}
                onChange={(e) => setForm({ ...form, entityId: e.target.value })}
                placeholder="entity-001"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Bank Account Code *</label>
              <input
                required
                className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                data-testid="recon-bank-account-code"
                value={form.bankAccountCode}
                onChange={(e) => setForm({ ...form, bankAccountCode: e.target.value })}
                placeholder="CHK-001"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Period Start *</label>
              <input
                required
                type="date"
                className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                data-testid="recon-period-start"
                value={form.periodStart}
                onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Period End *</label>
              <input
                required
                type="date"
                className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                data-testid="recon-period-end"
                value={form.periodEnd}
                onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Statement Beginning Balance *</label>
              <input
                required
                type="number"
                step="0.01"
                className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand"
                data-testid="recon-statement-beginning-balance"
                value={form.statementBeginningBalance}
                onChange={(e) => setForm({ ...form, statementBeginningBalance: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Statement Ending Balance *</label>
              <input
                required
                type="number"
                step="0.01"
                className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand"
                data-testid="recon-statement-ending-balance"
                value={form.statementEndingBalance}
                onChange={(e) => setForm({ ...form, statementEndingBalance: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="col-span-2 flex gap-2 justify-end">
              <Btn variant="secondary" size="md" type="button" onClick={() => setShowCreate(false)}>
                Cancel
              </Btn>
              <Btn variant="primary" size="md" type="submit" loading={createMutation.isPending} data-testid="recon-create-session-submit">
                Create Session
              </Btn>
            </div>
          </form>
        </div>
      )}

      {sessions.length === 0 ? (
        <EmptyState
          icon="🏦"
          title="No reconciliation sessions yet"
          description="Create a new session to begin reconciling a bank statement period."
          action={
            <Btn variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
              New Session
            </Btn>
          }
        />
      ) : (
        <DataTable
          columns={[
            { key: 'id', label: 'Session ID', render: (r) => <span className="font-mono text-xs text-slate-500">{r.id?.slice(0, 8)}…</span> },
            { key: 'entityId', label: 'Entity' },
            { key: 'bankAccountCode', label: 'Bank Account Code' },
            { key: 'periodStart', label: 'Period Start', render: (r) => fmt(r.periodStart) },
            { key: 'periodEnd', label: 'Period End', render: (r) => fmt(r.periodEnd) },
            {
              key: 'status', label: 'Status',
              render: (r) => <Badge variant={statusVariant(r.status ?? '')}>{r.status ?? '—'}</Badge>,
            },
            {
              key: 'statementEndingBalance', label: 'Ending Balance', align: 'right',
              render: (r) => (
                <span className="font-mono text-right">
                  ${Number(r.statementEndingBalance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              ),
            },
          ]}
          data={sessions}
          rowTestIdPrefix="recon-session-row"
          onRowClick={(r) => navigate(`/accounting/bank-recon/sessions/${r.id}`)}
          emptyIcon="🏦"
          emptyTitle="No reconciliation sessions"
        />
      )}
    </div>
  );
}
