import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { glApi } from '../api/client';
import PageError from './PageError';
import { SkeletonTable } from './Skeleton';

function formatCurrency(val: number | string) {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface TaxJurisdiction {
  id: string;
  jurisdiction_code: string;
  jurisdiction_level: 'FEDERAL' | 'STATE' | 'COUNTY' | 'CITY';
  tax_rate: number;
  is_active: boolean;
  effective_date: string;
}

interface TaxLiability {
  jurisdiction_code: string;
  tax_rate: number;
  period_month: number;
  period_year: number;
  month_accrual: number;
  prior_unpaid: number;
  total_due: number;
}

export default function SalesTaxAccrual() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'jurisdictions' | 'accrue' | 'report'>('jurisdictions');
  const [showJurisdictionForm, setShowJurisdictionForm] = useState(false);
  const [jurisdiction, setJurisdiction] = useState('');
  const [jurisdictionLevel, setJurisdictionLevel] = useState<'FEDERAL' | 'STATE' | 'COUNTY' | 'CITY'>('STATE');
  const [taxRate, setTaxRate] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [taxableAmount, setTaxableAmount] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { data: jurisdictions, isLoading: jurisdictionsLoading, error: jurisdictionsError } = useQuery({
    queryKey: ['tax-jurisdictions'],
    queryFn: () => glApi.listTaxRates(),
    retry: false,
  });

  const { data: liabilityReport, isLoading: reportLoading, error: reportError } = useQuery({
    queryKey: ['tax-liability-report', selectedYear, selectedMonth],
    queryFn: () => glApi.getTaxLiabilityReport(`?year=${selectedYear}&month=${selectedMonth}`),
    retry: false,
  });

  const createJurisdictionMutation = useMutation({
    mutationFn: (data: any) => glApi.configureTaxJurisdiction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-jurisdictions'] });
      showToast('Tax jurisdiction configured', 'success');
      setShowJurisdictionForm(false);
      setJurisdiction('');
      setTaxRate('');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to create jurisdiction', 'error');
    },
  });

  const accrueTaxMutation = useMutation({
    mutationFn: (data: any) => glApi.accrueTax(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-liability-report'] });
      showToast('Tax accrual created', 'success');
      setTaxableAmount('');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to accrue tax', 'error');
    },
  });

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleCreateJurisdiction() {
    if (!jurisdiction || !taxRate) {
      showToast('Please fill in all fields', 'error');
      return;
    }
    createJurisdictionMutation.mutate({
      jurisdictionCode: jurisdiction,
      jurisdictionLevel,
      taxRate: parseFloat(taxRate),
      isActive: true,
      effectiveDate: new Date().toISOString().split('T')[0],
    });
  }

  function handleAccrueTax() {
    if (!jurisdiction || !taxableAmount) {
      showToast('Please select jurisdiction and enter amount', 'error');
      return;
    }
    accrueTaxMutation.mutate({
      jurisdictionCode: jurisdiction,
      taxableAmount: parseFloat(taxableAmount),
      taxExemptions: [],
    });
  }

  const jurisdictionsError_ = jurisdictionsError as any;
  const reportError_ = reportError as any;

  if (activeTab === 'jurisdictions') {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Tax Jurisdictions</h3>
          <button
            onClick={() => setShowJurisdictionForm(!showJurisdictionForm)}
            className="px-3 py-1 bg-brand text-white rounded text-sm hover:bg-brand"
          >
            {showJurisdictionForm ? 'Cancel' : 'Add Jurisdiction'}
          </button>
        </div>

        {showJurisdictionForm && (
          <div className="bg-gray-50 p-4 rounded border border-gray-200 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Jurisdiction Code</label>
              <input
                type="text"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                placeholder="e.g., CA, NY, Cook"
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Level</label>
              <select
                value={jurisdictionLevel}
                onChange={(e) => setJurisdictionLevel(e.target.value as any)}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="FEDERAL">Federal</option>
                <option value="STATE">State</option>
                <option value="COUNTY">County</option>
                <option value="CITY">City</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Tax Rate (%)</label>
              <input
                type="number"
                step="0.01"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                placeholder="7.25"
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <button
              onClick={handleCreateJurisdiction}
              disabled={createJurisdictionMutation.isPending}
              className="w-full px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {createJurisdictionMutation.isPending ? 'Adding...' : 'Add Jurisdiction'}
            </button>
          </div>
        )}

        {jurisdictionsLoading && <SkeletonTable />}
        {jurisdictionsError && <PageError error={jurisdictionsError_} />}

        {jurisdictions && jurisdictions.length > 0 && (
          <div className="overflow-x-auto border border-gray-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Code</th>
                  <th className="px-4 py-2 text-left font-semibold">Level</th>
                  <th className="px-4 py-2 text-right font-semibold">Rate</th>
                  <th className="px-4 py-2 text-left font-semibold">Active</th>
                  <th className="px-4 py-2 text-left font-semibold">Effective</th>
                </tr>
              </thead>
              <tbody>
                {jurisdictions.map((j: TaxJurisdiction) => (
                  <tr key={j.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono font-semibold">{j.jurisdiction_code}</td>
                    <td className="px-4 py-2">{j.jurisdiction_level}</td>
                    <td className="px-4 py-2 text-right">{(j.tax_rate * 100).toFixed(2)}%</td>
                    <td className="px-4 py-2">{j.is_active ? '✓' : '—'}</td>
                    <td className="px-4 py-2">{new Date(j.effective_date).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {jurisdictions && jurisdictions.length === 0 && <p className="text-gray-600 text-sm">No tax jurisdictions configured</p>}
      </div>
    );
  }

  if (activeTab === 'accrue') {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Accrue Tax</h3>

        <div className="bg-gray-50 p-4 rounded border border-gray-200 space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Jurisdiction</label>
              <select
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="">Select...</option>
                {jurisdictions?.map((j: TaxJurisdiction) => (
                  <option key={j.id} value={j.jurisdiction_code}>{j.jurisdiction_code}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Taxable Amount ($)</label>
              <input
                type="number"
                step="0.01"
                value={taxableAmount}
                onChange={(e) => setTaxableAmount(e.target.value)}
                placeholder="1000.00"
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
          <button
            onClick={handleAccrueTax}
            disabled={accrueTaxMutation.isPending}
            className="w-full px-3 py-2 bg-brand text-white rounded text-sm hover:bg-brand disabled:opacity-50"
          >
            {accrueTaxMutation.isPending ? 'Accruing...' : 'Accrue Tax'}
          </button>
        </div>
      </div>
    );
  }

  // Report tab
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Tax Liability Report</h3>
        <div className="flex gap-2">
          <input
            type="month"
            value={`${selectedYear}-${String(selectedMonth).padStart(2, '0')}`}
            onChange={(e) => {
              const [year, month] = e.target.value.split('-');
              setSelectedYear(parseInt(year));
              setSelectedMonth(parseInt(month));
            }}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          />
        </div>
      </div>

      {reportLoading && <SkeletonTable />}
      {reportError && <PageError error={reportError_} />}

      {liabilityReport && (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Jurisdiction</th>
                <th className="px-4 py-2 text-right font-semibold">Rate</th>
                <th className="px-4 py-2 text-right font-semibold">Month Accrual</th>
                <th className="px-4 py-2 text-right font-semibold">Prior Unpaid</th>
                <th className="px-4 py-2 text-right font-semibold">Total Due</th>
              </tr>
            </thead>
            <tbody>
              {liabilityReport.map((item: TaxLiability) => (
                <tr key={item.jurisdiction_code} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono font-semibold">{item.jurisdiction_code}</td>
                  <td className="px-4 py-2 text-right">{(item.tax_rate * 100).toFixed(2)}%</td>
                  <td className="px-4 py-2 text-right font-mono">${formatCurrency(item.month_accrual)}</td>
                  <td className="px-4 py-2 text-right font-mono">${formatCurrency(item.prior_unpaid)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">${formatCurrency(item.total_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
