import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL ?? '';
const tenantId = () => localStorage.getItem('tenantId') || 'tenant-kunes';

interface Approval {
  id: string;
  actionType: string;
  entityRef: string;
  reasoning: string;
  status: string;
  requestedAt: string;
}

export default function MobileApprovals() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const fetchApprovals = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/approvals/pending/${tenantId()}`, {
        headers: { 'x-tenant-id': tenantId() },
      });
      if (res.ok) {
        setApprovals(await res.json());
      }
    } catch {
      setApprovals([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchApprovals(); }, []);

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    setActionId(id);
    try {
      await fetch(`${API_BASE}/api/v1/approvals/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId() },
      });
    } catch { /* ignore */ }
    setApprovals(prev => prev.filter(a => a.id !== id));
    setActionId(null);
  };

  if (loading) return <div className="p-6 text-center text-gray-500">Loading...</div>;

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Pending Approvals</h1>
        <p className="text-sm text-gray-500 mt-0.5">Review and action pending approval requests. Source: Approval Service.</p>
      </div>
      <p className="text-xs text-gray-500">{approvals.length} items awaiting review</p>

      {approvals.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-2">✅</div>
          <p>All caught up! No pending approvals.</p>
        </div>
      )}

      {approvals.map(a => (
        <div key={a.id} className="bg-white rounded-xl shadow p-4 space-y-3">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-semibold text-sm">{a.actionType.replace(/_/g, ' ')}</div>
              <div className="text-xs text-gray-500">{a.entityRef}</div>
            </div>
            <span className="text-xs text-gray-400">{new Date(a.requestedAt).toLocaleDateString()}</span>
          </div>
          <p className="text-sm text-gray-600">{a.reasoning}</p>
          <div className="flex gap-3">
            <button
              onClick={() => handleAction(a.id, 'approve')}
              disabled={actionId === a.id}
              className="flex-1 py-3 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 active:bg-green-800 min-h-[48px]">
              APPROVE
            </button>
            <button
              onClick={() => handleAction(a.id, 'reject')}
              disabled={actionId === a.id}
              className="flex-1 py-3 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 active:bg-red-800 min-h-[48px]">
              REJECT
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
