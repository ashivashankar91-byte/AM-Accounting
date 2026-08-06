// CE-12 / S088 — CIT Funding Match. Tab-based per the ScheduleOpenItems.tsx
// pattern: Aging (CIT items open beyond the configured funding-delay
// threshold), Sold Not Funded (deal-accounting-service's own SNF risk view —
// posted deals whose CIT item is still open beyond threshold), Receipts (real
// paginated funding-receipt list), Funding Match (record a lender funding
// receipt notification that relieves the CIT item), Short-Fund Disposition
// (fee-withheld vs contract-issue/return-to-biller, each with a reason).
//
// Gap-closure pass: deal-accounting-service now exposes GET /cit/funding-
// receipts (paginated list) and GET /cit/sold-not-funded — the prior
// session-local-list workaround for browsing short-funded receipts (no list
// endpoint existed at the time) has been replaced by the real Receipts tab
// and the Short-Fund Disposition tab now queries the real list filtered to
// SHORT_FUNDED_PENDING_DISPOSITION, instead of only what this browser
// session itself recorded.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, Search } from 'lucide-react';
import { ce12DealApi, type CitFundingReceipt, type DealOpenItem, type Deal } from '../../../api/ce12-deal-client';

const fmt = (n: number | string | null | undefined) => {
  if (n == null) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return String(n);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—';

const RECEIPT_STATUS_BADGE: Record<string, string> = {
  MATCHED: 'bg-emerald-100 text-emerald-700',
  SHORT_FUNDED_PENDING_DISPOSITION: 'bg-amber-100 text-amber-700',
  SHORT_FUNDED_FEE_WITHHELD: 'bg-gray-100 text-gray-600',
  SHORT_FUNDED_RETURNED_TO_BILLER: 'bg-purple-100 text-purple-700',
};

function Badge({ status, map }: { status: string; map: Record<string, string> }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium tracking-wide ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function AgingTab() {
  const [thresholdDays, setThresholdDays] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ce12-cit-aging', thresholdDays],
    queryFn: () => ce12DealApi.getCitAging(thresholdDays ? Number(thresholdDays) : undefined),
  });

  const items: DealOpenItem[] = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3">
        <label className="text-xs font-medium text-gray-600">Threshold override (days):</label>
        <input
          data-testid="cit-aging-threshold-input"
          className="h-8 w-20 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={thresholdDays}
          onChange={(e) => setThresholdDays(e.target.value.replace(/\D/g, ''))}
          placeholder="(tenant default)"
        />
        <button
          data-testid="cit-aging-refresh-button"
          className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium"
          onClick={() => refetch()}
        >
          <Search size={13} /> Refresh
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm" data-testid="cit-aging-error">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'Not authorized to view CIT aging.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && items.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="cit-aging-empty">No CIT items open beyond the funding-delay threshold.</div>
        )}
        {!isLoading && !error && items.length > 0 && (
          <table className="w-full text-xs border-collapse" data-testid="cit-aging-table">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Deal#</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-24">Original</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-24">Applied</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-24">Remaining</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-16">Age (d)</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} data-testid={`cit-aging-row-${i.itemNumber}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{i.itemNumber}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(i.originalAmount)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(i.appliedAmount)}</td>
                  <td className="px-3 text-right font-mono tabular-nums font-semibold">{fmt(i.remainingBalance)}</td>
                  <td className="px-3 text-right font-mono tabular-nums text-red-600 font-semibold">{i.ageDays ?? '—'}</td>
                  <td className="px-3">{i.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SoldNotFundedTab() {
  const [thresholdDays, setThresholdDays] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ce12-cit-sold-not-funded', thresholdDays],
    queryFn: () => ce12DealApi.getSoldNotFunded(thresholdDays ? Number(thresholdDays) : undefined),
  });

  const items: Array<DealOpenItem & { deal: Deal }> = data ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3">
        <div className="text-xs text-gray-500">Posted deals whose CIT item is still open beyond the funding-delay threshold — real risk view, not a local recompute.</div>
        <label className="text-xs font-medium text-gray-600 ml-auto">Threshold override (days):</label>
        <input
          data-testid="cit-snf-threshold-input"
          className="h-8 w-20 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={thresholdDays}
          onChange={(e) => setThresholdDays(e.target.value.replace(/\D/g, ''))}
          placeholder="(tenant default)"
        />
        <button
          data-testid="cit-snf-refresh-button"
          className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium"
          onClick={() => refetch()}
        >
          <Search size={13} /> Refresh
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm" data-testid="cit-snf-error">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'Not authorized to view sold-not-funded CIT items.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && items.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="cit-snf-empty">No sold-not-funded CIT items beyond the threshold.</div>
        )}
        {!isLoading && !error && items.length > 0 && (
          <table className="w-full text-xs border-collapse" data-testid="cit-snf-table">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Deal#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Item#</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-24">Remaining</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-16">Age (d)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} data-testid={`cit-snf-row-${i.itemNumber}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{i.deal?.dealNumber ?? '—'}</td>
                  <td className="px-3 font-mono">{i.itemNumber}</td>
                  <td className="px-3 text-right font-mono tabular-nums font-semibold">{fmt(i.remainingBalance)}</td>
                  <td className="px-3 text-right font-mono tabular-nums text-red-600 font-semibold">{i.ageDays ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ReceiptsTab() {
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ce12-cit-funding-receipts', statusFilter],
    queryFn: () => ce12DealApi.listCitFundingReceipts({ status: statusFilter || undefined }),
  });
  const receipts = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3">
        <select
          data-testid="cit-receipts-status-filter"
          className="h-8 border border-gray-300 rounded px-2 text-xs"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="MATCHED">Matched</option>
          <option value="SHORT_FUNDED_PENDING_DISPOSITION">Short-funded — pending disposition</option>
          <option value="SHORT_FUNDED_FEE_WITHHELD">Short-funded — fee withheld</option>
          <option value="SHORT_FUNDED_RETURNED_TO_BILLER">Short-funded — returned to biller</option>
        </select>
        <button data-testid="cit-receipts-refresh-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium" onClick={() => refetch()}>
          <Search size={13} /> Refresh
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm" data-testid="cit-receipts-error">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'Not authorized to view funding receipts.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && receipts.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="cit-receipts-empty">No funding receipts found.</div>
        )}
        {!isLoading && !error && receipts.length > 0 && (
          <table className="w-full text-xs border-collapse" data-testid="cit-receipts-table">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Receipt</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Lender ref</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Amount</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Shortfall</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Received</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} data-testid={`cit-receipt-row-${r.id}`} className="h-9 border-b border-gray-100">
                  <td className="px-3 font-mono">{r.id}</td>
                  <td className="px-3 font-mono">{r.lenderRef}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(r.amount)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(r.shortfallAmount)}</td>
                  <td className="px-3"><Badge status={r.status} map={RECEIPT_STATUS_BADGE} /></td>
                  <td className="px-3">{fmtDate(r.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FundingMatchTab({ onRecorded }: { onRecorded: (r: CitFundingReceipt) => void }) {
  const [dealNumber, setDealNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [lenderRef, setLenderRef] = useState('');
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<CitFundingReceipt | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      ce12DealApi.recordCitFunding({
        dealNumber: dealNumber.trim(),
        amount: amount.trim(),
        lenderRef: lenderRef.trim(),
        receivedAt: new Date(receivedAt).toISOString(),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (r) => {
      setResult(r);
      onRecorded(r);
    },
  });

  const canSubmit = !!dealNumber.trim() && !!amount.trim() && !!lenderRef.trim() && !!receivedAt;

  return (
    <div className="p-4 max-w-lg">
      <div className="text-xs text-gray-500 mb-3">
        Records a lender funding receipt notification against the deal's open CIT item. If the amount received is less
        than the CIT item's remaining balance, the receipt is flagged short-funded pending disposition — the shortfall
        amount is computed server-side and returned below, never estimated here.
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600">Deal# (required)</label>
          <input data-testid="funding-match-deal-number" className="h-8 w-full border border-gray-300 rounded px-2 text-xs font-mono mt-1" value={dealNumber} onChange={(e) => setDealNumber(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Amount received (required)</label>
          <input data-testid="funding-match-amount" className="h-8 w-full border border-gray-300 rounded px-2 text-xs font-mono mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Lender reference (required)</label>
          <input data-testid="funding-match-lender-ref" className="h-8 w-full border border-gray-300 rounded px-2 text-xs font-mono mt-1" value={lenderRef} onChange={(e) => setLenderRef(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Received date (required)</label>
          <input type="date" data-testid="funding-match-received-at" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
        </div>
        {mutation.isError && (
          <div className="text-xs text-red-600 flex items-center gap-1" data-testid="funding-match-error">
            <AlertCircle size={13} /> {(mutation.error as any)?.message ?? 'Failed to record funding receipt.'}
          </div>
        )}
        <button
          data-testid="funding-match-submit-button"
          className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50 font-medium"
          disabled={!canSubmit || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Recording…' : 'Record funding receipt'}
        </button>

        {result && (
          <div
            className={`mt-3 p-3 rounded border text-xs ${result.status === 'MATCHED' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}
            data-testid="funding-match-result"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold">Receipt {result.id}</span>
              <Badge status={result.status} map={RECEIPT_STATUS_BADGE} />
            </div>
            <div>CIT original: <span className="font-mono">{fmt(result.citOriginalAmount)}</span></div>
            <div>Shortfall: <span className="font-mono">{fmt(result.shortfallAmount)}</span></div>
            {result.status === 'SHORT_FUNDED_PENDING_DISPOSITION' && (
              <div className="mt-1 text-amber-700">Short-funded — disposition this receipt on the Short-Fund Disposition tab.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DispositionForm({
  receiptId, onDispositioned,
}: { receiptId: string; onDispositioned: (r: CitFundingReceipt) => void }) {
  const [dispositionType, setDispositionType] = useState<'FEE_WITHHELD' | 'CONTRACT_ISSUE'>('FEE_WITHHELD');
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => ce12DealApi.dispositionCitShortfall(receiptId, dispositionType, reason.trim()),
    onSuccess: (r) => onDispositioned(r),
  });

  return (
    <div className="border border-gray-200 rounded p-3 bg-white space-y-2">
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-gray-600">Disposition:</label>
        <select
          data-testid={`disposition-type-select-${receiptId}`}
          className="h-8 border border-gray-300 rounded px-2 text-xs"
          value={dispositionType}
          onChange={(e) => setDispositionType(e.target.value as 'FEE_WITHHELD' | 'CONTRACT_ISSUE')}
        >
          <option value="FEE_WITHHELD">Fee withheld (posts expense, closes item)</option>
          <option value="CONTRACT_ISSUE">Contract issue (return to biller, item stays open)</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">Reason (required)</label>
        <input
          data-testid={`disposition-reason-input-${receiptId}`}
          className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {mutation.isError && (
        <div className="text-xs text-red-600 flex items-center gap-1" data-testid={`disposition-error-${receiptId}`}>
          <AlertCircle size={13} /> {(mutation.error as any)?.message ?? 'Failed to disposition.'}
        </div>
      )}
      <button
        data-testid={`disposition-submit-button-${receiptId}`}
        className="h-8 px-3 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50 font-medium"
        disabled={!reason.trim() || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Submitting…' : 'Submit disposition'}
      </button>
    </div>
  );
}

function ShortFundTab() {
  const qc = useQueryClient();
  const [manualId, setManualId] = useState('');
  const [manualActive, setManualActive] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ce12-cit-funding-receipts', 'SHORT_FUNDED_PENDING_DISPOSITION'],
    queryFn: () => ce12DealApi.listCitFundingReceipts({ status: 'SHORT_FUNDED_PENDING_DISPOSITION' }),
  });
  const pending: CitFundingReceipt[] = data?.items ?? [];

  function onDispositioned() {
    qc.invalidateQueries({ queryKey: ['ce12-cit-funding-receipts'] });
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="text-xs text-gray-500">
        Short-funded receipts pending disposition tenant-wide (real list, not session-local). A receipt ID not shown
        here can still be dispositioned directly below, relying on the server's own validation and returned state.
      </div>

      {isLoading && <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-brand" /></div>}
      {!isLoading && error && (
        <div className="flex items-center gap-2 text-red-700 text-xs" data-testid="short-fund-error">
          <AlertCircle size={14} /> {(error as any)?.status === 403 ? 'Not authorized to view short-funded receipts.' : (error as Error).message}
          <button className="text-brand hover:underline ml-2" onClick={() => refetch()}>Retry</button>
        </div>
      )}
      {!isLoading && !error && pending.length === 0 && <div className="text-gray-400 text-xs" data-testid="short-fund-empty">No short-funded receipts pending disposition.</div>}
      {!isLoading && !error && pending.map((r) => (
        <div key={r.id} data-testid={`short-fund-row-${r.id}`}>
          <div className="text-xs font-semibold mb-1">Receipt {r.id} — shortfall <span className="font-mono">{fmt(r.shortfallAmount)}</span></div>
          <DispositionForm receiptId={r.id} onDispositioned={onDispositioned} />
        </div>
      ))}

      <div className="border-t border-gray-200 pt-3">
        <button
          data-testid="short-fund-manual-toggle"
          className="text-xs text-brand hover:underline"
          onClick={() => setManualActive((v) => !v)}
        >
          {manualActive ? 'Hide manual lookup' : 'Disposition a receipt by ID'}
        </button>
        {manualActive && (
          <div className="mt-2 space-y-2">
            <div>
              <label className="text-xs font-medium text-gray-600">Receipt ID</label>
              <input
                data-testid="short-fund-manual-id-input"
                className="h-8 w-full border border-gray-300 rounded px-2 text-xs font-mono mt-1"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
              />
            </div>
            {manualId.trim() && <DispositionForm receiptId={manualId.trim()} onDispositioned={onDispositioned} />}
          </div>
        )}
      </div>
    </div>
  );
}

const TABS = ['aging', 'snf', 'receipts', 'match', 'shortfund'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  aging: 'Aging', snf: 'Sold Not Funded', receipts: 'Receipts', match: 'Funding Match', shortfund: 'Short-Fund Disposition',
};

export default function CitFundingWorkbench() {
  const [tab, setTab] = useState<Tab>('aging');
  const qc = useQueryClient();

  function onRecorded() {
    qc.invalidateQueries({ queryKey: ['ce12-cit-funding-receipts'] });
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">
      <div className="bg-white border-b border-gray-200 px-4 pt-2">
        <h1 className="text-sm font-semibold text-gray-900 mb-2">CIT Funding Workbench</h1>
        <div className="flex gap-4">
          {TABS.map((t) => (
            <button
              key={t}
              data-testid={`cit-tab-${t}`}
              className={`pb-2 text-xs font-medium border-b-2 ${tab === t ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'aging' && <AgingTab />}
        {tab === 'snf' && <SoldNotFundedTab />}
        {tab === 'receipts' && <ReceiptsTab />}
        {tab === 'match' && <FundingMatchTab onRecorded={onRecorded} />}
        {tab === 'shortfund' && <ShortFundTab />}
      </div>
    </div>
  );
}
