// NS-034: MFG/DCS Communications — Program 30

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Radio,
  Building2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Clock,
  Upload,
  Download,
} from 'lucide-react';
import PageLoader from '../../components/PageLoader';
import { glApi } from '../../api/client';

// ── Types ────────────────────────────────────────────────────────
type OEM = 'GM' | 'Ford' | 'Toyota' | 'Honda' | 'BMW' | 'Mercedes' | 'Stellantis' | 'Hyundai';
type CommType = 'Import' | 'Export' | 'Status Check';
type CommStatus = 'SUCCESS' | 'FAILED' | 'PENDING';

interface OEMStatus {
  connected: boolean;
  lastComm: string;
  lastStatus: CommStatus;
  recordsProcessed: number;
  errors: number;
  nextScheduled: string;
}

interface HistoryRow {
  id: string;
  dateTime: string;
  oem: OEM;
  type: CommType;
  status: CommStatus;
  records: number;
  durationMs: number;
  user: string;
}

// ── Mock data ────────────────────────────────────────────────────
const MOCK_STATUS: Record<OEM, OEMStatus> = {
  GM:         { connected: true,  lastComm: '2026-05-20 09:14:22', lastStatus: 'SUCCESS', recordsProcessed: 1247, errors: 0,  nextScheduled: '2026-05-21 06:00:00' },
  Ford:       { connected: true,  lastComm: '2026-05-20 08:30:11', lastStatus: 'SUCCESS', recordsProcessed:  892, errors: 0,  nextScheduled: '2026-05-21 06:30:00' },
  Toyota:     { connected: true,  lastComm: '2026-05-20 07:55:44', lastStatus: 'SUCCESS', recordsProcessed:  634, errors: 0,  nextScheduled: '2026-05-21 07:00:00' },
  Honda:      { connected: false, lastComm: '2026-05-19 18:22:08', lastStatus: 'FAILED',  recordsProcessed:    0, errors: 3,  nextScheduled: '2026-05-20 18:30:00' },
  BMW:        { connected: true,  lastComm: '2026-05-20 06:45:00', lastStatus: 'SUCCESS', recordsProcessed:  218, errors: 0,  nextScheduled: '2026-05-21 06:45:00' },
  Mercedes:   { connected: true,  lastComm: '2026-05-20 06:45:00', lastStatus: 'SUCCESS', recordsProcessed:  174, errors: 0,  nextScheduled: '2026-05-21 06:45:00' },
  Stellantis: { connected: true,  lastComm: '2026-05-20 09:00:15', lastStatus: 'SUCCESS', recordsProcessed:  509, errors: 0,  nextScheduled: '2026-05-21 09:00:00' },
  Hyundai:    { connected: false, lastComm: '2026-05-20 02:10:00', lastStatus: 'PENDING', recordsProcessed:    0, errors: 0,  nextScheduled: '2026-05-20 10:00:00' },
};

const MOCK_HISTORY: HistoryRow[] = [
  { id: 'h1', dateTime: '2026-05-20 09:14:22', oem: 'GM',         type: 'Import',       status: 'SUCCESS', records: 1247, durationMs: 4821, user: 'system' },
  { id: 'h2', dateTime: '2026-05-20 08:30:11', oem: 'Ford',       type: 'Export',       status: 'SUCCESS', records:  892, durationMs: 3104, user: 'system' },
  { id: 'h3', dateTime: '2026-05-20 07:55:44', oem: 'Toyota',     type: 'Import',       status: 'SUCCESS', records:  634, durationMs: 2390, user: 'system' },
  { id: 'h4', dateTime: '2026-05-19 18:22:08', oem: 'Honda',      type: 'Import',       status: 'FAILED',  records:    0, durationMs: 1200, user: 'system' },
  { id: 'h5', dateTime: '2026-05-20 06:45:00', oem: 'BMW',        type: 'Status Check', status: 'SUCCESS', records:  218, durationMs:  980, user: 'hdatta' },
  { id: 'h6', dateTime: '2026-05-20 09:00:15', oem: 'Stellantis', type: 'Export',       status: 'SUCCESS', records:  509, durationMs: 2774, user: 'system' },
  { id: 'h7', dateTime: '2026-05-20 02:10:00', oem: 'Hyundai',    type: 'Import',       status: 'PENDING', records:    0, durationMs:    0, user: 'system' },
  { id: 'h8', dateTime: '2026-05-19 09:00:00', oem: 'GM',         type: 'Import',       status: 'SUCCESS', records: 1189, durationMs: 4600, user: 'system' },
];

// ── Sub-components ───────────────────────────────────────────────
function StatusBadge({ status }: { status: CommStatus }) {
  const cls: Record<CommStatus, string> = {
    SUCCESS: 'bg-green-50 text-green-700 ring-green-600/20',
    FAILED:  'bg-red-50 text-red-700 ring-red-600/20',
    PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  };
  const icons: Record<CommStatus, React.ReactNode> = {
    SUCCESS: <CheckCircle className="w-3 h-3" />,
    FAILED:  <AlertTriangle className="w-3 h-3" />,
    PENDING: <Clock className="w-3 h-3" />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ring-1 ring-inset ${cls[status]}`}>
      {icons[status]}{status}
    </span>
  );
}

function ConnectionDot({ connected, unknown }: { connected: boolean; unknown?: boolean }) {
  const cls = unknown
    ? 'bg-amber-400'
    : connected
      ? 'bg-green-500'
      : 'bg-red-500';
  const label = unknown ? 'Unknown' : connected ? 'Connected' : 'Disconnected';
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`w-2.5 h-2.5 rounded-full ${cls} shadow-sm`} />
      <span className="text-gray-700 font-medium">{label}</span>
    </span>
  );
}

// ── Toast ────────────────────────────────────────────────────────
function Toast({ msg, type, onDismiss }: { msg: string; type: 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium
        ${type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}
    >
      {type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
      {msg}
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100 text-lg leading-none">&times;</button>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────
const OEMS: OEM[] = ['GM', 'Ford', 'Toyota', 'Honda', 'BMW', 'Mercedes', 'Stellantis', 'Hyundai'];
const COMM_TYPES: CommType[] = ['Import', 'Export', 'Status Check'];

export default function MFGDCSCommunications() {
  const queryClient = useQueryClient();

  const [selectedOEM, setSelectedOEM] = useState<OEM>('GM');
  const [commType, setCommType] = useState<CommType>('Import');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Fetch tenant system config (real API call — DCS status is mock)
  const { isLoading: configLoading } = useQuery({
    queryKey: ['system-config'],
    queryFn: () => glApi.getSystemConfig(),
    staleTime: 60_000,
  });

  // Mock DCS run mutation
  const runMutation = useMutation({
    mutationFn: (): Promise<void> =>
      new Promise((resolve, reject) => {
        setTimeout(() => {
          // Honda is always FAILED in mock
          if (selectedOEM === 'Honda') {
            reject(new Error('DCS connection refused by OEM gateway'));
          } else {
            resolve();
          }
        }, 2000);
      }),
    onSuccess: () => {
      setToast({ msg: `${selectedOEM} ${commType} completed successfully`, type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['system-config'] });
    },
    onError: (err: Error) => {
      setToast({ msg: `Communication failed: ${err.message}`, type: 'error' });
    },
  });

  const status = MOCK_STATUS[selectedOEM];
  const isUnknown = status.lastStatus === 'PENDING' && !status.connected;

  if (configLoading) return <PageLoader page="MFG/DCS Communications" service="gl-service" port={3001} />;

  const commTypeIcon: Record<CommType, React.ReactNode> = {
    Import:         <Upload className="w-4 h-4" />,
    Export:         <Download className="w-4 h-4" />,
    'Status Check': <RefreshCw className="w-4 h-4" />,
  };

  return (
    <div className="max-w-4xl mx-auto p-6 font-[Inter,sans-serif]">
      {toast && (
        <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Building2 className="w-8 h-8 text-brand" />
          MFG/DCS Communications
        </h1>
        <p className="text-gray-500 mt-1">Program 30 — Manufacturer DCS/EDI Interface</p>
      </div>

      {/* OEM Configuration */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">OEM Configuration</h2>
        <div className="flex flex-wrap gap-6 items-start">
          {/* OEM Selector */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">OEM / Manufacturer</label>
            <select
              value={selectedOEM}
              onChange={(e) => setSelectedOEM(e.target.value as OEM)}
              className="h-8 w-48 border border-gray-300 rounded px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {OEMS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          {/* Communication Type */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Communication Type</label>
            <div className="flex gap-4 h-8 items-center">
              {COMM_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                  <input
                    type="radio"
                    name="commType"
                    value={t}
                    checked={commType === t}
                    onChange={() => setCommType(t)}
                    className="accent-blue-700"
                  />
                  <Radio className="w-3 h-3 text-gray-400 hidden" />
                  {t}
                </label>
              ))}
            </div>
          </div>

          {/* Connection Status */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Connection Status</label>
            <div className="h-8 flex items-center">
              <ConnectionDot connected={status.connected} unknown={isUnknown} />
            </div>
          </div>
        </div>
      </div>

      {/* Status Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">{selectedOEM} — Current Status</h2>
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white text-sm font-medium rounded-md
              hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {runMutation.isPending ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Running…
              </>
            ) : (
              <>
                {commTypeIcon[commType]}
                Run {commType}
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Last Communication</div>
            <div className="font-mono text-sm text-gray-900">{status.lastComm}</div>
            <div className="mt-1">
              <StatusBadge status={status.lastStatus} />
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Next Scheduled</div>
            <div className="font-mono text-sm text-gray-900">{status.nextScheduled}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Records Processed</div>
            <div className="font-[JetBrains_Mono,monospace] text-lg font-semibold text-gray-900 text-right">
              {status.recordsProcessed.toLocaleString()}
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Errors</div>
            <div className={`font-[JetBrains_Mono,monospace] text-lg font-semibold text-right ${status.errors > 0 ? 'text-red-600' : 'text-gray-900'}`}>
              {status.errors}
            </div>
          </div>
        </div>
      </div>

      {/* History Log */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Communication History (Last 10)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Date / Time</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">OEM</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Type</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">Records</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wide">Duration</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MOCK_HISTORY.map((row) => (
                <tr key={row.id} className="h-9 hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-gray-800 text-xs">{row.dateTime}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{row.oem}</td>
                  <td className="px-4 py-2 text-gray-700">{row.type}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2 text-right font-[JetBrains_Mono,monospace] text-gray-900">
                    {row.records.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-[JetBrains_Mono,monospace] text-gray-600 text-xs">
                    {row.durationMs > 0 ? `${(row.durationMs / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="px-4 py-2 text-gray-600 font-mono text-xs">{row.user}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
