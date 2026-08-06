import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { taxApi, type TaxJurisdiction } from '../../../api/client';
import { PageHeader, Btn, Badge } from '../../../components/ui';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { EmptyState, Drawer, DrawerRow, FilterBar, FilterField, FILTER_CONTROL_CLASS } from '../../../components/report';
import { EffectiveDateHistoryTab } from '../../../components/tax/EffectiveDateHistoryTab';

// CE-10 / S124 — Jurisdiction Administration. Registrations this tenant/
// entity holds against the engine's own reference data (jurisdictionRefId
// is always browsed/selected from the adapter's reference data — never
// free-typed law, per the Fable package). Table + drawer form; overlap
// validation surfaces as a 409-style error from the API into the drawer.
// Permissions: tax.jurisdiction.view / tax.jurisdiction.manage.
type Drawer =
  | { kind: 'new' }
  | { kind: 'edit'; row: TaxJurisdiction }
  | { kind: 'deactivate'; row: TaxJurisdiction }
  | { kind: 'history'; row: TaxJurisdiction }
  | null;

export default function TaxJurisdictionAdmin() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>('');
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [form, setForm] = useState<{ jurisdictionRefId: string; registrationNumber: string; effectiveFrom: string; effectiveTo: string; reason: string; message?: string }>({
    jurisdictionRefId: '', registrationNumber: '', effectiveFrom: '', effectiveTo: '', reason: '',
  });
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tax-jurisdictions', status, search],
    queryFn: () => taxApi.listJurisdictions({ status: status || undefined, search: search || undefined }),
    retry: false,
  });

  const rows = useMemo(() => data?.items ?? [], [data]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['tax-jurisdictions'] });
  }

  function openNew() {
    setForm({ jurisdictionRefId: '', registrationNumber: '', effectiveFrom: '', effectiveTo: '', reason: '' });
    setDrawer({ kind: 'new' });
  }
  function openEdit(row: TaxJurisdiction) {
    setForm({
      jurisdictionRefId: row.jurisdictionRefId,
      registrationNumber: row.registrationNumber ?? '',
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo ?? '',
      reason: '',
    });
    setDrawer({ kind: 'edit', row });
  }
  function openDeactivate(row: TaxJurisdiction) {
    setForm({ jurisdictionRefId: '', registrationNumber: '', effectiveFrom: '', effectiveTo: '', reason: '' });
    setDrawer({ kind: 'deactivate', row });
  }

  async function submit() {
    if (!drawer) return;
    setBusy(true);
    try {
      if (drawer.kind === 'new') {
        if (!form.jurisdictionRefId.trim() || !form.effectiveFrom.trim()) {
          setForm({ ...form, message: 'Jurisdiction reference and effective-from date are required.' });
          setBusy(false);
          return;
        }
        await taxApi.createJurisdiction({
          jurisdictionRefId: form.jurisdictionRefId.trim(),
          registrationNumber: form.registrationNumber.trim() || undefined,
          effectiveFrom: form.effectiveFrom.trim(),
          effectiveTo: form.effectiveTo.trim() || null,
        });
      } else if (drawer.kind === 'edit') {
        await taxApi.updateJurisdiction(drawer.row.id, {
          version: drawer.row.version,
          registrationNumber: form.registrationNumber.trim() || undefined,
          effectiveFrom: form.effectiveFrom.trim(),
          effectiveTo: form.effectiveTo.trim() || null,
        });
      } else if (drawer.kind === 'deactivate') {
        if (!form.reason.trim()) {
          setForm({ ...form, message: 'A reason is required to deactivate.' });
          setBusy(false);
          return;
        }
        await taxApi.deactivateJurisdiction(drawer.row.id, { version: drawer.row.version, reason: form.reason.trim() });
      }
      setDrawer(null);
      await refresh();
    } catch (err: any) {
      // BR124 — overlap validation: the API rejects overlapping registrations
      // for the same jurisdiction with a 409-style error; surface it inline
      // in the drawer rather than a generic page error.
      setForm({ ...form, message: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <PageLoader page="Jurisdiction Administration" service="tax-service" port={3040} />;

  if (error) {
    const st = (error as any)?.status;
    if (st === 401 || st === 403) {
      return (
        <div className="p-7">
          <EmptyState
            testId="tax-jurisdictions-unauthorized"
            title="Unauthorized"
            message="You do not have the tax.jurisdiction.view permission required to view Jurisdiction Administration. Contact your Controller or Admin."
          />
        </div>
      );
    }
    return <PageError error={error as Error} serviceName="tax-service" port={3040} retry={() => refetch()} />;
  }

  return (
    <div className="p-7 min-h-full" data-testid="tax-jurisdictions-page">
      <PageHeader
        title="Jurisdiction Administration"
        subtitle="Jurisdiction registrations this tenant/legal entity holds, browsed from the adapter's reference data — never free-typed. Overlap prevented per jurisdiction."
        actions={<Btn variant="primary" size="md" icon={<Plus size={14} />} onClick={openNew} data-testid="tax-jurisdiction-new-btn">New registration…</Btn>}
      />

      <FilterBar>
        <FilterField label="Status" width={140}>
          <select className={FILTER_CONTROL_CLASS} value={status} onChange={(e) => setStatus(e.target.value as any)} data-testid="tax-jurisdiction-filter-status">
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </FilterField>
        <FilterField label="Search" width={220}>
          <input className={FILTER_CONTROL_CLASS} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="tax-jurisdiction-filter-search" placeholder="Jurisdiction or registration #" />
        </FilterField>
      </FilterBar>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
        {rows.length === 0 ? (
          <EmptyState
            testId="tax-jurisdictions-empty"
            title="No jurisdiction registrations yet"
            message="Register a jurisdiction this tenant/entity holds — browsed from the engine's own reference data."
            action={<Btn variant="secondary" size="sm" onClick={openNew}>New registration…</Btn>}
          />
        ) : (
          <table className="w-full border-collapse" data-testid="tax-jurisdiction-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Jurisdiction</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Registration #</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Effective from</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Effective to</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`tax-jurisdiction-row-${r.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-0 font-mono text-[13px] text-slate-800">{r.jurisdictionLabel ?? r.jurisdictionRefId}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.registrationNumber ?? '—'}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.effectiveFrom}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.effectiveTo ?? '—'}</td>
                  <td className="px-4 py-0"><Badge variant={r.isActive ? 'success' : 'neutral'} dot>{r.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge></td>
                  <td className="px-4 py-0">
                    <div className="flex items-center gap-2">
                      <Btn variant="secondary" size="sm" onClick={() => setDrawer({ kind: 'history', row: r })} data-testid={`tax-jurisdiction-history-${r.id}`}>History</Btn>
                      {r.isActive && (
                        <>
                          <Btn variant="secondary" size="sm" onClick={() => openEdit(r)} data-testid={`tax-jurisdiction-edit-${r.id}`}>Edit…</Btn>
                          <Btn variant="danger" size="sm" onClick={() => openDeactivate(r)} data-testid={`tax-jurisdiction-deactivate-${r.id}`}>Deactivate…</Btn>
                        </>
                      )}
                    </div>
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
        title={
          drawer?.kind === 'new' ? 'New jurisdiction registration'
            : drawer?.kind === 'edit' ? `Edit ${drawer.row.jurisdictionLabel ?? drawer.row.jurisdictionRefId}`
            : drawer?.kind === 'deactivate' ? `Deactivate ${drawer.row.jurisdictionLabel ?? drawer.row.jurisdictionRefId}`
            : drawer?.kind === 'history' ? `History — ${drawer.row.jurisdictionLabel ?? drawer.row.jurisdictionRefId}`
            : ''
        }
        testId="tax-jurisdiction-drawer"
        actions={drawer && drawer.kind !== 'history' ? (
          <>
            <Btn variant="ghost" size="sm" onClick={() => setDrawer(null)} disabled={busy}>Cancel</Btn>
            <Btn variant={drawer.kind === 'deactivate' ? 'danger' : 'primary'} size="sm" onClick={submit} loading={busy} data-testid="tax-jurisdiction-drawer-submit">
              {drawer.kind === 'deactivate' ? 'Deactivate' : drawer.kind === 'edit' ? 'Save' : 'Create'}
            </Btn>
          </>
        ) : undefined}
      >
        {drawer?.kind === 'history' && (
          <EffectiveDateHistoryTab entityType="jurisdiction_registration" entityId={drawer.row.id} testId="tax-jurisdiction-history-tab" />
        )}

        {(drawer?.kind === 'new' || drawer?.kind === 'edit') && (
          <div className="flex flex-col gap-3">
            {drawer.kind === 'new' && (
              <label className="text-xs font-semibold text-slate-600">
                Jurisdiction reference (from adapter reference data)
                <input
                  className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm"
                  value={form.jurisdictionRefId}
                  onChange={(e) => setForm({ ...form, jurisdictionRefId: e.target.value })}
                  data-testid="tax-jurisdiction-ref-input"
                  placeholder="e.g. US-CA-STATE"
                />
              </label>
            )}
            <label className="text-xs font-semibold text-slate-600">
              Registration number
              <input
                className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm"
                value={form.registrationNumber}
                onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
                data-testid="tax-jurisdiction-regnum-input"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Effective from
              <input
                type="date"
                className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm"
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                data-testid="tax-jurisdiction-effective-from-input"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Effective to (optional)
              <input
                type="date"
                className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm"
                value={form.effectiveTo}
                onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
                data-testid="tax-jurisdiction-effective-to-input"
              />
            </label>
          </div>
        )}

        {drawer?.kind === 'deactivate' && (
          <>
            <DrawerRow label="Jurisdiction" value={drawer.row.jurisdictionLabel ?? drawer.row.jurisdictionRefId} />
            <label className="text-xs font-semibold text-slate-600 block mt-3">
              Reason (required)
              <textarea
                className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm"
                rows={3}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                data-testid="tax-jurisdiction-reason-input"
              />
            </label>
          </>
        )}

        {form.message && <p className="text-xs text-red-600 mt-2" data-testid="tax-jurisdiction-drawer-message">{form.message}</p>}
      </Drawer>
    </div>
  );
}
