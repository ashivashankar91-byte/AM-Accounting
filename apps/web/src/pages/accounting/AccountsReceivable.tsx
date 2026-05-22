import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo } from 'react';
import { AlertCircle, Check, Loader2, Plus, Zap, RefreshCw, Settings, FileText, Download, Printer, X, ChevronDown, ChevronRight, Ban, Search } from 'lucide-react';
import { aparApi, glApi, cashReceiptApi } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import DataTable, { Column } from '../../components/DataTable';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, PageHeader, Badge, EmptyState } from '../../components/ui';

// ─── Constants ───────────────────────────────────────────────────────────────

const PAYMENT_METHODS = [
  { code: 'CASH', label: 'Cash' },
  { code: 'PERSONAL_CHECK', label: 'Personal Check' },
  { code: 'BUSINESS_CHECK', label: 'Business Check' },
  { code: 'CASHIER_CHECK', label: "Cashier's Check" },
  { code: 'BANK_CHECK', label: 'Bank Check' },
  { code: 'MONEY_ORDER', label: 'Money Order' },
  { code: 'TRAVELER_CHECK', label: "Traveler's Check" },
  { code: 'THIRD_PARTY_CHECK', label: 'Third Party Check' },
  { code: 'VISA', label: 'Visa' },
  { code: 'MASTERCARD', label: 'MasterCard' },
  { code: 'AMEX', label: 'American Express' },
  { code: 'DISCOVER', label: 'Discover' },
  { code: 'ACH', label: 'ACH' },
  { code: 'OTHER', label: 'Other' },
];

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface GlDistLine {
  co: string;
  amount: number;
  accountCode: string;
  accountDesc: string;
  controlNumber: string;
  applyTo: string;
  comments: string;
}

interface CashReceipt {
  id?: string;
  receiptNumber?: string;          // server-assigned — read-only after creation
  receiptDate: string;
  customerId: string;
  customerName: string;
  paymentMethod: string;
  checkNumber?: string;
  amountReceived: number;
  glDistribution: GlDistLine[];   // S2-04: replaces bankAccount
  status?: 'DRAFT' | 'POSTED' | 'VOIDED' | 'PENDING_MANUAL'; // S4-05
  appliedAmount?: number;
  unappliedAmount?: number;
  applications?: PaymentApplication[];
  // S4-04 fields
  journalSource?: string;
  sourceDocumentType?: string;
  sourceDocumentNumber?: string;
  cashierUserId?: string;
  remarks?: string;
  // S6-10: IRS 8300 — number of $100 bills (required when cash >= $10,000)
  cash100BillCount?: number;
}

interface PaymentApplication {
  invoiceId: string;
  invoiceNumber: string;
  originalAmount: number;
  balanceDue: number;
  applyAmount: number;
}

interface OpenInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  originalAmount: number;
  balanceDue: number;
}

interface AgingData {
  customer: string;
  current: number;
  past30: number;
  past60: number;
  past90: number;
  past120: number;
  total: number;
}

interface CustomerInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  invoiceDate: string;
  amount: number;
  status: 'Open' | 'Partial' | 'Paid' | 'Overdue';
}

interface CreditMemo {
  id: string;
  memoNumber: string;
  customerName: string;
  memoDate: string;
  amount: number;
  reason: string;
}

type TabType =
  | 'receipts'
  | 'manual-entry'
  | 'customer-invoices'
  | 'ar-aging'
  | 'daily-deposit'
  | 'display-void'
  | 'reports';

type UIState =
  | 'idle'
  | 'loading'
  | 'success'
  | 'error'
  | 'applying'
  | 'posting'
  | 'duplicate-receipt-error';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const emptyDistLine = (): GlDistLine => ({
  co: '01',
  amount: 0,
  accountCode: '',
  accountDesc: '',
  controlNumber: '',
  applyTo: '',
  comments: '',
});

function emptyReceipt(): CashReceipt {
  return {
    receiptDate: new Date().toISOString().slice(0, 10),
    customerId: '',
    customerName: '',
    paymentMethod: 'PERSONAL_CHECK',
    checkNumber: '',
    amountReceived: 0,
    glDistribution: [emptyDistLine()],
    applications: [],
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccountsReceivable() {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<TabType>('receipts');
  const [uiState, setUiState] = useState<UIState>('idle');
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [showNewReceipt, setShowNewReceipt] = useState(false);
  const [duplicateAlert, setDuplicateAlert] = useState<string | null>(null);
  const [newReceipt, setNewReceipt] = useState<CashReceipt>(emptyReceipt());
  // S4-06: source filter
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  // S4-08: preferences
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, any>>(() => {
    try { return JSON.parse(localStorage.getItem('ar-prefs') ?? '{}'); } catch { return {}; }
  });
  const savePrefs = (updates: Record<string, any>) => {
    const merged = { ...prefs, ...updates };
    setPrefs(merged);
    localStorage.setItem('ar-prefs', JSON.stringify(merged));
  };

  // ─── Queries ─────────────────────────────────────────────────────────────

  const {
    data: arData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['ar-entries'],
    queryFn: () => aparApi.getAR(),
    retry: false,
  });

  // ─── Mutations ───────────────────────────────────────────────────────────

  const createReceiptMut = useMutation({
    mutationFn: (data: any) => aparApi.createAR(data),
    onSuccess: (result: any) => {
      setUiState('success');
      queryClient.invalidateQueries({ queryKey: ['ar-entries'] });
      // Receipt number comes from backend response
      setNewReceipt(emptyReceipt());
      setShowNewReceipt(false);
      setTimeout(() => setUiState('idle'), 3000);
    },
    onError: (err: any) => {
      const msg = err?.message ?? String(err);
      if (msg.toLowerCase().includes('duplicate')) {
        setDuplicateAlert(`Duplicate receipt detected: ${msg}`);
        setUiState('duplicate-receipt-error');
      } else {
        setUiState('error');
      }
    },
  });

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleAutoApply = () => {
    if (!newReceipt.amountReceived) return;
    let remaining = newReceipt.amountReceived;
    // S5-09: Sort by dueDate ASC (oldest first) before applying
    const sorted = [...openInvoices].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    const updated = sorted.map(inv => {
      const apply = Math.min(remaining, inv.balanceDue);
      remaining -= apply;
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        originalAmount: inv.originalAmount,
        balanceDue: inv.balanceDue,
        applyAmount: apply,
      };
    });
    const totalApplied = updated.reduce((s, a) => s + a.applyAmount, 0);
    setNewReceipt({
      ...newReceipt,
      applications: updated,
      appliedAmount: totalApplied,
      unappliedAmount: Math.max(0, newReceipt.amountReceived - totalApplied),
    });
  };

  const glDistTotal = newReceipt.glDistribution.reduce((s, l) => s + Number(l.amount || 0), 0);
  const glDistBalance = newReceipt.amountReceived - glDistTotal;

  const handleCreateReceipt = () => {
    if (!newReceipt.customerId || !newReceipt.amountReceived) return;
    createReceiptMut.mutate({
      receiptDate: newReceipt.receiptDate,
      customerId: newReceipt.customerId,
      customerName: newReceipt.customerName,
      paymentMethod: newReceipt.paymentMethod,
      checkNumber: newReceipt.checkNumber,
      amountReceived: newReceipt.amountReceived,
      glDistribution: newReceipt.glDistribution,
      applications: newReceipt.applications,
    });
  };

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F7' && activeTab === 'manual-entry') {
        e.preventDefault();
        handleAutoApply();
      }
      if (e.key === 'F8' && activeTab === 'manual-entry') {
        e.preventDefault();
        handleCreateReceipt();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [newReceipt, openInvoices, activeTab]);

  // S4-07: payment totals from filtered set — hooks must precede any early returns
  const cashierReceipts = (arData ?? []) as any[];

  const filteredReceipts = useMemo(() => {
    let list = cashierReceipts;
    if (sourceFilter !== 'all') list = list.filter((r: any) => r.journalSource === sourceFilter || r.oemSource === sourceFilter);
    return list;
  }, [cashierReceipts, sourceFilter]);

  const paymentTotals = useMemo(() => {
    const totals = { cash: 0, check: 0, credit: 0, other: 0, total: 0 };
    for (const r of filteredReceipts) {
      const amt = Number(r.amount ?? 0);
      totals.total += amt;
      const m = (r.paymentMethod ?? '').toUpperCase();
      if (m === 'CASH') totals.cash += amt;
      else if (m.includes('CHECK') || m === 'MONEY_ORDER') totals.check += amt;
      else if (['VISA','MASTERCARD','AMEX','DISCOVER'].includes(m)) totals.credit += amt;
      else totals.other += amt;
    }
    return totals;
  }, [filteredReceipts]);

  // ─── Loading / Error ─────────────────────────────────────────────────────

  if (isLoading) {
    return <PageLoader page="Accounts Receivable" service="apar-service" port={3013} />;
  }

  if (error) {
    return <PageError error={error} serviceName="AP/AR Service" port={3013} retry={refetch} />;
  }

  const arInvoices = (arData ?? []) as CustomerInvoice[];

  // S4-05: pending manual count
  const pendingManualCount = cashierReceipts.filter((r: any) => r.status === 'PENDING_MANUAL').length;

  const totalOutstanding = arInvoices.reduce((sum: number, inv: any) => {
    if (inv.status !== 'Paid') return sum + Number(inv.amount ?? 0);
    return sum;
  }, 0);
  const overdueInvoices = arInvoices.filter((inv: any) => inv.status === 'Overdue');

  const TAB_LABELS: Record<TabType, string> = {
    'receipts': 'Receipts',
    'manual-entry': 'Manual Entry',
    'customer-invoices': 'Customer Invoices',
    'ar-aging': 'AR Aging',
    'daily-deposit': 'Daily Deposit',
    'display-void': 'Display/Void',
    'reports': 'Reports',
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <PageHeader
        title="Accounts Receivable (WF-A003)"
        subtitle="Cash receipts, customer invoices, and AR aging analysis."
        actions={
          <>
            <Btn variant="secondary" icon={<Settings className="w-4 h-4" />} onClick={() => setShowPrefs(true)}>
              Preferences
            </Btn>
            <Btn variant="secondary" icon={<RefreshCw className="w-4 h-4" />} onClick={() => refetch()}>
              Refresh
            </Btn>
          </>
        }
      />

      {/* Status Messages */}
      {uiState === 'error' && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          <span>Error processing request</span>
        </div>
      )}
      {uiState === 'success' && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <Check className="w-5 h-5" />
          <span>Receipt posted successfully</span>
        </div>
      )}
      {uiState === 'duplicate-receipt-error' && duplicateAlert && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          <span>{duplicateAlert}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Total Invoices</p>
          <p className="text-2xl font-bold">{arInvoices.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Outstanding</p>
          <p className="text-2xl font-bold text-amber-600">${fmt(totalOutstanding)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Overdue</p>
          <p className="text-2xl font-bold text-red-600">{overdueInvoices.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Paid This Month</p>
          <p className="text-2xl font-bold text-green-600">
            {arInvoices.filter((inv: any) => inv.status === 'Paid').length}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-0 overflow-x-auto">
          {(Object.keys(TAB_LABELS) as TabType[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'border-blue-600 text-brand'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {TAB_LABELS[tab]}
              {tab === 'receipts' && (
                <span className="ml-1.5 bg-brand-light text-brand text-xs font-medium px-1.5 py-0.5 rounded">
                  Primary
                </span>
              )}
              {tab === 'manual-entry' && (
                <span className="ml-1.5 bg-gray-100 text-gray-600 text-xs font-medium px-1.5 py-0.5 rounded">
                  Exception
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-4">

        {/* ── Tab 1: Receipts (PRIMARY — cashier-sourced) ─────────────────── */}
        {activeTab === 'receipts' && (
          <div className="space-y-3">
            <div className="bg-brand-light border border-brand-border rounded-lg px-4 py-3 text-sm text-blue-800">
              <strong>Cashier-Sourced Receipts</strong> — These receipts are auto-generated at the
              cashier window (Service Cash Out, Parts Invoice). Review and Post; do not create here.
            </div>

            {/* S4-05: PENDING_MANUAL alert */}
            {pendingManualCount > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-2.5 text-sm text-amber-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <strong>{pendingManualCount} receipt{pendingManualCount > 1 ? 's' : ''} pending manual review</strong>
                <span className="text-amber-600">— Gift Card or Charge-to-Account payments require manual GL posting below.</span>
              </div>
            )}

            {/* S4-07: Payment totals bar */}
            <div className="bg-white rounded-lg shadow px-4 py-2.5 flex items-center gap-6 text-sm">
              <span className="text-gray-500 font-medium text-xs uppercase tracking-wide mr-2">Totals:</span>
              <span>Cash: <span className="font-mono font-bold text-gray-800">${fmt(paymentTotals.cash)}</span></span>
              <span>Check: <span className="font-mono font-bold text-gray-800">${fmt(paymentTotals.check)}</span></span>
              <span>Credit: <span className="font-mono font-bold text-gray-800">${fmt(paymentTotals.credit)}</span></span>
              <span>Other: <span className="font-mono font-bold text-gray-800">${fmt(paymentTotals.other)}</span></span>
              <span className="ml-auto font-semibold">TOTAL: <span className="font-mono text-brand">${fmt(paymentTotals.total)}</span></span>
            </div>

            {/* S4-06: Filters + Actions bar */}
            <div className="flex justify-between items-center gap-3">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600 font-medium">Source:</label>
                <select
                  value={sourceFilter}
                  onChange={e => setSourceFilter(e.target.value)}
                  className="border rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-brand focus:outline-none"
                >
                  <option value="all">All Sources</option>
                  <option value="30">Service (30)</option>
                  <option value="32">Parts (32)</option>
                  <option value="56">Manual (56)</option>
                </select>
              </div>
              <button
                disabled
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium opacity-40 cursor-not-allowed"
              >
                <Check className="w-4 h-4" />
                Bulk Post Selected
              </button>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 w-8">
                      <input type="checkbox" className="w-4 h-4" disabled />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Receipt #</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Source Doc #</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Customer / Ref</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredReceipts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-6 py-10 text-center text-gray-500 text-sm">
                        No receipts found for the selected filter.
                      </td>
                    </tr>
                  ) : (
                    filteredReceipts
                      .sort((a: any, b: any) => (a.status === 'PENDING_MANUAL' ? -1 : b.status === 'PENDING_MANUAL' ? 1 : 0))
                      .map((r: any) => (
                        <tr key={r.id} className={`hover:bg-gray-50 ${r.status === 'PENDING_MANUAL' ? 'bg-amber-50' : ''}`} style={{ height: 36 }}>
                          <td className="px-4 py-2">
                            <input type="checkbox" className="w-4 h-4" />
                          </td>
                          <td className="px-4 py-2 font-mono text-xs">{r.dealerRef ?? '—'}</td>
                          <td className="px-4 py-2 text-xs">
                            <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                              {r.journalSource ?? r.oemSource ?? '—'}
                            </span>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-gray-600">{r.sourceDocumentNumber ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-gray-700">{r.customerName ?? r.dealerRef}</td>
                          <td className="px-4 py-2 text-xs text-gray-600">
                            {r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs">
                            ${fmt(Number(r.amount ?? 0))}
                          </td>
                          <td className="px-4 py-2">
                            {r.status === 'PENDING_MANUAL' ? (
                              <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                                Manual Review
                              </span>
                            ) : (
                              <StatusBadge status={r.status ?? 'OPEN'} />
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex gap-1">
                              <button className="text-xs text-brand hover:underline">View</button>
                              <span className="text-gray-300">|</span>
                              {r.status === 'PENDING_MANUAL' ? (
                                <button className="text-xs text-amber-600 hover:underline font-medium">Review</button>
                              ) : (
                                <button className="text-xs text-green-600 hover:underline font-medium">Post</button>
                              )}
                              <span className="text-gray-300">|</span>
                              <button className="text-xs text-red-500 hover:underline">Void</button>
                            </div>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab 2: Manual Entry (exception path) ────────────────────────── */}
        {activeTab === 'manual-entry' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              <strong>Exception Path — Manual Receipt Entry.</strong> Use only for back-office
              corrections. Normal receipts originate at the cashier window.
            </div>
            <div className="flex justify-end">
              <Btn
                onClick={() => setShowNewReceipt(!showNewReceipt)}
                icon={<Plus className="w-4 h-4" />}
              >
                New Manual Receipt
              </Btn>
            </div>

            {showNewReceipt && (
              <div className="bg-white rounded-lg shadow p-6 space-y-4 border-l-4 border-amber-400">
                <h3 className="font-semibold text-lg">Manual Cash Receipt Entry</h3>

                {/* Row 1: Date / Customer */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Receipt # <span className="text-gray-400 text-xs font-normal">(server-assigned)</span>
                    </label>
                    <input
                      type="text"
                      value={newReceipt.receiptNumber ?? ''}
                      readOnly
                      placeholder="Auto-assigned on save"
                      className="w-full border rounded px-3 py-2 text-sm font-mono bg-gray-50 text-gray-500 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Date</label>
                    <input
                      type="date"
                      value={newReceipt.receiptDate}
                      onChange={e => setNewReceipt({ ...newReceipt, receiptDate: e.target.value })}
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                    <input
                      type="text"
                      value={newReceipt.customerName}
                      onChange={e =>
                        setNewReceipt({
                          ...newReceipt,
                          customerName: e.target.value,
                          customerId: e.target.value,
                        })
                      }
                      placeholder="Customer name or ID..."
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                {/* Row 2: Payment method / Check# / Amount */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Payment Method
                    </label>
                    <select
                      value={newReceipt.paymentMethod}
                      onChange={e => setNewReceipt({ ...newReceipt, paymentMethod: e.target.value })}
                      className="w-full border rounded px-3 py-2 text-sm"
                    >
                      {PAYMENT_METHODS.map(pm => (
                        <option key={pm.code} value={pm.code}>
                          {pm.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Check #</label>
                    <input
                      type="text"
                      value={newReceipt.checkNumber ?? ''}
                      onChange={e => setNewReceipt({ ...newReceipt, checkNumber: e.target.value })}
                      placeholder="Optional"
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Amount Received
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newReceipt.amountReceived || ''}
                      onChange={e =>
                        setNewReceipt({
                          ...newReceipt,
                          amountReceived: parseFloat(e.target.value) || 0,
                        })
                      }
                      placeholder="0.00"
                      className="w-full border rounded px-3 py-2 text-sm text-right font-mono"
                    />
                  </div>
                </div>

                {/* S6-10: IRS 8300 — Cash >= $10,000 warning */}
                {newReceipt.paymentMethod === 'CASH' && newReceipt.amountReceived >= 10000 && (
                  <div className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4">
                    <p className="text-amber-800 font-bold text-sm flex items-center gap-2">
                      <span className="text-lg">⚠️</span>
                      IRS FORM 8300 REPORTING REQUIRED — Cash transaction over $10,000
                    </p>
                    <p className="text-amber-700 text-xs mt-1">
                      Federal law (26 USC § 6050I) requires reporting cash transactions exceeding $10,000. This receipt will be flagged for IRS 8300 filing.
                    </p>
                    <div className="mt-3">
                      <label className="block text-sm font-medium text-amber-900 mb-1">
                        Number of $100 bills received <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={newReceipt.cash100BillCount ?? ''}
                        onChange={e => setNewReceipt({ ...newReceipt, cash100BillCount: parseInt(e.target.value) || 0 })}
                        placeholder="Required"
                        className="w-40 border-2 border-amber-400 rounded px-3 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                )}

                {/* GL Distribution Grid (S2-04) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-sm text-gray-700">GL Distribution</h4>
                    <button
                      type="button"
                      onClick={() =>
                        setNewReceipt({
                          ...newReceipt,
                          glDistribution: [...newReceipt.glDistribution, emptyDistLine()],
                        })
                      }
                      className="text-xs bg-brand-light text-brand px-2.5 py-1 rounded hover:bg-blue-200 font-medium"
                    >
                      + Add Line
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded border border-gray-200">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600 w-14">CO</th>
                          <th className="px-3 py-2 text-right font-medium text-gray-600 w-28">Amount</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600 w-24">Acct #</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">
                            Acct Description
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600 w-28">
                            Control
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600 w-24">
                            Apply To
                          </th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Comments</th>
                          <th className="px-3 py-2 w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {newReceipt.glDistribution.map((line, i) => (
                          <tr key={i}>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                maxLength={2}
                                value={line.co}
                                onChange={e => {
                                  const updated = [...newReceipt.glDistribution];
                                  updated[i] = { ...updated[i], co: e.target.value };
                                  setNewReceipt({ ...newReceipt, glDistribution: updated });
                                }}
                                className="w-full border rounded px-2 py-1 text-xs font-mono"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={line.amount || ''}
                                onChange={e => {
                                  const updated = [...newReceipt.glDistribution];
                                  updated[i] = {
                                    ...updated[i],
                                    amount: parseFloat(e.target.value) || 0,
                                  };
                                  setNewReceipt({ ...newReceipt, glDistribution: updated });
                                }}
                                placeholder="0.00"
                                className="w-full border rounded px-2 py-1 text-xs text-right font-mono"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={line.accountCode}
                                onChange={e => {
                                  const updated = [...newReceipt.glDistribution];
                                  updated[i] = { ...updated[i], accountCode: e.target.value };
                                  setNewReceipt({ ...newReceipt, glDistribution: updated });
                                }}
                                placeholder="XXXX"
                                className="w-full border rounded px-2 py-1 text-xs font-mono"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={line.accountDesc}
                                onChange={e => {
                                  const updated = [...newReceipt.glDistribution];
                                  updated[i] = { ...updated[i], accountDesc: e.target.value };
                                  setNewReceipt({ ...newReceipt, glDistribution: updated });
                                }}
                                placeholder="Description"
                                className="w-full border rounded px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={line.controlNumber}
                                onChange={e => {
                                  const updated = [...newReceipt.glDistribution];
                                  updated[i] = { ...updated[i], controlNumber: e.target.value };
                                  setNewReceipt({ ...newReceipt, glDistribution: updated });
                                }}
                                placeholder="Control #"
                                className="w-full border rounded px-2 py-1 text-xs font-mono"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={line.applyTo}
                                onChange={e => {
                                  const updated = [...newReceipt.glDistribution];
                                  updated[i] = { ...updated[i], applyTo: e.target.value };
                                  setNewReceipt({ ...newReceipt, glDistribution: updated });
                                }}
                                placeholder="Apply to"
                                className="w-full border rounded px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                value={line.comments}
                                onChange={e => {
                                  const updated = [...newReceipt.glDistribution];
                                  updated[i] = { ...updated[i], comments: e.target.value };
                                  setNewReceipt({ ...newReceipt, glDistribution: updated });
                                }}
                                placeholder="Comments"
                                className="w-full border rounded px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {newReceipt.glDistribution.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = newReceipt.glDistribution.filter(
                                      (_, idx) => idx !== i
                                    );
                                    setNewReceipt({ ...newReceipt, glDistribution: updated });
                                  }}
                                  className="text-red-400 hover:text-red-600 text-xs"
                                >
                                  ✕
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                        <tr>
                          <td className="px-3 py-2 text-xs font-bold text-gray-700 text-right" colSpan={2}>
                            Total: <span className="font-mono ml-1">${fmt(glDistTotal)}</span>
                          </td>
                          <td colSpan={5} className="px-3 py-2">
                            {Math.abs(glDistBalance) > 0.01 && (
                              <span className="text-red-600 text-xs font-medium">
                                Balance: ${fmt(Math.abs(glDistBalance))}{' '}
                                {glDistBalance > 0 ? 'under' : 'over'}
                              </span>
                            )}
                            {Math.abs(glDistBalance) <= 0.01 && newReceipt.amountReceived > 0 && (
                              <span className="text-green-600 text-xs font-medium">✓ Balanced</span>
                            )}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Open Invoices for Application */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-sm">Apply to Open Invoices</h4>
                    <button
                      onClick={handleAutoApply}
                      disabled={!newReceipt.amountReceived}
                      className="flex items-center gap-1 text-xs bg-brand-light text-brand px-3 py-1.5 rounded hover:bg-blue-200 disabled:opacity-40 font-medium"
                    >
                      <Zap className="w-3 h-3" />
                      Auto-Apply (F7)
                    </button>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-600 border-b">
                        <th className="pb-2">Invoice #</th>
                        <th className="pb-2">Date</th>
                        <th className="pb-2 text-right">Original</th>
                        <th className="pb-2 text-right">Balance Due</th>
                        <th className="pb-2 text-right w-32">Apply</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(newReceipt.applications ?? []).map((app, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2 font-mono text-xs">{app.invoiceNumber}</td>
                          <td className="py-2 text-xs">
                            {arInvoices.find((inv: any) => inv.id === app.invoiceId)?.invoiceDate}
                          </td>
                          <td className="py-2 text-right font-mono text-xs">
                            ${fmt(app.originalAmount)}
                          </td>
                          <td className="py-2 text-right font-mono text-xs">
                            ${fmt(app.balanceDue)}
                          </td>
                          <td className="py-2">
                            <input
                              type="number"
                              step="0.01"
                              value={app.applyAmount}
                              onChange={e => {
                                const updated = [...(newReceipt.applications ?? [])];
                                updated[i].applyAmount = parseFloat(e.target.value) || 0;
                                const total = updated.reduce((s, a) => s + a.applyAmount, 0);
                                setNewReceipt({
                                  ...newReceipt,
                                  applications: updated,
                                  appliedAmount: total,
                                  unappliedAmount: Math.max(
                                    0,
                                    newReceipt.amountReceived - total
                                  ),
                                });
                              }}
                              placeholder="0.00"
                              className="w-full border rounded px-2 py-1.5 text-sm text-right font-mono"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(newReceipt.applications ?? []).length === 0 && (
                    <div className="text-center text-gray-500 text-sm py-4">
                      No open invoices. Click Auto-Apply to match.
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Total Applied:</span>
                    <span className="font-mono font-medium">
                      ${fmt(newReceipt.appliedAmount || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Unapplied Balance:</span>
                    <span
                      className={`font-mono font-medium ${
                        (newReceipt.unappliedAmount ?? 0) > 0 ? 'text-amber-600' : 'text-green-600'
                      }`}
                    >
                      ${fmt(newReceipt.unappliedAmount || 0)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-4 border-t">
                  <button
                    onClick={() => {
                      setShowNewReceipt(false);
                      setNewReceipt(emptyReceipt());
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <Btn
                    onClick={handleCreateReceipt}
                    disabled={
                      !newReceipt.customerId ||
                      !newReceipt.amountReceived ||
                      Math.abs(glDistBalance) > 0.01
                    }
                    loading={createReceiptMut.isPending}
                    icon={<Check className="w-4 h-4" />}
                    shortcut="F8"
                    size="lg"
                  >
                    Post Receipt
                  </Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab 3: Customer Invoices ─────────────────────────────────────── */}
        {activeTab === 'customer-invoices' && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Invoice #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {arInvoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-gray-50" style={{ height: 36 }}>
                    <td className="px-6 py-2 text-sm font-mono">{inv.invoiceNumber}</td>
                    <td className="px-6 py-2 text-sm">{inv.customerName}</td>
                    <td className="px-6 py-2 text-sm">{inv.invoiceDate}</td>
                    <td className="px-6 py-2 text-sm font-mono text-right">${fmt(inv.amount)}</td>
                    <td className="px-6 py-2 text-sm">
                      <StatusBadge status={inv.status} />
                    </td>
                  </tr>
                ))}
                {arInvoices.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-gray-500 text-sm">
                      No customer invoices
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Tab 4: AR Aging ──────────────────────────────────────────────── */}
        {activeTab === 'ar-aging' && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                    Current
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                    30 Days
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                    60 Days
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                    90 Days
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                    90+ Days
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-gray-500 text-sm">
                    No aging data available
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ── S4-01: Daily Deposit tab ─────────────────────────────────────── */}
        {activeTab === 'daily-deposit' && (
          <DailyDepositTab receipts={cashierReceipts} />
        )}

        {/* ── S4-02: Display/Void tab ──────────────────────────────────────── */}
        {activeTab === 'display-void' && (
          <DisplayVoidTab receipts={cashierReceipts} onRefresh={() => queryClient.invalidateQueries({ queryKey: ['ar-entries'] })} />
        )}

        {/* ── S4-03: Reports tab ───────────────────────────────────────────── */}
        {activeTab === 'reports' && (
          <CashReceiptsReportsTab receipts={cashierReceipts} />
        )}
      </div>

      {/* Help Text */}
      <div className="bg-brand-light border border-brand-border rounded-lg p-4 text-sm text-blue-900">
        <p className="font-medium mb-1">Keyboard Shortcuts (Manual Entry tab):</p>
        <ul className="list-disc list-inside space-y-0.5 text-xs">
          <li>F7: Auto-apply receipt to oldest-first invoices</li>
          <li>F8: Post cash receipt (duplicate prevention enforced)</li>
        </ul>
      </div>

      {/* S4-08: Preferences Modal */}
      {showPrefs && (
        <CashReceiptPreferencesModal
          prefs={prefs}
          onSave={savePrefs}
          onClose={() => setShowPrefs(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-01: Daily Deposit Tab
// ─────────────────────────────────────────────────────────────────────────────

function DailyDepositTab({ receipts }: { receipts: any[] }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [depositDate, setDepositDate] = useState(today);
  const [bankAccount, setBankAccount] = useState('');
  const [depositRef, setDepositRef] = useState(() => {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `DEP-${d}-001`;
  });
  const [sessionStatus, setSessionStatus] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const [depositLines, setDepositLines] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const { data: glAccounts } = useQuery({
    queryKey: ['gl-accounts-clearing'],
    queryFn: () => glApi.getAccounts(),
    retry: false,
  });

  const { data: deposits } = useQuery({
    queryKey: ['deposits'],
    queryFn: () => cashReceiptApi.getDeposits(),
    retry: false,
  });

  const allocateMut = useMutation({
    mutationFn: () => cashReceiptApi.createDeposit({
      depositDate,
      bankGlAccountId: bankAccount,
      depositRef,
      receiptIds: depositLines.map((r: any) => r.id),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ar-entries', 'deposits'] });
      setSessionStatus('CLOSED');
    },
  });

  // Receipts for this deposit date not yet in deposit
  const unallocated = receipts.filter((r: any) => {
    const rDate = r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : '';
    return rDate === depositDate && !depositLines.find((d: any) => d.id === r.id);
  });

  const addToDeposit = (r: any) => setDepositLines(prev => [...prev, r]);
  const removeFromDeposit = (id: string) => setDepositLines(prev => prev.filter((r: any) => r.id !== id));

  const fmtAmt = (n: any) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

  const grouped = (list: any[]) => {
    const map: Record<string, any[]> = {};
    for (const r of list) {
      const m = r.paymentMethod ?? 'OTHER';
      (map[m] ??= []).push(r);
    }
    return map;
  };

  const depositTotal = depositLines.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  const summaryTotals = {
    cash: depositLines.filter((r: any) => r.paymentMethod === 'CASH').reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
    check: depositLines.filter((r: any) => (r.paymentMethod ?? '').includes('CHECK') || r.paymentMethod === 'MONEY_ORDER').reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
    credit: depositLines.filter((r: any) => ['VISA','MASTERCARD','AMEX','DISCOVER'].includes(r.paymentMethod ?? '')).reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
    other: depositLines.filter((r: any) => !['CASH','VISA','MASTERCARD','AMEX','DISCOVER'].includes(r.paymentMethod ?? '') && !(r.paymentMethod ?? '').includes('CHECK') && r.paymentMethod !== 'MONEY_ORDER').reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
  };

  return (
    <div className="space-y-4">
      {/* Section 1: Session Header */}
      <div className="bg-white rounded-lg shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-base">Deposit Session</h3>
          <span className="flex items-center gap-2">
            <Badge variant={sessionStatus === 'OPEN' ? 'success' : 'neutral'}>{sessionStatus}</Badge>
          </span>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Deposit Date</label>
            <input type="date" value={depositDate} onChange={e => setDepositDate(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bank Account (Clearing)</label>
            <select value={bankAccount} onChange={e => setBankAccount(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm">
              <option value="">— Select bank account —</option>
              {((glAccounts ?? []) as any[]).filter((a: any) => a.isDepositClearing).map((a: any) => (
                <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Deposit Reference #</label>
            <input type="text" value={depositRef} onChange={e => setDepositRef(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm font-mono" />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => setShowHistory(h => !h)}
              className="flex items-center gap-1.5 text-sm text-brand border border-brand-border px-3 py-2 rounded hover:bg-brand-light"
            >
              <FileText className="w-3.5 h-3.5" />
              {showHistory ? 'Hide' : 'Show'} History
            </button>
          </div>
        </div>
      </div>

      {/* Sections 2 + 3: Split panel */}
      <div className="grid grid-cols-2 gap-4">
        {/* Unallocated Receipts */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h4 className="font-semibold text-sm">Unallocated Receipts — {depositDate}</h4>
            <span className="text-xs text-gray-500">{unallocated.length} receipts</span>
          </div>
          <div className="max-h-72 overflow-auto">
            {Object.entries(grouped(unallocated)).map(([method, recs]) => (
              <div key={method}>
                <div className="px-4 py-1.5 bg-gray-50 text-xs font-semibold text-gray-500 uppercase flex justify-between">
                  <span>{method.replace(/_/g, ' ')}</span>
                  <span className="font-mono">${fmtAmt(recs.reduce((s, r) => s + Number(r.amount || 0), 0))}</span>
                </div>
                {recs.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2 border-b hover:bg-brand-light text-sm">
                    <div className="flex-1">
                      <span className="font-mono text-xs">{r.dealerRef ?? r.id?.slice(-8)}</span>
                      <span className="text-gray-500 text-xs ml-2">{r.customerName ?? '—'}</span>
                    </div>
                    <span className="font-mono text-xs mr-3">${fmtAmt(r.amount)}</span>
                    <button onClick={() => addToDeposit(r)}
                      className="text-xs bg-brand text-white px-2 py-0.5 rounded hover:bg-brand">
                      Add →
                    </button>
                  </div>
                ))}
              </div>
            ))}
            {unallocated.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-8">All receipts for this date have been added to deposit</p>
            )}
          </div>
        </div>

        {/* Current Deposit */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h4 className="font-semibold text-sm">Current Deposit</h4>
            <span className="font-mono text-sm font-bold text-brand">${fmtAmt(depositTotal)}</span>
          </div>
          <div className="max-h-72 overflow-auto">
            {depositLines.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2 border-b hover:bg-gray-50 text-sm">
                <div className="flex-1">
                  <span className="font-mono text-xs">{r.dealerRef ?? r.id?.slice(-8)}</span>
                  <span className="text-gray-500 text-xs ml-2">{r.paymentMethod?.replace(/_/g, ' ')}</span>
                </div>
                <span className="font-mono text-xs mr-3">${fmtAmt(r.amount)}</span>
                <button onClick={() => removeFromDeposit(r.id)}
                  className="text-xs text-red-500 border border-red-200 px-2 py-0.5 rounded hover:bg-red-50">
                  ← Remove
                </button>
              </div>
            ))}
            {depositLines.length === 0 && (
              <p className="text-center text-xs text-gray-400 py-8">Add receipts from the left panel</p>
            )}
          </div>
        </div>
      </div>

      {/* Section 4: Deposit Summary */}
      <div className="bg-white rounded-lg shadow p-5">
        <h4 className="font-semibold text-sm mb-4">Deposit Summary</h4>
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between border-b pb-1">
              <span className="text-gray-600">Cash</span>
              <span className="font-mono font-bold">${fmtAmt(summaryTotals.cash)}</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span className="text-gray-600">Checks / Money Orders</span>
              <span className="font-mono font-bold">${fmtAmt(summaryTotals.check)}</span>
            </div>
            {depositLines.filter((r: any) => (r.paymentMethod ?? '').includes('CHECK')).map((r: any) => (
              <div key={r.id} className="flex justify-between pl-4 text-xs text-gray-500">
                <span>#{r.checkNumber ?? '—'} {r.customerName}</span>
                <span className="font-mono">${fmtAmt(r.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between border-b pb-1">
              <span className="text-gray-600">Credit Cards</span>
              <span className="font-mono font-bold">${fmtAmt(summaryTotals.credit)}</span>
            </div>
            <div className="flex justify-between border-b pb-1">
              <span className="text-gray-600">Other</span>
              <span className="font-mono font-bold">${fmtAmt(summaryTotals.other)}</span>
            </div>
            <div className="flex justify-between pt-1 text-base font-bold">
              <span>GRAND TOTAL</span>
              <span className="font-mono text-brand">${fmtAmt(depositTotal)}</span>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Deposit Slip Reference #</label>
              <input type="text" value={depositRef} onChange={e => setDepositRef(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm font-mono" />
            </div>
            <div className="flex gap-2">
              <button className="flex items-center gap-1.5 border border-gray-300 text-gray-600 px-3 py-2 rounded text-sm hover:bg-gray-50">
                <Printer className="w-4 h-4" />
                Print Deposit Slip
              </button>
              <button
                onClick={() => allocateMut.mutate()}
                disabled={depositLines.length === 0 || !bankAccount || allocateMut.isPending || sessionStatus === 'CLOSED'}
                className="flex items-center gap-1.5 bg-brand text-white px-4 py-2 rounded text-sm font-medium hover:bg-brand disabled:opacity-40"
              >
                {allocateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {allocateMut.isPending ? 'Posting...' : 'Allocate to GL'}
              </button>
            </div>
            {allocateMut.isSuccess && (
              <p className="text-xs text-green-600">Deposit posted to GL successfully.</p>
            )}
            {allocateMut.isError && (
              <p className="text-xs text-red-600">GL allocation failed. Check bank account selection.</p>
            )}
          </div>
        </div>
      </div>

      {/* Section 5: Deposit History (collapsible) */}
      {showHistory && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h4 className="font-semibold text-sm">Deposit History</h4>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Reference</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {((deposits ?? []) as any[]).map((d: any) => (
                <tr key={d.id} className="hover:bg-gray-50" style={{ height: 36 }}>
                  <td className="px-4 py-2 text-xs">{d.depositDate ? new Date(d.depositDate).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{d.depositRef ?? d.id?.slice(-8)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(d.totalAmount ?? 0)}</td>
                  <td className="px-4 py-2">
                    <Badge variant={d.status === 'CLOSED' ? 'neutral' : 'success'}>{d.status ?? 'OPEN'}</Badge>
                  </td>
                </tr>
              ))}
              {((deposits ?? []) as any[]).length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-gray-400">No deposit history found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-02: Display / Reprint / Void Tab
// ─────────────────────────────────────────────────────────────────────────────

const VOID_REASONS = ['NSF', 'Customer Dispute', 'Posting Error', 'Other'];
const REPORT_TYPES_DV = ['Receipt Journal', 'Receipt Summary by Payment Method', 'NSF Report', 'Unapplied Receipts'];

function DisplayVoidTab({ receipts, onRefresh }: { receipts: any[]; onRefresh: () => void }) {
  const [searchReceipt, setSearchReceipt] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [sourceDocSearch, setSourceDocSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState('NSF');
  const [voidNotes, setVoidNotes] = useState('');
  const [voidDate, setVoidDate] = useState(new Date().toISOString().slice(0, 10));
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const voidMut = useMutation({
    mutationFn: ({ id, reason, notes, reversalDate }: any) =>
      aparApi.voidReceipt(id, { reason: `${reason}${notes ? ': ' + notes : ''}`, reversalDate }),
    onSuccess: () => {
      onRefresh();
      setConfirmVoid(null);
      setSelectedId(null);
      setNotification({ type: 'success', msg: 'Receipt voided and reversing GL entry created.' });
      setTimeout(() => setNotification(null), 4000);
    },
    onError: (err: any) => {
      setNotification({ type: 'error', msg: err.message ?? 'Void failed' });
    },
  });

  const fmtAmt = (n: any) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const fmtDate = (dt: string) => dt ? new Date(dt).toLocaleDateString('en-US') : '—';

  const filtered = receipts.filter((r: any) => {
    if (searchReceipt && !(r.dealerRef ?? '').toLowerCase().includes(searchReceipt.toLowerCase())) return false;
    if (dateFrom && r.dueDate && new Date(r.dueDate) < new Date(dateFrom)) return false;
    if (dateTo && r.dueDate && new Date(r.dueDate) > new Date(dateTo)) return false;
    if (customerSearch && !(r.customerName ?? '').toLowerCase().includes(customerSearch.toLowerCase())) return false;
    if (sourceDocSearch && !(r.sourceDocumentNumber ?? '').toLowerCase().includes(sourceDocSearch.toLowerCase())) return false;
    if (statusFilter === 'Active' && r.status === 'VOIDED') return false;
    if (statusFilter === 'Voided' && r.status !== 'VOIDED') return false;
    return true;
  });

  const selectedReceipt = receipts.find((r: any) => r.id === selectedId);

  return (
    <div className="space-y-4">
      {notification && (
        <div className={`px-4 py-3 rounded-lg flex items-center gap-2 text-sm ${notification.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          {notification.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {notification.msg}
        </div>
      )}

      {/* Search bar */}
      <div className="bg-white rounded-lg shadow p-4 grid grid-cols-5 gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Receipt #</label>
          <input type="text" value={searchReceipt} onChange={e => setSearchReceipt(e.target.value)}
            placeholder="Exact or partial" className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From Date</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To Date</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Customer</label>
          <input type="text" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
            placeholder="Name / number" className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Source Doc #</label>
          <input type="text" value={sourceDocSearch} onChange={e => setSourceDocSearch(e.target.value)}
            placeholder="RO# or Invoice#" className="w-full border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
            <option>All</option>
            <option>Active</option>
            <option>Voided</option>
          </select>
        </div>
      </div>

      {/* Report shortcuts */}
      <div className="flex gap-2 flex-wrap">
        {REPORT_TYPES_DV.map(rt => (
          <button key={rt} className="flex items-center gap-1.5 border border-gray-300 text-gray-600 px-3 py-1.5 rounded text-xs hover:bg-gray-50">
            <FileText className="w-3.5 h-3.5" />
            {rt}
          </button>
        ))}
      </div>

      {/* Results table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-28">Receipt #</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-24">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Customer</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-16">Source</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-28">Doc #</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase w-24">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-28">Method</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-24">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-24">Posted By</th>
              <th className="px-4 py-3 w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((r: any) => (
              <>
                <tr
                  key={r.id}
                  onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                  className={`cursor-pointer hover:bg-brand-light ${selectedId === r.id ? 'bg-brand-light' : ''} ${r.status === 'VOIDED' ? 'opacity-60' : ''}`}
                  style={{ height: 36 }}
                >
                  <td className="px-4 py-2 font-mono text-xs font-bold">{r.dealerRef ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">{fmtDate(r.dueDate ?? r.receiptDate)}</td>
                  <td className="px-4 py-2 text-xs text-gray-700">{r.customerName ?? '—'}</td>
                  <td className="px-4 py-2 text-xs"><span className="font-mono bg-gray-100 px-1.5 rounded">{r.journalSource ?? r.oemSource ?? '—'}</span></td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.sourceDocumentNumber ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(r.amount)}</td>
                  <td className="px-4 py-2 text-xs">{(r.paymentMethod ?? '—').replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2">
                    {r.status === 'VOIDED' ? (
                      <Badge variant="danger">VOID</Badge>
                    ) : r.status === 'POSTED' ? (
                      <Badge variant="success">Posted</Badge>
                    ) : (
                      <span className="text-xs text-gray-500">{r.status}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{r.cashierUserId ?? '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      {r.status !== 'VOIDED' && (
                        <button onClick={(e) => { e.stopPropagation(); setConfirmVoid(r); }}
                          className="text-xs text-red-500 border border-red-200 px-2 py-0.5 rounded hover:bg-red-50">
                          Void
                        </button>
                      )}
                      <button onClick={(e) => e.stopPropagation()}
                        className="text-xs text-gray-500 border border-gray-200 px-2 py-0.5 rounded hover:bg-gray-50">
                        <Printer className="w-3 h-3 inline" />
                      </button>
                    </div>
                  </td>
                </tr>
                {selectedId === r.id && selectedReceipt && (
                  <tr key={`detail-${r.id}`}>
                    <td colSpan={10} className="px-6 py-4 bg-brand-light border-y border-brand-border">
                      <div className="grid grid-cols-3 gap-4 text-xs">
                        <div className="space-y-1">
                          <p className="font-semibold text-gray-700 mb-2">Receipt Detail</p>
                          <p><span className="text-gray-500">Receipt #:</span> <span className="font-mono">{selectedReceipt.dealerRef ?? '—'}</span></p>
                          <p><span className="text-gray-500">Customer:</span> {selectedReceipt.customerName}</p>
                          <p><span className="text-gray-500">Amount:</span> <span className="font-mono">${fmtAmt(selectedReceipt.amount)}</span></p>
                          <p><span className="text-gray-500">Method:</span> {(selectedReceipt.paymentMethod ?? '').replace(/_/g, ' ')}</p>
                          {selectedReceipt.checkNumber && <p><span className="text-gray-500">Check #:</span> <span className="font-mono">{selectedReceipt.checkNumber}</span></p>}
                          {selectedReceipt.remarks && <p><span className="text-gray-500">Remarks:</span> {selectedReceipt.remarks}</p>}
                        </div>
                        <div className="space-y-1">
                          <p className="font-semibold text-gray-700 mb-2">Source Information</p>
                          <p><span className="text-gray-500">Journal Source:</span> <span className="font-mono">{selectedReceipt.journalSource ?? selectedReceipt.oemSource ?? '—'}</span></p>
                          <p><span className="text-gray-500">Doc Type:</span> {selectedReceipt.sourceDocumentType ?? '—'}</p>
                          <p><span className="text-gray-500">Doc #:</span> <span className="font-mono">{selectedReceipt.sourceDocumentNumber ?? '—'}</span></p>
                          <p><span className="text-gray-500">Cashier:</span> {selectedReceipt.cashierUserId ?? '—'}</p>
                        </div>
                        {selectedReceipt.status === 'VOIDED' && (
                          <div className="space-y-1 bg-red-50 rounded p-3 border border-red-200">
                            <p className="font-semibold text-red-700 mb-2">Void Information</p>
                            <p><span className="text-gray-500">Void Date:</span> {fmtDate(selectedReceipt.voidedAt)}</p>
                            <p><span className="text-gray-500">Void Reason:</span> {selectedReceipt.voidReason}</p>
                            <p><span className="text-gray-500">Voided By:</span> {selectedReceipt.voidedBy ?? '—'}</p>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button className="flex items-center gap-1.5 text-xs border border-gray-300 text-gray-600 px-3 py-1.5 rounded hover:bg-gray-50">
                          <Printer className="w-3.5 h-3.5" />
                          Reprint Receipt
                        </button>
                        <button className="flex items-center gap-1.5 text-xs border border-blue-300 text-brand px-3 py-1.5 rounded hover:bg-brand-light">
                          <FileText className="w-3.5 h-3.5" />
                          View GL Impact
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-gray-400">No receipts match the search criteria</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Void confirmation dialog */}
      {confirmVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] p-6 space-y-4">
            <h3 className="font-bold text-lg text-red-700 flex items-center gap-2">
              <Ban className="w-5 h-5" />
              Void Receipt {confirmVoid.dealerRef}?
            </h3>
            <p className="text-sm text-gray-600">
              A reversing GL entry will be created. The receipt will be marked VOIDED.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Void Reason <span className="text-red-500">*</span></label>
              <select value={voidReason} onChange={e => setVoidReason(e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                {VOID_REASONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Additional Notes</label>
              <textarea value={voidNotes} onChange={e => setVoidNotes(e.target.value)} rows={2} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reversal Date</label>
              <input type="date" value={voidDate} onChange={e => setVoidDate(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmVoid(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => voidMut.mutate({ id: confirmVoid.id, reason: voidReason, notes: voidNotes, reversalDate: voidDate })}
                disabled={voidMut.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                {voidMut.isPending ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-03: Cash Receipts Reports Tab
// ─────────────────────────────────────────────────────────────────────────────

type ReportType = 'payment-tracking' | 'daily-summary' | 'monthly-summary' | 'customer-history';

function CashReceiptsReportsTab({ receipts }: { receipts: any[] }) {
  const [reportType, setReportType] = useState<ReportType>('payment-tracking');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [methodFilter, setMethodFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [customerFilter, setCustomerFilter] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [reportMonth, setReportMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const fmtAmt = (n: any) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  const fmtDate = (dt: string) => dt ? new Date(dt).toLocaleDateString('en-US') : '—';

  // Filter helpers
  const applyFilters = (list: any[]) => list.filter((r: any) => {
    if (dateFrom && r.dueDate && new Date(r.dueDate) < new Date(dateFrom)) return false;
    if (dateTo && r.dueDate && new Date(r.dueDate) > new Date(dateTo)) return false;
    if (methodFilter !== 'ALL' && r.paymentMethod !== methodFilter) return false;
    if (sourceFilter !== 'ALL' && r.journalSource !== sourceFilter && r.oemSource !== sourceFilter) return false;
    if (customerFilter && !(r.customerName ?? '').toLowerCase().includes(customerFilter.toLowerCase())) return false;
    return true;
  });

  const reportData = applyFilters(receipts);

  // Daily summary grouping
  const dailySummary = useMemo(() => {
    const d = new Date(reportDate);
    const dayReceipts = receipts.filter((r: any) => {
      if (!r.dueDate) return false;
      const rd = new Date(r.dueDate).toISOString().slice(0, 10);
      return rd === reportDate;
    });
    const byMethod: Record<string, { count: number; total: number }> = {};
    for (const r of dayReceipts) {
      const m = r.paymentMethod ?? 'OTHER';
      if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
      byMethod[m].count++;
      byMethod[m].total += Number(r.amount || 0);
    }
    return byMethod;
  }, [receipts, reportDate]);

  // Monthly summary grouping
  const monthlySummary = useMemo(() => {
    const [yr, mo] = reportMonth.split('-').map(Number);
    const days: Record<string, any> = {};
    for (const r of receipts) {
      if (!r.dueDate) continue;
      const rd = new Date(r.dueDate);
      if (rd.getFullYear() !== yr || rd.getMonth() + 1 !== mo) continue;
      const key = rd.toISOString().slice(0, 10);
      if (!days[key]) days[key] = { date: key, count: 0, cash: 0, check: 0, credit: 0, other: 0 };
      days[key].count++;
      const amt = Number(r.amount || 0);
      const m = r.paymentMethod ?? '';
      if (m === 'CASH') days[key].cash += amt;
      else if (m.includes('CHECK') || m === 'MONEY_ORDER') days[key].check += amt;
      else if (['VISA','MASTERCARD','AMEX','DISCOVER'].includes(m)) days[key].credit += amt;
      else days[key].other += amt;
    }
    return Object.values(days).sort((a, b) => a.date.localeCompare(b.date));
  }, [receipts, reportMonth]);

  const handleExportCSV = () => {
    const rows = reportData.map((r: any) => [r.dueDate, r.dealerRef, r.customerName, r.paymentMethod, r.checkNumber, r.amount, r.journalSource, r.sourceDocumentNumber, r.status].join(','));
    const csv = ['Date,Receipt#,Customer,Method,Check#,Amount,Source,DocNumber,Status', ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'receipts.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Report Selector */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex gap-3 flex-wrap">
          {([
            { id: 'payment-tracking', label: 'Payment Tracking' },
            { id: 'daily-summary', label: 'Daily Summary' },
            { id: 'monthly-summary', label: 'Monthly Summary' },
            { id: 'customer-history', label: 'Customer History' },
          ] as { id: ReportType; label: string }[]).map(r => (
            <label key={r.id} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="report-type" value={r.id} checked={reportType === r.id}
                onChange={() => setReportType(r.id)} className="text-brand" />
              <span className={`text-sm font-medium ${reportType === r.id ? 'text-brand' : 'text-gray-700'}`}>{r.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Parameters */}
      <div className="bg-white rounded-lg shadow p-4 flex gap-3 flex-wrap items-end">
        {(reportType === 'payment-tracking' || reportType === 'customer-history') && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded px-3 py-2 text-sm" />
            </div>
          </>
        )}
        {reportType === 'payment-tracking' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
              <select value={methodFilter} onChange={e => setMethodFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
                <option value="ALL">All Methods</option>
                {PAYMENT_METHODS.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
              <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
                <option value="ALL">All</option>
                <option value="30">Service (30)</option>
                <option value="32">Parts (32)</option>
                <option value="56">Manual (56)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Customer</label>
              <input type="text" value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
                placeholder="Filter by customer" className="border rounded px-3 py-2 text-sm" />
            </div>
          </>
        )}
        {reportType === 'daily-summary' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="border rounded px-3 py-2 text-sm" />
          </div>
        )}
        {reportType === 'monthly-summary' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
            <input type="month" value={reportMonth} onChange={e => setReportMonth(e.target.value)} className="border rounded px-3 py-2 text-sm" />
          </div>
        )}
        {reportType === 'customer-history' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Customer</label>
            <input type="text" value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}
              placeholder="Customer name or number" className="border rounded px-3 py-2 text-sm w-48" />
          </div>
        )}
        <div className="flex gap-2 self-end ml-auto">
          <button className="flex items-center gap-1.5 border border-gray-300 text-gray-600 px-3 py-2 rounded text-sm hover:bg-gray-50">
            <Printer className="w-4 h-4" />
            Print
          </button>
          <button onClick={handleExportCSV} className="flex items-center gap-1.5 border border-gray-300 text-gray-600 px-3 py-2 rounded text-sm hover:bg-gray-50">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Report Output */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {/* Payment Tracking Report */}
        {reportType === 'payment-tracking' && (
          <>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Receipt #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Method</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Check #</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Doc #</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reportData.map((r: any) => (
                  <tr key={r.id} style={{ height: 36 }} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs">{fmtDate(r.dueDate)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.dealerRef ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{r.customerName ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{(r.paymentMethod ?? '—').replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.checkNumber ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(r.amount)}</td>
                    <td className="px-4 py-2 text-xs"><span className="font-mono bg-gray-100 px-1.5 rounded">{r.journalSource ?? r.oemSource ?? '—'}</span></td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.sourceDocumentNumber ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{r.status}</td>
                  </tr>
                ))}
                {reportData.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">No receipts match the selected filters</td></tr>
                )}
              </tbody>
              {reportData.length > 0 && (
                <tfoot className="bg-gray-50 border-t font-semibold">
                  <tr>
                    <td colSpan={5} className="px-4 py-2 text-xs text-gray-600">{reportData.length} receipt{reportData.length !== 1 ? 's' : ''}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-brand">
                      ${fmtAmt(reportData.reduce((s: number, r: any) => s + Number(r.amount || 0), 0))}
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </>
        )}

        {/* Daily Summary Report */}
        {reportType === 'daily-summary' && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Payment Method</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Count</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Object.entries(dailySummary).map(([m, data]) => (
                <tr key={m} style={{ height: 36 }}>
                  <td className="px-4 py-2 text-sm">{m.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 text-right text-sm">{data.count}</td>
                  <td className="px-4 py-2 text-right font-mono text-sm">${fmtAmt(data.total)}</td>
                </tr>
              ))}
              {Object.keys(dailySummary).length === 0 && (
                <tr><td colSpan={3} className="px-4 py-10 text-center text-sm text-gray-400">No receipts for {reportDate}</td></tr>
              )}
            </tbody>
            {Object.keys(dailySummary).length > 0 && (
              <tfoot className="bg-gray-50 border-t font-bold">
                <tr>
                  <td className="px-4 py-2 text-sm">Grand Total</td>
                  <td className="px-4 py-2 text-right text-sm">{Object.values(dailySummary).reduce((s, d) => s + d.count, 0)}</td>
                  <td className="px-4 py-2 text-right font-mono text-sm text-brand">
                    ${fmtAmt(Object.values(dailySummary).reduce((s, d) => s + d.total, 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        )}

        {/* Monthly Summary Report */}
        {reportType === 'monthly-summary' && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Count</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Cash</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Check</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Credit Card</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Other</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Daily Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {monthlySummary.map((d: any) => (
                <tr key={d.date} style={{ height: 36 }} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs">{fmtDate(d.date)}</td>
                  <td className="px-4 py-2 text-right text-xs">{d.count}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(d.cash)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(d.check)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(d.credit)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(d.other)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs font-bold">${fmtAmt(d.cash + d.check + d.credit + d.other)}</td>
                </tr>
              ))}
              {monthlySummary.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">No receipts for {reportMonth}</td></tr>
              )}
            </tbody>
            {monthlySummary.length > 0 && (
              <tfoot className="bg-gray-50 border-t font-bold">
                <tr>
                  <td className="px-4 py-2 text-xs">Monthly Total</td>
                  <td className="px-4 py-2 text-right text-xs">{monthlySummary.reduce((s: number, d: any) => s + d.count, 0)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(monthlySummary.reduce((s: number, d: any) => s + d.cash, 0))}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(monthlySummary.reduce((s: number, d: any) => s + d.check, 0))}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(monthlySummary.reduce((s: number, d: any) => s + d.credit, 0))}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(monthlySummary.reduce((s: number, d: any) => s + d.other, 0))}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-brand">
                    ${fmtAmt(monthlySummary.reduce((s: number, d: any) => s + d.cash + d.check + d.credit + d.other, 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        )}

        {/* Customer Payment History Report */}
        {reportType === 'customer-history' && (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Receipt #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Invoice Applied</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Method</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reportData.map((r: any) => (
                <tr key={r.id} style={{ height: 36 }} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs">{fmtDate(r.dueDate)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.dealerRef ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{r.sourceDocumentNumber ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">{(r.paymentMethod ?? '—').replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">${fmtAmt(r.amount)}</td>
                </tr>
              ))}
              {reportData.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                  {customerFilter ? `No payment history for "${customerFilter}"` : 'Enter a customer name to search'}
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// S4-08: Cash Receipt Preferences Modal
// ─────────────────────────────────────────────────────────────────────────────

function CashReceiptPreferencesModal({
  prefs,
  onSave,
  onClose,
}: {
  prefs: Record<string, any>;
  onSave: (p: Record<string, any>) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Record<string, any>>({ ...prefs });
  const set = (key: string, val: any) => setLocal(prev => ({ ...prev, [key]: val }));

  const { data: glAccounts } = useQuery({
    queryKey: ['gl-accounts-clearing'],
    queryFn: () => glApi.getAccounts(),
    retry: false,
  });
  const { data: sources } = useQuery({
    queryKey: ['gl-sources'],
    queryFn: () => glApi.getSources(),
    retry: false,
  });

  const handleSave = () => {
    onSave(local);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[480px] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Settings className="w-5 h-5 text-brand" />
            Cash Receipt Preferences
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Default Bank Account (Clearing)</label>
            <select value={local.defaultBankAccount ?? ''} onChange={e => set('defaultBankAccount', e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm">
              <option value="">— None —</option>
              {((glAccounts ?? []) as any[]).filter((a: any) => a.isDepositClearing).map((a: any) => (
                <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Default Payment Method</label>
            <select value={local.defaultPaymentMethod ?? 'PERSONAL_CHECK'} onChange={e => set('defaultPaymentMethod', e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm">
              {PAYMENT_METHODS.map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Default Journal Source (Manual Entries)</label>
            <select value={local.defaultJournalSource ?? '56'} onChange={e => set('defaultJournalSource', e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm">
              <option value="56">56 — Manual Cash Receipts</option>
              {((sources ?? []) as any[]).map((s: any) => (
                <option key={s.id} value={s.sourceCode}>{s.sourceCode} — {s.sourceName}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Receipt Numbering Prefix (max 3 chars)</label>
            <input
              type="text"
              value={local.receiptPrefix ?? 'RCP'}
              onChange={e => set('receiptPrefix', e.target.value.toUpperCase().slice(0, 3))}
              maxLength={3}
              className="w-full border rounded px-3 py-2 text-sm font-mono"
            />
          </div>

          <div className="space-y-3 pt-1">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={local.autoPrintOnPost ?? false} onChange={e => set('autoPrintOnPost', e.target.checked)} className="rounded" />
              <span className="text-sm">Auto-print receipt on post</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={local.showGlOnPost ?? true} onChange={e => set('showGlOnPost', e.target.checked)} className="rounded" />
              <span className="text-sm">Show GL distribution on post confirmation</span>
            </label>
          </div>
        </div>

        <div className="flex gap-3 justify-end border-t pt-4">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand">
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
}
