import { useState, useMemo } from 'react';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';
import {
  type JournalSource,
  type BrandFilter,
  type SourceValidationIssue,
  BalanceMethod,
  OEMBrand,
  ReservedType,
  LEE_MOTOR_CO_SOURCES,
  PROTECTED_SOURCE_CODES,
  OEM_BRAND_PAIRS,
  BALANCE_METHOD_LABELS,
  getSourceBrandFilter,
  validateSources,
} from '../types/journal-sources';

// ── Shared UI helpers ────────────────────────────────────────────

function StatusPill({ label, color }: { label: string; color: string }) {
  const cls: Record<string, string> = {
    green:  'bg-green-50 text-green-700 ring-green-600/20',
    amber:  'bg-amber-50 text-amber-700 ring-amber-600/20',
    red:    'bg-red-50 text-red-700 ring-red-600/20',
    blue:   'bg-brand-light text-brand ring-blue-600/20',
    gray:   'bg-gray-100 text-gray-600 ring-gray-500/20',
    purple: 'bg-purple-50 text-purple-700 ring-purple-600/20',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ring-1 ring-inset ${cls[color] || cls.gray}`}>{label}</span>;
}

function brandLabel(s: JournalSource): string {
  if (s.reservedType) return 'System';
  if (s.isSystemSource && !s.reservedType) return 'Protected';
  if (s.oemBrand) return s.oemBrand;
  return 'Shared';
}

// ── Detail Panel ─────────────────────────────────────────────────

function DetailPanel({ source, onClose, issues }: {
  source: JournalSource;
  onClose: () => void;
  issues: SourceValidationIssue[];
}) {
  const isProtected = PROTECTED_SOURCE_CODES.has(source.code) || source.reservedType != null;
  const sourceIssues = issues.filter(i => i.code === source.code);
  const pair = OEM_BRAND_PAIRS.find(p => p.ford === source.code || p.nissan === source.code);

  return (
    <div className="bg-white rounded-lg border shadow-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-mono font-bold text-amacc-700">{source.code}</span>
          {isProtected && <span title="Protected source — cannot modify flags">🔒</span>}
          <span className="text-lg font-semibold">{source.name}</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
      </div>

      {sourceIssues.length > 0 && (
        <div className="space-y-1">
          {sourceIssues.map((issue, i) => (
            <div key={i} className={`text-xs px-3 py-1.5 rounded ${
              issue.severity === 'error' ? 'bg-red-50 text-red-700' :
              issue.severity === 'warning' ? 'bg-amber-50 text-amber-700' :
              'bg-brand-light text-brand'
            }`}>
              ⚠ {issue.message}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        <div>
          <span className="text-gray-500">OEM Brand</span>
          <div className="mt-0.5 font-medium">{source.oemBrand ?? 'None (brand-agnostic)'}</div>
        </div>
        <div>
          <span className="text-gray-500">Balance Method</span>
          <div className="mt-0.5 font-medium">
            <span className={source.balanceMethod === BalanceMethod.SOURCE ? 'text-amber-600' : ''}>
              {source.balanceMethod === BalanceMethod.DOCUMENT ? 'D — Document' : 'S — Source (Batch)'}
            </span>
            <div className="text-xs text-gray-400 mt-0.5">{BALANCE_METHOD_LABELS[source.balanceMethod]}</div>
          </div>
        </div>
        <div>
          <span className="text-gray-500">Count Units</span>
          <div className="mt-0.5 font-medium flex items-center gap-1.5">
            {isProtected ? (
              <span>{source.countUnits ? '✓ Yes' : '— No'}</span>
            ) : (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" defaultChecked={source.countUnits} disabled={isProtected}
                  className="rounded border-gray-300 text-amacc-600 focus:ring-amacc-500" />
                {source.countUnits ? 'Yes — unit counts tracked' : 'No — units not tracked'}
              </label>
            )}
          </div>
        </div>
        <div>
          <span className="text-gray-500">Auto-Post</span>
          <div className="mt-0.5 font-medium flex items-center gap-1.5">
            {isProtected ? (
              <span>{source.autoPost ? '✓ Immediate' : '— Manual review'}</span>
            ) : (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" defaultChecked={source.autoPost} disabled={isProtected}
                  className="rounded border-gray-300 text-amacc-600 focus:ring-amacc-500" />
                {source.autoPost ? 'Immediate post' : 'Manual review required'}
              </label>
            )}
          </div>
        </div>
        <div>
          <span className="text-gray-500">Reserved Type</span>
          <div className="mt-0.5 font-medium">{source.reservedType ?? '—'}</div>
        </div>
        <div>
          <span className="text-gray-500">EOM Auto-Post</span>
          <div className="mt-0.5 font-medium">
            {source.autoPostAtEOM
              ? <span className="text-green-600 font-semibold">Yes — included in EOM Step 300</span>
              : <span className="text-gray-400">—</span>}
          </div>
        </div>
        <div>
          <span className="text-gray-500">Source Tag</span>
          <div className="mt-0.5 font-medium">
            {source.sourceTag === 'test'
              ? <span className="text-red-600">TEST</span>
              : <span className="text-green-600">Production</span>}
          </div>
        </div>
        <div>
          <span className="text-gray-500">Last Post Date</span>
          <div className="mt-0.5 font-medium">{source.lastPostDate ?? 'Never'}</div>
        </div>
        <div>
          <span className="text-gray-500">Transaction Count (Lifetime)</span>
          <div className="mt-0.5 font-medium">{source.transactionCount.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-gray-500">Pending Posts</span>
          <div className="mt-0.5 font-medium">
            {source.pendingCount > 0 ? (
              <span className="text-amber-600 font-semibold">{source.pendingCount} awaiting review</span>
            ) : (
              <span className="text-gray-400">0</span>
            )}
          </div>
        </div>
      </div>

      {source.notes && (
        <div className="text-sm text-gray-600 italic bg-gray-50 rounded px-3 py-2">{source.notes}</div>
      )}

      {pair && (
        <div className="text-xs bg-brand-light text-brand rounded px-3 py-2">
          <strong>OEM Brand Pair:</strong> Ford {pair.ford} ↔ Nissan {pair.nissan} ({pair.purpose})
        </div>
      )}

      {source.pendingCount > 0 && (
        <div className="flex gap-2 pt-1">
          <button className="px-3 py-1.5 text-sm bg-amacc-600 text-white rounded hover:bg-amacc-700 transition-colors">
            Review Queue →
          </button>
          <button className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors">
            Post All ({source.pendingCount})
          </button>
        </div>
      )}

      {!source.countUnits && source.code === '80' && (
        <div className="text-xs bg-red-50 text-red-700 rounded px-3 py-2 border border-red-200">
          <strong>⚠ Unit Count Warning:</strong> Source 80 has Count Units = No. Posting to add-units accounts
          (2310, 2400, 2410, etc.) will update dollar balance but NOT unit counts.
          Use vehicle-specific sources (10/11/70/71) for vehicle transactions.
        </div>
      )}

      {source.code === '09' && (
        <div className="text-xs bg-amber-50 text-amber-700 rounded px-3 py-2 border border-amber-200">
          <strong>⚠ Prior Period Posting:</strong> Source 09 posts to the ENDING BALANCES of the prior
          closed month, not current period totals. Changes ripple into this month's opening balance.
          Requires dual authorization + mandatory justification text. After posting, the system
          recalculates current period's opening balance automatically.
        </div>
      )}

      {source.balanceMethod === BalanceMethod.SOURCE && (
        <div className="text-xs bg-amber-50 text-amber-700 rounded px-3 py-2 border border-amber-200">
          <strong>⚠ Source-Level Balancing:</strong> Individual transactions under this source may be
          unbalanced — only the entire posting batch must net to $0.00. If incorrectly assigned,
          an unbalanced transaction can post to the GL without error.
        </div>
      )}

      {source.autoPostAtEOM && (
        <div className="text-xs bg-brand-light text-brand rounded px-3 py-2 border border-brand-border">
          <strong>ℹ EOM Auto-Post:</strong> Entries under this source auto-post during End-of-Month Step 300
          (Final Close). Controller does not need to manually post recurring entries.
        </div>
      )}
    </div>
  );
}

// ── Validation Alerts Panel ──────────────────────────────────────

function ValidationAlerts({ issues }: { issues: SourceValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="bg-white rounded-lg border shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Source Validation ({issues.length})</h3>
      <div className="space-y-1">
        {issues.map((issue, i) => (
          <div key={i} className={`flex items-start gap-2 text-xs px-2 py-1.5 rounded ${
            issue.severity === 'error' ? 'bg-red-50 text-red-700' :
            issue.severity === 'warning' ? 'bg-amber-50 text-amber-700' :
            'bg-brand-light text-brand'
          }`}>
            <span className="shrink-0">{issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️'}</span>
            <span><strong>[{issue.code}]</strong> {issue.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Summary Stats Bar ────────────────────────────────────────────

function SummaryBar({ sources }: { sources: JournalSource[] }) {
  const totalPending = sources.reduce((sum, s) => sum + s.pendingCount, 0);
  const fordCount = sources.filter(s => s.oemBrand === OEMBrand.FORD).length;
  const nissanCount = sources.filter(s => s.oemBrand === OEMBrand.NISSAN).length;
  const sharedCount = sources.filter(s => !s.oemBrand && !s.isSystemSource).length;
  const reservedCount = sources.filter(s => s.isSystemSource).length;
  const autoPostCount = sources.filter(s => s.autoPost).length;
  const eomAutoCount = sources.filter(s => s.autoPostAtEOM).length;
  const sourceLevelCount = sources.filter(s => s.balanceMethod === BalanceMethod.SOURCE).length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {[
        { label: 'Total Sources', value: sources.length, color: '' },
        { label: 'Ford', value: fordCount, color: 'text-brand' },
        { label: 'Nissan', value: nissanCount, color: 'text-red-600' },
        { label: 'Shared', value: sharedCount, color: 'text-gray-600' },
        { label: 'Reserved', value: reservedCount, color: 'text-purple-600' },
        { label: 'Auto-Post', value: `${autoPostCount}${eomAutoCount > 0 ? ` (${eomAutoCount} EOM)` : ''}`, color: 'text-green-600' },
        { label: 'Pending Posts', value: totalPending, color: totalPending > 0 ? 'text-amber-600 font-bold' : 'text-gray-400' },
      ].map((s) => (
        <div key={s.label} className="bg-white rounded-lg border px-3 py-2.5 text-center">
          <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────

export default function JournalSources() {
  const [sources] = useState<JournalSource[]>(LEE_MOTOR_CO_SOURCES);
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState<BrandFilter>('all');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const help = SCREEN_HELP['journal-sources'];
  const issues = useMemo(() => validateSources(sources), [sources]);

  const filtered = useMemo(() => {
    let list = sources;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
    }
    if (brandFilter !== 'all') {
      list = list.filter(s => getSourceBrandFilter(s) === brandFilter);
    }
    return list;
  }, [sources, search, brandFilter]);

  const selected = selectedCode ? sources.find(s => s.code === selectedCode) ?? null : null;

  const brandCounts: Record<BrandFilter, number> = {
    all: sources.length,
    ford: sources.filter(s => getSourceBrandFilter(s) === 'ford').length,
    nissan: sources.filter(s => getSourceBrandFilter(s) === 'nissan').length,
    shared: sources.filter(s => getSourceBrandFilter(s) === 'shared').length,
    reserved: sources.filter(s => getSourceBrandFilter(s) === 'reserved').length,
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div><h1 className="text-2xl font-bold">Journal Sources</h1><p className="text-sm text-gray-500 mt-0.5">Track journal entry sources by DMS brand and source code. Source: Connector Service.</p></div>
          <p className="text-sm text-gray-500 mt-0.5">Company 01 — Lee Motor Co. (Ford + Nissan)</p>
        </div>
        {help && <HelpButton help={help} />}
      </div>

      {/* Summary Bar */}
      <SummaryBar sources={sources} />

      {/* Validation Alerts */}
      <ValidationAlerts issues={issues} />

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search sources..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-amacc-500/30 focus:border-amacc-500"
        />

        <div className="flex gap-1">
          {(['all', 'ford', 'nissan', 'shared', 'reserved'] as BrandFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setBrandFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                brandFilter === f
                  ? 'bg-amacc-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)} ({brandCounts[f]})
            </button>
          ))}
        </div>

        <div className="ml-auto">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-sm bg-amacc-600 text-white px-4 py-2 rounded-lg hover:bg-amacc-700 transition-colors"
          >
            {showAdd ? 'Cancel' : '+ Add Source'}
          </button>
        </div>
      </div>

      {/* Add Source Form */}
      {showAdd && (
        <div className="bg-white rounded-lg shadow border-l-4 border-amacc-500 p-4">
          <h3 className="text-sm font-semibold mb-3">New Journal Source</h3>
          <div className="grid grid-cols-6 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Code</label>
              <input className="w-full mt-1 border rounded px-2.5 py-1.5 text-sm font-mono" placeholder="XX" maxLength={2} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-600">Name</label>
              <input className="w-full mt-1 border rounded px-2.5 py-1.5 text-sm" placeholder="Source name (max 30 chars)" maxLength={30} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">OEM Brand</label>
              <select className="w-full mt-1 border rounded px-2.5 py-1.5 text-sm">
                <option value="">None (shared)</option>
                <option value="Ford">Ford</option>
                <option value="Nissan">Nissan</option>
              </select>
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="rounded" /> Count Units</label>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" /> Auto-Post</label>
            </div>
            <div className="flex items-end">
              <button className="bg-green-600 text-white px-4 py-1.5 rounded text-sm hover:bg-green-700 transition-colors w-full">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content: Table + Detail Panel */}
      <div className={`grid gap-4 ${selected ? 'lg:grid-cols-[1fr_380px]' : ''}`}>
        {/* Sources Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-3 py-2.5 w-16">Code</th>
                <th className="px-3 py-2.5">Name</th>
                <th className="px-3 py-2.5 w-20">OEM</th>
                <th className="px-3 py-2.5 w-20 text-center">Units</th>
                <th className="px-3 py-2.5 w-20 text-center">Post</th>
                <th className="px-3 py-2.5 w-20 text-center">Pending</th>
                <th className="px-3 py-2.5 w-24">Status</th>
                <th className="px-3 py-2.5 w-24">Last Post</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(s => {
                const isSelected = selectedCode === s.code;
                const isProtected = PROTECTED_SOURCE_CODES.has(s.code) || s.reservedType != null;
                const hasIssue = issues.some(i => i.code === s.code);
                return (
                  <tr
                    key={s.code}
                    onClick={() => setSelectedCode(isSelected ? null : s.code)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-amacc-50 border-l-2 border-l-amacc-500' :
                      hasIssue ? 'bg-amber-50/50 hover:bg-amber-50' :
                      'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-3 py-2 font-mono font-bold text-amacc-700">
                      {isProtected && <span className="mr-1 text-xs" title="Protected">🔒</span>}
                      {s.code}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {s.name}
                      {hasIssue && <span className="ml-1.5 text-amber-500" title="Has validation issues">⚠</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill label={brandLabel(s)} color={
                        s.isSystemSource ? 'purple' :
                        s.oemBrand === OEMBrand.FORD ? 'blue' :
                        s.oemBrand === OEMBrand.NISSAN ? 'red' : 'gray'
                      } />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {s.countUnits ? <span className="text-green-600">✓</span> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {s.autoPost
                        ? <span className="text-xs font-medium text-green-600">Auto</span>
                        : <span className="text-xs font-medium text-amber-600">Manual</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {s.pendingCount > 0
                        ? <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 text-xs font-bold bg-amber-100 text-amber-700 rounded-full">{s.pendingCount}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {s.reservedType
                        ? <StatusPill label={s.reservedType} color="purple" />
                        : s.pendingCount > 0
                          ? <StatusPill label="Pending" color="amber" />
                          : <StatusPill label="Active" color="green" />}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {s.lastPostDate ?? '—'}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                  No sources match your filter.
                </td></tr>
              )}
            </tbody>
          </table>
          <div className="px-3 py-2 text-xs text-gray-400 border-t bg-gray-50">
            Showing {filtered.length} of {sources.length} sources
          </div>
        </div>

        {/* Detail Panel */}
        {selected && (
          <DetailPanel source={selected} issues={issues} onClose={() => setSelectedCode(null)} />
        )}
      </div>

      {/* OEM Brand Pair Reference */}
      <div className="bg-white rounded-lg border shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">OEM Brand-Split Pattern — Ford ↔ Nissan</h3>
        <p className="text-xs text-gray-500 mb-3">
          Multi-brand rooftops use parallel source codes per OEM. Each transaction type has a Ford code and a Nissan equivalent.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {OEM_BRAND_PAIRS.map(pair => (
            <div key={pair.ford} className="bg-gray-50 rounded px-2.5 py-2 text-center text-xs">
              <div className="font-semibold text-gray-700">{pair.purpose}</div>
              <div className="mt-1 flex items-center justify-center gap-1">
                <span className="font-mono text-brand">{pair.ford}</span>
                <span className="text-gray-400">↔</span>
                <span className="font-mono text-red-600">{pair.nissan}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AutoPost Pipeline Reference */}
      <div className="bg-white rounded-lg border shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">AutoPost Pipeline</h3>
        <p className="text-xs text-gray-500 mb-3">
          How transactions flow based on source Auto-Post setting. Sources with Auto-Post = Yes bypass human review entirely.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="bg-gray-100 rounded px-3 py-2 text-center">
            <div className="font-semibold">Transaction Created</div>
            <div className="text-gray-500">by any module</div>
          </div>
          <span className="text-gray-400">→</span>
          <div className="flex gap-4">
            <div className="bg-green-50 border border-green-200 rounded px-3 py-2 text-center">
              <div className="font-semibold text-green-700">Auto-Post = Yes</div>
              <div className="text-green-600">Post immediately → GL</div>
              <div className="text-green-500">No human review</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-center">
              <div className="font-semibold text-amber-700">Auto-Post = No</div>
              <div className="text-amber-600">→ Pending Review queue</div>
              <div className="text-amber-500">Stuck &gt; 15 min = alert</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
