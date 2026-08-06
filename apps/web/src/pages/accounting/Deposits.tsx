/**
 * S053 — Deposits: list, create, detail/slip, post, void, bank-feed.
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Link2 } from 'lucide-react';
import { depositApi, posReceiptApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, Badge, PageHeader, MoneyCell, EmptyState, LoadingTable } from '../../components/ui';

function statusVariant(s: string) {
  if (s === 'POSTED') return 'success';
  if (s === 'VOIDED') return 'danger';
  if (s === 'PENDING') return 'warning';
  return 'neutral';
}

// ─── Create Deposit Form ────────────────────────────────────────────────────

function CreateDepositForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [entityId, setEntityId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [bankAccountCode, setBankAccountCode] = useState('');
  const [businessDate, setBusinessDate] = useState('');
  // receiptIds: we try to list unbanked receipts via posReceiptApi.searchReceipts
  // (status=POSTED, not yet in a deposit). If the API returns nothing or fails,
  // we fall back to a comma-separated manual entry.
  const { data: receiptsResult } = useQuery({
    queryKey: ['pos-receipts-unbanked'],
    queryFn: () => posReceiptApi.searchReceipts({ status: 'POSTED', limit: 100 }),
  });
  const availableReceipts: any[] = receiptsResult?.items ?? [];
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<string[]>([]);
  // Fallback: manual comma-separated receiptIds if receipt listing returned nothing
  const [manualReceiptIds, setManualReceiptIds] = useState('');
  const idempotencyKey = () => crypto.randomUUID();

  const createMut = useMutation({
    mutationFn: (key: string) =>
      depositApi.create({
        entityId, storeId, bankAccountCode, businessDate,
        receiptIds: availableReceipts.length > 0
          ? selectedReceiptIds
          : manualReceiptIds.split(',').map(s => s.trim()).filter(Boolean),
        idempotencyKey: key,
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deposits'] }); onClose(); },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMut.mutate(idempotencyKey());
  };

  const toggleReceipt = (id: string) =>
    setSelectedReceiptIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
      <h3 className="font-semibold text-slate-800">New Deposit</h3>
      {createMut.isError && (
        <p className="text-sm text-red-600">
          {(createMut.error as any)?.status === 401 || (createMut.error as any)?.status === 403
            ? 'Unauthorized — check your permissions.'
            : (createMut.error as Error).message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Entity ID <input data-testid="deposit-entity-id" required className="border rounded px-2 py-1 text-sm" value={entityId} onChange={e => setEntityId(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Store ID <input data-testid="deposit-store-id" required className="border rounded px-2 py-1 text-sm" value={storeId} onChange={e => setStoreId(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Bank Account Code <input data-testid="deposit-bank-account-code" required className="border rounded px-2 py-1 text-sm" value={bankAccountCode} onChange={e => setBankAccountCode(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Business Date <input data-testid="deposit-business-date" required type="date" className="border rounded px-2 py-1 text-sm" value={businessDate} onChange={e => setBusinessDate(e.target.value)} />
        </label>
      </div>
      {availableReceipts.length > 0 ? (
        <div>
          <p className="text-xs text-slate-600 mb-1 font-medium">Select Receipts (unbanked)</p>
          <div className="max-h-40 overflow-y-auto border rounded bg-white divide-y">
            {availableReceipts.map((r: any) => (
              <label key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={selectedReceiptIds.includes(r.id)} onChange={() => toggleReceipt(r.id)} />
                <span className="font-mono text-xs">{r.receiptNumber ?? r.id}</span>
                <MoneyCell value={r.totalAmount} className="ml-auto text-xs" />
              </label>
            ))}
          </div>
        </div>
      ) : (
        /* Fallback: manual receipt ID entry when posReceiptApi returns no results */
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Receipt IDs (comma-separated)
          <input data-testid="deposit-manual-receipt-ids" className="border rounded px-2 py-1 text-sm" placeholder="uuid1, uuid2, ..." value={manualReceiptIds} onChange={e => setManualReceiptIds(e.target.value)} />
        </label>
      )}
      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" type="submit" loading={createMut.isPending} data-testid="deposit-create-submit">Create Deposit</Btn>
      </div>
    </form>
  );
}

// ─── Manual Feed Line Form ──────────────────────────────────────────────────

function AddFeedLineForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [bankAccountCode, setBankAccountCode] = useState('');
  const [externalId, setExternalId] = useState('');
  const [amount, setAmount] = useState('');
  const [valueDate, setValueDate] = useState('');
  const [description, setDescription] = useState('');

  const mut = useMutation({
    mutationFn: () => depositApi.addManualFeedLine({ bankAccountCode, externalId: externalId || null, amount, valueDate, description: description || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-feed-lines'] }); onClose(); },
  });

  return (
    <form onSubmit={e => { e.preventDefault(); mut.mutate(); }} className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
      <h4 className="font-semibold text-slate-800 text-sm">Add Manual Feed Line</h4>
      {mut.isError && <p className="text-xs text-red-600">{(mut.error as Error).message}</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Bank Account Code <input required className="border rounded px-2 py-1 text-sm" value={bankAccountCode} onChange={e => setBankAccountCode(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          External ID <input className="border rounded px-2 py-1 text-sm" value={externalId} onChange={e => setExternalId(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Amount <input required type="number" step="0.01" className="border rounded px-2 py-1 text-sm" value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Value Date <input required type="date" className="border rounded px-2 py-1 text-sm" value={valueDate} onChange={e => setValueDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 col-span-2">
          Description <input className="border rounded px-2 py-1 text-sm" value={description} onChange={e => setDescription(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" type="submit" loading={mut.isPending}>Add Line</Btn>
      </div>
    </form>
  );
}

// ─── Match Feed Line Modal ──────────────────────────────────────────────────

function MatchFeedLineModal({ feedLineId, onClose }: { feedLineId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [depositId, setDepositId] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const mut = useMutation({
    mutationFn: () => depositApi.matchFeedLine(feedLineId, {
      depositId: depositId || undefined,
      receiptId: receiptId || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-feed-lines'] }); onClose(); },
  });
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <form onSubmit={e => { e.preventDefault(); mut.mutate(); }} className="bg-white rounded-xl p-6 w-full max-w-sm space-y-3 shadow-xl">
        <h4 className="font-semibold text-slate-800">Match Feed Line</h4>
        {mut.isError && <p className="text-xs text-red-600">{(mut.error as Error).message}</p>}
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Deposit ID <input data-testid="deposit-feed-match-deposit-id" className="border rounded px-2 py-1 text-sm" value={depositId} onChange={e => setDepositId(e.target.value)} placeholder="UUID" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Receipt ID <input data-testid="deposit-feed-match-receipt-id" className="border rounded px-2 py-1 text-sm" value={receiptId} onChange={e => setReceiptId(e.target.value)} placeholder="UUID" />
        </label>
        <p className="text-xs text-slate-400">Provide at least one of Deposit ID or Receipt ID.</p>
        <div className="flex gap-2 justify-end">
          <Btn variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" type="submit" loading={mut.isPending} data-testid="deposit-feed-match-confirm">Match</Btn>
        </div>
      </form>
    </div>
  );
}

// ─── Void Deposit Modal ─────────────────────────────────────────────────────

function VoidDepositModal({ depositId, onClose }: { depositId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const mut = useMutation({
    mutationFn: () => depositApi.void(depositId, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deposit', depositId] }); onClose(); },
  });
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <form onSubmit={e => { e.preventDefault(); mut.mutate(); }} className="bg-white rounded-xl p-6 w-full max-w-sm space-y-3 shadow-xl">
        <h4 className="font-semibold text-slate-800">Void Deposit</h4>
        {mut.isError && <p className="text-xs text-red-600">{(mut.error as Error).message}</p>}
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Reason <textarea data-testid="deposit-void-reason" required className="border rounded px-2 py-1 text-sm w-full" rows={3} value={reason} onChange={e => setReason(e.target.value)} />
        </label>
        <div className="flex gap-2 justify-end">
          <Btn variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" size="sm" type="submit" loading={mut.isPending} data-testid="deposit-void-confirm">Void</Btn>
        </div>
      </form>
    </div>
  );
}

// ─── Detail / Slip View ─────────────────────────────────────────────────────

function DepositDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'slip' | 'feed'>('slip');
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [showAddFeedLine, setShowAddFeedLine] = useState(false);
  const [matchingFeedLine, setMatchingFeedLine] = useState<string | null>(null);

  const { data: deposit, isLoading, error, refetch } = useQuery({
    queryKey: ['deposit', id],
    queryFn: () => depositApi.getById(id),
  });
  const { data: slip, isLoading: slipLoading } = useQuery({
    queryKey: ['deposit-slip', id],
    queryFn: () => depositApi.getSlip(id),
    enabled: !!deposit,
  });
  const { data: feedStatus } = useQuery({
    queryKey: ['bank-feed-status'],
    queryFn: () => depositApi.getBankFeedStatus(),
    enabled: activeTab === 'feed',
  });
  const { data: feedLines } = useQuery({
    queryKey: ['bank-feed-lines'],
    queryFn: () => depositApi.getBankFeedLines(),
    enabled: activeTab === 'feed',
  });

  const postMut = useMutation({
    mutationFn: () => depositApi.post(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deposit', id] }),
  });
  const syncMut = useMutation({
    mutationFn: () => depositApi.syncBankFeed(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-feed-lines'] }),
  });

  if (isLoading) return <PageLoader page="Deposit" service="cash-service" />;
  if (error) {
    const status = (error as any).status;
    if (status === 401 || status === 403) return <div className="p-8 text-red-600 font-semibold">Unauthorized — you do not have permission to view this deposit.</div>;
    return <PageError error={error as Error} retry={refetch} />;
  }
  if (!deposit) return null;

  return (
    <div>
      {showVoidModal && <VoidDepositModal depositId={id} onClose={() => setShowVoidModal(false)} />}
      {matchingFeedLine && <MatchFeedLineModal feedLineId={matchingFeedLine} onClose={() => setMatchingFeedLine(null)} />}

      <PageHeader
        title={`Deposit ${deposit.depositNumber ?? id}`}
        badge={<Badge data-testid="deposit-status" variant={statusVariant(deposit.status ?? '')}>{deposit.status ?? '—'}</Badge>}
        actions={
          <div className="flex gap-2">
            {deposit.status === 'PENDING' && (
              <Btn size="sm" onClick={() => postMut.mutate()} loading={postMut.isPending} data-testid="deposit-post">Post</Btn>
            )}
            {deposit.status !== 'VOIDED' && deposit.status !== 'POSTED' && (
              <Btn size="sm" variant="danger" onClick={() => setShowVoidModal(true)} data-testid="deposit-void-open">Void</Btn>
            )}
          </div>
        }
      />

      {postMut.isError && <p className="mb-3 text-sm text-red-600">{(postMut.error as Error).message}</p>}

      <div className="flex gap-1 border-b mb-4">
        {(['slip', 'feed'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize ${activeTab === tab ? 'border-b-2 border-brand text-brand' : 'text-slate-500 hover:text-slate-700'}`}>
            {tab === 'feed' ? 'Bank Feed' : 'Deposit Slip'}
          </button>
        ))}
      </div>

      {activeTab === 'slip' && (
        slipLoading ? <PageLoader page="slip" /> : slip ? (
          <div className="bg-white border rounded-xl p-6 space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><p className="text-xs text-slate-500">Business Date</p><p className="font-medium">{slip.businessDate ?? deposit.businessDate}</p></div>
              <div><p className="text-xs text-slate-500">Bank Account</p><p className="font-medium">{slip.bankAccountCode ?? deposit.bankAccountCode}</p></div>
              <div><p className="text-xs text-slate-500">Total</p><MoneyCell value={slip.totalAmount ?? deposit.totalAmount} className="font-semibold text-base" /></div>
            </div>
            {Array.isArray(slip.lines) && slip.lines.length > 0 && (
              <table className="w-full text-sm">
                <thead><tr className="border-b text-xs text-slate-500"><th className="text-left pb-1">Receipt</th><th className="text-right pb-1">Amount</th></tr></thead>
                <tbody>
                  {slip.lines.map((line: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 font-mono text-xs">{line.receiptNumber ?? line.receiptId}</td>
                      <td className="py-1 text-right"><MoneyCell value={line.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : <p className="text-sm text-slate-500">No slip data available.</p>
      )}

      {activeTab === 'feed' && (
        <div className="space-y-4">
          {feedStatus && (
            <div className="bg-slate-50 border rounded-xl p-4 text-sm">
              <p className="font-semibold text-slate-700 mb-1">Bank Feed Status</p>
              <div className="grid grid-cols-3 gap-2 text-xs text-slate-600">
                <span>Status: <strong>{feedStatus.status ?? '—'}</strong></span>
                <span>Last Sync: <strong>{feedStatus.lastSyncAt ?? '—'}</strong></span>
                <span>Pending: <strong>{feedStatus.pendingLines ?? '—'}</strong></span>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Btn size="sm" variant="secondary" icon={<RefreshCw size={13} />} onClick={() => syncMut.mutate()} loading={syncMut.isPending} data-testid="deposit-feed-sync">Sync Feed</Btn>
            <Btn size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => setShowAddFeedLine(v => !v)}>Add Manual Line</Btn>
          </div>
          {showAddFeedLine && <AddFeedLineForm onClose={() => setShowAddFeedLine(false)} />}
          {Array.isArray(feedLines) && feedLines.length === 0 && <EmptyState title="No bank feed lines" description="Sync or add a manual line to get started." />}
          {Array.isArray(feedLines) && feedLines.length > 0 && (
            <table className="w-full text-sm border rounded-xl overflow-hidden">
              <thead className="bg-slate-50"><tr>{['Date','Description','Amount','Status',''].map(h => <th key={h} className="text-left px-3 py-2 text-xs text-slate-500 font-semibold">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {feedLines.map((line: any) => (
                  <tr key={line.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">{line.valueDate}</td>
                    <td className="px-3 py-2">{line.description}</td>
                    <td className="px-3 py-2"><MoneyCell value={line.amount} /></td>
                    <td className="px-3 py-2"><Badge variant={line.matched ? 'success' : 'neutral'}>{line.matched ? 'MATCHED' : 'UNMATCHED'}</Badge></td>
                    <td className="px-3 py-2">
                      {!line.matched && (
                        <Btn size="sm" variant="ghost" icon={<Link2 size={12} />} onClick={() => setMatchingFeedLine(line.id)} data-testid={`deposit-feed-match-${line.id}`}>Match</Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── List View ──────────────────────────────────────────────────────────────

function DepositList({ onSelect }: { onSelect: (id: string) => void }) {
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const qs = [statusFilter && `status=${statusFilter}`, dateFilter && `businessDate=${dateFilter}`].filter(Boolean).join('&');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['deposits', qs],
    queryFn: () => depositApi.list(qs || undefined),
  });

  if (isLoading) return <PageLoader page="Deposits" service="cash-service" />;
  if (error) {
    const status = (error as any).status;
    if (status === 401 || status === 403) return <div className="p-8 text-red-600 font-semibold">Unauthorized.</div>;
    return <PageError error={error as Error} retry={refetch} />;
  }

  const deposits: any[] = Array.isArray(data) ? data : [];

  return (
    <div>
      <PageHeader
        title="Deposits"
        subtitle="S053 — Cash deposit creation, slip, and bank feed"
        actions={<Btn size="sm" icon={<Plus size={14} />} onClick={() => setShowCreate(v => !v)} data-testid="deposit-new-open">New Deposit</Btn>}
      />
      {showCreate && <div className="mb-4"><CreateDepositForm onClose={() => setShowCreate(false)} /></div>}
      <div className="flex gap-3 mb-4">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
          <option value="">All Statuses</option>
          {['PENDING', 'POSTED', 'VOIDED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="border rounded px-3 py-1.5 text-sm" />
      </div>
      {deposits.length === 0 ? (
        <EmptyState title="No deposits yet" description="Create a deposit to get started." />
      ) : (
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-slate-50">
            <tr>{['#','Business Date','Bank Account','Total','Status'].map(h => <th key={h} className="text-left px-4 py-2 text-xs text-slate-500 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {deposits.map((d: any) => (
              <tr key={d.id} data-testid={`deposit-row-${d.id}`} className="hover:bg-slate-50 cursor-pointer" onClick={() => onSelect(d.id)}>
                <td className="px-4 py-2 font-mono text-xs">{d.depositNumber ?? d.id}</td>
                <td className="px-4 py-2">{d.businessDate}</td>
                <td className="px-4 py-2">{d.bankAccountCode}</td>
                <td className="px-4 py-2"><MoneyCell value={d.totalAmount} /></td>
                <td className="px-4 py-2"><Badge variant={statusVariant(d.status ?? '')}>{d.status ?? '—'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Root Page ───────────────────────────────────────────────────────────────

export default function Deposits() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  if (id) return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => navigate(-1)} className="text-xs text-brand mb-4 hover:underline">← Back to Deposits</button>
      <DepositDetail id={id} />
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <DepositList onSelect={id => navigate(id)} />
    </div>
  );
}
