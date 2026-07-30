import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, AlertCircle } from 'lucide-react';
import { approvalRuleApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, PageHeader, Badge } from '../../components/ui';

// AMACC-CH04 S041 — tenant-configurable Invoice Approval Matrix. The Fable
// canonical registry record for S041 has no accepted thresholds/roles — this
// screen is the configurable framework itself: the tenant defines its own
// dollar-threshold tiers here rather than any policy being hard-coded.

const ROLES = ['ACCOUNTANT', 'CONTROLLER', 'ADMIN'] as const;

export default function ApprovalMatrixConfig() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [thresholdAmount, setThresholdAmount] = useState('0');
  const [requiredRole, setRequiredRole] = useState<string>('ACCOUNTANT');
  const [sequence, setSequence] = useState('1');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: rules, isLoading, error, refetch } = useQuery({
    queryKey: ['ap-invoice-approval-rules'],
    queryFn: () => approvalRuleApi.list(),
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: () => approvalRuleApi.create({ thresholdAmount: parseFloat(thresholdAmount) || 0, requiredRole, sequence: parseInt(sequence, 10) || 1 }),
    onSuccess: () => {
      setFormError(null);
      setShowNew(false);
      setThresholdAmount('0'); setRequiredRole('ACCOUNTANT'); setSequence('1');
      queryClient.invalidateQueries({ queryKey: ['ap-invoice-approval-rules'] });
    },
    onError: (err: any) => setFormError(err?.body?.message ?? err.message ?? 'Failed to create rule'),
  });

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => approvalRuleApi.update(id, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ap-invoice-approval-rules'] }),
  });

  if (isLoading) return <PageLoader page="Approval Matrix" service="apar-service" port={3013} />;
  if (error) return <PageError error={error as Error} serviceName="AP/AR Service" port={3013} retry={refetch} />;

  const list = (rules ?? []).slice().sort((a: any, b: any) => a.sequence - b.sequence);

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Invoice Approval Matrix (S041)"
        subtitle="Configure dollar-threshold tiers and the role required to approve each tier. If no tiers are configured, every invoice requires exactly one approval from any authorized approver — never zero."
      />

      <div className="flex justify-end">
        <Btn variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={() => setShowNew(true)}>Add Tier</Btn>
      </div>

      {showNew && (
        <div className="bg-white rounded-lg shadow p-4 space-y-3 border-l-4 border-blue-500">
          {formError && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" />{formError}</div>}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sequence</label>
              <input type="number" min={1} value={sequence} onChange={(e) => setSequence(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Threshold Amount ($ and above)</label>
              <input type="number" step="0.01" value={thresholdAmount} onChange={(e) => setThresholdAmount(e.target.value)} className="w-full border rounded px-3 py-2 text-sm text-right font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Required Role</label>
              <select value={requiredRole} onChange={(e) => setRequiredRole(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button onClick={() => createMut.mutate()} disabled={createMut.isPending} className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-40">
              {createMut.isPending ? 'Saving...' : 'Save Tier'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Sequence</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Threshold</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Required Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Active</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {list.map((r: any) => (
              <tr key={r.id}>
                <td className="px-4 py-2">{r.sequence}</td>
                <td className="px-4 py-2 text-right font-mono">${Number(r.thresholdAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })}+</td>
                <td className="px-4 py-2 font-mono text-xs">{r.requiredRole}</td>
                <td className="px-4 py-2">{r.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}</td>
                <td className="px-4 py-2">
                  <button onClick={() => toggleActiveMut.mutate({ id: r.id, isActive: !r.isActive })} className="text-xs text-brand hover:underline">
                    {r.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">No tiers configured — every invoice currently requires exactly one approval from any authorized approver.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
