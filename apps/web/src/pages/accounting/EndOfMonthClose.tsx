import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Clock, AlertCircle, ChevronDown, ChevronUp, RotateCcw, Archive } from 'lucide-react';
import { eomApi, glApi } from '../../api/client';
import PageError from '../../components/PageError';
import PageLoader from '../../components/PageLoader';
import StatusBadge from '../../components/StatusBadge';
import DataTable, { Column } from '../../components/DataTable';
import FinancialStatementViewer from '../../components/FinancialStatementViewer';
import { Btn, PageHeader, Badge } from '../../components/ui';

// TypeScript Interfaces
interface ChecklistItem {
  id: string;
  name: string;
  key:
    | 'all_deals_posted'
    | 'all_ros_closed'
    | 'parts_eom_complete'
    | 'bank_reconciled'
    | 'ap_current'
    | 'ar_current'
    | 'payroll_posted'
    | 'floor_plan_reconciled'
    | 'schedule_review'
    | 'intercompany_balanced'
    | 'fs_accepted'       // BR-EOM-001: FS must be accepted before ACCT_080 gate
    | 'gl_validated';     // BR-EOM-002: GL must be in balance before ACCT_090 gate
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'N/A';
  completedBy?: string;
  completedDate?: string;
  notes?: string;
}

interface ArchiveLogEntry {
  id: string;
  archive_type: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  archived_at: string;
  error_message?: string;
}

interface EOLMStep {
  stepNumber: number;
  name: string;
  description: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED' | 'SKIPPED';
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  isDestructive: boolean;
}

interface EOLMCloseData {
  id: string;
  year: number;
  month: number;
  checklist: ChecklistItem[];
  currentStepNumber: number;
  steps: EOLMStep[];
  trialBalance: any;
  isBalanced: boolean;
  closingInProgress: boolean;
  closedSuccessfully: boolean;
  generatedStatements: string[];
}

interface TrialBalanceData {
  totalDebits: number;
  totalCredits: number;
  accounts: Array<{
    code: string;
    name: string;
    debit: number;
    credit: number;
  }>;
}

type UIState = 'idle' | 'loading' | 'success' | 'error' | 'incomplete' | 'closing' | 'blocked' | 'closed';

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export default function EndOfMonthClose() {
  const queryClient = useQueryClient();
  const [uiState, setUiState] = useState<UIState>('loading');
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [expandedChecklist, setExpandedChecklist] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Fetch EOM readiness
  const { data: eomData, isLoading, error, refetch } = useQuery({
    queryKey: ['eom-close'],
    queryFn: async () => {
      const readiness = await eomApi.getReadiness();
      return readiness as EOLMCloseData;
    },
    retry: false,
  });

  // Fetch trial balance
  const { data: trialBalance } = useQuery({
    queryKey: ['trial-balance'],
    queryFn: async () => {
      const today = new Date();
      return await glApi.getTrialBalance(today.getFullYear(), today.getMonth() + 1);
    },
    retry: false,
  });

  // Poll archive log every 2s while ACCT_065 is active (NS-002)
  const archiveStepActive = eomData?.steps?.some(
    s => s.stepNumber === 65 && (s.status === 'IN_PROGRESS' || s.status === 'COMPLETED'),
  );
  const { data: archiveLog } = useQuery<ArchiveLogEntry[]>({
    queryKey: ['eom-archive-log', eomData?.id],
    queryFn: () => eomApi.getArchiveLog(eomData!.id),
    enabled: !!eomData?.id && !!archiveStepActive,
    refetchInterval: archiveStepActive ? 2000 : false,
    retry: false,
  });

  useEffect(() => {
    if (isLoading) setUiState('loading');
    else if (error) setUiState('error');
    else if (!eomData) setUiState('incomplete');
    else if (eomData.closedSuccessfully) setUiState('closed');
    else if (eomData.closingInProgress) setUiState('closing');
    else if (eomData.steps?.some(s => s.status === 'BLOCKED')) setUiState('blocked');
    else setUiState('success');
  }, [isLoading, error, eomData]);

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }

  // Mark checklist item as complete mutation
  const markCompleteMutation = useMutation({
    mutationFn: async (itemKey: string) => {
      if (!eomData) return;
      // In production: PATCH to backend
      return { itemKey, status: 'COMPLETE', completedAt: new Date().toISOString() };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eom-close'] });
      showToast('Checklist item marked complete', 'success');
    },
  });

  // Initiate close mutation
  const initiateCloseMutation = useMutation({
    mutationFn: async () => {
      if (!eomData) return;
      setUiState('closing');
      return await eomApi.initiate(eomData.year, eomData.month);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eom-close'] });
      showToast('EOM close initiated', 'success');
      setCloseConfirmOpen(false);
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to initiate close', 'error');
      setUiState('success');
    },
  });

  // Advance step mutation
  const advanceStepMutation = useMutation({
    mutationFn: async (stepNumber: number) => {
      if (!eomData) return;
      setUiState('closing');
      return await eomApi.advance(eomData.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eom-close'] });
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to advance step', 'error');
    },
  });

  // Retry step mutation
  const retryStepMutation = useMutation({
    mutationFn: async (stepNumber: number) => {
      if (!eomData) return;
      setUiState('closing');
      return await eomApi.retry(eomData.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eom-close'] });
      showToast('Step retry initiated', 'success');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to retry step', 'error');
      setUiState('success');
    },
  });

  if (uiState === 'loading') return <PageLoader page="End of Month Close" />;
  if (uiState === 'error') return <PageError error={error} retry={() => refetch()} />;

  if (!eomData) return null;

  // Checklist items configuration
  const checklistConfig: Record<string, { label: string; icon: string; note?: string }> = {
    all_deals_posted: { label: 'All deals posted', icon: '📋' },
    all_ros_closed: { label: 'All ROS entries closed', icon: '🔒' },
    parts_eom_complete: { label: 'Parts EOM complete', icon: '🔧' },
    bank_reconciled: { label: 'Bank reconciliation complete', icon: '🏦' },
    ap_current: { label: 'AP current', icon: '💳' },
    ar_current: { label: 'AR current', icon: '📊' },
    payroll_posted: { label: 'Payroll posted', icon: '💰' },
    floor_plan_reconciled: { label: 'Floor plan reconciled', icon: '🚗' },
    schedule_review: { label: 'Schedule review complete', icon: '📅' },
    intercompany_balanced: { label: 'Intercompany balanced', icon: '🔗' },
    fs_accepted: {
      label: 'Financial Statements submitted and accepted',
      icon: '📄',
      note: 'Required before ACCT_080 gate (BR-EOM-001)',
    },
    gl_validated: {
      label: 'GL trial balance validated (Program 33)',
      icon: '⚖️',
      note: 'Required before ACCT_090 gate (BR-EOM-002) — debits must equal credits',
    },
  };

  const ARCHIVE_TYPE_LABELS: Record<string, string> = {
    DETAIL_SCHEDULES: 'Detail Schedules',
    SUMMARY_SCHEDULES: 'Summary Schedules',
    GL_TRIAL_BALANCE: 'GL Trial Balance',
    MONTHLY_TRANS_REGISTER: 'Monthly Trans Register',
    GL_DETAIL_SUMMARY: 'GL Detail Summary',
    SCHEDULE_REPORTS: 'Schedule Reports',
    FINANCIAL_STATEMENTS: 'Financial Statements',
  };

  const allChecklistComplete = (eomData.checklist ?? []).every(
    item => item.status === 'COMPLETE' || item.status === 'N/A'
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <PageHeader
        title="End of Month Close"
        subtitle={`${eomData.year}-${String(eomData.month).padStart(2, '0')}`}
        actions={<StatusBadge status={eomData.closedSuccessfully ? 'CLOSED' : 'IN_PROGRESS'} />}
      />

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg text-white ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* Destructive Warning Banner */}
      <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-red-900">Warning: Irreversible Changes</h3>
          <p className="text-red-800 text-sm mt-1">
            Steps ACCT_100 and above make permanent changes to the GL. These cannot be reset after completion.
          </p>
        </div>
      </div>

      {/* Close Status */}
      {eomData.closedSuccessfully && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-green-900">Close Completed</h3>
            <p className="text-green-800 text-sm mt-1">
              {(eomData.generatedStatements ?? []).join(', ')} generated
            </p>
          </div>
        </div>
      )}

      {eomData.closingInProgress && (
        <div className="mb-6 bg-brand-light border border-brand-border rounded-lg p-4 flex gap-3">
          <Clock className="w-5 h-5 text-brand flex-shrink-0 mt-0.5 animate-spin" />
          <div>
            <h3 className="font-semibold text-blue-900">Close in Progress</h3>
            <p className="text-blue-800 text-sm mt-1">
              Processing step {eomData.currentStepNumber}...
            </p>
          </div>
        </div>
      )}

      {/* Pre-Close Checklist */}
      <div className="mb-8 bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">Pre-Close Checklist</h2>
          <div className="text-sm text-gray-600">
            {(eomData.checklist ?? []).filter(i => i.status === 'COMPLETE').length} of{' '}
            {(eomData.checklist ?? []).filter(i => i.status !== 'N/A').length} complete
          </div>
        </div>
        <div className="space-y-2">
          {(eomData.checklist ?? []).map(item => {
            const config = checklistConfig[item.key as keyof typeof checklistConfig];
            const isExpanded = expandedChecklist === item.id;

            return (
              <div
                key={item.id}
                className="border border-gray-200 rounded-lg overflow-hidden hover:border-gray-300 transition-colors"
              >
                <button
                  onClick={() => setExpandedChecklist(isExpanded ? null : item.id)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-xl">{config?.icon || '□'}</span>
                    <div className="text-left flex-1">
                      <p className="font-semibold text-gray-900">{config?.label || item.name}</p>
                      {item.completedDate && (
                        <p className="text-xs text-gray-600">
                          Completed {new Date(item.completedDate).toLocaleDateString()} by {item.completedBy}
                        </p>
                      )}
                    </div>
                    <StatusBadge
                      status={
                        item.status === 'NOT_STARTED'
                          ? 'DRAFT'
                          : item.status === 'IN_PROGRESS'
                            ? 'PROCESSING'
                            : item.status === 'COMPLETE'
                              ? 'POSTED'
                              : 'CLOSED'
                      }
                    />
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 space-y-3">
                    {config?.note && (
                      <div className="bg-amber-50 border border-amber-200 rounded p-2">
                        <p className="text-xs text-amber-800">{config.note}</p>
                      </div>
                    )}
                    {item.notes && (
                      <div>
                        <p className="text-xs text-gray-600 font-semibold uppercase mb-1">Notes</p>
                        <p className="text-sm text-gray-700">{item.notes}</p>
                      </div>
                    )}
                    {item.status !== 'COMPLETE' && item.status !== 'N/A' && (
                      <Btn
                        onClick={() => markCompleteMutation.mutate(item.key)}
                        loading={markCompleteMutation.isPending}
                        className="w-full"
                      >
                        Mark as Complete
                      </Btn>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Progress */}
      <div className="mb-8 bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Process Steps</h2>
        <div className="space-y-3">
          {(eomData.steps ?? []).map((step, idx) => {
            const isExpanded = expandedStep === step.stepNumber;
            const isDestructive = step.stepNumber >= 100;
            const stepId = `ACCT_${String(step.stepNumber).padStart(3, '0')}`;

            return (
              <div
                key={step.stepNumber}
                className={`border rounded-lg overflow-hidden transition-colors ${
                  step.status === 'BLOCKED'
                    ? 'border-red-300 bg-red-50'
                    : step.status === 'IN_PROGRESS'
                      ? 'border-blue-300 bg-brand-light'
                      : step.status === 'COMPLETED'
                        ? 'border-green-300 bg-green-50'
                        : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <button
                  onClick={() => setExpandedStep(isExpanded ? null : step.stepNumber)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:opacity-75 transition-opacity"
                >
                  <div className="flex items-center gap-3 flex-1 text-left">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        step.status === 'COMPLETED'
                          ? 'bg-green-600 text-white'
                          : step.status === 'BLOCKED'
                            ? 'bg-red-600 text-white'
                            : step.status === 'IN_PROGRESS'
                              ? 'bg-brand text-white'
                              : 'bg-gray-300 text-gray-700'
                      }`}
                    >
                      {step.status === 'COMPLETED' ? '✓' : step.stepNumber}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">
                        {stepId}: {step.name}
                      </p>
                      {isDestructive && (
                        <p className="text-xs text-orange-600 font-semibold mt-1">⚠ Destructive (cannot reset)</p>
                      )}
                    </div>
                    <StatusBadge status={step.status} />
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-gray-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-current px-4 py-3 space-y-3 opacity-75">
                    <p className="text-sm text-gray-700">{step.description}</p>
                    {step.errorMessage && (
                      <div className="bg-red-50 border border-red-200 rounded p-2">
                        <p className="text-xs font-semibold text-red-900">Error</p>
                        <p className="text-sm text-red-800">{step.errorMessage}</p>
                      </div>
                    )}
                    {step.startedAt && (
                      <div>
                        <p className="text-xs text-gray-600 font-semibold">
                          Started: {new Date(step.startedAt).toLocaleString()}
                        </p>
                        {step.completedAt && (
                          <p className="text-xs text-gray-600 font-semibold">
                            Completed: {new Date(step.completedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    )}
                    {step.status === 'BLOCKED' && (
                      <button
                        onClick={() => retryStepMutation.mutate(step.stepNumber)}
                        disabled={retryStepMutation.isPending}
                        className="w-full px-3 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700 disabled:opacity-50 font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        <RotateCcw className="w-4 h-4" />
                        {retryStepMutation.isPending ? 'Retrying...' : 'Retry'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Archive Progress (NS-002) — shown when ACCT_065 is active or completed */}
      {archiveStepActive && (
        <div className="mb-8 bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Archive className="w-5 h-5 text-brand" />
            <h2 className="text-xl font-bold text-gray-900">Archive Progress</h2>
            {archiveLog && archiveLog.length < 7 && (
              <Clock className="w-4 h-4 text-blue-500 animate-spin ml-2" />
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.keys(ARCHIVE_TYPE_LABELS).map(archiveType => {
              const entry = archiveLog?.find(e => e.archive_type === archiveType);
              const status = entry?.status ?? 'PENDING';
              return (
                <div
                  key={archiveType}
                  className={`rounded-lg border p-3 flex items-center gap-3 ${
                    status === 'COMPLETED'
                      ? 'border-green-200 bg-green-50'
                      : status === 'FAILED'
                        ? 'border-red-200 bg-red-50'
                        : status === 'IN_PROGRESS'
                          ? 'border-brand-border bg-brand-light'
                          : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="text-lg">
                    {status === 'COMPLETED' ? '✓' : status === 'FAILED' ? '✗' : status === 'IN_PROGRESS' ? '⟳' : '○'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {ARCHIVE_TYPE_LABELS[archiveType]}
                    </p>
                    {entry?.archived_at && status === 'COMPLETED' && (
                      <p className="text-xs text-gray-500">
                        {new Date(entry.archived_at).toLocaleTimeString()}
                      </p>
                    )}
                    {entry?.error_message && (
                      <p className="text-xs text-red-700 truncate">{entry.error_message}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {archiveLog && (
            <p className="text-xs text-gray-500 mt-3">
              {archiveLog.filter(e => e.status === 'COMPLETED').length} of 7 archive types completed
            </p>
          )}
        </div>
      )}

      {/* Trial Balance Review */}
      <div className="mb-8 bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Trial Balance</h2>
        {trialBalance ? (
          <>
            {eomData.isBalanced ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 flex gap-2">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-green-900">Trial Balance Verified</p>
                  <p className="text-sm text-green-800">
                    Debits: <span className="font-mono">{fmt(trialBalance.totalDebits)}</span> = Credits: <span className="font-mono">{fmt(trialBalance.totalCredits)}</span>
                  </p>
                </div>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-red-900">Trial Balance Not Balanced</p>
                  <p className="text-sm text-red-800">Review GL entries before proceeding</p>
                </div>
              </div>
            )}

            {/* Financial Statement Viewer would be embedded here */}
            <FinancialStatementViewer />
          </>
        ) : (
          <p className="text-gray-600">Loading trial balance...</p>
        )}
      </div>

      {/* Close Action */}
      {!eomData.closedSuccessfully && (
        <div className="fixed bottom-6 right-6 flex gap-3">
          {closeConfirmOpen && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-lg p-4 max-w-xs">
              <p className="text-sm font-semibold text-gray-900 mb-3">Confirm End of Month Close?</p>
              <p className="text-xs text-gray-600 mb-4">This will process all remaining steps and cannot be undone.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCloseConfirmOpen(false)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => initiateCloseMutation.mutate()}
                  disabled={
                    !allChecklistComplete || !eomData.isBalanced || initiateCloseMutation.isPending
                  }
                  className="flex-1 px-3 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm
                </button>
              </div>
            </div>
          )}

          <Btn
            variant="danger"
            size="lg"
            onClick={() => setCloseConfirmOpen(!closeConfirmOpen)}
            disabled={
              !allChecklistComplete ||
              !eomData.isBalanced ||
              eomData.closingInProgress ||
              eomData.closedSuccessfully
            }
            loading={initiateCloseMutation.isPending}
            icon={<AlertTriangle className="w-4 h-4" />}
            shortcut="F8"
            className="shadow-lg"
          >
            Close Period
          </Btn>
        </div>
      )}

      {/* Post-Close Summary */}
      {eomData.closedSuccessfully && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Close Summary</h2>
          <div className="grid grid-cols-2 gap-4">
            {(eomData.generatedStatements ?? []).map(stmt => (
              <div key={stmt} className="bg-green-50 border border-green-200 rounded-lg p-4">
                <CheckCircle className="w-5 h-5 text-green-600 mb-2" />
                <p className="font-semibold text-gray-900">{stmt}</p>
                <p className="text-xs text-gray-600 mt-1">Generated and ready for review</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
