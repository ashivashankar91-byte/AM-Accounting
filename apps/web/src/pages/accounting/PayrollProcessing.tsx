import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight, ChevronLeft, CheckCircle, AlertCircle, Clock, Download,
  AlertTriangle, Lock, Upload, Users, FileText, DollarSign, Printer,
} from 'lucide-react';
import { payrollApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import StatusBadge from '../../components/StatusBadge';
import DataTable, { Column } from '../../components/DataTable';
import CommissionTracking from '../../components/CommissionTracking';
import { Btn, PageHeader, Badge } from '../../components/ui';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PayrollRun {
  id: string;
  checkDate: string;           // PAY-002: immutable after creation
  payPeriodStart: string;
  payPeriodEnd: string;
  payFrequency: 'WEEKLY' | 'BIWEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY';
  status: 'IN_PROGRESS' | 'VALIDATED' | 'NACHA_GENERATED' | 'FINALIZED' | 'VOIDED';
  nacha_generated: boolean;    // PAY-004: finalize gated on this
  locked_by?: string;          // PAY-005: concurrent lock
  locked_at?: string;
  created_by: string;
  created_at: string;
  finalized_at?: string;
}

interface ValidationIssue {
  severity: 'WARNING' | 'ERROR';
  employeeId?: string;
  field?: string;
  message: string;
}

interface WageBases {
  id: string;
  wage_base_type: 'US_FEDERAL' | 'EEFICA' | 'EE_MEDICARE' | 'STATE' | 'FUTA' | 'SUTA';
  total_wages: number;         // NUMERIC(15,2) from backend
  withholding_amt: number;     // NUMERIC(15,2) from backend
  gl_account_id?: string;
}

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

const STEP_LABELS: { label: string; description: string }[] = [
  { label: 'Start Payroll', description: 'Set period & check date' },
  { label: 'Add Checks', description: 'Select employees & frequencies' },
  { label: 'Import Time', description: 'Hours & time data' },
  { label: 'Check Data', description: 'Per-employee earnings' },
  { label: 'Validate', description: 'Warnings & errors' },
  { label: 'Review Summary', description: 'Dept totals & variance' },
  { label: 'Generate NACHA', description: 'ACH file generation' },
  { label: 'Finalization', description: 'Wage bases summary' },
  { label: 'Print / Export', description: 'Checks, stubs, reports' },
];

const WAGE_BASE_LABELS: Record<string, string> = {
  US_FEDERAL: 'US Federal',
  EEFICA: 'EE FICA (Social Security)',
  EE_MEDICARE: 'EE Medicare',
  STATE: 'State',
  FUTA: 'FUTA (Federal Unemployment)',
  SUTA: 'SUTA (State Unemployment)',
};

const fmt = (n: number | string) =>
  Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

// ─── Component ───────────────────────────────────────────────────────────────

export default function PayrollProcessing() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'wizard' | 'commissions'>('wizard');
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Step 1: Period setup form
  const [payFrequency, setPayFrequency] = useState<PayrollRun['payFrequency']>('BIWEEKLY');
  const [payPeriodStart, setPayPeriodStart] = useState('');
  const [payPeriodEnd, setPayPeriodEnd] = useState('');
  const [checkDate, setCheckDate] = useState('');    // PAY-002: locked after startRun

  // Step 5: Validation acknowledgement
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [validationResult, setValidationResult] = useState<{ issues: ValidationIssue[] } | null>(null);

  // Step 7: NACHA
  const [nachaGenerating, setNachaGenerating] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────

  // PAY-005: Load in-process run — shows lock warning if held by another user
  const { data: inProcessRun, isLoading: runLoading, refetch: refetchRun } = useQuery<PayrollRun | null>({
    queryKey: ['payroll-in-process'],
    queryFn: async () => {
      try {
        return await payrollApi.loadInProcess() as PayrollRun;
      } catch (e: any) {
        if (e.message?.includes('404') || e.message?.includes('No in-process')) return null;
        throw e;
      }
    },
    retry: false,
  });

  // Step 8: Wage Bases
  const { data: wageBases } = useQuery<WageBases[]>({
    queryKey: ['payroll-wage-bases', inProcessRun?.id],
    queryFn: () => payrollApi.getWageBases(inProcessRun!.id),
    enabled: !!inProcessRun?.id && currentStep === 8,
    retry: false,
  });

  // Step 6: Summary
  const { data: runSummary } = useQuery<any>({
    queryKey: ['payroll-summary', inProcessRun?.id],
    queryFn: () => payrollApi.getSummary(inProcessRun!.id),
    enabled: !!inProcessRun?.id && currentStep === 6,
    retry: false,
  });

  // ── Sync step to existing run status ─────────────────────────────────────
  useEffect(() => {
    if (!inProcessRun) return;
    if (inProcessRun.status === 'FINALIZED') setCurrentStep(9);
    else if (inProcessRun.status === 'NACHA_GENERATED') setCurrentStep(8);
    else if (inProcessRun.status === 'VALIDATED') setCurrentStep(6);
  }, [inProcessRun]);

  // ── Toast ─────────────────────────────────────────────────────────────────
  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  // PAY-001: Single-run enforcement — backend returns 409 if IN_PROGRESS already exists
  // PAY-002: check_date is immutable — after this call, checkDate field is disabled
  const startRunMutation = useMutation({
    mutationFn: () => {
      if (!payPeriodStart || !payPeriodEnd || !checkDate) throw new Error('All date fields are required');
      if (new Date(payPeriodStart) >= new Date(payPeriodEnd)) throw new Error('Period start must be before period end');
      return payrollApi.startRun({ checkDate, payPeriodStart, payPeriodEnd, payFrequency });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-in-process'] });
      setCurrentStep(2);
      showToast('Payroll run started', 'success');
    },
    onError: (e: any) => {
      showToast(
        e.message?.includes('409') || e.message?.includes('already')
          ? 'A payroll run is already in progress for this company. Load it or finalize it before starting a new one.'
          : (e.message ?? 'Failed to start payroll run'),
        'error',
      );
    },
  });

  const validateMutation = useMutation({
    mutationFn: () => payrollApi.validateRun(inProcessRun!.id),
    onSuccess: (result: any) => {
      setValidationResult(result);
      queryClient.invalidateQueries({ queryKey: ['payroll-in-process'] });
      const errors = result.issues?.filter((i: ValidationIssue) => i.severity === 'ERROR') ?? [];
      if (errors.length === 0) {
        showToast('Validation passed', 'success');
      } else {
        showToast(`${errors.length} error(s) must be fixed before proceeding`, 'error');
      }
    },
    onError: (e: any) => showToast(e.message ?? 'Validation failed', 'error'),
  });

  // PAY-004: Finalize only possible when nacha_generated=true
  const finalizeMutation = useMutation({
    mutationFn: () => {
      if (!inProcessRun?.nacha_generated) throw new Error('NACHA file must be generated before finalizing (PAY-004)');
      return payrollApi.finalizeRun(inProcessRun!.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-in-process'] });
      setCurrentStep(9);
      showToast('Payroll finalized successfully', 'success');
    },
    onError: (e: any) => showToast(e.message ?? 'Finalization failed', 'error'),
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (runLoading) return <PageLoader page="Payroll Processing" />;

  const currentRun = inProcessRun;
  const isLocked = !!currentRun?.locked_by;
  const hasValidationErrors = validationResult?.issues?.some(i => i.severity === 'ERROR') ?? false;
  const hasValidationWarnings = validationResult?.issues?.some(i => i.severity === 'WARNING') ?? false;
  const canProceedFromValidation = !hasValidationErrors && (hasValidationWarnings ? warningsAcknowledged : true);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <PageHeader
        title="Payroll Processing"
        subtitle={currentRun ? undefined : 'WF-A005 — 9-step payroll workflow'}
        actions={
          <>
            {currentRun && <StatusBadge status={currentRun.status} />}
            {!currentRun && currentStep > 1 && (
              <Btn
                variant="ghost"
                size="sm"
                onClick={() => { setCurrentStep(1); queryClient.invalidateQueries({ queryKey: ['payroll-in-process'] }); }}
              >
                Start Over
              </Btn>
            )}
          </>
        }
      />

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg text-white z-50 shadow-lg ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 mb-8 border-b border-gray-200">
        {(['wizard', 'commissions'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab ? 'border-blue-600 text-brand' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab === 'wizard' ? 'Payroll Wizard' : 'Commission Tracking'}
          </button>
        ))}
      </div>

      {activeTab === 'commissions' && <CommissionTracking />}

      {activeTab === 'wizard' && (
        <>
          {/* PAY-005: Lock Warning */}
          {isLocked && (
            <div className="mb-6 bg-amber-50 border border-amber-300 rounded-lg p-4 flex gap-3">
              <Lock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-900">Payroll Locked</p>
                <p className="text-sm text-amber-800">
                  This payroll run is currently locked by <strong>{currentRun?.locked_by}</strong>
                  {currentRun?.locked_at ? ` since ${new Date(currentRun.locked_at).toLocaleString()}` : ''}.
                  View-only mode — changes are not permitted while locked.
                </p>
              </div>
            </div>
          )}

          {/* Step Progress */}
          <div className="mb-8 overflow-x-auto">
            <div className="flex items-center gap-1 min-w-max pb-2">
              {STEP_LABELS.map((step, idx) => {
                const stepNum = (idx + 1) as WizardStep;
                const isDone = stepNum < currentStep;
                const isCurrent = stepNum === currentStep;
                return (
                  <div key={idx} className="flex items-center gap-1">
                    <div className={`flex flex-col items-center min-w-[80px] ${isCurrent ? 'opacity-100' : 'opacity-60'}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm mb-1 ${
                        isDone ? 'bg-green-600 text-white' : isCurrent ? 'bg-brand text-white' : 'bg-gray-200 text-gray-600'
                      }`}>
                        {isDone ? '✓' : stepNum}
                      </div>
                      <p className="text-xs font-semibold text-gray-900 text-center leading-tight">{step.label}</p>
                      <p className="text-xs text-gray-500 text-center leading-tight hidden sm:block">{step.description}</p>
                    </div>
                    {idx < STEP_LABELS.length - 1 && (
                      <div className={`h-0.5 w-4 mx-1 ${isDone ? 'bg-green-400' : 'bg-gray-200'}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── STEP 1: Start New Payroll ────────────────────────────────── */}
          {currentStep === 1 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Start New Payroll</h2>
              <p className="text-sm text-gray-600 mb-6">
                Only one payroll run can be active at a time (PAY-001). The check date cannot be changed after this step (PAY-002).
              </p>

              {currentRun && (
                <div className="mb-6 bg-brand-light border border-brand-border rounded-lg p-4">
                  <p className="font-semibold text-blue-900">Existing run found</p>
                  <p className="text-sm text-blue-800 mt-1">
                    Run {currentRun.id} · {currentRun.status} · Check Date: {currentRun.checkDate}
                  </p>
                  <Btn
                    onClick={() => setCurrentStep(2)}
                    className="mt-2"
                  >
                    Resume In-Process Run
                  </Btn>
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Pay Frequency</label>
                  <select
                    value={payFrequency}
                    onChange={e => setPayFrequency(e.target.value as PayrollRun['payFrequency'])}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand"
                  >
                    <option value="WEEKLY">Weekly</option>
                    <option value="BIWEEKLY">Bi-weekly</option>
                    <option value="SEMI_MONTHLY">Semi-monthly</option>
                    <option value="MONTHLY">Monthly</option>
                  </select>
                </div>
                <div />
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Period Start</label>
                  <input
                    type="date"
                    value={payPeriodStart}
                    onChange={e => setPayPeriodStart(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Period End</label>
                  <input
                    type="date"
                    value={payPeriodEnd}
                    onChange={e => setPayPeriodEnd(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Check Date <span className="text-red-600">*</span>
                    <span className="ml-1 text-xs font-normal text-gray-500">(immutable after start)</span>
                  </label>
                  <input
                    type="date"
                    value={checkDate}
                    onChange={e => setCheckDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>

              <Btn
                onClick={() => startRunMutation.mutate()}
                disabled={!payPeriodStart || !payPeriodEnd || !checkDate}
                loading={startRunMutation.isPending}
                size="lg"
                className="mt-6"
              >
                Start New Payroll Run
              </Btn>
            </div>
          )}

          {/* ── STEP 2: Add Checks Wizard ────────────────────────────────── */}
          {currentStep === 2 && currentRun && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-brand" />
                <h2 className="text-xl font-bold text-gray-900">Add Checks</h2>
              </div>
              <p className="text-sm text-gray-600 mb-6">
                Select employee types and pay frequencies for this run.
                <br />
                Run ID: <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">{currentRun.id}</span>
                &ensp;·&ensp; Check Date: <strong>{currentRun.checkDate}</strong>
              </p>

              <div className="grid grid-cols-2 gap-6">
                {[
                  { label: 'Salaried — Full-time', freq: 'BIWEEKLY', count: 0 },
                  { label: 'Hourly — Full-time', freq: 'WEEKLY', count: 0 },
                  { label: 'Commission Employees', freq: 'SEMI_MONTHLY', count: 0 },
                  { label: 'Part-time / Seasonal', freq: 'WEEKLY', count: 0 },
                ].map((group, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg p-4">
                    <p className="font-semibold text-gray-900 mb-1">{group.label}</p>
                    <p className="text-xs text-gray-500 mb-3">{group.freq}</p>
                    <div className="flex items-center gap-2">
                      <input type="number" defaultValue={0} min={0}
                        className="w-20 border border-gray-300 rounded px-2 py-1.5 text-sm"
                      />
                      <span className="text-sm text-gray-600">employees selected</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-4">
                Use the per-employee selection screen in Step 4 to review individual check data.
              </p>
            </div>
          )}

          {/* ── STEP 3: Import Time ──────────────────────────────────────── */}
          {currentStep === 3 && currentRun && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-5 h-5 text-brand" />
                <h2 className="text-xl font-bold text-gray-900">Import Time</h2>
              </div>
              <p className="text-sm text-gray-600 mb-6">Select a time import method for this pay period.</p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: Clock, label: 'Time Clock Integration', description: 'Pull hours from integrated time clock system' },
                  { icon: Upload, label: 'CSV Upload', description: 'Upload a CSV file with hours by employee' },
                  { icon: FileText, label: 'Manual Entry', description: 'Enter hours manually per employee' },
                  { icon: Users, label: 'External System', description: 'Pull from payroll provider API' },
                ].map(({ icon: Icon, label, description }, i) => (
                  <button
                    key={i}
                    className="border-2 border-gray-200 hover:border-blue-400 rounded-lg p-4 text-left transition-colors"
                    onClick={() => showToast(`${label} — connect to payroll-service import endpoint`, 'success')}
                  >
                    <Icon className="w-5 h-5 text-brand mb-2" />
                    <p className="font-semibold text-gray-900 text-sm">{label}</p>
                    <p className="text-xs text-gray-500 mt-1">{description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP 4: Employee Check Data ──────────────────────────────── */}
          {currentStep === 4 && currentRun && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Employee Check Data</h2>
              <p className="text-sm text-gray-600 mb-4">
                Review and adjust individual earnings and deductions. All amounts use NUMERIC precision.
              </p>
              <div className="border rounded overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase border-b">
                      <th className="px-4 py-2 text-left">Employee</th>
                      <th className="px-4 py-2 text-right">Reg Hours</th>
                      <th className="px-4 py-2 text-right">OT Hours</th>
                      <th className="px-4 py-2 text-right">Gross Pay</th>
                      <th className="px-4 py-2 text-right">Deductions</th>
                      <th className="px-4 py-2 text-right">Net Pay (Est.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 text-sm" colSpan={6}>
                        Employee check data loads from payroll-service once Step 2 employees are added.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── STEP 5: Validate ─────────────────────────────────────────── */}
          {currentStep === 5 && currentRun && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Validate Payroll</h2>

              <Btn
                onClick={() => validateMutation.mutate()}
                loading={validateMutation.isPending}
                icon={<CheckCircle className="w-4 h-4" />}
                size="lg"
                className="mb-6"
              >
                {validateMutation.isPending ? 'Validating...' : 'Run Validation'}
              </Btn>

              {validationResult && (
                <div className="space-y-3">
                  {validationResult.issues.length === 0 && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex gap-2">
                      <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                      <p className="text-green-800 font-semibold">All validation checks passed</p>
                    </div>
                  )}
                  {validationResult.issues.map((issue, i) => (
                    <div key={i} className={`rounded-lg border p-3 flex gap-3 ${
                      issue.severity === 'ERROR' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                    }`}>
                      {issue.severity === 'ERROR'
                        ? <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                        : <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      }
                      <div>
                        <span className={`text-xs font-bold uppercase ${issue.severity === 'ERROR' ? 'text-red-700' : 'text-amber-700'}`}>
                          {issue.severity}
                        </span>
                        {issue.employeeId && <span className="text-xs text-gray-500 ml-2">EMP {issue.employeeId}</span>}
                        <p className="text-sm mt-0.5">{issue.message}</p>
                      </div>
                    </div>
                  ))}
                  {/* PAY-003: Warnings = acknowledge + proceed; Errors = block */}
                  {hasValidationWarnings && !hasValidationErrors && (
                    <label className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={warningsAcknowledged}
                        onChange={e => setWarningsAcknowledged(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-sm font-medium text-amber-900">
                        I acknowledge the warnings above and confirm the payroll data is correct
                      </span>
                    </label>
                  )}
                  {hasValidationErrors && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                      <strong>{validationResult.issues.filter(i => i.severity === 'ERROR').length} error(s) must be resolved</strong> before proceeding. Return to Step 4 to correct employee data.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 6: Review Summary ───────────────────────────────────── */}
          {currentStep === 6 && currentRun && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Review Summary</h2>
              {runSummary ? (
                <div className="space-y-6">
                  {/* Department totals */}
                  <div>
                    <h3 className="font-semibold text-gray-700 mb-3">Department Totals</h3>
                    <div className="border rounded overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase border-b">
                            <th className="px-4 py-2 text-left">Department</th>
                            <th className="px-4 py-2 text-right">Gross Pay</th>
                            <th className="px-4 py-2 text-right">Taxes</th>
                            <th className="px-4 py-2 text-right">Net Pay</th>
                            <th className="px-4 py-2 text-right">Variance vs Prior</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(runSummary.departmentTotals ?? []).map((d: any, i: number) => (
                            <tr key={i} className="border-b hover:bg-gray-50">
                              <td className="px-4 py-2">{d.department}</td>
                              <td className="px-4 py-2 text-right font-mono">{fmt(d.grossPay)}</td>
                              <td className="px-4 py-2 text-right font-mono">{fmt(d.taxes)}</td>
                              <td className="px-4 py-2 text-right font-mono">{fmt(d.netPay)}</td>
                              <td className={`px-4 py-2 text-right font-mono text-xs ${(d.variancePct ?? 0) > 0.1 ? 'text-amber-700 font-semibold' : 'text-gray-600'}`}>
                                {d.variancePct != null ? `${(d.variancePct * 100).toFixed(1)}%` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">Loading summary...</p>
              )}
            </div>
          )}

          {/* ── STEP 7: Generate NACHA ───────────────────────────────────── */}
          {currentStep === 7 && currentRun && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Generate NACHA File</h2>
              <p className="text-sm text-gray-600 mb-6">
                The ACH/NACHA file must be generated before the payroll can be finalized (PAY-004).
              </p>

              {currentRun.nacha_generated ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex gap-3 mb-4">
                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-green-900">NACHA File Generated</p>
                    <p className="text-sm text-green-800">ACH file is ready for transmission. You may proceed to finalization.</p>
                  </div>
                </div>
              ) : (
                <Btn
                  onClick={async () => {
                    setNachaGenerating(true);
                    try {
                      await payrollApi.generateNacha(currentRun.id);
                      queryClient.invalidateQueries({ queryKey: ['payroll-in-process'] });
                      showToast('NACHA file generated successfully', 'success');
                    } catch (e: any) {
                      showToast(e.message ?? 'NACHA generation failed', 'error');
                    } finally {
                      setNachaGenerating(false);
                    }
                  }}
                  loading={nachaGenerating}
                  icon={<Download className="w-4 h-4" />}
                  size="lg"
                >
                  {nachaGenerating ? 'Generating...' : 'Generate NACHA / ACH File'}
                </Btn>
              )}
            </div>
          )}

          {/* ── STEP 8: Finalization Summary ─────────────────────────────── */}
          {currentStep === 8 && currentRun && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Payroll Finalization</h2>

              {/* PAY-004: Finalize button gated on nacha_generated */}
              {!currentRun.nacha_generated && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                  <p className="text-sm text-amber-800">
                    NACHA file must be generated before finalizing (PAY-004). Return to Step 7.
                  </p>
                </div>
              )}

              {/* Wage Bases Breakdown (PAY-008, PAY-010) */}
              <h3 className="font-semibold text-gray-700 mb-3">Wage Bases Breakdown</h3>
              {wageBases && wageBases.length > 0 ? (
                <div className="border rounded overflow-hidden mb-6">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs font-semibold text-gray-600 uppercase border-b">
                        <th className="px-4 py-2 text-left">Wage Base Type</th>
                        <th className="px-4 py-2 text-right">Total Wages</th>
                        <th className="px-4 py-2 text-right">Withholding</th>
                        <th className="px-4 py-2 text-left">GL Account</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wageBases.map((wb) => (
                        <tr key={wb.id} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium">{WAGE_BASE_LABELS[wb.wage_base_type] ?? wb.wage_base_type}</td>
                          <td className="px-4 py-2 text-right font-mono">{fmt(wb.total_wages)}</td>
                          <td className="px-4 py-2 text-right font-mono">{fmt(wb.withholding_amt)}</td>
                          <td className="px-4 py-2 font-mono text-xs text-gray-500">{wb.gl_account_id ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-6">Wage bases will appear once the run is finalized.</p>
              )}

              <button
                onClick={() => finalizeMutation.mutate()}
                disabled={!currentRun.nacha_generated || finalizeMutation.isPending}
                className="px-6 py-2.5 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 disabled:opacity-50 flex items-center gap-2"
                title={!currentRun.nacha_generated ? 'Generate NACHA first (PAY-004)' : undefined}
              >
                {finalizeMutation.isPending ? <Clock className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {finalizeMutation.isPending ? 'Finalizing...' : 'Finalize Payroll'}
              </button>
            </div>
          )}

          {/* ── STEP 9: Print / Export ───────────────────────────────────── */}
          {currentStep === 9 && currentRun && (
            <div className="space-y-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
                <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-3" />
                <h3 className="text-xl font-bold text-green-900 mb-2">Payroll Finalized</h3>
                <p className="text-green-800 text-sm font-mono">{currentRun.id}</p>
                {currentRun.finalized_at && (
                  <p className="text-green-700 text-xs mt-1">{new Date(currentRun.finalized_at).toLocaleString()}</p>
                )}
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Printer className="w-4 h-4" /> Print & Export Options
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Payroll Checks', type: 'CHECKS' },
                    { label: 'Pay Stubs', type: 'STUBS' },
                    { label: 'Payroll Register', type: 'REGISTER' },
                    { label: 'Direct Deposit Report', type: 'DD_REPORT' },
                    { label: 'Tax Summary', type: 'TAX_SUMMARY' },
                    { label: 'GL Journal Entry', type: 'GL_ENTRY' },
                  ].map(({ label, type }) => (
                    <button
                      key={type}
                      onClick={() => payrollApi.exportReport(currentRun.id, type).then(() => showToast(`${label} export queued`, 'success')).catch(e => showToast(e.message, 'error'))}
                      className="flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
                    >
                      <Download className="w-4 h-4 text-brand" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <Btn
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ['payroll-in-process'] });
                  setCurrentStep(1);
                  setValidationResult(null);
                  setWarningsAcknowledged(false);
                  showToast('Ready to start next payroll cycle', 'success');
                }}
                size="lg"
                className="w-full"
              >
                Start Next Payroll Run
              </Btn>
            </div>
          )}

          {/* Navigation */}
          {currentStep < 9 && (
            <div className="flex justify-between gap-4 mt-8">
              <button
                onClick={() => setCurrentStep(Math.max(1, currentStep - 1) as WizardStep)}
                disabled={currentStep === 1}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 font-medium"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>

              {/* Step 1: handled by Start button */}
              {currentStep > 1 && currentStep < 8 && !(currentStep === 5) && (
                <Btn
                  onClick={() => setCurrentStep((currentStep + 1) as WizardStep)}
                  icon={<ChevronRight className="w-4 h-4" />}
                >
                  Next
                </Btn>
              )}

              {/* Step 5: Validate gate */}
              {currentStep === 5 && validationResult && (
                <Btn
                  onClick={() => setCurrentStep(6)}
                  disabled={!canProceedFromValidation}
                  icon={<ChevronRight className="w-4 h-4" />}
                  title={!canProceedFromValidation ? (hasValidationErrors ? 'Fix errors first' : 'Acknowledge warnings first') : undefined}
                >
                  Continue to Review
                </Btn>
              )}

              {/* Step 7: NACHA done → go to step 8 */}
              {currentStep === 7 && (
                <Btn
                  onClick={() => setCurrentStep(8)}
                  disabled={!currentRun?.nacha_generated}
                  icon={<ChevronRight className="w-4 h-4" />}
                  title={!currentRun?.nacha_generated ? 'Generate NACHA first' : undefined}
                >
                  Continue to Finalization
                </Btn>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
