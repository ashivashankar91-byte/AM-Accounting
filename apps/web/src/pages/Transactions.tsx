import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { glApi, agentApi } from '../api/client';
import PageError from '../components/PageError';
import StatusBadge from '../components/StatusBadge';
import { SkeletonTable } from '../components/Skeleton';

/** Compute total debits from journal entry lines (amounts are in dollars) */
function entryTotal(entry: any): number {
  if (!entry?.lines?.length) return 0;
  return entry.lines.reduce((s: number, l: any) => s + (l.debit ?? 0), 0);
}

type Tab = 'pending' | 'posted' | 'create';

function isAgentFlagged(entryId: string, logs: any[]): boolean {
  return logs.some(
    (log: any) =>
      log.humanRequired &&
      !log.humanResolvedAt &&
      ((log.outcome && log.outcome.includes(entryId)) ||
       (log.actionTaken && log.actionTaken.includes(entryId))),
  );
}

export default function Transactions() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('pending');
  const { data: entries, isLoading, error, refetch } = useQuery({ queryKey: ['gl-entries'], queryFn: () => glApi.getEntries(), retry: false });
  const { data: agentLogs } = useQuery({ queryKey: ['agent-logs'], queryFn: agentApi.getLog, retry: false });

  const postMutation = useMutation({
    mutationFn: (id: string) => glApi.postEntry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gl-entries'] }),
  });
  const approveMutation = useMutation({
    mutationFn: (id: string) => glApi.approveEntry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gl-entries'] }),
  });
  const [postingId, setPostingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => { if (selectedIds.size === pending.length) setSelectedIds(new Set()); else setSelectedIds(new Set(pending.map((e: any) => e.id))); };
  const [bulkPosting, setBulkPosting] = useState(false);
  const bulkPost = async () => {
    setBulkPosting(true);
    for (const id of selectedIds) {
      const entry = pending.find((e: any) => e.id === id);
      try { await (entry?.status === 'PENDING_REVIEW' ? glApi.approveEntry(id) : glApi.postEntry(id)); } catch {}
    }
    setSelectedIds(new Set());
    setBulkPosting(false);
    queryClient.invalidateQueries({ queryKey: ['gl-entries'] });
  };

  const pending = (entries ?? []).filter((e: any) => e.status === 'DRAFT' || e.status === 'PENDING_REVIEW');
  const posted = (entries ?? []).filter((e: any) => e.status === 'POSTED' || e.status === 'REVERSED');

  const [form, setForm] = useState({ date: '', source: 'GJ', description: '', lines: [{ account: '', debit: '', credit: '', desc: '' }] });

  const addLine = () => setForm({ ...form, lines: [...form.lines, { account: '', debit: '', credit: '', desc: '' }] });
  const removeLine = (i: number) => setForm({ ...form, lines: form.lines.filter((_, idx) => idx !== i) });
  const updateLine = (i: number, field: string, val: string) => {
    const lines = [...form.lines];
    (lines[i] as any)[field] = val;
    setForm({ ...form, lines });
  };

  const createMut = useMutation({
    mutationFn: () => glApi.createEntry({
      entryDate: form.date,
      source: form.source,
      description: form.description,
      lines: form.lines.map(l => ({
        accountCode: l.account,
        debit: l.debit ? Number(l.debit) * 100 : 0,
        credit: l.credit ? Number(l.credit) * 100 : 0,
        description: l.desc,
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gl-entries'] });
      setForm({ date: '', source: 'GJ', description: '', lines: [{ account: '', debit: '', credit: '', desc: '' }] });
      setTab('pending');
    },
  });

  const totalDebit = form.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = form.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

  if (error) return <PageError error={error} serviceName="GL Service" port={3010} retry={refetch} />;

  return (
    <div style={{ padding: 28 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid var(--border)', marginBottom: 20 }}>
        {([['pending', `Pending (${pending.length})`], ['posted', `Posted (${posted.length})`], ['create', 'New Entry']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)} style={{
            padding: '10px 20px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
            background: 'none', borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
            color: tab === t ? 'var(--primary)' : 'var(--text-muted)', marginBottom: -2,
          }}>
            {label}
          </button>
        ))}
      </div>

      {postMutation.isError && (
        <div style={{ background: 'var(--danger-bg)', border: '1px solid #FCA5A5', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: 'var(--danger)', marginBottom: 16 }}>
          <strong>Post failed:</strong> {(postMutation.error as Error)?.message ?? 'Unknown error'}
        </div>
      )}

      {isLoading && <SkeletonTable rows={6} cols={6} />}

      {!isLoading && tab === 'pending' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Pending Transactions</span>
            {selectedIds.size > 0 && (
              <button onClick={bulkPost} disabled={bulkPosting}
                style={{ fontSize: 12, fontWeight: 600, background: '#059669', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', opacity: bulkPosting ? 0.6 : 1 }}>
                {bulkPosting ? 'Posting...' : `Approve & Post (${selectedIds.size})`}
              </button>
            )}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E5E7EB' }}>
                {['', 'Date', 'Description', 'Source', 'Type', 'Amount', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pending.map((e: any) => {
                const flagged = isAgentFlagged(e.id, agentLogs ?? []);
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid #F1F5F9' }}
                    onMouseEnter={(ev) => ev.currentTarget.style.background = '#F8FAFC'}
                    onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                    <td style={{ padding: '12px 16px' }}><input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelect(e.id)} /></td>
                    <td style={{ padding: '12px 16px', fontSize: 13 }}>{new Date(e.entryDate).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13 }}>
                      <span>{e.description}</span>
                      {e.status === 'PENDING_REVIEW' && <span style={{ marginLeft: 8 }}><StatusBadge status="PENDING_REVIEW" /></span>}
                      {flagged && (
                        <Link to="/approvals" style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, fontSize: 11, background: '#FFFBEB', color: '#92400E', fontWeight: 600, textDecoration: 'none' }}>
                          ⚠ GL Agent — Review Required
                        </Link>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{e.source}</td>
                    <td style={{ padding: '12px 16px' }}><StatusBadge status="DRAFT" /></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: '#059669' }}>${entryTotal(e).toFixed(2)}</td>
                    <td style={{ padding: '12px 16px', display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => { setPostingId(e.id); postMutation.mutate(e.id, { onSettled: () => setPostingId(null) }); }}
                        disabled={postMutation.isPending}
                        style={{ fontSize: 12, color: 'var(--success)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                      >{postingId === e.id && postMutation.isPending ? 'Posting…' : 'Post'}</button>
                      {e.status === 'PENDING_REVIEW' && (
                        <button
                          onClick={() => { setPostingId(e.id); approveMutation.mutate(e.id, { onSettled: () => setPostingId(null) }); }}
                          disabled={approveMutation.isPending}
                          style={{ fontSize: 12, color: '#7C3AED', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                        >{postingId === e.id && approveMutation.isPending ? 'Approving…' : 'Approve & Post'}</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pending.length === 0 && <tr><td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>No pending transactions</div>
              </td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && tab === 'posted' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Posted Transactions</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E5E7EB' }}>
                {['Date', 'Description', 'Source', 'Status', 'Amount', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {posted.map((e: any) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #F1F5F9' }}
                  onMouseEnter={(ev) => ev.currentTarget.style.background = '#F8FAFC'}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>{new Date(e.entryDate).toLocaleDateString()}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>{e.description}</td>
                  <td style={{ padding: '12px 16px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{e.source}</td>
                  <td style={{ padding: '12px 16px' }}><StatusBadge status={e.status} /></td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>${entryTotal(e).toFixed(2)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {e.status === 'POSTED' && <button style={{ fontSize: 12, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Reverse</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && tab === 'create' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>New Journal Entry</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full mt-1 border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Source Code</label>
              <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}
                className="w-full mt-1 border rounded px-3 py-2 text-sm">
                <option value="GJ">GJ — General Journal</option>
                <option value="CJ">CJ — Cash Journal</option>
                <option value="AJ">AJ — Adjusting Journal</option>
                <option value="RJ">RJ — Reversing Journal</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Description</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Entry description" />
            </div>
          </div>

          <h4 className="text-sm font-semibold text-gray-600 mb-2">Line Items</h4>
          <table className="w-full text-sm mb-3">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Account</th><th className="pb-2">Description</th>
              <th className="pb-2 text-right">Debit</th><th className="pb-2 text-right">Credit</th><th className="pb-2 w-8"></th>
            </tr></thead>
            <tbody>
              {form.lines.map((line, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1"><input value={line.account} onChange={e => updateLine(i, 'account', e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-32" placeholder="Acct code" /></td>
                  <td className="py-1"><input value={line.desc} onChange={e => updateLine(i, 'desc', e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-full" placeholder="Line description" /></td>
                  <td className="py-1 text-right"><input value={line.debit} onChange={e => updateLine(i, 'debit', e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-28 text-right" placeholder="0.00" type="number" step="0.01" /></td>
                  <td className="py-1 text-right"><input value={line.credit} onChange={e => updateLine(i, 'credit', e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-28 text-right" placeholder="0.00" type="number" step="0.01" /></td>
                  <td className="py-1">
                    {form.lines.length > 1 && (
                      <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold border-t-2">
                <td colSpan={2} className="pt-2">
                  <button onClick={addLine} className="text-xs text-blue-600 hover:underline">+ Add Line</button>
                </td>
                <td className={`text-right pt-2 ${balanced ? '' : 'text-red-600'}`}>${totalDebit.toFixed(2)}</td>
                <td className={`text-right pt-2 ${balanced ? '' : 'text-red-600'}`}>${totalCredit.toFixed(2)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          {!balanced && <p className="text-red-600 text-xs mb-3">Debits and credits must balance before saving.</p>}
          <button onClick={() => createMut.mutate()} disabled={!balanced || !form.date || !form.description || createMut.isPending}
            className="bg-amacc-600 text-white px-4 py-2 rounded text-sm hover:bg-amacc-700 disabled:opacity-50">
            {createMut.isPending ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      )}
    </div>
  );
}
