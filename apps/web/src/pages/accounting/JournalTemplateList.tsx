import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit2, FileText, RefreshCw } from 'lucide-react';
import { glApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';

const fmt = (dt: string) => new Date(dt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

export default function JournalTemplateList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);

  const { data: templates, isLoading, error, refetch } = useQuery({
    queryKey: ['journal-templates'],
    queryFn: () => glApi.getTemplates(),
    retry: false,
  });

  const deleteMut = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map(id => glApi.deleteTemplate(id))),
    onSuccess: () => {
      setSelected(new Set());
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ['journal-templates'] });
    },
  });

  if (isLoading) return <PageLoader page="Journal Templates" service="gl-service" port={3010} />;
  if (error) return <PageError error={error} retry={refetch} />;

  const rows = ((templates ?? []) as any[]).filter(t =>
    !search ||
    t.templateNumber?.toLowerCase().includes(search.toLowerCase()) ||
    t.name?.toLowerCase().includes(search.toLowerCase())
  );

  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(rows.map((r: any) => r.id)));
  };
  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  const handleUse = (template: any) => {
    // Navigate to new journal entry with template state
    navigate('/accounting/gl/entry', { state: { templateId: template.id, template } });
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Journal Entry Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">Reusable entry structures for recurring transactions.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate('/accounting/gl/templates/new')}
            className="flex items-center gap-2 bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand"
          >
            <Plus className="w-4 h-4" />
            New Template
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search template# or name..."
          className="border rounded-lg px-3 py-2 text-sm w-72 focus:ring-2 focus:ring-brand focus:outline-none"
        />
        {selected.size > 0 && (
          <button
            onClick={() => setConfirmDelete(Array.from(selected))}
            className="flex items-center gap-2 border border-red-300 text-red-600 rounded-lg px-3 py-2 text-sm hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
            Delete Selected ({selected.size})
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="w-10 px-4 py-3 text-left">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide w-24">Template#</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide">Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide w-20">Source</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide w-16">Lines</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide w-32">Created</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 uppercase tracking-wide w-36">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((t: any) => (
              <tr
                key={t.id}
                style={{ height: 36 }}
                className="hover:bg-brand-light cursor-pointer"
                onDoubleClick={() => navigate(`/accounting/gl/templates/${t.id}`)}
              >
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    onClick={e => e.stopPropagation()}
                    className="rounded"
                  />
                </td>
                <td className="px-4 py-2 font-mono font-bold text-brand">{t.templateNumber}</td>
                <td className="px-4 py-2">{t.name || t.description || '—'}</td>
                <td className="px-4 py-2 font-mono text-gray-600">{t.sourceCode}</td>
                <td className="px-4 py-2 text-right font-mono">{(t.lines ?? []).length}</td>
                <td className="px-4 py-2 text-gray-500">{fmt(t.createdAt)}</td>
                <td className="px-4 py-2">
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUse(t); }}
                      className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 font-medium"
                    >
                      Use
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/accounting/gl/templates/${t.id}`); }}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete([t.id]); }}
                      className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                  <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  No templates found. Click "New Template" to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation Dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-6 space-y-4">
            <h3 className="font-bold text-lg text-red-700">Delete Template{confirmDelete.length > 1 ? 's' : ''}?</h3>
            <p className="text-sm text-gray-600">
              This will permanently delete {confirmDelete.length} template{confirmDelete.length > 1 ? 's' : ''}.
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(confirmDelete)}
                disabled={deleteMut.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                {deleteMut.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
