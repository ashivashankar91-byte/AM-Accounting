// CE-12 / S082 — Floorplan Interest & Curtailments. `/accounting/vehicles/interest`.
// Statement entry form (interest figure ENTERED from the lender statement —
// labeled clearly, never implying this app calculated it), allocation
// preview (server-computed split, shown before posting — never computed
// client-side), curtailment schedule display + curtailment payment ceremony
// (posts principal relief against a specific unit's floorplan item).
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

const STATEMENT_STATUS_BADGE: Record<string, string> = {
  ENTERED: 'bg-blue-100 text-blue-700',
  ALLOCATED: 'bg-amber-100 text-amber-700',
  POSTED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  REVERSED: 'bg-gray-200 text-gray-700',
};
const PAYMENT_STATUS_BADGE: Record<string, string> = {
  POSTED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  POSTING_FAILED: 'bg-red-100 text-red-700',
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

// ── Statement entry ceremony ────────────────────────────────────────────
function StatementEntryModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [lenderCode, setLenderCode] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [totalInterestAmount, setTotalInterestAmount] = useState('');
  const [allocationBasis, setAllocationBasis] = useState<'' | 'PER_UNIT_EQUAL' | 'PER_UNIT_BALANCE_WEIGHTED'>('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      floorplanApi.enterInterestStatement({
        lenderCode, statementDate, totalInterestAmount,
        allocationBasis: allocationBasis || undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to enter interest statement.'),
  });

  return (
    <ModalShell title="Enter Lender Interest Statement" onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          The interest figure below is <strong>entered from the lender statement</strong> — this application never calculates or estimates interest.
        </div>
        <div><label className="text-xs font-medium text-gray-600">Lender Code</label>
          <input data-testid="interest-statement-lender-input" className={FIELD} value={lenderCode} onChange={(e) => setLenderCode(e.target.value)} /></div>
        <div><label className="text-xs font-medium text-gray-600">Statement Date</label>
          <input data-testid="interest-statement-date-input" type="date" className={FIELD} value={statementDate} onChange={(e) => setStatementDate(e.target.value)} /></div>
        <div><label className="text-xs font-medium text-gray-600">Total Interest Amount (from statement)</label>
          <input data-testid="interest-statement-amount-input" className={FIELD} value={totalInterestAmount} onChange={(e) => setTotalInterestAmount(e.target.value)} placeholder="0.00" /></div>
        <div><label className="text-xs font-medium text-gray-600">Allocation Basis (optional — defaults to tenant config)</label>
          <select data-testid="interest-statement-basis-select" className={FIELD} value={allocationBasis} onChange={(e) => setAllocationBasis(e.target.value as any)}>
            <option value="">(use tenant default)</option>
            <option value="PER_UNIT_EQUAL">PER_UNIT_EQUAL</option>
            <option value="PER_UNIT_BALANCE_WEIGHTED">PER_UNIT_BALANCE_WEIGHTED</option>
          </select></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="interest-statement-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!lenderCode || !statementDate || !totalInterestAmount || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Saving…' : 'Enter Statement'}
        </button>
      </div>
    </ModalShell>
  );
}

function ReverseAccrualModal({ statement, onClose, onDone }: { statement: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => floorplanApi.reverseInterestAccrual(statement.id, reason),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to reverse accrual.'),
  });
  return (
    <ModalShell title={`Reverse Interest Accrual — ${statement.lenderCode}`} onClose={onClose} color="bg-red-600">
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">S218 symmetric reversal of journal <span className="font-mono">{statement.journalNumber}</span>.</div>
        <div><label className="text-xs font-medium text-gray-600">Reason (required)</label>
          <input data-testid="reverse-accrual-reason-input" className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="reverse-accrual-submit-button" className="h-8 px-4 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          disabled={!reason || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Reversing…' : 'Reverse Accrual'}
        </button>
      </div>
    </ModalShell>
  );
}

function StatementDetail({ statementId, onClose }: { statementId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ['ce12-interest-statement', statementId],
    queryFn: () => floorplanApi.getInterestStatement(statementId),
  });

  if (isLoading) return <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-brand" /></div>;
  if (error) return <div className="p-4 text-sm text-red-700"><AlertCircle size={16} className="inline mr-1" /> {(error as Error).message}</div>;
  if (!data) return null;

  const allocations = data.allocations ?? [];
  const allocSum = allocations.reduce((s: number, a: any) => s + Number(a.allocatedAmount), 0);

  return (
    <div className="border border-gray-200 rounded bg-white mt-3" data-testid={`interest-statement-detail-${statementId}`}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
        <div className="text-sm font-semibold">Statement {data.lenderCode} — {fmtDate(data.statementDate)}</div>
        <button className="text-xs text-gray-500 hover:underline" onClick={onClose} data-testid="statement-detail-close-button">Close</button>
      </div>
      <div className="p-4 space-y-2">
        <div className="text-xs text-gray-600">
          Statement total (entered): <span className="font-mono font-semibold">{fmt(data.totalInterestAmount)}</span> — basis {data.allocationBasis}
        </div>
        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Allocation Preview (server-computed)</div>
        {allocations.length === 0 && <div className="text-xs text-gray-400 py-2" data-testid="allocation-empty-state">Not yet allocated.</div>}
        {allocations.length > 0 && (
          <>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-2 py-1 font-medium">VIN / Stock#</th>
                  <th className="text-left px-2 py-1 font-medium">Dept</th>
                  <th className="text-right px-2 py-1 font-medium">bp</th>
                  <th className="text-right px-2 py-1 font-medium">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a: any) => (
                  <tr key={a.id} data-testid={`allocation-row-${a.id}`} className="border-b border-gray-100">
                    <td className="px-2 py-1 font-mono">{a.vin ?? a.stockNumber}</td>
                    <td className="px-2 py-1">{a.deptCode}</td>
                    <td className="px-2 py-1 text-right font-mono">{a.bp}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(a.allocatedAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="px-2 py-1" colSpan={3}>Σ allocated (must equal statement total exactly)</td>
                  <td className="px-2 py-1 text-right font-mono" data-testid="allocation-sum">{fmt(allocSum)}</td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function InterestStatementsTab() {
  const [lenderCode, setLenderCode] = useState('');
  const [status, setStatus] = useState('');
  const [showEntry, setShowEntry] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<any | null>(null);
  const [drillJournal, setDrillJournal] = useState<string | null>(null);
  const qc = useQueryClient();

  const params = new URLSearchParams();
  if (lenderCode) params.set('lenderCode', lenderCode);
  if (status) params.set('status', status);

  const { data, isLoading, error, refetch } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-interest-statements', lenderCode, status],
    queryFn: () => floorplanApi.listInterestStatements(params.toString()),
  });

  const allocateMutation = useMutation({
    mutationFn: (id: string) => floorplanApi.allocateInterestStatement(id),
    onSuccess: (_r, id) => { refresh(); setDetailId(id); },
  });
  const postAccrualMutation = useMutation({
    mutationFn: (id: string) => floorplanApi.postInterestAccrual(id),
    onSuccess: () => refresh(),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ce12-interest-statements'] });
    qc.invalidateQueries({ queryKey: ['ce12-interest-statement'] });
    refetch();
  }

  const rows = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <input data-testid="interest-lender-filter" className="h-8 w-28 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={lenderCode} onChange={(e) => setLenderCode(e.target.value)} placeholder="Lender code" />
        <select data-testid="interest-status-filter" className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="ENTERED">ENTERED</option><option value="ALLOCATED">ALLOCATED</option><option value="POSTED">POSTED</option><option value="REJECTED">REJECTED</option><option value="REVERSED">REVERSED</option>
        </select>
        <button data-testid="interest-search-button" className="h-8 px-3 border border-gray-300 text-xs rounded hover:bg-gray-100 flex items-center gap-1.5 font-medium" onClick={() => refetch()}>
          <Search size={13} /> Search
        </button>
        <button data-testid="interest-new-statement-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover ml-auto font-medium" onClick={() => setShowEntry(true)}>
          + Enter Statement
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'You do not have permission to view interest statements.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="interest-empty-state">No interest statements entered yet.</div>
        )}
        {!isLoading && !error && rows.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Lender</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Statement Date</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Total (entered)</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Basis</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Journal#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s: any) => (
                <tr key={s.id} data-testid={`interest-statement-row-${s.id}`} className="h-9 border-b border-gray-100 hover:bg-brand-light cursor-pointer" onClick={() => setDetailId(s.id)}>
                  <td className="px-3 font-mono">{s.lenderCode}</td>
                  <td className="px-3">{fmtDate(s.statementDate)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(s.totalInterestAmount)}</td>
                  <td className="px-3">{s.allocationBasis}</td>
                  <td className="px-3"><StatusBadge status={s.status} map={STATEMENT_STATUS_BADGE} /></td>
                  <td className="px-3 font-mono" onClick={(e) => e.stopPropagation()}>
                    {s.journalNumber ? (
                      <button type="button" className="text-brand hover:underline" data-testid={`journal-drill-link-${s.id}`} onClick={() => setDrillJournal(s.journalNumber)}>{s.journalNumber}</button>
                    ) : '—'}
                  </td>
                  <td className="px-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {s.status === 'ENTERED' && (
                        <button data-testid={`allocate-button-${s.id}`} className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                          disabled={allocateMutation.isPending} onClick={() => allocateMutation.mutate(s.id)}>Allocate</button>
                      )}
                      {s.status === 'ALLOCATED' && (
                        <button data-testid={`post-accrual-button-${s.id}`} className="h-6 px-2 text-[11px] border border-brand text-brand rounded hover:bg-brand-light disabled:opacity-50"
                          disabled={postAccrualMutation.isPending} onClick={() => postAccrualMutation.mutate(s.id)}>Post Accrual</button>
                      )}
                      {s.status === 'POSTED' && (
                        <button data-testid={`reverse-accrual-button-${s.id}`} className="h-6 px-2 text-[11px] border border-red-300 text-red-600 rounded hover:bg-red-50" onClick={() => setReverseTarget(s)}>Reverse</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {detailId && <StatementDetail statementId={detailId} onClose={() => setDetailId(null)} />}
      </div>

      {showEntry && <StatementEntryModal onClose={() => setShowEntry(false)} onDone={() => { setShowEntry(false); refresh(); }} />}
      {reverseTarget && <ReverseAccrualModal statement={reverseTarget} onClose={() => setReverseTarget(null)} onDone={() => { setReverseTarget(null); refresh(); }} />}
      {drillJournal && <JournalDrillDrawer journalNumber={drillJournal} onClose={() => setDrillJournal(null)} />}
    </div>
  );
}

// ── Curtailment schedule + payment ceremony ─────────────────────────────
function ConfigureCurtailmentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [lenderCode, setLenderCode] = useState('');
  const [intervalDays, setIntervalDays] = useState('30');
  const [curtailmentPercent, setCurtailmentPercent] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      floorplanApi.configureCurtailmentSchedule({
        lenderCode, intervalDays: Number(intervalDays), curtailmentPercent, effectiveFrom, effectiveTo: effectiveTo || undefined,
      }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to configure curtailment schedule.'),
  });

  return (
    <ModalShell title="Configure Curtailment Schedule" onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">Per-lender-terms configuration (entered, not invented rate math).</div>
        <div><label className="text-xs font-medium text-gray-600">Lender Code</label>
          <input data-testid="curtailment-schedule-lender-input" className={FIELD} value={lenderCode} onChange={(e) => setLenderCode(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs font-medium text-gray-600">Interval (days)</label>
            <input data-testid="curtailment-schedule-interval-input" className={FIELD} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} /></div>
          <div><label className="text-xs font-medium text-gray-600">Curtailment %</label>
            <input data-testid="curtailment-schedule-percent-input" className={FIELD} value={curtailmentPercent} onChange={(e) => setCurtailmentPercent(e.target.value)} placeholder="e.g. 10" /></div>
          <div><label className="text-xs font-medium text-gray-600">Effective From</label>
            <input data-testid="curtailment-schedule-from-input" type="date" className={FIELD} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
          <div><label className="text-xs font-medium text-gray-600">Effective To (optional)</label>
            <input data-testid="curtailment-schedule-to-input" type="date" className={FIELD} value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} /></div>
        </div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="curtailment-schedule-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!lenderCode || !intervalDays || !curtailmentPercent || !effectiveFrom || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Saving…' : 'Configure Schedule'}
        </button>
      </div>
    </ModalShell>
  );
}

function CurtailmentPaymentModal({ item, onClose, onDone }: { item: any; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => floorplanApi.payCurtailment({ itemId: item.id, amount, paidAt, idempotencyKey: crypto.randomUUID() }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to post curtailment payment.'),
  });

  return (
    <ModalShell title={`Curtailment Payment — ${item.applyNumber}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-500">Remaining balance: <span className="font-mono font-semibold">{fmt(item.remainingBalance)}</span>. Posts principal relief against this unit's floorplan liability item.</div>
        <div><label className="text-xs font-medium text-gray-600">Amount</label>
          <input data-testid="curtailment-payment-amount-input" className={FIELD} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        <div><label className="text-xs font-medium text-gray-600">Paid At</label>
          <input data-testid="curtailment-payment-paidat-input" type="date" className={FIELD} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="curtailment-payment-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!amount || !paidAt || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Posting…' : 'Post Curtailment Payment'}
        </button>
      </div>
    </ModalShell>
  );
}

function CurtailmentTab() {
  const [lenderCode, setLenderCode] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [payTarget, setPayTarget] = useState<any | null>(null);
  const [drillJournal, setDrillJournal] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: schedules, isLoading: schedLoading, error: schedError, refetch: refetchSched } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-curtailment-schedules', lenderCode],
    queryFn: () => floorplanApi.listCurtailmentSchedules(lenderCode || undefined),
  });

  const { data: openItems, isLoading: itemsLoading, refetch: refetchItems } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-curtailment-open-items', lenderCode],
    queryFn: () => floorplanApi.listLiabilityItems(`${lenderCode ? `lenderCode=${encodeURIComponent(lenderCode)}&` : ''}status=OPEN`),
    enabled: !!lenderCode,
  });

  const { data: payments } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-curtailment-payments', lenderCode],
    queryFn: () => floorplanApi.listCurtailmentPayments(lenderCode ? `lenderCode=${encodeURIComponent(lenderCode)}` : undefined),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ce12-curtailment-schedules'] });
    qc.invalidateQueries({ queryKey: ['ce12-curtailment-open-items'] });
    qc.invalidateQueries({ queryKey: ['ce12-curtailment-payments'] });
    refetchSched();
    refetchItems();
  }

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <input data-testid="curtailment-lender-filter" className="h-8 w-32 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={lenderCode} onChange={(e) => setLenderCode(e.target.value)} placeholder="Lender code" />
        <button data-testid="curtailment-search-button" className="h-8 px-3 border border-gray-300 text-xs rounded hover:bg-gray-100 flex items-center gap-1.5 font-medium" onClick={() => { refetchSched(); refetchItems(); }}>
          <Search size={13} /> Search
        </button>
        <button data-testid="curtailment-config-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover ml-auto font-medium" onClick={() => setShowConfig(true)}>
          + Configure Schedule
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div>
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Curtailment Schedules</div>
          {schedLoading && <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-brand" /></div>}
          {!schedLoading && schedError && (
            <div className="flex items-center gap-2 p-2 text-red-700 text-xs">
              <AlertCircle size={14} /> {(schedError as any)?.status === 403 ? 'You do not have permission to view curtailment schedules.' : (schedError as Error).message}
            </div>
          )}
          {!schedLoading && !schedError && (schedules?.items ?? []).length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm" data-testid="curtailment-schedules-empty-state">No curtailment schedules configured.</div>
          )}
          {!schedLoading && !schedError && (schedules?.items ?? []).length > 0 && (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Lender</th>
                  <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Interval (days)</th>
                  <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Curtailment %</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Effective From</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Effective To</th>
                </tr>
              </thead>
              <tbody>
                {(schedules?.items ?? []).map((s: any) => (
                  <tr key={s.id} data-testid={`curtailment-schedule-row-${s.id}`} className="h-8 border-b border-gray-100">
                    <td className="px-3 font-mono">{s.lenderCode}</td>
                    <td className="px-3 text-right font-mono">{s.intervalDays}</td>
                    <td className="px-3 text-right font-mono">{s.curtailmentPercent}%</td>
                    <td className="px-3">{fmtDate(s.effectiveFrom)}</td>
                    <td className="px-3">{s.effectiveTo ? fmtDate(s.effectiveTo) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Open Floorplan Items (enter a lender code to pay a curtailment)</div>
          {!lenderCode && <div className="text-xs text-gray-400 py-2" data-testid="curtailment-items-hint">Enter a lender code above and search to list open liability items.</div>}
          {lenderCode && itemsLoading && <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-brand" /></div>}
          {lenderCode && !itemsLoading && (openItems?.items ?? []).length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm" data-testid="curtailment-items-empty-state">No open liability items for this lender.</div>
          )}
          {lenderCode && !itemsLoading && (openItems?.items ?? []).length > 0 && (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Apply#</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">VIN / Stock#</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                  <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Remaining</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(openItems?.items ?? []).map((i: any) => (
                  <tr key={i.id} data-testid={`curtailment-item-row-${i.applyNumber}`} className="h-8 border-b border-gray-100 hover:bg-brand-light">
                    <td className="px-3 font-mono">{i.applyNumber}</td>
                    <td className="px-3 font-mono">{i.vin ?? i.stockNumber}</td>
                    <td className="px-3"><StatusBadge status={i.status} map={LIABILITY_STATUS_BADGE} /></td>
                    <td className="px-3 text-right font-mono tabular-nums">{fmt(i.remainingBalance)}</td>
                    <td className="px-3">
                      <button data-testid={`pay-curtailment-button-${i.applyNumber}`} className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100" onClick={() => setPayTarget(i)}>Pay Curtailment</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Curtailment Payments</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Lender</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">VIN / Stock#</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Amount</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Paid At</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Journal#</th>
              </tr>
            </thead>
            <tbody>
              {(payments?.items ?? []).length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-gray-400">No curtailment payments recorded.</td></tr>
              )}
              {(payments?.items ?? []).map((p: any) => (
                <tr key={p.id} data-testid={`curtailment-payment-row-${p.id}`} className="h-8 border-b border-gray-100">
                  <td className="px-3 font-mono">{p.lenderCode}</td>
                  <td className="px-3 font-mono">{p.vin ?? p.stockNumber}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(p.amount)}</td>
                  <td className="px-3">{fmtDate(p.paidAt)}</td>
                  <td className="px-3"><StatusBadge status={p.status} map={PAYMENT_STATUS_BADGE} /></td>
                  <td className="px-3 font-mono">
                    {p.journalNumber ? (
                      <button type="button" className="text-brand hover:underline" data-testid={`journal-drill-link-${p.id}`} onClick={() => setDrillJournal(p.journalNumber)}>{p.journalNumber}</button>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showConfig && <ConfigureCurtailmentModal onClose={() => setShowConfig(false)} onDone={() => { setShowConfig(false); refresh(); }} />}
      {payTarget && <CurtailmentPaymentModal item={payTarget} onClose={() => setPayTarget(null)} onDone={() => { setPayTarget(null); refresh(); }} />}
      {drillJournal && <JournalDrillDrawer journalNumber={drillJournal} onClose={() => setDrillJournal(null)} />}
    </div>
  );
}

export default function FloorplanInterestCurtailments() {
  const [tab, setTab] = useState<'interest' | 'curtailment'>('interest');

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">
      <div className="bg-white border-b border-gray-200 px-4 pt-2">
        <div className="flex items-center gap-4 mb-2">
          <h1 className="text-sm font-semibold text-gray-900">Floorplan Interest &amp; Curtailments</h1>
        </div>
        <div className="flex gap-4">
          <button data-testid="interest-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'interest' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('interest')}>Interest Statements</button>
          <button data-testid="curtailment-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'curtailment' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('curtailment')}>Curtailment Schedule &amp; Payments</button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'interest' && <InterestStatementsTab />}
        {tab === 'curtailment' && <CurtailmentTab />}
      </div>
    </div>
  );
}
