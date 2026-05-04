import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { glApi } from '../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

type EntryStatus = 'DRAFT' | 'PENDING_REVIEW' | 'POSTED';

interface JournalLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number | '';
  credit: number | '';
}

interface GlAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
}

interface JournalEntry {
  id: string;
  reference?: string;
  description: string;
  status: EntryStatus;
  entryDate: string;
  totalDebits: number;
  totalCredits: number;
  agentReviewStatus?: string;
  agentNotes?: string;
  lines?: JournalLine[];
  createdAt: string;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<EntryStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PENDING_REVIEW: 'bg-yellow-100 text-yellow-800',
  POSTED: 'bg-green-100 text-green-700',
};

const AGENT_STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  FLAGGED: 'bg-red-100 text-red-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  REVIEWING: 'bg-blue-100 text-blue-700',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status as EntryStatus] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${style}`}>{status.replace(/_/g, ' ')}</span>;
}

function AgentBadge({ status, notes }: { status?: string; notes?: string }) {
  if (!status) return null;
  const style = AGENT_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-500';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${style}`} title={notes}>
      <span>🤖</span> {status}
    </span>
  );
}

// ─── Account Autocomplete ─────────────────────────────────────────────────────

function AccountAutocomplete({ value, onChange, onAccountSelect }: {
  value: string;
  onChange: (v: string) => void;
  onAccountSelect: (acc: GlAccount) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: results = [] } = useQuery({
    queryKey: ['gl-account-search', value],
    queryFn: () => (value.length >= 2 ? glApi.searchAccounts(value) : Promise.resolve([])),
    enabled: value.length >= 2,
    staleTime: 60_000,
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (acc: GlAccount) => {
    onChange(acc.accountCode);
    onAccountSelect(acc);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlighted(0); }}
        onFocus={() => value.length >= 2 && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !(results as GlAccount[]).length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, (results as GlAccount[]).length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); const acc = (results as GlAccount[])[highlighted]; if (acc) select(acc); }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Account…"
        className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      {open && (results as GlAccount[]).length > 0 && (
        <ul className="absolute z-50 mt-1 w-64 bg-white border border-gray-200 rounded shadow-lg max-h-44 overflow-y-auto">
          {(results as GlAccount[]).map((acc, idx) => (
            <li key={acc.accountCode} onMouseDown={() => select(acc)}
              className={`px-3 py-2 cursor-pointer text-xs ${idx === highlighted ? 'bg-blue-50 text-blue-800' : 'hover:bg-gray-50'}`}>
              <span className="font-mono font-bold">{acc.accountCode}</span>
              <span className="ml-1.5 text-gray-600">{acc.accountName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Balance Indicator ────────────────────────────────────────────────────────

function BalanceIndicator({ lines }: { lines: JournalLine[] }) {
  const totalDebits = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = totalDebits - totalCredits;
  const balanced = Math.abs(diff) < 0.005;

  return (
    <div className={`flex items-center gap-6 px-4 py-3 rounded-lg border-2 text-sm font-medium ${
      balanced ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'
    }`}>
      <div>
        <span className="text-gray-500 font-normal">Total Debits </span>
        <span className="tabular-nums">{fmtCurrency(totalDebits)}</span>
      </div>
      <div>
        <span className="text-gray-500 font-normal">Total Credits </span>
        <span className="tabular-nums">{fmtCurrency(totalCredits)}</span>
      </div>
      {balanced ? (
        <div className="flex items-center gap-1 text-green-700">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          Balanced
        </div>
      ) : (
        <div className="text-red-700">
          Off by {fmtCurrency(Math.abs(diff))} {diff > 0 ? '(debits exceed credits)' : '(credits exceed debits)'}
        </div>
      )}
    </div>
  );
}

// ─── New Entry Form ───────────────────────────────────────────────────────────

let lineCounter = 0;
const newLine = (): JournalLine => ({
  id: `line-${++lineCounter}`,
  accountCode: '',
  accountName: '',
  description: '',
  debit: '',
  credit: '',
});

function NewEntryForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<JournalLine[]>([newLine(), newLine()]);
  const [submitError, setSubmitError] = useState('');

  const queryClient = useQueryClient();

  const createMut = useMutation({
    mutationFn: (data: any) => glApi.createJournalEntry(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gl-entries'] });
      onSuccess();
    },
    onError: (e: Error) => setSubmitError(e.message),
  });

  const updateLine = useCallback(<K extends keyof JournalLine>(id: string, key: K, val: JournalLine[K]) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, [key]: val } : l));
  }, []);

  const removeLine = (id: string) => setLines(prev => prev.filter(l => l.id !== id));

  const totalDebits = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebits - totalCredits) < 0.005;

  const handleSubmit = () => {
    setSubmitError('');
    if (!description.trim()) { setSubmitError('Description is required'); return; }
    if (lines.some(l => !l.accountCode)) { setSubmitError('All lines require an account'); return; }
    if (!balanced) { setSubmitError('Entry is not balanced (debits ≠ credits)'); return; }

    const payload = {
      description,
      entryDate,
      reference: reference || undefined,
      lines: lines.map(l => ({
        accountCode: l.accountCode,
        accountName: l.accountName,
        description: l.description,
        debitAmount: Number(l.debit) || 0,
        creditAmount: Number(l.credit) || 0,
      })),
    };
    createMut.mutate(payload);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-800">New Journal Entry</h2>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-6 space-y-5">
        {/* Header fields */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Description *</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Entry description" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Entry Date *</label>
            <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Reference</label>
            <input type="text" value={reference} onChange={e => setReference(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional reference" />
          </div>
        </div>

        {/* Lines table */}
        <div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-xs font-semibold text-gray-500 pb-2 pr-3 w-44">Account</th>
                <th className="text-left text-xs font-semibold text-gray-500 pb-2 pr-3">Description</th>
                <th className="text-right text-xs font-semibold text-gray-500 pb-2 pr-3 w-32">Debit</th>
                <th className="text-right text-xs font-semibold text-gray-500 pb-2 w-32">Credit</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="space-y-1">
              {lines.map(line => (
                <tr key={line.id} className="border-b border-gray-50">
                  <td className="pr-3 py-1">
                    <AccountAutocomplete
                      value={line.accountCode}
                      onChange={v => updateLine(line.id, 'accountCode', v)}
                      onAccountSelect={acc => {
                        setLines(prev => prev.map(l => l.id === line.id
                          ? { ...l, accountCode: acc.accountCode, accountName: acc.accountName }
                          : l));
                      }}
                    />
                    {line.accountName && (
                      <div className="text-xs text-gray-400 mt-0.5 pl-0.5 truncate w-44">{line.accountName}</div>
                    )}
                  </td>
                  <td className="pr-3 py-1">
                    <input type="text" value={line.description}
                      onChange={e => updateLine(line.id, 'description', e.target.value)}
                      placeholder="Line description"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </td>
                  <td className="pr-3 py-1">
                    <input type="number" value={line.debit} min="0" step="0.01"
                      onChange={e => updateLine(line.id, 'debit', e.target.value === '' ? '' : parseFloat(e.target.value))}
                      onFocus={() => line.credit !== '' && updateLine(line.id, 'credit', '')}
                      placeholder="0.00"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </td>
                  <td className="py-1">
                    <input type="number" value={line.credit} min="0" step="0.01"
                      onChange={e => updateLine(line.id, 'credit', e.target.value === '' ? '' : parseFloat(e.target.value))}
                      onFocus={() => line.debit !== '' && updateLine(line.id, 'debit', '')}
                      placeholder="0.00"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </td>
                  <td className="py-1 pl-2">
                    {lines.length > 2 && (
                      <button onClick={() => removeLine(line.id)}
                        className="text-gray-300 hover:text-red-500 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setLines(prev => [...prev, newLine()])}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add line
          </button>
        </div>

        {/* Balance indicator */}
        <BalanceIndicator lines={lines} />

        {submitError && (
          <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {submitError}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={createMut.isPending || !balanced}
            className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
            {createMut.isPending && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Save as Draft
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Entry Detail Panel ───────────────────────────────────────────────────────

function EntryDetail({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  const queryClient = useQueryClient();

  const submitMut = useMutation({
    mutationFn: () => glApi.submitEntry(entry.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gl-entries'] }),
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold text-gray-800">{entry.reference ?? entry.id}</h2>
          <StatusBadge status={entry.status} />
          <AgentBadge status={entry.agentReviewStatus} notes={entry.agentNotes} />
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><span className="text-gray-500">Date: </span><span className="font-medium">{new Date(entry.entryDate).toLocaleDateString()}</span></div>
          <div><span className="text-gray-500">Description: </span><span className="font-medium">{entry.description}</span></div>
          <div><span className="text-gray-500">Created: </span><span className="font-medium">{new Date(entry.createdAt).toLocaleDateString()}</span></div>
        </div>

        {entry.agentNotes && (
          <div className="px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            <strong>Agent Note:</strong> {entry.agentNotes}
          </div>
        )}

        {entry.lines && (
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200">
              <tr>
                <th className="text-left text-xs font-semibold text-gray-500 pb-2">Account</th>
                <th className="text-left text-xs font-semibold text-gray-500 pb-2">Description</th>
                <th className="text-right text-xs font-semibold text-gray-500 pb-2">Debit</th>
                <th className="text-right text-xs font-semibold text-gray-500 pb-2">Credit</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((l, i) => (
                <tr key={l.id ?? i} className="border-b border-gray-50">
                  <td className="py-2 font-mono text-xs">{l.accountCode}<br /><span className="text-gray-400">{l.accountName}</span></td>
                  <td className="py-2 text-gray-600">{l.description}</td>
                  <td className="py-2 text-right tabular-nums">{Number(l.debit) > 0 ? fmtCurrency(Number(l.debit)) : ''}</td>
                  <td className="py-2 text-right tabular-nums">{Number(l.credit) > 0 ? fmtCurrency(Number(l.credit)) : ''}</td>
                </tr>
              ))}
              <tr className="font-semibold text-gray-800 bg-gray-50">
                <td colSpan={2} className="py-2 px-2 text-right text-xs text-gray-500 uppercase tracking-wider">Totals</td>
                <td className="py-2 text-right tabular-nums">{fmtCurrency(entry.totalDebits)}</td>
                <td className="py-2 text-right tabular-nums">{fmtCurrency(entry.totalCredits)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {entry.status === 'DRAFT' && (
          <div className="flex justify-end gap-3">
            <button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}
              className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
              {submitMut.isPending && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Submit for Review
            </button>
          </div>
        )}
        {submitMut.isError && (
          <div className="text-sm text-red-600">{(submitMut.error as Error).message}</div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const STATUS_FILTERS: { label: string; value: EntryStatus | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Pending Review', value: 'PENDING_REVIEW' },
  { label: 'Posted', value: 'POSTED' },
];

export default function JournalEntryManagement() {
  const [statusFilter, setStatusFilter] = useState<EntryStatus | ''>('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [searchText, setSearchText] = useState('');

  const params = [
    statusFilter ? `status=${statusFilter}` : '',
    searchText ? `q=${encodeURIComponent(searchText)}` : '',
  ].filter(Boolean).join('&');

  const { data: entries = [], isLoading, error, refetch } = useQuery({
    queryKey: ['gl-entries', statusFilter, searchText],
    queryFn: () => glApi.listEntries(params),
    staleTime: 15_000,
  });

  const counts = {
    DRAFT: (entries as JournalEntry[]).filter(e => e.status === 'DRAFT').length,
    PENDING_REVIEW: (entries as JournalEntry[]).filter(e => e.status === 'PENDING_REVIEW').length,
    POSTED: (entries as JournalEntry[]).filter(e => e.status === 'POSTED').length,
  };

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Journal Entry Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Create, review, and submit journal entries for posting</p>
        </div>
        {!showCreate && !selectedEntry && (
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Entry
          </button>
        )}
      </div>

      {/* Create Form */}
      {showCreate && (
        <NewEntryForm onSuccess={() => setShowCreate(false)} onCancel={() => setShowCreate(false)} />
      )}

      {/* Entry Detail */}
      {selectedEntry && (
        <EntryDetail entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      )}

      {/* Status Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        {(['DRAFT', 'PENDING_REVIEW', 'POSTED'] as EntryStatus[]).map(s => (
          <button key={s} onClick={() => setStatusFilter(prev => prev === s ? '' : s)}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              statusFilter === s ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
            }`}>
            <div className="text-2xl font-bold tabular-nums text-gray-800">{counts[s]}</div>
            <div className="text-xs text-gray-500 mt-0.5 uppercase font-semibold tracking-wide">{s.replace(/_/g, ' ')}</div>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
          <input type="text" value={searchText} onChange={e => setSearchText(e.target.value)}
            placeholder="Search description or reference…"
            className="flex-1 max-w-sm px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-1">
            {STATUS_FILTERS.map(f => (
              <button key={f.value} onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === f.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          <button onClick={() => refetch()} className="ml-auto p-1.5 text-gray-400 hover:text-gray-600 rounded">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-gray-400 text-sm">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Loading entries…
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-600 text-sm">{(error as Error).message}</p>
            <button onClick={() => refetch()} className="mt-2 text-sm text-blue-600 hover:underline">Retry</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Reference</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Debits</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Credits</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(entries as JournalEntry[]).length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    <div className="text-3xl mb-2">📒</div>
                    <p className="text-sm">No journal entries found</p>
                    <button onClick={() => setShowCreate(true)} className="mt-2 text-sm text-blue-600 hover:underline">
                      Create the first entry
                    </button>
                  </td>
                </tr>
              ) : (entries as JournalEntry[]).map(entry => (
                <tr key={entry.id}
                  onClick={() => setSelectedEntry(entry)}
                  className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                    {new Date(entry.entryDate).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-700">
                    {entry.reference ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-5 py-3 text-gray-800 max-w-xs truncate">{entry.description}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-700">{fmtCurrency(entry.totalDebits ?? 0)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-gray-700">{fmtCurrency(entry.totalCredits ?? 0)}</td>
                  <td className="px-5 py-3"><StatusBadge status={entry.status} /></td>
                  <td className="px-5 py-3"><AgentBadge status={entry.agentReviewStatus} notes={entry.agentNotes} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
