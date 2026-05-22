import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { glApi } from '../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface GlAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
  balance?: number;
}

interface SortConfig {
  key: string;
  dir: 'asc' | 'desc';
}

type TabId = 'journals' | 'transactions' | 'schedule' | 'aging';

const TABS: { id: TabId; label: string; typeCode: number }[] = [
  { id: 'journals', label: 'Journals', typeCode: 1 },
  { id: 'transactions', label: 'Transactions', typeCode: 2 },
  { id: 'schedule', label: 'Schedule', typeCode: 3 },
  { id: 'aging', label: 'Aging', typeCode: 4 },
];

// ─── Account Autocomplete ─────────────────────────────────────────────────────

function AccountSearch({ onSelect, initialCode }: { onSelect: (code: string) => void; initialCode?: string }) {
  const [query, setQuery] = useState(initialCode ?? '');
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['gl-account-search', query],
    queryFn: () => (query.length >= 2 ? glApi.searchAccounts(query) : Promise.resolve([])),
    enabled: query.length >= 2,
    staleTime: 30_000,
  });

  const handleInput = (val: string) => {
    setQuery(val);
    setOpen(true);
    setHighlighted(0);
    clearTimeout(debounceRef.current);
  };

  const select = (account: GlAccount) => {
    setQuery(account.accountCode);
    setOpen(false);
    onSelect(account.accountCode);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => query.length >= 2 && setOpen(true)}
          onKeyDown={(e) => {
            if (!open || results.length === 0) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
            if (e.key === 'Enter') { e.preventDefault(); if (results[highlighted]) select(results[highlighted] as GlAccount); }
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="Search account code or name…"
          className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        {isFetching && (
          <div className="absolute right-3 top-2.5">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {(results as GlAccount[]).map((acc, idx) => (
            <li
              key={acc.accountCode}
              onMouseDown={() => select(acc)}
              className={`px-4 py-2.5 cursor-pointer text-sm ${idx === highlighted ? 'bg-brand-light text-blue-800' : 'hover:bg-gray-50'}`}
            >
              <span className="font-mono font-semibold">{acc.accountCode}</span>
              <span className="ml-2 text-gray-600">{acc.accountName}</span>
              <span className="ml-auto float-right text-xs text-gray-400 uppercase">{acc.accountType}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Sortable Header ──────────────────────────────────────────────────────────

function SortTh({ label, field, sort, onSort }: { label: string; field: string; sort: SortConfig; onSort: (f: string) => void }) {
  const active = sort.key === field;
  return (
    <th
      onClick={() => onSort(field)}
      className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
    >
      <span className="flex items-center gap-1">
        {label}
        <span className="text-gray-300">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </span>
    </th>
  );
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportCsv(rows: any[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(','), ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Tab Content ──────────────────────────────────────────────────────────────

function TabContent({ data, tab, sort, onSort }: { data: any; tab: TabId; sort: SortConfig; onSort: (f: string) => void }) {
  if (!data) return <div className="text-center py-12 text-gray-400 text-sm">No data available</div>;

  const sortRows = (rows: any[]) => {
    if (!rows?.length || !sort.key) return rows ?? [];
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = typeof av === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  };

  if (tab === 'journals') {
    const rows = sortRows(data.journals ?? data.entries ?? data.rows ?? []);
    return (
      <table className="w-full text-sm">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <SortTh label="Date" field="entryDate" sort={sort} onSort={onSort} />
            <SortTh label="Reference" field="reference" sort={sort} onSort={onSort} />
            <SortTh label="Description" field="description" sort={sort} onSort={onSort} />
            <SortTh label="Debit" field="debitAmount" sort={sort} onSort={onSort} />
            <SortTh label="Credit" field="creditAmount" sort={sort} onSort={onSort} />
            <SortTh label="Balance" field="runningBalance" sort={sort} onSort={onSort} />
            <SortTh label="Status" field="status" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="text-center py-8 text-gray-400">No journal entries</td></tr>
          ) : rows.map((r: any, i: number) => (
            <tr key={r.id ?? i} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.entryDate ? new Date(r.entryDate).toLocaleDateString() : '-'}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{r.reference ?? r.journalNumber ?? '-'}</td>
              <td className="px-4 py-2.5 text-gray-700 max-w-xs truncate">{r.description ?? '-'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{r.debitAmount != null ? fmtCurrency(r.debitAmount) : '-'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{r.creditAmount != null ? fmtCurrency(r.creditAmount) : '-'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums font-medium">{r.runningBalance != null ? fmtCurrency(r.runningBalance) : '-'}</td>
              <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (tab === 'transactions') {
    const rows = sortRows(data.transactions ?? data.rows ?? []);
    return (
      <table className="w-full text-sm">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <SortTh label="Date" field="transactionDate" sort={sort} onSort={onSort} />
            <SortTh label="Type" field="transactionType" sort={sort} onSort={onSort} />
            <SortTh label="Source" field="sourceCode" sort={sort} onSort={onSort} />
            <SortTh label="Amount" field="amount" sort={sort} onSort={onSort} />
            <SortTh label="Running Balance" field="runningBalance" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="text-center py-8 text-gray-400">No transactions</td></tr>
          ) : rows.map((r: any, i: number) => (
            <tr key={r.id ?? i} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.transactionDate ? new Date(r.transactionDate).toLocaleDateString() : '-'}</td>
              <td className="px-4 py-2.5 text-xs uppercase font-medium text-gray-500">{r.transactionType ?? '-'}</td>
              <td className="px-4 py-2.5 font-mono text-xs">{r.sourceCode ?? '-'}</td>
              <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${(r.amount ?? 0) >= 0 ? 'text-gray-800' : 'text-red-600'}`}>{r.amount != null ? fmtCurrency(r.amount) : '-'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{r.runningBalance != null ? fmtCurrency(r.runningBalance) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (tab === 'schedule') {
    const rows = sortRows(data.schedule ?? data.scheduleItems ?? data.rows ?? []);
    return (
      <table className="w-full text-sm">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            <SortTh label="Schedule" field="scheduleId" sort={sort} onSort={onSort} />
            <SortTh label="Description" field="description" sort={sort} onSort={onSort} />
            <SortTh label="Amount" field="amount" sort={sort} onSort={onSort} />
            <SortTh label="Period" field="period" sort={sort} onSort={onSort} />
            <SortTh label="Status" field="status" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="text-center py-8 text-gray-400">No schedule items</td></tr>
          ) : rows.map((r: any, i: number) => (
            <tr key={r.id ?? i} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 font-mono text-xs font-medium">{r.scheduleId ?? r.scheduleCode ?? '-'}</td>
              <td className="px-4 py-2.5 text-gray-700">{r.description ?? '-'}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{r.amount != null ? fmtCurrency(r.amount) : '-'}</td>
              <td className="px-4 py-2.5 text-gray-500">{r.period ?? '-'}</td>
              <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (tab === 'aging') {
    const buckets = data.aging ?? data.agingBuckets ?? data;
    if (Array.isArray(buckets)) {
      const rows = sortRows(buckets);
      return (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <SortTh label="Bucket" field="bucket" sort={sort} onSort={onSort} />
              <SortTh label="Count" field="count" sort={sort} onSort={onSort} />
              <SortTh label="Amount" field="amount" sort={sort} onSort={onSort} />
              <SortTh label="%" field="pct" sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r: any, i: number) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-700">{r.bucket ?? r.label ?? '-'}</td>
                <td className="px-4 py-2.5 tabular-nums text-gray-600">{r.count ?? '-'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{r.amount != null ? fmtCurrency(r.amount) : '-'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{r.pct != null ? `${r.pct.toFixed(1)}%` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4">
        {['current', '1-30', '31-60', '61-90', '90+'].map(b => {
          const val = buckets?.[b.replace('-', '_').replace('+', 'plus')] ?? buckets?.[b];
          return val != null ? (
            <div key={b} className="bg-gray-50 rounded-lg p-4 text-center">
              <div className="text-xs text-gray-500 font-semibold uppercase mb-1">{b} days</div>
              <div className="text-xl font-bold text-gray-800">{fmtCurrency(val)}</div>
            </div>
          ) : null;
        })}
      </div>
    );
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);
}

function StatusPill({ status }: { status?: string }) {
  if (!status) return null;
  const map: Record<string, string> = {
    POSTED: 'bg-green-100 text-green-700',
    DRAFT: 'bg-gray-100 text-gray-600',
    PENDING_REVIEW: 'bg-yellow-100 text-yellow-700',
    BLOCKED: 'bg-red-100 text-red-700',
    ACTIVE: 'bg-green-100 text-green-700',
    INACTIVE: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GLAccountInquiry() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<TabId>('journals');
  const [sort, setSort] = useState<SortConfig>({ key: 'entryDate', dir: 'desc' });
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const currentTab = TABS.find(t => t.id === activeTab)!;

  const dateParams = [
    dateFrom ? `dateFrom=${dateFrom}` : '',
    dateTo ? `dateTo=${dateTo}` : '',
  ].filter(Boolean).join('&');

  const { data: inquiry, isLoading, error, refetch } = useQuery({
    queryKey: ['gl-inquiry', code, currentTab.typeCode, dateFrom, dateTo],
    queryFn: () => glApi.getAccountInquiry(code!, currentTab.typeCode, dateParams),
    enabled: !!code,
    staleTime: 30_000,
  });

  const handleSort = useCallback((field: string) => {
    setSort(prev => ({ key: field, dir: prev.key === field && prev.dir === 'asc' ? 'desc' : 'asc' }));
  }, []);

  const handleExport = () => {
    const rows = inquiry?.journals ?? inquiry?.transactions ?? inquiry?.schedule ?? inquiry?.aging ?? [];
    if (Array.isArray(rows)) exportCsv(rows, `gl-inquiry-${code}-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">GL Account Inquiry</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Account activity, transactions, schedules, and aging analysis
          </p>
        </div>
        <button
          onClick={() => navigate('/gl')}
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          ← Back to GL
        </button>
      </div>

      {/* Account Search */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Account</label>
        <div className="max-w-md">
          <AccountSearch
            initialCode={code}
            onSelect={(selectedCode) => navigate(`/gl/accounts/${selectedCode}/inquiry`)}
          />
        </div>
        {inquiry?.account && (
          <div className="mt-3 flex items-center gap-6 text-sm">
            <div>
              <span className="text-gray-500">Name: </span>
              <span className="font-semibold text-gray-800">{inquiry.account.accountName}</span>
            </div>
            <div>
              <span className="text-gray-500">Type: </span>
              <span className="font-semibold text-gray-800">{inquiry.account.accountType}</span>
            </div>
            {inquiry.account.balance != null && (
              <div>
                <span className="text-gray-500">Balance: </span>
                <span className="font-bold text-gray-900">{fmtCurrency(inquiry.account.balance)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 whitespace-nowrap">To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); }}
            className="text-sm text-gray-500 hover:text-red-500 px-2 py-1.5">
            Clear
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={() => refetch()}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            Refresh
          </button>
          <button onClick={handleExport}
            className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-900 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Tab Bar + Content */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSort({ key: 'entryDate', dir: 'desc' }); }}
              className={`px-6 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-brand bg-brand-light/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.label}
              {inquiry && (() => {
                const arr = inquiry[tab.id] ?? inquiry[tab.id + 's'] ?? inquiry.rows;
                return Array.isArray(arr) && arr.length > 0
                  ? <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">{arr.length}</span>
                  : null;
              })()}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-x-auto" style={{ minHeight: 240 }}>
          {!code ? (
            <div className="text-center py-16 text-gray-400">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">Search for an account to view its activity</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-16 gap-3 text-gray-400 text-sm">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Loading {activeTab}…
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-600 text-sm font-medium">{(error as Error).message}</p>
              <button onClick={() => refetch()} className="mt-3 text-sm text-brand hover:underline">Retry</button>
            </div>
          ) : (
            <TabContent data={inquiry} tab={activeTab} sort={sort} onSort={handleSort} />
          )}
        </div>
      </div>
    </div>
  );
}
