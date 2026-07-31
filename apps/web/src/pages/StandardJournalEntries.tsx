import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { glApi, dashboardApi } from '../api/client';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';
import { SJEType, type StandardJournalEntry, type SJELine } from '../types/file-maintenance';

// Maps the real /api/v1/gl/admin/journal-templates response (JournalTemplate + lines,
// services/gl-service/prisma/schema.prisma) onto this page's StandardJournalEntry shape.
// The backend models sourceCode 58/88 as the manual/automatic convention used throughout
// this screen's own labels ("Manual (Src 58)" / "Automatic (Src 88)"); scheduling fields
// (lastPostDate, postingType, nextPostDate, numberOfTimes, lockedBy/At) aren't modeled by
// this entity, so they're left honestly null rather than fabricated.
function adaptTemplates(raw: any[]): StandardJournalEntry[] {
  return raw.map((t: any) => ({
    id: t.id,
    name: t.name || t.templateNumber,
    sourceCode: Number(t.sourceCode) || 0,
    referenceNumber: t.templateNumber,
    lastPostDate: null,
    entryType: String(t.sourceCode) === '88' ? SJEType.AUTOMATIC : SJEType.MANUAL,
    notes: t.description ?? '',
    postingType: null,
    nextPostDate: null,
    numberOfTimes: null,
    lockedBy: null,
    lockedAt: null,
    lines: (t.lines ?? []).map((l: any): SJELine => ({
      lineNumber: l.lineOrder,
      glAccount: l.accountCode ?? '',
      description: l.memo ?? '',
      debit: l.isCredit ? 0 : Number(l.amount ?? 0),
      credit: l.isCredit ? Number(l.amount ?? 0) : 0,
      controlNumber: null,
    })),
  }));
}

type Tab = 'overview' | 'detail';

export default function StandardJournalEntries() {
  const [tab, setTab] = useState<Tab>('overview');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | SJEType>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<StandardJournalEntry | null>(null);

  const { data: rawTemplates, isLoading, isError } = useQuery({
    queryKey: ['sje-templates'], queryFn: () => glApi.getTemplates(), retry: false,
  });
  const { data: summary } = useQuery({
    queryKey: ['sje-company-name'], queryFn: dashboardApi.getSummary, retry: false, staleTime: 60_000,
  });
  const entries: StandardJournalEntry[] = useMemo(() => adaptTemplates(rawTemplates ?? []), [rawTemplates]);

  const manualEntries = useMemo(() => entries.filter(e => e.entryType === SJEType.MANUAL), [entries]);
  const autoEntries = useMemo(() => entries.filter(e => e.entryType === SJEType.AUTOMATIC), [entries]);

  const filtered = useMemo(() =>
    entries.filter(e =>
      (typeFilter === 'all' || e.entryType === typeFilter) &&
      (!search || e.name.toLowerCase().includes(search.toLowerCase()) || e.referenceNumber.toLowerCase().includes(search.toLowerCase()))
    ), [entries, typeFilter, search]);

  const totalDebits = (lines: SJELine[]) => lines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = (lines: SJELine[]) => lines.reduce((s, l) => s + l.credit, 0);
  const isBalanced = (lines: SJELine[]) => Math.abs(totalDebits(lines) - totalCredits(lines)) < 0.01;

  if ((isLoading || isError || entries.length === 0) && tab === 'overview') {
    return (
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Standard Journal Entries</h1>
          <p className="text-sm text-gray-500 mt-0.5">Recurring and template journal entries. Source: GL Service.</p>
        </div>
        <div className="text-center py-16">
          <div className="text-gray-300 text-5xl mb-4">📓</div>
          <p className="text-gray-500 font-medium text-lg">
            {isLoading ? 'Loading standard journal entries…' : isError ? 'Could not load standard journal entries' : 'No standard journal entries yet'}
          </p>
          {!isLoading && (
            <p className="text-sm text-gray-400 mt-2 max-w-md mx-auto">
              {isError
                ? 'The GL service did not return template data. Try refreshing, or check GL service health.'
                : 'Standard Journal Entries (SJEs) like monthly depreciation, rent accruals, and insurance amortization will appear here once configured. Use Manual Journal Entry to create new entries.'}
            </p>
          )}
        </div>
      </div>
    );
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = (list: StandardJournalEntry[]) => {
    const allSelected = list.every(e => selectedIds.has(e.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      list.forEach(e => allSelected ? next.delete(e.id) : next.add(e.id));
      return next;
    });
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Standard Journal Entries</h2>
          <p className="text-sm text-gray-500">{summary?.companyName ?? 'AutoMate Accounting'} • STDJNL</p>
        </div>
        <HelpButton help={SCREEN_HELP['standard-journal-entries']} />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-5 gap-3">
        <KPI label="Total SJEs" value={entries.length} />
        <KPI label="Manual (Src 58)" value={manualEntries.length} />
        <KPI label="Automatic (Src 88)" value={autoEntries.length} />
        <KPI label="Selected to Post" value={selectedIds.size} color={selectedIds.size > 0 ? 'text-amacc-600' : undefined} />
        <KPI label="Unbalanced" value={entries.filter(e => !isBalanced(e.lines)).length} color="text-red-600" />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {([['overview', 'Overview'], ['detail', 'Entry Detail']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-amacc-600 text-amacc-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {/* Controls */}
          <div className="flex gap-3 items-center">
            <input type="text" placeholder="Search by name or reference..." value={search} onChange={e => setSearch(e.target.value)}
              className="border rounded px-3 py-2 text-sm w-72" />
            <div className="flex gap-1">
              {(['all', SJEType.MANUAL, SJEType.AUTOMATIC] as const).map(t => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border ${typeFilter === t ? 'bg-amacc-600 text-white border-amacc-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                  {t === 'all' ? 'All' : t}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            {selectedIds.size > 0 && (
              <button className="bg-green-600 text-white px-4 py-2 rounded text-sm font-medium">
                Post Selected ({selectedIds.size})
              </button>
            )}
          </div>

          {/* Two-Panel Layout */}
          <div className="grid grid-cols-2 gap-4">
            {/* Manual Panel */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b flex items-center justify-between bg-brand-light">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">Manual Entries (Source 58)</h3>
                  <span className="bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded text-[10px] font-bold">Recurring</span>
                </div>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={manualEntries.length > 0 && manualEntries.every(e => selectedIds.has(e.id))}
                    onChange={() => toggleAll(manualEntries)} className="rounded" />
                  Select All
                </label>
              </div>
              <div className="divide-y">
                {manualEntries.filter(e => filtered.includes(e)).map(entry => (
                  <SJERow key={entry.id} entry={entry} checked={selectedIds.has(entry.id)}
                    onToggle={() => toggleSelect(entry.id)}
                    onOpen={() => { setSelected(entry); setTab('detail'); }}
                    isBalanced={isBalanced(entry.lines)}
                    totalDebits={totalDebits(entry.lines)} />
                ))}
                {manualEntries.filter(e => filtered.includes(e)).length === 0 && (
                  <p className="py-6 text-center text-gray-400 text-sm">No manual entries</p>
                )}
              </div>
            </div>

            {/* Automatic Panel */}
            <div className="bg-white rounded-lg shadow">
              <div className="px-4 py-3 border-b flex items-center justify-between bg-amber-50">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">Automatic Entries (Source 88)</h3>
                  <span className="bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded text-[10px] font-bold">Standard</span>
                </div>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="checkbox" checked={autoEntries.length > 0 && autoEntries.every(e => selectedIds.has(e.id))}
                    onChange={() => toggleAll(autoEntries)} className="rounded" />
                  Select All
                </label>
              </div>
              <div className="divide-y">
                {autoEntries.filter(e => filtered.includes(e)).map(entry => (
                  <SJERow key={entry.id} entry={entry} checked={selectedIds.has(entry.id)}
                    onToggle={() => toggleSelect(entry.id)}
                    onOpen={() => { setSelected(entry); setTab('detail'); }}
                    isBalanced={isBalanced(entry.lines)}
                    totalDebits={totalDebits(entry.lines)} />
                ))}
                {autoEntries.filter(e => filtered.includes(e)).length === 0 && (
                  <p className="py-6 text-center text-gray-400 text-sm">No automatic entries</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'detail' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-5">
          {!selected ? (
            <p className="text-gray-400 text-sm">Select an entry from the overview to view details.</p>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold">{selected.name}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${selected.entryType === SJEType.MANUAL ? 'bg-brand-light text-brand' : 'bg-amber-100 text-amber-700'}`}>
                      {selected.entryType} — Source {selected.sourceCode}
                    </span>
                    {!isBalanced(selected.lines) && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">⚠ UNBALANCED</span>}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{selected.notes}</p>
                </div>
                <button onClick={() => { setSelected(null); setTab('overview'); }} className="text-sm text-gray-500 hover:text-gray-700">← Back</button>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <DetailField label="Reference" value={selected.referenceNumber} />
                <DetailField label="Last Posted" value={selected.lastPostDate ?? 'Never'} />
                {selected.entryType === SJEType.AUTOMATIC && (
                  <>
                    <DetailField label="Next Post Date" value={selected.nextPostDate ?? '—'} />
                    <DetailField label="Frequency" value={selected.postingType ?? '—'} />
                  </>
                )}
              </div>

              {/* Lines Table */}
              <div>
                <h4 className="font-semibold text-sm mb-2">Journal Lines</h4>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-gray-500 border-b bg-gray-50">
                    <th className="px-3 py-2">#</th><th className="py-2">GL Account</th><th className="py-2">Description</th>
                    <th className="py-2">Control #</th><th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th>
                  </tr></thead>
                  <tbody>
                    {selected.lines.map(line => (
                      <tr key={line.lineNumber} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-gray-400">{line.lineNumber}</td>
                        <td className="py-2 font-mono font-bold text-amacc-700">{line.glAccount}</td>
                        <td className="py-2">{line.description}</td>
                        <td className="py-2 font-mono text-xs">{line.controlNumber ?? '—'}</td>
                        <td className="py-2 text-right font-mono">{line.debit > 0 ? `$${line.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''}</td>
                        <td className="py-2 text-right font-mono text-red-600">{line.credit > 0 ? `$${line.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-bold">
                      <td colSpan={4} className="px-3 py-2 text-right">Totals:</td>
                      <td className="py-2 text-right font-mono">${totalDebits(selected.lines).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="py-2 text-right font-mono text-red-600">${totalCredits(selected.lines).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                    {!isBalanced(selected.lines) && (
                      <tr>
                        <td colSpan={4} className="px-3 py-1 text-right text-xs text-red-600">Difference:</td>
                        <td colSpan={2} className="py-1 text-right font-mono text-red-600 font-bold">
                          ${Math.abs(totalDebits(selected.lines) - totalCredits(selected.lines)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2 border-t">
                <button className="bg-green-600 text-white px-4 py-2 rounded text-sm"
                  disabled={!isBalanced(selected.lines)}>
                  Post Entry
                </button>
                <button className="bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm">Reverse</button>
                <button className="bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm">Duplicate</button>
                <button className="bg-gray-200 text-gray-700 px-3 py-2 rounded text-sm">Export CSV</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SJERow({ entry, checked, onToggle, onOpen, isBalanced: balanced, totalDebits }: {
  entry: StandardJournalEntry; checked: boolean; onToggle: () => void; onOpen: () => void;
  isBalanced: boolean; totalDebits: number;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
      <input type="checkbox" checked={checked} onChange={onToggle} className="rounded" />
      <div className="flex-1 cursor-pointer" onClick={onOpen}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{entry.name}</span>
          {!balanced && <span className="bg-red-100 text-red-600 px-1 py-0.5 rounded text-[9px] font-bold">UNBAL</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
          <span className="font-mono">{entry.referenceNumber}</span>
          <span>{entry.lines.length} lines</span>
          <span className="font-mono">${totalDebits.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          {entry.lastPostDate && <span>Last: {entry.lastPostDate}</span>}
        </div>
      </div>
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
