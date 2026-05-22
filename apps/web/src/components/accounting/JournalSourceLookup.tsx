import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Search, Check } from 'lucide-react';
import { glApi } from '../../api/client';

export interface GlSource {
  id?: string;
  sourceCode: string;
  name: string;
  autoPost?: boolean;
  isYearEndReserved?: boolean;
  is13thMonthReserved?: boolean;
}

interface Props {
  /** When false, renders nothing. Defaults to true for backward-compat conditional renders. */
  isOpen?: boolean;
  onClose: () => void;
  onSelect: (source: GlSource) => void;
}

export default function JournalSourceLookup({ isOpen = true, onSelect, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const { data: sources, isLoading } = useQuery({
    queryKey: ['gl-sources'],
    queryFn: () => glApi.getSources(),
    retry: false,
  });

  const rows = ((sources ?? []) as GlSource[]).filter(
    s =>
      !search ||
      String(s.sourceCode ?? '').toLowerCase().includes(search.toLowerCase()) ||
      String(s.name ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // Reset highlight when filter changes
  useEffect(() => { setHighlightedIdx(0); }, [search]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) { setSearch(''); setHighlightedIdx(0); }
  }, [isOpen]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(highlightedIdx + 1, rows.length - 1);
      setHighlightedIdx(next);
      rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(highlightedIdx - 1, 0);
      setHighlightedIdx(prev);
      rowRefs.current[prev]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter' && rows.length > 0) {
      e.preventDefault();
      onSelect(rows[highlightedIdx]);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[500px] max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKey}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="font-bold text-lg">Select Journal Source</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              autoFocus              ref={searchRef}              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Type source code or name to filter..."
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm font-mono focus:ring-2 focus:ring-brand focus:outline-none"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="py-12 text-center text-gray-500 text-sm">Loading sources...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b sticky top-0">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase w-16">
                    Code
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Name
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-700 uppercase">
                    Auto-Post
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-700 uppercase">
                    YE Rsv.
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-700 uppercase">
                    13M Rsv.
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((s: GlSource, idx) => (
                  <tr
                    key={s.id ?? s.sourceCode}
                    ref={el => { rowRefs.current[idx] = el; }}
                    className={`cursor-pointer transition-colors ${
                      idx === highlightedIdx ? 'bg-blue-100' : 'hover:bg-brand-light'
                    }`}
                    onMouseEnter={() => setHighlightedIdx(idx)}
                    onClick={() => { onSelect(s); onClose(); }}
                  >
                    <td className="px-6 py-3 font-mono font-bold text-brand text-sm">
                      {s.sourceCode}
                    </td>
                    <td className="px-6 py-3 text-sm">{s.name}</td>
                    <td className="px-6 py-3 text-center text-sm">
                      {s.autoPost ? (
                        <Check className="w-4 h-4 text-green-600 mx-auto" />
                      ) : null}
                    </td>
                    <td className="px-6 py-3 text-center text-sm">
                      {s.isYearEndReserved ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">YE</span>
                      ) : null}
                    </td>
                    <td className="px-6 py-3 text-center text-sm">
                      {s.is13thMonthReserved ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-purple-100 text-purple-800">13</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-gray-500 text-sm">
                      {sources && (sources as any[]).length === 0
                        ? 'No journal sources configured. Contact your administrator.'
                        : `No sources match "${search}"`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-6 py-3 border-t bg-gray-50 text-xs text-gray-500 flex-shrink-0">
          Click a row to select. Press Esc to cancel.
        </div>
      </div>
    </div>
  );
}
