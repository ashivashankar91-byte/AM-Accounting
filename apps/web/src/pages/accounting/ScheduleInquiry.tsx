import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Printer, ChevronDown, X, Loader2, AlertCircle } from 'lucide-react';
import { scheduleApi } from '../../api/client';
import TransactionDetailPopup from '../../components/accounting/TransactionDetailPopup';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—';

type SavedSet = { name: string; scheduleIds: string[] };

interface SchedulePopupProps {
  onSelect: (id: string, name: string) => void;
  onClose: () => void;
}

function ScheduleSelectPopup({ onSelect, onClose }: SchedulePopupProps) {
  const { data, isLoading } = useQuery<any[]>({
    queryKey: ['schedules'],
    queryFn: scheduleApi.list,
    retry: false,
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded shadow-xl flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t">
          <span className="text-sm font-semibold">Select Schedule</span>
          <button onClick={onClose}><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin text-brand" />
            </div>
          )}
          {!isLoading && (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-16">#</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Name</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Type</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((s: any) => (
                  <tr
                    key={s.id}
                    className="h-9 border-b border-gray-100 hover:bg-brand-light cursor-pointer"
                    onDoubleClick={() => onSelect(s.id, s.name ?? s.scheduleName ?? '')}
                    onClick={() => onSelect(s.id, s.name ?? s.scheduleName ?? '')}
                  >
                    <td className="px-3 font-mono">{s.scheduleNum ?? s.id}</td>
                    <td className="px-3">{s.name ?? s.scheduleName ?? '—'}</td>
                    <td className="px-3">{s.type ?? s.scheduleType ?? '—'}</td>
                  </tr>
                ))}
                {!isLoading && (data ?? []).length === 0 && (
                  <tr><td colSpan={3} className="text-center py-6 text-gray-400">No schedules found.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-2 border-t border-gray-200 flex justify-end">
          <button className="h-8 px-4 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

interface ControlPickerPopupProps {
  onSelect: (ctrlNum: string, name: string) => void;
  onClose: () => void;
}

function ControlPickerPopup({ onSelect, onClose }: ControlPickerPopupProps) {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery<any[]>({
    queryKey: ['control-search', search],
    queryFn: () => scheduleApi.getAging(`search=${encodeURIComponent(search)}`),
    enabled: search.length > 0,
    retry: false,
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded shadow-xl flex flex-col max-h-[70vh]">
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t">
          <span className="text-sm font-semibold">Select Control</span>
          <button onClick={onClose}><X size={15} /></button>
        </div>
        <div className="px-4 py-2 border-b border-gray-200">
          <input
            className="h-8 w-full border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin text-brand" />
            </div>
          )}
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Ctrl#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Name</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Phone</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Street</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">City</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((c: any, i: number) => (
                <tr
                  key={c.controlNum ?? i}
                  className="h-9 border-b border-gray-100 hover:bg-brand-light cursor-pointer"
                  onDoubleClick={() => onSelect(c.controlNum ?? '', c.name ?? '')}
                  onClick={() => onSelect(c.controlNum ?? '', c.name ?? '')}
                >
                  <td className="px-3 font-mono">{c.controlNum ?? '—'}</td>
                  <td className="px-3">{c.name ?? '—'}</td>
                  <td className="px-3 font-mono">{c.phone ?? '—'}</td>
                  <td className="px-3">{c.street ?? '—'}</td>
                  <td className="px-3">{c.city ?? '—'}</td>
                </tr>
              ))}
              {!isLoading && search.length > 0 && (data ?? []).length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-gray-400">No results.</td></tr>
              )}
              {search.length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-gray-400">Enter a name to search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-gray-200 flex justify-end">
          <button className="h-8 px-4 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

interface ScheduleSetModalProps {
  onClose: () => void;
  currentScheduleId: string;
}

function ScheduleSetModal({ onClose, currentScheduleId }: ScheduleSetModalProps) {
  const [setName, setSetName] = useState('');
  const [sets, setSets] = useState<SavedSet[]>(() => {
    try { return JSON.parse(localStorage.getItem('schedule-sets') ?? '[]'); } catch { return []; }
  });
  const [error, setError] = useState('');

  const persist = (updated: SavedSet[]) => {
    setSets(updated);
    localStorage.setItem('schedule-sets', JSON.stringify(updated));
  };

  const save = () => {
    if (!setName.trim()) { setError('Set name is required.'); return; }
    const exists = sets.find((s) => s.name === setName.trim());
    if (exists) { setError('A set with that name already exists.'); return; }
    persist([...sets, { name: setName.trim(), scheduleIds: currentScheduleId ? [currentScheduleId] : [] }]);
    setSetName('');
    setError('');
  };

  const remove = (name: string) => persist(sets.filter((s) => s.name !== name));

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded shadow-xl">
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t">
          <span className="text-sm font-semibold">Schedule Sets</span>
          <button onClick={onClose}><X size={15} /></button>
        </div>
        <div className="p-4">
          <div className="flex gap-2 mb-3">
            <input
              className="h-8 flex-1 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder="Set name…"
              value={setName}
              onChange={(e) => { setSetName(e.target.value); setError(''); }}
            />
            <button className="h-8 px-3 text-xs bg-brand text-white rounded hover:bg-brand-hover" onClick={save}>Save</button>
          </div>
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
          {sets.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No saved sets.</p>}
          <div className="flex flex-col gap-1 max-h-52 overflow-auto">
            {sets.map((s) => (
              <div key={s.name} className="flex items-center justify-between px-2 py-1 border border-gray-200 rounded text-xs">
                <span className="font-medium">{s.name}</span>
                <span className="text-gray-400 mr-auto ml-2">{s.scheduleIds.length} schedule(s)</span>
                <button className="text-red-500 hover:text-red-700 ml-2" onClick={() => remove(s.name)}>Delete</button>
              </div>
            ))}
          </div>
        </div>
        <div className="px-4 py-2 border-t border-gray-200 flex justify-end">
          <button className="h-8 px-4 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function ScheduleInquiry() {
  const paramAreaRef = useRef<HTMLDivElement>(null);

  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [selectedScheduleName, setSelectedScheduleName] = useState('');
  const [controlNum, setControlNum] = useState('');
  const [thruDate, setThruDate] = useState(new Date().toISOString().slice(0, 10));
  const [showZero, setShowZero] = useState(false);
  const [isSearched, setIsSearched] = useState(false);

  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [showControlPicker, setShowControlPicker] = useState(false);
  const [showSetModal, setShowSetModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const [selectedTxnId, setSelectedTxnId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailHighlightAcct, setDetailHighlightAcct] = useState<string | undefined>(undefined);

  const [searchError, setSearchError] = useState<string | null>(null);

  const { data: scheduleDetail } = useQuery<any>({
    queryKey: ['schedule-detail', selectedScheduleId],
    queryFn: () => scheduleApi.getById(selectedScheduleId),
    enabled: !!selectedScheduleId,
    retry: false,
  });

  const glColumns: { accountNum: string; label: string }[] =
    scheduleDetail?.glAccounts ?? [
      { accountNum: '202', label: '202' },
      { accountNum: '202N', label: '202N' },
    ];

  const agingParams = selectedScheduleId
    ? `scheduleId=${selectedScheduleId}&thruDate=${thruDate}${controlNum ? `&controlNum=${encodeURIComponent(controlNum)}` : ''}${showZero ? '' : '&hideZero=true'}`
    : '';

  const { data: results, isLoading, error: queryError, refetch } = useQuery<any>({
    queryKey: ['schedule-aging', selectedScheduleId, controlNum, thruDate, showZero],
    queryFn: () => scheduleApi.getAging(agingParams),
    enabled: false,
    retry: false,
  });

  const doSearch = () => {
    if (!selectedScheduleId) { setSearchError('Please select a schedule first.'); return; }
    setSearchError(null);
    setIsSearched(true);
    refetch();
  };

  const handleParamKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey && e.key === 's') { e.preventDefault(); doSearch(); }
  };

  const rows: any[] = Array.isArray(results) ? results : results?.rows ?? [];

  const computeTotals = () => {
    const totals: Record<string, number> = {};
    glColumns.forEach((c) => { totals[c.accountNum] = 0; });
    rows.forEach((r: any) => {
      glColumns.forEach((c) => {
        totals[c.accountNum] = (totals[c.accountNum] ?? 0) + (Number(r[c.accountNum] ?? r.amounts?.[c.accountNum] ?? 0));
      });
    });
    return totals;
  };

  const totals = computeTotals();

  const isSummaryMode = !controlNum;

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">

      {/* Parameter bar */}
      <div
        ref={paramAreaRef}
        className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3"
        onKeyDown={handleParamKeyDown}
      >
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Schedule:</label>
          <input
            className="h-8 w-24 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={selectedScheduleId}
            onChange={(e) => setSelectedScheduleId(e.target.value)}
            placeholder="#"
          />
          <button
            className="h-8 px-2 border border-gray-300 rounded text-xs hover:bg-gray-100"
            onClick={() => setShowSchedulePicker(true)}
          >
            ...
          </button>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Name:</label>
          <input
            readOnly
            className="h-8 w-40 border border-gray-200 rounded px-2 text-xs bg-gray-50 text-gray-600"
            value={selectedScheduleName}
            placeholder="(auto-populated)"
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Control#:</label>
          <input
            className="h-8 w-32 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={controlNum}
            onChange={(e) => setControlNum(e.target.value)}
            placeholder="(blank=all)"
          />
          <button
            className="h-8 px-2 border border-gray-300 rounded text-xs hover:bg-gray-100"
            onClick={() => setShowControlPicker(true)}
          >
            ...
          </button>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Thru Date:</label>
          <input
            type="date"
            className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
            value={thruDate}
            onChange={(e) => setThruDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="checkbox"
            id="showZero"
            className="rounded"
            checked={showZero}
            onChange={(e) => setShowZero(e.target.checked)}
          />
          <label htmlFor="showZero" className="text-xs text-gray-600 whitespace-nowrap">Show Zero Balance</label>
        </div>
        <button
          className="h-8 px-4 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium"
          onClick={doSearch}
        >
          <Search size={13} />
          Search
          <span className="text-blue-300 font-normal ml-0.5">Alt+S</span>
        </button>
        {searchError && (
          <span className="text-xs text-red-600 flex items-center gap-1">
            <AlertCircle size={13} /> {searchError}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto pb-12">
        {!isSearched && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Select a schedule and click Search to view results.
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-brand" />
          </div>
        )}

        {queryError && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} />
            {(queryError as Error).message}
          </div>
        )}

        {isSearched && !isLoading && !queryError && isSummaryMode && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Control#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Description</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-20">Age (days)</th>
                {glColumns.map((c) => (
                  <th key={c.accountNum} className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-28 font-mono">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={3 + glColumns.length} className="text-center py-8 text-gray-400">No results found.</td></tr>
              )}
              {rows.map((r: any, i: number) => (
                <tr key={r.controlNum ?? i} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{r.controlNum ?? '—'}</td>
                  <td className="px-3">{r.description ?? r.name ?? '—'}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{r.ageDays ?? r.age ?? '—'}</td>
                  {glColumns.map((c) => {
                    const val = Number(r[c.accountNum] ?? r.amounts?.[c.accountNum] ?? 0);
                    return (
                      <td key={c.accountNum} className={`px-3 text-right font-mono tabular-nums ${val < 0 ? 'text-red-600' : ''}`}>
                        {val < 0 ? `(${fmt(Math.abs(val))})` : fmt(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Summary / total row */}
              {rows.length > 0 && (
                <tr className="h-9 bg-gray-100 font-semibold border-t-2 border-gray-300">
                  <td className="px-3 font-mono">0000000000</td>
                  <td className="px-3">TOTAL</td>
                  <td className="px-3 text-right font-mono">—</td>
                  {glColumns.map((c) => {
                    const val = totals[c.accountNum] ?? 0;
                    return (
                      <td key={c.accountNum} className={`px-3 text-right font-mono tabular-nums ${val < 0 ? 'text-red-600' : ''}`}>
                        {val < 0 ? `(${fmt(Math.abs(val))})` : fmt(val)}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        )}

        {isSearched && !isLoading && !queryError && !isSummaryMode && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Date</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-12">Src</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Ref No.</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-16">Account</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Apply To</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-28">Amount</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">No transactions found for control {controlNum}.</td></tr>
              )}
              {rows.map((r: any, i: number) => {
                const amount = Number(r.amount ?? 0);
                return (
                  <tr
                    key={r.id ?? i}
                    className="h-9 border-b border-gray-100 hover:bg-brand-light cursor-pointer"
                    onDoubleClick={() => {
                      setSelectedTxnId(r.transactionId ?? r.id ?? null);
                      setDetailHighlightAcct(r.accountCode ?? r.account ?? undefined);
                      setDetailOpen(true);
                    }}
                  >
                    <td className="px-3 font-mono">{fmtDate(r.date ?? r.entryDate ?? '')}</td>
                    <td className="px-3 font-mono">{r.sourceCode ?? r.src ?? '—'}</td>
                    <td className="px-3 font-mono">{r.refNo ?? r.referenceNumber ?? '—'}</td>
                    <td className="px-3 font-mono">{r.accountCode ?? r.account ?? '—'}</td>
                    <td className="px-3 font-mono">{r.applyTo ?? '—'}</td>
                    <td className={`px-3 text-right font-mono tabular-nums ${amount < 0 ? 'text-red-600' : ''}`}>
                      {amount < 0 ? `(${fmt(Math.abs(amount))})` : fmt(amount)}
                    </td>
                    <td className="px-3">{r.comment ?? r.description ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Fixed bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex items-center gap-2 px-4 py-2 z-10">
        <button
          className="h-8 px-3 text-xs flex items-center gap-1.5 border border-gray-300 rounded hover:bg-gray-100"
          onClick={() => window.print()}
        >
          <Printer size={13} />
          Print
        </button>
        <div className="relative">
          <button
            className="h-8 px-3 text-xs flex items-center gap-1 border border-gray-300 rounded hover:bg-gray-100"
            onClick={() => setShowMoreMenu((v) => !v)}
          >
            More
            <ChevronDown size={12} />
          </button>
          {showMoreMenu && (
            <div className="absolute bottom-10 left-0 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[140px] z-20">
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100"
                onClick={() => { window.print(); setShowMoreMenu(false); }}
              >
                Save as PDF
              </button>
            </div>
          )}
        </div>
        <button
          className="h-8 px-3 text-xs flex items-center gap-1.5 border border-gray-300 rounded hover:bg-gray-100"
          onClick={() => setShowSetModal(true)}
        >
          Schedule Set
        </button>
      </div>

      {/* Popups */}
      {showSchedulePicker && (
        <ScheduleSelectPopup
          onSelect={(id, name) => {
            setSelectedScheduleId(id);
            setSelectedScheduleName(name);
            setShowSchedulePicker(false);
          }}
          onClose={() => setShowSchedulePicker(false)}
        />
      )}

      {showControlPicker && (
        <ControlPickerPopup
          onSelect={(ctrlNum) => {
            setControlNum(ctrlNum);
            setShowControlPicker(false);
          }}
          onClose={() => setShowControlPicker(false)}
        />
      )}

      {showSetModal && (
        <ScheduleSetModal
          currentScheduleId={selectedScheduleId}
          onClose={() => setShowSetModal(false)}
        />
      )}

      <TransactionDetailPopup
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        transactionId={selectedTxnId}
        highlightAccountId={detailHighlightAcct}
      />
    </div>
  );
}
