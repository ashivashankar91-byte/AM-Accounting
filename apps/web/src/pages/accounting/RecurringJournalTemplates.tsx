import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileClock, Lock, Plus, RefreshCw, Repeat, Zap } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { recurringTemplateApi, goldenPathApi, authzApi } from '../../api/client';
import { Btn, Badge, EmptyState, PageHeader } from '../../components/ui';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';

// S032 — P01-SCR-07 Template Registry + P01-SCR-09 Generation Ceremony.
// Real coa-service integration (recurringTemplateApi), never the legacy
// gl-service.JournalTemplate mock path used by ./JournalTemplateList.tsx.
// BLK-21: generation is a manual ceremony only — there is no scheduler
// control anywhere on this page.

interface GenerateResultEntry {
  templateId: string;
  templateCode: string;
  draftId?: string;
  idempotent?: boolean;
  error?: { code: string; message: string };
}

function Unauthorized({ message }: { message?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex flex-col items-center gap-4 max-w-sm w-full text-center">
        <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center">
          <Lock size={20} className="text-amber-600" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900 mb-1">Not authorized</h2>
          <p className="text-sm text-slate-500">
            {message ?? 'Your role does not hold je.template.manage / je.template.view for this tenant.'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function RecurringJournalTemplates() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { legalEntityId, tenantId, user } = useAuth();
  const [showGenerate, setShowGenerate] = useState(false);

  const templatesQuery = useQuery({
    queryKey: ['recurring-templates', legalEntityId],
    queryFn: () => recurringTemplateApi.list(legalEntityId!),
    enabled: !!legalEntityId,
    retry: false,
  });

  // Authorization-only UX: hide/disable manage actions (create/edit/activate)
  // for a caller who holds je.template.view/generate but not .manage (e.g.
  // ACCOUNTANT under the approved R1 permission model). The server-side
  // guard is the actual authority — this only avoids offering an action the
  // server will 403 anyway; fails closed (defaults to false) while loading
  // or on any error.
  const manageCheck = useQuery({
    queryKey: ['authz-check', 'je.template.manage', tenantId, user?.id],
    queryFn: () => authzApi.check(user!.id, 'je.template.manage', tenantId!),
    enabled: !!tenantId && !!user?.id,
    retry: false,
  });
  const canManage = manageCheck.data?.allow === true;

  const toggleActive = async (id: string, active: boolean) => {
    await (active ? recurringTemplateApi.deactivate(id) : recurringTemplateApi.activate(id));
    queryClient.invalidateQueries({ queryKey: ['recurring-templates', legalEntityId] });
  };

  if (!legalEntityId) {
    return (
      <div style={{ margin: 40 }}>
        <p>No legal entity selected.</p>
        <Link to="/golden-path/select-entity">Select a legal entity</Link>
      </div>
    );
  }

  const err: any = templatesQuery.error;
  if (err && (err.status === 401 || err.status === 403)) {
    return <Unauthorized message={err.message} />;
  }
  if (templatesQuery.isLoading) {
    return <PageLoader page="Recurring Journal Templates" service="coa-service" port={3016} />;
  }
  if (templatesQuery.error) {
    return <PageError error={templatesQuery.error as Error} retry={() => templatesQuery.refetch()} serviceName="coa-service" port={3016} />;
  }

  const templates = templatesQuery.data?.templates ?? [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Recurring Journal Templates"
        subtitle="S032 — fixed debit/credit templates, generated on demand into a manual JE draft. No scheduler; generation is always a deliberate ceremony."
        actions={
          <>
            <Btn variant="secondary" icon={<RefreshCw className="w-4 h-4" />} onClick={() => templatesQuery.refetch()}>
              Refresh
            </Btn>
            <Btn variant="secondary" icon={<Zap className="w-4 h-4" />} onClick={() => setShowGenerate(true)} disabled={templates.length === 0}>
              Generate for Period…
            </Btn>
            <Btn
              icon={<Plus className="w-4 h-4" />}
              onClick={() => navigate('/accounting/journals/templates/new')}
              disabled={!canManage}
              title={canManage ? undefined : 'Requires je.template.manage'}
            >
              New Template
            </Btn>
          </>
        }
      />

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {templates.length === 0 ? (
          <EmptyState
            icon={<Repeat className="w-6 h-6" />}
            title="No recurring journal templates yet"
            description="Create a fixed-amount template (e.g. monthly rent, depreciation split) to generate its draft journal for any period on demand."
            action={
              canManage ? (
                <Btn icon={<Plus className="w-4 h-4" />} onClick={() => navigate('/accounting/journals/templates/new')}>
                  New Template
                </Btn>
              ) : undefined
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">Code</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide">Name</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide w-24">Source</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide w-16">Lines</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide whitespace-nowrap">Auto-Reverse</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide w-24">Status</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide w-40">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.map((t: any) => (
                <tr key={t.id} style={{ height: 36 }} className="hover:bg-brand-light cursor-pointer" onDoubleClick={() => navigate(`/accounting/journals/templates/${t.id}`)}>
                  <td className="px-4 py-2 font-mono font-bold text-brand">{t.code}</td>
                  <td className="px-4 py-2">{t.name}</td>
                  <td className="px-4 py-2"><Badge variant="info">{t.sourceCode}</Badge></td>
                  <td className="px-4 py-2 text-right font-mono">{t.lines.length}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{t.autoReverse ? <Badge variant="purple">Auto-Reverse</Badge> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2">
                    <Badge variant={t.active ? 'success' : 'neutral'}>{t.active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1 justify-end">
                      <Btn size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); navigate(`/accounting/journals/templates/${t.id}`); }}>
                        {canManage ? 'Edit' : 'View'}
                      </Btn>
                      <Btn
                        size="sm"
                        variant={t.active ? 'danger' : 'secondary'}
                        disabled={!canManage}
                        title={canManage ? undefined : 'Requires je.template.manage'}
                        onClick={(e) => { e.stopPropagation(); toggleActive(t.id, t.active); }}
                      >
                        {t.active ? 'Deactivate' : 'Activate'}
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showGenerate && (
        <GenerateCeremony
          entityId={legalEntityId}
          templates={templates}
          onClose={() => setShowGenerate(false)}
        />
      )}
    </div>
  );
}

// ── P01-SCR-09 Generation Ceremony ────────────────────────────────────────────
function GenerateCeremony({ entityId, templates, onClose }: { entityId: string; templates: any[]; onClose: () => void }) {
  const [periodId, setPeriodId] = useState('');
  const [mode, setMode] = useState<'ALL' | 'SELECT'>('ALL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ batchId: string; periodCode: string; results: GenerateResultEntry[] } | null>(null);

  const periodsQuery = useQuery({
    queryKey: ['fiscal-period-board', entityId],
    queryFn: () => goldenPathApi.getPeriodBoard(entityId),
    retry: false,
  });
  const periods = periodsQuery.data?.board ?? [];

  const toggleSelected = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const handleGenerate = async () => {
    if (!periodId) return;
    setBusy(true);
    setError(null);
    try {
      const templateIds: string[] | 'ALL' = mode === 'ALL' ? 'ALL' : Array.from(selected);
      const r = await recurringTemplateApi.generate({ entityId, periodId, templateIds });
      setResult(r);
    } catch (e: any) {
      setError(e.message ?? 'Generation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[80vh] overflow-auto">
        <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white">
          <h3 className="font-semibold flex items-center gap-2"><FileClock className="w-4 h-4" /> Generate for Period</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {!result && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Target period</label>
                <select
                  value={periodId}
                  onChange={(e) => setPeriodId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
                >
                  <option value="">Select a period…</option>
                  {periods.map((p: any) => (
                    <option key={p.periodId} value={p.periodId}>
                      {p.periodCode} — {p.status}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Generated entries are dated the period's end date (BLK-24). Generation is refused outright if the period is not OPEN (BR032-6).
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={mode === 'ALL'} onChange={() => setMode('ALL')} />
                  All active templates ({templates.filter((t) => t.active).length})
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={mode === 'SELECT'} onChange={() => setMode('SELECT')} />
                  Select specific templates
                </label>
                {mode === 'SELECT' && (
                  <div className="ml-6 space-y-1 max-h-40 overflow-auto border rounded-lg p-2">
                    {templates.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelected(t.id)} />
                        <span className="font-mono text-brand">{t.code}</span> {t.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-2 pt-4 border-t">
                <Btn variant="secondary" className="flex-1" onClick={onClose}>Cancel</Btn>
                <Btn
                  className="flex-1"
                  loading={busy}
                  disabled={!periodId || (mode === 'SELECT' && selected.size === 0)}
                  onClick={handleGenerate}
                >
                  Generate
                </Btn>
              </div>
            </>
          )}

          {result && (
            <>
              <p className="text-sm text-slate-600">
                Batch <span className="font-mono">{result.batchId.slice(0, 8)}</span> for period <span className="font-mono">{result.periodCode}</span>
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2">Template</th>
                    <th className="text-left py-2">Result</th>
                    <th className="text-left py-2">Journal</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r) => (
                    <tr key={r.templateId} className="border-b border-slate-100">
                      <td className="py-2 font-mono">{r.templateCode}</td>
                      <td className="py-2">
                        {r.error ? (
                          <Badge variant="danger">{r.error.code}: {r.error.message}</Badge>
                        ) : r.idempotent ? (
                          <Badge variant="warning">Already generated — draft {r.draftId?.slice(0, 8)}</Badge>
                        ) : (
                          <Badge variant="success">DRAFT {r.draftId?.slice(0, 8)} created</Badge>
                        )}
                      </td>
                      <td className="py-2">
                        {/* S032 — opens the generated draft in the existing, certified
                            Journal Entry screen (JournalWorkflow.tsx) via a deep-link
                            query param; never a second editor. */}
                        {!r.error && r.draftId && (
                          <Link
                            to={`/golden-path/journal?draftId=${r.draftId}`}
                            data-testid={`open-in-journal-entry-${r.templateCode}`}
                            className="text-brand hover:underline"
                          >
                            Open in Journal Entry
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-slate-500">
                Each row is a manual JE draft (S214). Post it from the Journal Entry workflow when ready — generation never posts on your behalf.
              </p>
              <div className="flex gap-2 pt-4 border-t">
                <Btn className="flex-1" onClick={onClose}>Done</Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
