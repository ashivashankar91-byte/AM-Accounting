import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, RotateCcw, Search } from 'lucide-react';
import { glApi } from '../../api/client';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-yellow-100 text-yellow-800',
  COMPLETED: 'bg-green-100 text-green-800',
  REVERSED:  'bg-red-100 text-red-800',
};

interface TransferForm {
  fromCompanyCode: string;
  toCompanyCode: string;
  vin: string;
  stockNumber: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  totalCost: string;
  transferDate: string;
  fromInventoryGlAccountId: string;
  toInventoryGlAccountId: string;
  fromIcOffsetGlAccountId: string;
  toIcOffsetGlAccountId: string;
}

const emptyForm = (): TransferForm => ({
  fromCompanyCode: '', toCompanyCode: '', vin: '', stockNumber: '',
  vehicleYear: '', vehicleMake: '', vehicleModel: '', totalCost: '',
  transferDate: new Date().toISOString().slice(0, 10),
  fromInventoryGlAccountId: '', toInventoryGlAccountId: '',
  fromIcOffsetGlAccountId: '', toIcOffsetGlAccountId: '',
});

export default function VehicleTransfers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<TransferForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [confirmReverseId, setConfirmReverseId] = useState<string | null>(null);

  const params = [
    search ? `search=${encodeURIComponent(search)}` : '',
    statusFilter ? `status=${statusFilter}` : '',
  ].filter(Boolean).join('&');

  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ['vehicle-transfers', params],
    queryFn: () => glApi.listVehicleTransfers(params || undefined),
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: (data: any) => glApi.createVehicleTransfer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-transfers'] });
      setShowNew(false);
      setForm(emptyForm());
      setError(null);
    },
    onError: (e: any) => setError(e.message),
  });

  const reverseMut = useMutation({
    mutationFn: (id: string) => glApi.reverseVehicleTransfer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-transfers'] });
      setConfirmReverseId(null);
    },
    onError: (e: any) => setError(e.message),
  });

  function setField(k: keyof TransferForm, v: string) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.fromCompanyCode === form.toCompanyCode) {
      setError('From and To company codes must be different.');
      return;
    }
    if (form.fromInventoryGlAccountId === form.fromIcOffsetGlAccountId) {
      setError('Sending: Inventory GL account and IC Offset GL account must be different.');
      return;
    }
    if (form.toInventoryGlAccountId === form.toIcOffsetGlAccountId) {
      setError('Receiving: Inventory GL account and IC Offset GL account must be different.');
      return;
    }
    const cost = parseFloat(form.totalCost);
    if (isNaN(cost) || cost <= 0) {
      setError('Total cost must be greater than $0.00.');
      return;
    }
    createMut.mutate({
      fromCompanyCode: form.fromCompanyCode,
      toCompanyCode: form.toCompanyCode,
      vin: form.vin,
      stockNumber: form.stockNumber || undefined,
      vehicleYear: form.vehicleYear ? parseInt(form.vehicleYear) : undefined,
      vehicleMake: form.vehicleMake || undefined,
      vehicleModel: form.vehicleModel || undefined,
      totalCost: cost,
      transferDate: form.transferDate,
      fromInventoryGlAccountId: form.fromInventoryGlAccountId,
      toInventoryGlAccountId: form.toInventoryGlAccountId,
      fromIcOffsetGlAccountId: form.fromIcOffsetGlAccountId,
      toIcOffsetGlAccountId: form.toIcOffsetGlAccountId,
    });
  }

  const glInput = (label: string, field: keyof TransferForm, placeholder?: string) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        value={form[field]}
        onChange={e => setField(field, e.target.value)}
        placeholder={placeholder}
        className="w-full border rounded px-3 py-1.5 text-sm"
      />
    </div>
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Vehicle Transfers</h2>
          <p className="text-sm text-gray-500">Move vehicles between rooftops with automatic IC GL entries</p>
        </div>
        <button
          onClick={() => { setShowNew(true); setError(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand"
        >
          <Plus className="w-4 h-4" /> New Transfer
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search VIN, stock#..."
            className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="COMPLETED">Completed</option>
          <option value="REVERSED">Reversed</option>
        </select>
      </div>

      {/* New Transfer Form */}
      {showNew && (
        <div className="bg-white rounded-lg shadow-md border p-6 space-y-4">
          <h3 className="font-semibold text-base">New Vehicle Transfer</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {glInput('From Company Code', 'fromCompanyCode', '01')}
              {glInput('To Company Code', 'toCompanyCode', '02')}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {glInput('VIN', 'vin', '17-char VIN')}
              {glInput('Stock Number', 'stockNumber')}
              {glInput('Transfer Date', 'transferDate')}
            </div>
            <div className="grid grid-cols-4 gap-4">
              {glInput('Year', 'vehicleYear', '2024')}
              {glInput('Make', 'vehicleMake', 'Ford')}
              {glInput('Model', 'vehicleModel', 'F-150')}
              {glInput('Total Cost', 'totalCost', '0.00')}
            </div>
            <div className="border-t pt-3">
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Sending Company GL Accounts</p>
              <div className="grid grid-cols-2 gap-4">
                {glInput('Inventory GL Account (Credit)', 'fromInventoryGlAccountId', 'GL Account ID')}
                {glInput('IC Offset GL Account (Debit)', 'fromIcOffsetGlAccountId', 'GL Account ID')}
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Receiving Company GL Accounts</p>
              <div className="grid grid-cols-2 gap-4">
                {glInput('Inventory GL Account (Debit)', 'toInventoryGlAccountId', 'GL Account ID')}
                {glInput('IC Offset GL Account (Credit)', 'toIcOffsetGlAccountId', 'GL Account ID')}
              </div>
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{error}</div>
            )}
            <div className="p-3 bg-brand-light border border-brand-border rounded text-xs text-brand">
              <strong>GL Entries (atomic):</strong><br />
              Sending: DR IC Offset / CR Inventory · Receiving: DR Inventory / CR IC Offset<br />
              Both entries post through the approval pipeline simultaneously. If either fails, both roll back.
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={createMut.isPending}
                className="px-5 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-40"
              >
                {createMut.isPending ? 'Posting...' : 'Post Transfer'}
              </button>
              <button
                type="button"
                onClick={() => { setShowNew(false); setError(null); }}
                className="px-4 py-2 border rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Transfers Table */}
      <div className="bg-white rounded-lg shadow">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Loading transfers...</div>
        ) : (transfers as any[]).length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No vehicle transfers found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b bg-gray-50">
                <th className="px-4 py-3">Transfer</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Total Cost</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {(transfers as any[]).map(t => (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{t.fromCompanyCode}</span>
                      <ArrowRight className="w-4 h-4 text-gray-400" />
                      <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{t.toCompanyCode}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs">{t.vin}</div>
                    {t.stockNumber && <div className="text-xs text-gray-500">#{t.stockNumber}</div>}
                    {(t.vehicleYear || t.vehicleMake) && (
                      <div className="text-xs text-gray-500">
                        {[t.vehicleYear, t.vehicleMake, t.vehicleModel].filter(Boolean).join(' ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {t.transferDate ? new Date(t.transferDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">${fmt(Number(t.totalCost))}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.status === 'COMPLETED' && (
                      <button
                        onClick={() => setConfirmReverseId(t.id)}
                        className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                      >
                        <RotateCcw className="w-3 h-3" /> Reverse
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reverse Confirm Dialog */}
      {confirmReverseId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96 space-y-4">
            <h3 className="font-semibold text-lg">Reverse Transfer?</h3>
            <p className="text-sm text-gray-600">
              This will create offsetting GL entries in both companies and mark the transfer as REVERSED. This action cannot be undone.
            </p>
            {error && <div className="bg-red-50 border border-red-200 rounded p-2 text-sm text-red-700">{error}</div>}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => reverseMut.mutate(confirmReverseId)}
                disabled={reverseMut.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                {reverseMut.isPending ? 'Reversing...' : 'Reverse Transfer'}
              </button>
              <button
                onClick={() => { setConfirmReverseId(null); setError(null); }}
                className="px-4 py-2 border rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
