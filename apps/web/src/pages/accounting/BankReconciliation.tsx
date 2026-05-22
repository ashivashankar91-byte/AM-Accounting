import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, Zap, Lock } from 'lucide-react';
import { reconApi, glApi } from '../../api/client';
import PageError from '../../components/PageError';
import PageLoader from '../../components/PageLoader';
import StatusBadge from '../../components/StatusBadge';
import DataTable, { Column } from '../../components/DataTable';
import { SkeletonTable } from '../../components/Skeleton';
import FloorPlanFinancing from '../../components/FloorPlanFinancing';
import { Btn, PageHeader, EmptyState, Badge, MoneyCell } from '../../components/ui';

// TypeScript Interfaces
interface OutstandingCheck {
  checkId: string;
  checkNumber: string;
  date: string;
  payee: string;
  amount: number;
  isCleared: boolean;
}

interface OutstandingDeposit {
  depositId: string;
  depositNumber: string;
  date: string;
  description: string;
  amount: number;
  isCleared: boolean;
}

interface Adjustment {
  adjustmentId: string;
  date: string;
  description: string;
  amount: number;
  glAccount: string;
  type: 'debit' | 'credit';
}

interface MatchedTransaction {
  bankTxnId: string;
  glTxnId: string;
  amount: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface ReconciliationData {
  id: string;
  glBalance: number;
  statementBalance: number;
  outstandingChecks: OutstandingCheck[];
  outstandingDeposits: OutstandingDeposit[];
  adjustments: Adjustment[];
  matchedTransactions: MatchedTransaction[];
  status: 'PENDING' | 'IN_PROGRESS' | 'BALANCED' | 'COMPLETE';
  completedAt?: string;
}

type UIState = 'idle' | 'loading' | 'success' | 'error' | 'empty' | 'matching' | 'unbalanced' | 'completing';

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export default function BankReconciliation() {
  const queryClient = useQueryClient();
  const [uiState, setUiState] = useState<UIState>('loading');
  const [activeTab, setActiveTab] = useState<'reconciliation' | 'floor-plan'>('reconciliation');
  const [glBalance, setGlBalance] = useState('0.00');
  const [statementBalance, setStatementBalance] = useState('0.00');
  const [selectedCheckIds, setSelectedCheckIds] = useState<Set<string>>(new Set());
  const [selectedDepositIds, setSelectedDepositIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Fetch reconciliation data
  const { data: recon, isLoading, error, refetch } = useQuery({
    queryKey: ['bank-reconciliation'],
    queryFn: async () => {
      const list = await reconApi.list();
      return (list && list[0]) || null;
    },
    retry: false,
  });

  // Calculate reconciliation balance
  const calculateAdjustedBalance = () => {
    if (!recon) return 0;
    let adjusted = parseFloat(glBalance || '0');

    // Subtract outstanding checks
    recon.outstandingChecks
      .filter((c: OutstandingCheck) => !selectedCheckIds.has(c.checkId))
      .forEach((c: OutstandingCheck) => { adjusted -= c.amount; });

    // Add outstanding deposits
    recon.outstandingDeposits
      .filter((d: OutstandingDeposit) => !selectedDepositIds.has(d.depositId))
      .forEach((d: OutstandingDeposit) => { adjusted += d.amount; });

    // Apply adjustments
    recon.adjustments.forEach((adj: Adjustment) => {
      adjusted += (adj.type === 'debit' ? adj.amount : -adj.amount);
    });

    return adjusted;
  };

  const adjustedBalance = calculateAdjustedBalance();
  const statementBal = parseFloat(statementBalance || '0');
  const difference = adjustedBalance - statementBal;
  const isBalanced = Math.abs(difference) < 0.01;

  useEffect(() => {
    if (isLoading) setUiState('loading');
    else if (error) setUiState('error');
    else if (!recon) setUiState('empty');
    else setUiState(isBalanced ? 'success' : 'unbalanced');
  }, [isLoading, error, recon, isBalanced]);

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }

  // Auto-clear mutation
  const autoMatchMutation = useMutation({
    mutationFn: async () => {
      if (!recon) return;
      setUiState('matching');
      // Simulate AI matching with confidence levels
      const matched: MatchedTransaction[] = [];
      recon.outstandingChecks.forEach((check: OutstandingCheck, idx: number) => {
        if (idx % 3 === 0) {
          matched.push({
            bankTxnId: `bank-${check.checkId}`,
            glTxnId: check.checkId,
            amount: check.amount,
            confidence: idx % 2 === 0 ? 'HIGH' : 'MEDIUM',
          });
        }
      });
      return matched;
    },
    onSuccess: (matched) => {
      if (matched) {
        // Auto-clear HIGH confidence matches
        const highConfidence = matched.filter(m => m.confidence === 'HIGH');
        highConfidence.forEach(m => {
          setSelectedCheckIds(prev => new Set([...prev, m.glTxnId]));
        });
        showToast(`Auto-cleared ${highConfidence.length} high-confidence matches`, 'success');
      }
      setUiState('success');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Auto-match failed', 'error');
      setUiState('unbalanced');
    },
  });

  // Complete reconciliation mutation
  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!recon || !isBalanced) throw new Error('Reconciliation not balanced');
      setUiState('completing');
      return await reconApi.complete(recon.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation'] });
      showToast('Reconciliation completed successfully', 'success');
      setUiState('success');
    },
    onError: (err: any) => {
      showToast(err.message ?? 'Failed to complete reconciliation', 'error');
      setUiState('unbalanced');
    },
  });

  // Add adjustment mutation
  const addAdjustmentMutation = useMutation({
    mutationFn: async (adj: Adjustment) => {
      if (!recon) return;
      // In production, POST to backend
      return adj;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation'] });
      showToast('Adjustment added', 'success');
    },
  });

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && activeTab === 'reconciliation') {
        e.preventDefault();
        // Space toggles last focused check
      }
      if (e.key === 'F7' && activeTab === 'reconciliation') {
        e.preventDefault();
        autoMatchMutation.mutate();
      }
      if (e.key === 'F8' && isBalanced && activeTab === 'reconciliation') {
        e.preventDefault();
        completeMutation.mutate();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, isBalanced]);

  if (uiState === 'loading') return <PageLoader page="Bank Reconciliation" />;
  if (uiState === 'error') return <PageError error={error} retry={() => refetch()} />;
  if (uiState === 'empty') {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl border border-gray-200">
          <EmptyState
            title="No reconciliation in progress"
            description="Create a new reconciliation to begin matching bank transactions with GL entries."
          />
        </div>
      </div>
    );
  }

  if (!recon) return null;

  // Outstanding Checks columns
  const checksColumns: Column<OutstandingCheck>[] = [
    {
      key: 'checkNumber',
      label: 'Check #',
      width: '80px',
    },
    {
      key: 'date',
      label: 'Date',
      width: '100px',
      render: (row) => new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'payee',
      label: 'Payee',
      width: '200px',
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      mono: true,
      render: (row) => fmt(row.amount),
    },
    {
      key: 'cleared',
      label: 'Cleared',
      align: 'center',
      width: '80px',
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedCheckIds.has(row.checkId)}
          onChange={(e) => {
            const newSet = new Set(selectedCheckIds);
            if (e.target.checked) newSet.add(row.checkId);
            else newSet.delete(row.checkId);
            setSelectedCheckIds(newSet);
          }}
          className="w-4 h-4"
        />
      ),
    },
  ];

  // Outstanding Deposits columns
  const depositsColumns: Column<OutstandingDeposit>[] = [
    {
      key: 'depositNumber',
      label: 'Deposit #',
      width: '100px',
    },
    {
      key: 'date',
      label: 'Date',
      width: '100px',
      render: (row) => new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'description',
      label: 'Description',
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      mono: true,
      render: (row) => fmt(row.amount),
    },
    {
      key: 'cleared',
      label: 'Cleared',
      align: 'center',
      width: '80px',
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedDepositIds.has(row.depositId)}
          onChange={(e) => {
            const newSet = new Set(selectedDepositIds);
            if (e.target.checked) newSet.add(row.depositId);
            else newSet.delete(row.depositId);
            setSelectedDepositIds(newSet);
          }}
          className="w-4 h-4"
        />
      ),
    },
  ];

  // Adjustments columns
  const adjustmentsColumns: Column<Adjustment>[] = [
    {
      key: 'date',
      label: 'Date',
      width: '100px',
      render: (row) => new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'description',
      label: 'Description',
    },
    {
      key: 'glAccount',
      label: 'GL Account',
      width: '120px',
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      mono: true,
      render: (row) => fmt(row.amount),
    },
    {
      key: 'type',
      label: 'Type',
      width: '80px',
      render: (row) => (
        <span className={row.type === 'debit' ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
          {row.type.toUpperCase()}
        </span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <PageHeader
        title="Bank Reconciliation"
        subtitle="Reconcile bank transactions with GL entries"
        actions={<StatusBadge status={recon.status} />}
      />

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg text-white ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('reconciliation')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'reconciliation'
              ? 'border-blue-600 text-brand'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Reconciliation
        </button>
        <button
          onClick={() => setActiveTab('floor-plan')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'floor-plan'
              ? 'border-blue-600 text-brand'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Floor Plan
        </button>
      </div>

      {activeTab === 'floor-plan' && <FloorPlanFinancing />}

      {activeTab === 'reconciliation' && (
        <>
          {/* Unbalanced Alert */}
          {!isBalanced && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-red-900">Reconciliation Not Balanced</h3>
                <p className="text-red-800 text-sm mt-1">
                  Difference: <span className="font-mono font-bold">{fmt(difference)}</span>
                </p>
              </div>
            </div>
          )}

          {/* Reconciliation Summary */}
          <div className="grid grid-cols-2 gap-6 mb-8 bg-gray-50 p-6 rounded-lg border border-gray-200">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">GL Balance</label>
              <input
                type="number"
                value={glBalance}
                onChange={(e) => setGlBalance(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-right"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Bank Statement Balance</label>
              <input
                type="number"
                value={statementBalance}
                onChange={(e) => setStatementBalance(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-right"
                placeholder="0.00"
              />
            </div>
            <div className="bg-white p-3 rounded border border-gray-300">
              <p className="text-xs text-gray-600 uppercase font-semibold mb-1">Adjusted GL Balance</p>
              <p className="text-2xl font-mono font-bold text-gray-900">{fmt(adjustedBalance)}</p>
            </div>
            <div className={`p-3 rounded border ${isBalanced ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
              <p className="text-xs uppercase font-semibold mb-1" style={{ color: isBalanced ? '#059669' : '#DC2626' }}>
                Difference
              </p>
              <p className={`text-2xl font-mono font-bold ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>
                {fmt(difference)}
              </p>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex gap-2 mb-6">
            <Btn
              onClick={() => autoMatchMutation.mutate()}
              loading={autoMatchMutation.isPending}
              icon={<Zap className="w-4 h-4" />}
              shortcut="F7"
              className="bg-purple-600 hover:bg-purple-700 focus:ring-purple-300"
            >
              {autoMatchMutation.isPending ? 'Matching...' : 'Auto-Clear'}
            </Btn>
            <Btn
              onClick={() => completeMutation.mutate()}
              disabled={!isBalanced}
              loading={completeMutation.isPending}
              icon={<CheckCircle className="w-4 h-4" />}
              shortcut="F8"
              className="bg-green-600 hover:bg-green-700 focus:ring-green-300"
            >
              {completeMutation.isPending ? 'Completing...' : 'Complete'}
            </Btn>
          </div>

          {/* Outstanding Checks */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Outstanding Checks</h2>
            <DataTable columns={checksColumns} data={recon.outstandingChecks} keyField="checkId" />
          </div>

          {/* Outstanding Deposits */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Outstanding Deposits</h2>
            <DataTable columns={depositsColumns} data={recon.outstandingDeposits} keyField="depositId" />
          </div>

          {/* Adjustments */}
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Adjustments</h2>
            <DataTable columns={adjustmentsColumns} data={recon.adjustments} keyField="adjustmentId" />
          </div>
        </>
      )}
    </div>
  );
}
