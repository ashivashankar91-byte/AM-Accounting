import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Plus, Trash2, Search, ArrowLeft, AlertCircle, Check } from 'lucide-react';
import { glApi } from '../../api/client';
import JournalSourceLookup from '../../components/accounting/JournalSourceLookup';
import PageLoader from '../../components/PageLoader';

interface TemplateLine {
  lineOrder: number;
  accountCode: string;
  memo: string;
  isCredit: boolean;
  amount: string;   // stored as string so null (blank) is allowed at use-time
  departmentCode: string;
}

const emptyLine = (order: number): TemplateLine => ({
  lineOrder: order,
  accountCode: '',
  memo: '',
  isCredit: false,
  amount: '',
  departmentCode: '',
});

export default function JournalTemplateEdit() {
  const { id } = useParams<{ id?: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Header state
  const [templateNumber, setTemplateNumber] = useState('');
  const [name, setName] = useState('');
  const [sourceCode, setSourceCode] = useState('88');
  const [sourceName, setSourceName] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<TemplateLine[]>([emptyLine(0), emptyLine(1)]);
  const [showSourceLookup, setShowSourceLookup] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveMode, setSaveMode] = useState<'save' | 'saveNext'>('save');

  // Load existing template
  const { data: existingTemplate, isLoading } = useQuery({
    queryKey: ['journal-template', id],
    queryFn: () => glApi.getTemplate(id!),
    enabled: !isNew,
    retry: false,
  });

  const { data: accounts } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn: glApi.getAccounts,
    retry: false,
  });

  useEffect(() => {
    if (existingTemplate) {
      const t = existingTemplate as any;
      setTemplateNumber(t.templateNumber ?? '');
      setName(t.name ?? '');
      setSourceCode(t.sourceCode ?? '88');
      setDescription(t.description ?? '');
      if (t.lines?.length) {
        setLines(t.lines.map((l: any, idx: number) => ({
          lineOrder: l.lineOrder ?? idx,
          accountCode: l.accountCode ?? '',
          memo: l.memo ?? '',
          isCredit: l.isCredit ?? false,
          amount: l.amount != null ? String(l.amount) : '',
          departmentCode: l.departmentCode ?? '',
        })));
      }
    }
  }, [existingTemplate]);

  const createMut = useMutation({
    mutationFn: (data: any) => glApi.createTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-templates'] });
      if (saveMode === 'saveNext') {
        // Reset for new template
        setTemplateNumber('');
        setName('');
        setDescription('');
        setLines([emptyLine(0), emptyLine(1)]);
        setErrors({});
      } else {
        navigate('/accounting/gl/templates');
      }
    },
    onError: (err: any) => {
      setErrors({ form: err.message || 'Save failed' });
    },
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => glApi.updateTemplate(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-templates'] });
      navigate('/accounting/gl/templates');
    },
    onError: (err: any) => {
      setErrors({ form: err.message || 'Update failed' });
    },
  });

  const isPending = createMut.isPending || updateMut.isPending;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!templateNumber.match(/^[A-Z0-9]{1,8}$/)) errs.templateNumber = 'Must be 1-8 uppercase alphanumeric characters';
    if (!name.trim()) errs.name = 'Template name is required';
    if (!sourceCode) errs.sourceCode = 'Source code is required';
    if (!lines.some(l => l.accountCode)) errs.lines = 'At least one line with an account code is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = (mode: 'save' | 'saveNext') => {
    setSaveMode(mode);
    if (!validate()) return;
    const payload = {
      templateNumber: templateNumber.toUpperCase(),
      name,
      sourceCode,
      description: description || undefined,
      lines: lines
        .filter(l => l.accountCode)
        .map((l, idx) => ({
          lineOrder: idx,
          accountCode: l.accountCode,
          memo: l.memo || undefined,
          isCredit: l.isCredit,
          amount: l.amount ? parseFloat(l.amount) : null,
          departmentCode: l.departmentCode || undefined,
        })),
    };
    if (isNew) createMut.mutate(payload);
    else updateMut.mutate(payload);
  };

  const addLine = () => setLines([...lines, emptyLine(lines.length)]);
  const removeLine = (i: number) => {
    if (lines.length > 1) setLines(lines.filter((_, idx) => idx !== i).map((l, idx) => ({ ...l, lineOrder: idx })));
  };
  const updateLine = (i: number, field: keyof TemplateLine, val: any) => {
    const updated = [...lines];
    updated[i] = { ...updated[i], [field]: val };
    setLines(updated);
  };

  if (isLoading) return <PageLoader page="Journal Template" service="gl-service" port={3010} />;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/accounting/gl/templates')}
            className="text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold">{isNew ? 'New Template' : `Edit Template ${templateNumber}`}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {isNew ? 'Create a reusable journal entry structure.' : 'Modify the template fields and lines.'}
            </p>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {errors.form && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {errors.form}
        </div>
      )}

      {/* Header Fields */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Template Header</h3>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template #</label>
            <input
              type="text"
              value={templateNumber}
              onChange={e => {
                setTemplateNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8));
                setErrors(prev => ({ ...prev, templateNumber: '' }));
              }}
              placeholder="TMPL01"
              disabled={!isNew}
              maxLength={8}
              className={`w-full border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-brand focus:outline-none ${
                !isNew ? 'bg-gray-50 text-gray-500' : ''
              } ${errors.templateNumber ? 'border-red-500' : ''}`}
            />
            {errors.templateNumber && <p className="text-xs text-red-600 mt-1">{errors.templateNumber}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
              placeholder="Monthly Depreciation"
              className={`w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none ${errors.name ? 'border-red-500' : ''}`}
            />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source Code</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={sourceCode}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                  setSourceCode(v);
                  setSourceName('');
                  setSourceError('');
                }}
                onBlur={async () => {
                  if (!sourceCode) return;
                  try {
                    const results = await glApi.getSources(`sourceCode=${encodeURIComponent(sourceCode)}`);
                    const match = (results as any[]).find(s => s.sourceCode === sourceCode);
                    if (match) { setSourceName(match.name); setSourceError(''); }
                    else { setSourceName(''); setSourceError(`Unknown: "${sourceCode}"`); }
                  } catch { setSourceError('Lookup failed'); }
                }}
                placeholder="88"
                maxLength={2}
                className={`w-16 border rounded px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-brand focus:outline-none ${sourceError ? 'border-red-500' : ''}`}
              />
              <button
                type="button"
                onClick={() => setShowSourceLookup(true)}
                className="flex items-center gap-1.5 border border-gray-300 rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                <Search className="w-3.5 h-3.5" />
                Source
              </button>
              {sourceName && <span className="self-center text-sm text-gray-700">{sourceName}</span>}
            </div>
            {sourceError && <p className="text-xs text-red-600 mt-1">{sourceError}</p>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Additional notes..."
            className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
          />
        </div>
      </div>

      {/* Template Lines */}
      <div className="bg-white rounded-lg shadow p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-sm text-gray-700 uppercase tracking-wide">Template Lines</h3>
            <p className="text-xs text-gray-500 mt-0.5">Leave amount blank to fill in at entry time.</p>
          </div>
          <button
            onClick={addLine}
            className="flex items-center gap-1.5 text-xs bg-brand-light text-brand px-3 py-1.5 rounded hover:bg-blue-200 font-medium"
          >
            <Plus className="w-3 h-3" />
            Add Line
          </button>
        </div>

        {errors.lines && (
          <p className="text-xs text-red-600">{errors.lines}</p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="pb-2 w-8">#</th>
                <th className="pb-2 w-16 text-center">DR/CR</th>
                <th className="pb-2">GL Account</th>
                <th className="pb-2">Memo</th>
                <th className="pb-2 text-right w-36">Amount (optional)</th>
                <th className="pb-2 w-24">Dept</th>
                <th className="pb-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50" style={{ height: 36 }}>
                  <td className="py-2 text-gray-400 text-xs">{i + 1}</td>
                  <td className="py-2 pr-2 text-center">
                    <button
                      type="button"
                      onClick={() => updateLine(i, 'isCredit', !line.isCredit)}
                      className={`w-10 py-1 rounded text-xs font-bold border transition-colors ${
                        line.isCredit
                          ? 'bg-orange-100 text-orange-700 border-orange-300'
                          : 'bg-brand-light text-brand border-blue-300'
                      }`}
                    >
                      {line.isCredit ? 'CR' : 'DR'}
                    </button>
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      value={line.accountCode}
                      onChange={e => updateLine(i, 'accountCode', e.target.value)}
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    >
                      <option value="">Select account...</option>
                      {(accounts ?? []).map((a: any) => (
                        <option key={a.id} value={a.code}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      value={line.memo}
                      onChange={e => updateLine(i, 'memo', e.target.value)}
                      placeholder="Optional memo"
                      className="w-full border rounded px-2 py-1.5 text-sm"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.amount}
                      onChange={e => updateLine(i, 'amount', e.target.value)}
                      placeholder="blank = fill at use"
                      className="w-full border rounded px-2 py-1.5 text-sm text-right font-mono"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      value={line.departmentCode}
                      onChange={e => updateLine(i, 'departmentCode', e.target.value)}
                      placeholder=""
                      maxLength={4}
                      className="w-full border rounded px-2 py-1.5 text-sm font-mono"
                    />
                  </td>
                  <td className="py-2">
                    {lines.length > 1 && (
                      <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 text-xs">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex gap-3 justify-end pt-2">
        <button
          onClick={() => navigate('/accounting/gl/templates')}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        {isNew && (
          <button
            onClick={() => handleSave('saveNext')}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-40"
          >
            <Save className="w-4 h-4" />
            Save &amp; Next
          </button>
        )}
        <button
          onClick={() => handleSave('save')}
          disabled={isPending}
          className="flex items-center gap-2 px-6 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-40"
        >
          {isPending ? (
            'Saving...'
          ) : (
            <>
              <Check className="w-4 h-4" />
              Save
            </>
          )}
        </button>
      </div>

      {/* Source Lookup */}
      {showSourceLookup && (
        <JournalSourceLookup
          onSelect={s => {
            setSourceCode(s.sourceCode);
            setSourceName(s.name);
            setSourceError('');
            setShowSourceLookup(false);
          }}
          onClose={() => setShowSourceLookup(false)}
        />
      )}
    </div>
  );
}
