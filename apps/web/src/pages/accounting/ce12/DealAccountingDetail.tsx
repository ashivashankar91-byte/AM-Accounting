// CE-12 / S084-S089 — Deal Accounting Detail. Tab-based per the
// ScheduleOpenItems.tsx pattern: Journal Chain (full S218 lineage — core +
// recontract deltas + reversals, shown as a linked sequence), Lineage
// (gap-closure — GET /deals/:dealNumber/lineage: the full posting +
// recontract + unwind chain in one authoritative call, distinct from the
// per-version Journal Chain tab which is derived client-side from the
// already-fetched deal detail), CIT / Reserve / Products / Payoff summary
// tabs (read-only — this service's own DealOpenItem shadow ledger; full
// ceremonies for reserve/products live on the sibling fni-reserve-service
// screens this page cross-links to), and Audit (real S007 audit-service
// document history). Also wires the S086 Unwind and S087 Recontract
// ceremonies.
import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, ShieldAlert, Plus, Trash2 } from 'lucide-react';
import {
  ce12DealApi, type DealOpenItem, type DealPostingRecord, type DealType, type DealRecapPayload, type DealRecapProductLine,
} from '../../../api/ce12-deal-client';
import { JournalDrillDrawer } from '../../../components/ce12/JournalDrillDrawer';

const fmt = (n: number | string | null | undefined) => {
  if (n == null) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return String(n);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const DEAL_STATUS_BADGE: Record<string, string> = {
  DESKED: 'bg-gray-100 text-gray-600', FINALIZED: 'bg-amber-100 text-amber-700', POSTED: 'bg-emerald-100 text-emerald-700',
  UNWOUND: 'bg-purple-100 text-purple-700', RECONTRACTED: 'bg-blue-100 text-blue-700',
};
const COA_STATUS_BADGE: Record<string, string> = {
  POSTED: 'bg-emerald-100 text-emerald-700', NO_RULE_MATCH: 'bg-amber-100 text-amber-700', REJECTED: 'bg-red-100 text-red-700', FAILED: 'bg-red-100 text-red-700',
};
const ITEM_STATUS_BADGE: Record<string, string> = { OPEN: 'bg-blue-100 text-blue-700', CLOSED: 'bg-gray-100 text-gray-600' };

function Badge({ status, map }: { status: string; map: Record<string, string> }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium tracking-wide ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function JournalChainTab({ dealNumber, postingRecords }: { dealNumber: string; postingRecords: DealPostingRecord[] }) {
  const byVersion = useMemo(() => {
    const m = new Map<number, DealPostingRecord[]>();
    for (const r of postingRecords) {
      const v = r.recapVersion ?? 0;
      if (!m.has(v)) m.set(v, []);
      m.get(v)!.push(r);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [postingRecords]);

  if (postingRecords.length === 0) {
    return <div className="text-center py-16 text-gray-400 text-sm" data-testid="journal-chain-empty">No journal segments posted yet for this deal.</div>;
  }

  return (
    <div className="p-4 space-y-6" data-testid="journal-chain-list">
      {byVersion.map(([version, records]) => (
        <div key={version} className="border border-gray-200 rounded bg-white">
          <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-700">Recap version {version}</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-left">
                <th className="px-3 py-1 font-medium">Segment</th>
                <th className="px-3 py-1 font-medium">Journal Entry ID</th>
                <th className="px-3 py-1 font-medium">Journal#</th>
                <th className="px-3 py-1 font-medium">Rule pack ver.</th>
                <th className="px-3 py-1 font-medium">Status</th>
                <th className="px-3 py-1 font-medium">Reversal</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} data-testid={`journal-chain-row-${r.id}`} className="border-t border-gray-100">
                  <td className="px-3 py-1">{r.segmentType}{r.productIndex != null ? ` #${r.productIndex}` : ''}</td>
                  <td className="px-3 py-1 font-mono">{r.journalEntryId ?? '—'}</td>
                  <td className="px-3 py-1 font-mono">{r.journalNumber ?? '—'}</td>
                  <td className="px-3 py-1 font-mono">{r.rulePackVersionId ?? '—'}</td>
                  <td className="px-3 py-1"><Badge status={r.coaStatus} map={COA_STATUS_BADGE} /></td>
                  <td className="px-3 py-1">
                    {r.reversedAt ? (
                      <span className="text-purple-700" data-testid={`journal-chain-reversal-${r.id}`}>
                        reversed by {r.reversalJournalNumber ?? r.reversalJournalEntryId} @ {fmtDate(r.reversedAt)}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="text-[11px] text-gray-400">
        Deal# <span className="font-mono">{dealNumber}</span> — sequence ordered by recap version, oldest first. A reversal row's "Reversal" column links the reversing journal directly to its original segment (S218 lineage).
      </div>
    </div>
  );
}

function LineageTab({ dealNumber }: { dealNumber: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ce12-deal-lineage', dealNumber],
    queryFn: () => ce12DealApi.getDealLineage(dealNumber),
    enabled: !!dealNumber,
  });
  const [drillJournal, setDrillJournal] = useState<string | null>(null);

  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-brand" /></div>;
  if (error) {
    return (
      <div className="p-4 text-xs text-red-600 flex items-center gap-1" data-testid="lineage-error">
        <AlertCircle size={13} /> {(error as any)?.status === 403 ? 'Not authorized to view the deal lineage.' : (error as Error).message}
        <button className="text-brand hover:underline ml-2" onClick={() => refetch()}>Retry</button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="p-4 space-y-6" data-testid="lineage-panel">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Posting chain (real, authoritative — GET /deals/:dealNumber/lineage)</div>
        {data.chain.length === 0 ? (
          <div className="text-gray-400 text-xs py-2" data-testid="lineage-chain-empty">No posting segments in the lineage yet.</div>
        ) : (
          <table className="w-full text-xs border-collapse" data-testid="lineage-chain-table">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Ver.</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Segment</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Journal#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Reversal</th>
              </tr>
            </thead>
            <tbody>
              {data.chain.map((c) => (
                <tr key={c.id} data-testid={`lineage-chain-row-${c.id}`} className="h-9 border-b border-gray-100">
                  <td className="px-3">{c.recapVersion ?? '—'}</td>
                  <td className="px-3">{c.segmentType}</td>
                  <td className="px-3 font-mono">
                    {c.journalNumber ? (
                      <button type="button" className="text-brand hover:underline" data-testid={`lineage-journal-drill-${c.id}`} onClick={() => setDrillJournal(c.journalNumber!)}>
                        {c.journalNumber}
                      </button>
                    ) : '—'}
                  </td>
                  <td className="px-3"><Badge status={c.coaStatus} map={COA_STATUS_BADGE} /></td>
                  <td className="px-3">{c.reversedAt ? `reversed by ${c.reversalJournalNumber ?? c.reversalJournalEntryId}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Recontracts</div>
        {data.recontracts.length === 0 ? (
          <div className="text-gray-400 text-xs py-2" data-testid="lineage-recontracts-empty">No recontracts for this deal.</div>
        ) : (
          <table className="w-full text-xs border-collapse" data-testid="lineage-recontracts-table">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">From → To</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Mode</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.recontracts.map((r) => (
                <tr key={r.id} data-testid={`lineage-recontract-row-${r.id}`} className="h-9 border-b border-gray-100">
                  <td className="px-3">v{r.fromRecapVersion} → v{r.toRecapVersion}</td>
                  <td className="px-3">{r.mode}</td>
                  <td className="px-3">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Unwinds</div>
        {data.unwinds.length === 0 ? (
          <div className="text-gray-400 text-xs py-2" data-testid="lineage-unwinds-empty">No unwinds for this deal.</div>
        ) : (
          <table className="w-full text-xs border-collapse" data-testid="lineage-unwinds-table">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Ver.</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Reason</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {data.unwinds.map((u) => (
                <tr key={u.id} data-testid={`lineage-unwind-row-${u.id}`} className="h-9 border-b border-gray-100">
                  <td className="px-3">{u.recapVersion}</td>
                  <td className="px-3">
                    <Badge status={u.status} map={{ COMPLETED: 'bg-emerald-100 text-emerald-700', REFUSED: 'bg-red-100 text-red-700' }} />
                    {u.refusalCode ? <span className="ml-1 text-[10px] text-red-600 font-mono">{u.refusalCode}</span> : null}
                  </td>
                  <td className="px-3">{u.reason}</td>
                  <td className="px-3">{fmtDate(u.executedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drillJournal && <JournalDrillDrawer journalNumber={drillJournal} onClose={() => setDrillJournal(null)} />}
    </div>
  );
}

function OpenItemsTab({ items, itemType, testId }: { items: DealOpenItem[]; itemType: string; testId: string }) {
  const rows = items.filter((i) => i.itemType === itemType);
  if (rows.length === 0) return <div className="text-center py-16 text-gray-400 text-sm" data-testid={`${testId}-empty`}>No {itemType.replace('_', ' ').toLowerCase()} items for this deal.</div>;
  return (
    <table className="w-full text-xs border-collapse" data-testid={testId}>
      <thead>
        <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
          <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Item#</th>
          <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Original</th>
          <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Applied</th>
          <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Remaining</th>
          <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
          <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Opened</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <tr key={i.id} data-testid={`${testId}-row-${i.itemNumber}`} className="h-9 border-b border-gray-100">
            <td className="px-3 font-mono">{i.itemNumber}</td>
            <td className="px-3 text-right font-mono tabular-nums">{fmt(i.originalAmount)}</td>
            <td className="px-3 text-right font-mono tabular-nums">{fmt(i.appliedAmount)}</td>
            <td className="px-3 text-right font-mono tabular-nums font-semibold">{fmt(i.remainingBalance)}</td>
            <td className="px-3"><Badge status={i.status} map={ITEM_STATUS_BADGE} /></td>
            <td className="px-3">{fmtDate(i.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CitTab({ dealNumber, items }: { dealNumber: string; items: DealOpenItem[] }) {
  return (
    <div className="p-4">
      <div className="text-xs text-gray-500 mb-2">
        Read-only summary. Record a funding receipt or disposition a short-fund variance on the{' '}
        <Link className="text-brand hover:underline" to="/accounting/deals/cit" data-testid="cit-tab-workbench-link">CIT Funding Workbench</Link>.
      </div>
      <OpenItemsTab items={items} itemType="CIT" testId="deal-detail-cit-items" />
    </div>
  );
}

function ReserveTab({ items }: { items: DealOpenItem[] }) {
  return (
    <div className="p-4">
      <div className="text-xs text-gray-500 mb-2">
        Read-only summary. Reserve accruals, remittance short-pay disposition, and flat-% chargeback draws (S091) are managed on the Reserve &amp; Chargeback screen.
      </div>
      <OpenItemsTab items={items} itemType="RESERVE" testId="deal-detail-reserve-items" />
    </div>
  );
}

function ProductsTab({ items, recapProducts }: { items: DealOpenItem[]; recapProducts: DealRecapProductLine[] }) {
  return (
    <div className="p-4 space-y-4">
      <div className="text-xs text-gray-500">
        Read-only summary. Remit runs, provider reconciliation, cancellations, and deferral recognition runs (S092-S094) are managed on the F&amp;I Products screen.
      </div>
      {recapProducts.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Recap product lines</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Product</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Provider ref</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Customer price</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Provider cost</th>
              </tr>
            </thead>
            <tbody>
              {recapProducts.map((p, i) => (
                <tr key={i} className="h-8 border-b border-gray-100">
                  <td className="px-3 font-mono">{p.productCode}</td>
                  <td className="px-3 font-mono">{p.providerRef}</td>
                  <td className="px-3 text-right font-mono">{fmt(p.customerPriceAmount)}</td>
                  <td className="px-3 text-right font-mono">{fmt(p.providerCostAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OpenItemsTab items={items} itemType="PRODUCT_REMIT" testId="deal-detail-product-items" />
    </div>
  );
}

function PayoffTab({ dealNumber, items }: { dealNumber: string; items: DealOpenItem[] }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ce12-payoff', dealNumber],
    queryFn: () => ce12DealApi.getPayoff(dealNumber),
  });
  return (
    <div className="p-4 space-y-4">
      <OpenItemsTab items={items} itemType="PAYOFF" testId="deal-detail-payoff-items" />
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Payoff issuance (S089)</div>
        {isLoading && <Loader2 size={16} className="animate-spin text-brand" />}
        {!isLoading && error && <div className="text-xs text-red-600">{(error as Error).message}</div>}
        {!isLoading && !error && !data?.issuance && <div className="text-xs text-gray-400" data-testid="payoff-issuance-empty">No payoff has been issued for this deal yet.</div>}
        {!isLoading && !error && data?.issuance && (
          <table className="w-full text-xs border-collapse" data-testid="payoff-issuance-table">
            <tbody>
              <tr><td className="text-gray-500 pr-3 py-0.5">Recap payoff amount</td><td className="font-mono">{fmt(data.issuance.recapPayoffAmount)}</td></tr>
              <tr><td className="text-gray-500 pr-3 py-0.5">Actual amount</td><td className="font-mono">{fmt(data.issuance.actualAmount)}</td></tr>
              <tr><td className="text-gray-500 pr-3 py-0.5">Variance</td><td className="font-mono">{fmt(data.issuance.varianceAmount)}</td></tr>
              <tr><td className="text-gray-500 pr-3 py-0.5">Disposition</td><td>{data.issuance.varianceDisposition ?? '—'}</td></tr>
              <tr><td className="text-gray-500 pr-3 py-0.5">Reason</td><td>{data.issuance.varianceReason ?? '—'}</td></tr>
              <tr><td className="text-gray-500 pr-3 py-0.5">Issued</td><td>{fmtDate(data.issuance.issuedAt)} by {data.issuance.issuedBy}</td></tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Gap-closure — Due-Bill / We-Owe ceremony (schedule 91). No prior UI
// existed for this anywhere in CE-12; placed here as a section on the Deal
// Detail screen per the epic's "exactly 11 screens" constraint rather than a
// 12th dedicated screen. ─────────────────────────────────────────────────
const DUE_BILL_STATUS_BADGE: Record<string, string> = { OPEN: 'bg-blue-100 text-blue-700', FULFILLED: 'bg-gray-100 text-gray-600' };

function RecordDueBillForm({ dealNumber, onDone }: { dealNumber: string; onDone: () => void }) {
  const [itemDescription, setItemDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => ce12DealApi.createDueBill({
      dealNumber, itemDescription: itemDescription.trim(), amount: amount.trim(), reason: reason.trim(), idempotencyKey: crypto.randomUUID(),
    }),
    onSuccess: () => { setItemDescription(''); setAmount(''); setReason(''); onDone(); },
  });
  const canSubmit = !!itemDescription.trim() && !!amount.trim() && !!reason.trim();
  return (
    <div className="border border-gray-200 rounded bg-white p-3 space-y-2 max-w-lg" data-testid="due-bill-new-form">
      <div className="text-xs font-semibold text-gray-700">Record a due-bill / we-owe item</div>
      <div className="text-[11px] text-gray-500">Posts a real journal (schedule 91) — a dealer obligation not yet fulfilled at delivery (accessory, repair, missing key, etc.).</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-gray-600">Item description (required)</label>
          <input data-testid="due-bill-item-description-input" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1" value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Amount (required)</label>
          <input data-testid="due-bill-amount-input" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">Reason (required)</label>
        <input data-testid="due-bill-reason-input" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {mutation.isError && (
        <div className="text-xs text-red-600 flex items-center gap-1" data-testid="due-bill-new-error">
          <AlertCircle size={13} /> {(mutation.error as any)?.message ?? 'Failed to record due-bill.'}
        </div>
      )}
      <button
        data-testid="due-bill-new-submit-button"
        className="h-8 px-3 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
        disabled={!canSubmit || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? 'Recording…' : 'Record due-bill'}
      </button>
    </div>
  );
}

function DueBillsTab({ dealNumber }: { dealNumber: string }) {
  const qc = useQueryClient();
  const [drillJournal, setDrillJournal] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ce12-due-bills', dealNumber],
    queryFn: () => ce12DealApi.listDueBills({ dealNumber }),
    enabled: !!dealNumber,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ce12-due-bills', dealNumber] });
  }

  const fulfillMutation = useMutation({
    mutationFn: (id: string) => ce12DealApi.fulfillDueBill(id),
    onSuccess: refresh,
  });

  const rows = data?.items ?? [];

  return (
    <div className="p-4 space-y-4">
      <RecordDueBillForm dealNumber={dealNumber} onDone={refresh} />

      {isLoading && <div className="flex items-center justify-center py-8"><Loader2 size={18} className="animate-spin text-brand" /></div>}
      {!isLoading && error && (
        <div className="text-xs text-red-600 flex items-center gap-1" data-testid="due-bills-error">
          <AlertCircle size={13} /> {(error as any)?.status === 403 ? 'Not authorized to view due-bills.' : (error as Error).message}
          <button className="text-brand hover:underline ml-2" onClick={() => refetch()}>Retry</button>
        </div>
      )}
      {!isLoading && !error && rows.length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm" data-testid="due-bills-empty">No due-bills recorded for this deal yet.</div>
      )}
      {!isLoading && !error && rows.length > 0 && (
        <table className="w-full text-xs border-collapse" data-testid="due-bills-table">
          <thead>
            <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
              <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Item</th>
              <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Amount</th>
              <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Reason</th>
              <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Journal#</th>
              <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
              <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Fulfilled</th>
              <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} data-testid={`due-bill-row-${d.id}`} className="h-9 border-b border-gray-100">
                <td className="px-3">{d.itemDescription}</td>
                <td className="px-3 text-right font-mono tabular-nums">{fmt(d.amount)}</td>
                <td className="px-3 text-gray-600">{d.reason}</td>
                <td className="px-3 font-mono">
                  {d.journalNumber ? (
                    <button type="button" className="text-brand hover:underline" data-testid={`due-bill-journal-drill-${d.id}`} onClick={() => setDrillJournal(d.journalNumber!)}>
                      {d.journalNumber}
                    </button>
                  ) : '—'}
                </td>
                <td className="px-3"><Badge status={d.status} map={DUE_BILL_STATUS_BADGE} /></td>
                <td className="px-3">{d.fulfilledAt ? `${fmtDate(d.fulfilledAt)} by ${d.fulfilledBy}` : '—'}</td>
                <td className="px-3">
                  {d.status === 'OPEN' && (
                    <button
                      data-testid={`due-bill-fulfill-button-${d.id}`}
                      className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                      disabled={fulfillMutation.isPending}
                      onClick={() => fulfillMutation.mutate(d.id)}
                    >
                      Fulfill
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {drillJournal && <JournalDrillDrawer journalNumber={drillJournal} onClose={() => setDrillJournal(null)} />}
    </div>
  );
}

function AuditTab({ docId }: { docId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ce12-deal-audit', docId],
    queryFn: () => ce12DealApi.getAuditTrail('DEAL', docId),
    enabled: !!docId,
  });
  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-brand" /></div>;
  if (error) {
    return (
      <div className="p-4 text-xs text-red-600 flex items-center gap-1" data-testid="audit-error">
        <AlertCircle size={13} /> {(error as any)?.status === 403 ? 'Not authorized to view the audit trail.' : (error as Error).message}
      </div>
    );
  }
  const events = data?.events ?? [];
  if (events.length === 0) return <div className="text-center py-16 text-gray-400 text-sm" data-testid="audit-empty">No audit events recorded for this deal yet.</div>;
  return (
    <table className="w-full text-xs border-collapse" data-testid="audit-table">
      <thead>
        <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
          <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-40">When</th>
          <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-32">Actor</th>
          <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-40">Action</th>
          <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Before / After</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e, i) => (
          <tr key={e.id ?? i} data-testid={`audit-row-${i}`} className="border-b border-gray-100 align-top">
            <td className="px-3 py-1">{fmtDate(e.occurredAt ?? e.createdAt)}</td>
            <td className="px-3 py-1">{e.actorName ?? e.actor ?? '—'}</td>
            <td className="px-3 py-1">{e.action}</td>
            <td className="px-3 py-1">
              <pre className="whitespace-pre-wrap break-words text-[10px] text-gray-600">
                {JSON.stringify({ before: e.before ?? e.previousState ?? null, after: e.after ?? e.newState ?? null }, null, 1)}
              </pre>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UnwindModal({ dealNumber, currentRecapVersion, onClose }: { dealNumber: string; currentRecapVersion: number; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => ce12DealApi.unwindDeal(dealNumber, reason.trim(), currentRecapVersion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce12-deal-detail', dealNumber] });
    },
  });
  const refused = mutation.isError && (mutation.error as any)?.body?.error === 'FUNDED_UNWIND_REFUSED';
  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded shadow-xl">
        <div className="flex items-center justify-between px-4 py-2 bg-red-600 text-white rounded-t">
          <span className="text-sm font-semibold">Unwind deal {dealNumber}</span>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-500">
            Full cancellation of recap version {currentRecapVersion}: reverses every posted journal segment, closes the CIT item (if unfunded), restores the unit, and flags reserve/products for their own reversal flows. If CIT funding has already been applied, this is refused — use Recontract instead.
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Reason (required)</label>
            <input
              autoFocus
              data-testid="unwind-reason-input"
              className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 focus:outline-none focus:ring-1 focus:ring-brand"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {mutation.isError && (
            <div className={`text-xs flex items-start gap-1 ${refused ? 'text-red-700 bg-red-50 border border-red-200 rounded p-2' : 'text-red-600'}`} data-testid="unwind-error">
              {refused && <ShieldAlert size={13} className="mt-0.5 shrink-0" />}
              {refused ? <span><strong>Refused (already funded):</strong> {(mutation.error as any).message}</span> : (mutation.error as any)?.message ?? 'Failed to unwind.'}
            </div>
          )}
          {mutation.isSuccess && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2" data-testid="unwind-success">
              Unwind {mutation.data.status === 'COMPLETED' ? 'completed' : mutation.data.status} — reversed {mutation.data.reversalPostingRecordIds?.length ?? 0} segment(s).
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
          <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Close</button>
          <button
            data-testid="unwind-submit-button"
            className="h-8 px-4 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            disabled={!reason.trim() || mutation.isPending || mutation.isSuccess}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Unwinding…' : 'Unwind'}
          </button>
        </div>
      </div>
    </div>
  );
}

const GROSS_FIELD_BY_TYPE: Record<DealType, keyof DealRecapPayload> = {
  RETAIL: 'saleAmount', DEALER_TRADE: 'saleAmount', WHOLESALE: 'wholesaleAmount', LEASE: 'leaseCapitalizedCostAmount',
};

function RecontractModal({
  dealNumber, fromPayload, toVersion, onClose,
}: { dealNumber: string; fromPayload: DealRecapPayload; toVersion: number; onClose: () => void }) {
  const [form, setForm] = useState<DealRecapPayload>({ ...fromPayload, dealNumber, recapVersion: toVersion });
  const [products, setProducts] = useState<DealRecapProductLine[]>(fromPayload.products ?? []);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => ce12DealApi.recontractDeal(dealNumber, { ...form, products: products.filter((p) => p.productCode) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ce12-deal-detail', dealNumber] }),
  });

  function set<K extends keyof DealRecapPayload>(key: K, value: DealRecapPayload[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const grossField = GROSS_FIELD_BY_TYPE[form.dealType];
  const canSubmit = !!form.stockNumber && !!form.legalEntityId && !!form.storeId && !!form.businessDate && !!form.unitCostAmount && !!(form as any)[grossField];
  const fieldErrors: Record<string, string> | undefined = (mutation.error as any)?.body?.fieldErrors;

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded shadow-xl max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t sticky top-0">
          <span className="text-sm font-semibold">Recontract {dealNumber} — v{fromPayload.recapVersion} → v{toVersion}</span>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-500">
            Submits a new recap version. The API determines whether the result is a DELTA posting (same journal structure) or a REVERSE_REPOST
            (structural change) — never decided client-side.
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-600">Deal type</label>
              <select data-testid="recontract-deal-type" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1" value={form.dealType} onChange={(e) => set('dealType', e.target.value as DealType)}>
                <option value="RETAIL">Retail</option>
                <option value="LEASE">Lease</option>
                <option value="WHOLESALE">Wholesale</option>
                <option value="DEALER_TRADE">Dealer trade</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Legal entity (required)</label>
              <input data-testid="recontract-legal-entity" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.legalEntityId} onChange={(e) => set('legalEntityId', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Store (required)</label>
              <input data-testid="recontract-store" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.storeId} onChange={(e) => set('storeId', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Business date (required)</label>
              <input type="date" data-testid="recontract-business-date" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1" value={form.businessDate} onChange={(e) => set('businessDate', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Stock# (required)</label>
              <input data-testid="recontract-stock-number" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.stockNumber} onChange={(e) => set('stockNumber', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">VIN</label>
              <input data-testid="recontract-vin" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.vin ?? ''} onChange={(e) => set('vin', e.target.value)} />
            </div>

            {form.dealType === 'LEASE' ? (
              <>
                <div>
                  <label className="text-xs font-medium text-gray-600">Lease cap cost (required)</label>
                  <input data-testid="recontract-lease-cap-cost" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.leaseCapitalizedCostAmount ?? ''} onChange={(e) => set('leaseCapitalizedCostAmount', e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Lease residual</label>
                  <input data-testid="recontract-lease-residual" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.leaseResidualAmount ?? ''} onChange={(e) => set('leaseResidualAmount', e.target.value)} />
                </div>
              </>
            ) : form.dealType === 'WHOLESALE' ? (
              <div>
                <label className="text-xs font-medium text-gray-600">Wholesale amount (required)</label>
                <input data-testid="recontract-wholesale-amount" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.wholesaleAmount ?? ''} onChange={(e) => set('wholesaleAmount', e.target.value)} />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-gray-600">Sale amount (required)</label>
                <input data-testid="recontract-sale-amount" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.saleAmount ?? ''} onChange={(e) => set('saleAmount', e.target.value)} />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-gray-600">Unit cost (required)</label>
              <input data-testid="recontract-unit-cost" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.unitCostAmount} onChange={(e) => set('unitCostAmount', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Financed (CIT)</label>
              <input data-testid="recontract-financed-amount" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.financedAmount ?? ''} onChange={(e) => set('financedAmount', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Reserve income</label>
              <input data-testid="recontract-reserve-income" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.reserveIncomeAmount ?? ''} onChange={(e) => set('reserveIncomeAmount', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Fees</label>
              <input data-testid="recontract-fees-amount" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.feesAmount ?? ''} onChange={(e) => set('feesAmount', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Tax result ID</label>
              <input data-testid="recontract-tax-result-id" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.taxResultId ?? ''} onChange={(e) => set('taxResultId', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Rebate receivable</label>
              <input data-testid="recontract-rebate-amount" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.rebateReceivableAmount ?? ''} onChange={(e) => set('rebateReceivableAmount', e.target.value)} />
            </div>
          </div>

          <div className="border-t border-gray-200 pt-2">
            <label className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
              <input type="checkbox" data-testid="recontract-has-trade-in" checked={form.hasTradeIn} onChange={(e) => set('hasTradeIn', e.target.checked)} /> Has trade-in
            </label>
            {form.hasTradeIn && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div><label className="text-xs text-gray-600">Trade VIN</label><input data-testid="recontract-trade-vin" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.tradeVin ?? ''} onChange={(e) => set('tradeVin', e.target.value)} /></div>
                <div><label className="text-xs text-gray-600">Trade allowance (required)</label><input data-testid="recontract-trade-allowance" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.tradeAllowanceAmount ?? ''} onChange={(e) => set('tradeAllowanceAmount', e.target.value)} /></div>
                <div><label className="text-xs text-gray-600">Trade ACV (required)</label><input data-testid="recontract-trade-acv" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.tradeAcvAmount ?? ''} onChange={(e) => set('tradeAcvAmount', e.target.value)} /></div>
                <div><label className="text-xs text-gray-600">Trade payoff</label><input data-testid="recontract-trade-payoff" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.tradePayoffAmount ?? ''} onChange={(e) => set('tradePayoffAmount', e.target.value)} /></div>
                <div><label className="text-xs text-gray-600">Lienholder ref</label><input data-testid="recontract-trade-lienholder" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 font-mono" value={form.tradeLienholderRef ?? ''} onChange={(e) => set('tradeLienholderRef', e.target.value)} /></div>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-600">Product lines</label>
              <button
                type="button"
                data-testid="recontract-add-product-button"
                className="text-[11px] text-brand hover:underline flex items-center gap-0.5"
                onClick={() => setProducts((p) => [...p, { productCode: '', providerRef: '', customerPriceAmount: '', providerCostAmount: '' }])}
              >
                <Plus size={11} /> Add product
              </button>
            </div>
            {products.map((p, i) => (
              <div key={i} className="grid grid-cols-5 gap-1 mt-1 items-center">
                <input data-testid={`recontract-product-code-${i}`} placeholder="Code" className="h-7 border border-gray-300 rounded px-1.5 text-[11px] font-mono" value={p.productCode} onChange={(e) => setProducts((prev) => prev.map((x, idx) => idx === i ? { ...x, productCode: e.target.value } : x))} />
                <input data-testid={`recontract-product-provider-${i}`} placeholder="Provider ref" className="h-7 border border-gray-300 rounded px-1.5 text-[11px] font-mono" value={p.providerRef} onChange={(e) => setProducts((prev) => prev.map((x, idx) => idx === i ? { ...x, providerRef: e.target.value } : x))} />
                <input data-testid={`recontract-product-price-${i}`} placeholder="Customer price" className="h-7 border border-gray-300 rounded px-1.5 text-[11px] font-mono" value={p.customerPriceAmount} onChange={(e) => setProducts((prev) => prev.map((x, idx) => idx === i ? { ...x, customerPriceAmount: e.target.value } : x))} />
                <input data-testid={`recontract-product-cost-${i}`} placeholder="Provider cost" className="h-7 border border-gray-300 rounded px-1.5 text-[11px] font-mono" value={p.providerCostAmount} onChange={(e) => setProducts((prev) => prev.map((x, idx) => idx === i ? { ...x, providerCostAmount: e.target.value } : x))} />
                <button type="button" data-testid={`recontract-remove-product-${i}`} className="text-red-500 hover:text-red-700 justify-self-start" onClick={() => setProducts((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>

          {mutation.isError && (
            <div className="text-xs text-red-600 flex flex-col gap-1" data-testid="recontract-error">
              <div className="flex items-center gap-1"><AlertCircle size={13} /> {(mutation.error as any)?.message ?? 'Failed to recontract.'}</div>
              {fieldErrors && Object.entries(fieldErrors).map(([f, m]) => <div key={f} className="pl-4">{f}: {String(m)}</div>)}
            </div>
          )}
          {mutation.isSuccess && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2" data-testid="recontract-success">
              Mode chosen by the API: <strong>{mutation.data.mode}</strong>. Lineage: v{mutation.data.fromRecapVersion} → v{mutation.data.toRecapVersion}
              {mutation.data.mode === 'DELTA' ? `, delta posting record ${mutation.data.deltaPostingRecordId}` : `, reversal ${mutation.data.reversalPostingRecordId} + repost ${mutation.data.repostPostingRecordId}`}.
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Close</button>
          <button
            data-testid="recontract-submit-button"
            className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
            disabled={!canSubmit || mutation.isPending || mutation.isSuccess}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Submitting…' : 'Submit recontract'}
          </button>
        </div>
      </div>
    </div>
  );
}

const TABS = ['journal', 'lineage', 'cit', 'reserve', 'products', 'payoff', 'duebills', 'audit'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { journal: 'Journal Chain', lineage: 'Lineage', cit: 'CIT', reserve: 'Reserve', products: 'Products', payoff: 'Payoff', duebills: 'Due Bills', audit: 'Audit' };

export default function DealAccountingDetail() {
  const { dealNumber = '' } = useParams<{ dealNumber: string }>();
  const [tab, setTab] = useState<Tab>('journal');
  const [unwindOpen, setUnwindOpen] = useState(false);
  const [recontractOpen, setRecontractOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ce12-deal-detail', dealNumber],
    queryFn: () => ce12DealApi.getDeal(dealNumber),
    enabled: !!dealNumber,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen"><Loader2 size={24} className="animate-spin text-brand" /></div>;
  }
  if (error) {
    const status = (error as any)?.status;
    return (
      <div className="p-6" data-testid="deal-detail-error">
        {status === 403 ? (
          <div className="text-red-700 text-sm flex items-center gap-2"><AlertCircle size={16} /> You do not have permission to view this deal.</div>
        ) : status === 404 ? (
          <div className="text-gray-500 text-sm" data-testid="deal-detail-not-found">Deal "{dealNumber}" was not found.</div>
        ) : (
          <div className="text-red-700 text-sm flex items-center gap-2">
            <AlertCircle size={16} /> {(error as Error).message}
            <button className="ml-2 text-brand hover:underline" onClick={() => refetch()}>Retry</button>
          </div>
        )}
      </div>
    );
  }
  if (!data) return null;

  const { deal, recaps, postingRecords, openItems } = data;
  const latestRecap = recaps[recaps.length - 1];

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">
      <div className="bg-white border-b border-gray-200 px-4 pt-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-900">{deal.dealNumber}</h1>
            <Badge status={deal.status} map={DEAL_STATUS_BADGE} />
            <span className="text-xs text-gray-500">{deal.dealType.replace('_', ' ')} · v{deal.currentRecapVersion}{deal.fundedFlag ? ' · funded' : ''}</span>
          </div>
          {deal.status !== 'UNWOUND' && (
            <div className="flex items-center gap-2">
              <button
                data-testid="unwind-deal-button"
                className="h-8 px-3 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50"
                onClick={() => setUnwindOpen(true)}
              >
                Unwind
              </button>
              {latestRecap && (
                <button
                  data-testid="recontract-deal-button"
                  className="h-8 px-3 text-xs bg-brand text-white rounded hover:bg-brand-hover"
                  onClick={() => setRecontractOpen(true)}
                >
                  Recontract
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-4">
          {TABS.map((t) => (
            <button
              key={t}
              data-testid={`deal-detail-tab-${t}`}
              className={`pb-2 text-xs font-medium border-b-2 ${tab === t ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'journal' && <JournalChainTab dealNumber={deal.dealNumber} postingRecords={postingRecords} />}
        {tab === 'lineage' && <LineageTab dealNumber={deal.dealNumber} />}
        {tab === 'cit' && <CitTab dealNumber={deal.dealNumber} items={openItems} />}
        {tab === 'reserve' && <ReserveTab items={openItems} />}
        {tab === 'products' && <ProductsTab items={openItems} recapProducts={(latestRecap?.payload as any)?.products ?? []} />}
        {tab === 'payoff' && <PayoffTab dealNumber={deal.dealNumber} items={openItems} />}
        {tab === 'duebills' && <DueBillsTab dealNumber={deal.dealNumber} />}
        {tab === 'audit' && <AuditTab docId={deal.id} />}
      </div>

      {unwindOpen && <UnwindModal dealNumber={deal.dealNumber} currentRecapVersion={deal.currentRecapVersion} onClose={() => setUnwindOpen(false)} />}
      {recontractOpen && latestRecap && (
        <RecontractModal dealNumber={deal.dealNumber} fromPayload={latestRecap.payload} toVersion={deal.currentRecapVersion + 1} onClose={() => setRecontractOpen(false)} />
      )}
    </div>
  );
}
