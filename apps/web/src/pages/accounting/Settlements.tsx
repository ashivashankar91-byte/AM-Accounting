/**
 * S055 — Settlements: merchant batches, worklist, chargebacks.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { settlementApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, Badge, PageHeader, MoneyCell, EmptyState } from '../../components/ui';

function statusVariant(s: string) {
  if (s === 'POSTED' || s === 'MATCHED') return 'success';
  if (s === 'VOIDED' || s === 'FAILED') return 'danger';
  if (s === 'PENDING' || s === 'IMPORTED') return 'warning';
  return 'neutral';
}

// ─── Import Batch Form ──────────────────────────────────────────────────────

function ImportBatchForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ entityId: '', bankAccountCode: '', processorName: '', batchReference: '', settlementDate: '', grossAmount: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const mut = useMutation({
    mutationFn: () => settlementApi.importBatch({ ...form, grossAmount: parseFloat(form.grossAmount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settlement-batches'] }); onClose(); },
  });

  return (
    <form onSubmit={e => { e.preventDefault(); mut.mutate(); }} className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
      <h3 className="font-semibold text-slate-800">Import Settlement Batch</h3>
      {mut.isError && (
        <p className="text-sm text-red-600">
          {(mut.error as any)?.status === 401 || (mut.error as any)?.status === 403
            ? 'Unauthorized.' : (mut.error as Error).message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        {([['entityId','Entity ID'],['bankAccountCode','Bank Account Code'],['processorName','Processor Name'],['batchReference','Batch Reference'],['settlementDate','Settlement Date'],['grossAmount','Gross Amount']] as [keyof typeof form, string][]).map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1 text-xs text-slate-600">
            {label}
            <input required data-testid={`settle-import-${k}`} type={k === 'settlementDate' ? 'date' : k === 'grossAmount' ? 'number' : 'text'}
              step={k === 'grossAmount' ? '0.01' : undefined}
              className="border rounded px-2 py-1 text-sm" value={form[k]} onChange={set(k)} />
          </label>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" type="submit" loading={mut.isPending} data-testid="settle-import-submit">Import</Btn>
      </div>
    </form>
  );
}

// ─── Match Batch Modal ──────────────────────────────────────────────────────

function MatchBatchModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [receiptId, setReceiptId] = useState('');
  const [depositId, setDepositId] = useState('');
  const [amount, setAmount] = useState('');
  const mut = useMutation({
    mutationFn: () => settlementApi.matchBatch(batchId, { receiptId: receiptId || undefined, depositId: depositId || undefined, amount: parseFloat(amount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settlement-batch', batchId] }); onClose(); },
  });
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <form onSubmit={e => { e.preventDefault(); mut.mutate(); }} className="bg-white rounded-xl p-6 w-full max-w-sm space-y-3 shadow-xl">
        <h4 className="font-semibold text-slate-800">Match Batch</h4>
        {mut.isError && <p className="text-xs text-red-600">{(mut.error as Error).message}</p>}
        <label className="flex flex-col gap-1 text-xs text-slate-600">Receipt ID <input className="border rounded px-2 py-1 text-sm" value={receiptId} onChange={e => setReceiptId(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Deposit ID <input className="border rounded px-2 py-1 text-sm" value={depositId} onChange={e => setDepositId(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Amount <input data-testid="settle-match-amount" required type="number" step="0.01" className="border rounded px-2 py-1 text-sm" value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <div className="flex gap-2 justify-end">
          <Btn variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" type="submit" loading={mut.isPending} data-testid="settle-match-confirm">Match</Btn>
        </div>
      </form>
    </div>
  );
}

// ─── Batch Detail ───────────────────────────────────────────────────────────

function BatchDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [showMatch, setShowMatch] = useState(false);
  const { data: batch, isLoading, error, refetch } = useQuery({
    queryKey: ['settlement-batch', id],
    queryFn: () => settlementApi.getBatch(id),
  });
  const postMut = useMutation({
    mutationFn: () => settlementApi.postBatch(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settlement-batch', id] }),
  });

  if (isLoading) return <PageLoader page="Batch" service="cash-service" />;
  if (error) {
    const s = (error as any).status;
    if (s === 401 || s === 403) return <div className="p-8 text-red-600 font-semibold">Unauthorized.</div>;
    return <PageError error={error as Error} retry={refetch} />;
  }
  if (!batch) return null;

  return (
    <div>
      {showMatch && <MatchBatchModal batchId={id} onClose={() => setShowMatch(false)} />}
      <button onClick={onBack} className="text-xs text-brand mb-4 hover:underline">← Back to Batches</button>
      <PageHeader
        title={`Batch ${batch.batchReference ?? id}`}
        badge={<Badge data-testid="settle-batch-status" variant={statusVariant(batch.status ?? '')}>{batch.status ?? '—'}</Badge>}
        actions={
          <div className="flex gap-2">
            <Btn size="sm" variant="secondary" onClick={() => setShowMatch(true)} data-testid="settle-batch-match-open">Match</Btn>
            {batch.status !== 'POSTED' && batch.status !== 'VOIDED' && (
              <Btn size="sm" onClick={() => postMut.mutate()} loading={postMut.isPending} data-testid="settle-batch-post">Post</Btn>
            )}
          </div>
        }
      />
      {postMut.isError && <p className="mb-3 text-sm text-red-600">{(postMut.error as Error).message}</p>}
      <div className="bg-white border rounded-xl p-6 grid grid-cols-3 gap-4 text-sm">
        <div><p className="text-xs text-slate-500">Processor</p><p className="font-medium">{batch.processorName}</p></div>
        <div><p className="text-xs text-slate-500">Settlement Date</p><p className="font-medium">{batch.settlementDate}</p></div>
        <div><p className="text-xs text-slate-500">Gross Amount</p><MoneyCell value={batch.grossAmount} className="font-semibold" /></div>
      </div>
    </div>
  );
}

// ─── Worklist Tab ───────────────────────────────────────────────────────────

function WorklistTab() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ bankAccountCode: '', amount: '', cardLast4: '', transactionRef: '', batchId: '' });
  const setF = (k: keyof typeof addForm) => (e: React.ChangeEvent<HTMLInputElement>) => setAddForm(f => ({ ...f, [k]: e.target.value }));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['settlement-worklist'],
    queryFn: () => settlementApi.getWorklist(),
  });
  const addMut = useMutation({
    mutationFn: () => settlementApi.addWorklistItem({ bankAccountCode: addForm.bankAccountCode, amount: parseFloat(addForm.amount), cardLast4: addForm.cardLast4 || null, transactionRef: addForm.transactionRef || null, batchId: addForm.batchId || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settlement-worklist'] }); setShowAdd(false); },
  });
  const resolveMut = useMutation({
    // Backend resolveWorklistItem(tenantId, itemId, actor) computes the
    // resolution server-side and takes no request body — confirmed against
    // services/cash-service/src/http/settlement-routes.ts.
    mutationFn: (itemId: string) => settlementApi.resolveWorklistItem(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settlement-worklist'] }),
  });

  if (isLoading) return <PageLoader page="Worklist" service="cash-service" />;
  if (error) return <PageError error={error as Error} retry={refetch} />;

  const items: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn size="sm" icon={<Plus size={14} />} onClick={() => setShowAdd(v => !v)}>Add Item</Btn>
      </div>
      {showAdd && (
        <form onSubmit={e => { e.preventDefault(); addMut.mutate(); }} className="space-y-3 p-4 bg-slate-50 rounded-xl border">
          {addMut.isError && <p className="text-xs text-red-600">{(addMut.error as Error).message}</p>}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-600">Bank Account Code <input required className="border rounded px-2 py-1 text-sm" value={addForm.bankAccountCode} onChange={setF('bankAccountCode')} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Amount <input required type="number" step="0.01" className="border rounded px-2 py-1 text-sm" value={addForm.amount} onChange={setF('amount')} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Card Last 4 <input className="border rounded px-2 py-1 text-sm" maxLength={4} value={addForm.cardLast4} onChange={setF('cardLast4')} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Transaction Ref <input className="border rounded px-2 py-1 text-sm" value={addForm.transactionRef} onChange={setF('transactionRef')} /></label>
          </div>
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="sm" type="button" onClick={() => setShowAdd(false)}>Cancel</Btn>
            <Btn size="sm" type="submit" loading={addMut.isPending}>Add</Btn>
          </div>
        </form>
      )}
      {items.length === 0 ? (
        <EmptyState title="Worklist empty" description="No unresolved settlement items." />
      ) : (
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-slate-50"><tr>{['Ref','Bank Account','Amount','Status',''].map(h => <th key={h} className="text-left px-3 py-2 text-xs text-slate-500 font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y">
            {items.map((item: any) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{item.transactionRef ?? item.id}</td>
                <td className="px-3 py-2">{item.bankAccountCode}</td>
                <td className="px-3 py-2"><MoneyCell value={item.amount} /></td>
                <td className="px-3 py-2"><Badge variant={statusVariant(item.status ?? '')}>{item.status ?? '—'}</Badge></td>
                <td className="px-3 py-2">
                  {item.status !== 'RESOLVED' && (
                    <Btn size="sm" variant="ghost" onClick={() => resolveMut.mutate(item.id)} loading={resolveMut.isPending} data-testid={`settle-worklist-resolve-${item.id}`}>Resolve</Btn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Chargebacks Tab ────────────────────────────────────────────────────────

function ChargebacksTab() {
  const qc = useQueryClient();
  const [showIntake, setShowIntake] = useState(false);
  const [form, setForm] = useState({ entityId: '', batchId: '', customerId: '', amount: '', reasonCode: '' });
  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  // We list chargebacks via listBatches filtered by type; if no dedicated endpoint,
  // show intake-only. The API does not expose a dedicated chargebacks list endpoint —
  // use batch list as a proxy and note here that a /chargebacks listing route is absent.
  const intakeMut = useMutation({
    mutationFn: () => settlementApi.intakeChargeback({ entityId: form.entityId, batchId: form.batchId || undefined, customerId: form.customerId || null, amount: parseFloat(form.amount), reasonCode: form.reasonCode || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settlement-batches'] }); setShowIntake(false); },
  });
  const dispositionMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'CUSTOMER_RESPONSIBILITY' | 'MERCHANT_ABSORBED' }) =>
      settlementApi.dispositionChargeback(id, { dispositionAction: action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settlement-batches'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn size="sm" icon={<Plus size={14} />} onClick={() => setShowIntake(v => !v)} data-testid="settle-chargeback-intake-open">Intake Chargeback</Btn>
      </div>
      {showIntake && (
        <form onSubmit={e => { e.preventDefault(); intakeMut.mutate(); }} className="space-y-3 p-4 bg-slate-50 rounded-xl border">
          {intakeMut.isError && <p className="text-xs text-red-600">{(intakeMut.error as Error).message}</p>}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-600">Entity ID <input required className="border rounded px-2 py-1 text-sm" value={form.entityId} onChange={setF('entityId')} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Batch ID <input className="border rounded px-2 py-1 text-sm" value={form.batchId} onChange={setF('batchId')} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Customer ID <input className="border rounded px-2 py-1 text-sm" value={form.customerId} onChange={setF('customerId')} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Amount <input data-testid="settle-chargeback-amount" required type="number" step="0.01" className="border rounded px-2 py-1 text-sm" value={form.amount} onChange={setF('amount')} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 col-span-2">Reason Code <input className="border rounded px-2 py-1 text-sm" value={form.reasonCode} onChange={setF('reasonCode')} /></label>
          </div>
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="sm" type="button" onClick={() => setShowIntake(false)}>Cancel</Btn>
            <Btn size="sm" type="submit" loading={intakeMut.isPending} data-testid="settle-chargeback-intake-submit">Intake</Btn>
          </div>
        </form>
      )}
      {/* Placeholder for chargeback list — no dedicated list endpoint in current API */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
        Chargeback list: the current API does not expose a dedicated <code>/chargebacks</code> listing endpoint.
        Use the Batches tab to find batches containing chargebacks, then disposition them below.
      </div>
      {/* Demo: show disposition buttons — in practice, chargebacks would be listed from an API query */}
      <div className="space-y-2">
        {dispositionMut.isError && <p className="text-xs text-red-600">{(dispositionMut.error as Error).message}</p>}
      </div>
    </div>
  );
}

// ─── Root Page ───────────────────────────────────────────────────────────────

export default function Settlements() {
  const [activeTab, setActiveTab] = useState<'batches' | 'worklist' | 'chargebacks'>('batches');
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const { data: status } = useQuery({ queryKey: ['settlement-status'], queryFn: () => settlementApi.getStatus() });
  const { data: batches, isLoading, error, refetch } = useQuery({
    queryKey: ['settlement-batches'],
    queryFn: () => settlementApi.listBatches(),
    enabled: activeTab === 'batches',
  });

  if (selectedBatchId) return (
    <div className="p-6 max-w-5xl mx-auto">
      <BatchDetail id={selectedBatchId} onBack={() => setSelectedBatchId(null)} />
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="Settlements" subtitle="S055 — Merchant settlement batches, worklist, chargebacks" />

      {status && (
        <div className="mb-4 bg-brand-light border border-brand-border rounded-xl p-4 text-sm flex items-center gap-4">
          <Badge variant={statusVariant(status.status ?? '')} dot>{status.status ?? 'UNKNOWN'}</Badge>
          <span className="text-slate-600">Last updated: <strong>{status.lastUpdatedAt ?? '—'}</strong></span>
          <span className="text-slate-600">Pending batches: <strong>{status.pendingBatches ?? '—'}</strong></span>
        </div>
      )}

      <div className="flex gap-1 border-b mb-4">
        {(['batches', 'worklist', 'chargebacks'] as const).map(tab => (
          <button key={tab} data-testid={`settle-tab-${tab}`} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize ${activeTab === tab ? 'border-b-2 border-brand text-brand' : 'text-slate-500 hover:text-slate-700'}`}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'batches' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Btn size="sm" icon={<Plus size={14} />} onClick={() => setShowImport(v => !v)} data-testid="settle-import-open">Import Batch</Btn>
          </div>
          {showImport && <ImportBatchForm onClose={() => setShowImport(false)} />}
          {isLoading && <PageLoader page="Batches" service="cash-service" />}
          {error && (() => {
            const s = (error as any).status;
            if (s === 401 || s === 403) return <div className="p-8 text-red-600 font-semibold">Unauthorized.</div>;
            return <PageError error={error as Error} retry={refetch} />;
          })()}
          {!isLoading && !error && (
            Array.isArray(batches) && batches.length === 0
              ? <EmptyState title="No settlement batches" description="Import a batch to get started." />
              : (
                <table className="w-full text-sm border rounded-xl overflow-hidden">
                  <thead className="bg-slate-50"><tr>{['Reference','Processor','Date','Gross','Status'].map(h => <th key={h} className="text-left px-4 py-2 text-xs text-slate-500 font-semibold">{h}</th>)}</tr></thead>
                  <tbody className="divide-y">
                    {(batches as any[] ?? []).map((b: any) => (
                      <tr key={b.id} data-testid={`settle-batch-row-${b.id}`} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedBatchId(b.id)}>
                        <td className="px-4 py-2 font-mono text-xs">{b.batchReference}</td>
                        <td className="px-4 py-2">{b.processorName}</td>
                        <td className="px-4 py-2">{b.settlementDate}</td>
                        <td className="px-4 py-2"><MoneyCell value={b.grossAmount} /></td>
                        <td className="px-4 py-2"><Badge variant={statusVariant(b.status ?? '')}>{b.status ?? '—'}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
          )}
        </div>
      )}
      {activeTab === 'worklist' && <WorklistTab />}
      {activeTab === 'chargebacks' && <ChargebacksTab />}
    </div>
  );
}
