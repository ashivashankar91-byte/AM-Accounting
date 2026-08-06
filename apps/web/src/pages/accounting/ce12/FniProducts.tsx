import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, PlayCircle, CheckCircle2 } from 'lucide-react';
import {
  fniReserveApi,
  type RemitRun,
  type ProviderStatementReconciliation,
  type ProviderStatementLine,
  type ProductCancellation,
  type RefundBasisInput,
  type DeferralModeConfig,
  type ResolvedDeferralMode,
  type RecognitionRunBatch,
  type CancellationPreviewResult,
  type DeferralBooking,
} from '../../../api/ce12-fni-client';
import { PageHeader, Btn, Badge } from '../../../components/ui';
import { Drawer, DrawerRow, FilterBar, FilterField, FILTER_CONTROL_CLASS, EmptyState, ErrorState, LoadingState, UnauthorizedState, Banner } from '../../../components/report';

// CE-12 / S092 (product income & remit accrual) + S093 (cancellations) +
// S094 (dealer-obligor deferral mode). Initial income/remit-liability and
// deferred-liability bookings happen in deal-accounting-service's S084
// journal; this screen owns everything after that: remit runs to
// providers, provider-statement reconciliation (evidence-only, never
// auto-adjusted), the cancellation ceremony (three-leg breakdown, refused
// on double-cancel), and the S094 deferral-mode config + PREVIEW-APPROVE
// recognition run pipeline. No dollar figure below is computed in the
// browser — every amount is a verbatim field from a real API response.

const fmt = (n: string | number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—';

function isUnauthorized(err: any) {
  return err?.status === 401 || err?.status === 403;
}

// ── Remit Runs tab ──────────────────────────────────────────────────────
function NewRemitRunDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [providerCode, setProviderCode] = useState('');
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState([{ dealNumber: '', productCode: '', amount: '' }]);
  const [error, setError] = useState<string | null>(null);

  const validItems = items.filter((i) => i.dealNumber.trim() && i.productCode.trim() && i.amount.trim());
  const canSubmit = !!providerCode.trim() && !!runDate && validItems.length > 0;

  const mutation = useMutation({
    mutationFn: () => fniReserveApi.executeRemitRun({
      providerCode: providerCode.trim(),
      runDate,
      items: validItems.map((i) => ({ dealNumber: i.dealNumber.trim(), productCode: i.productCode.trim(), amount: i.amount.trim() })),
      idempotencyKey: crypto.randomUUID(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce12-remit-runs'] });
      qc.invalidateQueries({ queryKey: ['ce12-remit-liability-tieout'] });
      onClose();
    },
    onError: (err: any) => setError(err.message),
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title="New remit run"
      subtitle="Batches matched remit-liability items to a single provider payment"
      testId="remit-run-new-drawer"
      actions={<>
        <Btn variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>Cancel</Btn>
        <Btn variant="primary" size="sm" disabled={!canSubmit} loading={mutation.isPending} onClick={() => mutation.mutate()} data-testid="remit-run-submit">Execute run</Btn>
      </>}
    >
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-slate-600">Provider code
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={providerCode} onChange={(e) => setProviderCode(e.target.value)} data-testid="remit-run-provider-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Run date
          <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={runDate} onChange={(e) => setRunDate(e.target.value)} data-testid="remit-run-date-input" />
        </label>
        <div className="text-xs font-semibold text-slate-600">Items</div>
        {items.map((it, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input className="h-8 w-24 border border-slate-200 rounded-lg px-2 text-xs font-mono" placeholder="Deal#" value={it.dealNumber} onChange={(e) => setItems((prev) => prev.map((p, i) => i === idx ? { ...p, dealNumber: e.target.value } : p))} data-testid={`remit-run-item-deal-${idx}`} />
            <input className="h-8 w-24 border border-slate-200 rounded-lg px-2 text-xs font-mono" placeholder="Product" value={it.productCode} onChange={(e) => setItems((prev) => prev.map((p, i) => i === idx ? { ...p, productCode: e.target.value } : p))} data-testid={`remit-run-item-product-${idx}`} />
            <input className="h-8 w-20 border border-slate-200 rounded-lg px-2 text-xs font-mono" placeholder="0.00" value={it.amount} onChange={(e) => setItems((prev) => prev.map((p, i) => i === idx ? { ...p, amount: e.target.value } : p))} data-testid={`remit-run-item-amount-${idx}`} />
          </div>
        ))}
        <div className="flex gap-2">
          <button className="text-xs text-brand hover:underline" onClick={() => setItems((prev) => [...prev, { dealNumber: '', productCode: '', amount: '' }])} data-testid="remit-run-add-item">+ Add item</button>
          {items.length > 1 && <button className="text-xs text-slate-500 hover:underline" onClick={() => setItems((prev) => prev.slice(0, -1))}>Remove last</button>}
        </div>
        {error && <p className="text-xs text-red-600" data-testid="remit-run-error">{error}</p>}
      </div>
    </Drawer>
  );
}

function RemitRunsTab() {
  const [providerFilter, setProviderFilter] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['ce12-remit-runs', providerFilter],
    queryFn: () => fniReserveApi.listRemitRuns(providerFilter || undefined),
    retry: false,
  });
  const detailQ = useQuery({
    queryKey: ['ce12-remit-run-detail', detailId],
    queryFn: () => fniReserveApi.getRemitRun(detailId!),
    enabled: !!detailId,
    retry: false,
  });
  const tieOutQ = useQuery({
    queryKey: ['ce12-remit-liability-tieout', providerFilter],
    queryFn: () => fniReserveApi.getRemitLiabilityTieOut(providerFilter || undefined),
    retry: false,
  });

  const rows = listQ.data ?? [];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <FilterBar>
          <FilterField label="Provider code (optional)" width={200}>
            <input className={FILTER_CONTROL_CLASS} value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} data-testid="remit-runs-provider-filter" />
          </FilterField>
          <Btn size="sm" variant="secondary" icon={<Search size={13} />} onClick={() => { listQ.refetch(); tieOutQ.refetch(); }} data-testid="remit-runs-search-btn">Search</Btn>
        </FilterBar>
        <Btn size="sm" onClick={() => setNewOpen(true)} data-testid="remit-runs-new-btn">New remit run…</Btn>
      </div>

      {tieOutQ.data && (
        <div className="mb-3 text-[12.5px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-testid="remit-liability-tieout-banner">
          Unremitted product liability open balance: <span className="font-mono font-semibold">{fmt(tieOutQ.data.totalOpenAmount)}</span> across {tieOutQ.data.openItems.length} open item(s).
        </div>
      )}

      {listQ.isLoading && <LoadingState testId="remit-runs-loading" label="Loading remit runs…" />}
      {listQ.error && (isUnauthorized(listQ.error)
        ? <UnauthorizedState testId="remit-runs-unauthorized" message={(listQ.error as any).message} />
        : <ErrorState testId="remit-runs-error" message={(listQ.error as Error).message} onRetry={() => listQ.refetch()} />)}
      {!listQ.isLoading && !listQ.error && rows.length === 0 && (
        <EmptyState testId="remit-runs-empty" title="No remit runs yet" message="Batch matched remit-liability items into a provider payment run." action={<Btn variant="secondary" size="sm" onClick={() => setNewOpen(true)}>New remit run…</Btn>} />
      )}
      {!listQ.isLoading && !listQ.error && rows.length > 0 && (
        <table className="w-full border-collapse" data-testid="remit-runs-table">
          <thead>
            <tr className="bg-slate-50 border-b-2 border-slate-200">
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Provider</th>
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Run date</th>
              <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Total</th>
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Payment rail linkage</th>
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: RemitRun) => (
              <tr key={r.id} data-testid={`remit-run-row-${r.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 text-[13px]">{r.providerCode}</td>
                <td className="px-3 text-[13px]">{fmtDate(r.runDate)}</td>
                <td className="px-3 text-right font-mono text-[13px]">{fmt(r.totalAmount)}</td>
                <td className="px-3 text-[11px] text-slate-500">{r.paymentRailLinkageStatus}</td>
                <td className="px-3"><Btn variant="secondary" size="sm" onClick={() => setDetailId(r.id)} data-testid={`remit-run-view-${r.id}`}>View items…</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer
        open={!!detailId}
        onClose={() => setDetailId(null)}
        title={`Remit run — ${detailQ.data?.providerCode ?? ''}`}
        testId="remit-run-detail-drawer"
      >
        {detailQ.isLoading && <LoadingState testId="remit-run-detail-loading" label="Loading…" />}
        {detailQ.data && (
          <div className="flex flex-col gap-2">
            <DrawerRow label="Run date" value={fmtDate(detailQ.data.runDate)} />
            <DrawerRow label="Total" value={fmt(detailQ.data.totalAmount)} />
            <DrawerRow label="Payment rail linkage" value={detailQ.data.paymentRailLinkageStatus} />
            <div className="text-xs font-semibold text-slate-600 mt-2">Items</div>
            {(detailQ.data.items ?? []).map((it) => (
              <div key={it.id} className="flex justify-between text-[12.5px] py-1 border-b border-slate-100" data-testid={`remit-run-detail-item-${it.id}`}>
                <span className="font-mono">{it.dealNumber} / {it.productCode}</span>
                <span className="font-mono">{fmt(it.amount)}</span>
                <Badge variant={it.status === 'RELIEVED' ? 'success' : 'danger'}>{it.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {newOpen && <NewRemitRunDrawer onClose={() => setNewOpen(false)} />}
    </div>
  );
}

// ── Provider Reconciliation tab ─────────────────────────────────────────
function NewStatementDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [providerCode, setProviderCode] = useState('');
  const [statementDate, setStatementDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState([{ dealNumber: '', productCode: '', statementAmount: '' }]);
  const [error, setError] = useState<string | null>(null);

  const validLines = lines.filter((l) => l.dealNumber.trim() && l.productCode.trim() && l.statementAmount.trim());
  const canSubmit = !!providerCode.trim() && !!statementDate && validLines.length > 0;

  const mutation = useMutation({
    mutationFn: () => fniReserveApi.uploadProviderStatement({
      providerCode: providerCode.trim(),
      statementDate,
      lines: validLines.map((l) => ({ dealNumber: l.dealNumber.trim(), productCode: l.productCode.trim(), statementAmount: l.statementAmount.trim() })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce12-reconciliations'] });
      onClose();
    },
    onError: (err: any) => setError(err.message),
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title="Enter provider statement"
      subtitle="Statement figures are entered evidence — never invented or auto-adjusted"
      testId="statement-new-drawer"
      actions={<>
        <Btn variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>Cancel</Btn>
        <Btn variant="primary" size="sm" disabled={!canSubmit} loading={mutation.isPending} onClick={() => mutation.mutate()} data-testid="statement-new-submit">Upload &amp; reconcile</Btn>
      </>}
    >
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-slate-600">Provider code
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={providerCode} onChange={(e) => setProviderCode(e.target.value)} data-testid="statement-provider-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Statement date
          <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} data-testid="statement-date-input" />
        </label>
        <div className="text-xs font-semibold text-slate-600">Statement lines</div>
        {lines.map((l, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input className="h-8 w-24 border border-slate-200 rounded-lg px-2 text-xs font-mono" placeholder="Deal#" value={l.dealNumber} onChange={(e) => setLines((prev) => prev.map((p, i) => i === idx ? { ...p, dealNumber: e.target.value } : p))} data-testid={`statement-line-deal-${idx}`} />
            <input className="h-8 w-24 border border-slate-200 rounded-lg px-2 text-xs font-mono" placeholder="Product" value={l.productCode} onChange={(e) => setLines((prev) => prev.map((p, i) => i === idx ? { ...p, productCode: e.target.value } : p))} data-testid={`statement-line-product-${idx}`} />
            <input className="h-8 w-20 border border-slate-200 rounded-lg px-2 text-xs font-mono" placeholder="0.00" value={l.statementAmount} onChange={(e) => setLines((prev) => prev.map((p, i) => i === idx ? { ...p, statementAmount: e.target.value } : p))} data-testid={`statement-line-amount-${idx}`} />
          </div>
        ))}
        <div className="flex gap-2">
          <button className="text-xs text-brand hover:underline" onClick={() => setLines((prev) => [...prev, { dealNumber: '', productCode: '', statementAmount: '' }])} data-testid="statement-add-line">+ Add line</button>
          {lines.length > 1 && <button className="text-xs text-slate-500 hover:underline" onClick={() => setLines((prev) => prev.slice(0, -1))}>Remove last</button>}
        </div>
        {error && <p className="text-xs text-red-600" data-testid="statement-new-error">{error}</p>}
      </div>
    </Drawer>
  );
}

function ReviewVarianceRow({ line, reconciliationId }: { line: ProviderStatementLine; reconciliationId: string }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const mutation = useMutation({
    mutationFn: () => fniReserveApi.reviewVarianceLine(line.id, { reviewNote: note.trim() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ce12-reconciliation-detail', reconciliationId] }),
  });
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <input className="h-7 flex-1 border border-slate-200 rounded px-2 text-xs" placeholder="Review note (required)" value={note} onChange={(e) => setNote(e.target.value)} data-testid={`variance-review-note-${line.id}`} />
      <Btn size="sm" variant="secondary" disabled={!note.trim() || mutation.isPending} onClick={() => mutation.mutate()} data-testid={`variance-review-submit-${line.id}`}>Review</Btn>
    </div>
  );
}

function ProviderReconciliationTab() {
  const [providerFilter, setProviderFilter] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['ce12-reconciliations', providerFilter],
    queryFn: () => fniReserveApi.listReconciliations(providerFilter || undefined),
    retry: false,
  });
  const detailQ = useQuery({
    queryKey: ['ce12-reconciliation-detail', detailId],
    queryFn: () => fniReserveApi.getReconciliation(detailId!),
    enabled: !!detailId,
    retry: false,
  });

  const rows = listQ.data ?? [];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <FilterBar>
          <FilterField label="Provider code (optional)" width={200}>
            <input className={FILTER_CONTROL_CLASS} value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} data-testid="reconciliation-provider-filter" />
          </FilterField>
          <Btn size="sm" variant="secondary" icon={<Search size={13} />} onClick={() => listQ.refetch()} data-testid="reconciliation-search-btn">Search</Btn>
        </FilterBar>
        <Btn size="sm" onClick={() => setNewOpen(true)} data-testid="reconciliation-new-btn">Enter provider statement…</Btn>
      </div>

      {listQ.isLoading && <LoadingState testId="reconciliation-loading" label="Loading reconciliations…" />}
      {listQ.error && (isUnauthorized(listQ.error)
        ? <UnauthorizedState testId="reconciliation-unauthorized" message={(listQ.error as any).message} />
        : <ErrorState testId="reconciliation-error" message={(listQ.error as Error).message} onRetry={() => listQ.refetch()} />)}
      {!listQ.isLoading && !listQ.error && rows.length === 0 && (
        <EmptyState testId="reconciliation-empty" title="No provider statements entered" message="Enter a provider statement to compare against your remitted amounts. Variances are flagged, never auto-adjusted." action={<Btn variant="secondary" size="sm" onClick={() => setNewOpen(true)}>Enter provider statement…</Btn>} />
      )}
      {!listQ.isLoading && !listQ.error && rows.length > 0 && (
        <table className="w-full border-collapse" data-testid="reconciliation-table">
          <thead>
            <tr className="bg-slate-50 border-b-2 border-slate-200">
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Provider</th>
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Statement date</th>
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: ProviderStatementReconciliation) => (
              <tr key={r.id} data-testid={`reconciliation-row-${r.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 text-[13px]">{r.providerCode}</td>
                <td className="px-3 text-[13px]">{fmtDate(r.statementDate)}</td>
                <td className="px-3"><Btn variant="secondary" size="sm" onClick={() => setDetailId(r.id)} data-testid={`reconciliation-view-${r.id}`}>View worklist…</Btn></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Drawer
        open={!!detailId}
        onClose={() => setDetailId(null)}
        title={`Provider statement — ${detailQ.data?.providerCode ?? ''}`}
        testId="reconciliation-detail-drawer"
      >
        {detailQ.isLoading && <LoadingState testId="reconciliation-detail-loading" label="Loading…" />}
        {detailQ.data?.lines?.map((line) => (
          <div key={line.id} className="py-2 border-b border-slate-100" data-testid={`reconciliation-line-${line.id}`}>
            <div className="flex justify-between text-[12.5px]">
              <span className="font-mono">{line.dealNumber} / {line.productCode}</span>
              <Badge variant={line.status === 'MATCHED' ? 'success' : line.status === 'REVIEWED' ? 'neutral' : 'danger'} dot>{line.status}</Badge>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 mt-0.5">
              <span>Statement: {fmt(line.statementAmount)}</span>
              <span>Ours: {fmt(line.ourRemittedAmount)}</span>
              <span className={Number(line.variance) !== 0 ? 'text-red-600 font-semibold' : ''}>Variance: {fmt(line.variance)}</span>
            </div>
            {line.status === 'VARIANCE_FLAGGED' && detailId && <ReviewVarianceRow line={line} reconciliationId={detailId} />}
            {line.status === 'REVIEWED' && <div className="text-[11px] text-slate-500 italic mt-1">Reviewed: {line.reviewNote}</div>}
          </div>
        ))}
      </Drawer>

      {newOpen && <NewStatementDrawer onClose={() => setNewOpen(false)} />}
    </div>
  );
}

// ── Cancellations tab ────────────────────────────────────────────────────
function NewCancellationDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [dealNumber, setDealNumber] = useState('');
  const [productCode, setProductCode] = useState('');
  const [cancellationSource, setCancellationSource] = useState<'CUSTOMER' | 'LENDER'>('CUSTOMER');
  const [originalIncomeAmount, setOriginalIncomeAmount] = useState('');
  const [originalRemitAmount, setOriginalRemitAmount] = useState('');
  const [basisKind, setBasisKind] = useState<'PROVIDER_QUOTE_PERCENT' | 'PROVIDER_QUOTE_AMOUNT' | 'CONFIG_PRORATA'>('PROVIDER_QUOTE_PERCENT');
  const [refundPercent, setRefundPercent] = useState('');
  const [quoteTotalAmount, setQuoteTotalAmount] = useState('');
  const [prorataProductType, setProrataProductType] = useState('');
  const [prorataProviderCode, setProrataProviderCode] = useState('');
  const [prorataBookingDate, setProrataBookingDate] = useState('');
  const [chargebackTriggered, setChargebackTriggered] = useState(false);
  const [lenderProgramCode, setLenderProgramCode] = useState('');
  const [chargebackAmount, setChargebackAmount] = useState('');
  const [result, setResult] = useState<ProductCancellation | null>(null);
  const [preview, setPreview] = useState<CancellationPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [duplicateRefusal, setDuplicateRefusal] = useState<string | null>(null);

  function buildRefundBasis(): RefundBasisInput | null {
    if (basisKind === 'PROVIDER_QUOTE_PERCENT') {
      const n = Number(refundPercent);
      if (!refundPercent.trim() || !Number.isFinite(n)) return null;
      return { kind: 'PROVIDER_QUOTE_PERCENT', refundPercent: n };
    }
    if (basisKind === 'PROVIDER_QUOTE_AMOUNT') {
      if (!quoteTotalAmount.trim()) return null;
      return { kind: 'PROVIDER_QUOTE_AMOUNT', quoteTotalAmount: quoteTotalAmount.trim() };
    }
    if (!prorataProductType.trim() || !prorataProviderCode.trim() || !prorataBookingDate.trim()) return null;
    return { kind: 'CONFIG_PRORATA', productType: prorataProductType.trim(), providerCode: prorataProviderCode.trim(), bookingDate: prorataBookingDate.trim() };
  }

  const refundBasis = buildRefundBasis();
  const canSubmit = !!dealNumber.trim() && !!productCode.trim() && !!originalIncomeAmount.trim() && !!originalRemitAmount.trim() && !!refundBasis
    && (!chargebackTriggered || (!!lenderProgramCode.trim() && !!chargebackAmount.trim()));

  function buildRequestBody(idempotencyKey: string) {
    return {
      dealNumber: dealNumber.trim(),
      productCode: productCode.trim(),
      cancellationSource,
      originalIncomeAmount: originalIncomeAmount.trim(),
      originalRemitAmount: originalRemitAmount.trim(),
      refundBasis: refundBasis!,
      chargebackTriggered: chargebackTriggered || undefined,
      lenderProgramCode: chargebackTriggered ? lenderProgramCode.trim() : undefined,
      chargebackAmount: chargebackTriggered ? chargebackAmount.trim() : undefined,
      idempotencyKey,
    };
  }

  // Gap-closure — dry-run preview (POST /cancellations/preview) before the
  // real POST /cancellations: computes the income-reversal/remit-adjustment/
  // refund-payable three-leg breakdown server-side without posting anything.
  const previewMutation = useMutation({
    mutationFn: () => fniReserveApi.previewCancellation(buildRequestBody(crypto.randomUUID())),
    onSuccess: (p) => { setPreview(p); setPreviewError(null); },
    onError: (err: any) => setPreviewError(err.message),
  });

  const mutation = useMutation({
    mutationFn: () => fniReserveApi.processCancellation(buildRequestBody(crypto.randomUUID())),
    onSuccess: (row) => {
      setResult(row);
      qc.invalidateQueries({ queryKey: ['ce12-cancellations'] });
    },
    onError: (err: any) => {
      // The API's explicit, named refusal for a double-cancellation attempt
      // (409 DuplicateCancellationError) — surfaced verbatim, never as a
      // generic error banner.
      if (err.status === 409) setDuplicateRefusal(err.message);
      else setError(err.message);
    },
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title="New product cancellation"
      testId="cancellation-new-drawer"
      actions={result ? (
        <Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>
      ) : preview ? (
        <>
          <Btn variant="ghost" size="sm" onClick={() => setPreview(null)} disabled={mutation.isPending}>Back</Btn>
          <Btn variant="danger" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()} data-testid="cancellation-submit">Confirm &amp; process</Btn>
        </>
      ) : (
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={previewMutation.isPending}>Cancel</Btn>
          <Btn variant="secondary" size="sm" disabled={!canSubmit} loading={previewMutation.isPending} onClick={() => previewMutation.mutate()} data-testid="cancellation-preview-btn">Preview…</Btn>
        </>
      )}
    >
      {!result && preview && (
        <div className="flex flex-col gap-1" data-testid="cancellation-preview-panel">
          <Banner kind="info" testId="cancellation-preview-banner" title="Server-computed preview — nothing posted yet">
            Review the three-leg breakdown below, then Confirm &amp; process to post the same computation for real.
          </Banner>
          <DrawerRow label="Quote total" value={fmt(preview.quoteTotal)} />
          <DrawerRow label="Income reversal" value={fmt(preview.incomeReversalAmount)} />
          <DrawerRow label="Remit adjustment" value={fmt(preview.remitAdjustmentAmount)} />
          <DrawerRow label="Refund payable" value={fmt(preview.refundPayableAmount)} />
          {duplicateRefusal && <Banner kind="error" testId="cancellation-duplicate-refusal" title="Refused — already cancelled">{duplicateRefusal}</Banner>}
          {error && <p className="text-xs text-red-600" data-testid="cancellation-error">{error}</p>}
        </div>
      )}
      {!result && !preview && (
        <div className="flex flex-col gap-3">
          <label className="text-xs font-semibold text-slate-600">Deal #
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={dealNumber} onChange={(e) => setDealNumber(e.target.value)} data-testid="cancellation-deal-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Product code
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={productCode} onChange={(e) => setProductCode(e.target.value)} data-testid="cancellation-product-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Cancellation source
            <select className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={cancellationSource} onChange={(e) => setCancellationSource(e.target.value as any)} data-testid="cancellation-source-select">
              <option value="CUSTOMER">Customer</option>
              <option value="LENDER">Lender</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Original income amount
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={originalIncomeAmount} onChange={(e) => setOriginalIncomeAmount(e.target.value)} placeholder="0.00" data-testid="cancellation-income-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">Original remit amount
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={originalRemitAmount} onChange={(e) => setOriginalRemitAmount(e.target.value)} placeholder="0.00" data-testid="cancellation-remit-input" />
          </label>

          <div className="text-xs font-semibold text-slate-600 mt-1">Refund basis</div>
          <select className="h-8 px-2 border border-slate-200 rounded-lg text-sm" value={basisKind} onChange={(e) => setBasisKind(e.target.value as any)} data-testid="cancellation-basis-kind-select">
            <option value="PROVIDER_QUOTE_PERCENT">Entered provider quote — % of original</option>
            <option value="PROVIDER_QUOTE_AMOUNT">Entered provider quote — total $ amount</option>
            <option value="CONFIG_PRORATA">Configured pro-rata table</option>
          </select>
          {basisKind === 'PROVIDER_QUOTE_PERCENT' && (
            <label className="text-xs font-semibold text-slate-600">Refund percent (0-100)
              <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={refundPercent} onChange={(e) => setRefundPercent(e.target.value)} placeholder="e.g. 60" data-testid="cancellation-refund-percent-input" />
            </label>
          )}
          {basisKind === 'PROVIDER_QUOTE_AMOUNT' && (
            <label className="text-xs font-semibold text-slate-600">Quote total amount
              <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={quoteTotalAmount} onChange={(e) => setQuoteTotalAmount(e.target.value)} placeholder="0.00" data-testid="cancellation-quote-amount-input" />
            </label>
          )}
          {basisKind === 'CONFIG_PRORATA' && (
            <>
              <label className="text-xs font-semibold text-slate-600">Product type
                <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={prorataProductType} onChange={(e) => setProrataProductType(e.target.value)} data-testid="cancellation-prorata-product-type-input" />
              </label>
              <label className="text-xs font-semibold text-slate-600">Provider code
                <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={prorataProviderCode} onChange={(e) => setProrataProviderCode(e.target.value)} data-testid="cancellation-prorata-provider-input" />
              </label>
              <label className="text-xs font-semibold text-slate-600">Original booking date
                <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={prorataBookingDate} onChange={(e) => setProrataBookingDate(e.target.value)} data-testid="cancellation-prorata-booking-date-input" />
              </label>
            </>
          )}

          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 mt-1">
            <input type="checkbox" checked={chargebackTriggered} onChange={(e) => setChargebackTriggered(e.target.checked)} data-testid="cancellation-chargeback-triggered-checkbox" />
            This cancellation also triggers a reserve chargeback draw
          </label>
          {chargebackTriggered && (
            <>
              <label className="text-xs font-semibold text-slate-600">Lender program code
                <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={lenderProgramCode} onChange={(e) => setLenderProgramCode(e.target.value)} data-testid="cancellation-lender-program-input" />
              </label>
              <label className="text-xs font-semibold text-slate-600">Chargeback amount
                <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={chargebackAmount} onChange={(e) => setChargebackAmount(e.target.value)} placeholder="0.00" data-testid="cancellation-chargeback-amount-input" />
              </label>
            </>
          )}

          {duplicateRefusal && (
            <Banner kind="error" testId="cancellation-duplicate-refusal" title="Refused — already cancelled">{duplicateRefusal}</Banner>
          )}
          {previewError && <p className="text-xs text-red-600" data-testid="cancellation-preview-error">{previewError}</p>}
          {error && <p className="text-xs text-red-600" data-testid="cancellation-error">{error}</p>}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-1" data-testid="cancellation-result-panel">
          <Banner kind="success" testId="cancellation-success-banner" title="Cancellation posted">
            Three-leg breakdown below is the server-computed, posted result.
          </Banner>
          <DrawerRow label="Quote total" value={fmt(result.quoteTotal)} />
          <DrawerRow label="Income reversal" value={fmt(result.incomeReversalAmount)} />
          <DrawerRow label="Remit adjustment" value={fmt(result.remitAdjustmentAmount)} />
          <DrawerRow label="Refund payable" value={fmt(result.refundPayableAmount)} />
          <DrawerRow label="Chargeback triggered" value={result.chargebackTriggered ? 'Yes' : 'No'} />
          <DrawerRow label="Status" value={result.status} />
        </div>
      )}
    </Drawer>
  );
}

function CancellationsTab() {
  const [dealFilter, setDealFilter] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const listQ = useQuery({
    queryKey: ['ce12-cancellations', dealFilter],
    queryFn: () => fniReserveApi.listCancellations(dealFilter || undefined),
    retry: false,
  });

  const rows = listQ.data ?? [];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <FilterBar>
          <FilterField label="Deal # (optional)" width={200}>
            <input className={FILTER_CONTROL_CLASS} value={dealFilter} onChange={(e) => setDealFilter(e.target.value)} data-testid="cancellations-deal-filter" />
          </FilterField>
          <Btn size="sm" variant="secondary" icon={<Search size={13} />} onClick={() => listQ.refetch()} data-testid="cancellations-search-btn">Search</Btn>
        </FilterBar>
        <Btn size="sm" variant="danger" onClick={() => setNewOpen(true)} data-testid="cancellations-new-btn">New cancellation…</Btn>
      </div>

      {listQ.isLoading && <LoadingState testId="cancellations-loading" label="Loading cancellations…" />}
      {listQ.error && (isUnauthorized(listQ.error)
        ? <UnauthorizedState testId="cancellations-unauthorized" message={(listQ.error as any).message} />
        : <ErrorState testId="cancellations-error" message={(listQ.error as Error).message} onRetry={() => listQ.refetch()} />)}
      {!listQ.isLoading && !listQ.error && rows.length === 0 && (
        <EmptyState testId="cancellations-empty" title="No product cancellations recorded" action={<Btn variant="secondary" size="sm" onClick={() => setNewOpen(true)}>New cancellation…</Btn>} />
      )}
      {!listQ.isLoading && !listQ.error && rows.length > 0 && (
        <table className="w-full border-collapse" data-testid="cancellations-table">
          <thead>
            <tr className="bg-slate-50 border-b-2 border-slate-200">
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Deal #</th>
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Product</th>
              <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Income reversal</th>
              <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Remit adjustment</th>
              <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Refund payable</th>
              <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: ProductCancellation) => (
              <tr key={r.id} data-testid={`cancellation-row-${r.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 font-mono text-[13px]">{r.dealNumber}</td>
                <td className="px-3 font-mono text-[13px]">{r.productCode}</td>
                <td className="px-3 text-right font-mono text-[13px]">{fmt(r.incomeReversalAmount)}</td>
                <td className="px-3 text-right font-mono text-[13px]">{fmt(r.remitAdjustmentAmount)}</td>
                <td className="px-3 text-right font-mono text-[13px]">{fmt(r.refundPayableAmount)}</td>
                <td className="px-3"><Badge variant={r.status === 'PROCESSED' ? 'success' : r.status === 'REVERSED' ? 'neutral' : 'danger'} dot>{r.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {newOpen && <NewCancellationDrawer onClose={() => setNewOpen(false)} />}
    </div>
  );
}

// ── Deferral & Recognition tab ──────────────────────────────────────────
function DeferralModeConfigDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [productType, setProductType] = useState('');
  const [mode, setMode] = useState<'AGENT' | 'OBLIGOR'>('OBLIGOR');
  const [earningPatternMonths, setEarningPatternMonths] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!productType.trim() && !!effectiveFrom.trim() && (mode === 'AGENT' || !!earningPatternMonths.trim());

  const mutation = useMutation({
    mutationFn: () => fniReserveApi.createDeferralModeConfig({
      productType: productType.trim(),
      mode,
      earningPatternType: 'STRAIGHT_LINE_MONTHS',
      earningPatternMonths: mode === 'OBLIGOR' ? Number(earningPatternMonths) : null,
      effectiveFrom: effectiveFrom.trim(),
      effectiveTo: effectiveTo.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce12-deferral-mode-configs'] });
      onClose();
    },
    onError: (err: any) => setError(err.message),
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title="New deferral-mode configuration"
      subtitle="Effective-dated per product type — mode change is prospective, never retroactive"
      testId="deferral-config-new-drawer"
      actions={<>
        <Btn variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>Cancel</Btn>
        <Btn variant="primary" size="sm" disabled={!canSubmit} loading={mutation.isPending} onClick={() => mutation.mutate()} data-testid="deferral-config-submit">Create</Btn>
      </>}
    >
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-slate-600">Product type
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={productType} onChange={(e) => setProductType(e.target.value)} data-testid="deferral-config-product-type-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Mode
          <select className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={mode} onChange={(e) => setMode(e.target.value as any)} data-testid="deferral-config-mode-select">
            <option value="OBLIGOR">Obligor (dealer is obligor — deferred recognition)</option>
            <option value="AGENT">Agent (immediate recognition — S092 default)</option>
          </select>
        </label>
        {mode === 'OBLIGOR' && (
          <label className="text-xs font-semibold text-slate-600">Earning pattern — straight-line months
            <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={earningPatternMonths} onChange={(e) => setEarningPatternMonths(e.target.value)} placeholder="e.g. 60" data-testid="deferral-config-pattern-months-input" />
          </label>
        )}
        <label className="text-xs font-semibold text-slate-600">Effective from
          <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="deferral-config-effective-from-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Effective to (optional)
          <input type="date" className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} data-testid="deferral-config-effective-to-input" />
        </label>
        {error && <p className="text-xs text-red-600" data-testid="deferral-config-error">{error}</p>}
      </div>
    </Drawer>
  );
}

function DeferralAndRecognitionTab() {
  const qc = useQueryClient();
  const [lookupProductType, setLookupProductType] = useState('');
  const [lookupAsOfDate, setLookupAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [lookupResult, setLookupResult] = useState<ResolvedDeferralMode | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [configNewOpen, setConfigNewOpen] = useState(false);
  const [previewAsOfDate, setPreviewAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const configsQ = useQuery({
    queryKey: ['ce12-deferral-mode-configs'],
    queryFn: () => fniReserveApi.listDeferralModeConfigs(),
    retry: false,
  });
  const tieOutQ = useQuery({
    queryKey: ['ce12-deferral-liability-tieout'],
    queryFn: () => fniReserveApi.getDeferralLiabilityTieOut(),
    retry: false,
  });
  const [bookingStatusFilter, setBookingStatusFilter] = useState('');
  const bookingsQ = useQuery({
    queryKey: ['ce12-deferral-bookings', bookingStatusFilter],
    queryFn: () => fniReserveApi.listDeferralBookings(bookingStatusFilter || undefined),
    retry: false,
  });
  const batchesQ = useQuery({
    queryKey: ['ce12-recognition-runs'],
    queryFn: () => fniReserveApi.listRecognitionRuns(),
    retry: false,
  });
  const activeBatchQ = useQuery({
    queryKey: ['ce12-recognition-run-detail', activeBatchId],
    queryFn: () => fniReserveApi.getRecognitionRun(activeBatchId!),
    enabled: !!activeBatchId,
    retry: false,
  });

  async function lookupMode() {
    if (!lookupProductType.trim() || !lookupAsOfDate) return;
    setLookupError(null);
    setLookupResult(null);
    try {
      const res = await fniReserveApi.getDeferralMode(lookupProductType.trim(), lookupAsOfDate);
      setLookupResult(res);
    } catch (err: any) {
      setLookupError(err.message);
    }
  }

  const previewMutation = useMutation({
    mutationFn: () => fniReserveApi.computeRecognitionRunPreview(previewAsOfDate),
    onSuccess: (batch: RecognitionRunBatch) => {
      setActiveBatchId(batch.id);
      qc.invalidateQueries({ queryKey: ['ce12-recognition-runs'] });
    },
    onError: (err: any) => setPreviewError(err.message),
  });

  const approveMutation = useMutation({
    mutationFn: () => fniReserveApi.approveRecognitionRun(activeBatchId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce12-recognition-run-detail', activeBatchId] });
      qc.invalidateQueries({ queryKey: ['ce12-recognition-runs'] });
      qc.invalidateQueries({ queryKey: ['ce12-deferral-liability-tieout'] });
    },
    onError: (err: any) => setPreviewError(err.message),
  });

  const batch = activeBatchQ.data;

  return (
    <div className="p-4 flex flex-col gap-6">
      <div>
        <h3 className="text-[13px] font-semibold text-slate-700 mb-2">Deferral mode lookup (S094 cross-service contract)</h3>
        <div className="flex items-end gap-2 mb-2">
          <label className="text-xs font-semibold text-slate-600">Product type
            <input className="mt-1 h-8 w-48 border border-slate-200 rounded-lg px-2 text-sm" value={lookupProductType} onChange={(e) => setLookupProductType(e.target.value)} data-testid="deferral-lookup-product-type-input" />
          </label>
          <label className="text-xs font-semibold text-slate-600">As of date
            <input type="date" className="mt-1 h-8 border border-slate-200 rounded-lg px-2 text-sm" value={lookupAsOfDate} onChange={(e) => setLookupAsOfDate(e.target.value)} data-testid="deferral-lookup-date-input" />
          </label>
          <Btn size="sm" variant="secondary" disabled={!lookupProductType.trim()} onClick={lookupMode} data-testid="deferral-lookup-btn">Look up mode</Btn>
        </div>
        {lookupError && <p className="text-xs text-red-600" data-testid="deferral-lookup-error">{lookupError}</p>}
        {lookupResult && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[13px] max-w-md" data-testid="deferral-lookup-result">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold">Mode:</span>
              <Badge variant={lookupResult.mode === 'OBLIGOR' ? 'purple' : 'info'} dot>{lookupResult.mode}</Badge>
            </div>
            {lookupResult.mode === 'OBLIGOR' && (
              <>
                <div>Earning pattern: {lookupResult.earningPatternType} / {lookupResult.earningPatternMonths} months</div>
                <div>Effective from: {fmtDate(lookupResult.effectiveFrom)}</div>
              </>
            )}
            {lookupResult.mode === 'AGENT' && lookupResult.configId === null && (
              <div className="text-slate-500 italic">No config row — defaulting to AGENT (immediate recognition, S092 default).</div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-slate-700">Deferral mode configuration (per product type, effective-dated)</h3>
          <Btn size="sm" onClick={() => setConfigNewOpen(true)} data-testid="deferral-config-new-btn">New config…</Btn>
        </div>
        {configsQ.isLoading && <LoadingState testId="deferral-configs-loading" label="Loading…" />}
        {!configsQ.isLoading && (configsQ.data ?? []).length === 0 && (
          <EmptyState testId="deferral-configs-empty" title="No deferral-mode configuration — all products default to AGENT (immediate recognition)." />
        )}
        {!configsQ.isLoading && (configsQ.data ?? []).length > 0 && (
          <table className="w-full border-collapse" data-testid="deferral-configs-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Product type</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Mode</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Pattern</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Effective</th>
              </tr>
            </thead>
            <tbody>
              {(configsQ.data ?? []).map((c: DeferralModeConfig) => (
                <tr key={c.id} data-testid={`deferral-config-row-${c.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 text-[13px]">{c.productType}</td>
                  <td className="px-3"><Badge variant={c.mode === 'OBLIGOR' ? 'purple' : 'info'} dot>{c.mode}</Badge></td>
                  <td className="px-3 text-[13px]">{c.mode === 'OBLIGOR' ? `${c.earningPatternType} / ${c.earningPatternMonths}mo` : '—'}</td>
                  <td className="px-3 text-[13px] text-slate-600">{fmtDate(c.effectiveFrom)}{c.effectiveTo ? ` – ${fmtDate(c.effectiveTo)}` : ' – open'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {tieOutQ.data && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[13px] flex flex-col gap-2" data-testid="deferral-liability-tieout-banner">
          <div className="flex gap-6">
            <div>Total deferred: <span className="font-mono font-semibold">{fmt(tieOutQ.data.totalDeferred)}</span></div>
            <div>Total recognized: <span className="font-mono font-semibold">{fmt(tieOutQ.data.totalRecognized)}</span></div>
            <div>Total unearned (deferred liability): <span className="font-mono font-semibold">{fmt(tieOutQ.data.totalUnearned)}</span></div>
          </div>
          {tieOutQ.data.scheduleTieOut ? (
            <div className="flex gap-6 pt-2 border-t border-slate-200" data-testid="deferral-schedule-tieout">
              <Badge variant="info" dot>SCHEDULE-SERVICE AUTHORITATIVE</Badge>
              <div>Schedule {tieOutQ.data.scheduleTieOut.scheduleNumber} — {tieOutQ.data.scheduleTieOut.openItemCount} open item(s)</div>
              <div>Remaining balance: <span className="font-mono font-semibold">{fmt(tieOutQ.data.scheduleTieOut.totalRemainingBalance)}</span></div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 italic pt-2 border-t border-slate-200">No DEFERRED_INCOME_LIABILITY schedule mapping configured for this tenant — the totals above are this service's own booking sums, not yet tied to a schedule-service open-item balance.</div>
          )}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-semibold text-slate-700">Deferral bookings (real, persisted — gap-closure)</h3>
          <select className="h-8 border border-slate-200 rounded-lg px-2 text-sm" value={bookingStatusFilter} onChange={(e) => setBookingStatusFilter(e.target.value)} data-testid="deferral-bookings-status-filter">
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="FULLY_RECOGNIZED">Fully recognized</option>
          </select>
        </div>
        {bookingsQ.isLoading && <LoadingState testId="deferral-bookings-loading" label="Loading deferral bookings…" />}
        {bookingsQ.error && (
          <ErrorState testId="deferral-bookings-error" message={(bookingsQ.error as Error).message} onRetry={() => bookingsQ.refetch()} />
        )}
        {!bookingsQ.isLoading && !bookingsQ.error && (bookingsQ.data ?? []).length === 0 && (
          <EmptyState testId="deferral-bookings-empty" title="No deferral bookings" message="Deferral bookings are created when a deal-accounting-service S084 journal posts a product with an OBLIGOR-mode config." />
        )}
        {!bookingsQ.isLoading && !bookingsQ.error && (bookingsQ.data ?? []).length > 0 && (
          <table className="w-full border-collapse" data-testid="deferral-bookings-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Deal / Product</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Original</th>
                <th className="px-3 py-1.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Recognized</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Pattern</th>
                <th className="px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {(bookingsQ.data as DeferralBooking[]).map((b) => (
                <tr key={b.id} data-testid={`deferral-booking-row-${b.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 font-mono text-[13px]">{b.dealNumber} / {b.productCode}</td>
                  <td className="px-3 text-right font-mono text-[13px]">{fmt(b.originalAmount)}</td>
                  <td className="px-3 text-right font-mono text-[13px] font-semibold">{fmt(b.recognizedAmount)}</td>
                  <td className="px-3 text-[13px]">{b.earningPatternType} / {b.earningPatternMonths}mo</td>
                  <td className="px-3"><Badge variant={b.status === 'FULLY_RECOGNIZED' ? 'success' : 'neutral'} dot>{b.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h3 className="text-[13px] font-semibold text-slate-700 mb-2">Recognition run — preview, then approve &amp; post</h3>
        <Banner kind="info" testId="recognition-run-preview-approve-note" title="Two distinct steps, never combined">
          Compute Preview shows the batch of amounts about to be recognized this period. Nothing posts until Approve &amp; Post
          is clicked separately, on the same previewed batch — the posted amount is always exactly what was computed at preview time.
        </Banner>
        <div className="flex items-end gap-2 my-3">
          <label className="text-xs font-semibold text-slate-600">As of date
            <input type="date" className="mt-1 h-8 border border-slate-200 rounded-lg px-2 text-sm" value={previewAsOfDate} onChange={(e) => setPreviewAsOfDate(e.target.value)} data-testid="recognition-preview-date-input" />
          </label>
          <Btn size="sm" icon={<PlayCircle size={13} />} loading={previewMutation.isPending} onClick={() => previewMutation.mutate()} data-testid="recognition-compute-preview-btn">Compute Preview</Btn>
        </div>
        {previewError && <p className="text-xs text-red-600 mb-2" data-testid="recognition-preview-error">{previewError}</p>}

        {batch && (
          <div className="border border-slate-200 rounded-lg p-3" data-testid="recognition-batch-panel">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[13px]">
                Batch <span className="font-mono">{batch.id}</span> — as of {fmtDate(batch.asOfDate)} — computed total{' '}
                <span className="font-mono font-semibold">{fmt(batch.computedTotal)}</span>
              </div>
              <Badge variant={batch.status === 'POSTED' ? 'success' : batch.status === 'APPROVED' ? 'info' : 'warning'} dot>{batch.status}</Badge>
            </div>
            <table className="w-full border-collapse mb-2">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Deal / Product</th>
                  <th className="px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Period</th>
                  <th className="px-2 py-1 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Cumulative before</th>
                  <th className="px-2 py-1 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Earned this run</th>
                  <th className="px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {(batch.lines ?? []).map((l) => (
                  <tr key={l.id} data-testid={`recognition-line-${l.id}`} className="h-8 border-b border-slate-100">
                    <td className="px-2 font-mono text-[12.5px]">{l.deferralBooking?.dealNumber} / {l.deferralBooking?.productCode}</td>
                    <td className="px-2 text-[12.5px]">{fmtDate(l.periodStart)} – {fmtDate(l.periodEnd)}</td>
                    <td className="px-2 text-right font-mono text-[12.5px]">{fmt(l.cumulativeRecognizedBefore)}</td>
                    <td className="px-2 text-right font-mono text-[12.5px] font-semibold">{fmt(l.earnedAmount)}</td>
                    <td className="px-2"><Badge variant={l.status === 'POSTED' ? 'success' : l.status === 'FAILED' ? 'danger' : 'neutral'}>{l.status}</Badge></td>
                  </tr>
                ))}
                {(batch.lines ?? []).length === 0 && (
                  <tr><td colSpan={5} className="text-center py-4 text-slate-400 text-[12.5px]">No open deferral bookings had a positive earned amount as of this date.</td></tr>
                )}
              </tbody>
            </table>
            {batch.status === 'PREVIEW' && (
              <Btn size="sm" variant="primary" icon={<CheckCircle2 size={13} />} loading={approveMutation.isPending} onClick={() => approveMutation.mutate()} data-testid="recognition-approve-post-btn">Approve &amp; Post</Btn>
            )}
            {batch.status !== 'PREVIEW' && (
              <div className="text-[12px] text-slate-500">
                Approved by {batch.approvedBy} at {batch.approvedAt ? new Date(batch.approvedAt).toLocaleString() : '—'}
                {batch.postedAt && <> — posted at {new Date(batch.postedAt).toLocaleString()}</>}
              </div>
            )}
          </div>
        )}

        <div className="mt-3">
          <h4 className="text-[12px] font-semibold text-slate-600 mb-1">Past recognition runs</h4>
          <table className="w-full border-collapse" data-testid="recognition-runs-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">As of</th>
                <th className="px-2 py-1 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Computed total</th>
                <th className="px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                <th className="px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600"></th>
              </tr>
            </thead>
            <tbody>
              {(batchesQ.data ?? []).map((b) => (
                <tr key={b.id} data-testid={`recognition-run-row-${b.id}`} className="h-8 border-b border-slate-100">
                  <td className="px-2 text-[12.5px]">{fmtDate(b.asOfDate)}</td>
                  <td className="px-2 text-right font-mono text-[12.5px]">{fmt(b.computedTotal)}</td>
                  <td className="px-2"><Badge variant={b.status === 'POSTED' ? 'success' : b.status === 'APPROVED' ? 'info' : 'warning'} dot>{b.status}</Badge></td>
                  <td className="px-2"><button className="text-xs text-brand hover:underline" onClick={() => setActiveBatchId(b.id)} data-testid={`recognition-run-open-${b.id}`}>Open</button></td>
                </tr>
              ))}
              {(batchesQ.data ?? []).length === 0 && (
                <tr><td colSpan={4} className="text-center py-4 text-slate-400 text-[12.5px]">No recognition runs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {configNewOpen && <DeferralModeConfigDrawer onClose={() => setConfigNewOpen(false)} />}
    </div>
  );
}

// ── Page shell ───────────────────────────────────────────────────────────
const TABS = [
  { key: 'remit-runs', label: 'Remit Runs' },
  { key: 'reconciliation', label: 'Provider Reconciliation' },
  { key: 'cancellations', label: 'Cancellations' },
  { key: 'deferral', label: 'Deferral & Recognition' },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function FniProducts() {
  const [tab, setTab] = useState<TabKey>('remit-runs');

  return (
    <div className="p-7 min-h-full" data-testid="fni-products-page">
      <PageHeader
        title="F&amp;I Products"
        subtitle="S092 remit runs & provider reconciliation, S093 cancellations, S094 dealer-obligor deferral mode & preview-approve recognition runs."
      />

      <div className="flex items-center gap-1 border-b border-slate-200 mb-2 bg-white rounded-t-xl px-2 pt-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-testid={`fni-products-tab-${t.key}`}
            className={`px-3 py-2 text-[13px] font-semibold border-b-2 ${tab === t.key ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 border-t-0 rounded-b-xl shadow-sm">
        {tab === 'remit-runs' && <RemitRunsTab />}
        {tab === 'reconciliation' && <ProviderReconciliationTab />}
        {tab === 'cancellations' && <CancellationsTab />}
        {tab === 'deferral' && <DeferralAndRecognitionTab />}
      </div>
    </div>
  );
}
