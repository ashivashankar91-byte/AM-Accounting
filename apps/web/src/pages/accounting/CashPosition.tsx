/**
 * S057 — Cash Position Dashboard.
 *
 * IMPORTANT: All monetary values are rendered DIRECTLY from cashPositionApi.get()
 * response. Zero client-side arithmetic is performed on money fields — every
 * number shown comes from the server. (S057 requirement: no client-side summation.)
 */
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshCw, Download, ExternalLink } from 'lucide-react';
import { cashPositionApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, PageHeader, Badge, EmptyState } from '../../components/ui';

const fmtMoney = (n: number | string | undefined | null) => {
  if (n == null || n === '') return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (isNaN(num)) return '—';
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};

const fmtDate = (d: string | undefined) => (d ? new Date(d).toLocaleString('en-US') : '—');

// Drill-through routes — wired by a separate routing agent.
const TILE_ROUTES: Record<string, string> = {
  drawers: '/accounting/cash',
  deposits: '/accounting/cash/deposits',
  settlements: '/accounting/cash/settlements',
  sweeps: '/accounting/cash/sweeps',
  bankReconciliation: '/accounting/bank-recon/sessions',
  bank_reconciliation: '/accounting/bank-recon/sessions',
  recon: '/accounting/bank-recon/sessions',
};

function resolveTileRoute(key: string): string {
  const lower = key.toLowerCase();
  for (const [k, route] of Object.entries(TILE_ROUTES)) {
    if (lower.includes(k.toLowerCase())) return route;
  }
  return '#';
}

function PositionTile({ label, value, tileKey }: { label: string; value: any; tileKey: string }) {
  const route = resolveTileRoute(tileKey);
  const content = (
    <div
      data-testid={`cashpos-tile-${tileKey}`}
      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all duration-150 cursor-pointer group"
      style={{ borderTopWidth: 3, borderTopColor: '#1D4ED8' }}
    >
      <div className="flex items-start justify-between mb-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-brand">{label}</p>
        <ExternalLink className="w-3.5 h-3.5 text-slate-300 group-hover:text-brand transition-colors" />
      </div>
      {typeof value === 'object' && value !== null ? (
        // Nested object — render key/value pairs
        <dl className="space-y-1 mt-2">
          {Object.entries(value).map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs">
              <dt className="text-slate-500 capitalize">{k.replace(/_/g, ' ')}</dt>
              <dd className="font-mono font-semibold text-slate-800">{typeof v === 'number' ? fmtMoney(v) : String(v ?? '—')}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-2xl font-extrabold font-mono text-slate-900 mt-1" data-testid={`cashpos-tile-value-${tileKey}`}>{fmtMoney(value)}</p>
      )}
    </div>
  );

  return route !== '#' ? <Link to={route} className="block no-underline" data-testid={`cashpos-tile-link-${tileKey}`}>{content}</Link> : content;
}

export default function CashPosition() {
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);
  // BUG FIX (CE-09 cert): the API requires entityId + businessDate query
  // params (400 BAD_REQUEST without them) — this screen previously called
  // cashPositionApi.get() with no params at all, so it always failed.
  // Default businessDate to today; entityId defaults empty and must be
  // entered, mirroring the entityId text-input pattern used on the other
  // new CE-09 screens (e.g. Deposits.tsx `deposit-entity-id`).
  const [entityId, setEntityId] = useState('');
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: position, isLoading, error, refetch } = useQuery({
    queryKey: ['cash-position', entityId, businessDate],
    queryFn: () => cashPositionApi.get(`entityId=${encodeURIComponent(entityId)}&businessDate=${encodeURIComponent(businessDate)}`),
    enabled: !!entityId && !!businessDate,
    retry: false,
  });

  const { data: exports, refetch: refetchExports } = useQuery({
    queryKey: ['cash-position-exports'],
    queryFn: () => cashPositionApi.listExports(),
    retry: false,
  });

  const exportMutation = useMutation({
    mutationFn: () => cashPositionApi.exportPosition({ entityId, businessDate }),
    onSuccess: () => {
      setExportSuccess(true);
      setExportError(null);
      refetchExports();
      setTimeout(() => setExportSuccess(false), 4000);
    },
    onError: (err: any) => setExportError(err.message ?? 'Export failed'),
  });

  const errAny = error as any;
  if (errAny?.status === 401 || errAny?.status === 403) {
    return (
      <div className="p-6">
        <PageHeader title="Cash Position (S057)" />
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700 font-semibold">Unauthorized</p>
          <p className="text-red-600 text-sm mt-1">You do not have permission to view the cash position.</p>
        </div>
      </div>
    );
  }

  if (isLoading) return <PageLoader page="Cash Position" service="cash-service" />;
  if (error) return <PageError error={error as Error} serviceName="cash-service" retry={refetch} />;

  const pos = (position as any) ?? {};
  const exportsList: any[] = Array.isArray(exports) ? exports : [];

  // Render tiles from whatever keys the API response contains — defensive, no hardcoded shape.
  const tileEntries = Object.entries(pos).filter(([, v]) => v != null && typeof v !== 'function');

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Cash Position (S057)"
        subtitle="Server-computed authoritative cash position. All values are from the API — no client-side arithmetic."
        actions={
          <div className="flex gap-2 items-center">
            <label className="text-xs text-slate-500">
              Entity ID{' '}
              <input
                data-testid="cashpos-entity-id"
                className="border rounded px-2 py-1 text-sm"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="entity-kunes-delavan"
              />
            </label>
            <label className="text-xs text-slate-500">
              As of{' '}
              <input
                type="date"
                data-testid="cashpos-business-date"
                className="border rounded px-2 py-1 text-sm"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
              />
            </label>
            <Btn variant="secondary" size="md" icon={<RefreshCw className="w-4 h-4" />} onClick={() => refetch()}>
              Refresh
            </Btn>
            <Btn
              variant="primary" size="md" icon={<Download className="w-4 h-4" />}
              loading={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
              data-testid="cashpos-export"
            >
              Export
            </Btn>
          </div>
        }
      />

      {exportError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{exportError}</div>
      )}
      {exportSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700" data-testid="cashpos-export-success">
          Position exported successfully.
        </div>
      )}

      {tileEntries.length === 0 ? (
        <EmptyState icon="💰" title="No position data" description="No cash position data returned from the server." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {tileEntries.map(([key, value]) => (
            <PositionTile
              key={key}
              tileKey={key}
              label={key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
              value={value}
            />
          ))}
        </div>
      )}

      {/* Quick nav tiles for known cash sub-screens */}
      <div>
        <h2 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">Navigate To</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {([
            { label: 'Cash Drawers', to: '/accounting/cash' },
            { label: 'Deposits', to: '/accounting/cash/deposits' },
            { label: 'Settlements', to: '/accounting/cash/settlements' },
            { label: 'Sweeps', to: '/accounting/cash/sweeps' },
            { label: 'Bank Recon', to: '/accounting/bank-recon/sessions' },
          ] as const).map(({ label, to }) => (
            <Link
              key={to}
              to={to}
              data-testid={`cashpos-nav-${to.split('/').pop()}`}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-brand/20 bg-brand/5 text-brand text-sm font-semibold py-3 hover:bg-brand hover:text-white transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>

      {/* Past exports */}
      <div>
        <h2 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">Past Exports</h2>
        {exportsList.length === 0 ? (
          <EmptyState icon="📁" title="No exports yet" description="Export the current position to create a record." />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b-2 border-slate-200">
                  {['Export ID', 'Created At', 'Format', 'Status'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exportsList.map((ex, i) => (
                  <tr key={ex.id ?? i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs font-mono text-slate-500">{ex.id?.slice(0, 12) ?? '—'}…</td>
                    <td className="px-4 py-3 text-sm">{fmtDate(ex.createdAt)}</td>
                    <td className="px-4 py-3 text-sm">{ex.format ?? ex.type ?? '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      <Badge variant={ex.status === 'COMPLETED' ? 'success' : ex.status === 'FAILED' ? 'danger' : 'neutral'}>
                        {ex.status ?? '—'}
                      </Badge>
                    </td>
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
