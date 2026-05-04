import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '../api/client';
import PageError from '../components/PageError';
import StatusBadge from '../components/StatusBadge';
import { SkeletonTable } from '../components/Skeleton';
import AIInsight from '../components/AIInsight';

function todayString() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Payroll() {
  const queryClient = useQueryClient();
  const { data: batches, isLoading, error, refetch } = useQuery({ queryKey: ['payroll-batches'], queryFn: payrollApi.getBatches, retry: false });

  const [showForm, setShowForm] = useState(false);
  const [batchRef, setBatchRef] = useState(`PAY-${todayString()}`);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [employeeCount, setEmployeeCount] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const idempotencyKey = `${batchRef}-HYU01`;

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }

  const validateMut = useMutation({
    mutationFn: (id: string) => payrollApi.validate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payroll-batches'] }),
  });

  const postMut = useMutation({
    mutationFn: (id: string) => payrollApi.post(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payroll-batches'] }),
  });

  const releaseMut = useMutation({
    mutationFn: (id: string) => payrollApi.release(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payroll-batches'] }),
  });

  const submitMut = useMutation({
    mutationFn: (data: any) => payrollApi.submit(data),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-batches'] });
      showToast(`Batch submitted — ID: ${result.id}`, 'success');
      setShowForm(false);
      setBatchRef(`PAY-${todayString()}`);
      setPeriodStart('');
      setPeriodEnd('');
      setTotalAmount('');
      setEmployeeCount('');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Submit failed', 'error');
    },
  });

  const resubmitMut = useMutation({
    mutationFn: (batch: any) => payrollApi.submit({
      batchRef: `${batch.batchRef}-RESUB`,
      periodStart: batch.periodStart,
      periodEnd: batch.periodEnd,
      totalAmount: batch.totalAmount,
      idempotencyKey: batch.idempotencyKey,
    }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-batches'] });
      showToast(
        `Idempotency protection active — existing batch returned, no duplicate created. Batch ID: ${result.id}`,
        'success',
      );
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Resubmit failed', 'error');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!batchRef || !periodStart || !periodEnd || !totalAmount) return;
    submitMut.mutate({
      batchRef,
      periodStart,
      periodEnd,
      totalAmount: parseFloat(totalAmount),
      idempotencyKey,
    });
  }

  const heldBatches = (batches ?? []).filter((b: any) => b.status === 'HELD');

  if (error) return <PageError error={error} serviceName="Payroll Service" port={3012} retry={refetch} />;

  return (
    <div style={{ padding: 28 }}>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 50, maxWidth: 400, padding: '12px 16px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontSize: 13, fontWeight: 600, background: toast.type === 'success' ? 'var(--success)' : 'var(--danger)', color: 'white' }}>
          {toast.message}
        </div>
      )}

      {/* Submit button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'var(--primary)', color: 'white' }}
        >
          {showForm ? 'Cancel' : 'Submit New Batch'}
        </button>
      </div>

      {/* Submit Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="font-semibold text-lg">New Payroll Batch</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Batch Reference</label>
              <input
                type="text"
                value={batchRef}
                onChange={(e) => setBatchRef(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Total Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="127450.00"
                className="w-full border rounded px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Period Start</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Period End</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Employee Count (optional)</label>
              <input
                type="number"
                min="0"
                value={employeeCount}
                onChange={(e) => setEmployeeCount(e.target.value)}
                placeholder="23"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Idempotency Key</label>
              <input
                type="text"
                value={idempotencyKey}
                readOnly
                className="w-full border rounded px-3 py-2 text-sm bg-gray-50 text-gray-500 font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitMut.isPending}
              className="bg-green-600 text-white px-6 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {submitMut.isPending ? 'Submitting...' : 'Submit Batch'}
            </button>
          </div>
        </form>
      )}

      {/* Held Batches Alert */}
      {heldBatches.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-800 mb-2">Held Batches — Human Action Required</h3>
          {heldBatches.map((b: any) => (
            <div key={b.id} className="flex items-center justify-between py-2 border-b border-yellow-100 last:border-0">
              <div>
                <span className="font-medium">{b.batchRef}</span>
                <span className="text-sm text-yellow-700 ml-2">${b.totalAmount.toLocaleString()}</span>
                {b.heldReason && <span className="text-xs text-yellow-600 ml-2">— {b.heldReason}</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => releaseMut.mutate(b.id)} className="text-xs bg-green-600 text-white px-3 py-1 rounded">Release</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Batch Table */}
      {isLoading ? <SkeletonTable rows={5} cols={6} /> : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Payroll Batches</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E5E7EB' }}>
                {['Ref', 'Period', 'Amount', 'Status', 'Submitted', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(batches ?? []).length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '48px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>💰</div>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>No payroll batches submitted yet</div>
                </td></tr>
              ) : (batches ?? []).map((b: any) => (
                <tr key={b.id} style={{ borderBottom: '1px solid #F1F5F9' }}
                  onMouseEnter={(ev) => ev.currentTarget.style.background = '#F8FAFC'}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'monospace', fontWeight: 600, color: 'var(--primary)' }}>{b.batchRef}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13 }}>{formatDate(b.periodStart)} — {formatDate(b.periodEnd)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>${b.totalAmount.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px' }}><StatusBadge status={b.status} /></td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>{new Date(b.submittedAt).toLocaleDateString()}</td>
                  <td style={{ padding: '12px 16px', display: 'flex', gap: 8 }}>
                    {b.status === 'PENDING' && <button onClick={() => validateMut.mutate(b.id)} style={{ fontSize: 12, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Validate</button>}
                    {b.status === 'VALIDATED' && <button onClick={() => postMut.mutate(b.id)} style={{ fontSize: 12, color: 'var(--success)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Post</button>}
                    {b.status === 'POSTED' && (
                      <button
                        onClick={() => resubmitMut.mutate(b)}
                        disabled={resubmitMut.isPending}
                        style={{ fontSize: 12, color: 'var(--warning)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Resubmit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AIInsight pageType="payroll" context="Payroll" data={{ batches: batches?.slice(0, 20) }} />
    </div>
  );
}
