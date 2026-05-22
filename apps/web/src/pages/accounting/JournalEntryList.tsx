import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, LayoutTemplate, Check, Printer, Trash2, RefreshCw, Filter } from 'lucide-react';
import { glApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, PageHeader, EmptyState, Badge } from '../../components/ui';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple'> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  POSTED: 'info',
  REVERSED: 'danger',
  HAS_ERRORS: 'danger',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'OK To Post',
  POSTED: 'Posted',
  REVERSED: 'Reversed',
  HAS_ERRORS: 'Has Errors',
};

type SortCol = 'entryDate' | 'source' | 'sourceRef' | 'status';

export default function JournalEntryList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Filter state
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<SortCol>('entryDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entryId: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Build query params
  const params = new URLSearchParams();
  if (sourceFilter) params.set('source', sourceFilter);
  if (statusFilter) params.set('status', statusFilter);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  const { data: entries, isLoading, error, refetch } = useQuery({
    queryKey: ['journal-entries-list', sourceFilter, statusFilter, dateFrom, dateTo],
    queryFn: () => glApi.getEntries(params.toString()),
    retry: false,
  });

  const postMut = useMutation({
    mutationFn: (id: string) => glApi.approveEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries-list'] });
    },
  });

  if (isLoading) return <PageLoader page="Journal Entries" service="gl-service" port={3010} />;
  if (error) return <PageError error={error} serviceName="GL Service" port={3010} retry={refetch} />;

  const rows = (entries ?? []) as any[];

  // Sort
  const sorted = [...rows].sort((a, b) => {
    let av: string, bv: string;
    if (sortCol === 'entryDate') { av = a.entryDate ?? ''; bv = b.entryDate ?? ''; }
    else if (sortCol === 'source') { av = a.source ?? ''; bv = b.source ?? ''; }
    else if (sortCol === 'sourceRef') { av = a.sourceRef ?? ''; bv = b.sourceRef ?? ''; }
    else { av = a.status ?? ''; bv = b.status ?? ''; }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('desc'); }
  };

  const allSelected = sorted.length > 0 && sorted.every(e => selected.has(e.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map(e => e.id)));
  };

  const totalDebits = rows.reduce((s: number, e: any) =>
    s + (e.lines ?? []).reduce((ls: number, l: any) => ls + Number(l.debit ?? 0), 0), 0);
  const totalCredits = rows.reduce((s: number, e: any) =>
    s + (e.lines ?? []).reduce((ls: number, l: any) => ls + Number(l.credit ?? 0), 0), 0);

  const handleBulkPost = () => {
    if (selected.size === 0) return;
    Array.from(selected).forEach(id => postMut.mutate(id));
    setSelected(new Set());
  };

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div
      className="p-6 space-y-4 h-full flex flex-col"
      onClick={() => setContextMenu(null)}
    >
      {/* Header */}
      <PageHeader
        title="Journal Entries (WF-A001)"
        subtitle="Review, post, and manage general ledger journal entries."
        actions={
          <>
            <Btn variant="secondary" size="md" icon={<RefreshCw className="w-4 h-4" />} onClick={() => refetch()}>
              Refresh
            </Btn>
            <Btn variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={() => navigate('/accounting/gl/entry')}>
              New Entry
            </Btn>
          </>
        }
      />

      {/* Toolbar */}
      <div className="bg-white rounded-lg shadow px-4 py-3 flex items-center gap-2 flex-wrap">
        <Btn variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => navigate('/accounting/gl/entry')}>New Entry</Btn>
        <Btn variant="secondary" size="sm" icon={<FileText className="w-3.5 h-3.5" />} onClick={() => navigate('/accounting/gl/entry?batch=true')}>Enter Batch</Btn>
        <Btn variant="secondary" size="sm" icon={<LayoutTemplate className="w-3.5 h-3.5" />} onClick={() => navigate('/accounting/gl/templates')}>Journal Templates</Btn>
        <div className="h-4 w-px bg-slate-200" />
        <Btn
          variant="primary"
          size="sm"
          icon={<Check className="w-3.5 h-3.5" />}
          onClick={handleBulkPost}
          disabled={selected.size === 0 || postMut.isPending}
          loading={postMut.isPending}
        >
          Post Selected ({selected.size})
        </Btn>
        <Btn variant="secondary" size="sm" icon={<Printer className="w-3.5 h-3.5" />} disabled={selected.size === 0} onClick={() => window.print()}>Print Selected</Btn>
        <Btn variant="danger" size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} disabled={selected.size === 0} onClick={() => setShowDeleteConfirm(true)}>Delete Selected</Btn>
      </div>

      {/* Delete Confirm Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96 space-y-4">
            <h3 className="font-bold text-lg text-red-700">
              Delete {selected.size} entr{selected.size === 1 ? 'y' : 'ies'}?
            </h3>
            <p className="text-sm text-gray-600">
              Only DRAFT entries can be deleted. POSTED entries will be skipped.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 border rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setSelected(new Set());
                }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
              >
                Delete DRAFT Entries
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white rounded-lg shadow px-4 py-3 flex items-center gap-4">
        <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <div className="flex gap-3 flex-wrap items-center flex-1">
          <input
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            placeholder="Source code..."
            className="border rounded px-3 py-1.5 text-sm w-28 font-mono"
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING_REVIEW">OK To Post</option>
            <option value="POSTED">Posted</option>
            <option value="REVERSED">Reversed</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          />
          <span className="text-gray-400 text-xs">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          />
          {(sourceFilter || statusFilter || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setSourceFilter('');
                setStatusFilter('');
                setDateFrom('');
                setDateTo('');
              }}
              className="text-xs text-brand hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
        <span className="text-xs text-gray-500 font-mono">{sorted.length} entries</span>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl py-1 w-44"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => {
              navigate(`/accounting/gl/entry/${contextMenu.entryId}`);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
          >
            Edit
          </button>
          <button
            onClick={() => {
              postMut.mutate(contextMenu.entryId);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 text-green-700 font-medium"
          >
            Post
          </button>
          <button
            onClick={() => window.print()}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
          >
            Print
          </button>
          <hr className="my-1" />
          <button className="w-full text-left px-4 py-2 text-sm hover:bg-red-50 text-red-600">
            Delete
          </button>
        </div>
      )}

      {/* Main Table */}
      <div className="bg-white rounded-lg shadow overflow-auto flex-1">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-4 h-4"
                />
              </th>
              <th
                className="px-4 py-3 text-left cursor-pointer select-none text-xs font-medium text-gray-700 uppercase"
                onClick={() => toggleSort('source')}
              >
                Source <SortIcon col="source" />
              </th>
              <th
                className="px-4 py-3 text-left cursor-pointer select-none text-xs font-medium text-gray-700 uppercase"
                onClick={() => toggleSort('sourceRef')}
              >
                Ref# <SortIcon col="sourceRef" />
              </th>
              <th
                className="px-4 py-3 text-left cursor-pointer select-none text-xs font-medium text-gray-700 uppercase"
                onClick={() => toggleSort('entryDate')}
              >
                Date <SortIcon col="entryDate" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                Description
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                Debits
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                Credits
              </th>
              <th
                className="px-4 py-3 text-left cursor-pointer select-none text-xs font-medium text-gray-700 uppercase"
                onClick={() => toggleSort('status')}
              >
                Status <SortIcon col="status" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                Created By
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map(entry => {
              const lineDebits = (entry.lines ?? []).reduce(
                (s: number, l: any) => s + Number(l.debit ?? 0),
                0
              );
              const lineCredits = (entry.lines ?? []).reduce(
                (s: number, l: any) => s + Number(l.credit ?? 0),
                0
              );
              const isSelected = selected.has(entry.id);
              const badgeVariant = STATUS_BADGE_VARIANT[entry.status as keyof typeof STATUS_BADGE_VARIANT] ?? 'neutral';
              return (
                <tr
                  key={entry.id}
                  className={`hover:bg-brand-light/30 cursor-pointer transition-colors ${isSelected ? 'bg-brand-light' : ''}`}
                  style={{ height: 36 }}
                  onDoubleClick={() => navigate(`/accounting/gl/entry/${entry.id}`)}
                  onContextMenu={e => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, entryId: entry.id });
                  }}
                >
                  <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={e => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(entry.id);
                        else next.delete(entry.id);
                        setSelected(next);
                      }}
                      className="w-4 h-4"
                    />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 font-bold">
                    {entry.source}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{entry.sourceRef ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {entry.entryDate
                      ? new Date(entry.entryDate).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-700 max-w-xs truncate">
                    {entry.description}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {lineDebits > 0 ? `$${fmt(lineDebits)}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {lineCredits > 0 ? `$${fmt(lineCredits)}` : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={badgeVariant}>
                      {STATUS_LABEL[entry.status] ?? entry.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {entry.createdByUserId ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <EmptyState
            title="No journal entries found"
            description='Use "New Entry" to create one.'
          />
        )}
      </div>

      {/* Footer totals */}
      <div className="bg-white rounded-lg shadow px-4 py-2 flex items-center justify-between text-xs text-gray-600">
        <span>
          {sorted.length} entr{sorted.length === 1 ? 'y' : 'ies'} shown
        </span>
        <div className="flex gap-6">
          <span>
            Total Debits:{' '}
            <span className="font-mono font-medium text-gray-900">${fmt(totalDebits)}</span>
          </span>
          <span>
            Total Credits:{' '}
            <span className="font-mono font-medium text-gray-900">${fmt(totalCredits)}</span>
          </span>
          {Math.abs(totalDebits - totalCredits) > 0.01 && (
            <span className="text-red-600 font-medium">
              Out of balance by ${fmt(Math.abs(totalDebits - totalCredits))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
