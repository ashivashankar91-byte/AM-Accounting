import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { taxApi, type TaxExemptionCertificate } from '../../../api/client';
import { PageHeader, Btn, Badge } from '../../../components/ui';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { EmptyState, Drawer, FilterBar, FilterField, FILTER_CONTROL_CLASS } from '../../../components/report';
import { EffectiveDateHistoryTab } from '../../../components/tax/EffectiveDateHistoryTab';

// CE-10 / S124 — Exemption Configuration & Inquiry. Certificate registry —
// configuration + evidence, never tax law: the engine decides EXEMPT_APPLIED
// applicability, this screen only manages the certificate reference.
// Permissions: tax.exemption.view / tax.exemption.manage.
type Drawer = { kind: 'new' } | { kind: 'detail'; row: TaxExemptionCertificate; tab: 'detail' | 'history' } | null;

export default function TaxExemptions() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'all' | 'expiring'>('all');
  const [party, setParty] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [status, setStatus] = useState('');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [form, setForm] = useState<{
    partyId: string; jurisdictionScope: string; exemptionType: string; effectiveFrom: string; effectiveTo: string; message?: string;
  }>({ partyId: '', jurisdictionScope: '', exemptionType: '', effectiveFrom: '', effectiveTo: '' });
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tax-exemptions', tab, party, jurisdiction, status],
    queryFn: () => taxApi.listExemptions({
      expiring: tab === 'expiring' || undefined,
      party: party || undefined,
      jurisdiction: jurisdiction || undefined,
      status: status || undefined,
    }),
    retry: false,
  });

  const rows = useMemo(() => data?.items ?? [], [data]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['tax-exemptions'] });
  }

  function openNew() {
    setForm({ partyId: '', jurisdictionScope: '', exemptionType: '', effectiveFrom: '', effectiveTo: '' });
    setDrawer({ kind: 'new' });
  }

  async function submit() {
    if (!drawer || drawer.kind !== 'new') return;
    setBusy(true);
    try {
      if (!form.partyId.trim() || !form.jurisdictionScope.trim() || !form.exemptionType.trim() || !form.effectiveFrom.trim()) {
        setForm({ ...form, message: 'Party, jurisdiction scope, exemption type and effective-from date are all required.' });
        setBusy(false);
        return;
      }
      await taxApi.createExemption({
        partyId: form.partyId.trim(),
        jurisdictionScope: form.jurisdictionScope.trim(),
        exemptionType: form.exemptionType.trim(),
        effectiveFrom: form.effectiveFrom.trim(),
        effectiveTo: form.effectiveTo.trim() || null,
      });
      setDrawer(null);
      await refresh();
    } catch (err: any) {
      setForm({ ...form, message: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <PageLoader page="Exemption Configuration & Inquiry" service="tax-service" port={3040} />;

  if (error) {
    const st = (error as any)?.status;
    if (st === 401 || st === 403) {
      return (
        <div className="p-7">
          <EmptyState
            testId="tax-exemptions-unauthorized"
            title="Unauthorized"
            message="You do not have the tax.exemption.view permission required to view Exemption Configuration & Inquiry. Contact your Controller or Admin."
          />
        </div>
      );
    }
    return <PageError error={error as Error} serviceName="tax-service" port={3040} retry={() => refetch()} />;
  }

  return (
    <div className="p-7 min-h-full" data-testid="tax-exemptions-page">
      <PageHeader
        title="Exemption Configuration & Inquiry"
        subtitle="Certificate registry per customer/party — configuration and evidence only. The engine decides EXEMPT_APPLIED applicability, never local logic."
        actions={<Btn variant="primary" size="md" icon={<Plus size={14} />} onClick={openNew} data-testid="tax-exemption-new-btn">New certificate…</Btn>}
      />

      <div className="flex items-center gap-1 border-b border-slate-200 mb-4">
        <button
          className={`px-3 py-2 text-[13px] font-semibold border-b-2 ${tab === 'all' ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}
          onClick={() => setTab('all')}
          data-testid="tax-exemptions-tab-all"
        >
          All certificates
        </button>
        <button
          className={`px-3 py-2 text-[13px] font-semibold border-b-2 ${tab === 'expiring' ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}
          onClick={() => setTab('expiring')}
          data-testid="tax-exemptions-tab-expiring"
        >
          Expiring
        </button>
      </div>

      <FilterBar>
        <FilterField label="Party" width={180}>
          <input className={FILTER_CONTROL_CLASS} value={party} onChange={(e) => setParty(e.target.value)} data-testid="tax-exemption-filter-party" />
        </FilterField>
        <FilterField label="Jurisdiction" width={180}>
          <input className={FILTER_CONTROL_CLASS} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} data-testid="tax-exemption-filter-jurisdiction" />
        </FilterField>
        <FilterField label="Status" width={140}>
          <select className={FILTER_CONTROL_CLASS} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="tax-exemption-filter-status">
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="EXPIRING">Expiring</option>
            <option value="EXPIRED">Expired</option>
          </select>
        </FilterField>
      </FilterBar>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
        {rows.length === 0 ? (
          <EmptyState
            testId="tax-exemptions-empty"
            title={tab === 'expiring' ? 'No expiring certificates' : 'No exemption certificates yet'}
            message={tab === 'expiring' ? 'No certificates are expiring soon.' : 'Register an exemption certificate to allow a party to claim it on requests.'}
            action={<Btn variant="secondary" size="sm" onClick={openNew}>New certificate…</Btn>}
          />
        ) : (
          <table className="w-full border-collapse" data-testid="tax-exemption-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Party</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Scope</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Type</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Effective from</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Effective to</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`tax-exemption-row-${r.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-0 text-[13px] text-slate-800">{r.partyName ?? r.partyId}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.jurisdictionScope}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.exemptionType}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.effectiveFrom}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.effectiveTo ?? '—'}</td>
                  <td className="px-4 py-0"><Badge variant={r.status === 'ACTIVE' ? 'success' : r.status === 'EXPIRING' ? 'warning' : 'danger'} dot>{r.status}</Badge></td>
                  <td className="px-4 py-0">
                    <Btn variant="secondary" size="sm" onClick={() => setDrawer({ kind: 'detail', row: r, tab: 'detail' })} data-testid={`tax-exemption-view-${r.id}`}>View…</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Drawer
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        title={drawer?.kind === 'new' ? 'New exemption certificate' : drawer?.kind === 'detail' ? `Certificate — ${drawer.row.partyName ?? drawer.row.partyId}` : ''}
        testId="tax-exemption-drawer"
        actions={drawer?.kind === 'new' ? (
          <>
            <Btn variant="ghost" size="sm" onClick={() => setDrawer(null)} disabled={busy}>Cancel</Btn>
            <Btn variant="primary" size="sm" onClick={submit} loading={busy} data-testid="tax-exemption-drawer-submit">Create</Btn>
          </>
        ) : undefined}
      >
        {drawer?.kind === 'new' && (
          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-slate-600">
              Party ID
              <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.partyId} onChange={(e) => setForm({ ...form, partyId: e.target.value })} data-testid="tax-exemption-party-input" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Jurisdiction scope
              <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.jurisdictionScope} onChange={(e) => setForm({ ...form, jurisdictionScope: e.target.value })} data-testid="tax-exemption-scope-input" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Exemption type (as defined by the engine/jurisdiction config)
              <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.exemptionType} onChange={(e) => setForm({ ...form, exemptionType: e.target.value })} data-testid="tax-exemption-type-input" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Effective from
              <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} data-testid="tax-exemption-effective-from-input" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Effective to (optional)
              <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} data-testid="tax-exemption-effective-to-input" />
            </label>
            {form.message && <p className="text-xs text-red-600" data-testid="tax-exemption-drawer-message">{form.message}</p>}
          </div>
        )}

        {drawer?.kind === 'detail' && (
          <div>
            <div className="flex items-center gap-1 border-b border-slate-200 mb-3">
              <button
                className={`px-3 py-2 text-[12.5px] font-semibold border-b-2 ${drawer.tab === 'detail' ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}
                onClick={() => setDrawer({ ...drawer, tab: 'detail' })}
                data-testid="tax-exemption-detail-tab-detail"
              >
                Document metadata
              </button>
              <button
                className={`px-3 py-2 text-[12.5px] font-semibold border-b-2 ${drawer.tab === 'history' ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}
                onClick={() => setDrawer({ ...drawer, tab: 'history' })}
                data-testid="tax-exemption-detail-tab-history"
              >
                Audit history
              </button>
            </div>
            {drawer.tab === 'detail' && (
              <pre className="text-[12px] whitespace-pre-wrap break-words text-slate-700" data-testid="tax-exemption-document-metadata">
                {drawer.row.documentMetadata ? JSON.stringify(drawer.row.documentMetadata, null, 2) : 'No document metadata recorded.'}
              </pre>
            )}
            {drawer.tab === 'history' && (
              <EffectiveDateHistoryTab entityType="exemption_certificate" entityId={drawer.row.id} testId="tax-exemption-history-tab" />
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
