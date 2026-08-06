// CE-12 / S079-S080 — Floorplan Workbench. `/accounting/vehicles/floorplan`.
// Tab-based (mirrors ScheduleOpenItems.tsx exactly): Lender/Feed Status (a
// truthful FEED_NOT_CONFIGURED state per lender, distinct from "no rows
// yet"; manual statement entry always available regardless), Staged Rows
// (immutable evidence + import audit), VIN Match (match staged rows to
// units, trigger posting), Breaks Worklist (disposition ceremony requiring
// a reason), Liability Tie-Out (the $0 tie-out inquiry, red when non-zero —
// mirrors TaxReconciliation.tsx's reconciliation-badge pattern).
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, AlertCircle, PlayCircle } from 'lucide-react';
import { floorplanApi } from '../../../api/ce12-vehicle-floorplan-client';
import { JournalDrillDrawer } from '../../../components/ce12/JournalDrillDrawer';

const fmt = (n: number | string | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return String(n);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—';

const ADAPTER_BADGE: Record<string, string> = {
  CONFIGURED: 'bg-emerald-100 text-emerald-700',
  NOT_CONFIGURED: 'bg-gray-200 text-gray-700',
};
const ROW_STATUS_BADGE: Record<string, string> = {
  STAGED: 'bg-blue-100 text-blue-700',
  MATCHED: 'bg-emerald-100 text-emerald-700',
  BREAK: 'bg-red-100 text-red-700',
  SUPERSEDED: 'bg-gray-200 text-gray-500',
};
const BREAK_STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700',
  DISPOSITIONED: 'bg-gray-100 text-gray-600',
};
const BREAK_TYPE_BADGE: Record<string, string> = {
  LENDER_HAS_WE_DONT: 'bg-red-100 text-red-700',
  WE_HAVE_LENDER_DOESNT: 'bg-purple-100 text-purple-700',
  AMOUNT_VARIANCE: 'bg-amber-100 text-amber-700',
};
const LIABILITY_STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  PARTIALLY_RELIEVED: 'bg-amber-100 text-amber-700',
  RELIEVED: 'bg-gray-200 text-gray-600',
};

function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium tracking-wide ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {(status ?? '').replace(/_/g, ' ')}
    </span>
  );
}

function ModalShell({ title, onClose, children, color = 'bg-brand' }: { title: string; onClose: () => void; children: React.ReactNode; color?: string }) {
  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded shadow-xl max-h-[90vh] overflow-auto">
        <div className={`flex items-center justify-between px-4 py-2 ${color} text-white rounded-t sticky top-0`}>
          <span className="text-sm font-semibold">{title}</span>
          <button onClick={onClose} data-testid="modal-close-button">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const FIELD = 'h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 focus:outline-none focus:ring-1 focus:ring-brand';

// ── Lender / Feed Status tab ────────────────────────────────────────────
function UpsertLenderModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [lenderCode, setLenderCode] = useState('');
  const [lenderName, setLenderName] = useState('');
  const [adapterStatus, setAdapterStatus] = useState<'CONFIGURED' | 'NOT_CONFIGURED'>('NOT_CONFIGURED');
  const [adapterType, setAdapterType] = useState<'FIXTURE_FEED' | 'NOT_CONFIGURED'>('NOT_CONFIGURED');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => floorplanApi.upsertLender(lenderCode, { lenderName, adapterStatus, adapterType }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to save lender profile.'),
  });

  return (
    <ModalShell title="Add / Edit Lender Profile" onClose={onClose}>
      <div className="p-4 space-y-3">
        <div><label className="text-xs font-medium text-gray-600">Lender Code</label>
          <input data-testid="lender-code-input" className={FIELD} value={lenderCode} onChange={(e) => setLenderCode(e.target.value)} /></div>
        <div><label className="text-xs font-medium text-gray-600">Lender Name</label>
          <input data-testid="lender-name-input" className={FIELD} value={lenderName} onChange={(e) => setLenderName(e.target.value)} /></div>
        <div><label className="text-xs font-medium text-gray-600">Adapter Status</label>
          <select data-testid="lender-adapter-status-select" className={FIELD} value={adapterStatus} onChange={(e) => { const v = e.target.value as any; setAdapterStatus(v); if (v === 'NOT_CONFIGURED') setAdapterType('NOT_CONFIGURED'); }}>
            <option value="NOT_CONFIGURED">NOT_CONFIGURED</option><option value="CONFIGURED">CONFIGURED</option>
          </select></div>
        {adapterStatus === 'CONFIGURED' && (
          <div><label className="text-xs font-medium text-gray-600">Adapter Type</label>
            <select data-testid="lender-adapter-type-select" className={FIELD} value={adapterType} onChange={(e) => setAdapterType(e.target.value as any)}>
              <option value="FIXTURE_FEED">FIXTURE_FEED (deterministic fixture — no live vendor)</option>
            </select></div>
        )}
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="lender-save-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!lenderCode || !lenderName || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Saving…' : 'Save Lender'}
        </button>
      </div>
    </ModalShell>
  );
}

// Row-array editor shared by manual/feed import modals.
function RowsEditor({ rows, setRows }: { rows: any[]; setRows: (r: any[]) => void }) {
  function update(i: number, field: string, value: string) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  return (
    <div className="space-y-2 border border-gray-200 rounded p-2 max-h-64 overflow-auto">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-6 gap-1 items-end border-b border-gray-100 pb-1">
          <div><label className="text-[10px] text-gray-500">Type</label>
            <select data-testid={`import-row-type-${i}`} className="h-7 w-full border border-gray-300 rounded px-1 text-[11px]" value={r.rowType} onChange={(e) => update(i, 'rowType', e.target.value)}>
              <option value="ADVANCE">ADVANCE</option><option value="PAYOFF">PAYOFF</option>
            </select></div>
          <div><label className="text-[10px] text-gray-500">VIN</label>
            <input data-testid={`import-row-vin-${i}`} className="h-7 w-full border border-gray-300 rounded px-1 text-[11px] font-mono" value={r.vin} onChange={(e) => update(i, 'vin', e.target.value)} /></div>
          <div><label className="text-[10px] text-gray-500">Stock#</label>
            <input data-testid={`import-row-stocknumber-${i}`} className="h-7 w-full border border-gray-300 rounded px-1 text-[11px] font-mono" value={r.stockNumber} onChange={(e) => update(i, 'stockNumber', e.target.value)} /></div>
          <div><label className="text-[10px] text-gray-500">Amount</label>
            <input data-testid={`import-row-amount-${i}`} className="h-7 w-full border border-gray-300 rounded px-1 text-[11px] font-mono" value={r.amount} onChange={(e) => update(i, 'amount', e.target.value)} /></div>
          <div><label className="text-[10px] text-gray-500">Statement Date</label>
            <input data-testid={`import-row-date-${i}`} type="date" className="h-7 w-full border border-gray-300 rounded px-1 text-[11px]" value={r.statementDate} onChange={(e) => update(i, 'statementDate', e.target.value)} /></div>
          <div><label className="text-[10px] text-gray-500">Reference#</label>
            <input data-testid={`import-row-reference-${i}`} className="h-7 w-full border border-gray-300 rounded px-1 text-[11px] font-mono" value={r.referenceNumber} onChange={(e) => update(i, 'referenceNumber', e.target.value)} /></div>
        </div>
      ))}
      <button className="text-xs text-brand hover:underline" onClick={() => setRows([...rows, { rowType: 'ADVANCE', vin: '', stockNumber: '', amount: '', statementDate: '', referenceNumber: '' }])}>+ Add row</button>
      {rows.length > 1 && <button className="text-xs text-gray-500 hover:underline ml-3" onClick={() => setRows(rows.slice(0, -1))}>Remove last</button>}
    </div>
  );
}

function ManualImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [lenderCode, setLenderCode] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<any[]>([{ rowType: 'ADVANCE', vin: '', stockNumber: '', amount: '', statementDate: '', referenceNumber: '' }]);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => floorplanApi.importManualBatch(lenderCode, { rows: rows.filter((r) => r.amount && (r.vin || r.stockNumber)), note: note || undefined }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to import manual statement batch.'),
  });

  const canSubmit = lenderCode && rows.some((r) => r.amount && (r.vin || r.stockNumber) && r.statementDate);

  return (
    <ModalShell title="Manual Statement Entry" onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">Always usable regardless of a lender's adapter status — the S079 manual path.</div>
        <div><label className="text-xs font-medium text-gray-600">Lender Code</label>
          <input data-testid="manual-import-lendercode-input" className={FIELD} value={lenderCode} onChange={(e) => setLenderCode(e.target.value)} /></div>
        <RowsEditor rows={rows} setRows={setRows} />
        <div><label className="text-xs font-medium text-gray-600">Note (optional)</label>
          <input data-testid="manual-import-note-input" className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="manual-import-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Importing…' : 'Import Manual Batch'}
        </button>
      </div>
    </ModalShell>
  );
}

function FeedImportModal({ lenderCode, onClose, onDone }: { lenderCode: string; onClose: () => void; onDone: () => void }) {
  const [fixtureLabel, setFixtureLabel] = useState('');
  const [rows, setRows] = useState<any[]>([{ rowType: 'ADVANCE', vin: '', stockNumber: '', amount: '', statementDate: '', referenceNumber: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => floorplanApi.importFeedBatch(lenderCode, { rows: rows.filter((r) => r.amount && (r.vin || r.stockNumber)), fixtureLabel }),
    onSuccess: (result: any) => {
      // FeedNotConfiguredError is surfaced as HTTP 200 with an error field
      // (see floorplan-service/src/http/routes.ts's handleError) — truthful
      // FEED_NOT_CONFIGURED must be shown distinctly, not treated as success.
      if (result?.error === 'FEED_NOT_CONFIGURED') { setNotConfigured(result.message); return; }
      onDone();
    },
    onError: (err: any) => setError(err?.message ?? 'Failed to import feed batch.'),
  });

  const canSubmit = fixtureLabel && rows.some((r) => r.amount && (r.vin || r.stockNumber) && r.statementDate);

  return (
    <ModalShell title={`Feed Import — ${lenderCode}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">Requires the lender's adapter to be CONFIGURED. fixtureLabel makes clear this is a deterministic fixture, never live vendor data.</div>
        {notConfigured && (
          <div data-testid="feed-not-configured-banner" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 font-medium">
            FEED_NOT_CONFIGURED — {notConfigured} Use Manual Statement Entry instead.
          </div>
        )}
        <div><label className="text-xs font-medium text-gray-600">Fixture Label (required)</label>
          <input data-testid="feed-import-fixturelabel-input" className={FIELD} value={fixtureLabel} onChange={(e) => setFixtureLabel(e.target.value)} /></div>
        <RowsEditor rows={rows} setRows={setRows} />
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="feed-import-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Importing…' : 'Import Feed Batch'}
        </button>
      </div>
    </ModalShell>
  );
}

function LenderFeedStatusTab() {
  const [showUpsert, setShowUpsert] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [feedTarget, setFeedTarget] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-lenders'],
    queryFn: () => floorplanApi.listLenders(),
  });

  const { data: batches } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-import-batches'],
    queryFn: () => floorplanApi.listImportBatches(),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ce12-lenders'] });
    qc.invalidateQueries({ queryKey: ['ce12-import-batches'] });
    refetch();
  }

  const lenders = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <button data-testid="lender-add-button" className="h-8 px-3 border border-gray-300 text-xs rounded hover:bg-gray-100 font-medium" onClick={() => setShowUpsert(true)}>+ Add / Edit Lender</button>
        <button data-testid="manual-statement-entry-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover font-medium ml-auto" onClick={() => setShowManual(true)}>
          Manual Statement Entry
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'You do not have permission to view lender feed status.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && lenders.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="lenders-empty-state">
            No lender profiles registered yet — this is distinct from a lender being NOT_CONFIGURED. Manual statement entry is still available above.
          </div>
        )}
        {!isLoading && !error && lenders.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Lender Code</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Name</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Adapter Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Adapter Type</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lenders.map((l: any) => (
                <tr key={l.id} data-testid={`lender-row-${l.lenderCode}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{l.lenderCode}</td>
                  <td className="px-3">{l.lenderName}</td>
                  <td className="px-3"><StatusBadge status={l.adapterStatus} map={ADAPTER_BADGE} /></td>
                  <td className="px-3">{l.adapterType}</td>
                  <td className="px-3">
                    <button data-testid={`lender-feed-import-button-${l.lenderCode}`} className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100" onClick={() => setFeedTarget(l.lenderCode)}>Feed Import</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div>
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Import Audit — Batches</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Lender</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Source</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Rows</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Fixture Label</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Imported By</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Imported At</th>
              </tr>
            </thead>
            <tbody>
              {(batches?.items ?? []).length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-gray-400">No import batches yet.</td></tr>
              )}
              {(batches?.items ?? []).map((b: any) => (
                <tr key={b.id} data-testid={`import-batch-row-${b.id}`} className="h-8 border-b border-gray-100">
                  <td className="px-3 font-mono">{b.lenderCode}</td>
                  <td className="px-3">{b.sourceType}</td>
                  <td className="px-3 text-right font-mono">{b.rowCount}</td>
                  <td className="px-3">{b.fixtureLabel ?? '—'}</td>
                  <td className="px-3">{b.importedBy}</td>
                  <td className="px-3">{fmtDate(b.importedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showUpsert && <UpsertLenderModal onClose={() => setShowUpsert(false)} onDone={() => { setShowUpsert(false); refresh(); }} />}
      {showManual && <ManualImportModal onClose={() => setShowManual(false)} onDone={() => { setShowManual(false); refresh(); }} />}
      {feedTarget && <FeedImportModal lenderCode={feedTarget} onClose={() => setFeedTarget(null)} onDone={() => { setFeedTarget(null); refresh(); }} />}
    </div>
  );
}

// ── Staged Rows tab ──────────────────────────────────────────────────────
function SupersedeModal({ row, onClose, onDone }: { row: any; onClose: () => void; onDone: () => void }) {
  const [rowType, setRowType] = useState(row.rowType);
  const [vin, setVin] = useState(row.vin ?? '');
  const [stockNumber, setStockNumber] = useState(row.stockNumber ?? '');
  const [amount, setAmount] = useState(row.amount?.toString() ?? '');
  const [statementDate, setStatementDate] = useState(row.statementDate ? row.statementDate.slice(0, 10) : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => floorplanApi.supersedeStagedRow(row.id, { replacement: { rowType, vin: vin || undefined, stockNumber: stockNumber || undefined, amount, statementDate, referenceNumber: row.referenceNumber ?? undefined }, note: note || undefined }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to supersede row.'),
  });

  return (
    <ModalShell title="Supersede Staged Row (correction)" onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">Staged rows are immutable — this marks row {row.id.slice(0, 8)}… SUPERSEDED and creates a new row with corrected values, keeping both in the evidence trail.</div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs font-medium text-gray-600">Type</label>
            <select data-testid="supersede-rowtype-select" className={FIELD} value={rowType} onChange={(e) => setRowType(e.target.value)}>
              <option value="ADVANCE">ADVANCE</option><option value="PAYOFF">PAYOFF</option>
            </select></div>
          <div><label className="text-xs font-medium text-gray-600">Amount</label>
            <input data-testid="supersede-amount-input" className={FIELD} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="text-xs font-medium text-gray-600">VIN</label>
            <input data-testid="supersede-vin-input" className={FIELD} value={vin} onChange={(e) => setVin(e.target.value)} /></div>
          <div><label className="text-xs font-medium text-gray-600">Stock#</label>
            <input data-testid="supersede-stocknumber-input" className={FIELD} value={stockNumber} onChange={(e) => setStockNumber(e.target.value)} /></div>
          <div><label className="text-xs font-medium text-gray-600">Statement Date</label>
            <input data-testid="supersede-statementdate-input" type="date" className={FIELD} value={statementDate} onChange={(e) => setStatementDate(e.target.value)} /></div>
        </div>
        <div><label className="text-xs font-medium text-gray-600">Note (required — correction reason)</label>
          <input data-testid="supersede-note-input" className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="supersede-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!note || !amount || !statementDate || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Superseding…' : 'Supersede Row'}
        </button>
      </div>
    </ModalShell>
  );
}

function StagedRowsTab() {
  const [lenderCode, setLenderCode] = useState('');
  const [status, setStatus] = useState('');
  const [supersedeTarget, setSupersedeTarget] = useState<any | null>(null);
  const qc = useQueryClient();

  const params = new URLSearchParams();
  if (lenderCode) params.set('lenderCode', lenderCode);
  if (status) params.set('status', status);

  const { data, isLoading, error, refetch } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-staged-rows', lenderCode, status],
    queryFn: () => floorplanApi.listStagedRows(params.toString()),
  });

  const rows = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <input data-testid="staged-rows-lender-filter" className="h-8 w-28 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={lenderCode} onChange={(e) => setLenderCode(e.target.value)} placeholder="Lender code" />
        <select data-testid="staged-rows-status-filter" className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="STAGED">STAGED</option><option value="MATCHED">MATCHED</option><option value="BREAK">BREAK</option><option value="SUPERSEDED">SUPERSEDED</option>
        </select>
        <button data-testid="staged-rows-search-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium" onClick={() => refetch()}>
          <Search size={13} /> Search
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'You do not have permission to view staged rows.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="staged-rows-empty-state">No staged rows found.</div>
        )}
        {!isLoading && !error && rows.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Lender</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Type</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">VIN / Stock#</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Amount</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Statement Date</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Source</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} data-testid={`staged-row-${r.id}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{r.lenderCode}</td>
                  <td className="px-3">{r.rowType}</td>
                  <td className="px-3 font-mono">{r.vin ?? r.stockNumber}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(r.amount)}</td>
                  <td className="px-3">{fmtDate(r.statementDate)}</td>
                  <td className="px-3">{r.sourceType}</td>
                  <td className="px-3"><StatusBadge status={r.status} map={ROW_STATUS_BADGE} /></td>
                  <td className="px-3">
                    {(r.status === 'STAGED' || r.status === 'BREAK') && (
                      <button data-testid={`supersede-button-${r.id}`} className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100" onClick={() => setSupersedeTarget(r)}>Supersede</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {supersedeTarget && (
        <SupersedeModal row={supersedeTarget} onClose={() => setSupersedeTarget(null)} onDone={() => { setSupersedeTarget(null); qc.invalidateQueries({ queryKey: ['ce12-staged-rows'] }); refetch(); }} />
      )}
    </div>
  );
}

// ── VIN Match tab ────────────────────────────────────────────────────────
function VinMatchTab() {
  const [lenderCode, setLenderCode] = useState('');
  const [lastResult, setLastResult] = useState<Record<string, any>>({});
  const [drillJournal, setDrillJournal] = useState<string | null>(null);
  const qc = useQueryClient();

  const params = new URLSearchParams();
  params.set('status', 'STAGED');
  if (lenderCode) params.set('lenderCode', lenderCode);

  const { data, isLoading, error, refetch } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-match-eligible', lenderCode],
    queryFn: () => floorplanApi.listStagedRows(params.toString()),
  });

  const { data: matches } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-matches'],
    queryFn: () => floorplanApi.listMatches(),
  });

  const matchMutation = useMutation({
    mutationFn: (id: string) => floorplanApi.matchStagedRow(id),
    onSuccess: (result: any, id: string) => {
      setLastResult((prev) => ({ ...prev, [id]: result }));
      qc.invalidateQueries({ queryKey: ['ce12-match-eligible'] });
      qc.invalidateQueries({ queryKey: ['ce12-matches'] });
      qc.invalidateQueries({ queryKey: ['ce12-staged-rows'] });
      refetch();
    },
  });

  const rows = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <input data-testid="match-lender-filter" className="h-8 w-28 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={lenderCode} onChange={(e) => setLenderCode(e.target.value)} placeholder="Lender code" />
        <button data-testid="match-search-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium" onClick={() => refetch()}>
          <Search size={13} /> Search
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'You do not have permission to execute matches.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="match-empty-state">No STAGED rows eligible for matching.</div>
        )}
        {!isLoading && !error && rows.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Lender</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Type</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">VIN / Stock#</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Amount</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Result</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} data-testid={`match-candidate-row-${r.id}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{r.lenderCode}</td>
                  <td className="px-3">{r.rowType}</td>
                  <td className="px-3 font-mono">{r.vin ?? r.stockNumber}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(r.amount)}</td>
                  <td className="px-3" data-testid={`match-result-${r.id}`}>
                    {lastResult[r.id] ? `${lastResult[r.id].outcome}${lastResult[r.id].status ? ` (${lastResult[r.id].status})` : ''}` : '—'}
                  </td>
                  <td className="px-3">
                    <button data-testid={`match-button-${r.id}`} className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                      disabled={matchMutation.isPending} onClick={() => matchMutation.mutate(r.id)}>
                      Match
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div>
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Recent Matches</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Match Type</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Journal#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Matched By</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Matched At</th>
              </tr>
            </thead>
            <tbody>
              {(matches?.items ?? []).length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-gray-400">No matches recorded yet.</td></tr>
              )}
              {(matches?.items ?? []).slice(0, 50).map((m: any) => (
                <tr key={m.id} data-testid={`match-row-${m.id}`} className="h-8 border-b border-gray-100">
                  <td className="px-3">{m.matchType}</td>
                  <td className="px-3"><StatusBadge status={m.status} map={{ POSTED: 'bg-emerald-100 text-emerald-700', REJECTED: 'bg-red-100 text-red-700' }} /></td>
                  <td className="px-3 font-mono">
                    {m.journalNumber ? (
                      <button type="button" className="text-brand hover:underline" data-testid={`journal-drill-link-${m.id}`} onClick={() => setDrillJournal(m.journalNumber)}>{m.journalNumber}</button>
                    ) : '—'}
                  </td>
                  <td className="px-3">{m.matchedBy}</td>
                  <td className="px-3">{fmtDate(m.matchedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {drillJournal && <JournalDrillDrawer journalNumber={drillJournal} onClose={() => setDrillJournal(null)} />}
    </div>
  );
}

// ── Breaks Worklist tab ──────────────────────────────────────────────────
function DispositionModal({ brk, onClose, onDone }: { brk: any; onClose: () => void; onDone: () => void }) {
  const [action, setAction] = useState<'ACCEPT_LENDER_FIGURE' | 'ACCEPT_OUR_FIGURE' | 'WRITE_OFF_VARIANCE' | 'ESCALATE' | 'NO_ACTION_DOCUMENTED'>('NO_ACTION_DOCUMENTED');
  const [reason, setReason] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => floorplanApi.dispositionBreak(brk.id, { action, reason, idempotencyKey: crypto.randomUUID(), deptCode: action === 'WRITE_OFF_VARIANCE' ? deptCode : undefined }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to disposition break.'),
  });

  const canSubmit = reason && (action !== 'WRITE_OFF_VARIANCE' || deptCode);

  return (
    <ModalShell title={`Disposition Break — ${brk.breakType}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-500">
          Lender amount <span className="font-mono">{fmt(brk.lenderAmount)}</span>, our amount <span className="font-mono">{fmt(brk.ourAmount)}</span>
          {brk.varianceAmount != null && <> — variance <span className="font-mono font-semibold text-red-600">{fmt(brk.varianceAmount)}</span></>}
        </div>
        <div><label className="text-xs font-medium text-gray-600">Action</label>
          <select data-testid="disposition-action-select" className={FIELD} value={action} onChange={(e) => setAction(e.target.value as any)}>
            <option value="ACCEPT_LENDER_FIGURE">ACCEPT_LENDER_FIGURE</option>
            <option value="ACCEPT_OUR_FIGURE">ACCEPT_OUR_FIGURE</option>
            <option value="WRITE_OFF_VARIANCE">WRITE_OFF_VARIANCE (posts a journal)</option>
            <option value="ESCALATE">ESCALATE</option>
            <option value="NO_ACTION_DOCUMENTED">NO_ACTION_DOCUMENTED</option>
          </select></div>
        {action === 'WRITE_OFF_VARIANCE' && (
          <div><label className="text-xs font-medium text-gray-600">Dept Code (required for write-off)</label>
            <input data-testid="disposition-deptcode-input" className={FIELD} value={deptCode} onChange={(e) => setDeptCode(e.target.value)} /></div>
        )}
        <div><label className="text-xs font-medium text-gray-600">Reason (required)</label>
          <input data-testid="disposition-reason-input" className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="disposition-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Dispositioning…' : 'Submit Disposition'}
        </button>
      </div>
    </ModalShell>
  );
}

function BreaksWorklistTab() {
  const [status, setStatus] = useState('OPEN');
  const [breakType, setBreakType] = useState('');
  const [scanLenderCode, setScanLenderCode] = useState('');
  const [dispositionTarget, setDispositionTarget] = useState<any | null>(null);
  const qc = useQueryClient();

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (breakType) params.set('breakType', breakType);

  const { data, isLoading, error, refetch } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-breaks', status, breakType],
    queryFn: () => floorplanApi.listBreaks(params.toString()),
  });

  const scanMutation = useMutation({
    mutationFn: () => floorplanApi.scanForWeHaveLenderDoesntBreaks(scanLenderCode),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ce12-breaks'] }); refetch(); },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ce12-breaks'] });
    refetch();
  }

  const rows = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <select data-testid="breaks-status-filter" className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="OPEN">OPEN</option><option value="DISPOSITIONED">DISPOSITIONED</option><option value="">All</option>
        </select>
        <select data-testid="breaks-type-filter" className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" value={breakType} onChange={(e) => setBreakType(e.target.value)}>
          <option value="">All types</option>
          <option value="LENDER_HAS_WE_DONT">LENDER_HAS_WE_DONT</option>
          <option value="WE_HAVE_LENDER_DOESNT">WE_HAVE_LENDER_DOESNT</option>
          <option value="AMOUNT_VARIANCE">AMOUNT_VARIANCE</option>
        </select>
        <button data-testid="breaks-search-button" className="h-8 px-3 border border-gray-300 text-xs rounded hover:bg-gray-100 flex items-center gap-1.5 font-medium" onClick={() => refetch()}>
          <Search size={13} /> Search
        </button>
        <div className="flex items-center gap-1 ml-auto">
          <input data-testid="scan-lender-input" className="h-8 w-28 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={scanLenderCode} onChange={(e) => setScanLenderCode(e.target.value)} placeholder="Lender code" />
          <button data-testid="scan-we-have-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium disabled:opacity-50"
            disabled={!scanLenderCode || scanMutation.isPending} onClick={() => scanMutation.mutate()}>
            <PlayCircle size={13} /> {scanMutation.isPending ? 'Scanning…' : 'Scan we-have/lender-doesn\'t'}
          </button>
        </div>
      </div>
      {scanMutation.isSuccess && (
        <div data-testid="scan-result-banner" className="px-4 py-2 text-xs bg-emerald-50 text-emerald-700 border-b border-emerald-100">
          Created {(scanMutation.data as any)?.created ?? 0} new WE_HAVE_LENDER_DOESNT break(s).
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'You do not have permission to view breaks.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="breaks-empty-state">No breaks found.</div>
        )}
        {!isLoading && !error && rows.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Type</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">VIN / Stock#</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Lender Amt</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Our Amt</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Variance</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b: any) => (
                <tr key={b.id} data-testid={`break-row-${b.id}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3"><StatusBadge status={b.breakType} map={BREAK_TYPE_BADGE} /></td>
                  <td className="px-3 font-mono">{b.vin ?? b.stockNumber}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(b.lenderAmount)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(b.ourAmount)}</td>
                  <td className={`px-3 text-right font-mono tabular-nums ${b.varianceAmount ? 'text-red-600 font-semibold' : ''}`}>{fmt(b.varianceAmount)}</td>
                  <td className="px-3"><StatusBadge status={b.status} map={BREAK_STATUS_BADGE} /></td>
                  <td className="px-3">
                    {b.status === 'OPEN' && (
                      <button data-testid={`disposition-button-${b.id}`} className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100" onClick={() => setDispositionTarget(b)}>Disposition</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dispositionTarget && <DispositionModal brk={dispositionTarget} onClose={() => setDispositionTarget(null)} onDone={() => { setDispositionTarget(null); refresh(); }} />}
    </div>
  );
}

// ── Liability Tie-Out tab ────────────────────────────────────────────────
function LiabilityTieOutTab() {
  const [lenderCode, setLenderCode] = useState('');
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const data = await floorplanApi.getTieOut(lenderCode || undefined);
      setResult(data);
    } catch (err: any) {
      if (err.status === 403) setError('You do not have permission to view the floorplan liability tie-out.');
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <input data-testid="tieout-lender-filter" className="h-8 w-28 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={lenderCode} onChange={(e) => setLenderCode(e.target.value)} placeholder="Lender code (blank=all)" />
        <button data-testid="tieout-run-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium disabled:opacity-50" disabled={busy} onClick={run}>
          <PlayCircle size={13} /> {busy ? 'Running…' : 'Run Tie-Out'}
        </button>
        {result && (
          <span data-testid="tieout-reconciliation-badge" className={`ml-auto text-[11px] px-2 py-1 rounded font-medium ${result.tied ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {result.tied ? `Tied — $0 variance` : `TIE MISMATCH — variance ${fmt(result.variance)}`}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4">
        {error && <div className="flex items-center gap-2 p-4 text-red-700 text-sm"><AlertCircle size={16} /> {error}</div>}
        {!error && !result && !busy && <div className="text-center py-16 text-gray-400 text-sm" data-testid="tieout-initial-state">Run the tie-out to compare Σ open liability items vs Σ posted applications.</div>}
        {busy && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {result && (
          <>
            <div className="flex gap-3 mb-4">
              <div className="flex-1 border border-gray-200 rounded p-3 bg-white">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Σ Open Liability Items</div>
                <div className="font-mono text-sm font-semibold tabular-nums">{fmt(result.sumOfOpenLiabilityItems)}</div>
                <div className="text-[10px] text-gray-400">{result.itemCount} item(s)</div>
              </div>
              <div className="flex-1 border border-gray-200 rounded p-3 bg-white">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Σ Posted Applications</div>
                <div className="font-mono text-sm font-semibold tabular-nums">{fmt(result.sumOfPostedApplications)}</div>
                <div className="text-[10px] text-gray-400">{result.applicationCount} application(s)</div>
              </div>
              <div className={`flex-1 border rounded p-3 ${result.tied ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Variance</div>
                <div className={`font-mono text-sm font-semibold tabular-nums ${!result.tied ? 'text-red-700' : ''}`}>{fmt(result.variance)}</div>
              </div>
            </div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Apply#</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">VIN / Stock#</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                  <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {(result.items ?? []).length === 0 && (
                  <tr><td colSpan={4} className="text-center py-6 text-gray-400">No open liability items.</td></tr>
                )}
                {(result.items ?? []).map((i: any) => (
                  <tr key={i.id} data-testid={`liability-item-row-${i.applyNumber}`} className="h-8 border-b border-gray-100">
                    <td className="px-3 font-mono">{i.applyNumber}</td>
                    <td className="px-3 font-mono">{i.vin ?? i.stockNumber}</td>
                    <td className="px-3"><StatusBadge status={i.status} map={LIABILITY_STATUS_BADGE} /></td>
                    <td className="px-3 text-right font-mono tabular-nums">{fmt(i.remainingBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

export default function FloorplanWorkbench() {
  const [tab, setTab] = useState<'lenders' | 'staged' | 'match' | 'breaks' | 'tieout'>('lenders');

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">
      <div className="bg-white border-b border-gray-200 px-4 pt-2">
        <div className="flex items-center gap-4 mb-2">
          <h1 className="text-sm font-semibold text-gray-900">Floorplan Workbench</h1>
        </div>
        <div className="flex gap-4">
          <button data-testid="lenders-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'lenders' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('lenders')}>Lender / Feed Status</button>
          <button data-testid="staged-rows-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'staged' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('staged')}>Staged Rows</button>
          <button data-testid="vin-match-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'match' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('match')}>VIN Match</button>
          <button data-testid="breaks-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'breaks' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('breaks')}>Breaks Worklist</button>
          <button data-testid="tieout-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'tieout' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('tieout')}>Liability Tie-Out</button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'lenders' && <LenderFeedStatusTab />}
        {tab === 'staged' && <StagedRowsTab />}
        {tab === 'match' && <VinMatchTab />}
        {tab === 'breaks' && <BreaksWorklistTab />}
        {tab === 'tieout' && <LiabilityTieOutTab />}
      </div>
    </div>
  );
}
