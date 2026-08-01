import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { taxApi, type TaxFee } from '../../../api/client';
import { PageHeader, Btn, Badge } from '../../../components/ui';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { EmptyState, Drawer, DrawerRow, FilterBar, FilterField, FILTER_CONTROL_CLASS } from '../../../components/report';
import { EffectiveDateHistoryTab } from '../../../components/tax/EffectiveDateHistoryTab';

// CE-10 / S125 — Regulatory Fee Administration. Fee amounts/rules are
// jurisdiction-sourced configuration entered by authorized users — never
// shipped as code defaults. Overlap validation at save; deactivate never
// delete once referenced (409 with reference count). Permissions:
// tax.fee.view / tax.fee.manage.
type Drawer =
  | { kind: 'new' }
  | { kind: 'edit'; row: TaxFee }
  | { kind: 'deactivate'; row: TaxFee }
  | { kind: 'history'; row: TaxFee }
  | null;

const BASIS_OPTIONS = ['FIXED_PER_UNIT', 'FIXED_PER_DOCUMENT', 'PERCENT_OF_BASE'] as const;

export default function TaxFeeAdmin() {
  const queryClient = useQueryClient();
  const [jurisdiction, setJurisdiction] = useState('');
  const [status, setStatus] = useState('');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [form, setForm] = useState<{
    feeCode: string; name: string; jurisdictionRefId: string; basis: typeof BASIS_OPTIONS[number];
    amount: string; rate: string; effectiveFrom: string; effectiveTo: string; reason: string; message?: string;
  }>({ feeCode: '', name: '', jurisdictionRefId: '', basis: 'FIXED_PER_UNIT', amount: '', rate: '', effectiveFrom: '', effectiveTo: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [deactivateReferenceCount, setDeactivateReferenceCount] = useState<number | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tax-fees', jurisdiction, status],
    queryFn: () => taxApi.listFees({ jurisdiction: jurisdiction || undefined, status: status || undefined }),
    retry: false,
  });

  const rows = useMemo(() => data?.items ?? [], [data]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['tax-fees'] });
  }

  function openNew() {
    setForm({ feeCode: '', name: '', jurisdictionRefId: '', basis: 'FIXED_PER_UNIT', amount: '', rate: '', effectiveFrom: '', effectiveTo: '', reason: '' });
    setDrawer({ kind: 'new' });
  }
  function openEdit(row: TaxFee) {
    setForm({
      feeCode: row.feeCode, name: row.name, jurisdictionRefId: row.jurisdictionRefId, basis: row.basis,
      amount: row.amount ?? '', rate: row.rate ?? '', effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo ?? '', reason: '',
    });
    setDrawer({ kind: 'edit', row });
  }
  function openDeactivate(row: TaxFee) {
    setDeactivateReferenceCount(null);
    setForm({ ...form, reason: '', message: undefined });
    setDrawer({ kind: 'deactivate', row });
  }

  async function submit() {
    if (!drawer) return;
    setBusy(true);
    setDeactivateReferenceCount(null);
    try {
      if (drawer.kind === 'new' || drawer.kind === 'edit') {
        if (!form.feeCode.trim() || !form.name.trim() || !form.jurisdictionRefId.trim() || !form.effectiveFrom.trim()) {
          setForm({ ...form, message: 'Fee code, name, jurisdiction and effective-from date are required.' });
          setBusy(false);
          return;
        }
        const payload = {
          feeCode: form.feeCode.trim(),
          name: form.name.trim(),
          jurisdictionRefId: form.jurisdictionRefId.trim(),
          basis: form.basis,
          amount: form.basis !== 'PERCENT_OF_BASE' ? form.amount.trim() || undefined : undefined,
          rate: form.basis === 'PERCENT_OF_BASE' ? form.rate.trim() || undefined : undefined,
          effectiveFrom: form.effectiveFrom.trim(),
          effectiveTo: form.effectiveTo.trim() || null,
        };
        if (drawer.kind === 'new') {
          await taxApi.createFee(payload);
        } else {
          await taxApi.updateFee(drawer.row.id, { version: drawer.row.version, ...payload });
        }
      } else if (drawer.kind === 'deactivate') {
        if (!form.reason.trim()) {
          setForm({ ...form, message: 'A reason is required to deactivate.' });
          setBusy(false);
          return;
        }
        await taxApi.deactivateFee(drawer.row.id, { version: drawer.row.version, reason: form.reason.trim() });
      }
      setDrawer(null);
      await refresh();
    } catch (err: any) {
      // 409-with-reference-count: never delete a fee once transactions
      // reference it — surface the count inline instead of a silent failure.
      if (err.status === 409 && typeof err.body?.referenceCount === 'number') {
        setDeactivateReferenceCount(err.body.referenceCount);
      }
      setForm({ ...form, message: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <PageLoader page="Regulatory Fee Administration" service="tax-service" port={3040} />;

  if (error) {
    const st = (error as any)?.status;
    if (st === 401 || st === 403) {
      return (
        <div className="p-7">
          <EmptyState
            testId="tax-fees-unauthorized"
            title="Unauthorized"
            message="You do not have the tax.fee.view permission required to view Regulatory Fee Administration. Contact your Controller or Admin."
          />
        </div>
      );
    }
    return <PageError error={error as Error} serviceName="tax-service" port={3040} retry={() => refetch()} />;
  }

  return (
    <div className="p-7 min-h-full" data-testid="tax-fees-page">
      <PageHeader
        title="Regulatory Fee Administration"
        subtitle="Configured, effective-dated regulatory fee tables (tire, battery, EPA/environmental, state vehicle fees). An empty table means the fee does not apply, truthfully."
        actions={<Btn variant="primary" size="md" icon={<Plus size={14} />} onClick={openNew} data-testid="tax-fee-new-btn">New fee…</Btn>}
      />

      <FilterBar>
        <FilterField label="Jurisdiction" width={180}>
          <input className={FILTER_CONTROL_CLASS} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} data-testid="tax-fee-filter-jurisdiction" />
        </FilterField>
        <FilterField label="Status" width={140}>
          <select className={FILTER_CONTROL_CLASS} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="tax-fee-filter-status">
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </FilterField>
      </FilterBar>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
        {rows.length === 0 ? (
          <EmptyState
            testId="tax-fees-empty"
            title="No regulatory fees configured — fees apply only when configured."
            action={<Btn variant="secondary" size="sm" onClick={openNew}>New fee…</Btn>}
          />
        ) : (
          <table className="w-full border-collapse" data-testid="tax-fee-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Fee code</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Name</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Jurisdiction</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Basis</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Amount/rate</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Effective</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`tax-fee-row-${r.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-0 font-mono text-[13px] text-slate-800">{r.feeCode}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.name}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.jurisdictionLabel ?? r.jurisdictionRefId}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.basis}</td>
                  <td className="px-4 py-0 text-right font-mono text-[13px] text-slate-700">{r.basis === 'PERCENT_OF_BASE' ? `${r.rate}%` : r.amount}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.effectiveFrom}{r.effectiveTo ? ` – ${r.effectiveTo}` : ''}</td>
                  <td className="px-4 py-0"><Badge variant={r.isActive ? 'success' : 'neutral'} dot>{r.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge></td>
                  <td className="px-4 py-0">
                    <div className="flex items-center gap-2">
                      <Btn variant="secondary" size="sm" onClick={() => setDrawer({ kind: 'history', row: r })} data-testid={`tax-fee-history-${r.id}`}>History</Btn>
                      {r.isActive && (
                        <>
                          <Btn variant="secondary" size="sm" onClick={() => openEdit(r)} data-testid={`tax-fee-edit-${r.id}`}>Edit…</Btn>
                          <Btn variant="danger" size="sm" onClick={() => openDeactivate(r)} data-testid={`tax-fee-deactivate-${r.id}`}>Deactivate…</Btn>
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
          drawer?.kind === 'new' ? 'New regulatory fee'
            : drawer?.kind === 'edit' ? `Edit ${drawer.row.feeCode}`
            : drawer?.kind === 'deactivate' ? `Deactivate ${drawer.row.feeCode}`
            : drawer?.kind === 'history' ? `History — ${drawer.row.feeCode}`
            : ''
        }
        testId="tax-fee-drawer"
        actions={drawer && drawer.kind !== 'history' ? (
          <>
            <Btn variant="ghost" size="sm" onClick={() => setDrawer(null)} disabled={busy}>Cancel</Btn>
            <Btn variant={drawer.kind === 'deactivate' ? 'danger' : 'primary'} size="sm" onClick={submit} loading={busy} data-testid="tax-fee-drawer-submit">
              {drawer.kind === 'deactivate' ? 'Deactivate' : drawer.kind === 'edit' ? 'Save' : 'Create'}
            </Btn>
          </>
        ) : undefined}
      >
        {drawer?.kind === 'history' && (
          <EffectiveDateHistoryTab entityType="fee_table" entityId={drawer.row.id} testId="tax-fee-history-tab" />
        )}

        {(drawer?.kind === 'new' || drawer?.kind === 'edit') && (
          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-slate-600">
              Fee code
              <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.feeCode} onChange={(e) => setForm({ ...form, feeCode: e.target.value })} data-testid="tax-fee-code-input" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Name
              <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="tax-fee-name-input" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Jurisdiction reference
              <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.jurisdictionRefId} onChange={(e) => setForm({ ...form, jurisdictionRefId: e.target.value })} data-testid="tax-fee-jurisdiction-input" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Basis
              <select className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value as any })} data-testid="tax-fee-basis-input">
                {BASIS_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            {form.basis === 'PERCENT_OF_BASE' ? (
              <label className="text-xs font-semibold text-slate-600">
                Rate (%)
                <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} data-testid="tax-fee-rate-input" />
              </label>
            ) : (
              <label className="text-xs font-semibold text-slate-600">
                Amount
                <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} data-testid="tax-fee-amount-input" />
              </label>
            )}
            <label className="text-xs font-semibold text-slate-600">
              Effective from
              <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} data-testid="tax-fee-effective-from-input" />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Effective to (optional)
              <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} data-testid="tax-fee-effective-to-input" />
            </label>
          </div>
        )}

        {drawer?.kind === 'deactivate' && (
          <>
            <DrawerRow label="Fee" value={`${drawer.row.feeCode} — ${drawer.row.name}`} />
            <label className="text-xs font-semibold text-slate-600 block mt-3">
              Reason (required)
              <textarea className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="tax-fee-reason-input" />
            </label>
            {deactivateReferenceCount !== null && (
              <p className="text-xs text-red-600 mt-2" data-testid="tax-fee-reference-count-error">
                This fee is referenced by {deactivateReferenceCount} posted transaction(s) and cannot be deleted — deactivating only prevents future use.
              </p>
            )}
          </>
        )}

        {form.message && <p className="text-xs text-red-600 mt-2" data-testid="tax-fee-drawer-message">{form.message}</p>}
      </Drawer>
    </div>
  );
}
