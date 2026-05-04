import { useState, useMemo } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';
import {
  ScheduleType, SCHEDULE_TYPE_LABELS, SCHEDULE_TYPE_RISK,
  PurgeCode, PURGE_CODE_LABELS,
  LEE_HYUNDAI_SCHEDULES,
  type ScheduleFormat,
} from '../types/file-maintenance';

type Tab = 'grid' | 'detail' | 'crosscheck';
type TypeFilter = 'all' | '1' | '2' | '3' | '4' | '5';

const RISK_COLORS = { low: 'bg-green-100 text-green-800', medium: 'bg-amber-100 text-amber-800', high: 'bg-red-100 text-red-800' };
const TYPE_CHIP_COLORS: Record<number, string> = {
  1: 'bg-gray-100 text-gray-700', 2: 'bg-blue-100 text-blue-700',
  3: 'bg-red-100 text-red-700', 4: 'bg-amber-100 text-amber-700', 5: 'bg-purple-100 text-purple-700',
};

function healthStatus(s: ScheduleFormat): 'green' | 'amber' | 'red' {
  if (s.glAccounts.length === 0) return 'red';
  if (s.scheduleType === ScheduleType.TYPE_3 && s.glAccounts.length < 2) return 'amber';
  return 'green';
}

const HEALTH_DOT = { green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500' };

export default function Schedules() {
  const [tab, setTab] = useState<Tab>('grid');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [selected, setSelected] = useState<ScheduleFormat | null>(null);

  const schedules = LEE_HYUNDAI_SCHEDULES;

  const filtered = useMemo(() =>
    schedules.filter(s =>
      (typeFilter === 'all' || s.scheduleType === Number(typeFilter)) &&
      (!search || s.title.toLowerCase().includes(search.toLowerCase()) || String(s.scheduleNumber).includes(search))
    ), [schedules, typeFilter, search]);

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: schedules.length };
    schedules.forEach(s => { c[s.scheduleType] = (c[s.scheduleType] || 0) + 1; });
    return c;
  }, [schedules]);

  const healthSummary = useMemo(() => {
    const h = { green: 0, amber: 0, red: 0 };
    schedules.forEach(s => h[healthStatus(s)]++);
    return h;
  }, [schedules]);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div><h1 className="text-2xl font-bold">Schedule Format File Maintenance</h1><p className="text-sm text-gray-500 mt-0.5">Manage schedule formats for financial reporting and reconciliation. Source: COA Service.</p></div>
          <p className="text-sm text-gray-500">Lee Hyundai Inc. — Company 03 • SCHEDPR / SCHDUPKY</p>
        </div>
        <HelpButton help={SCREEN_HELP.schedules} />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-5 gap-3">
        <KPI label="Total Schedules" value={schedules.length} />
        <KPI label="Type 3 (Open Item)" value={typeCounts[3] ?? 0} color="text-red-600" />
        <KPI label="Health: Green" value={healthSummary.green} color="text-green-600" />
        <KPI label="Health: Amber" value={healthSummary.amber} color="text-amber-600" />
        <KPI label="Health: Red" value={healthSummary.red} color="text-red-600" />
      </div>

      {/* Type Filter Chips */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTypeFilter('all')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${typeFilter === 'all' ? 'bg-amacc-600 text-white border-amacc-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
          All ({typeCounts.all})
        </button>
        {[1,2,3,4,5].map(t => (
          <button key={t} onClick={() => setTypeFilter(typeFilter === String(t) ? 'all' : String(t) as TypeFilter)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${typeFilter === String(t) ? 'bg-amacc-600 text-white border-amacc-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            Type {t} ({typeCounts[t] ?? 0})
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {([['grid', 'Schedule Grid'], ['detail', 'Detail'], ['crosscheck', 'Cross-Check (F7)']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Grid Tab */}
      {tab === 'grid' && (
        <>
          <input type="text" placeholder="Search by schedule # or title..." value={search} onChange={e => setSearch(e.target.value)}
            className="border rounded px-3 py-2 text-sm w-80" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(s => {
              const h = healthStatus(s);
              const risk = SCHEDULE_TYPE_RISK[s.scheduleType];
              return (
                <div key={s.scheduleNumber}
                  onClick={() => { setSelected(s); setTab('detail'); }}
                  className="bg-white rounded-lg shadow p-4 cursor-pointer hover:shadow-md transition-shadow border-l-4"
                  style={{ borderLeftColor: h === 'green' ? '#22c55e' : h === 'amber' ? '#f59e0b' : '#ef4444' }}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[h]}`} />
                      <span className="font-mono font-bold text-lg text-amacc-700">#{s.scheduleNumber}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${TYPE_CHIP_COLORS[s.scheduleType]}`}>
                      Type {s.scheduleType}
                    </span>
                  </div>
                  <h4 className="font-semibold text-sm mb-2">{s.title}</h4>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {s.glAccounts.map((gl, i) => (
                      <span key={i} className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[10px] font-mono">
                        {gl.glAccount}{gl.controlSuffix ? `(${gl.controlSuffix})` : ''}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <span className={`px-1.5 py-0.5 rounded ${RISK_COLORS[risk]}`}>{risk} risk</span>
                    <span>Purge: {s.purgeCode}</span>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <p className="col-span-3 text-center text-gray-400 py-8">No schedules match filter</p>}
          </div>
        </>
      )}

      {/* Detail Tab */}
      {tab === 'detail' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-5">
          {!selected ? (
            <p className="text-gray-400 text-sm">Select a schedule from the grid to view details.</p>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className={`w-3 h-3 rounded-full ${HEALTH_DOT[healthStatus(selected)]}`} />
                  <h3 className="text-xl font-bold">#{selected.scheduleNumber} — {selected.title}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${TYPE_CHIP_COLORS[selected.scheduleType]}`}>
                    Type {selected.scheduleType}
                  </span>
                </div>
                <button onClick={() => { setSelected(null); setTab('grid'); }} className="text-sm text-gray-500 hover:text-gray-700">← Back to Grid</button>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <DetailField label="Schedule Type" value={`${selected.scheduleType} — ${SCHEDULE_TYPE_LABELS[selected.scheduleType]}`} />
                <DetailField label="Purge Code" value={`${selected.purgeCode} — ${PURGE_CODE_LABELS[selected.purgeCode]}`} />
                <DetailField label="Name Display" value={selected.nameDisplay} />
                <DetailField label="Control Required" value={selected.controlRequired ? 'Yes' : 'No'} />
                <DetailField label="Report Sequence" value={selected.reportSequence === 'C' ? 'By Control #' : selected.reportSequence === 'N' ? 'By Name' : 'By Age'} />
                <DetailField label="GL Account Count" value={String(selected.glAccounts.length)} />
              </div>

              {/* GL Account Links */}
              <div>
                <h4 className="font-semibold text-sm mb-2">Linked GL Accounts (max 5)</h4>
                <div className="space-y-2">
                  {selected.glAccounts.map((gl, i) => (
                    <div key={i} className="flex items-center gap-3 bg-gray-50 rounded px-3 py-2">
                      <span className="font-mono font-bold text-amacc-700">{gl.glAccount}</span>
                      {gl.controlSuffix && (
                        <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold">
                          {gl.controlSuffix === 'L' ? 'Lookup' : gl.controlSuffix === 'S' ? 'Stock#' : gl.controlSuffix === 'D' ? 'Detail' : gl.controlSuffix === 'A' ? 'Apply-To' : gl.controlSuffix}
                        </span>
                      )}
                    </div>
                  ))}
                  {selected.glAccounts.length === 0 && <p className="text-red-500 text-sm">⚠ No GL accounts linked — this schedule will not function</p>}
                </div>
              </div>

              {/* Risk Note for Type 3 */}
              {selected.scheduleType === ScheduleType.TYPE_3 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm">
                  <h4 className="font-bold text-red-800">⚠ Type 3 — Open Item (Multi-Account)</h4>
                  <p className="text-red-700 mt-1">
                    This is the highest-risk schedule type. Multiple GL accounts share a single subsidiary ledger.
                    EOM purge processes must reconcile across all linked accounts. Mismatched control numbers
                    between accounts will result in orphaned schedule lines.
                  </p>
                </div>
              )}

              {/* Purge Code Warning */}
              {selected.purgeCode === PurgeCode.CODE_6 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
                  <h4 className="font-bold text-amber-800">Purge Code 6 — Balance Forward by Control#</h4>
                  <p className="text-amber-700 mt-1">
                    Lines on this schedule are carried forward indefinitely until manually cleared.
                    Examples: OEM payables, 401K contributions, JMA/HPP. Monitor for stale balances.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Cross-Check Tab (replaces legacy F7) */}
      {tab === 'crosscheck' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="font-semibold text-lg">Schedule Cross-Check Validation</h3>
            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs">Replaces legacy F7</span>
          </div>
          <p className="text-sm text-gray-600">
            Validates that each schedule's subsidiary ledger balances match the corresponding GL account balances.
            Discrepancies indicate missing or duplicate schedule lines.
          </p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
              <th className="px-4 py-2.5">Sched #</th><th className="py-2.5">Title</th>
              <th className="py-2.5">Type</th><th className="py-2.5">GL Accounts</th>
              <th className="py-2.5 text-right">GL Balance</th><th className="py-2.5 text-right">Sched Balance</th>
              <th className="py-2.5 text-right">Variance</th><th className="py-2.5">Status</th>
            </tr></thead>
            <tbody>
              {schedules.map(s => {
                // Simulated — in production, these come from API
                const glBal = Math.round(Math.random() * 500000);
                const variance = Math.random() > 0.85 ? Math.round(Math.random() * 5000 - 2500) : 0;
                const schedBal = glBal + variance;
                const ok = variance === 0;
                return (
                  <tr key={s.scheduleNumber} className={`border-b border-gray-50 ${!ok ? 'bg-red-50/50' : ''}`}>
                    <td className="px-4 py-2 font-mono font-bold text-amacc-700">#{s.scheduleNumber}</td>
                    <td className="py-2">{s.title}</td>
                    <td className="py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${TYPE_CHIP_COLORS[s.scheduleType]}`}>T{s.scheduleType}</span></td>
                    <td className="py-2 font-mono text-xs">{s.glAccounts.map(g => g.glAccount).join(', ')}</td>
                    <td className="py-2 text-right font-mono">${glBal.toLocaleString()}</td>
                    <td className="py-2 text-right font-mono">${schedBal.toLocaleString()}</td>
                    <td className={`py-2 text-right font-mono font-bold ${!ok ? 'text-red-600' : 'text-green-600'}`}>
                      {variance === 0 ? '$0' : `$${variance.toLocaleString()}`}
                    </td>
                    <td className="py-2">
                      {ok ? <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs">✓ OK</span>
                        : <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs">✗ Variance</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? 'text-amacc-700'}`}>{value}</div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-medium text-sm mt-0.5">{value}</dd>
    </div>
  );
}
