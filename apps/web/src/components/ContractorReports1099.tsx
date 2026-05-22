import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { glApi } from '../api/client';
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
  const [activeTab, setActiveTab] = useState<'generate' | 'review' | 'export'>('review');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedStatus, setSelectedStatus] = useState<'DRAFT' | 'REVIEWED' | 'FILED' | undefined>();
  const [minPayment, setMinPayment] = useState('600');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { data: records, isLoading: recordsLoading, error: recordsError } = useQuery({
    queryKey: ['1099-records', selectedYear, selectedStatus],
    queryFn: () => glApi.list1099Records(`?taxYear=${selectedYear}${selectedStatus ? `&status=${selectedStatus}` : ''}`),
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

  if (activeTab === 'generate') {
    return (
      <div className="space-y-4">
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
