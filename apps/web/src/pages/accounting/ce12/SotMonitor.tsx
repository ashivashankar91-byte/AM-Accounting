// CE-12 / S081 — SOT Monitor. `/accounting/vehicles/sot`. Read-only
// composition dashboard: aging summary tiles (mirrors ScheduleOpenItems.tsx
// AgingTab's bucketTotals tile pattern), every tile drillable to the
// underlying list of open floorplan items past the grace period, plus
// escalation-state display. No posting ceremonies on this screen — the
// package is explicit that S081 is READ-ONLY composition.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { floorplanApi } from '../../../api/ce12-vehicle-floorplan-client';

const fmt = (n: number | string | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return String(n);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—';

const ESCALATION_BADGE: Record<string, string> = {
  WATCH: 'bg-amber-100 text-amber-700',
  ESCALATED: 'bg-red-100 text-red-700',
  RESOLVED: 'bg-emerald-100 text-emerald-700',
};

const TILE_COLOR: Record<string, string> = {
  WATCH: 'border-amber-300 bg-amber-50',
  ESCALATED: 'border-red-300 bg-red-50',
  RESOLVED: 'border-emerald-300 bg-emerald-50',
  ALL: 'border-brand bg-brand-light',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium tracking-wide ${ESCALATION_BADGE[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

export default function SotMonitor() {
  const [selectedState, setSelectedState] = useState<'WATCH' | 'ESCALATED' | 'RESOLVED' | null>(null);

  const { data: dashboard, isLoading: dashLoading, error: dashError, refetch: refetchDash } = useQuery<{ tiles: { WATCH: number; ESCALATED: number; RESOLVED: number }; totalDelivered: number }>({
    queryKey: ['ce12-sot-dashboard'],
    queryFn: () => floorplanApi.getSotDashboard(),
  });

  const { data: aging, isLoading: agingLoading, error: agingError, refetch: refetchAging } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-sot-aging'],
    queryFn: () => floorplanApi.getSotAging(),
  });

  const isLoading = dashLoading || agingLoading;
  const error = dashError ?? agingError;
  const rows = (aging?.items ?? []).filter((r: any) => !selectedState || r.escalationState === selectedState);

  function refresh() {
    refetchDash();
    refetchAging();
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 items-center justify-center">
        <Loader2 size={24} className="animate-spin text-brand" />
      </div>
    );
  }

  if (error) {
    const st = (error as any)?.status;
    return (
      <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm p-4">
        <div className="flex items-center gap-2 p-4 text-red-700 text-sm" data-testid="sot-error-banner">
          <AlertCircle size={16} /> {st === 403 ? 'You do not have permission to view the SOT Monitor.' : (error as Error).message}
        </div>
      </div>
    );
  }

  const tiles = dashboard?.tiles ?? { WATCH: 0, ESCALATED: 0, RESOLVED: 0 };

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-gray-900">Sold-Out-of-Trust (SOT) Monitor</h1>
          <p className="text-xs text-gray-500 mt-0.5">Read-only: units delivered whose floorplan liability item remains unrelieved beyond the configured grace period. Click a tile to drill into its rows.</p>
        </div>
        <button data-testid="sot-refresh-button" className="h-8 px-3 border border-gray-300 text-xs rounded hover:bg-gray-100 flex items-center gap-1.5 font-medium" onClick={refresh}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="flex gap-3 mb-4">
          <button
            data-testid="sot-tile-all"
            className={`flex-1 border rounded p-3 text-left ${!selectedState ? TILE_COLOR.ALL : 'border-gray-200 bg-white'}`}
            onClick={() => setSelectedState(null)}
          >
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Total Delivered</div>
            <div className="font-mono text-lg font-semibold tabular-nums">{dashboard?.totalDelivered ?? 0}</div>
          </button>
          {(['WATCH', 'ESCALATED', 'RESOLVED'] as const).map((state) => (
            <button
              key={state}
              data-testid={`sot-tile-${state.toLowerCase()}`}
              className={`flex-1 border rounded p-3 text-left ${selectedState === state ? TILE_COLOR[state] : 'border-gray-200 bg-white hover:bg-gray-50'}`}
              onClick={() => setSelectedState(state)}
            >
              <div className="text-[10px] uppercase tracking-wide text-gray-500">{state}</div>
              <div className="font-mono text-lg font-semibold tabular-nums">{tiles[state] ?? 0}</div>
            </button>
          ))}
        </div>

        <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
          {selectedState ? `${selectedState} — drill-down` : 'All exposed units (aging, most exposed first)'}
        </div>
        {rows.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="sot-empty-state">
            {selectedState ? `No units in ${selectedState} state.` : 'No delivered units are currently exposed past the grace period.'}
          </div>
        )}
        {rows.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Apply#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">VIN</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Stock#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Exposed Since</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Exposure Days</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Remaining Balance</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Escalation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.sotExceptionId} data-testid={`sot-aging-row-${r.applyNumber}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{r.applyNumber}</td>
                  <td className="px-3 font-mono">{r.vin ?? '—'}</td>
                  <td className="px-3 font-mono">{r.stockNumber ?? '—'}</td>
                  <td className="px-3">{fmtDate(r.exposureSince)}</td>
                  <td className={`px-3 text-right font-mono tabular-nums ${r.exposureDays > 0 ? 'text-red-600 font-semibold' : ''}`}>{r.exposureDays}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(r.remainingBalance)}</td>
                  <td className="px-3"><StatusBadge status={r.escalationState} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
