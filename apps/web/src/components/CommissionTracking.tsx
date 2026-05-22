import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '../api/client';
import PageError from './PageError';
import { SkeletonTable } from './Skeleton';

function formatCurrency(val: number | string) {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface CommissionPlan {
  id: string;
  planType: 'FLAT' | 'PERCENTAGE' | 'TIERED';
  effectiveDate: string;
  description?: string;
  baseRate?: number;
  tiers?: Array<{ threshold: number; rate: number }>;
}

interface Commission {
  id: string;
  employeeId: string;
  employeeName?: string;
  grossProfit: number;
  commissionAmount: number;
  status: 'ACCRUED' | 'PAID' | 'ADJUSTED' | 'CHARGED_BACK';
  period: string;
  createdAt: string;
}

interface CommissionReport {
  byEmployee: Array<{
    employeeId: string;
    employeeName?: string;
    dealCount: number;
    totalCommission: number;
  }>;
  byDepartment: Array<{
    department: string;
    totalCommission: number;
    employeeCount: number;
  }>;
}

export default function CommissionTracking() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'plans' | 'track' | 'report'>('track');
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planType, setPlanType] = useState<'FLAT' | 'PERCENTAGE' | 'TIERED'>('FLAT');
  const [planDescription, setPlanDescription] = useState('');
  const [planRate, setPlanRate] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { data: plans, isLoading: plansLoading, error: plansError } = useQuery({
    queryKey: ['commission-plans'],
    queryFn: payrollApi.listCommissionPlans,
    retry: false,
  });

  const { data: commissions, isLoading: commissionsLoading, error: commissionsError } = useQuery({
    queryKey: ['commissions'],
    queryFn: () => payrollApi.listCommissions(),
    retry: false,
  });

  const { data: report, isLoading: reportLoading, error: reportError } = useQuery({
    queryKey: ['commission-report'],
    queryFn: () => payrollApi.getCommissionReport(),
    retry: false,
  });

  const createPlanMutation = useMutation({
    mutationFn: (data: any) => payrollApi.createCommissionPlan(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-plans'] });
      showToast('Commission plan created', 'success');
      setShowPlanForm(false);
      setPlanType('FLAT');
      setPlanDescription('');
      setPlanRate('');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to create plan', 'error');
    },
  });

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function handleCreatePlan() {
    if (!planDescription || !planRate) {
      showToast('Please fill in all fields', 'error');
      return;
    }
    createPlanMutation.mutate({
      planType,
      description: planDescription,
      effectiveDate: new Date().toISOString().split('T')[0],
      baseRate: parseFloat(planRate),
    });
  }

  const plansError_ = plansError as any;
  const commissionsError_ = commissionsError as any;
  const reportError_ = reportError as any;

  if (activeTab === 'plans') {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Commission Plans</h3>
          <button
            onClick={() => setShowPlanForm(!showPlanForm)}
            className="px-3 py-1 bg-brand text-white rounded text-sm hover:bg-brand"
          >
            {showPlanForm ? 'Cancel' : 'New Plan'}
          </button>
        </div>

        {showPlanForm && (
          <div className="bg-gray-50 p-4 rounded border border-gray-200 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Plan Type</label>
              <select
                value={planType}
                onChange={(e) => setPlanType(e.target.value as any)}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="FLAT">Flat Amount</option>
                <option value="PERCENTAGE">Percentage of Revenue</option>
                <option value="TIERED">Tiered Rates</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Description</label>
              <input
                type="text"
                value={planDescription}
                onChange={(e) => setPlanDescription(e.target.value)}
                placeholder="e.g., Sales Commission 5%"
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Base Rate / Amount</label>
              <input
                type="number"
                step="0.01"
                value={planRate}
                onChange={(e) => setPlanRate(e.target.value)}
                placeholder={planType === 'PERCENTAGE' ? '0.05' : '100.00'}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
              />
            </div>
            <button
              onClick={handleCreatePlan}
              disabled={createPlanMutation.isPending}
              className="w-full px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {createPlanMutation.isPending ? 'Creating...' : 'Create Plan'}
            </button>
          </div>
        )}

        {plansLoading && <SkeletonTable />}
        {plansError && <PageError error={plansError_} />}

        {plans && plans.length > 0 && (
          <div className="overflow-x-auto border border-gray-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Type</th>
                  <th className="px-4 py-2 text-left font-semibold">Description</th>
                  <th className="px-4 py-2 text-left font-semibold">Effective Date</th>
                  <th className="px-4 py-2 text-right font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan: CommissionPlan) => (
                  <tr key={plan.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2">{plan.planType}</td>
                    <td className="px-4 py-2 text-gray-700">{plan.description || '—'}</td>
                    <td className="px-4 py-2">{new Date(plan.effectiveDate).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-right font-mono">{plan.tiers?.length ? 'Tiered' : formatCurrency(plan.baseRate ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {plans && plans.length === 0 && <p className="text-gray-600 text-sm">No commission plans configured yet</p>}
      </div>
    );
  }

  if (activeTab === 'report') {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Commission Report</h3>

        {reportLoading && <SkeletonTable />}
        {reportError && <PageError error={reportError_} />}

        {report && (
          <>
            <div>
              <h4 className="font-semibold text-sm mb-2">By Employee</h4>
              <div className="overflow-x-auto border border-gray-200 rounded">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Employee</th>
                      <th className="px-4 py-2 text-right font-semibold">Deals</th>
                      <th className="px-4 py-2 text-right font-semibold">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byEmployee?.map((emp: any) => (
                      <tr key={emp.employeeId} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2">{emp.employeeName || emp.employeeId}</td>
                        <td className="px-4 py-2 text-right">{emp.dealCount}</td>
                        <td className="px-4 py-2 text-right font-mono font-semibold">${formatCurrency(emp.totalCommission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">By Department</h4>
              <div className="overflow-x-auto border border-gray-200 rounded">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 border-b">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Department</th>
                      <th className="px-4 py-2 text-right font-semibold">Employees</th>
                      <th className="px-4 py-2 text-right font-semibold">Total Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byDepartment?.map((dept: any) => (
                      <tr key={dept.department} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2">{dept.department}</td>
                        <td className="px-4 py-2 text-right">{dept.employeeCount}</td>
                        <td className="px-4 py-2 text-right font-mono font-semibold">${formatCurrency(dept.totalCommission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Track tab
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Commission Tracking</h3>

      {commissionsLoading && <SkeletonTable />}
      {commissionsError && <PageError error={commissionsError_} />}

      {commissions && commissions.length > 0 && (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Employee</th>
                <th className="px-4 py-2 text-right font-semibold">Gross Profit</th>
                <th className="px-4 py-2 text-right font-semibold">Commission</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
                <th className="px-4 py-2 text-left font-semibold">Period</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((comm: Commission) => (
                <tr key={comm.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2">{comm.employeeName || comm.employeeId}</td>
                  <td className="px-4 py-2 text-right font-mono">${formatCurrency(comm.grossProfit)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">${formatCurrency(comm.commissionAmount)}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                      comm.status === 'PAID' ? 'bg-green-100 text-green-700' :
                      comm.status === 'ACCRUED' ? 'bg-blue-100 text-brand' :
                      comm.status === 'ADJUSTED' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {comm.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">{comm.period}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {commissions && commissions.length === 0 && <p className="text-gray-600 text-sm">No commissions tracked yet</p>}

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
