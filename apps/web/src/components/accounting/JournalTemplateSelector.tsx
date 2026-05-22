import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X, FileText } from 'lucide-react';
import { glApi } from '../../api/client';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (template: any) => void;
}

const fmt = (dt: string) => new Date(dt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

export default function JournalTemplateSelector({ isOpen, onClose, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['journal-templates'],
    queryFn: () => glApi.getTemplates(),
    enabled: isOpen,
    retry: false,
  });

  const rows = ((templates ?? []) as any[]).filter(t =>
    !search ||
    t.templateNumber?.toLowerCase().includes(search.toLowerCase()) ||
    t.name?.toLowerCase().includes(search.toLowerCase())
  );

  // Reset selection when search changes
  useEffect(() => { setHighlightedIdx(0); }, [search]);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 50);
      setSearch('');
      setHighlightedIdx(0);
    }
  }, [isOpen]);

  // Scroll highlighted row into view
  useEffect(() => {
    rowRefs.current[highlightedIdx]?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIdx]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx(prev => Math.min(prev + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[highlightedIdx]) { onSelect(rows[highlightedIdx]); onClose(); }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="bg-white rounded-xl shadow-2xl flex flex-col"
        style={{ width: 600, maxHeight: '70vh' }}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b">
          <h2 className="text-lg font-semibold">Select Journal Template</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b bg-gray-50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search template# or name..."
              className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-brand focus:outline-none"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <p className="text-center text-sm text-gray-400 py-10">Loading templates...</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-gray-400">
              <FileText className="w-10 h-10 mb-3 text-gray-200" />
              <p className="text-sm">No templates found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-24">Template#</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Name</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-16">Source</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase w-12">Lines</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase w-28">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t, idx) => (
                  <tr
                    key={t.id}
                    ref={el => { rowRefs.current[idx] = el; }}
                    style={{ height: 36 }}
                    className={`cursor-pointer ${
                      idx === highlightedIdx
                        ? 'bg-brand text-white'
                        : 'hover:bg-brand-light'
                    }`}
                    onClick={() => { onSelect(t); onClose(); }}
                    onMouseEnter={() => setHighlightedIdx(idx)}
                  >
                    <td className="px-4 py-2 font-mono font-bold">{t.templateNumber}</td>
                    <td className="px-4 py-2">{t.name || '—'}</td>
                    <td className="px-4 py-2 font-mono">{t.sourceCode}</td>
                    <td className="px-4 py-2 text-right font-mono">{(t.lines ?? []).length}</td>
                    <td className={`px-4 py-2 ${idx === highlightedIdx ? 'text-blue-100' : 'text-gray-400'}`}>{fmt(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="px-4 py-2 text-xs text-gray-400 border-t bg-gray-50">
          ↑↓ navigate · Enter select · Esc dismiss
        </p>
      </div>
    </div>
  );
}
