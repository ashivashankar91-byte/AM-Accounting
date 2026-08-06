/**
 * S006 — MFA Policy & Safeguards Evidence (Wave 1 / CE-06)
 * Allows GL Admin to configure MFA enforcement policy and view evidence log.
 * DEMO_FIXTURE mode: enforcement is simulated for prototype.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantApi } from '../api/client';
import { ShieldCheck, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';

type MfaPolicy = {
  id: string;
  tenantId: string;
  enforced: boolean;
  gracePeriodDays: number;
  allowedMethods: string[];
  updatedAt: string;
  updatedByUserId: string;
};

type EvidenceRecord = {
  id: string;
  userId: string;
  eventType: string;
  method: string;
  success: boolean;
  ipAddress: string | null;
  createdAt: string;
};

export default function MfaSettings() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const { data: policy, isLoading: policyLoading, error: policyError } = useQuery<MfaPolicy>({
    queryKey: ['mfa-policy'],
    queryFn: () => tenantApi.getMfaPolicy(),
  });

  const { data: evidence, isLoading: evidenceLoading } = useQuery<EvidenceRecord[]>({
    queryKey: ['mfa-evidence'],
    queryFn: () => tenantApi.getSafeguardsEvidence(),
  });

  const saveMutation = useMutation({
    mutationFn: (data: Partial<MfaPolicy>) => tenantApi.setMfaPolicy(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfa-policy'] });
      setSuccessMsg('MFA policy saved successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    },
  });

  const [enforced, setEnforced] = useState<boolean | null>(null);
  const [gracePeriod, setGracePeriod] = useState<number | null>(null);

  const currentEnforced = enforced ?? policy?.enforced ?? false;
  const currentGrace = gracePeriod ?? policy?.gracePeriodDays ?? 14;

  const handleSave = () => {
    setSaving(true);
    saveMutation.mutate({ enforced: currentEnforced, gracePeriodDays: currentGrace }, {
      onSettled: () => setSaving(false),
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck size={24} className="text-blue-700" />
        <div>
          <h1 className="text-xl font-semibold text-slate-900">MFA Policy & Safeguards Evidence</h1>
          <p className="text-sm text-slate-500">S006 — GL Admin MFA enforcement configuration</p>
        </div>
        <span className="ml-auto text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium">
          DEMO_FIXTURE MODE — enforcement simulated for prototype
        </span>
      </div>

      {/* Policy Card */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 uppercase tracking-wide">Enforcement Policy</h2>
        {policyLoading && (
          <div className="flex items-center gap-2 text-slate-500 py-4">
            <RefreshCw size={16} className="animate-spin" /> Loading policy...
          </div>
        )}
        {policyError && (
          <div className="flex items-center gap-2 text-red-600 py-4">
            <AlertCircle size={16} /> Failed to load policy.
          </div>
        )}
        {policy && (
          <div className="space-y-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={currentEnforced}
                onChange={e => setEnforced(e.target.checked)}
                className="w-4 h-4 text-blue-700 rounded border-slate-300"
              />
              <span className="text-sm text-slate-700 font-medium">
                Require MFA for all GL Admin users
              </span>
            </label>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Grace Period (days before enforcement)
              </label>
              <input
                type="number"
                min={0}
                max={90}
                value={currentGrace}
                onChange={e => setGracePeriod(parseInt(e.target.value, 10))}
                className="h-8 w-28 border border-slate-300 rounded px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-700"
              />
            </div>
            {successMsg && (
              <div className="flex items-center gap-2 text-green-700 text-sm">
                <CheckCircle size={14} /> {successMsg}
              </div>
            )}
            {saveMutation.isError && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle size={14} /> Failed to save policy.
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-700 text-white rounded text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Policy'}
            </button>
            <p className="text-xs text-slate-400 mt-1">
              Last updated: {policy.updatedAt ? new Date(policy.updatedAt).toLocaleString() : '—'}
            </p>
          </div>
        )}
      </div>

      {/* Evidence Log */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 uppercase tracking-wide">
          Safeguards Evidence Log
        </h2>
        {evidenceLoading && (
          <div className="flex items-center gap-2 text-slate-500 py-4">
            <RefreshCw size={16} className="animate-spin" /> Loading evidence...
          </div>
        )}
        {!evidenceLoading && (!evidence || evidence.length === 0) && (
          <div className="text-sm text-slate-500 py-8 text-center">
            No MFA events recorded yet.
          </div>
        )}
        {evidence && evidence.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="pb-2 pr-4 font-medium text-slate-600">User ID</th>
                  <th className="pb-2 pr-4 font-medium text-slate-600">Event</th>
                  <th className="pb-2 pr-4 font-medium text-slate-600">Method</th>
                  <th className="pb-2 pr-4 font-medium text-slate-600">Result</th>
                  <th className="pb-2 pr-4 font-medium text-slate-600">IP</th>
                  <th className="pb-2 font-medium text-slate-600">Time</th>
                </tr>
              </thead>
              <tbody>
                {evidence.map(ev => (
                  <tr key={ev.id} className="border-b border-slate-100 h-9 hover:bg-slate-50">
                    <td className="pr-4 font-mono text-xs text-slate-700">{ev.userId.slice(0, 8)}</td>
                    <td className="pr-4 text-slate-700">{ev.eventType}</td>
                    <td className="pr-4 text-slate-700">{ev.method}</td>
                    <td className="pr-4">
                      {ev.success
                        ? <span className="text-green-700 font-medium">PASS</span>
                        : <span className="text-red-600 font-medium">FAIL</span>}
                    </td>
                    <td className="pr-4 font-mono text-xs text-slate-500">{ev.ipAddress ?? '—'}</td>
                    <td className="text-slate-500 text-xs">{new Date(ev.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
