/**
 * S054A/S054B — Bank Reconciliation Session Detail / Workspace.
 * Reads :id via useParams (wrapper pattern from VendorInvoices.tsx).
 *
 * Panels:
 *  - Statement Lines  (getStatementLines, addStatementLine, importStatementLines)
 *  - Book Items       (getBookItems, addManualBookItem, syncBookItems)
 *  - Manual Match     (match / unmatch with mandatory reason)
 *  - Auto-Match       (run, getSuggestions, confirmSuggestion, rejectSuggestion)
 *  - Match Rules      (listRules, createRule)
 *  - Complete Session (server's out-of-balance refusal shown verbatim in red banner)
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Plus, Check, X, AlertCircle, ChevronLeft, Upload, Zap } from 'lucide-react';
import { reconSessionApi, autoMatchApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, PageHeader, Badge, EmptyState } from '../../components/ui';

// ─── Types ───────────────────────────────────────────────────────────────────

type SessionStatus = 'OPEN' | 'COMPLETED' | 'LOCKED' | string;

function statusVariant(status: SessionStatus): 'neutral' | 'info' | 'success' | 'warning' {
  if (status === 'OPEN') return 'info';
  if (status === 'COMPLETED') return 'success';
  if (status === 'LOCKED') return 'warning';
  return 'neutral';
}

const fmtMoney = (n: number | string | undefined | null) =>
  n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string | undefined) => (d ? new Date(d).toLocaleDateString('en-US') : '—');

// ─── Wrapper: reads :id from URL params ───────────────────────────────────────

export default function BankReconSessionDetail() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <div className="p-6 text-red-600">No session ID in URL.</div>;
  return <SessionWorkspace id={id} />;
}

// ─── Main workspace ──────────────────────────────────────────────────────────

function SessionWorkspace({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Active tab: statement | book | match | automatch | rules
  const [activeTab, setActiveTab] = useState<'statement' | 'book' | 'match' | 'automatch' | 'rules'>('statement');

  // Complete-session error banner (server-sent, never bypassed)
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completeSuccess, setCompleteSuccess] = useState(false);

  // ── Queries ──

  const { data: session, isLoading: sessionLoading, error: sessionError, refetch: refetchSession } = useQuery({
    queryKey: ['recon-session', id],
    queryFn: () => reconSessionApi.getById(id),
    retry: false,
  });

  const { data: stmtLines, refetch: refetchStmt } = useQuery({
    queryKey: ['recon-stmt-lines', id],
    queryFn: () => reconSessionApi.getStatementLines(id),
    retry: false,
  });

  const { data: bookItems, refetch: refetchBook } = useQuery({
    queryKey: ['recon-book-items', id],
    queryFn: () => reconSessionApi.getBookItems(id),
    retry: false,
  });

  const { data: suggestions, refetch: refetchSuggestions } = useQuery({
    queryKey: ['recon-suggestions', id],
    queryFn: () => autoMatchApi.getSuggestions(id),
    retry: false,
  });

  const { data: rules, refetch: refetchRules } = useQuery({
    queryKey: ['recon-rules'],
    queryFn: () => autoMatchApi.listRules(),
    retry: false,
  });

  // ── Mutations ──

  const completeMutation = useMutation({
    mutationFn: () => reconSessionApi.complete(id),
    onSuccess: () => {
      setCompleteError(null);
      setCompleteSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['recon-session', id] });
    },
    onError: (err: any) => {
      // Surface the server's exact refusal message — NEVER silently retry or bypass.
      setCompleteError(err.message ?? 'Session cannot be completed.');
    },
  });

  const runAutoMatchMutation = useMutation({
    mutationFn: () => autoMatchApi.run(id),
    onSuccess: () => {
      refetchSuggestions();
      queryClient.invalidateQueries({ queryKey: ['recon-stmt-lines', id] });
      queryClient.invalidateQueries({ queryKey: ['recon-book-items', id] });
    },
  });

  const syncBookMutation = useMutation({
    mutationFn: () => reconSessionApi.syncBookItems(id),
    onSuccess: () => refetchBook(),
  });

  // 401/403
  const sessionErrAny = sessionError as any;
  if (sessionErrAny?.status === 401 || sessionErrAny?.status === 403) {
    return (
      <div className="p-6">
        <PageHeader title="Reconciliation Session" />
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700 font-semibold">Unauthorized</p>
          <p className="text-red-600 text-sm mt-1">You do not have permission to view this reconciliation session.</p>
        </div>
      </div>
    );
  }

  if (sessionLoading) return <PageLoader page="Reconciliation Session" service="recon-service" />;
  if (sessionError) return <PageError error={sessionError as Error} serviceName="recon-service" retry={refetchSession} />;

  const sess = session as any;
  const stmtArr: any[] = Array.isArray(stmtLines) ? stmtLines : [];
  const bookArr: any[] = Array.isArray(bookItems) ? bookItems : [];
  const suggestArr: any[] = Array.isArray(suggestions) ? suggestions : [];
  const rulesArr: any[] = Array.isArray(rules) ? rules : [];

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'statement', label: 'Statement Lines' },
    { key: 'book', label: 'Book Items' },
    { key: 'match', label: 'Manual Match' },
    { key: 'automatch', label: 'Auto-Match' },
    { key: 'rules', label: 'Match Rules' },
  ];

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => navigate('/accounting/bank-recon/sessions')}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="w-4 h-4" /> Sessions
        </button>
      </div>

      <PageHeader
        title={`Recon Session ${id.slice(0, 8)}…`}
        subtitle={`${sess?.entityId ?? ''} · ${sess?.bankAccountCode ?? ''} · ${fmtDate(sess?.periodStart)} – ${fmtDate(sess?.periodEnd)}`}
        badge={<Badge data-testid="recon-detail-status" variant={statusVariant(sess?.status ?? '')}>{sess?.status ?? '—'}</Badge>}
        actions={
          completeSuccess ? null : (
            <Btn
              variant="primary"
              size="md"
              icon={<Check className="w-4 h-4" />}
              loading={completeMutation.isPending}
              onClick={() => { setCompleteError(null); completeMutation.mutate(); }}
              disabled={sess?.status === 'COMPLETED'}
              data-testid="recon-complete-session"
            >
              Complete Session
            </Btn>
          )
        }
      />

      {/* Out-of-balance / complete refusal banner — server error, displayed verbatim */}
      {completeError && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 flex gap-3 items-start" role="alert">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div data-testid="recon-complete-refused">
            <p className="text-sm font-bold text-red-700">Cannot Complete Session</p>
            <p className="text-sm text-red-600 mt-0.5">{completeError}</p>
          </div>
          <button className="ml-auto text-red-400 hover:text-red-600" onClick={() => setCompleteError(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {completeSuccess && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 flex gap-3 items-center">
          <Check className="w-5 h-5 text-emerald-600" />
          <p className="text-sm font-semibold text-emerald-700" data-testid="recon-complete-success">Session completed successfully.</p>
        </div>
      )}

      {/* Session summary strip */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Beginning Balance', value: fmtMoney(sess?.statementBeginningBalance) },
          { label: 'Ending Balance', value: fmtMoney(sess?.statementEndingBalance) },
          { label: 'Cleared Balance', value: fmtMoney(sess?.clearedBalance) },
          { label: 'Difference', value: fmtMoney(sess?.difference) },
        ].map(({ label, value }) => (
          <div key={label} data-testid={`recon-summary-${label.toLowerCase().replace(/\s+/g, '-')}`} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
            <p className="text-lg font-extrabold font-mono text-slate-900 mt-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            data-testid={`recon-tab-${t.key}`}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? 'border-b-2 border-brand text-brand -mb-px'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === 'statement' && (
        <StatementLinesPanel id={id} lines={stmtArr} refetch={() => { refetchStmt(); }} />
      )}
      {activeTab === 'book' && (
        <BookItemsPanel id={id} items={bookArr} refetch={() => { refetchBook(); }} syncMutation={syncBookMutation} />
      )}
      {activeTab === 'match' && (
        <ManualMatchPanel id={id} lines={stmtArr} items={bookArr} refetch={() => { refetchStmt(); refetchBook(); }} />
      )}
      {activeTab === 'automatch' && (
        <AutoMatchPanel
          id={id}
          suggestions={suggestArr}
          refetchSuggestions={refetchSuggestions}
          runAutoMatchMutation={runAutoMatchMutation}
        />
      )}
      {activeTab === 'rules' && (
        <MatchRulesPanel rules={rulesArr} refetchRules={refetchRules} />
      )}
    </div>
  );
}

// ─── Statement Lines Panel ────────────────────────────────────────────────────

function StatementLinesPanel({ id, lines, refetch }: { id: string; lines: any[]; refetch: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [addForm, setAddForm] = useState({ lineDate: '', description: '', amount: '', externalRef: '' });
  const [addError, setAddError] = useState<string | null>(null);
  const [importCsv, setImportCsv] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: () =>
      reconSessionApi.addStatementLine(id, {
        lineDate: addForm.lineDate,
        description: addForm.description.trim(),
        amount: parseFloat(addForm.amount),
        source: 'MANUAL',
        externalRef: addForm.externalRef.trim() || null,
      }),
    onSuccess: () => {
      refetch();
      setShowAdd(false);
      setAddForm({ lineDate: '', description: '', amount: '', externalRef: '' });
    },
    onError: (err: any) => setAddError(err.message ?? 'Failed to add line'),
  });

  const importMutation = useMutation({
    mutationFn: () => {
      // Manual import helper: parse textarea CSV (lineDate,description,amount[,externalRef])
      // Real bank-feed ingestion is out of scope; this is a manual entry aid.
      const parsedLines = importCsv
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const parts = l.split(',');
          return {
            lineDate: (parts[0] ?? '').trim(),
            description: (parts[1] ?? '').trim(),
            amount: parseFloat((parts[2] ?? '0').trim()),
            externalRef: (parts[3] ?? '').trim() || null,
          };
        });
      if (parsedLines.length === 0) throw new Error('No lines parsed from CSV input');
      return reconSessionApi.importStatementLines(id, parsedLines);
    },
    onSuccess: () => {
      refetch();
      setShowImport(false);
      setImportCsv('');
    },
    onError: (err: any) => setImportError(err.message ?? 'Failed to import lines'),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" size="sm" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => setShowImport(true)} data-testid="recon-stmt-import-open">
          Import CSV
        </Btn>
        <Btn variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowAdd(true)} data-testid="recon-stmt-add-open">
          Add Line
        </Btn>
      </div>

      {showAdd && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Add Statement Line</h3>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Line Date *</label>
              <input type="date" required className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={addForm.lineDate} onChange={(e) => setAddForm({ ...addForm, lineDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Amount *</label>
              <input type="number" step="0.01" required className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm font-mono"
                data-testid="recon-stmt-add-amount"
                value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Description *</label>
              <input data-testid="recon-stmt-add-description" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} placeholder="e.g. Check #1001" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">External Ref</label>
              <input className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={addForm.externalRef} onChange={(e) => setAddForm({ ...addForm, externalRef: e.target.value })} placeholder="optional" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="sm" onClick={() => setShowAdd(false)}>Cancel</Btn>
            <Btn variant="primary" size="sm" loading={addMutation.isPending} onClick={() => addMutation.mutate()} data-testid="recon-stmt-add-save">Save</Btn>
          </div>
        </div>
      )}

      {showImport && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          {/* Manual import helper — real bank-feed ingestion is out of scope */}
          <h3 className="text-sm font-bold text-slate-800">Import Statement Lines (CSV)</h3>
          <p className="text-xs text-slate-500">Format: <code className="bg-slate-100 px-1 rounded">lineDate,description,amount[,externalRef]</code> — one line per row.</p>
          {importError && <p className="text-xs text-red-600">{importError}</p>}
          <textarea
            rows={6}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
            data-testid="recon-stmt-import-csv"
            value={importCsv}
            onChange={(e) => setImportCsv(e.target.value)}
            placeholder={'2026-07-01,Deposit,5000.00,DEP-001\n2026-07-02,Check #1001,-250.00'}
          />
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="sm" onClick={() => setShowImport(false)}>Cancel</Btn>
            <Btn variant="primary" size="sm" loading={importMutation.isPending} onClick={() => importMutation.mutate()} data-testid="recon-stmt-import-submit">Import</Btn>
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <EmptyState icon="📄" title="No statement lines" description="Add lines manually or import from CSV." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                {['Date', 'Description', 'Amount', 'Source', 'Status', 'External Ref'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id ?? i} data-testid={`recon-stmt-row-${l.id ?? i}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm">{fmtDate(l.lineDate)}</td>
                  <td className="px-4 py-3 text-sm">{l.description ?? '—'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-right">{fmtMoney(l.amount)}</td>
                  <td className="px-4 py-3 text-sm">{l.source ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge data-testid={`recon-stmt-status-${l.id ?? i}`} variant={l.matchStatus === 'MATCHED' ? 'success' : 'neutral'}>{l.matchStatus ?? 'UNMATCHED'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400 font-mono">{l.externalRef ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Book Items Panel ─────────────────────────────────────────────────────────

function BookItemsPanel({ id, items, refetch, syncMutation }: { id: string; items: any[]; refetch: () => void; syncMutation: any }) {
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ itemType: 'PAYMENT', itemDate: '', description: '', amount: '' });
  const [addError, setAddError] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: () =>
      reconSessionApi.addManualBookItem(id, {
        itemType: addForm.itemType as any,
        itemDate: addForm.itemDate,
        description: addForm.description.trim(),
        amount: parseFloat(addForm.amount),
      }),
    onSuccess: () => {
      refetch();
      setShowAdd(false);
      setAddForm({ itemType: 'PAYMENT', itemDate: '', description: '', amount: '' });
    },
    onError: (err: any) => setAddError(err.message ?? 'Failed to add book item'),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} loading={syncMutation.isPending} onClick={() => syncMutation.mutate()} data-testid="recon-book-sync">
          Sync Book Items
        </Btn>
        <Btn variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowAdd(true)} data-testid="recon-book-add-open">
          Add Manual Item
        </Btn>
      </div>

      {showAdd && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Add Manual Book Item</h3>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Item Type *</label>
              <select className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={addForm.itemType} onChange={(e) => setAddForm({ ...addForm, itemType: e.target.value })}>
                {['PAYMENT', 'DEPOSIT', 'FEE', 'NSF', 'SWEEP'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Item Date *</label>
              <input type="date" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={addForm.itemDate} onChange={(e) => setAddForm({ ...addForm, itemDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Description *</label>
              <input className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} placeholder="e.g. ACH Payment" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Amount *</label>
              <input type="number" step="0.01" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm font-mono"
                data-testid="recon-book-add-amount"
                value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} placeholder="0.00" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="sm" onClick={() => setShowAdd(false)}>Cancel</Btn>
            <Btn variant="primary" size="sm" loading={addMutation.isPending} onClick={() => addMutation.mutate()} data-testid="recon-book-add-save">Save</Btn>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon="📒" title="No book items" description="Sync from GL or add manually." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                {['Date', 'Type', 'Description', 'Amount', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id ?? i} data-testid={`recon-book-row-${item.id ?? i}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm">{fmtDate(item.itemDate)}</td>
                  <td className="px-4 py-3 text-sm">{item.itemType ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">{item.description ?? '—'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-right">{fmtMoney(item.amount)}</td>
                  <td className="px-4 py-3 text-sm">
                    <Badge variant={item.matchStatus === 'MATCHED' ? 'success' : 'neutral'}>{item.matchStatus ?? 'UNMATCHED'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Manual Match Panel ───────────────────────────────────────────────────────
// Manual match/unmatch is ALWAYS available regardless of auto-match state.

function ManualMatchPanel({ id, lines, items, refetch }: { id: string; lines: any[]; items: any[]; refetch: () => void }) {
  const [selectedStmt, setSelectedStmt] = useState('');
  const [selectedBook, setSelectedBook] = useState('');
  const [matchError, setMatchError] = useState<string | null>(null);
  const [unmatchLine, setUnmatchLine] = useState('');
  const [unmatchReason, setUnmatchReason] = useState('');
  const [unmatchError, setUnmatchError] = useState<string | null>(null);

  const unmatchedStmt = lines.filter((l) => l.matchStatus !== 'MATCHED');
  const unmatchedBook = items.filter((i) => i.matchStatus !== 'MATCHED');
  const matchedStmt = lines.filter((l) => l.matchStatus === 'MATCHED');

  const matchMutation = useMutation({
    mutationFn: () => reconSessionApi.match(id, { statementLineId: selectedStmt, bookItemId: selectedBook }),
    onSuccess: () => { refetch(); setSelectedStmt(''); setSelectedBook(''); setMatchError(null); },
    onError: (err: any) => setMatchError(err.message ?? 'Failed to match'),
  });

  const unmatchMutation = useMutation({
    mutationFn: () => reconSessionApi.unmatch(id, { statementLineId: unmatchLine, reason: unmatchReason.trim() }),
    onSuccess: () => { refetch(); setUnmatchLine(''); setUnmatchReason(''); setUnmatchError(null); },
    onError: (err: any) => setUnmatchError(err.message ?? 'Failed to unmatch'),
  });

  return (
    <div className="space-y-6">
      {/* Create match */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-800">Create Manual Match</h3>
        {matchError && <p className="text-xs text-red-600">{matchError}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Statement Line</label>
            <select data-testid="recon-match-stmt-select" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
              value={selectedStmt} onChange={(e) => setSelectedStmt(e.target.value)}>
              <option value="">— select —</option>
              {unmatchedStmt.map((l) => (
                <option key={l.id} value={l.id}>{fmtDate(l.lineDate)} · {l.description} · {fmtMoney(l.amount)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Book Item</label>
            <select data-testid="recon-match-book-select" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
              value={selectedBook} onChange={(e) => setSelectedBook(e.target.value)}>
              <option value="">— select —</option>
              {unmatchedBook.map((b) => (
                <option key={b.id} value={b.id}>{fmtDate(b.itemDate)} · {b.description} · {fmtMoney(b.amount)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <Btn
            variant="primary" size="sm"
            disabled={!selectedStmt || !selectedBook}
            loading={matchMutation.isPending}
            onClick={() => matchMutation.mutate()}
            data-testid="recon-match-confirm"
          >
            Match
          </Btn>
        </div>
      </div>

      {/* Unmatch */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-slate-800">Unmatch a Statement Line</h3>
        {unmatchError && <p className="text-xs text-red-600">{unmatchError}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Matched Statement Line</label>
            <select data-testid="recon-unmatch-line-select" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
              value={unmatchLine} onChange={(e) => setUnmatchLine(e.target.value)}>
              <option value="">— select —</option>
              {matchedStmt.map((l) => (
                <option key={l.id} value={l.id}>{fmtDate(l.lineDate)} · {l.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Reason (required)</label>
            <input data-testid="recon-unmatch-reason" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
              value={unmatchReason} onChange={(e) => setUnmatchReason(e.target.value)} placeholder="Reason for unmatching" />
          </div>
        </div>
        <div className="flex justify-end">
          <Btn
            variant="danger" size="sm"
            disabled={!unmatchLine || !unmatchReason.trim()}
            loading={unmatchMutation.isPending}
            onClick={() => unmatchMutation.mutate()}
            data-testid="recon-unmatch-confirm"
          >
            Unmatch
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Auto-Match Panel ─────────────────────────────────────────────────────────

function AutoMatchPanel({ id, suggestions, refetchSuggestions, runAutoMatchMutation }: {
  id: string; suggestions: any[]; refetchSuggestions: () => void; runAutoMatchMutation: any;
}) {
  const queryClient = useQueryClient();

  const confirmMutation = useMutation({
    mutationFn: (suggestionId: string) => autoMatchApi.confirmSuggestion(id, suggestionId),
    onSuccess: () => { refetchSuggestions(); queryClient.invalidateQueries({ queryKey: ['recon-stmt-lines', id] }); queryClient.invalidateQueries({ queryKey: ['recon-book-items', id] }); },
  });

  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const rejectMutation = useMutation({
    mutationFn: ({ suggestionId, reason }: { suggestionId: string; reason?: string }) =>
      autoMatchApi.rejectSuggestion(id, suggestionId, reason ? { reason } : undefined),
    onSuccess: () => refetchSuggestions(),
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => refetchSuggestions()}>
          Refresh Suggestions
        </Btn>
        <Btn variant="primary" size="sm" icon={<Zap className="w-3.5 h-3.5" />} loading={runAutoMatchMutation.isPending} onClick={() => runAutoMatchMutation.mutate()} data-testid="recon-run-automatch">
          Run Auto-Match
        </Btn>
      </div>

      {suggestions.length === 0 ? (
        <EmptyState icon="🤖" title="No pending suggestions" description="Run auto-match to generate suggestions." />
      ) : (
        <div className="space-y-3">
          {suggestions.map((s, i) => (
            <div key={s.id ?? i} data-testid={`recon-suggestion-row-${s.id ?? i}`} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge data-testid={`recon-suggestion-tier-${s.id ?? i}`} variant="info">{s.tier ?? s.ruleType ?? 'SUGGESTED'}</Badge>
                  {s.ruleName && <span className="text-xs text-slate-500">{s.ruleName}</span>}
                  {s.ruleId && <span className="text-xs text-slate-400 font-mono">{String(s.ruleId).slice(0, 8)}…</span>}
                </div>
                <div className="flex gap-2">
                  <Btn variant="primary" size="sm" icon={<Check className="w-3.5 h-3.5" />}
                    loading={confirmMutation.isPending}
                    onClick={() => confirmMutation.mutate(s.id)}
                    data-testid={`recon-suggestion-confirm-${s.id}`}>
                    Confirm
                  </Btn>
                  <Btn variant="danger" size="sm" icon={<X className="w-3.5 h-3.5" />}
                    loading={rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate({ suggestionId: s.id, reason: rejectReasons[s.id] })}
                    data-testid={`recon-suggestion-reject-${s.id}`}>
                    Reject
                  </Btn>
                </div>
              </div>
              {/* Render suggestion fields defensively — shape may vary */}
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                {s.statementLine && (
                  <div className="bg-slate-50 rounded p-2">
                    <p className="font-semibold text-slate-700 mb-1">Statement Line</p>
                    <p>{fmtDate(s.statementLine.lineDate)} · {s.statementLine.description ?? '—'}</p>
                    <p className="font-mono">{fmtMoney(s.statementLine.amount)}</p>
                  </div>
                )}
                {s.bookItem && (
                  <div className="bg-slate-50 rounded p-2">
                    <p className="font-semibold text-slate-700 mb-1">Book Item</p>
                    <p>{fmtDate(s.bookItem.itemDate)} · {s.bookItem.description ?? '—'}</p>
                    <p className="font-mono">{fmtMoney(s.bookItem.amount)}</p>
                  </div>
                )}
              </div>
              <div>
                <input
                  className="w-full h-7 px-2 border border-slate-200 rounded text-xs"
                  placeholder="Optional reject reason"
                  value={rejectReasons[s.id] ?? ''}
                  onChange={(e) => setRejectReasons((prev) => ({ ...prev, [s.id]: e.target.value }))}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Match Rules Panel ────────────────────────────────────────────────────────

function MatchRulesPanel({ rules, refetchRules }: { rules: any[]; refetchRules: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    entityId: '',
    bankAccountCode: '',
    ruleType: 'AMOUNT_DATE_WINDOW' as const,
    tier: 'EXACT' as const,
    configJson: '{}',
    priority: '',
  });
  const [configError, setConfigError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => {
      let config: Record<string, any>;
      try {
        config = JSON.parse(form.configJson);
      } catch {
        setConfigError('Invalid JSON in config field');
        throw new Error('Invalid JSON');
      }
      return autoMatchApi.createRule({
        entityId: form.entityId.trim() || null,
        bankAccountCode: form.bankAccountCode.trim() || null,
        ruleType: form.ruleType,
        tier: form.tier,
        config,
        priority: form.priority ? parseInt(form.priority) : undefined,
      });
    },
    onSuccess: () => {
      refetchRules();
      setShowCreate(false);
      setForm({ entityId: '', bankAccountCode: '', ruleType: 'AMOUNT_DATE_WINDOW', tier: 'EXACT', configJson: '{}', priority: '' });
      setConfigError(null);
      setCreateError(null);
    },
    onError: (err: any) => {
      if (err.message !== 'Invalid JSON') setCreateError(err.message ?? 'Failed to create rule');
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowCreate(true)} data-testid="recon-rule-create-open">
          Create Rule
        </Btn>
      </div>

      {showCreate && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Create Match Rule</h3>
          {createError && <p className="text-xs text-red-600">{createError}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Entity ID (optional)</label>
              <input className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })} placeholder="leave blank for global" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Bank Account Code (optional)</label>
              <input className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={form.bankAccountCode} onChange={(e) => setForm({ ...form, bankAccountCode: e.target.value })} placeholder="leave blank for any" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Rule Type *</label>
              <select data-testid="recon-rule-type" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={form.ruleType} onChange={(e) => setForm({ ...form, ruleType: e.target.value as any })}>
                {['AMOUNT_DATE_WINDOW', 'REFERENCE_CONTAINS', 'CHECK_NUMBER', 'BATCH_TOTAL'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tier *</label>
              <select data-testid="recon-rule-tier" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value as any })}>
                <option value="EXACT">EXACT</option>
                <option value="SUGGESTED">SUGGESTED</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Priority (optional)</label>
              <input type="number" className="w-full h-8 px-3 border border-slate-300 rounded-lg text-sm"
                value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} placeholder="e.g. 10" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Config (JSON) *</label>
              {configError && <p className="text-xs text-red-500 mb-1">{configError}</p>}
              <textarea data-testid="recon-rule-config-json" rows={3} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                value={form.configJson} onChange={(e) => { setConfigError(null); setForm({ ...form, configJson: e.target.value }); }}
                placeholder={'{"amountTolerance": 0.01, "dateDays": 2}'} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Btn>
            <Btn variant="primary" size="sm" loading={createMutation.isPending} onClick={() => createMutation.mutate()} data-testid="recon-rule-save">Save Rule</Btn>
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <EmptyState icon="⚙️" title="No match rules" description="Create a rule to enable automated matching." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                {['Type', 'Tier', 'Entity', 'Bank Account', 'Priority', 'Config'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={r.id ?? i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm">{r.ruleType ?? '—'}</td>
                  <td className="px-4 py-3 text-sm"><Badge variant={r.tier === 'EXACT' ? 'success' : 'info'}>{r.tier ?? '—'}</Badge></td>
                  <td className="px-4 py-3 text-sm text-slate-500">{r.entityId ?? 'global'}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{r.bankAccountCode ?? 'any'}</td>
                  <td className="px-4 py-3 text-sm font-mono">{r.priority ?? '—'}</td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-400 max-w-xs truncate">{JSON.stringify(r.config ?? {})}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
