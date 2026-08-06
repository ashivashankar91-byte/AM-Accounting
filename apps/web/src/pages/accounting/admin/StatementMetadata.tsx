import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus } from 'lucide-react';
import { glApi } from '../../../api/client';
import { PageHeader, Btn, Badge, EmptyState } from '../../../components/ui';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';

// S009 Story Contract (P01-SCR-06, "Statement Metadata Administration") —
// Controller/Admin-facing governance screen for the BS/IS presentation
// taxonomy (StatementLine catalog) and the effective-dated account->line
// mapping history (GLAccountStatementLineHistory), per
// docs/accounting-modernization/S009_DECISION_MEMO.md and BLK-07/08/09.
//
// Scope note (disclosed, not hidden): mappings recorded here establish
// governed, audited history for the account->statement-line taxonomy.
// They do NOT yet change which section an account renders under on the
// Balance Sheet/Income Statement -- that placement is still driven by
// accountType alone (financial-statement-service.ts, BLK-07: "registry
// ships empty in v1"). This screen is the governance/audit layer that a
// future finer-grained statement-grouping pass will consume.

type Statement = 'BS' | 'IS';

interface StatementLine {
  id: string;
  code: string;
  name: string;
  statement: Statement;
  section: string;
  sortOrder: number;
  isActive: boolean;
}

interface GLAccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  statementLineId?: string | null;
}

interface LineForm {
  mode: 'create' | 'edit';
  id?: string;
  code: string;
  name: string;
  statement: Statement;
  section: string;
  sortOrder: string;
  isActive: boolean;
}

interface MetadataForm {
  glAccountId: string;
  statementLineId: string;
  effectiveFrom: string;
  reason: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function StatementMetadata() {
  const queryClient = useQueryClient();
  const [unauthorized, setUnauthorized] = useState(false);

  const linesQuery = useQuery<StatementLine[]>({
    queryKey: ['s009-statement-lines'],
    queryFn: () => glApi.listStatementLines(),
    retry: false,
  });
  const accountsQuery = useQuery<GLAccountRow[]>({
    queryKey: ['s009-gl-accounts'],
    queryFn: () => glApi.getAccounts(),
    retry: false,
  });

  const loading = linesQuery.isLoading || accountsQuery.isLoading;
  const loadError = linesQuery.error ?? accountsQuery.error;

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['s009-statement-lines'] }),
      queryClient.invalidateQueries({ queryKey: ['s009-gl-accounts'] }),
    ]);
  }

  const lines = linesQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];

  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);

  // Anomaly per BLK-12/DISTRIBUTION (S009): DISTRIBUTION-type accounts are a
  // posting-expansion mechanism, never a statement section -- one carrying a
  // statement-line mapping is a data-hygiene anomaly, distinct from (and a
  // precursor check to) the report-time DISTRIBUTION_BALANCE_ANOMALY.
  const distributionAnomalies = useMemo(
    () => accounts.filter((a) => a.type === 'DISTRIBUTION' && a.statementLineId),
    [accounts],
  );
  // Unmapped review worklist: postable statement-bearing account types with
  // no current mapping. Informational only -- not an error state, since
  // mapping is optional governance metadata in v1 (BLK-07).
  const unmappedAccounts = useMemo(
    () => accounts.filter((a) => a.type !== 'DISTRIBUTION' && !a.statementLineId),
    [accounts],
  );

  // ── Statement-line catalog form ──────────────────────────────────────────
  const [lineForm, setLineForm] = useState<LineForm | null>(null);
  const [lineSaving, setLineSaving] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);

  function startCreateLine() {
    setLineForm({ mode: 'create', code: '', name: '', statement: 'IS', section: '', sortOrder: '0', isActive: true });
    setLineError(null);
  }
  function startEditLine(line: StatementLine) {
    setLineForm({
      mode: 'edit', id: line.id, code: line.code, name: line.name,
      statement: line.statement, section: line.section, sortOrder: String(line.sortOrder), isActive: line.isActive,
    });
    setLineError(null);
  }
  function cancelLineForm() {
    setLineForm(null);
    setLineError(null);
  }

  async function submitLineForm() {
    if (!lineForm) return;
    setLineSaving(true);
    setLineError(null);
    try {
      const sortOrder = lineForm.sortOrder.trim() ? Number(lineForm.sortOrder) : undefined;
      if (lineForm.mode === 'create') {
        await glApi.createStatementLine({
          code: lineForm.code.trim(),
          name: lineForm.name.trim(),
          statement: lineForm.statement,
          section: lineForm.section.trim(),
          sortOrder,
        });
      } else {
        await glApi.updateStatementLine(lineForm.id!, {
          name: lineForm.name.trim(),
          section: lineForm.section.trim(),
          sortOrder,
          isActive: lineForm.isActive,
        });
      }
      setLineForm(null);
      await refresh();
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(true);
      else setLineError(err.message);
    } finally {
      setLineSaving(false);
    }
  }

  // ── Account statement-metadata assignment (single) ───────────────────────
  const [metaForm, setMetaForm] = useState<MetadataForm | null>(null);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaSuccess, setMetaSuccess] = useState<string | null>(null);
  const [overlapConflict, setOverlapConflict] = useState<{ glAccountId: string; effectiveFrom: string } | null>(null);

  function startAssign(account: GLAccountRow) {
    setMetaForm({
      glAccountId: account.id,
      statementLineId: account.statementLineId ?? '',
      effectiveFrom: todayIso(),
      reason: '',
    });
    setMetaError(null);
    setOverlapConflict(null);
    setMetaSuccess(null);
  }
  function cancelMetaForm() {
    setMetaForm(null);
    setMetaError(null);
    setOverlapConflict(null);
  }

  async function submitMetaForm() {
    if (!metaForm) return;
    if (!metaForm.reason.trim()) {
      setMetaError('A reason is required for every statement-metadata change (BLK-09).');
      return;
    }
    setMetaSaving(true);
    setMetaError(null);
    setOverlapConflict(null);
    try {
      await glApi.setAccountStatementMetadata(metaForm.glAccountId, {
        statementLineId: metaForm.statementLineId || null,
        effectiveFrom: metaForm.effectiveFrom,
        reason: metaForm.reason.trim(),
      });
      setMetaForm(null);
      setMetaSuccess('Statement metadata saved.');
      await refresh();
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(true);
      else if (err.body?.error === 'STATEMENT_METADATA_EFFECTIVE_RANGE_OVERLAP') {
        setOverlapConflict({ glAccountId: err.body.glAccountId, effectiveFrom: err.body.effectiveFrom });
        setMetaError(err.message);
      } else {
        setMetaError(err.message);
      }
    } finally {
      setMetaSaving(false);
    }
  }

  // ── Bulk assignment ───────────────────────────────────────────────────────
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSelection, setBulkSelection] = useState<Record<string, boolean>>({});
  const [bulkStatementLineId, setBulkStatementLineId] = useState('');
  const [bulkEffectiveFrom, setBulkEffectiveFrom] = useState(todayIso());
  const [bulkReason, setBulkReason] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  function toggleBulk(id: string) {
    setBulkSelection((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function submitBulk() {
    const selectedIds = Object.entries(bulkSelection).filter(([, v]) => v).map(([id]) => id);
    if (selectedIds.length === 0) {
      setBulkError('Select at least one account.');
      return;
    }
    if (!bulkReason.trim()) {
      setBulkError('A reason is required for every statement-metadata change (BLK-09).');
      return;
    }
    setBulkSaving(true);
    setBulkError(null);
    try {
      await glApi.bulkSetAccountStatementMetadata(
        selectedIds.map((glAccountId) => ({
          glAccountId,
          statementLineId: bulkStatementLineId || null,
          effectiveFrom: bulkEffectiveFrom,
          reason: bulkReason.trim(),
        })),
      );
      setBulkOpen(false);
      setBulkSelection({});
      setBulkReason('');
      setMetaSuccess(`Bulk statement metadata saved for ${selectedIds.length} account(s).`);
      await refresh();
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(true);
      else if (err.body?.error === 'STATEMENT_METADATA_EFFECTIVE_RANGE_OVERLAP') {
        setBulkError(`${err.message} (account ${err.body.glAccountId})`);
      } else {
        setBulkError(err.message);
      }
    } finally {
      setBulkSaving(false);
    }
  }

  if (unauthorized) {
    return (
      <div className="p-7">
        <PageHeader title="Statement Metadata" subtitle="Balance Sheet / Income Statement presentation taxonomy and account mapping governance." />
        <div data-testid="statement-metadata-unauthorized" className="bg-white border border-red-200 rounded-xl shadow-sm p-8 flex flex-col items-center gap-3 max-w-md">
          <AlertTriangle className="text-red-500" size={28} />
          <p className="text-sm font-semibold text-slate-900">Not authorized</p>
          <p className="text-sm text-slate-500 text-center">
            You do not have permission to view or configure statement metadata. This screen requires
            gl.statement_line.manage or gl.statement_metadata.manage.
          </p>
        </div>
      </div>
    );
  }

  if (loading) return <PageLoader page="Statement Metadata" service="gl-service" port={3014} />;
  if (loadError) return <PageError error={loadError as Error} serviceName="gl-service" port={3014} retry={() => refresh()} />;

  return (
    <div className="p-7 min-h-full" data-testid="statement-metadata-page">
      <PageHeader
        title="Statement Metadata"
        subtitle="Balance Sheet / Income Statement presentation taxonomy and effective-dated account mapping governance (S009)."
        actions={
          <>
            <Btn data-testid="sm-new-line" size="sm" variant="secondary" icon={<Plus size={14} />} onClick={startCreateLine}>
              New statement line
            </Btn>
            <Btn data-testid="sm-bulk-open" size="sm" variant="secondary" onClick={() => setBulkOpen(true)}>
              Bulk assign…
            </Btn>
          </>
        }
      />

      {metaSuccess && (
        <div data-testid="statement-metadata-success" className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-3 py-2 mb-4">
          {metaSuccess}
        </div>
      )}

      {/* Anomalies requiring action */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-5">
        <h2 className="text-sm font-bold text-slate-900 mb-3">DISTRIBUTION account review</h2>
        {distributionAnomalies.length === 0 ? (
          <p data-testid="sm-no-anomalies" className="text-sm text-slate-500">
            No anomalies — no DISTRIBUTION-type account currently carries a statement-line mapping.
          </p>
        ) : (
          <div data-testid="sm-anomalies" className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs font-bold text-red-700 mb-1.5 flex items-center gap-1.5">
              <AlertTriangle size={14} /> {distributionAnomalies.length} DISTRIBUTION account(s) unexpectedly mapped to a statement line
            </p>
            <ul className="space-y-1">
              {distributionAnomalies.map((a) => (
                <li key={a.id} data-testid={`sm-anomaly-${a.code}`} className="text-xs font-mono text-red-800">
                  {a.code} — {a.name} → {lineById.get(a.statementLineId!)?.name ?? a.statementLineId}
                </li>
              ))}
            </ul>
          </div>
        )}
        {unmappedAccounts.length > 0 && (
          <p data-testid="sm-unmapped-count" className="text-xs text-slate-400 mt-3">
            {unmappedAccounts.length} account(s) have no current statement-line mapping (optional in v1 — governance metadata only).
          </p>
        )}
      </div>

      {/* Statement-line catalog */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
        <div className="px-4 py-2.5 border-b-2 border-slate-200 bg-slate-50">
          <h2 className="text-sm font-bold text-slate-900">Statement-line catalog</h2>
        </div>
        {lines.length === 0 ? (
          <EmptyState
            title="No statement lines yet"
            description="The presentation taxonomy ships empty in v1 (BLK-07) — create the first BS/IS statement line to begin."
          />
        ) : (
          <table className="w-full border-collapse" data-testid="statement-line-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Code</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Name</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Statement</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Section</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} data-testid={`statement-line-row-${l.code}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-0 font-mono text-[13px] font-semibold text-slate-800">{l.code}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{l.name}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-500">{l.statement}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-500">{l.section}</td>
                  <td className="px-4 py-0 text-center">
                    <Badge variant={l.isActive ? 'success' : 'neutral'} dot>{l.isActive ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td className="px-4 py-1">
                    <Btn data-testid={`statement-line-edit-${l.code}`} size="sm" variant="ghost" onClick={() => startEditLine(l)}>
                      Edit
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Statement-line create/edit panel */}
      {lineForm && (
        <div data-testid="statement-line-form" className="bg-white border-l-4 border-l-brand border-y border-r border-slate-200 rounded-xl shadow-sm p-5 max-w-lg mb-5">
          <h3 className="text-sm font-bold text-slate-900 mb-3">
            {lineForm.mode === 'create' ? 'New statement line' : `Edit — ${lineForm.code}`}
          </h3>

          {lineForm.mode === 'create' && (
            <>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Code</label>
              <input
                data-testid="statement-line-code-input"
                value={lineForm.code}
                onChange={(e) => setLineForm({ ...lineForm, code: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <label className="block text-xs font-semibold text-slate-600 mb-1">Statement</label>
              <select
                data-testid="statement-line-statement-select"
                value={lineForm.statement}
                onChange={(e) => setLineForm({ ...lineForm, statement: e.target.value as Statement })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
              >
                <option value="BS">Balance Sheet</option>
                <option value="IS">Income Statement</option>
              </select>
            </>
          )}

          <label className="block text-xs font-semibold text-slate-600 mb-1">Name</label>
          <input
            data-testid="statement-line-name-input"
            value={lineForm.name}
            onChange={(e) => setLineForm({ ...lineForm, name: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <label className="block text-xs font-semibold text-slate-600 mb-1">Section</label>
          <input
            data-testid="statement-line-section-input"
            value={lineForm.section}
            onChange={(e) => setLineForm({ ...lineForm, section: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <label className="block text-xs font-semibold text-slate-600 mb-1">Sort order</label>
          <input
            data-testid="statement-line-sort-input"
            type="number"
            value={lineForm.sortOrder}
            onChange={(e) => setLineForm({ ...lineForm, sortOrder: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
          />

          {lineForm.mode === 'edit' && (
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 mb-3">
              <input
                data-testid="statement-line-active-checkbox"
                type="checkbox"
                checked={lineForm.isActive}
                onChange={(e) => setLineForm({ ...lineForm, isActive: e.target.checked })}
              />
              Active
            </label>
          )}

          {lineError && <p data-testid="statement-line-error" className="text-xs text-danger font-medium mb-3">{lineError}</p>}

          <div className="flex items-center gap-2">
            <Btn variant="ghost" size="sm" onClick={cancelLineForm}>Cancel</Btn>
            <Btn variant="primary" size="sm" data-testid="statement-line-submit" onClick={submitLineForm} disabled={lineSaving} loading={lineSaving}>
              Save
            </Btn>
          </div>
        </div>
      )}

      {/* GL Account -> statement-line mapping */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
        <div className="px-4 py-2.5 border-b-2 border-slate-200 bg-slate-50">
          <h2 className="text-sm font-bold text-slate-900">GL account mappings</h2>
        </div>
        {accounts.length === 0 ? (
          <EmptyState title="No GL accounts found" description="Seed the Chart of Accounts before assigning statement metadata." />
        ) : (
          <table className="w-full border-collapse" data-testid="account-mapping-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Code</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Name</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Type</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Current mapping</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} data-testid={`account-mapping-row-${a.code}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-0 font-mono text-[13px] font-semibold text-slate-800">{a.code}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{a.name}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-500">{a.type}</td>
                  <td className="px-4 py-0 text-[13px]" data-testid={`account-mapping-current-${a.code}`}>
                    {a.statementLineId
                      ? (lineById.get(a.statementLineId)?.name ?? a.statementLineId)
                      : <span className="text-slate-400">Unmapped</span>}
                  </td>
                  <td className="px-4 py-1">
                    <Btn data-testid={`account-mapping-assign-${a.code}`} size="sm" variant="ghost" onClick={() => startAssign(a)}>
                      Assign…
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Single-account assignment panel */}
      {metaForm && (
        <div data-testid="account-metadata-form" className="bg-white border-l-4 border-l-brand border-y border-r border-slate-200 rounded-xl shadow-sm p-5 max-w-lg mb-5">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Assign statement metadata</h3>

          <label className="block text-xs font-semibold text-slate-600 mb-1">Statement line</label>
          <select
            data-testid="account-metadata-line-select"
            value={metaForm.statementLineId}
            onChange={(e) => setMetaForm({ ...metaForm, statementLineId: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">— Unmap (clear current mapping) —</option>
            {lines.filter((l) => l.isActive).map((l) => (
              <option key={l.id} value={l.id}>{l.statement} · {l.section} · {l.name}</option>
            ))}
          </select>

          <label className="block text-xs font-semibold text-slate-600 mb-1">Effective from</label>
          <input
            data-testid="account-metadata-effective-from-input"
            type="date"
            value={metaForm.effectiveFrom}
            onChange={(e) => setMetaForm({ ...metaForm, effectiveFrom: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
          />

          <label className="block text-xs font-semibold text-slate-600 mb-1">Reason (required — BLK-09)</label>
          <textarea
            data-testid="account-metadata-reason-input"
            value={metaForm.reason}
            onChange={(e) => setMetaForm({ ...metaForm, reason: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
            placeholder="Required — e.g. COA reclassification per Controller review"
          />

          {overlapConflict && (
            <div data-testid="account-metadata-overlap-conflict" className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 text-xs text-red-800">
              An effective-dated mapping already covers {overlapConflict.effectiveFrom} for this account — pick a
              non-overlapping effective date (BLK-09 requires immutable, non-overlapping history).
            </div>
          )}
          {metaError && !overlapConflict && (
            <p data-testid="account-metadata-error" className="text-xs text-danger font-medium mb-3">{metaError}</p>
          )}

          <div className="flex items-center gap-2">
            <Btn variant="ghost" size="sm" onClick={cancelMetaForm}>Cancel</Btn>
            <Btn variant="primary" size="sm" data-testid="account-metadata-submit" onClick={submitMetaForm} disabled={metaSaving} loading={metaSaving}>
              Save mapping
            </Btn>
          </div>
        </div>
      )}

      {/* Bulk assignment panel */}
      {bulkOpen && (
        <div data-testid="bulk-metadata-form" className="bg-white border-l-4 border-l-brand border-y border-r border-slate-200 rounded-xl shadow-sm p-5 max-w-2xl">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Bulk assign statement metadata</h3>

          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg mb-3">
            {accounts.map((a) => (
              <label key={a.id} data-testid={`bulk-account-${a.code}`} className="flex items-center gap-2 px-3 py-1.5 text-[13px] border-b border-slate-100 last:border-b-0">
                <input type="checkbox" checked={Boolean(bulkSelection[a.id])} onChange={() => toggleBulk(a.id)} />
                <span className="font-mono font-semibold">{a.code}</span>
                <span className="text-slate-500">{a.name}</span>
                <span className="text-slate-400 text-[11px] ml-auto">{a.type}</span>
              </label>
            ))}
          </div>

          <label className="block text-xs font-semibold text-slate-600 mb-1">Statement line</label>
          <select
            data-testid="bulk-metadata-line-select"
            value={bulkStatementLineId}
            onChange={(e) => setBulkStatementLineId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">— Unmap (clear current mapping) —</option>
            {lines.filter((l) => l.isActive).map((l) => (
              <option key={l.id} value={l.id}>{l.statement} · {l.section} · {l.name}</option>
            ))}
          </select>

          <label className="block text-xs font-semibold text-slate-600 mb-1">Effective from</label>
          <input
            data-testid="bulk-metadata-effective-from-input"
            type="date"
            value={bulkEffectiveFrom}
            onChange={(e) => setBulkEffectiveFrom(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
          />

          <label className="block text-xs font-semibold text-slate-600 mb-1">Reason (required — BLK-09)</label>
          <textarea
            data-testid="bulk-metadata-reason-input"
            value={bulkReason}
            onChange={(e) => setBulkReason(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-brand"
            placeholder="Required — applies to every selected account"
          />

          {bulkError && <p data-testid="bulk-metadata-error" className="text-xs text-danger font-medium mb-3">{bulkError}</p>}

          <div className="flex items-center gap-2">
            <Btn variant="ghost" size="sm" onClick={() => { setBulkOpen(false); setBulkError(null); }}>Cancel</Btn>
            <Btn variant="primary" size="sm" data-testid="bulk-metadata-submit" onClick={submitBulk} disabled={bulkSaving} loading={bulkSaving}>
              Save bulk mapping
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
