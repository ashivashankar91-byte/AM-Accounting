import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertCircle, Check, Loader2, Save, Plus, CheckCircle, XCircle, Clock, Ban } from 'lucide-react';
import { aparApi, glApi, purchaseOrderApi } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import DataTable, { Column } from '../../components/DataTable';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, PageHeader, Badge } from '../../components/ui';
import SalesTaxAccrual from '../../components/SalesTaxAccrual';
import ContractorReports1099 from '../../components/ContractorReports1099';

// TypeScript Interfaces
interface APInvoice {
  id: string;
  vendorId: string;
  vendorName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  /// S2-06: expanded status set
  status: 'Pending' | 'Approved' | 'Rejected' | 'Hold' | 'PARTIAL' | 'PAID' | 'VOID';
  paidAmount?: number;
  glLines?: APGLLine[];
  paymentType?: string;
  /// S2-07: payment fields
  checkNumber?: string;
  checkDate?: string;
  paidDate?: string;
  poNumber?: string;
  holdFlag?: boolean;
  note?: string;
}

interface APGLLine {
  id?: string;
  accountCode: string;
  description: string;
  amount: number;
}

interface CheckRun {
  paymentDate: string;
  bankAccount: string;
  paymentMethod: 'Check' | 'ACH' | 'Wire' | 'Other';
  vendorRange?: { from?: string; to?: string };
  dueDateCutoff: string;
  selectedInvoices: string[];
  totalAmount: number;
}

type TabType = 'invoice-entry' | 'approval-queue' | 'check-run' | 'void-checks' | 'ap-aging' | 'check-register' | 'sales-tax' | '1099-reports' | 'ap-reports';
type UIState = 'idle' | 'loading' | 'success' | 'error' | 'empty' | 'editing' | 'posting' | 'duplicate-detected';

const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// S1-01: Aging helper — uses dueDate (not invoiceDate)
const getDaysOverdue = (dueDate: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000));

const getAgingBucket = (days: number): string => {
  if (days === 0) return 'Current';
  if (days <= 30) return '1–30';
  if (days <= 60) return '31–60';
  if (days <= 90) return '61–90';
  return '90+';
};

export default function AccountsPayable() {
  const queryClient = useQueryClient();

  // State
  const [activeTab, setActiveTab] = useState<TabType>('invoice-entry');
  const [uiState, setUiState] = useState<UIState>('idle');
  const [invoices, setInvoices] = useState<APInvoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<APInvoice | null>(null);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [duplicateAlert, setDuplicateAlert] = useState<string | null>(null);

  // New Invoice Form State
  const [newInvoice, setNewInvoice] = useState({
    vendorId: '',
    vendorName: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    amount: 0,
    paymentType: 'Check',
    poNumber: '',
    holdFlag: false,
    note: '',
    glLines: [{ accountCode: '', description: '', amount: 0 }] as APGLLine[],
  });

  // Check Run Form State
  const [checkRun, setCheckRun] = useState<CheckRun>({
    paymentDate: new Date().toISOString().slice(0, 10),
    bankAccount: '',
    paymentMethod: 'Check',
    dueDateCutoff: new Date().toISOString().slice(0, 10),
    selectedInvoices: [],
    totalAmount: 0,
  });

  // Queries
  const { data: apData, isLoading, error, refetch } = useQuery({
    queryKey: ['ap-invoices'],
    queryFn: aparApi.getAP,
    retry: false,
  });

  const { data: accounts } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn: glApi.getAccounts,
    retry: false,
  });

  // Mutations
  const createInvoiceMut = useMutation({
    mutationFn: (data: any) => aparApi.createAP(data),
    onSuccess: () => {
      setUiState('success');
      queryClient.invalidateQueries({ queryKey: ['ap-invoices'] });
      setShowNewInvoice(false);
      setNewInvoice({
        vendorId: '',
        vendorName: '',
        invoiceNumber: '',
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        amount: 0,
        paymentType: 'Check',
        poNumber: '',
        holdFlag: false,
        note: '',
        glLines: [{ accountCode: '', description: '', amount: 0 }],
      });
      setTimeout(() => setUiState('idle'), 2000);
    },
    onError: (err: any) => {
      setUiState('error');
    },
  });

  const createPaymentMut = useMutation({
    mutationFn: (data: any) => aparApi.createAP(data),
    onSuccess: () => {
      setUiState('success');
      queryClient.invalidateQueries({ queryKey: ['ap-invoices'] });
      setTimeout(() => setUiState('idle'), 2000);
    },
    onError: (err: any) => {
      setUiState('error');
    },
  });

  // S7-03: ACH generation state + mutation
  const [achError, setAchError] = useState<string | null>(null);
  const achMut = useMutation({
    mutationFn: (data: { bankAccountId: string; paymentIds: string[] }) =>
      aparApi.generateAch(data),
    onSuccess: (result: any) => {
      setAchError(null);
      // Trigger file download
      const blob = new Blob([result.nachContent ?? result], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ach-${checkRun.paymentDate}.ach`;
      a.click();
      URL.revokeObjectURL(url);
      queryClient.invalidateQueries({ queryKey: ['ap-invoices'] });
    },
    onError: (err: any) => setAchError(err.message ?? 'ACH generation failed'),
  });

  function handleGenerateAch() {
    setAchError(null);
    if (!checkRun.bankAccount) {
      setAchError('Please select a bank account.');
      return;
    }
    if (checkRun.selectedInvoices.length === 0) {
      setAchError('No invoices selected.');
      return;
    }
    achMut.mutate({ bankAccountId: checkRun.bankAccount, paymentIds: checkRun.selectedInvoices });
  }

  // Check for duplicates
  const checkDuplicate = (vendorId: string, invoiceNumber: string) => {
    const existing = (apData ?? []).find(
      (inv: any) => inv.vendorId === vendorId && inv.invoiceNumber === invoiceNumber && inv.status !== 'Rejected'
    );
    if (existing) {
      setDuplicateAlert(`Invoice ${invoiceNumber} already exists for this vendor`);
      setUiState('duplicate-detected');
      return true;
    }
    return false;
  };

  // GL Line management
  const addGLLine = () => {
    setNewInvoice({
      ...newInvoice,
      glLines: [...newInvoice.glLines, { accountCode: '', description: '', amount: 0 }],
    });
  };

  const removeGLLine = (i: number) => {
    if (newInvoice.glLines.length > 1) {
      setNewInvoice({
        ...newInvoice,
        glLines: newInvoice.glLines.filter((_, idx) => idx !== i),
      });
    }
  };

  const updateGLLine = (i: number, field: keyof APGLLine, val: any) => {
    const updated = [...newInvoice.glLines];
    updated[i] = { ...updated[i], [field]: val };
    setNewInvoice({ ...newInvoice, glLines: updated });
  };

  const totalGLAmount = newInvoice.glLines.reduce((sum, line) => sum + line.amount, 0);

  const handleCreateInvoice = () => {
    if (!newInvoice.vendorId || !newInvoice.invoiceNumber) {
      setDuplicateAlert('Vendor and Invoice Number are required');
      setUiState('duplicate-detected');
      return;
    }
    if (checkDuplicate(newInvoice.vendorId, newInvoice.invoiceNumber)) {
      return;
    }
    setUiState('posting');
    createInvoiceMut.mutate({
      vendorId: newInvoice.vendorId,
      vendorName: newInvoice.vendorName,
      invoiceNumber: newInvoice.invoiceNumber,
      invoiceDate: newInvoice.invoiceDate,
      dueDate: newInvoice.dueDate,
      amount: newInvoice.amount,
      paymentType: newInvoice.paymentType,
      glLines: newInvoice.glLines.filter(l => l.accountCode && l.amount > 0),
    });
  };

  const handlePaymentBatch = () => {
    if (checkRun.selectedInvoices.length === 0) {
      setDuplicateAlert('Select invoices to pay');
      setUiState('duplicate-detected');
      return;
    }
    setUiState('posting');
    createPaymentMut.mutate({
      paymentDate: checkRun.paymentDate,
      bankAccount: checkRun.bankAccount,
      paymentMethod: checkRun.paymentMethod,
      invoiceIds: checkRun.selectedInvoices,
      totalAmount: checkRun.totalAmount,
    });
  };

  if (isLoading) {
    return <PageLoader page="Accounts Payable" service="apar-service" port={3013} />;
  }

  if (error) {
    return <PageError error={error} serviceName="AP/AR Service" port={3013} retry={refetch} />;
  }

  const apInvoices = (apData ?? []) as APInvoice[];
  const pendingApprovals = apInvoices.filter((inv: any) => inv.status === 'Pending');
  const totalOutstanding = apInvoices.reduce((sum: number, inv: any) => {
    if (inv.status !== 'Paid') return sum + (inv.amount - (inv.paidAmount ?? 0));
    return sum;
  }, 0);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <PageHeader
        title="Accounts Payable (WF-A002)"
        subtitle="Manage vendor invoices, approvals, and payment processing."
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
          <span>Operation completed successfully</span>
        </div>
      )}

      {uiState === 'duplicate-detected' && duplicateAlert && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          <span>{duplicateAlert}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Total Invoices</p>
          <p className="text-2xl font-bold">{apInvoices.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Pending Approval</p>
          <p className="text-2xl font-bold text-amber-600">{pendingApprovals.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Outstanding</p>
          <p className="text-2xl font-bold text-red-600">${fmt(totalOutstanding)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-600">Paid This Month</p>
          <p className="text-2xl font-bold text-green-600">
            {apInvoices.filter((inv: any) => inv.status === 'Paid').length}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-8">
          {(['invoice-entry', 'approval-queue', 'check-run', 'void-checks', 'ap-aging', 'check-register', 'sales-tax', '1099-reports', 'ap-reports'] as TabType[]).map(
            (tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 text-brand'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab === 'invoice-entry' && 'Invoice Entry'}
                {tab === 'approval-queue' && 'Approval Queue'}
                {tab === 'check-run' && 'Check Run'}
                {tab === 'void-checks' && 'Void Checks'}
                {tab === 'ap-aging' && 'AP Aging'}
                {tab === 'ap-reports' && 'AP Reports'}
                {tab === 'check-register' && 'Check Register'}
                {tab === 'sales-tax' && 'Sales Tax'}
                {tab === '1099-reports' && '1099 Reports'}
              </button>
            )
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-4">
        {/* Invoice Entry Tab */}
        {activeTab === 'invoice-entry' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Btn
                variant="primary"
                size="md"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setShowNewInvoice(!showNewInvoice)}
              >
                New Invoice
              </Btn>
            </div>

            {showNewInvoice && (
              <div className="bg-white rounded-lg shadow p-6 space-y-4 border-l-4 border-blue-500">
                <h3 className="font-semibold text-lg">New Invoice Entry</h3>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                    <input
                      type="text"
                      value={newInvoice.vendorName}
                      onChange={e => setNewInvoice({ ...newInvoice, vendorName: e.target.value, vendorId: e.target.value })}
                      placeholder="Search or select vendor..."
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Invoice #</label>
                    <input
                      type="text"
                      value={newInvoice.invoiceNumber}
                      onChange={e => setNewInvoice({ ...newInvoice, invoiceNumber: e.target.value })}
                      placeholder="INV-001"
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date</label>
                    <input
                      type="date"
                      value={newInvoice.invoiceDate}
                      onChange={e => setNewInvoice({ ...newInvoice, invoiceDate: e.target.value })}
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                    <input
                      type="date"
                      value={newInvoice.dueDate}
                      onChange={e => setNewInvoice({ ...newInvoice, dueDate: e.target.value })}
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newInvoice.amount}
                      onChange={e => setNewInvoice({ ...newInvoice, amount: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                      className="w-full border rounded px-3 py-2 text-sm text-right font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Payment Type</label>
                    <select
                      value={newInvoice.paymentType}
                      onChange={e => setNewInvoice({ ...newInvoice, paymentType: e.target.value })}
                      className="w-full border rounded px-3 py-2 text-sm"
                    >
                      <option value="Check">Check</option>
                      <option value="ACH">ACH</option>
                      <option value="Wire">Wire</option>
                    </select>
                  </div>
                </div>

                {/* S2-07: Additional AP fields */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">PO Number</label>
                    <input
                      type="text"
                      value={newInvoice.poNumber}
                      onChange={e => setNewInvoice({ ...newInvoice, poNumber: e.target.value })}
                      placeholder="Optional"
                      className="w-full border rounded px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
                    <input
                      type="text"
                      value={newInvoice.note}
                      onChange={e => setNewInvoice({ ...newInvoice, note: e.target.value })}
                      placeholder="Optional note..."
                      className="w-full border rounded px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newInvoice.holdFlag}
                        onChange={e => setNewInvoice({ ...newInvoice, holdFlag: e.target.checked })}
                        className="w-4 h-4 accent-amber-500"
                      />
                      <span className="text-sm font-medium text-amber-700">Hold — Prevent Payment</span>
                    </label>
                  </div>
                </div>

                {/* GL Distribution Lines */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-sm">GL Distribution (must equal invoice amount)</h4>
                    <button
                      onClick={addGLLine}
                      className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200"
                    >
                      + Add Line
                    </button>
                  </div>

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-600 border-b">
                        <th className="pb-2">GL Account</th>
                        <th className="pb-2">Description</th>
                        <th className="pb-2 text-right w-32">Amount</th>
                        <th className="pb-2 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {newInvoice.glLines.map((line, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2 pr-2">
                            <select
                              value={line.accountCode}
                              onChange={e => updateGLLine(i, 'accountCode', e.target.value)}
                              className="w-full border rounded px-2 py-1.5 text-sm"
                            >
                              <option value="">Select...</option>
                              {(accounts ?? []).map((a: any) => (
                                <option key={a.id} value={a.code}>
                                  {a.code} — {a.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-2">
                            <input
                              type="text"
                              value={line.description}
                              onChange={e => updateGLLine(i, 'description', e.target.value)}
                              placeholder="Description"
                              className="w-full border rounded px-2 py-1.5 text-sm"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <input
                              type="number"
                              step="0.01"
                              value={line.amount}
                              onChange={e => updateGLLine(i, 'amount', parseFloat(e.target.value) || 0)}
                              placeholder="0.00"
                              className="w-full border rounded px-2 py-1.5 text-sm text-right font-mono"
                            />
                          </td>
                          <td className="py-2">
                            {newInvoice.glLines.length > 1 && (
                              <button
                                onClick={() => removeGLLine(i)}
                                className="text-red-400 hover:text-red-600 text-xs"
                              >
                                ✕
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 font-bold bg-gray-50">
                        <td colSpan={2} className="py-3 text-right pr-4">Total:</td>
                        <td className={`py-3 text-right font-mono pr-2 ${Math.abs(totalGLAmount - newInvoice.amount) > 0.01 ? 'text-red-600' : 'text-green-600'}`}>
                          ${fmt(totalGLAmount)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>

                  {Math.abs(totalGLAmount - newInvoice.amount) > 0.01 && (
                    <div className="mt-2 p-3 bg-red-50 border border-red-300 rounded text-sm text-red-700 font-medium">
                      Distribution total (${fmt(totalGLAmount)}) does not equal invoice total (${fmt(newInvoice.amount)}).{' '}
                      Difference: ${fmt(Math.abs(totalGLAmount - newInvoice.amount))}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 justify-end pt-4 border-t">
                  <button
                    onClick={() => setShowNewInvoice(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateInvoice}
                    disabled={createInvoiceMut.isPending || Math.abs(totalGLAmount - newInvoice.amount) > 0.01}
                    className="flex items-center gap-2 px-6 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-40"
                  >
                    {createInvoiceMut.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Submit Invoice
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Approval Queue Tab */}
        {activeTab === 'approval-queue' && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Vendor</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Invoice #</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Inv. Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Due Date</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase">Days Past Due</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Aging</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {pendingApprovals.map((inv) => {
                  const daysOverdue = getDaysOverdue(inv.dueDate);
                  const agingBucket = getAgingBucket(daysOverdue);
                  const isPastDue = daysOverdue > 0;
                  return (
                    <tr key={inv.id} className={`hover:bg-gray-50 ${isPastDue ? 'bg-red-50/30' : ''}`}>
                      <td className="px-6 py-4 text-sm">{inv.vendorName}</td>
                      <td className="px-6 py-4 text-sm font-mono">{inv.invoiceNumber}</td>
                      <td className="px-6 py-4 text-sm font-mono text-right">${fmt(inv.amount)}</td>
                      <td className="px-6 py-4 text-sm">{inv.invoiceDate}</td>
                      <td className={`px-6 py-4 text-sm ${isPastDue ? 'text-red-700 font-medium' : ''}`}>{inv.dueDate}</td>
                      <td className={`px-6 py-4 text-sm text-right font-mono ${isPastDue ? 'text-red-700 font-bold' : 'text-gray-400'}`}>
                        {daysOverdue > 0 ? `+${daysOverdue}` : '—'}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <Badge variant={
                          agingBucket === 'Current' ? 'success' :
                          agingBucket === '1–30'    ? 'warning' :
                          agingBucket === '31–60'   ? 'warning' :
                                                     'danger'
                        }>{agingBucket}</Badge>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <Badge variant={
                          inv.status === 'Approved' || inv.status === 'PAID'   ? 'success' :
                          inv.status === 'PARTIAL'                             ? 'warning' :
                          inv.status === 'Rejected' || inv.status === 'VOID'  ? 'neutral' :
                          inv.status === 'Hold'                                ? 'danger'  :
                                                                                 'warning'
                        }>{inv.status}</Badge>
                      </td>
                      <td className="px-6 py-4 text-sm flex gap-2">
                        <button className="text-green-600 hover:text-green-800 text-xs font-medium">
                          Approve
                        </button>
                        <button className="text-red-600 hover:text-red-800 text-xs font-medium">
                          Reject
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pendingApprovals.length === 0 && (
              <div className="px-6 py-8 text-center text-gray-500">
                No invoices pending approval
              </div>
            )}
          </div>
        )}

        {/* Check Run Tab */}
        {activeTab === 'check-run' && (
          <div className="space-y-4">
            <div className="bg-white rounded-lg shadow p-6 space-y-4">
              <h3 className="font-semibold">Check Run Setup</h3>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                  <input
                    type="date"
                    value={checkRun.paymentDate}
                    onChange={e => setCheckRun({ ...checkRun, paymentDate: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account</label>
                  <select
                    value={checkRun.bankAccount}
                    onChange={e => setCheckRun({ ...checkRun, bankAccount: e.target.value })}
                    className="w-full border rounded px-3 py-2 text-sm"
                  >
                    <option value="">Select bank account...</option>
                    <option value="1010">1010 - Checking</option>
                    <option value="1020">1020 - Money Market</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                  <select
                    value={checkRun.paymentMethod}
                    onChange={e => setCheckRun({ ...checkRun, paymentMethod: e.target.value as any })}
                    className="w-full border rounded px-3 py-2 text-sm"
                  >
                    <option value="Check">Check</option>
                    <option value="ACH">ACH</option>
                    <option value="Wire">Wire</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date Cutoff</label>
                <input
                  type="date"
                  value={checkRun.dueDateCutoff}
                  onChange={e => setCheckRun({ ...checkRun, dueDateCutoff: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm"
                />
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium text-sm mb-3">Select Invoices to Pay</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600 border-b">
                      <th className="pb-2 w-6">
                        <input type="checkbox" className="w-4 h-4" />
                      </th>
                      <th className="pb-2">Vendor</th>
                      <th className="pb-2">Invoice #</th>
                      <th className="pb-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apInvoices
                      .filter((inv: any) => inv.status === 'Approved')
                      .map((inv) => (
                        <tr key={inv.id} className="border-b border-gray-50">
                          <td className="py-2">
                            <input
                              type="checkbox"
                              className="w-4 h-4"
                              onChange={e => {
                                const selected = e.target.checked
                                  ? [...checkRun.selectedInvoices, inv.id]
                                  : checkRun.selectedInvoices.filter(id => id !== inv.id);
                                const total = apInvoices
                                  .filter((i: any) => selected.includes(i.id))
                                  .reduce((sum: number, i: any) => sum + i.amount, 0);
                                setCheckRun({
                                  ...checkRun,
                                  selectedInvoices: selected,
                                  totalAmount: total,
                                });
                              }}
                            />
                          </td>
                          <td className="py-2">{inv.vendorName}</td>
                          <td className="py-2 font-mono">{inv.invoiceNumber}</td>
                          <td className="py-2 text-right font-mono">${fmt(inv.amount)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* S7-03: ACH error banner */}
              {achError && (
                <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
                  {achError}
                </div>
              )}
              <div className="flex items-center justify-between pt-4 border-t">
                <div className="text-sm">
                  <span className="font-medium">Total to Pay:</span>
                  <span className="font-mono ml-2 text-lg">${fmt(checkRun.totalAmount)}</span>
                </div>
                {checkRun.paymentMethod === 'ACH' ? (
                  <button
                    onClick={handleGenerateAch}
                    disabled={checkRun.selectedInvoices.length === 0 || achMut.isPending}
                    className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40"
                  >
                    {achMut.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating ACH...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Generate ACH File
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handlePaymentBatch}
                    disabled={checkRun.selectedInvoices.length === 0 || createPaymentMut.isPending}
                    className="flex items-center gap-2 px-6 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-40"
                  >
                    {createPaymentMut.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Process Payment Batch
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sales Tax Tab */}
        {activeTab === 'sales-tax' && <SalesTaxAccrual />}

        {/* 1099 Reports Tab — S6-08: FIRE export + 1096 summary buttons */}
        {activeTab === '1099-reports' && <ContractorReports1099Tax />}

        {/* Void Checks Tab — S3-08 */}
        {activeTab === 'void-checks' && <VoidChecksTab />}

        {/* AP Aging Tab — S5-04 */}
        {activeTab === 'ap-aging' && <APAgingTab />}

        {/* AP Reports Tab — S6-12: Paid Invoice + IC Distribution */}
        {activeTab === 'ap-reports' && <APReportsTab />}

        {/* Check Register Tab — S5-05 */}
        {activeTab === 'check-register' && <CheckRegisterTab />}
      </div>
    </div>
  );
}

function VoidChecksTab() {
  const queryClient = useQueryClient();
  const [checkSearch, setCheckSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [confirmVoid, setConfirmVoid] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [notification, setNotification] = useState<string | null>(null);

  const { data: payments, isLoading, refetch } = useQuery({
    queryKey: ['ap-payments', checkSearch, dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams();
      if (checkSearch) params.set('checkNumber', checkSearch);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      return aparApi.getPayments(params.toString() || undefined);
    },
    retry: false,
  });

  const voidMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      aparApi.voidPayment(id, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ap-payments'] });
      setConfirmVoid(null);
      setVoidReason('');
      setNotification('Check voided successfully.');
      setTimeout(() => setNotification(null), 3000);
    },
    onError: (err: any) => {
      setNotification(`Void failed: ${err.message}`);
    },
  });

  const fmtDate = (dt: string) => dt ? new Date(dt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—';
  const fmtAmt = (n: any) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      {notification && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <Check className="w-4 h-4" />
          {notification}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 flex gap-3 flex-wrap items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Check #</label>
          <input
            type="text"
            value={checkSearch}
            onChange={e => setCheckSearch(e.target.value)}
            placeholder="Search check#"
            className="border rounded px-3 py-2 text-sm w-36"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From Date</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To Date</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border rounded px-3 py-2 text-sm" />
        </div>
        <button onClick={() => refetch()} className="flex items-center gap-2 border border-gray-300 rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 self-end">
          Search
        </button>
      </div>

      {/* Results Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <p className="text-center py-10 text-sm text-gray-400">Loading...</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase w-28">Check #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">AP Entry ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase w-28">Payment Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase w-28">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase w-24">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase w-28">Voided At</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {((payments ?? []) as any[]).map((p: any) => (
                <tr key={p.id} style={{ height: 36 }} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono font-bold">{p.checkNumber ?? '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{p.apEntryId?.slice(-8)}</td>
                  <td className="px-4 py-2">{fmtDate(p.paymentDate)}</td>
                  <td className="px-4 py-2 text-right font-mono">${fmtAmt(p.amount)}</td>
                  <td className="px-4 py-2">
                    {p.voidedAt ? (
                      <Badge variant="danger">VOID</Badge>
                    ) : (
                      <Badge variant="success">Issued</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{p.voidedAt ? fmtDate(p.voidedAt) : '—'}</td>
                  <td className="px-4 py-2">
                    {!p.voidedAt && (
                      <button
                        onClick={() => { setConfirmVoid(p); setVoidReason(''); }}
                        className="text-xs text-red-600 border border-red-200 px-2 py-1 rounded hover:bg-red-50"
                      >
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {((payments ?? []) as any[]).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">
                    No payments found. Use the filters above to search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Void Confirmation Dialog */}
      {confirmVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] p-6 space-y-4">
            <h3 className="font-bold text-lg text-red-700 flex items-center gap-2">
              <Ban className="w-5 h-5" />
              Void Check #{confirmVoid.checkNumber}?
            </h3>
            <p className="text-sm text-gray-600">
              Payment of <span className="font-mono font-bold">${fmtAmt(confirmVoid.amount)}</span> dated {fmtDate(confirmVoid.paymentDate)}.
              This will re-open the AP invoice. The action cannot be undone.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason for voiding (optional)</label>
              <input
                type="text"
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                placeholder="e.g. Lost check, wrong amount..."
                className="w-full border rounded px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmVoid(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => voidMut.mutate({ id: confirmVoid.id, reason: voidReason })}
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
// S5-04: AP Aging Report
// ─────────────────────────────────────────────────────────────────────────────
import AgingDisplay from '../../components/accounting/AgingDisplay';

// ─────────────────────────────────────────────────────────────────────────────
// S6-12: AP Reports — Paid Invoice (AP-7) + IC Company Distribution (AP-9)
// ─────────────────────────────────────────────────────────────────────────────
function APReportsTab() {
  const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [subReport, setSubReport] = useState<'paid-invoice' | 'ic-distribution'>('paid-invoice');

  // AP-7: Paid Invoice Report state
  const [piDateFrom, setPiDateFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); });
  const [piDateTo, setPiDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [piVendorFrom, setPiVendorFrom] = useState('');
  const [piVendorTo, setPiVendorTo] = useState('');
  const [piMethod, setPiMethod] = useState('');

  const { data: paidInvoices = [], isLoading: piLoading } = useQuery({
    queryKey: ['ap-paid-invoices', piDateFrom, piDateTo, piVendorFrom, piVendorTo, piMethod],
    queryFn: () => {
      const p = new URLSearchParams({ status: 'PAID', date_from: piDateFrom, date_to: piDateTo });
      if (piVendorFrom) p.set('vendor_from', piVendorFrom);
      if (piVendorTo) p.set('vendor_to', piVendorTo);
      if (piMethod) p.set('payment_method', piMethod);
      return aparApi.getInvoices(p.toString()).catch(() => []);
    },
  });

  const piTotal = (paidInvoices as any[]).reduce((s: number, r: any) => s + Number(r.total_amount ?? r.totalAmount ?? 0), 0);

  const exportPICSV = () => {
    const rows = (paidInvoices as any[]).map((r: any) => [
      r.vendor_name ?? r.vendorName ?? '',
      r.invoice_number ?? r.invoiceNumber ?? '',
      r.invoice_date ?? r.invoiceDate ?? '',
      r.paid_date ?? r.paidDate ?? '',
      r.check_number ?? r.checkNumber ?? '',
      r.total_amount ?? r.totalAmount ?? '',
      r.payment_method ?? r.paymentMethod ?? '',
    ]);
    const csv = ['Vendor,Invoice#,Invoice Date,Paid Date,Check#,Amount,Method', ...rows.map(r => r.join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `paid-invoice-${piDateFrom}-${piDateTo}.csv`; a.click();
  };

  // AP-9: IC Company Distribution Report state
  const [icCutoff, setIcCutoff] = useState(new Date().toISOString().slice(0, 10));
  const [icCompany, setIcCompany] = useState('');

  const { data: icEntries = [], isLoading: icLoading } = useQuery({
    queryKey: ['ap-ic-distribution', icCutoff, icCompany],
    queryFn: () => {
      const p = new URLSearchParams({ cutoff: icCutoff, type: 'INTERCOMPANY' });
      if (icCompany) p.set('company', icCompany);
      return aparApi.getInvoices(p.toString()).catch(() => []);
    },
  });

  // Group IC by company
  const icByCompany: Record<string, any[]> = {};
  (icEntries as any[]).forEach((r: any) => {
    const co = r.company ?? r.tenantId ?? 'Unknown';
    if (!icByCompany[co]) icByCompany[co] = [];
    icByCompany[co].push(r);
  });

  const exportICCSV = () => {
    const rows = (icEntries as any[]).map((r: any) => [
      r.company ?? '', r.vendor_name ?? r.vendorName ?? '',
      r.invoice_number ?? r.invoiceNumber ?? '', r.gl_account ?? '',
      r.total_amount ?? r.totalAmount ?? '', r.posted_date ?? r.postedDate ?? '',
    ]);
    const csv = ['Company,Vendor,Invoice#,GL Account,Amount,Posted Date', ...rows.map(r => r.join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `ic-distribution-${icCutoff}.csv`; a.click();
  };

  return (
    <div className="space-y-4">
      {/* Sub-report selector */}
      <div className="flex gap-2 border-b pb-2">
        <button onClick={() => setSubReport('paid-invoice')} className={`px-4 py-1.5 text-sm rounded ${subReport === 'paid-invoice' ? 'bg-brand text-white' : 'border hover:bg-gray-50'}`}>
          AP-7: Paid Invoice Report
        </button>
        <button onClick={() => setSubReport('ic-distribution')} className={`px-4 py-1.5 text-sm rounded ${subReport === 'ic-distribution' ? 'bg-brand text-white' : 'border hover:bg-gray-50'}`}>
          AP-9: IC Company Distribution
        </button>
      </div>

      {/* AP-7: Paid Invoice Report */}
      {subReport === 'paid-invoice' && (
        <div>
          <div className="flex flex-wrap gap-3 items-end mb-3">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Date From</label><input type="date" value={piDateFrom} onChange={e => setPiDateFrom(e.target.value)} className="border rounded px-2 py-1.5 text-sm" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Date To</label><input type="date" value={piDateTo} onChange={e => setPiDateTo(e.target.value)} className="border rounded px-2 py-1.5 text-sm" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Vendor From</label><input type="text" value={piVendorFrom} onChange={e => setPiVendorFrom(e.target.value)} placeholder="A" className="border rounded px-2 py-1.5 text-sm w-28" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Vendor To</label><input type="text" value={piVendorTo} onChange={e => setPiVendorTo(e.target.value)} placeholder="ZZZ" className="border rounded px-2 py-1.5 text-sm w-28" /></div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
              <select value={piMethod} onChange={e => setPiMethod(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
                <option value="">All</option>
                <option value="CHECK">Check</option>
                <option value="ACH">ACH</option>
                <option value="WIRE">Wire</option>
              </select>
            </div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => window.print()} className="border px-3 py-1.5 text-sm rounded hover:bg-gray-50">Print</button>
              <button onClick={exportPICSV} className="border px-3 py-1.5 text-sm rounded hover:bg-gray-50">Export CSV</button>
            </div>
          </div>
          <div className="overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Vendor', 'Invoice #', 'Invoice Date', 'Paid Date', 'Check #', 'Amount', 'Method'].map(h => (
                    <th key={h} className={`px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {piLoading && <tr><td colSpan={7} className="py-8 text-center text-sm text-gray-400">Loading...</td></tr>}
                {!piLoading && (paidInvoices as any[]).length === 0 && <tr><td colSpan={7} className="py-8 text-center text-sm text-gray-400">No paid invoices found</td></tr>}
                {(paidInvoices as any[]).map((r: any, i: number) => (
                  <tr key={i} className="border-t hover:bg-gray-50 h-9">
                    <td className="px-4 text-sm">{r.vendor_name ?? r.vendorName}</td>
                    <td className="px-4 font-mono text-xs">{r.invoice_number ?? r.invoiceNumber}</td>
                    <td className="px-4 text-xs">{r.invoice_date ? new Date(r.invoice_date ?? r.invoiceDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 text-xs">{r.paid_date ? new Date(r.paid_date ?? r.paidDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 font-mono text-xs">{r.check_number ?? r.checkNumber ?? '—'}</td>
                    <td className="px-4 text-right font-mono text-sm">{fmt2(Number(r.total_amount ?? r.totalAmount ?? 0))}</td>
                    <td className="px-4 text-xs uppercase">{r.payment_method ?? r.paymentMethod ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                <tr>
                  <td colSpan={5} className="px-4 py-2.5 text-xs font-semibold text-gray-600">Total ({(paidInvoices as any[]).length} invoices)</td>
                  <td className="px-4 text-right font-mono text-sm font-bold">{fmt2(piTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* AP-9: IC Company Distribution */}
      {subReport === 'ic-distribution' && (
        <div>
          <div className="flex flex-wrap gap-3 items-end mb-3">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Cutoff Date</label><input type="date" value={icCutoff} onChange={e => setIcCutoff(e.target.value)} className="border rounded px-2 py-1.5 text-sm" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Company Filter</label><input type="text" value={icCompany} onChange={e => setIcCompany(e.target.value)} placeholder="All companies" className="border rounded px-2 py-1.5 text-sm w-36" /></div>
            <div className="ml-auto flex gap-2">
              <button onClick={() => window.print()} className="border px-3 py-1.5 text-sm rounded hover:bg-gray-50">Print</button>
              <button onClick={exportICCSV} className="border px-3 py-1.5 text-sm rounded hover:bg-gray-50">Export CSV</button>
            </div>
          </div>
          {icLoading && <div className="py-8 text-center text-sm text-gray-400">Loading...</div>}
          {!icLoading && Object.keys(icByCompany).length === 0 && <div className="py-8 text-center text-sm text-gray-400">No intercompany distribution found</div>}
          {Object.entries(icByCompany).map(([company, rows]) => {
            const subtotal = rows.reduce((s, r) => s + Number(r.total_amount ?? r.totalAmount ?? 0), 0);
            return (
              <div key={company} className="mb-6">
                <div className="bg-brand-light border border-brand-border rounded px-4 py-2 mb-2 flex justify-between items-center">
                  <span className="font-semibold text-blue-800 text-sm">{company}</span>
                  <span className="font-mono text-sm font-bold text-blue-800">{fmt2(subtotal)}</span>
                </div>
                <div className="overflow-auto rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Vendor', 'Invoice #', 'GL Account', 'Amount', 'Posted Date'].map(h => (
                          <th key={h} className={`px-4 py-2 text-xs font-semibold text-gray-500 uppercase ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r: any, i: number) => (
                        <tr key={i} className="border-t hover:bg-gray-50 h-9">
                          <td className="px-4 text-sm">{r.vendor_name ?? r.vendorName ?? '—'}</td>
                          <td className="px-4 font-mono text-xs">{r.invoice_number ?? r.invoiceNumber ?? '—'}</td>
                          <td className="px-4 font-mono text-xs">{r.gl_account ?? '—'}</td>
                          <td className="px-4 text-right font-mono text-sm">{fmt2(Number(r.total_amount ?? r.totalAmount ?? 0))}</td>
                          <td className="px-4 text-xs">{r.posted_date ? new Date(r.posted_date ?? r.postedDate).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function APAgingTab() {
  const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const [vendorFrom, setVendorFrom] = useState('');
  const [vendorTo, setVendorTo] = useState('');
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [agingMethod, setAgingMethod] = useState<'due_date' | 'invoice_date'>('due_date');
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);

  const { data: invoicesRaw, isLoading } = useQuery({
    queryKey: ['ap-aging', asOfDate],
    queryFn: () => aparApi.getAP(),
    staleTime: 60_000,
  });

  const invoices: any[] = ((invoicesRaw ?? []) as any[]).filter((inv: any) => {
    if (inv.status === 'PAID' || inv.status === 'VOIDED') return false;
    const invDate = new Date(inv.invoice_date ?? inv.invoiceDate ?? inv.createdAt);
    if (invDate > new Date(asOfDate)) return false;
    if (vendorFrom && inv.vendor_code < vendorFrom) return false;
    if (vendorTo && inv.vendor_code > vendorTo) return false;
    return true;
  });

  // Bucket each invoice
  const asOf = new Date(asOfDate).getTime();
  type Row = { vendorCode: string; vendorName: string; current: number; d0_30: number; d31_60: number; d61_90: number; d90plus: number; invoices: any[] };
  const rowMap = new Map<string, Row>();

  for (const inv of invoices) {
    const dueDate = new Date(agingMethod === 'due_date' ? (inv.due_date ?? inv.dueDate ?? inv.invoiceDate) : inv.invoice_date ?? inv.invoiceDate).getTime();
    const days = Math.max(0, Math.floor((asOf - dueDate) / 86_400_000));
    const balance = Number(inv.balance_due ?? inv.amount ?? 0);
    const key = inv.vendor_code ?? 'UNKNOWN';
    if (!rowMap.has(key)) rowMap.set(key, { vendorCode: key, vendorName: inv.vendor_name ?? key, current: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, invoices: [] });
    const r = rowMap.get(key)!;
    r.invoices.push(inv);
    if (days === 0) r.current += balance;
    else if (days <= 30) r.d0_30 += balance;
    else if (days <= 60) r.d31_60 += balance;
    else if (days <= 90) r.d61_90 += balance;
    else r.d90plus += balance;
  }

  const rows = Array.from(rowMap.values()).sort((a, b) => a.vendorCode.localeCompare(b.vendorCode));
  const totals = rows.reduce((acc, r) => ({
    current: acc.current + r.current,
    d0_30: acc.d0_30 + r.d0_30,
    d31_60: acc.d31_60 + r.d31_60,
    d61_90: acc.d61_90 + r.d61_90,
    d90plus: acc.d90plus + r.d90plus,
  }), { current: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 });
  const grandTotal = totals.current + totals.d0_30 + totals.d31_60 + totals.d61_90 + totals.d90plus;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Vendor From</label>
          <input type="text" value={vendorFrom} onChange={e => setVendorFrom(e.target.value)}
            placeholder="All vendors"
            className="border rounded px-3 py-2 text-sm w-32 font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Vendor To</label>
          <input type="text" value={vendorTo} onChange={e => setVendorTo(e.target.value)}
            placeholder="All vendors"
            className="border rounded px-3 py-2 text-sm w-32 font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">As of Date</label>
          <input type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)}
            className="border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Age By</label>
          <select value={agingMethod} onChange={e => setAgingMethod(e.target.value as any)}
            className="border rounded px-3 py-2 text-sm">
            <option value="due_date">Due Date</option>
            <option value="invoice_date">Invoice Date</option>
          </select>
        </div>
        <button onClick={() => window.print()}
          className="ml-auto border border-gray-300 px-3 py-2 rounded text-sm hover:bg-gray-50">
          Print
        </button>
        <button className="border border-gray-300 px-3 py-2 rounded text-sm hover:bg-gray-50">
          Export CSV
        </button>
      </div>

      {/* Summary bar */}
      {grandTotal > 0 && (
        <AgingDisplay
          current={totals.current}
          days30={totals.d0_30}
          days60={totals.d31_60}
          days90={totals.d61_90}
          over90={totals.d90plus}
        />
      )}

      {/* Table */}
      <div className="overflow-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase w-24">Vendor #</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Vendor Name</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase w-32">Current</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase w-32">1–30</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase w-32">31–60</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase w-32">61–90</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase w-32">90+</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase w-36">Total</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="py-8 text-center text-sm text-gray-400">Loading...</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-sm text-gray-400">No outstanding payables as of {asOfDate}</td></tr>
            )}
            {rows.map(row => {
              const total = row.current + row.d0_30 + row.d31_60 + row.d61_90 + row.d90plus;
              const isExpanded = expandedVendor === row.vendorCode;
              return (
                <>
                  <tr
                    key={row.vendorCode}
                    onClick={() => setExpandedVendor(isExpanded ? null : row.vendorCode)}
                    className="border-t cursor-pointer hover:bg-brand-light transition-colors h-9"
                  >
                    <td className="px-4 font-mono text-xs">{row.vendorCode}</td>
                    <td className="px-4 font-medium text-sm">{row.vendorName}</td>
                    <td className="px-4 text-right font-mono text-xs">{row.current > 0 ? fmt2(row.current) : '—'}</td>
                    <td className="px-4 text-right font-mono text-xs text-yellow-700">{row.d0_30 > 0 ? fmt2(row.d0_30) : '—'}</td>
                    <td className="px-4 text-right font-mono text-xs text-orange-600">{row.d31_60 > 0 ? fmt2(row.d31_60) : '—'}</td>
                    <td className="px-4 text-right font-mono text-xs text-red-600">{row.d61_90 > 0 ? fmt2(row.d61_90) : '—'}</td>
                    <td className="px-4 text-right font-mono text-xs font-bold text-red-700">{row.d90plus > 0 ? fmt2(row.d90plus) : '—'}</td>
                    <td className="px-4 text-right font-mono text-sm font-bold">{fmt2(total)}</td>
                  </tr>
                  {isExpanded && row.invoices.map((inv: any) => (
                    <tr key={inv.id} className="bg-brand-light/50 border-t text-xs h-8">
                      <td className="pl-8 font-mono text-gray-500">{inv.invoice_number ?? inv.invoiceNumber}</td>
                      <td className="px-4 text-gray-600">{inv.description}</td>
                      <td className="px-4 text-right font-mono text-gray-700" colSpan={5}>{inv.due_date ?? inv.dueDate}</td>
                      <td className="px-4 text-right font-mono">{fmt2(Number(inv.balance_due ?? inv.amount ?? 0))}</td>
                    </tr>
                  ))}
                </>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-gray-50 border-t-2">
              <tr className="h-9 font-bold">
                <td className="px-4 text-xs uppercase text-gray-600" colSpan={2}>Totals</td>
                <td className="px-4 text-right font-mono text-sm">{fmt2(totals.current)}</td>
                <td className="px-4 text-right font-mono text-sm text-yellow-700">{fmt2(totals.d0_30)}</td>
                <td className="px-4 text-right font-mono text-sm text-orange-600">{fmt2(totals.d31_60)}</td>
                <td className="px-4 text-right font-mono text-sm text-red-600">{fmt2(totals.d61_90)}</td>
                <td className="px-4 text-right font-mono text-sm text-red-700">{fmt2(totals.d90plus)}</td>
                <td className="px-4 text-right font-mono text-base">{fmt2(grandTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// S6-08: 1099 FIRE Export wrapper around ContractorReports1099
// ─────────────────────────────────────────────────────────────────────────────
function ContractorReports1099Tax() {
  const [showFIREDialog, setShowFIREDialog] = useState(false);
  const [fireYear, setFireYear] = useState(new Date().getFullYear() - 1);
  const [fireTin, setFireTin] = useState('');
  const [fireName, setFireName] = useState('');
  const [fireContact, setFireContact] = useState('');
  const [firePhone, setFirePhone] = useState('');
  const [fireEmail, setFireEmail] = useState('');
  const [exporting, setExporting] = useState(false);

  const handleFIREExport = async () => {
    setExporting(true);
    try {
      const result = await purchaseOrderApi.export1099FIRE({
        taxYear: fireYear,
        transmitterTin: fireTin,
        transmitterName: fireName,
        contactName: fireContact,
        contactPhone: firePhone,
        contactEmail: fireEmail,
      });
      const content = result.fireFileContent ?? JSON.stringify(result);
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `1099-FIRE-${fireYear}.txt`; a.click();
      URL.revokeObjectURL(url);
      setShowFIREDialog(false);
    } finally { setExporting(false); }
  };

  return (
    <div>
      {/* S6-08 action buttons */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setShowFIREDialog(true)}
          className="px-4 py-2 text-sm font-medium bg-brand text-white rounded hover:bg-brand"
        >
          Export FIRE File (.txt)
        </button>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50"
        >
          Print 1096 Summary
        </button>
      </div>

      <ContractorReports1099 />

      {/* FIRE Export Dialog */}
      {showFIREDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold mb-4">Export IRS FIRE File</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tax Year</label>
                <input type="number" value={fireYear} onChange={e => setFireYear(parseInt(e.target.value))} className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Transmitter TIN (9 digits)</label>
                <input type="text" value={fireTin} onChange={e => setFireTin(e.target.value)} placeholder="123456789" maxLength={9} className="w-full border rounded px-3 py-1.5 text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Transmitter Name</label>
                <input type="text" value={fireName} onChange={e => setFireName(e.target.value)} placeholder="Dealer Group Name" className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Contact Name</label>
                  <input type="text" value={fireContact} onChange={e => setFireContact(e.target.value)} className="w-full border rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Contact Phone</label>
                  <input type="text" value={firePhone} onChange={e => setFirePhone(e.target.value)} placeholder="5555551234" className="w-full border rounded px-3 py-1.5 text-sm font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Contact Email</label>
                <input type="email" value={fireEmail} onChange={e => setFireEmail(e.target.value)} className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowFIREDialog(false)} className="flex-1 px-4 py-2 text-sm border rounded hover:bg-gray-50">Cancel</button>
              <button
                onClick={handleFIREExport}
                disabled={exporting || !fireTin || !fireName}
                className="flex-1 px-4 py-2 text-sm font-medium bg-brand text-white rounded hover:bg-brand disabled:bg-gray-400"
              >
                {exporting ? 'Generating...' : 'Download FIRE File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// S5-05: Check Register
// ─────────────────────────────────────────────────────────────────────────────
function CheckRegisterTab() {
  const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [methodFilter, setMethodFilter] = useState<'ALL' | 'CHECK' | 'ACH'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ISSUED' | 'VOIDED' | 'CLEARED'>('ALL');
  const [vendorFilter, setVendorFilter] = useState('');
  const [voidTarget, setVoidTarget] = useState<any | null>(null);
  const [voidReason, setVoidReason] = useState('');
  // S6-09: Positive Pay export dialog
  const [showPositivePayDialog, setShowPositivePayDialog] = useState(false);
  const [ppDateFrom, setPpDateFrom] = useState(dateFrom);
  const [ppDateTo, setPpDateTo] = useState(dateTo);
  const [ppBankAccountId, setPpBankAccountId] = useState('');
  const [ppFormat, setPpFormat] = useState<'COMMA_DELIMITED' | 'TAB_DELIMITED' | 'FIXED_WIDTH'>('COMMA_DELIMITED');
  const [ppExporting, setPpExporting] = useState(false);

  const { data: paymentsRaw, isLoading, refetch } = useQuery({
    queryKey: ['ap-payments', dateFrom, dateTo, methodFilter, statusFilter, vendorFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (methodFilter !== 'ALL') params.set('method', methodFilter);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (vendorFilter) params.set('vendor', vendorFilter);
      return aparApi.getPayments(params.toString());
    },
    staleTime: 30_000,
  });

  const payments: any[] = ((paymentsRaw ?? []) as any[]).sort(
    (a, b) => (a.check_number ?? a.checkNumber ?? 0) - (b.check_number ?? b.checkNumber ?? 0)
  );

  const voidMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      aparApi.voidPayment(id, { reason }),
    onSuccess: () => { setVoidTarget(null); setVoidReason(''); refetch(); },
  });

  const totals = payments.reduce((acc, p) => {
    const amt = Number(p.amount ?? 0);
    if (p.status === 'VOIDED' || p.voidedAt) acc.voided += amt;
    else acc.issued += amt;
    return acc;
  }, { issued: 0, voided: 0 });
  const net = totals.issued - totals.voided;

  const statusBadge = (p: any) => {
    if (p.voidedAt || p.status === 'VOIDED') return <Badge variant="danger">Voided</Badge>;
    if (p.clearedFlag || p.status === 'CLEARED') return <Badge variant="success">Cleared</Badge>;
    return <Badge variant="info">Issued</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
          <select value={methodFilter} onChange={e => setMethodFilter(e.target.value as any)}
            className="border rounded px-3 py-2 text-sm">
            <option value="ALL">All Methods</option>
            <option value="CHECK">Check</option>
            <option value="ACH">ACH</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
            className="border rounded px-3 py-2 text-sm">
            <option value="ALL">All Statuses</option>
            <option value="ISSUED">Issued</option>
            <option value="VOIDED">Voided</option>
            <option value="CLEARED">Cleared</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Vendor</label>
          <input type="text" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}
            placeholder="All vendors"
            className="border rounded px-3 py-2 text-sm w-36 font-mono" />
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => window.print()}
            className="border border-gray-300 px-3 py-2 rounded text-sm hover:bg-gray-50">Print</button>
          <button className="border border-gray-300 px-3 py-2 rounded text-sm hover:bg-gray-50">Export CSV</button>
          {/* S6-09: Wired Positive Pay Export */}
          <button onClick={() => setShowPositivePayDialog(true)} className="border border-blue-300 text-brand px-3 py-2 rounded text-sm hover:bg-brand-light">
            Positive Pay Export
          </button>
        </div>
      </div>

      {/* S6-09: Positive Pay Export Dialog */}
      {showPositivePayDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold mb-4">Positive Pay Export</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Date From</label>
                  <input type="date" value={ppDateFrom} onChange={e => setPpDateFrom(e.target.value)} className="w-full border rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Date To</label>
                  <input type="date" value={ppDateTo} onChange={e => setPpDateTo(e.target.value)} className="w-full border rounded px-3 py-1.5 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Bank Account</label>
                <input type="text" value={ppBankAccountId} onChange={e => setPpBankAccountId(e.target.value)} placeholder="Bank account ID" className="w-full border rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Format</label>
                <select value={ppFormat} onChange={e => setPpFormat(e.target.value as any)} className="w-full border rounded px-3 py-1.5 text-sm">
                  <option value="COMMA_DELIMITED">Comma Delimited (CSV)</option>
                  <option value="TAB_DELIMITED">Tab Delimited (TSV)</option>
                  <option value="FIXED_WIDTH">Fixed Width</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowPositivePayDialog(false)} className="flex-1 px-4 py-2 text-sm border rounded hover:bg-gray-50">Cancel</button>
              <button
                disabled={ppExporting}
                onClick={async () => {
                  setPpExporting(true);
                  try {
                    const result = await purchaseOrderApi.positivePayExport({ bankAccountId: ppBankAccountId || undefined, dateFrom: ppDateFrom, dateTo: ppDateTo, format: ppFormat });
                    const ext = ppFormat === 'FIXED_WIDTH' ? 'txt' : ppFormat === 'TAB_DELIMITED' ? 'tsv' : 'csv';
                    const blob = new Blob([typeof result === 'string' ? result : JSON.stringify(result)], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); a.href = url; a.download = `positive-pay-${ppDateFrom}-${ppDateTo}.${ext}`; a.click();
                    URL.revokeObjectURL(url);
                    setShowPositivePayDialog(false);
                  } finally { setPpExporting(false); }
                }}
                className="flex-1 px-4 py-2 text-sm font-medium bg-brand text-white rounded hover:bg-brand disabled:bg-gray-400"
              >
                {ppExporting ? 'Exporting...' : 'Export'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase w-24">Check #</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase w-28">Date</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Vendor</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase w-32">Amount</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase w-20">Method</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase w-24">Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase w-20">Cleared?</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase w-28">Cleared Date</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase w-28">User</th>
              <th className="px-4 py-2.5 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={10} className="py-8 text-center text-sm text-gray-400">Loading...</td></tr>}
            {!isLoading && payments.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-sm text-gray-400">No checks found</td></tr>}
            {payments.map(p => (
              <tr key={p.id} className="border-t hover:bg-gray-50 h-9">
                <td className="px-4 font-mono text-xs font-bold">{p.check_number ?? p.checkNumber ?? '—'}</td>
                <td className="px-4 text-xs">{p.check_date ?? p.checkDate ? new Date(p.check_date ?? p.checkDate).toLocaleDateString() : '—'}</td>
                <td className="px-4 text-sm">
                  <div className="font-medium">{p.vendor_name ?? p.vendorName}</div>
                  <div className="text-xs text-gray-400 font-mono">{p.vendor_code ?? p.vendorCode}</div>
                </td>
                <td className="px-4 text-right font-mono text-sm">{fmt2(Number(p.amount ?? 0))}</td>
                <td className="px-4 text-xs uppercase font-mono">{p.payment_method ?? p.paymentMethod ?? 'CHECK'}</td>
                <td className="px-4">{statusBadge(p)}</td>
                <td className="px-4 text-xs">{(p.clearedFlag || p.status === 'CLEARED') ? '✓' : '—'}</td>
                <td className="px-4 text-xs">{p.cleared_date ?? p.clearedDate ? new Date(p.cleared_date ?? p.clearedDate).toLocaleDateString() : '—'}</td>
                <td className="px-4 text-xs text-gray-500">{p.created_by ?? p.createdBy ?? '—'}</td>
                <td className="px-4">
                  <div className="flex gap-1">
                    {!p.voidedAt && p.status !== 'VOIDED' && (
                      <button
                        onClick={() => setVoidTarget(p)}
                        className="text-xs text-red-500 border border-red-200 px-2 py-0.5 rounded hover:bg-red-50"
                      >Void</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {payments.length > 0 && (
            <tfoot className="bg-gray-50 border-t-2">
              <tr className="h-9">
                <td className="px-4 text-xs font-semibold text-gray-600" colSpan={3}>
                  {payments.length} check{payments.length !== 1 ? 's' : ''}
                </td>
                <td className="px-4 text-right font-mono text-sm font-bold" colSpan={1}>—</td>
                <td colSpan={3} />
                <td className="px-4 text-xs text-gray-500" colSpan={3}>
                  Issued: ${fmt2(totals.issued)} &nbsp;|&nbsp; Voided: ${fmt2(totals.voided)} &nbsp;|&nbsp; Net: ${fmt2(net)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Void dialog */}
      {voidTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-6 space-y-4">
            <h3 className="font-bold text-lg text-red-700">Void Check #{voidTarget.check_number ?? voidTarget.checkNumber}?</h3>
            <p className="text-sm text-gray-600">Amount: <strong>${fmt2(Number(voidTarget.amount ?? 0))}</strong></p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Void Reason <span className="text-red-500">*</span></label>
              <input type="text" value={voidReason} onChange={e => setVoidReason(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm" placeholder="Enter reason" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setVoidTarget(null); setVoidReason(''); }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button
                disabled={!voidReason.trim() || voidMut.isPending}
                onClick={() => voidMut.mutate({ id: voidTarget.id, reason: voidReason } as any)}
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
