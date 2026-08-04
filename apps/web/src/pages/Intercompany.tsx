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


type Tab = 'transfers' | 'create' | 'companies';

const SAMPLE_COMPANIES = [
  { id: 'CO1', name: 'Main Dealership', franchise: 'GM', db: 'amacc_main' },
  { id: 'CO2', name: 'Used Car Center', franchise: 'Multi', db: 'amacc_used' },
  { id: 'CO3', name: 'Honda Store', franchise: 'Honda', db: 'amacc_honda' },
];

const SAMPLE_TRANSFERS = [
  { id: 'IC-2026-042', from: 'Main Dealership', to: 'Used Car Center', date: '03/14/2026', amount: 24500, desc: 'Vehicle transfer – Stock #U2041', status: 'Pending' },
  { id: 'IC-2026-041', from: 'Honda Store', to: 'Main Dealership', date: '03/12/2026', amount: 1200, desc: 'Shared advertising allocation', status: 'Posted' },
  { id: 'IC-2026-040', from: 'Main Dealership', to: 'Honda Store', date: '03/10/2026', amount: 8500, desc: 'Parts transfer for warranty work', status: 'Posted' },
  { id: 'IC-2026-039', from: 'Used Car Center', to: 'Main Dealership', date: '03/05/2026', amount: 500, desc: 'Management fee allocation', status: 'Posted' },
];

export default function Intercompany() {
  const [tab, setTab] = useState<Tab>('transfers');

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Intercompany Transactions</h1><p className="text-sm text-gray-500 mt-0.5">Track and reconcile transactions between group companies. Source: GL Service.</p></div>
        <HelpButton help={SCREEN_HELP['intercompany']} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Linked Companies</p><p className="text-2xl font-bold">{SAMPLE_COMPANIES.length}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">Pending Transfers</p><p className="text-2xl font-bold text-amber-600">{SAMPLE_TRANSFERS.filter(t => t.status === 'Pending').length}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-500">MTD Volume</p><p className="text-2xl font-bold text-amacc-700">${SAMPLE_TRANSFERS.reduce((s, t) => s + t.amount, 0).toLocaleString()}</p></div>
      </div>

      <div className="flex gap-2 border-b">
        {([['transfers', 'Transfer Log'], ['create', 'New Transfer'], ['companies', 'Linked Companies']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'transfers' && (
        <div className="bg-white rounded-lg shadow p-4">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Transfer #</th><th className="pb-2">From</th><th className="pb-2">To</th>
              <th className="pb-2">Date</th><th className="pb-2">Description</th><th className="pb-2 text-right">Amount</th>
              <th className="pb-2">Status</th><th className="pb-2">Actions</th>
            </tr></thead>
            <tbody>
              {SAMPLE_TRANSFERS.map(t => (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 font-mono font-bold text-amacc-700">{t.id}</td>
                  <td className="py-2">{t.from}</td>
                  <td className="py-2">{t.to}</td>
                  <td className="py-2 text-gray-500">{t.date}</td>
                  <td className="py-2">{t.desc}</td>
                  <td className="py-2 text-right font-mono">${t.amount.toLocaleString()}</td>
                  <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs ${t.status === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{t.status}</span></td>
                  <td className="py-2">
                    {t.status === 'Pending' && <button className="text-xs text-green-600 hover:underline">Post</button>}
                    {t.status === 'Posted' && <button className="text-xs text-brand hover:underline">View</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'create' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-lg font-semibold">Create Intercompany Transfer</h3>
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700">From Company</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                  {SAMPLE_COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium text-gray-700">From GL Account</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" placeholder="XXXX" /></div>
              <div><label className="block text-sm font-medium text-gray-700">From Department</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm"><option>01 – New</option><option>02 – Used</option><option>03 – Service</option><option>09 – Admin</option></select></div>
            </div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700">To Company</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm">
                  {SAMPLE_COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium text-gray-700">To GL Account</label>
                <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" placeholder="XXXX" /></div>
              <div><label className="block text-sm font-medium text-gray-700">To Department</label>
                <select className="w-full mt-1 border rounded px-3 py-2 text-sm"><option>01 – New</option><option>02 – Used</option><option>03 – Service</option><option>09 – Admin</option></select></div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-700">Amount</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm font-mono" placeholder="0.00" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Transfer Date</label>
              <input type="date" className="w-full mt-1 border rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-sm font-medium text-gray-700">Reference</label>
              <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Transfer ref #" /></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700">Description</label>
            <input className="w-full mt-1 border rounded px-3 py-2 text-sm" placeholder="Reason for transfer" /></div>
          <div className="bg-brand-light rounded-lg p-3 text-sm text-brand">
            This will create matching debit/credit entries in both company ledgers. The intercompany clearing account will be used to balance the transaction.
          </div>
          <div className="flex justify-end gap-3">
            <button className="border px-4 py-2 rounded text-sm">Cancel</button>
            <button className="bg-amacc-600 text-white px-6 py-2 rounded text-sm">Create Transfer</button>
          </div>
        </div>
      )}

      {tab === 'companies' && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">Linked Companies</h3>
            <button className="text-sm bg-amacc-600 text-white px-4 py-2 rounded">Link Company</button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {SAMPLE_COMPANIES.map(c => (
              <div key={c.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <h4 className="font-semibold">{c.name}</h4>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">Active</span>
                </div>
                <p className="text-sm text-gray-500">ID: {c.id} · {c.franchise}</p>
                <p className="text-xs text-gray-400 font-mono">{c.db}</p>
                <div className="flex gap-2 pt-2">
                  <button className="text-xs text-brand hover:underline">View Balance</button>
                  <button className="text-xs text-gray-500 hover:underline">Settings</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
