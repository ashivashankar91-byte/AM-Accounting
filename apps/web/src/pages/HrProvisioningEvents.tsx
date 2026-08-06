/**
 * S005 — HR-Driven Role Provisioning Audit Log (Wave 1 / CE-06)
 * Shows HR provisioning events received from the HR system and resulting role assignments.
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { Users, RefreshCw, AlertCircle } from 'lucide-react';

type HrProvisioningEvent = {
  id: string;
  tenantId: string;
  eventType: string;
  hrEmployeeId: string;
  jobCode: string | null;
  assignedRoles: string[];
  processedAt: string;
  status: string;
  notes: string | null;
};

export default function HrProvisioningEvents() {
  const { data: events, isLoading, error, refetch } = useQuery<HrProvisioningEvent[]>({
    queryKey: ['hr-provisioning-events'],
    queryFn: () => apiFetch<HrProvisioningEvent[]>('/api/v1/hr-provisioning/events'),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Users size={24} className="text-blue-700" />
        <div>
          <h1 className="text-xl font-semibold text-slate-900">HR Role Provisioning Events</h1>
          <p className="text-sm text-slate-500">S005 — Audit log of HR-driven accounting role assignments</p>
        </div>
        <button
          onClick={() => refetch()}
          className="ml-auto flex items-center gap-1 text-sm text-blue-700 hover:underline"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <RefreshCw size={16} className="animate-spin" /> Loading provisioning events...
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-red-600 py-8">
          <AlertCircle size={16} /> Failed to load provisioning events. The tenant service may be unavailable.
        </div>
      )}
      {!isLoading && (!events || events.length === 0) && (
        <div className="text-sm text-slate-500 py-16 text-center bg-white border border-slate-200 rounded-lg">
          No HR provisioning events yet. Events are automatically created when HR system sends role changes.
        </div>
      )}
      {events && events.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left bg-slate-50">
                <th className="py-2 px-4 font-medium text-slate-600">HR Employee ID</th>
                <th className="py-2 px-4 font-medium text-slate-600">Event Type</th>
                <th className="py-2 px-4 font-medium text-slate-600">Job Code</th>
                <th className="py-2 px-4 font-medium text-slate-600">Assigned Roles</th>
                <th className="py-2 px-4 font-medium text-slate-600">Status</th>
                <th className="py-2 px-4 font-medium text-slate-600">Processed At</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr key={ev.id} className="border-b border-slate-100 h-9 hover:bg-slate-50">
                  <td className="px-4 font-mono text-xs text-slate-700">{ev.hrEmployeeId}</td>
                  <td className="px-4 text-slate-700">{ev.eventType.replace('HR_USER_', '')}</td>
                  <td className="px-4 text-slate-500">{ev.jobCode ?? '—'}</td>
                  <td className="px-4">
                    {ev.assignedRoles.length === 0
                      ? <span className="text-slate-400 italic">none</span>
                      : ev.assignedRoles.map(r => (
                          <span key={r} className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded mr-1">
                            {r}
                          </span>
                        ))}
                  </td>
                  <td className="px-4">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${ev.status === 'PROCESSED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {ev.status}
                    </span>
                  </td>
                  <td className="px-4 text-slate-500 text-xs">{new Date(ev.processedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
