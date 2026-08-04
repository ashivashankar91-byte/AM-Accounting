/**
 * S033 — Allocation Entries
 * Allocation template management and distribution runs.
 * Templates define how a source account's balance is distributed across N targets.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { glApi } from '../api/client';

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

interface AllocationLine {
  targetAccountId: string;
  allocationPct?: number;
  description?: string;
}

export default function AllocationTemplates() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [runTemplateId, setRunTemplateId] = useState<string | null>(null);
  const [runAmount, setRunAmount] = useState('');
  const [runDate, setRunDate] = useState(new Date().toISOString().slice(0, 10));
  const [runResult, setRunResult] = useState<any>(null);

  // Form state
  const [form, setForm] = useState({
    name: '',
    description: '',
    sourceAccountId: '',
    allocationBasis: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED_AMOUNT',
    lines: [{ targetAccountId: '', allocationPct: 100, description: '' }] as AllocationLine[],
  });

  const { data: templates = [], isLoading, isError } = useQuery({
    queryKey: ['allocation-templates'],
    queryFn: () => glApi.listAllocationTemplates(),
  });

  const createMut = useMutation({
    mutationFn: (data: any) => glApi.createAllocationTemplate(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allocation-templates'] });
      setShowCreate(false);
      setForm({ name: '', description: '', sourceAccountId: '', allocationBasis: 'PERCENTAGE', lines: [{ targetAccountId: '', allocationPct: 100, description: '' }] });
    },
  });

  const runMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => glApi.runAllocation(id, data),
    onSuccess: (result) => {
      setRunResult(result);
      qc.invalidateQueries({ queryKey: ['gl-entries'] });
    },
  });

  const totalPct = form.lines.reduce((s, l) => s + (l.allocationPct ?? 0), 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Allocation Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            S033 — Define how account balances are distributed across cost centers or departments.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 font-medium">
          + New Template
        </button>
      </div>

      {/* Loading / Error states */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />
          Loading allocation templates…
        </div>
      )}
      {isError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Failed to load allocation templates. Check your connection.
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && (templates as any[]).length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-xl">
          <div className="text-gray-400 text-lg mb-2">No allocation templates yet</div>
          <p className="text-sm text-gray-500 mb-4">
            Create a template to define how a source account's balance is distributed.
          </p>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800">
            Create First Template
          </button>
        </div>
      )}

      {/* Template list */}
      {(templates as any[]).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Template Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Source Account</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Basis</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Lines</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(templates as any[]).map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {t.name}
                    {t.description && <div className="text-xs text-gray-400">{t.description}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{t.sourceAccountId}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium ${
                      t.allocationBasis === 'PERCENTAGE' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {t.allocationBasis}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{t.lines?.length ?? 0} lines</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium ${
                      t.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { setRunTemplateId(t.id); setRunResult(null); }}
                      className="text-sm text-blue-700 hover:text-blue-900 font-medium">
                      Run Allocation
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Template Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">New Allocation Template</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Template Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full h-8 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. Overhead Allocation" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Source Account ID *</label>
                  <input value={form.sourceAccountId} onChange={e => setForm(f => ({ ...f, sourceAccountId: e.target.value }))}
                    className="w-full h-8 px-3 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="GL Account ID" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full h-8 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Optional description" />
              </div>

              {/* Allocation lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">Distribution Lines</label>
                  {form.allocationBasis === 'PERCENTAGE' && (
                    <span className={`text-xs font-semibold ${Math.abs(totalPct - 100) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                      Total: {totalPct.toFixed(2)}% {Math.abs(totalPct - 100) < 0.01 ? '✓' : '(must be 100%)'}
                    </span>
                  )}
                </div>
                <div className="space-y-2">
                  {form.lines.map((line, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <input
                        value={line.targetAccountId}
                        onChange={e => setForm(f => ({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, targetAccountId: e.target.value } : l) }))}
                        className="flex-1 h-8 px-3 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="Target Account ID" />
                      <input
                        type="number"
                        value={line.allocationPct ?? ''}
                        onChange={e => setForm(f => ({ ...f, lines: f.lines.map((l, j) => j === i ? { ...l, allocationPct: parseFloat(e.target.value) || 0 } : l) }))}
                        className="w-20 h-8 px-2 text-sm text-right border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="%" />
                      <button onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))}
                        className="h-8 px-2 text-gray-400 hover:text-red-600">✕</button>
                    </div>
                  ))}
                  <button onClick={() => setForm(f => ({ ...f, lines: [...f.lines, { targetAccountId: '', allocationPct: 0, description: '' }] }))}
                    className="text-sm text-blue-700 hover:underline">
                    + Add line
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button
                  onClick={() => createMut.mutate(form)}
                  disabled={createMut.isPending || !form.name || !form.sourceAccountId || form.lines.length === 0}
                  className="px-5 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 flex items-center gap-2">
                  {createMut.isPending && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Create Template
                </button>
              </div>
              {createMut.isError && (
                <p className="text-sm text-red-600">{(createMut.error as Error).message}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Run Allocation Modal */}
      {runTemplateId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">Run Allocation</h2>
              <button onClick={() => { setRunTemplateId(null); setRunResult(null); }} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            {runResult ? (
              <div className="p-6 space-y-3">
                <div className="flex items-center gap-2 text-green-700">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="font-semibold">Allocation Complete</span>
                </div>
                <div className="text-sm text-gray-700 space-y-1">
                  <div><span className="text-gray-500">Draft JE ID:</span> <span className="font-mono">{runResult.journalEntryId}</span></div>
                  <div><span className="text-gray-500">Amount Allocated:</span> <span className="font-medium">{fmtCurrency(Math.abs(runResult.allocatedAmount))}</span></div>
                  <div><span className="text-gray-500">Lines Created:</span> {runResult.lineCount}</div>
                </div>
                <p className="text-xs text-gray-500">
                  A draft journal entry has been created. Submit it for review to post the allocation.
                </p>
                <button onClick={() => { setRunTemplateId(null); setRunResult(null); }}
                  className="w-full py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800">
                  Done
                </button>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Source Amount to Allocate *</label>
                  <input type="number" value={runAmount} onChange={e => setRunAmount(e.target.value)}
                    className="w-full h-8 px-3 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Entry Date</label>
                  <input type="date" value={runDate} onChange={e => setRunDate(e.target.value)}
                    className="w-full h-8 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setRunTemplateId(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                    Cancel
                  </button>
                  <button
                    onClick={() => runMut.mutate({ id: runTemplateId, data: { sourceAmount: parseFloat(runAmount), entryDate: runDate } })}
                    disabled={runMut.isPending || !runAmount || parseFloat(runAmount) === 0}
                    className="px-5 py-2 text-sm bg-blue-700 text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 flex items-center gap-2">
                    {runMut.isPending && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    Run Allocation
                  </button>
                </div>
                {runMut.isError && (
                  <p className="text-sm text-red-600">{(runMut.error as Error).message}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
