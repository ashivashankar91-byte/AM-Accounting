import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Settings, Filter, ChevronDown, ChevronRight, X } from 'lucide-react';
import { glApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, PageHeader, EmptyState } from '../../components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

type DatePreset =
  | 'TODAY' | 'YESTERDAY' | 'MTD' | 'THIS_MONTH' | 'OPEN_MONTH'
  | 'LAST_OPEN_NEXT' | 'LAST_MONTH' | 'LAST_YEAR' | 'NEXT_MONTH'
  | 'THIS_YEAR' | 'YTD' | 'CUSTOM';

type SortField = 'date' | 'ref' | 'control' | 'amount';
type SortDir = 'asc' | 'desc';
type ViewMode = 'detail' | 'summary';

interface GLAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
  balance?: number;
}

interface TxnRow {
  id?: string;
  src: string;
  date: string;
  reference: string;
  controlNumber: string;
  amount: number;
  comments?: string;
  journalEntryId?: string;
}

interface InquiryResult {
  beginningBalance: number;
  transactions: TxnRow[];
  endingBalance?: number;
}

interface MultiGLResult {
  account: GLAccount;
  beginningBalance: number;
  transactions: TxnRow[];
  endingBalance: number;
}

interface Filters {
  controlNums: string[];
  sources: string[];
  minAmountEnabled: boolean;
  minAmount: string;
  maxAmountEnabled: boolean;
  maxAmount: string;
}

interface Prefs {
  viewMode: ViewMode;
  datePreset: DatePreset;
  sortField: SortField;
  ascending: boolean;
}

const DEFAULT_PREFS: Prefs = {
  viewMode: 'detail',
  datePreset: 'MTD',
  sortField: 'date',
  ascending: false,
};

const PREFS_KEY = 'gl-inquiry-prefs';

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  MTD: 'Month to Date',
  THIS_MONTH: 'This Month',
  OPEN_MONTH: 'Open Month',
  LAST_OPEN_NEXT: 'Last / Open / Next',
  LAST_MONTH: 'Last Month',
  LAST_YEAR: 'Last Year',
  NEXT_MONTH: 'Next Month',
  THIS_YEAR: 'This Year',
  YTD: 'Year to Date',
  CUSTOM: 'Custom',
};

const DATE_PRESETS: DatePreset[] = [
  'TODAY', 'YESTERDAY', 'MTD', 'THIS_MONTH', 'OPEN_MONTH',
  'LAST_OPEN_NEXT', 'LAST_MONTH', 'LAST_YEAR', 'NEXT_MONTH',
  'THIS_YEAR', 'YTD', 'CUSTOM',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDisplay(iso: string): string {
  if (!iso) return '';
  const [y, m, day] = iso.split('-');
  return `${m}/${day}/${y}`;
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function lastOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function computeDateRange(
  preset: DatePreset,
  openMonthRange: { from: string; to: string } | null,
): { from: string; to: string } | null {
  if (preset === 'CUSTOM') return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (preset) {
    case 'TODAY':
      return { from: fmtDate(today), to: fmtDate(today) };
    case 'YESTERDAY': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: fmtDate(y), to: fmtDate(y) };
    }
    case 'MTD':
      return { from: fmtDate(firstOfMonth(today)), to: fmtDate(today) };
    case 'THIS_MONTH':
      return { from: fmtDate(firstOfMonth(today)), to: fmtDate(lastOfMonth(today)) };
    case 'OPEN_MONTH':
      return openMonthRange;
    case 'LAST_OPEN_NEXT': {
      const lastStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const nextEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
      return { from: fmtDate(lastStart), to: fmtDate(nextEnd) };
    }
    case 'LAST_MONTH': {
      const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { from: fmtDate(lm), to: fmtDate(lastOfMonth(lm)) };
    }
    case 'LAST_YEAR':
      return {
        from: `${today.getFullYear() - 1}-01-01`,
        to: `${today.getFullYear() - 1}-12-31`,
      };
    case 'NEXT_MONTH': {
      const nm = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return { from: fmtDate(nm), to: fmtDate(lastOfMonth(nm)) };
    }
    case 'THIS_YEAR':
      return {
        from: `${today.getFullYear()}-01-01`,
        to: `${today.getFullYear()}-12-31`,
      };
    case 'YTD':
      return { from: `${today.getFullYear()}-01-01`, to: fmtDate(today) };
    default:
      return null;
  }
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PREFS;
}

function savePrefs(p: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

function applyClientFilters(rows: TxnRow[], filters: Filters): TxnRow[] {
  return rows.filter((r) => {
    if (filters.controlNums.length > 0 && !filters.controlNums.includes(r.controlNumber)) return false;
    if (filters.sources.length > 0 && !filters.sources.includes(r.src)) return false;
    if (filters.minAmountEnabled && filters.minAmount !== '') {
      const mn = parseFloat(filters.minAmount);
      if (!isNaN(mn) && Math.abs(r.amount) < mn) return false;
    }
    if (filters.maxAmountEnabled && filters.maxAmount !== '') {
      const mx = parseFloat(filters.maxAmount);
      if (!isNaN(mx) && Math.abs(r.amount) > mx) return false;
    }
    return true;
  });
}

function sortRows(rows: TxnRow[], field: SortField, dir: SortDir): TxnRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (field) {
      case 'date':
        return sign * a.date.localeCompare(b.date);
      case 'ref':
        return sign * a.reference.localeCompare(b.reference);
      case 'control':
        return sign * a.controlNumber.localeCompare(b.controlNumber);
      case 'amount':
        return sign * (a.amount - b.amount);
    }
  });
}

function buildRunningBalance(beginBalance: number, rows: TxnRow[]): (number)[] {
  const balances: number[] = [];
  let running = beginBalance;
  for (const r of rows) {
    running += r.amount;
    balances.push(running);
  }
  return balances;
}

// ─── GL Account Lookup Popup ───────────────────────────────────────────────────

function GLAccountLookupPopup({
  onSelect,
  onClose,
}: {
  onSelect: (acc: any) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['gl-account-lookup-popup', q],
    queryFn: () => (q.length >= 1 ? glApi.searchAccounts(q) : glApi.getAccounts()),
    staleTime: 30_000,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-[480px] max-h-[520px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold text-gray-800">GL Account Lookup</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-2 border-b">
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by code or name…"
            className="w-full h-8 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {isFetching && (
            <div className="flex items-center justify-center py-6 gap-2 text-gray-400 text-sm">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Searching…
            </div>
          )}
          {!isFetching && (results as any[]).length === 0 && (
            <p className="text-center py-6 text-sm text-gray-400">No accounts found</p>
          )}
          {!isFetching && (results as any[]).map((acc: any) => (
            <button
              key={acc.accountCode ?? acc.account_code}
              className="w-full text-left px-4 py-2 hover:bg-brand-light border-b border-gray-50 flex items-center gap-3"
              onClick={() => { onSelect(acc); onClose(); }}
            >
              <span className="font-mono text-sm font-semibold text-gray-800 w-24 shrink-0">
                {acc.accountCode ?? acc.account_code}
              </span>
              <span className="text-sm text-gray-600 truncate flex-1">
                {acc.accountName ?? acc.description}
              </span>
              <span className="text-xs text-gray-400 shrink-0">
                {acc.accountType ?? acc.type}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Multi-GL Modal ───────────────────────────────────────────────────────────

function MultiGLModal({
  selected,
  onConfirm,
  onClose,
}: {
  selected: any[];
  onConfirm: (accounts: any[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [localSelected, setLocalSelected] = useState<any[]>(selected);

  const { data: allAccounts = [], isFetching } = useQuery({
    queryKey: ['gl-all-accounts'],
    queryFn: glApi.getAccounts,
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return (allAccounts as any[]).filter(
      (a: any) =>
        (a.accountCode ?? a.account_code ?? '').toLowerCase().includes(ql) ||
        (a.accountName ?? a.description ?? '').toLowerCase().includes(ql),
    );
  }, [allAccounts, q]);

  const isSelected = (acc: any) => {
    const code = acc.accountCode ?? acc.account_code;
    return localSelected.some((s) => (s.accountCode ?? s.account_code) === code);
  };

  const addAccount = (acc: any) => {
    if (!isSelected(acc)) setLocalSelected((prev) => [...prev, acc]);
  };

  const removeAccount = (acc: any) => {
    const code = acc.accountCode ?? acc.account_code;
    setLocalSelected((prev) =>
      prev.filter((s) => (s.accountCode ?? s.account_code) !== code),
    );
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-2xl w-[900px] h-[640px] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <span className="font-semibold text-gray-800">Multi-GL Account Selection</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-1/2 border-r flex flex-col">
            <div className="px-4 py-2 border-b">
              <input
                autoFocus
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search accounts…"
                className="w-full h-8 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {isFetching && (
                <div className="flex items-center justify-center py-8 gap-2 text-gray-400 text-sm">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  Loading…
                </div>
              )}
              {!isFetching && filtered.map((acc: any) => {
                const code = acc.accountCode ?? acc.account_code;
                const name = acc.accountName ?? acc.description;
                const type = acc.accountType ?? acc.type;
                return (
                  <div
                    key={code}
                    onDoubleClick={() => addAccount(acc)}
                    className={`flex items-center gap-2 px-4 py-2 border-b border-gray-50 cursor-pointer hover:bg-brand-light ${isSelected(acc) ? 'opacity-40' : ''}`}
                  >
                    <span className="font-mono text-xs font-semibold text-gray-700 w-20 shrink-0">{code}</span>
                    <span className="text-sm text-gray-600 flex-1 truncate">{name}</span>
                    <span className="text-xs text-gray-400 shrink-0">{type}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col items-center justify-center px-2 gap-2 border-r">
            <button
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
              title="Add selected"
              onClick={() => {}}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
              title="Remove selected"
              onClick={() => {}}
            >
              <ChevronDown className="w-4 h-4 rotate-180" />
            </button>
          </div>
          <div className="w-1/2 flex flex-col">
            <div className="px-4 py-2 border-b">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Selected ({localSelected.length})
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {localSelected.length === 0 && (
                <p className="text-center py-10 text-sm text-gray-400">No accounts selected</p>
              )}
              {localSelected.map((acc: any) => {
                const code = acc.accountCode ?? acc.account_code;
                const name = acc.accountName ?? acc.description;
                return (
                  <div
                    key={code}
                    onDoubleClick={() => removeAccount(acc)}
                    className="flex items-center gap-2 px-4 py-2 border-b border-gray-50 cursor-pointer hover:bg-red-50"
                  >
                    <span className="font-mono text-xs font-semibold text-gray-700 w-20 shrink-0">{code}</span>
                    <span className="text-sm text-gray-600 flex-1 truncate">{name}</span>
                    <button
                      className="text-gray-300 hover:text-red-500 shrink-0"
                      onClick={(e) => { e.stopPropagation(); removeAccount(acc); }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t">
          <button
            onClick={onClose}
            className="h-8 px-4 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => { onConfirm(localSelected); onClose(); }}
            className="h-8 px-4 text-sm bg-brand text-white rounded hover:bg-brand-hover"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Filter Dialog ─────────────────────────────────────────────────────────────

function FilterDialog({
  transactions,
  filters,
  onChange,
  onClose,
}: {
  transactions: TxnRow[];
  filters: Filters;
  onChange: (f: Filters) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'control' | 'source' | 'other'>('control');
  const [local, setLocal] = useState<Filters>(filters);

  const allControlNums = useMemo(
    () => [...new Set(transactions.map((r) => r.controlNumber).filter(Boolean))].sort(),
    [transactions],
  );
  const allSources = useMemo(
    () => [...new Set(transactions.map((r) => r.src).filter(Boolean))].sort(),
    [transactions],
  );

  const toggleControl = (c: string) => {
    setLocal((prev) => ({
      ...prev,
      controlNums: prev.controlNums.includes(c)
        ? prev.controlNums.filter((x) => x !== c)
        : [...prev.controlNums, c],
    }));
  };

  const toggleSource = (s: string) => {
    setLocal((prev) => ({
      ...prev,
      sources: prev.sources.includes(s)
        ? prev.sources.filter((x) => x !== s)
        : [...prev.sources, s],
    }));
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const tabClass = (t: string) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t
        ? 'border-blue-700 text-brand'
        : 'border-transparent text-gray-500 hover:text-gray-700'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-[440px] max-h-[520px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold text-gray-800">Filter Transactions</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex border-b">
          <button className={tabClass('control')} onClick={() => setTab('control')}>Control#</button>
          <button className={tabClass('source')} onClick={() => setTab('source')}>Journal Source</button>
          <button className={tabClass('other')} onClick={() => setTab('other')}>Other</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'control' && (
            <div className="space-y-1">
              <div className="flex gap-3 mb-3">
                <button
                  className="text-xs text-brand hover:underline"
                  onClick={() => setLocal((p) => ({ ...p, controlNums: [...allControlNums] }))}
                >
                  Select All
                </button>
                <button
                  className="text-xs text-gray-500 hover:underline"
                  onClick={() => setLocal((p) => ({ ...p, controlNums: [] }))}
                >
                  Clear All
                </button>
              </div>
              {allControlNums.length === 0 && (
                <p className="text-sm text-gray-400">No control numbers in current results</p>
              )}
              {allControlNums.map((c) => (
                <label key={c} className="flex items-center gap-2 cursor-pointer h-7">
                  <input
                    type="checkbox"
                    checked={local.controlNums.includes(c)}
                    onChange={() => toggleControl(c)}
                    className="rounded border-gray-300 text-brand"
                  />
                  <span className="font-mono text-sm">{c}</span>
                </label>
              ))}
            </div>
          )}
          {tab === 'source' && (
            <div className="space-y-1">
              <div className="flex gap-3 mb-3">
                <button
                  className="text-xs text-brand hover:underline"
                  onClick={() => setLocal((p) => ({ ...p, sources: [...allSources] }))}
                >
                  Select All
                </button>
                <button
                  className="text-xs text-gray-500 hover:underline"
                  onClick={() => setLocal((p) => ({ ...p, sources: [] }))}
                >
                  Clear All
                </button>
              </div>
              {allSources.length === 0 && (
                <p className="text-sm text-gray-400">No journal sources in current results</p>
              )}
              {allSources.map((s) => (
                <label key={s} className="flex items-center gap-2 cursor-pointer h-7">
                  <input
                    type="checkbox"
                    checked={local.sources.includes(s)}
                    onChange={() => toggleSource(s)}
                    className="rounded border-gray-300 text-brand"
                  />
                  <span className="font-mono text-sm">{s}</span>
                </label>
              ))}
            </div>
          )}
          {tab === 'other' && (
            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={local.minAmountEnabled}
                  onChange={(e) => setLocal((p) => ({ ...p, minAmountEnabled: e.target.checked }))}
                  className="rounded border-gray-300 text-brand"
                />
                <span className="text-sm text-gray-700 w-24">Min Amount</span>
                <input
                  type="number"
                  value={local.minAmount}
                  onChange={(e) => setLocal((p) => ({ ...p, minAmount: e.target.value }))}
                  disabled={!local.minAmountEnabled}
                  placeholder="0.00"
                  className="h-8 w-32 px-3 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100"
                />
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={local.maxAmountEnabled}
                  onChange={(e) => setLocal((p) => ({ ...p, maxAmountEnabled: e.target.checked }))}
                  className="rounded border-gray-300 text-brand"
                />
                <span className="text-sm text-gray-700 w-24">Max Amount</span>
                <input
                  type="number"
                  value={local.maxAmount}
                  onChange={(e) => setLocal((p) => ({ ...p, maxAmount: e.target.value }))}
                  disabled={!local.maxAmountEnabled}
                  placeholder="0.00"
                  className="h-8 w-32 px-3 text-sm font-mono border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100"
                />
              </label>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-4 py-3 border-t">
          <button
            onClick={() => {
              setLocal({
                controlNums: [],
                sources: [],
                minAmountEnabled: false,
                minAmount: '',
                maxAmountEnabled: false,
                maxAmount: '',
              });
            }}
            className="h-8 px-3 text-sm text-gray-500 hover:text-gray-700"
          >
            Clear All
          </button>
          <button
            onClick={onClose}
            className="h-8 px-4 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => { onChange(local); onClose(); }}
            className="h-8 px-4 text-sm bg-brand text-white rounded hover:bg-brand-hover"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Preferences Modal ────────────────────────────────────────────────────────

function PreferencesModal({
  prefs,
  onSave,
  onClose,
}: {
  prefs: Prefs;
  onSave: (p: Prefs) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Prefs>(prefs);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-[360px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold text-gray-800">GL Inquiry Preferences</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              View Mode
            </label>
            <select
              value={local.viewMode}
              onChange={(e) => setLocal((p) => ({ ...p, viewMode: e.target.value as ViewMode }))}
              className="w-full h-8 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="detail">Detail</option>
              <option value="summary">Summary</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Preferred Date Range
            </label>
            <select
              value={local.datePreset}
              onChange={(e) => setLocal((p) => ({ ...p, datePreset: e.target.value as DatePreset }))}
              className="w-full h-8 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-brand"
            >
              {DATE_PRESETS.map((p) => (
                <option key={p} value={p}>{DATE_PRESET_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Preferred Sort
            </label>
            <select
              value={local.sortField}
              onChange={(e) => setLocal((p) => ({ ...p, sortField: e.target.value as SortField }))}
              className="w-full h-8 px-3 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-brand"
            >
              <option value="date">Date</option>
              <option value="control">Control#</option>
              <option value="ref">Reference#</option>
              <option value="amount">Amount</option>
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={local.ascending}
              onChange={(e) => setLocal((p) => ({ ...p, ascending: e.target.checked }))}
              className="rounded border-gray-300 text-brand"
            />
            <span className="text-sm text-gray-700">Ascending</span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-3 px-4 py-3 border-t">
          <button
            onClick={onClose}
            className="h-8 px-4 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(local); onClose(); }}
            className="h-8 px-4 text-sm bg-brand text-white rounded hover:bg-brand-hover"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Table ─────────────────────────────────────────────────────────────

function DetailTable({ rows, balances }: { rows: TxnRow[]; balances: number[] }) {
  if (rows.length === 0) {
    return (
      <tr>
        <td colSpan={7} className="text-center py-10 text-sm text-gray-400">
          No transactions found for the selected criteria.
        </td>
      </tr>
    );
  }
  return (
    <>
      {rows.map((r, i) => (
        <tr key={r.id ?? i} className="h-9 hover:bg-brand-light border-b border-gray-100">
          <td className="px-3 font-mono text-xs text-gray-600 whitespace-nowrap">{r.src}</td>
          <td className="px-3 text-sm text-gray-700 whitespace-nowrap">{fmtDisplay(r.date)}</td>
          <td className="px-3 font-mono text-xs text-gray-700">{r.reference}</td>
          <td className="px-3 font-mono text-xs text-gray-700">{r.controlNumber}</td>
          <td className={`px-3 font-mono text-sm text-right tabular-nums whitespace-nowrap ${r.amount < 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {fmtMoney(r.amount)}
          </td>
          <td className="px-3 font-mono text-sm text-right tabular-nums whitespace-nowrap text-gray-700">
            {fmtMoney(balances[i])}
          </td>
          <td className="px-3 text-sm text-gray-500 max-w-xs truncate">{r.comments ?? ''}</td>
        </tr>
      ))}
    </>
  );
}

// ─── Summary Table ────────────────────────────────────────────────────────────

function SummaryTable({
  rows,
  showJournalDetail,
}: {
  rows: TxnRow[];
  showJournalDetail: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, TxnRow[]>();
    for (const r of rows) {
      const key = `${r.date}||${r.reference}`;
      const group = map.get(key) ?? [];
      group.push(r);
      map.set(key, group);
    }
    return [...map.entries()].map(([key, txns]) => ({
      key,
      date: txns[0].date,
      reference: txns[0].reference,
      netAmount: txns.reduce((s, t) => s + t.amount, 0),
      txns,
    }));
  }, [rows]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <tr>
        <td colSpan={4} className="text-center py-10 text-sm text-gray-400">
          No transactions found for the selected criteria.
        </td>
      </tr>
    );
  }

  return (
    <>
      {groups.map((g) => (
        <>
          <tr
            key={g.key}
            className="h-9 bg-gray-50 hover:bg-gray-100 border-b border-gray-200 cursor-pointer"
            onClick={() => showJournalDetail && toggle(g.key)}
          >
            <td className="px-3">
              {showJournalDetail && (
                <button className="text-gray-400 hover:text-gray-600 mr-1">
                  {expanded.has(g.key) ? <ChevronDown className="w-3.5 h-3.5 inline" /> : <ChevronRight className="w-3.5 h-3.5 inline" />}
                </button>
              )}
              <span className="text-sm text-gray-700 whitespace-nowrap">{fmtDisplay(g.date)}</span>
            </td>
            <td className="px-3 font-mono text-xs text-gray-700">{g.reference}</td>
            <td className="px-3 text-sm text-gray-500">{g.txns[0].src}</td>
            <td className={`px-3 font-mono text-sm text-right tabular-nums whitespace-nowrap font-semibold ${g.netAmount < 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {fmtMoney(g.netAmount)}
            </td>
          </tr>
          {showJournalDetail && expanded.has(g.key) && g.txns.map((t, i) => (
            <tr key={`${g.key}-${i}`} className="h-9 bg-white border-b border-gray-50 hover:bg-brand-light">
              <td className="px-3 pl-10 text-sm text-gray-500 whitespace-nowrap">{fmtDisplay(t.date)}</td>
              <td className="px-3 font-mono text-xs text-gray-500">{t.controlNumber}</td>
              <td className="px-3 font-mono text-xs text-gray-500">{t.src}</td>
              <td className={`px-3 font-mono text-sm text-right tabular-nums whitespace-nowrap ${t.amount < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                {fmtMoney(t.amount)}
              </td>
            </tr>
          ))}
        </>
      ))}
    </>
  );
}

// ─── Multi-GL Results ─────────────────────────────────────────────────────────

function MultiGLResults({
  results,
  sortField,
  sortDir,
  filters,
  thruDate,
}: {
  results: MultiGLResult[];
  sortField: SortField;
  sortDir: SortDir;
  filters: Filters;
  thruDate: string;
}) {
  const grandTotal = useMemo(
    () => results.reduce((s, r) => s + r.endingBalance, 0),
    [results],
  );

  return (
    <div>
      {results.map((r) => {
        const code = r.account.accountCode ?? (r.account as any).account_code;
        const name = r.account.accountName ?? (r.account as any).description;
        const filtered = applyClientFilters(r.transactions, filters);
        const sorted = sortRows(filtered, sortField, sortDir);
        const balances = buildRunningBalance(r.beginningBalance, sorted);
        return (
          <div key={code} className="border-b-2 border-gray-200 mb-2">
            <div className="bg-gray-100 px-4 py-2 flex items-center gap-3 font-semibold text-sm text-gray-800">
              <span>Balance as of {fmtDisplay(thruDate)}</span>
              <span className="font-mono">{code}</span>
              <span>{name}</span>
              <span className="ml-auto font-mono tabular-nums">
                Beg. Balance: {fmtMoney(r.beginningBalance)}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="h-9 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-3 text-left font-semibold">Src</th>
                  <th className="px-3 text-left font-semibold">Date</th>
                  <th className="px-3 text-left font-semibold">Reference</th>
                  <th className="px-3 text-left font-semibold">Control#</th>
                  <th className="px-3 text-right font-semibold">Amount</th>
                  <th className="px-3 text-right font-semibold">Running Balance</th>
                  <th className="px-3 text-left font-semibold">Comments</th>
                </tr>
              </thead>
              <tbody>
                <DetailTable rows={sorted} balances={balances} />
              </tbody>
            </table>
            <div className="bg-gray-50 px-4 py-2 text-right text-sm font-semibold text-gray-700">
              Ending Balance:{' '}
              <span className={`font-mono tabular-nums ${r.endingBalance < 0 ? 'text-red-600' : ''}`}>
                {fmtMoney(r.endingBalance)}
              </span>
            </div>
          </div>
        );
      })}
      <div className="bg-gray-200 px-4 py-2 text-right font-bold text-gray-800">
        Grand Total:{' '}
        <span className={`font-mono tabular-nums ${grandTotal < 0 ? 'text-red-700' : ''}`}>
          {fmtMoney(grandTotal)}
        </span>
      </div>
    </div>
  );
}

// ─── Sort Button ──────────────────────────────────────────────────────────────

function SortButton({
  label,
  field,
  active,
  dir,
  onClick,
}: {
  label: string;
  field: SortField;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-3 text-xs font-medium rounded border transition-colors ${
        active
          ? 'bg-brand text-white border-blue-700'
          : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
      }`}
    >
      {label}
      {active && (
        <span className="ml-1">{dir === 'asc' ? '▲' : '▼'}</span>
      )}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GLInquiry() {
  const initPrefs = useRef(loadPrefs());

  const [account, setAccount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [showLookup, setShowLookup] = useState(false);
  const [showMultiGL, setShowMultiGL] = useState(false);
  const [multiGlAccounts, setMultiGlAccounts] = useState<any[]>([]);

  const [datePreset, setDatePreset] = useState<DatePreset>(initPrefs.current.datePreset);
  const [fromDate, setFromDate] = useState('');
  const [thruDate, setThruDate] = useState('');
  const [openMonthRange, setOpenMonthRange] = useState<{ from: string; to: string } | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>(initPrefs.current.viewMode);
  const [sortField, setSortField] = useState<SortField>(initPrefs.current.sortField);
  const [sortDir, setSortDir] = useState<SortDir>(initPrefs.current.ascending ? 'asc' : 'desc');

  const [searched, setSearched] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showJournalDetail, setShowJournalDetail] = useState(false);

  const [filters, setFilters] = useState<Filters>({
    controlNums: [],
    sources: [],
    minAmountEnabled: false,
    minAmount: '',
    maxAmountEnabled: false,
    maxAmount: '',
  });

  const filtersActive =
    filters.controlNums.length > 0 ||
    filters.sources.length > 0 ||
    filters.minAmountEnabled ||
    filters.maxAmountEnabled;

  const { data: sysConfig } = useQuery({
    queryKey: ['gl-system-config'],
    queryFn: glApi.getSystemConfig,
    staleTime: 300_000,
  });

  // OPEN_MONTH uses the accounting period boundary, not the calendar month.
  // lastCloseDate from system config marks the last closed period; open month = lastCloseDate+1 through end of that month.
  useEffect(() => {
    if (!sysConfig?.lastCloseDate) return;
    const lastClose = new Date(sysConfig.lastCloseDate);
    const openStart = new Date(lastClose.getFullYear(), lastClose.getMonth() + 1, 1);
    const openEnd = lastOfMonth(openStart);
    setOpenMonthRange({ from: fmtDate(openStart), to: fmtDate(openEnd) });
  }, [sysConfig]);

  useEffect(() => {
    if (datePreset === 'CUSTOM') return;
    const range = computeDateRange(datePreset, openMonthRange);
    if (range) {
      setFromDate(range.from);
      setThruDate(range.to);
    }
  }, [datePreset, openMonthRange]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField],
  );

  const queryAccount = multiGlAccounts.length > 0 ? '@MULTIPLE' : account;

  const { data: inquiryData, isLoading, error, refetch } = useQuery({
    queryKey: ['gl-inquiry', queryAccount, fromDate, thruDate, multiGlAccounts.map((a) => a.accountCode ?? a.account_code).join(',')],
    queryFn: async () => {
      if (multiGlAccounts.length > 0) {
        const results = await Promise.all(
          multiGlAccounts.map((acc) => {
            const code = acc.accountCode ?? acc.account_code;
            return glApi.getAccountInquiry(code, 1, `from=${fromDate}&to=${thruDate}`)
              .then((res: any) => ({
                account: acc,
                beginningBalance: res.beginningBalance ?? 0,
                transactions: res.transactions ?? res.entries ?? res.rows ?? [],
                endingBalance: res.endingBalance ?? 0,
              }));
          }),
        );
        return { _multi: true, results } as any;
      }
      return glApi.getAccountInquiry(account, 1, `from=${fromDate}&to=${thruDate}`);
    },
    enabled: searched && !!fromDate && !!thruDate && (!!account || multiGlAccounts.length > 0),
    staleTime: 60_000,
  });

  const singleResult: InquiryResult | null = useMemo(() => {
    if (!inquiryData || inquiryData._multi) return null;
    return {
      beginningBalance: inquiryData.beginningBalance ?? 0,
      transactions: inquiryData.transactions ?? inquiryData.entries ?? inquiryData.rows ?? [],
      endingBalance: inquiryData.endingBalance,
    };
  }, [inquiryData]);

  const multiResults: MultiGLResult[] | null = useMemo(() => {
    if (!inquiryData?._multi) return null;
    return inquiryData.results ?? [];
  }, [inquiryData]);

  const allTransactions: TxnRow[] = useMemo(() => {
    if (singleResult) return singleResult.transactions;
    if (multiResults) return multiResults.flatMap((r) => r.transactions);
    return [];
  }, [singleResult, multiResults]);

  const filteredTransactions = useMemo(
    () => applyClientFilters(allTransactions, filters),
    [allTransactions, filters],
  );

  const sortedTransactions = useMemo(
    () => sortRows(filteredTransactions, sortField, sortDir),
    [filteredTransactions, sortField, sortDir],
  );

  const runningBalances = useMemo(() => {
    if (!singleResult) return [];
    return buildRunningBalance(singleResult.beginningBalance, sortedTransactions);
  }, [singleResult, sortedTransactions]);

  const handleSearch = () => {
    if (!fromDate || !thruDate) return;
    if (account || multiGlAccounts.length > 0) setSearched(true);
  };

  const handleAccountSelect = (acc: any) => {
    const code = acc.accountCode ?? acc.account_code;
    const name = acc.accountName ?? acc.description;
    setAccount(code);
    setAccountName(name);
    setMultiGlAccounts([]);
    setSearched(false);
  };

  const handleMultiConfirm = (accounts: any[]) => {
    setMultiGlAccounts(accounts);
    setAccount('@MULTIPLE');
    setAccountName('');
    setSearched(false);
  };

  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    setSearched(false);
  };

  const handleSavePrefs = (p: Prefs) => {
    savePrefs(p);
    setViewMode(p.viewMode);
    setSortField(p.sortField);
    setSortDir(p.ascending ? 'asc' : 'desc');
    setDatePreset(p.datePreset);
  };

  const displayAccount = multiGlAccounts.length > 0 ? '@MULTIPLE' : account;

  return (
    <div className="flex flex-col h-full bg-slate-50 font-ui">
      {/* Page Header */}
      <div className="bg-white border-b border-slate-200 px-6 pt-4 pb-2">
        <PageHeader title="GL Inquiry (WF-A001)" subtitle="View general ledger account activity and running balances." />
      </div>

      {/* Parameters Bar */}
      <div className="bg-white border-b border-gray-200 p-4 flex items-center gap-4 flex-wrap">

        {/* Left: Account */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
            GL Account
          </label>
          <input
            type="text"
            value={displayAccount}
            onChange={(e) => {
              setAccount(e.target.value);
              setAccountName('');
              setMultiGlAccounts([]);
              setSearched(false);
            }}
            onBlur={() => {
              if (account && account !== '@MULTIPLE' && !accountName) {
                glApi.searchAccounts(account).then((res: any[]) => {
                  const match = res.find(
                    (a) => (a.accountCode ?? a.account_code) === account,
                  );
                  if (match) setAccountName(match.accountName ?? match.description ?? '');
                }).catch(() => {});
              }
            }}
            placeholder="000000"
            className="w-32 h-8 px-2 font-mono text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
          <button
            onClick={() => setShowLookup(true)}
            className="h-8 w-8 flex items-center justify-center border border-gray-300 rounded hover:bg-gray-50 text-gray-600 font-semibold text-sm"
            title="Account Lookup"
          >
            …
          </button>
          <button
            onClick={() => setShowMultiGL(true)}
            className="h-8 px-3 text-xs font-medium border border-gray-300 rounded hover:bg-gray-50 text-gray-600 whitespace-nowrap"
          >
            Multi-GL
          </button>
          {accountName && (
            <span className="text-sm text-gray-600 ml-1 max-w-[200px] truncate">{accountName}</span>
          )}
        </div>

        <div className="h-6 w-px bg-gray-200 hidden sm:block" />

        {/* Center: Date Range */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={datePreset}
            onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
            className="w-44 h-8 px-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-700"
          >
            {DATE_PRESETS.map((p) => (
              <option key={p} value={p}>{DATE_PRESET_LABELS[p]}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500 whitespace-nowrap">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setDatePreset('CUSTOM');
                setSearched(false);
              }}
              className="h-8 px-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500 whitespace-nowrap">Thru</label>
            <input
              type="date"
              value={thruDate}
              onChange={(e) => {
                setThruDate(e.target.value);
                setDatePreset('CUSTOM');
                setSearched(false);
              }}
              className="h-8 px-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>
        </div>

        <div className="h-6 w-px bg-gray-200 hidden sm:block" />

        {/* Right: View Mode + Search */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex rounded border border-gray-300 overflow-hidden">
            <button
              onClick={() => setViewMode('detail')}
              className={`h-8 px-3 text-xs font-medium transition-colors ${
                viewMode === 'detail'
                  ? 'bg-brand text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Detail
            </button>
            <button
              onClick={() => setViewMode('summary')}
              className={`h-8 px-3 text-xs font-medium border-l border-gray-300 transition-colors ${
                viewMode === 'summary'
                  ? 'bg-brand text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Summary
            </button>
          </div>
          <Btn
            variant="primary"
            size="sm"
            onClick={handleSearch}
            disabled={(!account && multiGlAccounts.length === 0) || !fromDate || !thruDate}
          >
            Search
          </Btn>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap">
        <SortButton label="Date" field="date" active={sortField === 'date'} dir={sortDir} onClick={() => handleSort('date')} />
        <SortButton label="Ref#" field="ref" active={sortField === 'ref'} dir={sortDir} onClick={() => handleSort('ref')} />
        <SortButton label="Control#" field="control" active={sortField === 'control'} dir={sortDir} onClick={() => handleSort('control')} />
        <SortButton label="Amount" field="amount" active={sortField === 'amount'} dir={sortDir} onClick={() => handleSort('amount')} />

        <div className="w-px h-5 bg-gray-300 mx-1" />

        <button
          onClick={() => setShowFilter(true)}
          className={`h-7 px-3 text-xs font-medium rounded border transition-colors flex items-center gap-1.5 relative ${
            filtersActive
              ? 'border-blue-700 bg-brand-light text-brand'
              : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          Filter
          {filtersActive && (
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
          )}
        </button>

        <button
          onClick={() => setShowPrefs(true)}
          className="h-7 w-7 flex items-center justify-center rounded border border-gray-300 bg-white text-gray-600 hover:border-gray-400 transition-colors"
          title="Preferences"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>

        {viewMode === 'summary' && (
          <>
            <div className="w-px h-5 bg-gray-300 mx-1" />
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showJournalDetail}
                onChange={(e) => setShowJournalDetail(e.target.checked)}
                className="rounded border-gray-300 text-brand"
              />
              Journal Detail
            </label>
          </>
        )}

        {allTransactions.length > 0 && (
          <span className="ml-auto text-xs text-gray-400">
            {filteredTransactions.length} of {allTransactions.length} transactions
          </span>
        )}
      </div>

      {/* Results Area */}
      <div className="flex-1 overflow-auto">
        {!searched && (
          <div className="flex items-center justify-center h-64">
            <EmptyState title="No results yet" description="Select an account and date range, then click Search to view transactions." />
          </div>
        )}

        {searched && isLoading && (
          <PageLoader page="GL Inquiry" service="gl-service" port={3001} />
        )}

        {searched && !isLoading && error && (
          <PageError
            error={error as Error}
            serviceName="gl-service"
            port={3001}
            retry={refetch}
          />
        )}

        {searched && !isLoading && !error && multiResults && (
          <MultiGLResults
            results={multiResults}
            sortField={sortField}
            sortDir={sortDir}
            filters={filters}
            thruDate={thruDate}
          />
        )}

        {searched && !isLoading && !error && singleResult && !multiResults && viewMode === 'detail' && (
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-gray-50 border-b-2 border-gray-200 sticky top-0 z-10">
              <tr className="h-9 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-3 text-left font-semibold">Src</th>
                <th className="px-3 text-left font-semibold">Date</th>
                <th className="px-3 text-left font-semibold">Reference</th>
                <th className="px-3 text-left font-semibold">Control#</th>
                <th className="px-3 text-right font-semibold">Amount</th>
                <th className="px-3 text-right font-semibold">Running Balance</th>
                <th className="px-3 text-left font-semibold">Comments</th>
              </tr>
            </thead>
            <tbody>
              <tr className="h-9 bg-gray-100 border-b border-gray-200">
                <td colSpan={4} className="px-3 text-sm font-semibold text-gray-700">
                  Beginning Balance
                </td>
                <td className="px-3 font-mono text-sm text-right tabular-nums font-semibold text-gray-700" colSpan={2}>
                  {fmtMoney(singleResult.beginningBalance)}
                </td>
                <td />
              </tr>
              <DetailTable rows={sortedTransactions} balances={runningBalances} />
            </tbody>
          </table>
        )}

        {searched && !isLoading && !error && singleResult && !multiResults && viewMode === 'summary' && (
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-gray-50 border-b-2 border-gray-200 sticky top-0 z-10">
              <tr className="h-9 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-3 text-left font-semibold">Date</th>
                <th className="px-3 text-left font-semibold">Reference</th>
                <th className="px-3 text-left font-semibold">Src</th>
                <th className="px-3 text-right font-semibold">Net Amount</th>
              </tr>
            </thead>
            <tbody>
              <SummaryTable rows={sortedTransactions} showJournalDetail={showJournalDetail} />
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {showLookup && (
        <GLAccountLookupPopup
          onSelect={handleAccountSelect}
          onClose={() => setShowLookup(false)}
        />
      )}

      {showMultiGL && (
        <MultiGLModal
          selected={multiGlAccounts}
          onConfirm={handleMultiConfirm}
          onClose={() => setShowMultiGL(false)}
        />
      )}

      {showFilter && (
        <FilterDialog
          transactions={allTransactions}
          filters={filters}
          onChange={setFilters}
          onClose={() => setShowFilter(false)}
        />
      )}

      {showPrefs && (
        <PreferencesModal
          prefs={{ viewMode, datePreset, sortField, ascending: sortDir === 'asc' }}
          onSave={handleSavePrefs}
          onClose={() => setShowPrefs(false)}
        />
      )}
    </div>
  );
}
