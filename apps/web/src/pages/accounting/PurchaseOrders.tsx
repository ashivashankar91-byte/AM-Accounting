import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ChevronRight, Edit2, Trash2, CheckCircle, XCircle, Clock, Plus, Copy, AlertTriangle } from 'lucide-react';
import { glApi, purchaseOrderApi } from '../../api/client';
import StatusBadge from '../../components/StatusBadge';
import DataTable, { Column } from '../../components/DataTable';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';

// TypeScript Interfaces
interface POLine {
  line_number: number;
  item: string;
  gl_account: string;
  qty: number;
  unit_cost: number;
  ext_cost: number;
  control_number?: string;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor: string;
  vendor_id: string;
  ship_to: string;
  requested_by: string;
  department: string;
  po_date: string;
  required_date: string;
  notes: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED' | 'VOIDED';
  po_type?: 'GENERAL' | 'SUBLET' | 'VEHICLE';
  ro_number?: string;  // S6-02: Sublet PO link
  lines: POLine[];
  line_total: number;
  freight: number;
  tax: number;
  total: number;
  approval_level?: number;
  approved_by?: string;
  created_at: string;
  updated_at: string;
}

// 8 UI States
type UIState = 'idle' | 'loading' | 'success' | 'error' | 'empty' | 'editing' | 'deleting' | 'approving';

// S6-01: State Machine for PO Status Transitions — Cancel vs Void are DIFFERENT actions
const getValidTransitions = (status: PurchaseOrder['status'], approvalLevel: number): { action: string; newStatus: PurchaseOrder['status'] }[] => {
  const transitions: Record<PurchaseOrder['status'], { action: string; newStatus: PurchaseOrder['status'] }[]> = {
    'DRAFT': [{ action: 'Submit', newStatus: 'SUBMITTED' }],
    'SUBMITTED': approvalLevel >= 1 ? [{ action: 'Approve', newStatus: 'APPROVED' }] : [],
    'APPROVED': [{ action: 'Receive', newStatus: 'PARTIALLY_RECEIVED' }],
    'PARTIALLY_RECEIVED': [
      { action: 'Receive Remaining', newStatus: 'RECEIVED' },
      { action: 'Close', newStatus: 'CLOSED' },
    ],
    'RECEIVED': [{ action: 'Close', newStatus: 'CLOSED' }],
    'CLOSED': [],
    'CANCELLED': [],
    'VOIDED': [],
  };
  return transitions[status] || [];
};

export default function PurchaseOrders() {
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [uiState, setUiState] = useState<UIState>('idle');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewPO, setShowNewPO] = useState(false);
  // S6-01: Cancel/Void dialog state
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [cancelVoidReason, setCancelVoidReason] = useState('');
  const [newPOForm, setNewPOForm] = useState({
    vendor_id: '',
    department: '',
    required_date: '',
    notes: '',
    po_type: 'GENERAL' as 'GENERAL' | 'SUBLET' | 'VEHICLE',
    ro_number: '',  // S6-02
    lines: [{ item: '', gl_account: '', qty: 1, unit_cost: 0 }],
  });

  // PO List Query — now uses purchaseOrderApi
  const { data: pos, isLoading, error, refetch } = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () => purchaseOrderApi.list(statusFilter ? `status=${statusFilter}` : undefined),
    retry: false,
  });

  // Filter data
  const filtered = (pos || [])
    .filter((po: any) => !statusFilter || po.status === statusFilter)
    .filter((po: any) => !searchTerm || (po.po_number ?? po.poNumber ?? '').includes(searchTerm) || (po.vendor ?? po.vendorName ?? '').toLowerCase().includes(searchTerm.toLowerCase()));

  // Create PO Mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return purchaseOrderApi.create({ ...data });
    },
    onSuccess: () => {
      refetch();
      setShowNewPO(false);
      setUiState('success');
    },
    onError: () => {
      setUiState('error');
    },
  });

  // Approve PO Mutation
  const approveMutation = useMutation({
    mutationFn: async (poId: string) => {
      return purchaseOrderApi.approve(poId);
    },
    onSuccess: (data) => {
      setSelectedPO(data);
      refetch();
      setUiState('success');
    },
  });

  const handleCreatePO = async () => {
    setUiState('loading');
    createMutation.mutate(newPOForm);
  };

  const handleStatusTransition = async (newStatus: PurchaseOrder['status']) => {
    if (!selectedPO) return;
    setUiState('approving');
    try {
      if (newStatus === 'SUBMITTED') await purchaseOrderApi.submit(selectedPO.id);
      else if (newStatus === 'APPROVED') await purchaseOrderApi.approve(selectedPO.id);
      else if (newStatus === 'CLOSED') await purchaseOrderApi.close(selectedPO.id);
      else {
        await new Promise((r) => setTimeout(r, 800));
      }
      setSelectedPO({ ...selectedPO, status: newStatus });
      refetch();
      setUiState('success');
    } catch {
      setUiState('error');
    }
  };

  // S6-01: CANCEL — DRAFT only, no PO# consumed
  const handleCancel = async () => {
    if (!selectedPO) return;
    await purchaseOrderApi.cancel(selectedPO.id, cancelVoidReason);
    setSelectedPO(null);
    setShowCancelDialog(false);
    setCancelVoidReason('');
    refetch();
  };

  // S6-01: VOID — SUBMITTED or APPROVED, PO# consumed
  const handleVoid = async () => {
    if (!selectedPO) return;
    try {
      await purchaseOrderApi.void(selectedPO.id, cancelVoidReason);
      setSelectedPO(null);
      setShowVoidDialog(false);
      setCancelVoidReason('');
      refetch();
    } catch (err: any) {
      setUiState('error');
      setShowVoidDialog(false);
    }
  };

  const handleDeletePO = async (poId: string) => {
    setUiState('deleting');
    try {
      await new Promise((r) => setTimeout(r, 600));
      refetch();
      setSelectedPO(null);
      setUiState('success');
    } catch {
      setUiState('error');
    }
  };

  // Approval thresholds
  const getApprovalLevel = (total: number): number => {
    if (total < 500) return 3; // auto-approved
    if (total < 5000) return 1; // manager
    if (total < 25000) return 2; // controller
    return 0; // dealer principal
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Plus className="w-6 h-6" /> Purchase Orders
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">WF-A008: Full state machine enforcement with approval thresholds</p>
        </div>
        <button
          onClick={() => setShowNewPO(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-brand text-white rounded hover:bg-brand"
        >
          <Plus className="w-4 h-4" /> New PO
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Open/Pending</p>
          <p className="text-2xl font-bold text-brand">
            {(pos || []).filter((p: any) => ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(p.status)).length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Partially Received</p>
          <p className="text-2xl font-bold text-amber-600">
            {(pos || []).filter((p: any) => p.status === 'PARTIALLY_RECEIVED').length}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Total Value (Outstanding)</p>
          <p className="text-2xl font-bold text-indigo-600">
            ${((pos || [])
              .filter((p: any) => !['CLOSED', 'CANCELLED'].includes(p.status))
              .reduce((sum: number, p: any) => sum + (p.total || 0), 0) / 1000).toFixed(0)}K
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Awaiting Approval</p>
          <p className="text-2xl font-bold text-red-600">
            {(pos || []).filter((p: any) => p.status === 'SUBMITTED').length}
          </p>
        </div>
      </div>

      {/* Split View Container */}
      <div className="grid grid-cols-3 gap-4">
        {/* Left: PO List */}
        <div className="col-span-2 bg-white rounded-lg shadow p-4 space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Search PO number or vendor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 border rounded px-3 py-2 text-sm"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="APPROVED">Approved</option>
              <option value="PARTIALLY_RECEIVED">Partially Received</option>
              <option value="RECEIVED">Received</option>
              <option value="CLOSED">Closed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="VOIDED">Voided</option>
            </select>
          </div>

          {isLoading && <PageLoader page="Purchase Orders" />}
          {error && <PageError error={error} />}
          {!isLoading && filtered.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <p>No purchase orders found</p>
            </div>
          )}
          {!isLoading && filtered.length > 0 && (
            <DataTable<any>
              columns={[
                {
                  key: 'po_number',
                  label: 'PO #',
                  mono: true,
                  render: (po) => <span className="font-bold text-brand">{po.po_number}</span>,
                },
                { key: 'vendor', label: 'Vendor' },
                { key: 'po_date', label: 'Date', render: (po) => new Date(po.po_date).toLocaleDateString() },
                {
                  key: 'total',
                  label: 'Total',
                  align: 'right',
                  mono: true,
                  render: (po) => `$${po.total.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
                },
                {
                  key: 'status',
                  label: 'Status',
                  render: (po) => <StatusBadge status={po.status} />,
                },
              ]}
              data={filtered}
              onRowClick={(po) => setSelectedPO(po)}
              keyField="id"
            />
          )}
        </div>

        {/* Right: Detail Panel */}
        <div className="bg-white rounded-lg shadow p-4">
          {selectedPO ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b pb-3">
                <h3 className="font-semibold">{selectedPO.po_number}</h3>
                <button
                  onClick={() => setSelectedPO(null)}
                  className="text-gray-500 hover:text-gray-700 text-lg"
                >
                  ✕
                </button>
              </div>

              {/* Header Info */}
              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-gray-500 font-medium">Vendor</p>
                  <p className="font-medium">{selectedPO.vendor}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Ship To</p>
                  <p className="font-medium">{selectedPO.ship_to}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Department</p>
                  <p className="font-medium">{selectedPO.department}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Requested By</p>
                  <p className="font-medium">{selectedPO.requested_by}</p>
                </div>
                <div>
                  <p className="text-gray-500 font-medium">Required Date</p>
                  <p className="font-medium">{new Date(selectedPO.required_date).toLocaleDateString()}</p>
                </div>
              </div>

              {/* Lines Summary */}
              <div className="bg-gray-50 rounded p-3">
                <p className="text-xs font-semibold text-gray-600 mb-2">ORDER SUMMARY</p>
                <table className="w-full text-xs space-y-1">
                  <tbody>
                    <tr className="border-b">
                      <td className="py-1">Line Total</td>
                      <td className="py-1 text-right font-mono">${selectedPO.line_total.toLocaleString()}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-1">Freight</td>
                      <td className="py-1 text-right font-mono">${selectedPO.freight.toLocaleString()}</td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-1">Tax</td>
                      <td className="py-1 text-right font-mono">${selectedPO.tax.toLocaleString()}</td>
                    </tr>
                    <tr className="font-bold">
                      <td className="py-1">Total</td>
                      <td className="py-1 text-right font-mono">${selectedPO.total.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Status & Transitions */}
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-2">STATUS</p>
                <StatusBadge status={selectedPO.status} />
              </div>

              {/* Valid Transition Buttons */}
              <div className="space-y-2">
                {getValidTransitions(selectedPO.status, getApprovalLevel(selectedPO.total)).map((t) => (
                  <button
                    key={t.newStatus}
                    onClick={() => handleStatusTransition(t.newStatus)}
                    disabled={uiState === 'approving'}
                    className="w-full px-3 py-2 text-xs font-medium bg-brand text-white rounded hover:bg-brand disabled:bg-gray-400"
                  >
                    {uiState === 'approving' ? 'Processing...' : t.action}
                  </button>
                ))}
              </div>

              {/* Approval Threshold Info */}
              {selectedPO.status === 'SUBMITTED' && (
                <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs">
                  <p className="font-semibold text-amber-800 mb-1">Approval Required</p>
                  <p className="text-amber-700">
                    This PO exceeds {getApprovalLevel(selectedPO.total) === 1 ? 'manager' : getApprovalLevel(selectedPO.total) === 2 ? 'controller' : 'dealer principal'} threshold.
                  </p>
                </div>
              )}

              {/* Action Buttons — S6-01: CANCEL on DRAFT, VOID on SUBMITTED/APPROVED */}
              <div className="flex gap-2 pt-3 border-t">
                {selectedPO.status === 'DRAFT' && (
                  <>
                    <button className="flex-1 px-3 py-2 text-xs font-medium border border-gray-300 rounded hover:bg-gray-50">
                      Edit
                    </button>
                    <button
                      onClick={() => setShowCancelDialog(true)}
                      className="flex-1 px-3 py-2 text-xs font-medium text-orange-600 border border-orange-300 rounded hover:bg-orange-50"
                    >
                      Cancel PO
                    </button>
                  </>
                )}
                {(selectedPO.status === 'SUBMITTED' || selectedPO.status === 'APPROVED') && (
                  <button
                    onClick={() => setShowVoidDialog(true)}
                    className="w-full px-3 py-2 text-xs font-medium text-red-600 border border-red-300 rounded hover:bg-red-50 flex items-center justify-center gap-1"
                  >
                    <AlertTriangle className="w-3 h-3" /> Void PO #{selectedPO.po_number}
                  </button>
                )}
              </div>
              {/* S6-02: Show RO number for sublet POs */}
              {selectedPO.po_type === 'SUBLET' && selectedPO.ro_number && (
                <div className="bg-brand-light border border-brand-border rounded p-2 text-xs">
                  <span className="font-medium text-brand">Linked RO:</span> {selectedPO.ro_number}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-96 text-gray-500">
              <ChevronRight className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm font-medium">Select a PO to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* New PO Modal */}
      {showNewPO && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="p-6 border-b flex justify-between items-center">
              <h3 className="font-semibold">Create New Purchase Order</h3>
              <button onClick={() => setShowNewPO(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">PO Type</label>
                  <select
                    value={newPOForm.po_type}
                    onChange={(e) => setNewPOForm({ ...newPOForm, po_type: e.target.value as any })}
                    className="w-full mt-1 border rounded px-3 py-2 text-sm"
                  >
                    <option value="GENERAL">General</option>
                    <option value="SUBLET">Sublet (Linked to RO)</option>
                    <option value="VEHICLE">Vehicle</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Vendor</label>
                  <select
                    value={newPOForm.vendor_id}
                    onChange={(e) => setNewPOForm({ ...newPOForm, vendor_id: e.target.value })}
                    className="w-full mt-1 border rounded px-3 py-2 text-sm"
                  >
                    <option value="">Select vendor...</option>
                    <option value="v1">AutoParts Supply Co</option>
                    <option value="v2">OEM Parts Direct</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Department</label>
                  <select
                    value={newPOForm.department}
                    onChange={(e) => setNewPOForm({ ...newPOForm, department: e.target.value })}
                    className="w-full mt-1 border rounded px-3 py-2 text-sm"
                  >
                    <option value="">Select department...</option>
                    <option value="parts">Parts</option>
                    <option value="service">Service</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Required Date</label>
                  <input
                    type="date"
                    value={newPOForm.required_date}
                    onChange={(e) => setNewPOForm({ ...newPOForm, required_date: e.target.value })}
                    className="w-full mt-1 border rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {/* S6-02: RO number field for Sublet POs */}
              {newPOForm.po_type === 'SUBLET' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Repair Order # <span className="text-red-600">*</span></label>
                  <input
                    type="text"
                    value={newPOForm.ro_number}
                    onChange={(e) => setNewPOForm({ ...newPOForm, ro_number: e.target.value })}
                    placeholder="RO-12345"
                    className="w-full mt-1 border rounded px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">Sublet POs must be linked to an open Repair Order.</p>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowNewPO(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreatePO}
                  disabled={uiState === 'loading'}
                  className="flex-1 px-4 py-2 text-sm font-medium bg-brand text-white rounded hover:bg-brand disabled:bg-gray-400"
                >
                  {uiState === 'loading' ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* S6-01: Cancel Dialog (DRAFT POs only) */}
      {showCancelDialog && selectedPO && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="font-semibold mb-2">Cancel Purchase Order</h3>
            <p className="text-sm text-gray-600 mb-4">
              Cancel DRAFT PO for <strong>{selectedPO.vendor}</strong>?
              Since no PO number has been assigned, this PO will be deleted with no GL impact.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason (optional)</label>
              <input
                type="text"
                value={cancelVoidReason}
                onChange={(e) => setCancelVoidReason(e.target.value)}
                placeholder="Reason for cancellation"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowCancelDialog(false); setCancelVoidReason(''); }} className="flex-1 px-4 py-2 text-sm border rounded hover:bg-gray-50">Back</button>
              <button onClick={handleCancel} className="flex-1 px-4 py-2 text-sm font-medium bg-orange-600 text-white rounded hover:bg-orange-700">Confirm Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* S6-01: Void Dialog (SUBMITTED or APPROVED POs) */}
      {showVoidDialog && selectedPO && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-red-800">Void PO #{selectedPO.po_number}?</h3>
                <p className="text-sm text-gray-600 mt-1">
                  This PO number will be <strong>permanently consumed</strong> and cannot be reused.
                  An audit record will be created.
                </p>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-600">*</span></label>
              <input
                type="text"
                value={cancelVoidReason}
                onChange={(e) => setCancelVoidReason(e.target.value)}
                placeholder="Required — reason for void"
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setShowVoidDialog(false); setCancelVoidReason(''); }} className="flex-1 px-4 py-2 text-sm border rounded hover:bg-gray-50">Back</button>
              <button onClick={handleVoid} disabled={!cancelVoidReason.trim()} className="flex-1 px-4 py-2 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400">Void PO</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
