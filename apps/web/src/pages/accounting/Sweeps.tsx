/**
 * S056 — Sweeps: pair configuration, sweep records, FP offset allocations.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { sweepApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, Badge, PageHeader, MoneyCell, EmptyState } from '../../components/ui';

function statusVariant(s: string) {
  if (s === 'POSTED') return 'success';
  if (s === 'VOIDED') return 'danger';
  if (s === 'PENDING' || s === 'RECORDED') return 'warning';
  return 'neutral';
}

// ─── Configure Pair Form ────────────────────────────────────────────────────

function ConfigurePairForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [entityId, setEntityId] = useState('');
  const [storeAccountCode, setStoreAccountCode] = useState('');
  const [operatingAccountCode, setOperatingAccountCode] = useState('');
  const mut = useMutation({
    mutationFn: () => sweepApi.configurePair({ entityId, storeAccountCode, operatingAccountCode }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sweep-pairs'] }); onClose(); },
  });
  return (
    <form onSubmit={e => { e.preventDefault(); mut.mutate(); }} className="space-y-3 p-4 bg-slate-50 rounded-xl border">
      <h4 className="font-semibold text-slate-800 text-sm">Configure Sweep Pair</h4>
      {mut.isError && <p className="text-xs text-red-600">{(mut.error as any)?.status === 401 || (mut.error as any)?.status === 403 ? 'Unauthorized.' : (mut.error as Error).message}</p>}
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">Entity ID <input required className="border rounded px-2 py-1 text-sm" value={entityId} onChange={e => setEntityId(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Store Account Code <input required className="border rounded px-2 py-1 text-sm" value={storeAccountCode} onChange={e => setStoreAccountCode(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">Operating Account Code <input required className="border rounded px-2 py-1 text-sm" value={operatingAccountCode} onChange={e => setOperatingAccountCode(e.target.value)} /></label>
      </div>
      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" type="submit" loading={mut.isPending} data-testid="sweep-pair-save">Save Pair</Btn>
      </div>
    </form>
  );
}

// ─── Record Sweep Form ──────────────────────────────────────────────────────

function RecordSweepForm({ pairs, onClose }: { pairs: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [pairConfigId, setPairConfigId] = useState('');
  const [sweepDate, setSweepDate] = useState('');
  // direction: inferred from cash-service conventions; two canonical values:
  const [direction, setDirection] = useState('STORE_TO_OPERATING');
  const [amount, setAmount] = useState('');
  const [confirmationState, setConfirmationState] = useState<'' | 'MANUAL_RECORDED' | 'FEED_CONFIRMED'>('');

  const mut = useMutation({
    mutationFn: () => sweepApi.record({
      pairConfigId, sweepDate, direction, amount, idempotencyKey: crypto.randomUUID(),
      confirmationState: confirmationState || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sweeps'] }); onClose(); },
  });

  return (
    <form onSubmit={e => { e.preventDefault(); mut.mutate(); }} className="space-y-3 p-4 bg-slate-50 rounded-xl border">
      <h4 className="font-semibold text-slate-800 text-sm">Record Sweep</h4>
      {mut.isError && <p className="text-xs text-red-600">{(mut.error as Error).message}</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Pair Config
          <select required className="border rounded px-2 py-1 text-sm" value={pairConfigId} onChange={e => setPairConfigId(e.target.value)}>
            <option value="">— select —</option>
            {pairs.map((p: any) => (
              <option key={p.id} value={p.id}>{p.storeAccountCode} → {p.operatingAccountCode}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Direction
          <select required className="border rounded px-2 py-1 text-sm" value={direction} onChange={e => setDirection(e.target.value)}>
            <option value="STORE_TO_OPERATING">STORE_TO_OPERATING</option>
            <option value="OPERATING_TO_STORE">OPERATING_TO_STORE</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Sweep Date <input required type="date" className="border rounded px-2 py-1 text-sm" value={sweepDate} onChange={e => setSweepDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Amount <input data-testid="sweep-record-amount" required type="number" step="0.01" className="border rounded px-2 py-1 text-sm" value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 col-span-2">
          Confirmation State (optional)
          <select className="border rounded px-2 py-1 text-sm" value={confirmationState} onChange={e => setConfirmationState(e.target.value as any)}>
            <option value="">— none —</option>
            <option value="MANUAL_RECORDED">MANUAL_RECORDED</option>
            <option value="FEED_CONFIRMED">FEED_CONFIRMED</option>
          </select>
        </label>
      </div>
      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" type="submit" loading={mut.isPending} data-testid="sweep-record-submit">Record</Btn>
      </div>
    </form>
  );
}

// ─── Void Sweep Modal ───────────────────────────────────────────────────────

function VoidSweepModal({ sweepId, onClose }: { sweepId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const mut = useMutation({
    mutationFn: () => sweepApi.void(sweepId, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sweep', sweepId] }); onClose(); },
  });
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <form onSubmit={e => { e.preventDefault(); mut.mutate(); }} className="bg-white rounded-xl p-6 w-full max-w-sm space-y-3 shadow-xl">
        <h4 className="font-semibold text-slate-800">Void Sweep</h4>
        {mut.isError && <p className="text-xs text-red-600">{(mut.error as Error).message}</p>}
        <label className="flex flex-col gap-1 text-xs text-slate-600">Reason <textarea required className="border rounded px-2 py-1 text-sm w-full" rows={3} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="flex gap-2 justify-end">
          <Btn variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" size="sm" type="submit" loading={mut.isPending} data-testid="sweep-void-confirm">Void</Btn>
        </div>
      </form>
    </div>
  );
}

// ─── Sweep Detail ───────────────────────────────────────────────────────────

function SweepDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [showVoid, setShowVoid] = useState(false);
  const { data: sweep, isLoading, error, refetch } = useQuery({
    queryKey: ['sweep', id],
    queryFn: () => sweepApi.getById(id),
  });
  const postMut = useMutation({
    mutationFn: () => sweepApi.post(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sweep', id] }),
  });

  if (isLoading) return <PageLoader page="Sweep" service="cash-service" />;
  if (error) {
    const s = (error as any).status;
    if (s === 401 || s === 403) return <div className="p-8 text-red-600 font-semibold">Unauthorized.</div>;
    return <PageError error={error as Error} retry={refetch} />;
  }
  if (!sweep) return null;

  return (
    <div>
      {showVoid && <VoidSweepModal sweepId={id} onClose={() => setShowVoid(false)} />}
      <button onClick={onBack} className="text-xs text-brand mb-4 hover:underline">← Back to Sweeps</button>
      <PageHeader
        title={`Sweep ${sweep.id}`}
        badge={<Badge data-testid="sweep-status" variant={statusVariant(sweep.status ?? '')}>{sweep.status ?? '—'}</Badge>}
        actions={
          <div className="flex gap-2">
            {sweep.status !== 'POSTED' && sweep.status !== 'VOIDED' && (
              <Btn size="sm" onClick={() => postMut.mutate()} loading={postMut.isPending} data-testid="sweep-post">Post</Btn>
            )}
            {sweep.status !== 'VOIDED' && sweep.status !== 'POSTED' && (
              <Btn size="sm" variant="danger" onClick={() => setShowVoid(true)} data-testid="sweep-void-open">Void</Btn>
            )}
          </div>
        }
      />
      {postMut.isError && <p className="mb-3 text-sm text-red-600">{(postMut.error as Error).message}</p>}
      <div className="bg-white border rounded-xl p-6 grid grid-cols-3 gap-4 text-sm">
        <div><p className="text-xs text-slate-500">Direction</p><p className="font-medium">{sweep.direction}</p></div>
        <div><p className="text-xs text-slate-500">Sweep Date</p><p className="font-medium">{sweep.sweepDate}</p></div>
        <div><p className="text-xs text-slate-500">Amount</p><MoneyCell value={sweep.amount} className="font-semibold" /></div>
        <div><p className="text-xs text-slate-500">Confirmation</p><p className="font-medium">{sweep.confirmationState ?? '—'}</p></div>
      </div>
    </div>
  );
}

// ─── FP Offset Allocation Detail ────────────────────────────────────────────

function FpAllocationDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { data: alloc, isLoading, error, refetch } = useQuery({
    queryKey: ['fp-allocation', id],
    queryFn: () => sweepApi.getFpOffsetAllocation(id),
  });
  const postMut = useMutation({
    mutationFn: () => sweepApi.postFpOffsetAllocation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fp-allocation', id] }),
  });

  if (isLoading) return <PageLoader page="Allocation" service="cash-service" />;
  if (error) {
    const s = (error as any).status;
    if (s === 401 || s === 403) return <div className="p-8 text-red-600 font-semibold">Unauthorized.</div>;
    return <PageError error={error as Error} retry={refetch} />;
  }
  if (!alloc) return null;

  return (
    <div>
      <button onClick={onBack} className="text-xs text-brand mb-4 hover:underline">← Back to Allocations</button>
      <PageHeader
        title={`FP Allocation — ${alloc.lenderName}`}
        badge={<Badge variant={statusVariant(alloc.status ?? '')}>{alloc.status ?? '—'}</Badge>}
        actions={alloc.status !== 'POSTED' && (
          <Btn size="sm" onClick={() => postMut.mutate()} loading={postMut.isPending}>Post</Btn>
        )}
      />
      {postMut.isError && <p className="mb-3 text-sm text-red-600">{(postMut.error as Error).message}</p>}
      <div className="bg-white border rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-xs text-slate-500">Statement Date</p><p className="font-medium">{alloc.statementDate}</p></div>
          <div><p className="text-xs text-slate-500">Statement Amount</p><MoneyCell value={alloc.statementAmount} className="font-semibold" /></div>
        </div>
        {Array.isArray(alloc.lines) && (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-xs text-slate-500"><th className="text-left pb-1">Unit Ref</th><th className="text-right pb-1">Amount</th></tr></thead>
            <tbody>
              {alloc.lines.map((l: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1">{l.floorplanUnitRef}</td>
                  <td className="py-1 text-right"><MoneyCell value={l.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── FP Offset Allocations Tab ──────────────────────────────────────────────

interface FpLine { floorplanUnitRef: string; amount: string; }

function FpAllocationsTab() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ entityId: '', lenderName: '', statementDate: '', statementAmount: '' });
  const [lines, setLines] = useState<FpLine[]>([{ floorplanUnitRef: '', amount: '' }]);
  const setF = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const addLine = () => setLines(l => [...l, { floorplanUnitRef: '', amount: '' }]);
  const removeLine = (i: number) => setLines(l => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, k: keyof FpLine, v: string) =>
    setLines(l => l.map((line, idx) => idx === i ? { ...line, [k]: v } : line));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fp-allocations'],
    queryFn: () => sweepApi.listFpOffsetAllocations(),
  });
  const createMut = useMutation({
    mutationFn: () => sweepApi.createFpOffsetAllocation({
      entityId: form.entityId, lenderName: form.lenderName, statementDate: form.statementDate,
      statementAmount: parseFloat(form.statementAmount),
      lines: lines.map(l => ({ floorplanUnitRef: l.floorplanUnitRef, amount: parseFloat(l.amount) })),
      idempotencyKey: crypto.randomUUID(),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fp-allocations'] }); setShowCreate(false); },
  });

  if (selectedId) return <FpAllocationDetail id={selectedId} onBack={() => setSelectedId(null)} />;
  if (isLoading) return <PageLoader page="Allocations" service="cash-service" />;
  if (error) return <PageError error={error as Error} retry={refetch} />;

  const allocs: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Btn size="sm" icon={<Plus size={14} />} onClick={() => setShowCreate(v => !v)}>New Allocation</Btn>
      </div>
      {showCreate && (
        <form onSubmit={e => { e.preventDefault(); createMut.mutate(); }} className="space-y-3 p-4 bg-slate-50 rounded-xl border">
          <h4 className="font-semibold text-slate-800 text-sm">New FP Offset Allocation</h4>
          {createMut.isError && <p className="text-xs text-red-600">{(createMut.error as Error).message}</p>}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-600">Entity ID <input required className="border rounded px-2 py-1 text-sm" value={form.entityId} onChange={setF('entityId')} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Lender Name <input required className="border rounded px-2 py-1 text-sm" value={form.lenderName} onChange={setF('lenderName')} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Statement Date <input required type="date" className="border rounded px-2 py-1 text-sm" value={form.statementDate} onChange={setF('statementDate')} /></label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">Statement Amount <input required type="number" step="0.01" className="border rounded px-2 py-1 text-sm" value={form.statementAmount} onChange={setF('statementAmount')} /></label>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-600 mb-1">Allocation Lines</p>
            {lines.map((line, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <input required placeholder="Floorplan Unit Ref" className="border rounded px-2 py-1 text-sm flex-1" value={line.floorplanUnitRef} onChange={e => updateLine(i, 'floorplanUnitRef', e.target.value)} />
                <input required type="number" step="0.01" placeholder="Amount" className="border rounded px-2 py-1 text-sm w-28" value={line.amount} onChange={e => updateLine(i, 'amount', e.target.value)} />
                {lines.length > 1 && <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button>}
              </div>
            ))}
            <Btn size="sm" variant="ghost" type="button" onClick={addLine} icon={<Plus size={12} />}>Add Line</Btn>
          </div>
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="sm" type="button" onClick={() => setShowCreate(false)}>Cancel</Btn>
            <Btn size="sm" type="submit" loading={createMut.isPending}>Create</Btn>
          </div>
        </form>
      )}
      {allocs.length === 0 ? (
        <EmptyState title="No FP offset allocations" description="Create one to get started." />
      ) : (
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-slate-50"><tr>{['Lender','Statement Date','Amount','Status'].map(h => <th key={h} className="text-left px-4 py-2 text-xs text-slate-500 font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y">
            {allocs.map((a: any) => (
              <tr key={a.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedId(a.id)}>
                <td className="px-4 py-2">{a.lenderName}</td>
                <td className="px-4 py-2">{a.statementDate}</td>
                <td className="px-4 py-2"><MoneyCell value={a.statementAmount} /></td>
                <td className="px-4 py-2"><Badge variant={statusVariant(a.status ?? '')}>{a.status ?? '—'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Root Page ───────────────────────────────────────────────────────────────

export default function Sweeps() {
  const [activeTab, setActiveTab] = useState<'pairs' | 'sweeps' | 'fpAllocations'>('sweeps');
  const [selectedSweepId, setSelectedSweepId] = useState<string | null>(null);
  const [showConfigurePair, setShowConfigurePair] = useState(false);
  const [showRecordSweep, setShowRecordSweep] = useState(false);

  const { data: pairs, isLoading: pairsLoading, error: pairsError, refetch: refetchPairs } = useQuery({
    queryKey: ['sweep-pairs'],
    queryFn: () => sweepApi.listPairs(),
  });
  const { data: sweeps, isLoading: sweepsLoading, error: sweepsError, refetch: refetchSweeps } = useQuery({
    queryKey: ['sweeps'],
    queryFn: () => sweepApi.list(),
    enabled: activeTab === 'sweeps',
  });

  if (selectedSweepId) return (
    <div className="p-6 max-w-5xl mx-auto">
      <SweepDetail id={selectedSweepId} onBack={() => setSelectedSweepId(null)} />
    </div>
  );

  const pairsList: any[] = Array.isArray(pairs) ? pairs : [];
  const sweepsList: any[] = Array.isArray(sweeps) ? sweeps : [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader title="Sweeps" subtitle="S056 — Sweep pairs, records, and FP offset allocations" />

      <div className="flex gap-1 border-b mb-4">
        {([['sweeps','Sweeps'],['pairs','Pair Configs'],['fpAllocations','FP Offset Allocations']] as const).map(([tab, label]) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium ${activeTab === tab ? 'border-b-2 border-brand text-brand' : 'text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'pairs' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Btn size="sm" icon={<Plus size={14} />} onClick={() => setShowConfigurePair(v => !v)}>Configure Pair</Btn>
          </div>
          {showConfigurePair && <ConfigurePairForm onClose={() => setShowConfigurePair(false)} />}
          {pairsLoading && <PageLoader page="Pairs" service="cash-service" />}
          {pairsError && (() => {
            const s = (pairsError as any).status;
            if (s === 401 || s === 403) return <div className="p-8 text-red-600 font-semibold">Unauthorized.</div>;
            return <PageError error={pairsError as Error} retry={refetchPairs} />;
          })()}
          {!pairsLoading && !pairsError && (
            pairsList.length === 0 ? <EmptyState title="No sweep pairs configured" description="Configure a pair to enable sweeps." /> : (
              <table className="w-full text-sm border rounded-xl overflow-hidden">
                <thead className="bg-slate-50"><tr>{['Store Account','Operating Account','Entity'].map(h => <th key={h} className="text-left px-4 py-2 text-xs text-slate-500 font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {pairsList.map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs">{p.storeAccountCode}</td>
                      <td className="px-4 py-2 font-mono text-xs">{p.operatingAccountCode}</td>
                      <td className="px-4 py-2 text-xs">{p.entityId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      )}

      {activeTab === 'sweeps' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Btn size="sm" icon={<Plus size={14} />} onClick={() => setShowRecordSweep(v => !v)} disabled={pairsList.length === 0}>Record Sweep</Btn>
          </div>
          {showRecordSweep && <RecordSweepForm pairs={pairsList} onClose={() => setShowRecordSweep(false)} />}
          {sweepsLoading && <PageLoader page="Sweeps" service="cash-service" />}
          {sweepsError && (() => {
            const s = (sweepsError as any).status;
            if (s === 401 || s === 403) return <div className="p-8 text-red-600 font-semibold">Unauthorized.</div>;
            return <PageError error={sweepsError as Error} retry={refetchSweeps} />;
          })()}
          {!sweepsLoading && !sweepsError && (
            sweepsList.length === 0 ? <EmptyState title="No sweeps recorded" description="Record a sweep to get started." /> : (
              <table className="w-full text-sm border rounded-xl overflow-hidden">
                <thead className="bg-slate-50"><tr>{['Date','Direction','Amount','Confirmation','Status'].map(h => <th key={h} className="text-left px-4 py-2 text-xs text-slate-500 font-semibold">{h}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {sweepsList.map((s: any) => (
                    <tr key={s.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedSweepId(s.id)}>
                      <td className="px-4 py-2">{s.sweepDate}</td>
                      <td className="px-4 py-2 text-xs">{s.direction}</td>
                      <td className="px-4 py-2"><MoneyCell value={s.amount} /></td>
                      <td className="px-4 py-2 text-xs">{s.confirmationState ?? '—'}</td>
                      <td className="px-4 py-2"><Badge variant={statusVariant(s.status ?? '')}>{s.status ?? '—'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      )}

      {activeTab === 'fpAllocations' && <FpAllocationsTab />}
    </div>
  );
}
