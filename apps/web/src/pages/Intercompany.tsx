/**
 * S034 — Intercompany Pairing & Net-Zero
 * S035 — Consolidation Eliminations
 *
 * Real implementation replacing the display-only mock.
 * Uses gl-service API for IC pair management and elimination runs.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { glApi } from '../api/client';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

type Tab = 'pairs' | 'net-zero' | 'eliminations';

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

export default function Intercompany() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('pairs');
  const [showCreatePair, setShowCreatePair] = useState(false);
  const [nzYear, setNzYear] = useState(currentYear);
  const [nzMonth, setNzMonth] = useState(currentMonth);
  const [elimForm, setElimForm] = useState({ eliminationEntityId: '', periodYear: currentYear, periodMonth: currentMonth });
  const [pairForm, setPairForm] = useState({ entityAId: '', entityBId: '', icReceivableAccount: '', icPayableAccount: '', enforcement: 'WARN' as const });

  // Fetch IC pairs
  const { data: pairs = [], isLoading: pairsLoading } = useQuery({
    queryKey: ['ic-pairs'],
    queryFn: () => glApi.listIntercompanyPairs(),
  });

  // Net-zero check
  const { data: nzResults, isLoading: nzLoading, refetch: refetchNz } = useQuery({
    queryKey: ['ic-net-zero', nzYear, nzMonth],
    queryFn: () => glApi.checkIcNetZero(nzYear, nzMonth),
    enabled: tab === 'net-zero',
  });

  // Elimination runs
  const { data: elimRuns = [], isLoading: elimLoading } = useQuery({
    queryKey: ['elimination-runs'],
    queryFn: () => glApi.listEliminationRuns(),
    enabled: tab === 'eliminations',
  });

  const createPairMut = useMutation({
    mutationFn: (data: any) => glApi.createIntercompanyPair(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ic-pairs'] });
      setShowCreatePair(false);
      setPairForm({ entityAId: '', entityBId: '', icReceivableAccount: '', icPayableAccount: '', enforcement: 'WARN' });
    },
  });

  const runElimMut = useMutation({
    mutationFn: (data: any) => glApi.runElimination(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['elimination-runs'] }),
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: 'pairs', label: 'IC Pairs' },
    { id: 'net-zero', label: 'Net-Zero Check' },
    { id: 'eliminations', label: 'Consolidation Eliminations' },
  ];

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Intercompany Accounting</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            S034 — IC Pair Management · S035 — Consolidation Eliminations
          </p>
        </div>
        <HelpButton help={SCREEN_HELP['intercompany']} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">IC Pairs Configured</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{(pairs as any[]).length}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Unmatched Entries</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">
            {(nzResults as any[] | undefined)?.reduce((s: number, r: any) => s + r.unmatchedEntries.length, 0) ?? '—'}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Elimination Runs (MTD)</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {(elimRuns as any[]).filter((r: any) => r.status === 'COMPLETED').length}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-blue-700 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* IC Pairs Tab */}
      {tab === 'pairs' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowCreatePair(true)}
              className="px-4 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 font-medium">
              + Define IC Pair
            </button>
          </div>

          {pairsLoading && (
            <div className="flex justify-center py-12 text-gray-400">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />Loading IC pairs…
            </div>
          )}

          {!pairsLoading && (pairs as any[]).length === 0 && (
            <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
              <div className="text-gray-400 mb-2">No intercompany pairs defined</div>
              <p className="text-sm text-gray-500 mb-4">Define entity pairs to enable net-zero enforcement and consolidation eliminations.</p>
              <button onClick={() => setShowCreatePair(true)}
                className="px-4 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800">
                Define First IC Pair
              </button>
            </div>
          )}

          {(pairs as any[]).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Entity A</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Entity B</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">IC Receivable Acct</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">IC Payable Acct</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Enforcement</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(pairs as any[]).map(p => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-800">{p.entityAId}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-800">{p.entityBId}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.icReceivableAccount ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.icPayableAccount ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium ${
                          p.enforcement === 'BLOCK' ? 'bg-red-100 text-red-700' :
                          p.enforcement === 'WARN' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {p.enforcement}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{new Date(p.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Create Pair Modal */}
          {showCreatePair && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h2 className="text-base font-bold text-gray-900">Define Intercompany Pair</h2>
                  <button onClick={() => setShowCreatePair(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
                <div className="p-6 space-y-4">
                  <p className="text-xs text-gray-500">
                    The pair (A ↔ B) is symmetric. Entity IDs are sorted on save to prevent duplicates.
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Entity A ID *</label>
                      <input value={pairForm.entityAId} onChange={e => setPairForm(f => ({ ...f, entityAId: e.target.value }))}
                        className="w-full h-8 px-3 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="Legal entity ID" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Entity B ID *</label>
                      <input value={pairForm.entityBId} onChange={e => setPairForm(f => ({ ...f, entityBId: e.target.value }))}
                        className="w-full h-8 px-3 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="Legal entity ID" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">IC Receivable Account</label>
                      <input value={pairForm.icReceivableAccount} onChange={e => setPairForm(f => ({ ...f, icReceivableAccount: e.target.value }))}
                        className="w-full h-8 px-3 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="GL Account ID" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">IC Payable Account</label>
                      <input value={pairForm.icPayableAccount} onChange={e => setPairForm(f => ({ ...f, icPayableAccount: e.target.value }))}
                        className="w-full h-8 px-3 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="GL Account ID" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Net-Zero Enforcement</label>
                    <select value={pairForm.enforcement} onChange={e => setPairForm(f => ({ ...f, enforcement: e.target.value as any }))}
                      className="w-full h-8 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500">
                      <option value="NONE">None — informational only</option>
                      <option value="WARN">Warn — flag unmatched at period close</option>
                      <option value="BLOCK">Block — prevent period close if not net-zero</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button onClick={() => setShowCreatePair(false)}
                      className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                    <button
                      onClick={() => createPairMut.mutate(pairForm)}
                      disabled={createPairMut.isPending || !pairForm.entityAId || !pairForm.entityBId}
                      className="px-5 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 flex items-center gap-2">
                      {createPairMut.isPending && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                      Define Pair
                    </button>
                  </div>
                  {createPairMut.isError && (
                    <p className="text-sm text-red-600">{(createPairMut.error as Error).message}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Net-Zero Check Tab */}
      {tab === 'net-zero' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Year:</label>
              <input type="number" value={nzYear} onChange={e => setNzYear(parseInt(e.target.value))}
                className="w-20 h-8 px-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Month:</label>
              <input type="number" min={1} max={12} value={nzMonth} onChange={e => setNzMonth(parseInt(e.target.value))}
                className="w-16 h-8 px-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <button onClick={() => refetchNz()}
              className="px-4 py-1.5 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800">
              Check Net-Zero
            </button>
          </div>

          {nzLoading && (
            <div className="flex justify-center py-12 text-gray-400">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />Running net-zero check…
            </div>
          )}

          {nzResults && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-800">
                  Net-Zero Status — {nzYear}/{String(nzMonth).padStart(2, '0')}
                </h3>
              </div>
              {(nzResults as any[]).length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">No IC pairs configured.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Entity A</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Entity B</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">A Balance</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">B Balance</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Net</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Unmatched</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(nzResults as any[]).map((r: any) => (
                      <tr key={r.pairId} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono text-xs">{r.entityAId}</td>
                        <td className="px-4 py-3 font-mono text-xs">{r.entityBId}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{fmtCurrency(parseFloat(r.entityABalance))}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{fmtCurrency(parseFloat(r.entityBBalance))}</td>
                        <td className={`px-4 py-3 text-right font-mono text-xs tabular-nums font-semibold ${
                          r.isNetZero ? 'text-green-700' : 'text-red-700'
                        }`}>
                          {fmtCurrency(parseFloat(r.netBalance))}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium ${
                            r.isNetZero ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {r.isNetZero ? '✓ Net Zero' : '✗ Out of Balance'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {r.unmatchedEntries.length > 0 ? `${r.unmatchedEntries.length} unmatched` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* Consolidation Eliminations Tab */}
      {tab === 'eliminations' && (
        <div className="space-y-5">
          {/* Run new elimination */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Run Consolidation Elimination</h3>
            <p className="text-xs text-gray-500 mb-4">
              Generates balanced elimination journal entries in the designated elimination entity (S003)
              for all unmatched IC pairs in the specified period.
            </p>
            <div className="flex items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Elimination Entity ID *</label>
                <input value={elimForm.eliminationEntityId}
                  onChange={e => setElimForm(f => ({ ...f, eliminationEntityId: e.target.value }))}
                  className="h-8 px-3 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
                  placeholder="Entity ID" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Year</label>
                <input type="number" value={elimForm.periodYear}
                  onChange={e => setElimForm(f => ({ ...f, periodYear: parseInt(e.target.value) }))}
                  className="h-8 px-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 w-20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Month</label>
                <input type="number" min={1} max={12} value={elimForm.periodMonth}
                  onChange={e => setElimForm(f => ({ ...f, periodMonth: parseInt(e.target.value) }))}
                  className="h-8 px-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 w-16" />
              </div>
              <button
                onClick={() => runElimMut.mutate(elimForm)}
                disabled={runElimMut.isPending || !elimForm.eliminationEntityId}
                className="h-8 px-5 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 flex items-center gap-2">
                {runElimMut.isPending && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Run Elimination
              </button>
            </div>
            {runElimMut.isError && (
              <p className="text-sm text-red-600 mt-2">{(runElimMut.error as Error).message}</p>
            )}
            {runElimMut.isSuccess && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                ✓ Elimination run complete — {runElimMut.data?.icPairsProcessed ?? 0} pairs processed,
                {' '}{runElimMut.data?.journalEntryIds?.length ?? 0} elimination JEs created.
              </div>
            )}
          </div>

          {/* Elimination run history */}
          {elimLoading ? (
            <div className="flex justify-center py-12 text-gray-400">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />Loading runs…
            </div>
          ) : (elimRuns as any[]).length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-sm">
              No elimination runs yet
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-800">Elimination Run History</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Period</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Elimination Entity</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">Pairs Processed</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Total Eliminated</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Started By</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(elimRuns as any[]).map((r: any) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs">{r.periodYear}/{String(r.periodMonth).padStart(2,'0')}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.eliminationEntityId}</td>
                      <td className="px-4 py-3 text-center text-xs">{r.icPairsProcessed}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {fmtCurrency(parseFloat(r.totalEliminatedDebit ?? 0))}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium ${
                          r.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                          r.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                          r.status === 'RUNNING' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{r.startedBy}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{new Date(r.startedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
