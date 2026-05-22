import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { glApi } from '../api/client';
import PageError from './PageError';
import { SkeletonTable } from './Skeleton';

function formatCurrency(val: number | string) {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface FloorPlanUnit {
  id: string;
  vin: string;
  lenderId: string;
  advanceAmount: number;
  currentBalance: number;
  accruedInterest: number;
  interestRate: number;
  floorDate: string;
  daysOnFloor: number;
  status: 'ACTIVE' | 'PAID_OFF' | 'CURTAILED' | 'DAMAGED';
}

interface AgingReportEntry {
  vin: string;
  vehicleMakeModel: string;
  advanceAmount: number;
  accruedInterest: number;
  daysOnFloor: number;
  status: string;
}

export default function FloorPlanFinancing() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'register' | 'track' | 'aging'>('track');
  const [selectedLender, setSelectedLender] = useState('');
  const [vin, setVin] = useState('');
  const [lenderId, setLenderId] = useState('');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { data: units, isLoading: unitsLoading, error: unitsError } = useQuery({
    queryKey: ['floor-plan-units', selectedLender],
    queryFn: () => glApi.listFloorPlanUnits(selectedLender ? `?lenderId=${selectedLender}` : ''),
    retry: false,
  });

  const { data: agingReport, isLoading: agingLoading, error: agingError } = useQuery({
    queryKey: ['floor-plan-aging', selectedLender],
    queryFn: () => glApi.getFloorPlanAgingReport(selectedLender ? `?lenderId=${selectedLender}` : ''),
    retry: false,
  });

  const registerMutation = useMutation({
    mutationFn: (data: any) => glApi.registerFloorPlanUnit(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['floor-plan-units'] });
      queryClient.invalidateQueries({ queryKey: ['floor-plan-aging'] });
      showToast('Unit registered', 'success');
      setVin('');
      setLenderId('');
      setAdvanceAmount('');
      setInterestRate('');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to register unit', 'error');
    },
  });

  const accrueMutation = useMutation({
    mutationFn: () => glApi.accrueFloorPlanInterest({ asOfDate: new Date().toISOString().split('T')[0] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['floor-plan-units'] });
      showToast('Interest accrued', 'success');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to accrue interest', 'error');
    },
  });

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleRegister() {
    if (!vin || !lenderId || !advanceAmount || !interestRate) {
      showToast('Please fill in all fields', 'error');
      return;
    }
    registerMutation.mutate({
      vin,
      lenderId,
      advanceAmount: parseFloat(advanceAmount),
      interestRate: parseFloat(interestRate) / 100,
      floorDate: new Date().toISOString().split('T')[0],
      glLiabilityAccountId: 'acct-floor-plan-liability',
      glInterestAccountId: 'acct-floor-plan-interest',
    });
  }

  const unitsError_ = unitsError as any;
  const agingError_ = agingError as any;

  if (activeTab === 'register') {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Register Floor Plan Unit</h3>

        <div className="bg-gray-50 p-4 rounded border border-gray-200 space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">VIN</label>
              <input
                type="text"
                value={vin}
                onChange={(e) => setVin(e.target.value)}
                placeholder="1HGCV1F32LA000000"
                maxLength={17}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Lender ID</label>
              <input
                type="text"
                value={lenderId}
                onChange={(e) => setLenderId(e.target.value)}
                placeholder="lender-ford-credit"
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Advance Amount ($)</label>
              <input
                type="number"
                step="0.01"
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                placeholder="25000.00"
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Interest Rate (% annual)</label>
              <input
                type="number"
                step="0.01"
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                placeholder="5.25"
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
          <button
            onClick={handleRegister}
            disabled={registerMutation.isPending}
            className="w-full px-3 py-2 bg-brand text-white rounded text-sm hover:bg-brand disabled:opacity-50"
          >
            {registerMutation.isPending ? 'Registering...' : 'Register Unit'}
          </button>
        </div>
      </div>
    );
  }

  if (activeTab === 'aging') {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Floor Plan Aging Report</h3>
          <select
            value={selectedLender}
            onChange={(e) => setSelectedLender(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="">All Lenders</option>
            {units?.reduce((lenders: Set<string>, unit: FloorPlanUnit) => {
              lenders.add(unit.lenderId);
              return lenders;
            }, new Set()).map((lender: string) => (
              <option key={lender} value={lender}>{lender}</option>
            ))}
          </select>
        </div>

        {agingLoading && <SkeletonTable />}
        {agingError && <PageError error={agingError_} />}

        {agingReport && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-brand-light p-3 rounded border border-brand-border">
                <div className="text-xs text-brand font-semibold">Total Advance</div>
                <div className="text-lg font-bold text-blue-900">${formatCurrency(agingReport.grandTotalAdvance)}</div>
              </div>
              <div className="bg-green-50 p-3 rounded border border-green-200">
                <div className="text-xs text-green-600 font-semibold">Accrued Interest</div>
                <div className="text-lg font-bold text-green-900">${formatCurrency(agingReport.grandTotalInterest)}</div>
              </div>
              <div className="bg-orange-50 p-3 rounded border border-orange-200">
                <div className="text-xs text-orange-600 font-semibold">Total Outstanding</div>
                <div className="text-lg font-bold text-orange-900">${formatCurrency(agingReport.grandTotalAdvance + agingReport.grandTotalInterest)}</div>
              </div>
            </div>

            {agingReport.byLender?.map((lenderGroup: any) => (
              <div key={lenderGroup.lenderId} className="border border-gray-200 rounded overflow-hidden">
                <div className="bg-gray-100 px-4 py-2 border-b">
                  <h4 className="font-semibold text-sm">{lenderGroup.lender_name} — {lenderGroup.units.length} units</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold">VIN</th>
                        <th className="px-4 py-2 text-right font-semibold">Advance</th>
                        <th className="px-4 py-2 text-right font-semibold">Interest</th>
                        <th className="px-4 py-2 text-right font-semibold">Days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lenderGroup.units.map((unit: AgingReportEntry) => (
                        <tr key={unit.vin} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-xs">{unit.vin}</td>
                          <td className="px-4 py-2 text-right font-mono">${formatCurrency(unit.advanceAmount)}</td>
                          <td className="px-4 py-2 text-right font-mono">${formatCurrency(unit.accruedInterest)}</td>
                          <td className="px-4 py-2 text-right">{unit.daysOnFloor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="bg-gray-50 px-4 py-2 flex justify-between text-sm font-semibold border-t">
                  <span>Subtotal</span>
                  <span>${formatCurrency(lenderGroup.subtotal_advance + lenderGroup.subtotal_interest)}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  // Track tab
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Floor Plan Tracking</h3>
        <button
          onClick={() => accrueMutation.mutate()}
          disabled={accrueMutation.isPending}
          className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
        >
          {accrueMutation.isPending ? 'Accruing...' : 'Accrue Interest'}
        </button>
      </div>

      {unitsLoading && <SkeletonTable />}
      {unitsError && <PageError error={unitsError_} />}

      {units && units.units?.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-brand-light p-3 rounded border border-brand-border">
              <div className="text-xs text-brand font-semibold">Total Balance</div>
              <div className="text-lg font-bold text-blue-900">${formatCurrency(units.totalBalance)}</div>
            </div>
            <div className="bg-gray-50 p-3 rounded border border-gray-200">
              <div className="text-xs text-gray-600 font-semibold">Units</div>
              <div className="text-lg font-bold text-gray-900">{units.units.length}</div>
            </div>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Vehicle</th>
                  <th className="px-4 py-2 text-left font-semibold">VIN</th>
                  <th className="px-4 py-2 text-left font-semibold">Lender</th>
                  <th className="px-4 py-2 text-right font-semibold">Advance</th>
                  <th className="px-4 py-2 text-right font-semibold">Balance</th>
                  <th className="px-4 py-2 text-right font-semibold">Interest</th>
                  <th className="px-4 py-2 text-right font-semibold">Days</th>
                  <th className="px-4 py-2 text-left font-semibold">Condition</th>
                  <th className="px-4 py-2 text-left font-semibold">Status</th>
                  <th className="px-4 py-2 text-right font-semibold">Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {units.units.map((unit: any) => (
                  <UnitRow key={unit.id} unit={unit} formatCurrency={formatCurrency} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {units && units.units?.length === 0 && <p className="text-gray-600 text-sm">No floor plan units</p>}

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

// S5-06/07/08: Unit row with expandable cost breakdown
function UnitRow({ unit, formatCurrency }: { unit: any; formatCurrency: (n: number) => string }) {
  const [expanded, setExpanded] = useState(false);
  const vehicleLabel = [unit.vehicleYear, unit.vehicleMake, unit.vehicleModel, unit.vehicleTrim]
    .filter(Boolean).join(' ') || '—';
  const conditionColors: Record<string, string> = {
    NEW: 'bg-green-100 text-green-700',
    USED: 'bg-gray-100 text-gray-700',
    DEMO: 'bg-yellow-100 text-yellow-700',
    CPO: 'bg-blue-100 text-brand',
  };
  const statusColors: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700',
    PAID_OFF: 'bg-gray-100 text-gray-700',
    IN_TRANSIT: 'bg-blue-100 text-brand',
    HOLD: 'bg-yellow-100 text-yellow-700',
  };

  const costComponents = [
    { label: 'Invoice Cost', value: unit.invoiceCost },
    { label: 'Pack', value: unit.packAmount },
    { label: 'Holdback', value: unit.holdbackAmount },
    { label: 'Factory Rebate', value: unit.factoryRebate ? -unit.factoryRebate : null, neg: true },
    { label: 'Freight', value: unit.freightAmount },
    { label: 'Prep Charges', value: unit.prepCharges },
    { label: 'Recon Costs', value: unit.reconCosts },
  ].filter(c => c.value != null);

  return (
    <>
      <tr
        className="border-b hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-2 text-sm font-medium">{vehicleLabel}</td>
        <td className="px-4 py-2 font-mono text-xs">{unit.vin}</td>
        <td className="px-4 py-2 text-sm">{unit.lenderId}</td>
        <td className="px-4 py-2 text-right font-mono">${formatCurrency(unit.advanceAmount)}</td>
        <td className="px-4 py-2 text-right font-mono font-semibold">${formatCurrency(unit.currentBalance)}</td>
        <td className="px-4 py-2 text-right font-mono">${formatCurrency(unit.accruedInterest ?? unit.accruedFloorPlanInterest ?? 0)}</td>
        <td className="px-4 py-2 text-right">{unit.daysOnFloor}</td>
        <td className="px-4 py-2">
          {unit.vehicleCondition && (
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${conditionColors[unit.vehicleCondition] ?? 'bg-gray-100 text-gray-600'}`}>
              {unit.vehicleCondition}
            </span>
          )}
        </td>
        <td className="px-4 py-2">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${statusColors[unit.vehicleStatus ?? unit.status] ?? 'bg-gray-100 text-gray-700'}`}>
            {unit.vehicleStatus ?? unit.status}
          </span>
        </td>
        <td className="px-4 py-2 text-right font-mono">
          {unit.totalCost ? `$${formatCurrency(unit.totalCost)}` : '—'}
        </td>
      </tr>
      {expanded && costComponents.length > 0 && (
        <tr className="bg-brand-light/40">
          <td colSpan={10} className="px-8 py-3">
            <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Cost Breakdown</p>
            <div className="grid grid-cols-4 gap-x-6 gap-y-1">
              {costComponents.map(c => (
                <div key={c.label} className="flex justify-between text-xs">
                  <span className="text-gray-500">{c.label}</span>
                  <span className={`font-mono ${c.neg ? 'text-green-700' : ''}`}>${formatCurrency(Math.abs(c.value!))}</span>
                </div>
              ))}
              {unit.totalCost && (
                <div className="flex justify-between text-xs font-bold border-t pt-1 col-span-2 mt-1">
                  <span>Total Cost</span>
                  <span className="font-mono">${formatCurrency(unit.totalCost)}</span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
