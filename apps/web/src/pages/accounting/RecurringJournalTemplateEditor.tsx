import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Lock, Plus, Save, Trash2, X } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { recurringTemplateApi, goldenPathApi, authzApi } from '../../api/client';
import { Btn, PageHeader } from '../../components/ui';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';

// S032 — P01-SCR-08 Template Editor. Reuses the JE line grid + balance bar
// pattern (JournalEntryTable.tsx) visually, wired to real entity-scoped
// accounts/stores (BLK-23: fixed dr/cr amounts only — no formula fields).

interface EditorLine {
  key: string;
  accountId: string;
  storeId: string;
  deptCode: string;
  dr: string;
  cr: string;
  memo: string;
}

function emptyLine(): EditorLine {
  return { key: Math.random().toString(36).slice(2), accountId: '', storeId: '', deptCode: '', dr: '', cr: '', memo: '' };
}

export default function RecurringJournalTemplateEditor() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isNew = !id;
  const { legalEntityId, tenantId, user } = useAuth();

  // Authorization-only UX: a caller holding je.template.view/generate but not
  // .manage (e.g. ACCOUNTANT under the approved R1 permission model) can open
  // an existing template read-only, but never create one or save changes.
  // The server-side guard is the actual authority; this only avoids offering
  // an action the server will 403 anyway. Fails closed while loading/on error.
  const manageCheck = useQuery({
    queryKey: ['authz-check', 'je.template.manage', tenantId, user?.id],
    queryFn: () => authzApi.check(user!.id, 'je.template.manage', tenantId!),
    enabled: !!tenantId && !!user?.id,
    retry: false,
  });
  const canManage = manageCheck.data?.allow === true;
  const readOnly = !canManage;

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [autoReverse, setAutoReverse] = useState(false);
  const [lines, setLines] = useState<EditorLine[]>([emptyLine(), emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; violations?: any[] } | null>(null);
  const [saved, setSaved] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['gp-accounts', legalEntityId],
    queryFn: () => goldenPathApi.listAccounts(legalEntityId!),
    enabled: !!legalEntityId,
    retry: false,
  });
  const storesQuery = useQuery({
    queryKey: ['gp-stores', legalEntityId],
    queryFn: () => goldenPathApi.listStores(legalEntityId!),
    enabled: !!legalEntityId,
    retry: false,
  });
  const templateQuery = useQuery({
    queryKey: ['recurring-template', id],
    queryFn: () => recurringTemplateApi.get(id!),
    enabled: !isNew,
    retry: false,
  });

  useEffect(() => {
    const t = templateQuery.data;
    if (!t) return;
    setCode(t.code);
    setName(t.name);
    setDescription(t.description ?? '');
    setAutoReverse(t.autoReverse);
    setLines(
      t.lines.map((l: any) => ({
        key: Math.random().toString(36).slice(2),
        accountId: l.accountId,
        storeId: l.storeId,
        deptCode: l.deptCode ?? '',
        dr: Number(l.dr) > 0 ? String(l.dr) : '',
        cr: Number(l.cr) > 0 ? String(l.cr) : '',
        memo: l.memo ?? '',
      })),
    );
  }, [templateQuery.data]);

  const accounts = accountsQuery.data?.accounts ?? [];
  const stores = storesQuery.data?.items ?? [];

  const updateLine = (key: string, patch: Partial<EditorLine>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (key: string) => setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.key !== key) : prev));

  const totalDr = lines.reduce((s, l) => s + (parseFloat(l.dr) || 0), 0);
  const totalCr = lines.reduce((s, l) => s + (parseFloat(l.cr) || 0), 0);
  const isBalanced = Math.abs(totalDr - totalCr) < 0.005 && totalDr > 0;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const payload = {
        entityId: legalEntityId!,
        code,
        name,
        description: description || null,
        autoReverse,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          storeId: l.storeId,
          deptCode: l.deptCode || null,
          dr: l.dr ? Number(l.dr) : 0,
          cr: l.cr ? Number(l.cr) : 0,
          memo: l.memo || null,
        })),
      };
      if (isNew) {
        await recurringTemplateApi.create(payload);
      } else {
        await recurringTemplateApi.update(id!, payload);
      }
      setSaved(true);
      setTimeout(() => navigate('/accounting/journals/templates'), 800);
    } catch (e: any) {
      setSaveError({ message: e.message, violations: e.body?.violations });
    } finally {
      setSaving(false);
    }
  };

  if (!legalEntityId) {
    return (
      <div style={{ margin: 40 }}>
        <p>No legal entity selected.</p>
        <Link to="/golden-path/select-entity">Select a legal entity</Link>
      </div>
    );
  }

  const loadErr: any = templateQuery.error;
  if (loadErr && (loadErr.status === 401 || loadErr.status === 403)) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-8">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex flex-col items-center gap-4 max-w-sm w-full text-center">
          <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center">
            <Lock size={20} className="text-amber-600" />
          </div>
          <h2 className="text-base font-bold text-slate-900">Not authorized</h2>
          <p className="text-sm text-slate-500">Your role does not hold je.template.manage for this tenant.</p>
        </div>
      </div>
    );
  }
  if ((!isNew && templateQuery.isLoading) || accountsQuery.isLoading || storesQuery.isLoading || (isNew && manageCheck.isLoading)) {
    return <PageLoader page="Template Editor" service="coa-service" port={3016} />;
  }
  if (templateQuery.error) {
    return <PageError error={templateQuery.error as Error} retry={() => templateQuery.refetch()} serviceName="coa-service" port={3016} />;
  }
  // Creating a new template requires je.template.manage (ACCOUNTANT holds
  // only view/generate under the approved R1 permission model) — there is
  // nothing to view read-only for a template that doesn't exist yet.
  if (isNew && !canManage) {
    return (
      <div className="flex items-center justify-center min-h-[400px] p-8">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex flex-col items-center gap-4 max-w-sm w-full text-center">
          <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center">
            <Lock size={20} className="text-amber-600" />
          </div>
          <h2 className="text-base font-bold text-slate-900">Not authorized</h2>
          <p className="text-sm text-slate-500">Creating a template requires je.template.manage for this tenant.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title={isNew ? 'New Recurring Journal Template' : `Edit Template — ${code}`}
        subtitle={
          readOnly
            ? 'View only — your role holds je.template.view/generate but not je.template.manage.'
            : "Fixed debit/credit amounts only (R1). The dedicated RT journal source is applied automatically on generation."
        }
        actions={
          saved ? (
            <div className="bg-green-50 text-green-700 px-4 py-2 rounded flex items-center gap-2">
              <Check className="w-4 h-4" /> Saved
            </div>
          ) : undefined
        }
      />

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={!isNew || readOnly}
              maxLength={40}
              placeholder="RENT-01"
              className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-slate-100"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              maxLength={120}
              placeholder="Monthly Rent Accrual"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-slate-100"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={readOnly}
            maxLength={500}
            placeholder="Optional"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-slate-100"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoReverse} onChange={(e) => setAutoReverse(e.target.checked)} disabled={readOnly} />
          Auto-reverse — when the generated journal posts, create a reversal draft dated the following period (posting it remains manual)
        </label>

        {/* JE-style line grid + balance bar (reuses the JournalEntryTable visual pattern) */}
        <div>
          <h4 className="text-sm font-semibold mb-2 text-slate-700">Template Lines</h4>
          <div className="overflow-x-auto border border-slate-300 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-300">
                  <th className="px-3 py-2 text-left font-semibold text-slate-700 w-8">#</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700 min-w-[220px]">GL Account</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700 w-28">Store</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700 w-24">Dept</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-700 w-28">Debit</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-700 w-28">Credit</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Memo</th>
                  <th className="px-3 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={line.key} className="border-b border-slate-200">
                    <td className="px-3 py-2 text-slate-600">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <select
                        value={line.accountId}
                        onChange={(e) => updateLine(line.key, { accountId: e.target.value })}
                        disabled={readOnly}
                        className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-slate-100"
                      >
                        <option value="">Account…</option>
                        {accounts.filter((a: any) => a.postable).map((a: any) => (
                          <option key={a.id} value={a.id}>{a.accountNumber} {a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={line.storeId}
                        onChange={(e) => updateLine(line.key, { storeId: e.target.value })}
                        disabled={readOnly}
                        className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-slate-100"
                      >
                        <option value="">Store…</option>
                        {stores.map((s: any) => (
                          <option key={s.id} value={s.id}>{s.storeCode ?? s.code ?? s.id}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={line.deptCode}
                        onChange={(e) => updateLine(line.key, { deptCode: e.target.value })}
                        disabled={readOnly}
                        placeholder="Dept"
                        className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-slate-100"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" step="0.01" min="0"
                        value={line.dr}
                        onChange={(e) => updateLine(line.key, { dr: e.target.value, cr: e.target.value ? '' : line.cr })}
                        disabled={readOnly}
                        className="w-full border rounded px-2 py-1 text-right font-mono text-sm focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-slate-100"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number" step="0.01" min="0"
                        value={line.cr}
                        onChange={(e) => updateLine(line.key, { cr: e.target.value, dr: e.target.value ? '' : line.dr })}
                        disabled={readOnly}
                        className="w-full border rounded px-2 py-1 text-right font-mono text-sm focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-slate-100"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={line.memo}
                        onChange={(e) => updateLine(line.key, { memo: e.target.value })}
                        disabled={readOnly}
                        placeholder="Memo"
                        className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-brand focus:outline-none disabled:bg-slate-100"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {!readOnly && lines.length > 2 && (
                        <button onClick={() => removeLine(line.key)} className="text-red-600 hover:text-red-800">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!readOnly && (
            <button onClick={addLine} className="mt-2 flex items-center gap-1 text-sm text-brand hover:underline">
              <Plus className="w-3.5 h-3.5" /> Add line
            </button>
          )}

          <div className="mt-3 border border-slate-300 rounded-lg p-3 bg-slate-50">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-right">
                <div className="text-xs text-slate-600 mb-1">Total Debits</div>
                <div className="font-mono font-semibold">${totalDr.toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-600 mb-1">Total Credits</div>
                <div className="font-mono font-semibold">${totalCr.toFixed(2)}</div>
              </div>
              <div className={`text-right flex items-center justify-end gap-2 ${isBalanced ? 'text-emerald-700' : 'text-red-700'}`}>
                <div>
                  <div className="text-xs text-slate-600 mb-1">Balance</div>
                  <div className="font-mono font-semibold">${(totalDr - totalCr).toFixed(2)}</div>
                </div>
                {isBalanced ? <Check className="w-5 h-5 text-emerald-600" /> : <X className="w-5 h-5 text-red-600" />}
              </div>
            </div>
          </div>
        </div>

        {saveError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm space-y-1">
            <p className="font-medium">{saveError.message}</p>
            {saveError.violations?.map((v: any, i: number) => (
              <p key={i}>Line {v.lineIndex >= 0 ? v.lineIndex + 1 : '—'}: {v.diagnostic}</p>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-4 border-t">
          <Btn variant="secondary" onClick={() => navigate('/accounting/journals/templates')}>
            {readOnly ? 'Back' : 'Cancel'}
          </Btn>
          {!readOnly && (
            <Btn icon={<Save className="w-4 h-4" />} loading={saving} disabled={!isBalanced || !code || !name} onClick={handleSave}>
              Save Template
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}
