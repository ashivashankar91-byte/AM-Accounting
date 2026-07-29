import { useMemo, useState, Fragment } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tag, ChevronDown, ChevronRight } from 'lucide-react';
import { goldenPathApi } from '../../../api/client';
import { PageHeader, Btn, Badge, EmptyState } from '../../../components/ui';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';

// S011 Story Contract (P01-SCR-04, "Analysis Code Registry") — Controller-
// facing registry screen: analysis-code TYPES (dimensions, e.g. "Project",
// "Campaign") each holding 0..N VALUES. Deactivate-only, matches the
// department-service.ts / DepartmentAdmin.tsx registry convention exactly
// (no ceremonies, no state machine — this is a flat CRUD registry, unlike
// S008's Period Control). BLOCKED_DOR note in the screen inventory refers to
// the *design mock* only; the confirmed slice's data/API/authz/audit shape
// is not blocked (see P01_REPOSITORY_VERIFICATION_RECONCILIATION.md §4) —
// this screen is built against Accounting UI Foundation V1 patterns per the
// governance instruction to classify honestly as BASELINE_PRODUCT_QUALITY
// whenever no exact screen mock exists.
//
// DESIGN CLASSIFICATION: BASELINE_PRODUCT_QUALITY — no P01-SCR-04 pixel mock
// was located in the Claude Design source; this screen reuses the certified
// Foundation V1 table/badge/panel primitives (PeriodControl.tsx, S008)
// rather than any bespoke registry mock.

interface AnalysisValueRow {
  id: string;
  typeId: string;
  code: string;
  name: string;
  isActive: boolean;
  version: number;
}

interface AnalysisTypeRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  version: number;
  values: AnalysisValueRow[];
}

type Drawer =
  | { kind: 'new-type' }
  | { kind: 'new-value'; typeId: string; typeCode: string }
  | { kind: 'deactivate-type'; type: AnalysisTypeRow }
  | { kind: 'deactivate-value'; typeId: string; typeCode: string; value: AnalysisValueRow }
  | null;

export default function AnalysisCodeRegistry() {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [form, setForm] = useState<{ code: string; name: string; reason: string; message?: string }>({
    code: '',
    name: '',
    reason: '',
  });
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<{ items: AnalysisTypeRow[]; total: number }>({
    queryKey: ['analysis-code-types'],
    queryFn: () => goldenPathApi.listAnalysisTypes(),
    retry: false,
  });

  const types = useMemo(() => data?.items ?? [], [data]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['analysis-code-types'] });
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openNewType() {
    setForm({ code: '', name: '', reason: '' });
    setDrawer({ kind: 'new-type' });
  }
  function openNewValue(typeId: string, typeCode: string) {
    setForm({ code: '', name: '', reason: '' });
    setDrawer({ kind: 'new-value', typeId, typeCode });
  }
  function openDeactivateType(type: AnalysisTypeRow) {
    setForm({ code: '', name: '', reason: '' });
    setDrawer({ kind: 'deactivate-type', type });
  }
  function openDeactivateValue(typeId: string, typeCode: string, value: AnalysisValueRow) {
    setForm({ code: '', name: '', reason: '' });
    setDrawer({ kind: 'deactivate-value', typeId, typeCode, value });
  }
  function closeDrawer() {
    setDrawer(null);
  }

  async function submit() {
    if (!drawer) return;
    setBusy(true);
    try {
      if (drawer.kind === 'new-type') {
        if (!form.code.trim() || !form.name.trim()) {
          setForm({ ...form, message: 'Code and name are both required.' });
          setBusy(false);
          return;
        }
        await goldenPathApi.createAnalysisType({ code: form.code.trim(), name: form.name.trim() });
      } else if (drawer.kind === 'new-value') {
        if (!form.code.trim() || !form.name.trim()) {
          setForm({ ...form, message: 'Code and name are both required.' });
          setBusy(false);
          return;
        }
        await goldenPathApi.createAnalysisValue(drawer.typeId, { code: form.code.trim(), name: form.name.trim() });
      } else if (drawer.kind === 'deactivate-type') {
        if (!form.reason.trim()) {
          setForm({ ...form, message: 'A reason is required to deactivate.' });
          setBusy(false);
          return;
        }
        await goldenPathApi.deactivateAnalysisType(drawer.type.id, { version: drawer.type.version, reason: form.reason.trim() });
      } else if (drawer.kind === 'deactivate-value') {
        if (!form.reason.trim()) {
          setForm({ ...form, message: 'A reason is required to deactivate.' });
          setBusy(false);
          return;
        }
        await goldenPathApi.deactivateAnalysisValue(drawer.typeId, drawer.value.id, {
          version: drawer.value.version,
          reason: form.reason.trim(),
        });
      }
      setDrawer(null);
      await refresh();
    } catch (err: any) {
      setForm({ ...form, message: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <PageLoader page="Analysis Code Registry" service="coa-service" port={3016} />;

  if (error) {
    const status = (error as any)?.status;
    if (status === 401 || status === 403) {
      return (
        <div className="p-7">
          <EmptyState
            title="Unauthorized"
            description="You do not have the analysis.code.view permission required to view the analysis-code registry. Contact your Controller or Admin."
          />
        </div>
      );
    }
    return <PageError error={error as Error} serviceName="coa-service" port={3016} retry={() => refetch()} />;
  }

  return (
    <div className="p-7 min-h-full">
      <PageHeader
        title="Analysis Code Registry"
        subtitle="Tenant-wide dimensions (types) and their values for tagging journal lines (S011). Deactivate-only — no delete."
        actions={<Btn variant="primary" size="md" icon={<Tag size={14} />} onClick={openNewType} data-testid="new-type-btn">New type…</Btn>}
      />

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
        {types.length === 0 ? (
          <EmptyState
            title="No analysis code types yet"
            description="Create a type (e.g. Project, Campaign) to begin tagging journal lines with dimensions beyond store and department."
            action={<Btn variant="secondary" size="sm" onClick={openNewType}>New type…</Btn>}
          />
        ) : (
          <table className="w-full border-collapse" data-testid="analysis-type-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Type</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-slate-600">Values</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const isOpen = expanded.has(t.id);
                return (
                  <Fragment key={t.id}>
                    <tr data-testid={`analysis-type-row-${t.code}`} className="h-9 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-0">
                        <button
                          className="inline-flex items-center gap-1.5 font-mono text-[13px] font-semibold text-slate-800"
                          onClick={() => toggle(t.id)}
                          data-testid={`expand-type-${t.code}`}
                        >
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {t.code} — {t.name}
                        </button>
                      </td>
                      <td className="px-4 py-0" data-testid={`type-status-${t.code}`}>
                        <Badge variant={t.isActive ? 'success' : 'neutral'} dot>{t.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>
                      </td>
                      <td className="px-4 py-0 text-center text-[13px] text-slate-600">{t.values.length}</td>
                      <td className="px-4 py-0">
                        <div className="flex items-center gap-2">
                          {t.isActive && (
                            <>
                              <Btn variant="secondary" size="sm" onClick={() => openNewValue(t.id, t.code)} data-testid={`new-value-${t.code}`}>
                                New value…
                              </Btn>
                              <Btn variant="danger" size="sm" onClick={() => openDeactivateType(t)} data-testid={`deactivate-type-${t.code}`}>
                                Deactivate…
                              </Btn>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4} className="px-4 py-3 bg-slate-50/60">
                          {t.values.length === 0 ? (
                            <p className="text-xs text-slate-400 pl-6">No values yet for this type.</p>
                          ) : (
                            <table className="w-full border-collapse ml-6" data-testid={`analysis-value-table-${t.code}`}>
                              <tbody>
                                {t.values.map((v) => (
                                  <tr key={v.id} data-testid={`analysis-value-row-${t.code}-${v.code}`} className="h-8">
                                    <td className="px-2 py-0 font-mono text-xs text-slate-700 w-32">{v.code}</td>
                                    <td className="px-2 py-0 text-xs text-slate-700">{v.name}</td>
                                    <td className="px-2 py-0">
                                      <Badge variant={v.isActive ? 'success' : 'neutral'} dot>{v.isActive ? 'ACTIVE' : 'INACTIVE'}</Badge>
                                    </td>
                                    <td className="px-2 py-0 text-right">
                                      {v.isActive && (
                                        <Btn variant="danger" size="sm" onClick={() => openDeactivateValue(t.id, t.code, v)} data-testid={`deactivate-value-${t.code}-${v.code}`}>
                                          Deactivate…
                                        </Btn>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {drawer && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" data-testid="analysis-drawer">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h2 className="text-base font-bold text-slate-900 mb-4">
              {drawer.kind === 'new-type' && 'New analysis code type'}
              {drawer.kind === 'new-value' && `New value for ${drawer.typeCode}`}
              {drawer.kind === 'deactivate-type' && `Deactivate type ${drawer.type.code}`}
              {drawer.kind === 'deactivate-value' && `Deactivate value ${drawer.value.code}`}
            </h2>

            {(drawer.kind === 'new-type' || drawer.kind === 'new-value') && (
              <div className="flex flex-col gap-3">
                <label className="text-xs font-semibold text-slate-600">
                  Code
                  <input
                    className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    data-testid="drawer-code-input"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  Name
                  <input
                    className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    data-testid="drawer-name-input"
                  />
                </label>
              </div>
            )}

            {(drawer.kind === 'deactivate-type' || drawer.kind === 'deactivate-value') && (
              <label className="text-xs font-semibold text-slate-600">
                Reason (required)
                <textarea
                  className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm"
                  rows={3}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  data-testid="drawer-reason-input"
                />
              </label>
            )}

            {form.message && <p className="text-xs text-red-600 mt-2" data-testid="drawer-message">{form.message}</p>}

            <div className="flex items-center justify-end gap-2 mt-5">
              <Btn variant="ghost" size="sm" onClick={closeDrawer} disabled={busy}>Cancel</Btn>
              <Btn
                variant={drawer.kind.startsWith('deactivate') ? 'danger' : 'primary'}
                size="sm"
                onClick={submit}
                loading={busy}
                data-testid="drawer-submit"
              >
                {drawer.kind.startsWith('deactivate') ? 'Deactivate' : 'Create'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
