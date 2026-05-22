import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Edit2, Trash2, Zap, Calendar, RotateCcw } from 'lucide-react';
import { glApi } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import DataTable, { Column } from '../../components/DataTable';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';

// TypeScript Interfaces
interface JournalLine {
  account: string;
  account_name: string;
  debit: number;
  credit: number;
  description: string;
  department?: string;
}

interface RecurringTemplate {
  id: string;
  template_name: string;
  frequency: 'Monthly' | 'Quarterly' | 'Annually';
  next_due_date: string;
  last_generated: string | null;
  auto_post: boolean;
  status: 'ACTIVE' | 'INACTIVE' | 'SCHEDULED';
  lines: JournalLine[];
  start_period: string;
  end_period?: string;
  created_at: string;
  updated_at: string;
}

interface GeneratedEntry {
  id: string;
  template_id: string;
  template_name: string;
  journal_entry_id?: string;
  status: 'DRAFT' | 'POSTED';
  amount: number;
  lines: JournalLine[];
  generated_date: string;
}

// 8 UI States
type UIState = 'idle' | 'loading' | 'success' | 'error' | 'empty' | 'generating' | 'previewing' | 'deleting';

export default function RecurringEntries() {
  const [uiState, setUiState] = useState<UIState>('idle');
  const [showNewTemplate, setShowNewTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);
  const [showGeneratePreview, setShowGeneratePreview] = useState(false);
  const [previewEntries, setPreviewEntries] = useState<GeneratedEntry[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<RecurringTemplate | null>(null);

  const [formData, setFormData] = useState({
    template_name: '',
    frequency: 'Monthly' as const,
    start_period: new Date().toISOString().slice(0, 7),
    end_period: '',
    auto_post: false,
    lines: [{ account: '', account_name: '', debit: 0, credit: 0, description: '', department: '' }],
  });

  // Templates Query
  const { data: templates, isLoading, error, refetch } = useQuery({
    queryKey: ['recurring-templates'],
    queryFn: () => glApi.listEntries('type=recurring'),
    retry: false,
  });

  // Create/Update Template Mutation
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingTemplate) {
        return glApi.approveEntry(editingTemplate.id);
      }
      return glApi.createEntry({ ...data, type: 'recurring' });
    },
    onSuccess: () => {
      refetch();
      setShowNewTemplate(false);
      setEditingTemplate(null);
      setFormData({
        template_name: '',
        frequency: 'Monthly',
        start_period: new Date().toISOString().slice(0, 7),
        end_period: '',
        auto_post: false,
        lines: [{ account: '', account_name: '', debit: 0, credit: 0, description: '', department: '' }],
      });
      setUiState('success');
    },
    onError: () => setUiState('error'),
  });

  // Generate Due Entries Mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      // In production: call recurringApi.generateDue()
      await new Promise((r) => setTimeout(r, 1000));
      const mockGenerated: GeneratedEntry[] = (templates || [])
        .filter((t: any) => new Date(t.next_due_date) <= new Date())
        .map((t: any) => ({
          id: `gen-${t.id}`,
          template_id: t.id,
          template_name: t.template_name,
          status: t.auto_post ? 'POSTED' : 'DRAFT',
          amount: t.lines.reduce((sum: number, l: any) => sum + (l.debit || l.credit), 0),
          lines: t.lines,
          generated_date: new Date().toISOString(),
        }));
      setPreviewEntries(mockGenerated);
      return mockGenerated;
    },
    onSuccess: () => {
      setShowGeneratePreview(true);
      setUiState('previewing');
    },
  });

  // Confirm Generate Mutation
  const confirmGenerateMutation = useMutation({
    mutationFn: async () => {
      await new Promise((r) => setTimeout(r, 800));
      return previewEntries;
    },
    onSuccess: () => {
      refetch();
      setShowGeneratePreview(false);
      setPreviewEntries([]);
      setUiState('success');
    },
  });

  // Delete Template Mutation
  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      // In production: call delete endpoint
      await new Promise((r) => setTimeout(r, 600));
    },
    onSuccess: () => {
      refetch();
      setSelectedTemplate(null);
      setUiState('success');
    },
  });

  const handleSaveTemplate = async () => {
    setUiState('loading');
    saveMutation.mutate(formData);
  };

  const handleGenerateDue = async () => {
    setUiState('generating');
    generateMutation.mutate();
  };

  const handleConfirmGenerate = async () => {
    setUiState('generating');
    confirmGenerateMutation.mutate();
  };

  const handleDeleteTemplate = async (id: string) => {
    setUiState('deleting');
    deleteMutation.mutate(id);
  };

  // Calculate total debit/credit for form
  const totalDebit = formData.lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = formData.lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <RotateCcw className="w-6 h-6" /> Recurring Entries
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">WF-A009: Template-based recurring GL entries with auto-post capability</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleGenerateDue}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700"
            disabled={uiState === 'generating'}
          >
            <Zap className="w-4 h-4" /> {uiState === 'generating' ? 'Generating...' : 'Generate All Due (F8)'}
          </button>
          <button
            onClick={() => setShowNewTemplate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand text-white rounded hover:bg-brand"
          >
            <Plus className="w-4 h-4" /> New Template
          </button>
        </div>
      </div>

      {/* Templates Table */}
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-lg font-semibold mb-4">Recurring Templates</h2>

        {isLoading && <PageLoader page="Recurring Entries" />}
        {error && <PageError error={error} />}
        {!isLoading && !error && (
          <DataTable<RecurringTemplate>
            columns={[
              { key: 'template_name', label: 'Template Name' },
              {
                key: 'frequency',
                label: 'Frequency',
                render: (t) => (
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    t.frequency === 'Monthly' ? 'bg-brand-light text-brand' :
                    t.frequency === 'Quarterly' ? 'bg-purple-100 text-purple-700' :
                    'bg-orange-100 text-orange-700'
                  }`}>
                    {t.frequency}
                  </span>
                ),
              },
              {
                key: 'next_due_date',
                label: 'Next Due',
                render: (t) => new Date(t.next_due_date).toLocaleDateString(),
              },
              {
                key: 'last_generated',
                label: 'Last Generated',
                render: (t) => t.last_generated ? new Date(t.last_generated).toLocaleDateString() : '—',
              },
              {
                key: 'auto_post',
                label: 'Auto-Post',
                render: (t) => (
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    t.auto_post ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {t.auto_post ? 'Yes' : 'No'}
                  </span>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                render: (t) => <StatusBadge status={t.status} />,
              },
            ]}
            data={templates || []}
            onRowClick={(t) => setSelectedTemplate(t)}
            keyField="id"
            emptyTitle="No recurring templates"
            emptySubtitle="Create a template to automate journal entry generation"
          />
        )}
      </div>

      {/* Template Details Panel */}
      {selectedTemplate && (
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 bg-white rounded-lg shadow p-4 space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-semibold">{selectedTemplate.template_name}</h3>
              <button onClick={() => setSelectedTemplate(null)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500 font-medium">Frequency</p>
                <p className="font-medium">{selectedTemplate.frequency}</p>
              </div>
              <div>
                <p className="text-gray-500 font-medium">Next Due</p>
                <p className="font-medium">{new Date(selectedTemplate.next_due_date).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-gray-500 font-medium">Auto-Post</p>
                <p className="font-medium">{selectedTemplate.auto_post ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <p className="text-gray-500 font-medium">Status</p>
                <StatusBadge status={selectedTemplate.status} />
              </div>
            </div>

            {/* Journal Lines */}
            <div>
              <h4 className="font-semibold text-sm mb-3">Journal Lines</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2">Account</th>
                    <th className="text-left py-2">Description</th>
                    <th className="text-right py-2">Debit</th>
                    <th className="text-right py-2">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTemplate.lines.map((line, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-2 font-mono text-xs">{line.account}</td>
                      <td className="py-2 text-gray-700">{line.description}</td>
                      <td className="py-2 text-right font-mono">${line.debit.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono">${line.credit.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold border-t-2">
                    <td colSpan={2} className="py-2">Totals</td>
                    <td className="py-2 text-right font-mono">${selectedTemplate.lines.reduce((s, l) => s + l.debit, 0).toFixed(2)}</td>
                    <td className="py-2 text-right font-mono">${selectedTemplate.lines.reduce((s, l) => s + l.credit, 0).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions Panel */}
          <div className="bg-white rounded-lg shadow p-4 space-y-3">
            <div className="space-y-2">
              <button className="w-full px-3 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50">
                Edit
              </button>
              <button className="w-full px-3 py-2 text-sm font-medium bg-brand text-white rounded hover:bg-brand">
                Clone
              </button>
              <button
                onClick={() => handleDeleteTemplate(selectedTemplate.id)}
                className="w-full px-3 py-2 text-sm font-medium text-red-600 border border-red-300 rounded hover:bg-red-50"
              >
                Delete
              </button>
            </div>

            {/* Period Info */}
            <div className="bg-gray-50 rounded p-3 text-xs space-y-1">
              <p className="font-semibold">Period Range</p>
              <p>Start: {selectedTemplate.start_period}</p>
              {selectedTemplate.end_period && <p>End: {selectedTemplate.end_period}</p>}
            </div>
          </div>
        </div>
      )}

      {/* New/Edit Template Modal */}
      {showNewTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-96 overflow-auto">
            <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white">
              <h3 className="font-semibold">{editingTemplate ? 'Edit Template' : 'Create New Template'}</h3>
              <button onClick={() => setShowNewTemplate(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>

            <div className="p-6 space-y-4">
              {/* Template Header */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Template Name</label>
                  <input
                    type="text"
                    value={formData.template_name}
                    onChange={(e) => setFormData({ ...formData, template_name: e.target.value })}
                    placeholder="e.g., Monthly Depreciation"
                    className="w-full mt-1 border rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Frequency</label>
                  <select
                    value={formData.frequency}
                    onChange={(e) => setFormData({ ...formData, frequency: e.target.value as any })}
                    className="w-full mt-1 border rounded px-3 py-2 text-sm"
                  >
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Annually">Annually</option>
                  </select>
                </div>
              </div>

              {/* Period Range */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Start Period</label>
                  <input
                    type="month"
                    value={formData.start_period}
                    onChange={(e) => setFormData({ ...formData, start_period: e.target.value })}
                    className="w-full mt-1 border rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">End Period (optional)</label>
                  <input
                    type="month"
                    value={formData.end_period}
                    onChange={(e) => setFormData({ ...formData, end_period: e.target.value })}
                    className="w-full mt-1 border rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {/* Auto-Post */}
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.auto_post}
                    onChange={(e) => setFormData({ ...formData, auto_post: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-sm font-medium text-gray-700">Auto-post when generated</span>
                </label>
              </div>

              {/* Journal Lines */}
              <div>
                <h4 className="text-sm font-semibold mb-2">Journal Lines</h4>
                <table className="w-full text-sm mb-2">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2">Account</th>
                      <th className="text-left py-2 px-2">Description</th>
                      <th className="text-right py-2 px-2">Debit</th>
                      <th className="text-right py-2 px-2">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.lines.map((line, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-2 px-2"><input placeholder="1000" className="border rounded px-1 py-0.5 text-xs w-full" value={line.account} onChange={(e) => { const newLines = [...formData.lines]; newLines[i].account = e.target.value; setFormData({ ...formData, lines: newLines }); }} /></td>
                        <td className="py-2 px-2"><input placeholder="Description" className="border rounded px-1 py-0.5 text-xs w-full" value={line.description} onChange={(e) => { const newLines = [...formData.lines]; newLines[i].description = e.target.value; setFormData({ ...formData, lines: newLines }); }} /></td>
                        <td className="py-2 px-2"><input type="number" placeholder="0.00" className="border rounded px-1 py-0.5 text-xs w-20" value={line.debit} onChange={(e) => { const newLines = [...formData.lines]; newLines[i].debit = parseFloat(e.target.value) || 0; setFormData({ ...formData, lines: newLines }); }} /></td>
                        <td className="py-2 px-2"><input type="number" placeholder="0.00" className="border rounded px-1 py-0.5 text-xs w-20" value={line.credit} onChange={(e) => { const newLines = [...formData.lines]; newLines[i].credit = parseFloat(e.target.value) || 0; setFormData({ ...formData, lines: newLines }); }} /></td>
                      </tr>
                    ))}
                    <tr className="font-bold bg-gray-50">
                      <td colSpan={2} className="py-2 px-2">Totals</td>
                      <td className="py-2 px-2 text-right font-mono">${totalDebit.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right font-mono">${totalCredit.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
                {!isBalanced && <p className="text-xs text-red-600 font-medium">⚠ Debits and credits do not balance</p>}
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-4 border-t">
                <button
                  onClick={() => setShowNewTemplate(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={!isBalanced || uiState === 'loading'}
                  className="flex-1 px-4 py-2 text-sm font-medium bg-brand text-white rounded hover:bg-brand disabled:bg-gray-400"
                >
                  {uiState === 'loading' ? 'Saving...' : 'Save Template'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Generate Preview Modal */}
      {showGeneratePreview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-96 overflow-auto">
            <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white">
              <h3 className="font-semibold">Generate Recurring Entries Preview</h3>
              <button onClick={() => setShowGeneratePreview(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>

            <div className="p-6 space-y-4">
              {previewEntries.length === 0 ? (
                <p className="text-gray-500">No entries due for generation</p>
              ) : (
                <>
                  <p className="text-sm text-gray-600">
                    {previewEntries.length} entries ready to be generated. {previewEntries.filter(e => e.status === 'POSTED').length} will be auto-posted.
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2">Template</th>
                        <th className="text-right py-2">Amount</th>
                        <th className="text-left py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewEntries.map((entry) => (
                        <tr key={entry.id} className="border-b border-gray-100">
                          <td className="py-2">{entry.template_name}</td>
                          <td className="py-2 text-right font-mono">${entry.amount.toFixed(2)}</td>
                          <td className="py-2"><StatusBadge status={entry.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <div className="flex gap-2 pt-4 border-t">
                <button
                  onClick={() => setShowGeneratePreview(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmGenerate}
                  disabled={uiState === 'generating' || previewEntries.length === 0}
                  className="flex-1 px-4 py-2 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
                >
                  {uiState === 'generating' ? 'Generating...' : 'Confirm Generate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
