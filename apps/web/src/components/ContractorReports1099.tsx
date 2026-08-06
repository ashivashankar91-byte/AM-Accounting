import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { glApi, vendor1099AdminApi } from '../api/client';
import PageError from './PageError';
import { SkeletonTable } from './Skeleton';

function formatCurrency(val: number | string) {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Vendor1099Record {
  id: string;
  vendorId: string;
  vendorName?: string;
  taxYear: number;
  formType: '1099-NEC' | '1099-MISC';
  totalPayments: number;
  status: 'DRAFT' | 'REVIEWED' | 'FILED' | 'CORRECTED' | 'VOID';
  boxAmounts: Record<string, number>;
  adjustmentReason?: string;
  createdAt: string;
}

export default function ContractorReports1099() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'generate' | 'review' | 'export' | 'box-rules' | 'thresholds' | 'corrections' | 'year-preview'>('review');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedStatus, setSelectedStatus] = useState<'DRAFT' | 'REVIEWED' | 'FILED' | undefined>();
  const [minPayment, setMinPayment] = useState('600');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { data: records, isLoading: recordsLoading, error: recordsError } = useQuery({
    queryKey: ['1099-records', selectedYear, selectedStatus],
    queryFn: () => glApi.list1099Records(`taxYear=${selectedYear}${selectedStatus ? `&status=${selectedStatus}` : ''}`),
    retry: false,
  });

  const generateMutation = useMutation({
    mutationFn: (data: any) => glApi.generate1099Forms(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['1099-records'] });
      showToast('1099 forms generated', 'success');
      setMinPayment('600');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to generate forms', 'error');
    },
  });

  const exportMutation = useMutation({
    mutationFn: (data: any) => glApi.export1099Forms(data),
    onSuccess: () => {
      showToast('Forms exported to FIRE format', 'success');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to export', 'error');
    },
  });

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleGenerate() {
    if (!selectedYear) return;
    generateMutation.mutate({
      taxYear: selectedYear,
      minimumThreshold: parseFloat(minPayment) || 600,
    });
  }

  function handleExport() {
    const recordsToExport = records?.filter((r: Vendor1099Record) => r.status === 'FILED') || [];
    if (recordsToExport.length === 0) {
      showToast('No filed forms to export', 'error');
      return;
    }
    exportMutation.mutate({
      year: selectedYear,
      formType: '1099-NEC',
      records: recordsToExport.map((r: Vendor1099Record) => r.id),
    });
  }

  const recordsError_ = recordsError as any;

  // ── Admin tab renderer helpers ──
  if (activeTab === 'box-rules') return <BoxRulesTab />;
  if (activeTab === 'thresholds') return <ThresholdConfigsTab />;
  if (activeTab === 'corrections') return <CorrectionsTab />;
  if (activeTab === 'year-preview') return <YearPreviewTab />;

  if (activeTab === 'generate') {
    return (
      <div className="space-y-4">
        <TabNav activeTab={activeTab} setActiveTab={setActiveTab} />
        <h3 className="text-lg font-semibold">Generate 1099 Forms</h3>

        <div className="bg-gray-50 p-4 rounded border border-gray-200 space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Tax Year</label>
              <input
                type="number"
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Minimum Payment ($)</label>
              <input
                type="number"
                step="0.01"
                value={minPayment}
                onChange={(e) => setMinPayment(e.target.value)}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-gray-600">Only vendors with total payments ≥ threshold will be included</p>
          <button
            onClick={handleGenerate}
            disabled={generateMutation.isPending}
            className="w-full px-3 py-2 bg-brand text-white rounded text-sm hover:bg-brand disabled:opacity-50"
          >
            {generateMutation.isPending ? 'Generating...' : 'Generate 1099 Forms'}
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'export') {
    return (
      <div className="space-y-4">
        <TabNav activeTab={activeTab} setActiveTab={setActiveTab} />
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Export 1099 Forms</h3>
          <button
            onClick={handleExport}
            disabled={exportMutation.isPending || !records?.some((r: Vendor1099Record) => r.status === 'FILED')}
            className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
          >
            {exportMutation.isPending ? 'Exporting...' : 'Export to FIRE'}
          </button>
        </div>

        <div className="bg-brand-light border border-brand-border rounded p-3 text-sm text-blue-800">
          <p className="font-semibold mb-1">FIRE Format Export</p>
          <p>Only FILED status forms will be exported. Records will be formatted for IRS transmission.</p>
        </div>

        {recordsLoading && <SkeletonTable />}
        {recordsError && <PageError error={recordsError_} />}

        {records && (
          <div className="overflow-x-auto border border-gray-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Vendor</th>
                  <th className="px-4 py-2 text-left font-semibold">Form Type</th>
                  <th className="px-4 py-2 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2 text-left font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {records.filter((r: Vendor1099Record) => r.status === 'FILED').map((r: Vendor1099Record) => (
                  <tr key={r.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2">{r.vendorName || r.vendorId}</td>
                    <td className="px-4 py-2">{r.formType}</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">${formatCurrency(r.totalPayments)}</td>
                    <td className="px-4 py-2">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">FILED</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // Review tab
  return (
    <div className="space-y-4">
      <TabNav activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Review 1099 Records</h3>
        <div className="flex gap-2">
          <input
            type="number"
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="px-2 py-1 border border-gray-300 rounded text-sm w-24"
          />
          <select
            value={selectedStatus || ''}
            onChange={(e) => setSelectedStatus(e.target.value ? (e.target.value as any) : undefined)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="">All Status</option>
            <option value="DRAFT">Draft</option>
            <option value="REVIEWED">Reviewed</option>
            <option value="FILED">Filed</option>
          </select>
        </div>
      </div>

      {recordsLoading && <SkeletonTable />}
      {recordsError && <PageError error={recordsError_} />}

      {records && records.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Vendor</th>
                <th className="px-4 py-2 text-left font-semibold">Form</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-left font-semibold">Box 1a</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r: Vendor1099Record) => (
                <tr key={r.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2">{r.vendorName || r.vendorId}</td>
                  <td className="px-4 py-2">{r.formType}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">${formatCurrency(r.totalPayments)}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                      r.status === 'FILED' ? 'bg-green-100 text-green-700' :
                      r.status === 'REVIEWED' ? 'bg-blue-100 text-brand' :
                      r.status === 'DRAFT' ? 'bg-gray-100 text-gray-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">${formatCurrency(r.boxAmounts?.['1a'] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {records && records.length === 0 && <p className="text-gray-600 text-sm">No 1099 records found</p>}

      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-2 rounded text-sm text-white ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ─── Tab navigation bar ───────────────────────────────────────────────────────

const ALL_TABS = [
  { key: 'review',       label: 'Review' },
  { key: 'generate',     label: 'Generate' },
  { key: 'export',       label: 'Export' },
  { key: 'box-rules',    label: 'Box Rules' },
  { key: 'thresholds',   label: 'Thresholds' },
  { key: 'corrections',  label: 'Corrections' },
  { key: 'year-preview', label: 'Year Preview' },
] as const;

type AnyTab = typeof ALL_TABS[number]['key'];

function TabNav({ activeTab, setActiveTab }: { activeTab: AnyTab; setActiveTab: (t: AnyTab) => void }) {
  return (
    <div className="flex gap-1 border-b border-gray-200 mb-2">
      {ALL_TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setActiveTab(t.key as AnyTab)}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === t.key
              ? 'border-b-2 border-brand text-brand -mb-px'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Box Rules Tab ────────────────────────────────────────────────────────────

function BoxRulesTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ vendorId: '', taxYear: String(new Date().getFullYear()), formType: '1099-NEC' as const, boxCode: '' });
  const [formErr, setFormErr] = useState<string | null>(null);

  const { data: rules, isLoading, error, refetch } = useQuery({
    queryKey: ['1099-box-rules'],
    queryFn: () => vendor1099AdminApi.getBoxRules(),
    retry: false,
  });

  const setMutation = useMutation({
    mutationFn: () => vendor1099AdminApi.setBoxRule({
      vendorId: form.vendorId.trim(),
      taxYear: parseInt(form.taxYear),
      formType: form.formType,
      boxCode: form.boxCode.trim(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['1099-box-rules'] });
      setForm({ vendorId: '', taxYear: String(new Date().getFullYear()), formType: '1099-NEC', boxCode: '' });
      setFormErr(null);
    },
    onError: (err: any) => setFormErr(err.message ?? 'Failed'),
  });

  const errAny = error as any;
  if (errAny?.status === 401 || errAny?.status === 403) return <UnauthorizedBanner />;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-bold text-gray-900">Box Rules</h3>
      <div className="bg-gray-50 p-4 rounded border border-gray-200 space-y-3">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Set Box Rule</p>
        {formErr && <p className="text-xs text-red-600">{formErr}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Vendor ID *</label>
            <input className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Tax Year *</label>
            <input type="number" className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              value={form.taxYear} onChange={(e) => setForm({ ...form, taxYear: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Form Type *</label>
            <select className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              value={form.formType} onChange={(e) => setForm({ ...form, formType: e.target.value as any })}>
              <option value="1099-NEC">1099-NEC</option>
              <option value="1099-MISC">1099-MISC</option>
              <option value="T4A">T4A</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Box Code *</label>
            <input className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              value={form.boxCode} onChange={(e) => setForm({ ...form, boxCode: e.target.value })} placeholder="e.g. 1" />
          </div>
        </div>
        <button
          onClick={() => setMutation.mutate()}
          disabled={setMutation.isPending || !form.vendorId || !form.boxCode}
          className="px-4 py-1.5 bg-brand text-white rounded text-sm disabled:opacity-50"
        >
          {setMutation.isPending ? 'Saving…' : 'Set Box Rule'}
        </button>
      </div>

      {isLoading && <SkeletonTable />}
      {error && <PageError error={error as Error} retry={refetch} />}
      {Array.isArray(rules) && rules.length === 0 && <p className="text-sm text-gray-500">No box rules configured.</p>}
      {Array.isArray(rules) && rules.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                {['Vendor ID', 'Tax Year', 'Form Type', 'Box Code'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map((r: any, i: number) => (
                <tr key={r.id ?? i} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{r.vendorId ?? '—'}</td>
                  <td className="px-4 py-2">{r.taxYear ?? '—'}</td>
                  <td className="px-4 py-2">{r.formType ?? '—'}</td>
                  <td className="px-4 py-2">{r.boxCode ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Threshold Configs Tab ────────────────────────────────────────────────────

function ThresholdConfigsTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ formType: '1099-NEC' as const, taxYear: String(new Date().getFullYear()), thresholdAmount: '' });
  const [formErr, setFormErr] = useState<string | null>(null);

  const { data: configs, isLoading, error, refetch } = useQuery({
    queryKey: ['1099-threshold-configs'],
    queryFn: () => vendor1099AdminApi.getThresholdConfigs(),
    retry: false,
  });

  const setMutation = useMutation({
    mutationFn: () => vendor1099AdminApi.setThresholdConfig({
      formType: form.formType,
      taxYear: parseInt(form.taxYear),
      thresholdAmount: parseFloat(form.thresholdAmount),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['1099-threshold-configs'] });
      setForm({ formType: '1099-NEC', taxYear: String(new Date().getFullYear()), thresholdAmount: '' });
      setFormErr(null);
    },
    onError: (err: any) => setFormErr(err.message ?? 'Failed'),
  });

  const errAny = error as any;
  if (errAny?.status === 401 || errAny?.status === 403) return <UnauthorizedBanner />;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-bold text-gray-900">Threshold Configs</h3>
      <div className="bg-gray-50 p-4 rounded border border-gray-200 space-y-3">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Set Threshold</p>
        {formErr && <p className="text-xs text-red-600">{formErr}</p>}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Form Type *</label>
            <select className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              value={form.formType} onChange={(e) => setForm({ ...form, formType: e.target.value as any })}>
              <option value="1099-NEC">1099-NEC</option>
              <option value="1099-MISC">1099-MISC</option>
              <option value="T4A">T4A</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Tax Year *</label>
            <input type="number" className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              value={form.taxYear} onChange={(e) => setForm({ ...form, taxYear: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Threshold Amount *</label>
            <input type="number" step="0.01" className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono"
              value={form.thresholdAmount} onChange={(e) => setForm({ ...form, thresholdAmount: e.target.value })} placeholder="600.00" />
          </div>
        </div>
        <button
          onClick={() => setMutation.mutate()}
          disabled={setMutation.isPending || !form.thresholdAmount}
          className="px-4 py-1.5 bg-brand text-white rounded text-sm disabled:opacity-50"
        >
          {setMutation.isPending ? 'Saving…' : 'Set Threshold'}
        </button>
      </div>

      {isLoading && <SkeletonTable />}
      {error && <PageError error={error as Error} retry={refetch} />}
      {Array.isArray(configs) && configs.length === 0 && <p className="text-sm text-gray-500">No threshold configs found.</p>}
      {Array.isArray(configs) && configs.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                {['Form Type', 'Tax Year', 'Threshold Amount'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {configs.map((c: any, i: number) => (
                <tr key={c.id ?? i} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2">{c.formType ?? '—'}</td>
                  <td className="px-4 py-2">{c.taxYear ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-right">${typeof c.thresholdAmount === 'number' ? c.thresholdAmount.toFixed(2) : (c.thresholdAmount ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Corrections Tab ──────────────────────────────────────────────────────────

function CorrectionsTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    vendorId: '', taxYear: String(new Date().getFullYear()),
    formType: '1099-NEC' as const, correctedAmount: '', reason: '',
  });
  const [formErr, setFormErr] = useState<string | null>(null);

  const { data: corrections, isLoading, error, refetch } = useQuery({
    queryKey: ['1099-corrections'],
    queryFn: () => vendor1099AdminApi.getCorrections(),
    retry: false,
  });

  const postMutation = useMutation({
    mutationFn: () => vendor1099AdminApi.postCorrection({
      vendorId: form.vendorId.trim(),
      taxYear: parseInt(form.taxYear),
      formType: form.formType,
      correctedAmount: parseFloat(form.correctedAmount),
      reason: form.reason.trim(),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['1099-corrections'] });
      setForm({ vendorId: '', taxYear: String(new Date().getFullYear()), formType: '1099-NEC', correctedAmount: '', reason: '' });
      setFormErr(null);
    },
    onError: (err: any) => setFormErr(err.message ?? 'Failed'),
  });

  const errAny = error as any;
  if (errAny?.status === 401 || errAny?.status === 403) return <UnauthorizedBanner />;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-bold text-gray-900">Corrections</h3>
      <div className="bg-gray-50 p-4 rounded border border-gray-200 space-y-3">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Post Correction</p>
        {formErr && <p className="text-xs text-red-600">{formErr}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Vendor ID *</label>
            <input className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Tax Year *</label>
            <input type="number" className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              value={form.taxYear} onChange={(e) => setForm({ ...form, taxYear: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Form Type *</label>
            <select className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              value={form.formType} onChange={(e) => setForm({ ...form, formType: e.target.value as any })}>
              <option value="1099-NEC">1099-NEC</option>
              <option value="1099-MISC">1099-MISC</option>
              <option value="T4A">T4A</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Corrected Amount *</label>
            <input type="number" step="0.01" className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono"
              value={form.correctedAmount} onChange={(e) => setForm({ ...form, correctedAmount: e.target.value })} placeholder="0.00" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-gray-700 mb-1">Reason *</label>
            <input className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason for correction" />
          </div>
        </div>
        <button
          onClick={() => postMutation.mutate()}
          disabled={postMutation.isPending || !form.vendorId || !form.correctedAmount || !form.reason}
          className="px-4 py-1.5 bg-brand text-white rounded text-sm disabled:opacity-50"
        >
          {postMutation.isPending ? 'Posting…' : 'Post Correction'}
        </button>
      </div>

      {isLoading && <SkeletonTable />}
      {error && <PageError error={error as Error} retry={refetch} />}
      {Array.isArray(corrections) && corrections.length === 0 && <p className="text-sm text-gray-500">No corrections found.</p>}
      {Array.isArray(corrections) && corrections.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                {['Vendor ID', 'Year', 'Form', 'Corrected Amount', 'Reason', 'Created'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corrections.map((c: any, i: number) => (
                <tr key={c.id ?? i} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{c.vendorId ?? '—'}</td>
                  <td className="px-4 py-2">{c.taxYear ?? '—'}</td>
                  <td className="px-4 py-2">{c.formType ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">${typeof c.correctedAmount === 'number' ? c.correctedAmount.toFixed(2) : (c.correctedAmount ?? '—')}</td>
                  <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{c.reason ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-gray-400">{c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-US') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Year Preview Tab ─────────────────────────────────────────────────────────

function YearPreviewTab() {
  const [taxYear, setTaxYear] = useState(new Date().getFullYear());

  const { data: preview, isLoading, error, refetch } = useQuery({
    queryKey: ['1099-year-preview', taxYear],
    queryFn: () => vendor1099AdminApi.getYearPreview(taxYear),
    retry: false,
  });

  const errAny = error as any;
  if (errAny?.status === 401 || errAny?.status === 403) return <UnauthorizedBanner />;

  const previewData = preview as any;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-bold text-gray-900">Year Preview</h3>
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold text-gray-700">Tax Year</label>
        <input
          type="number"
          value={taxYear}
          onChange={(e) => setTaxYear(parseInt(e.target.value))}
          className="px-2 py-1 border border-gray-300 rounded text-sm w-24"
        />
      </div>

      {isLoading && <SkeletonTable />}
      {error && <PageError error={error as Error} retry={refetch} />}

      {previewData && !isLoading && !error && (
        <div className="space-y-4">
          {/* Render preview defensively — shape may vary per API response */}
          {Array.isArray(previewData) ? (
            <div className="overflow-x-auto border border-gray-200 rounded">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 border-b">
                  <tr>
                    {previewData.length > 0
                      ? Object.keys(previewData[0]).map((k) => (
                          <th key={k} className="px-4 py-2 text-left font-semibold capitalize">{k.replace(/_/g, ' ')}</th>
                        ))
                      : <th className="px-4 py-2 text-left">No columns</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  {previewData.map((row: any, i: number) => (
                    <tr key={row.id ?? i} className="border-b hover:bg-gray-50">
                      {Object.values(row).map((v: any, j: number) => (
                        <td key={j} className="px-4 py-2 text-sm">{String(v ?? '—')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-gray-50 p-4 rounded border border-gray-200">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {Object.entries(previewData).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-gray-500 capitalize shrink-0">{k.replace(/_/g, ' ')}:</dt>
                    <dd className="font-semibold text-gray-800">{typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}

      {!previewData && !isLoading && !error && (
        <p className="text-sm text-gray-500">No preview data for {taxYear}.</p>
      )}
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function UnauthorizedBanner() {
  return (
    <div className="rounded border border-red-200 bg-red-50 p-4 text-center">
      <p className="text-red-700 font-semibold text-sm">Unauthorized</p>
      <p className="text-red-600 text-xs mt-1">You do not have permission to access this section.</p>
    </div>
  );
}
