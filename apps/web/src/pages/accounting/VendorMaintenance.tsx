import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Check, AlertCircle, UserX, RefreshCw, ChevronRight, AlertTriangle, Lock, History, ShieldOff } from 'lucide-react';
import { aparApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';

const VENDOR_TYPES = ['SUPPLIER', 'SERVICE_PROVIDER', 'GOVERNMENT', 'OTHER'] as const;

interface VendorForm {
  vendorNumber: string;
  vendorName: string;
  vendorType: string;
  dba: string;
  contactName: string;
  phone: string;
  fax: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  is1099Misc: boolean;
  is1099Nec: boolean;
  income1099Type: string;
  w9OnFile: boolean;
  w9ReceivedDate: string;
  paymentTerms: string;
  defaultGlAccount: string;
  paymentMethod: string;
  discountPercent: string;
  discountDays: string;
  separateCheck: boolean;
  holdPayments: boolean;
  defaultExpenseAccount: string;
  notes: string;
}

const emptyForm = (): VendorForm => ({
  vendorNumber: '', vendorName: '', vendorType: 'OTHER', dba: '', contactName: '',
  phone: '', fax: '', email: '',
  address1: '', address2: '', city: '', state: '', zip: '',
  is1099Misc: false, is1099Nec: false, income1099Type: '', w9OnFile: false, w9ReceivedDate: '',
  paymentTerms: 'Net30', defaultGlAccount: '', paymentMethod: 'Check',
  discountPercent: '0', discountDays: '0',
  separateCheck: false, holdPayments: false, defaultExpenseAccount: '', notes: '',
});

const vendorToForm = (v: any): VendorForm => ({
  vendorNumber: v.vendorNumber ?? '',
  vendorName: v.vendorName ?? '',
  vendorType: v.vendorType ?? 'OTHER',
  dba: v.dba ?? '',
  contactName: v.contactName ?? '',
  phone: v.phone ?? '',
  fax: v.fax ?? '',
  email: v.email ?? '',
  address1: v.address1 ?? '',
  address2: v.address2 ?? '',
  city: v.city ?? '',
  state: v.state ?? '',
  zip: v.zip ?? '',
  is1099Misc: v.is1099Misc ?? false,
  is1099Nec: v.is1099Nec ?? false,
  income1099Type: v.income1099Type ?? '',
  w9OnFile: v.w9OnFile ?? false,
  w9ReceivedDate: v.w9ReceivedDate ? new Date(v.w9ReceivedDate).toISOString().slice(0, 10) : '',
  paymentTerms: v.paymentTerms ?? 'Net30',
  defaultGlAccount: v.defaultGlAccount ?? '',
  paymentMethod: v.paymentMethod ?? 'Check',
  discountPercent: v.discountPercent != null ? String(v.discountPercent) : '0',
  discountDays: v.discountDays != null ? String(v.discountDays) : '0',
  separateCheck: v.separateCheck ?? false,
  holdPayments: v.holdPayments ?? false,
  defaultExpenseAccount: v.defaultExpenseAccount ?? '',
  notes: v.notes ?? '',
});

type Section = 'address' | 'contact' | 'tax' | 'payment' | 'banking' | 'audit';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'address',  label: 'Address' },
  { key: 'contact',  label: 'Contact' },
  { key: 'tax',      label: 'Tax / 1099' },
  { key: 'payment',  label: 'Payment Terms' },
  { key: 'banking',  label: 'Banking' },
  { key: 'audit',    label: 'Audit History' },
];

function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const styles: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-700',
    INACTIVE: 'bg-gray-200 text-gray-600',
    DELETED: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

export default function VendorMaintenance() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(id ?? null);
  const [form, setForm] = useState<VendorForm>(emptyForm());
  const [section, setSection] = useState<Section>('address');
  const [isDirty, setIsDirty] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirmInactivate, setConfirmInactivate] = useState(false);
  const [inactivateReason, setInactivateReason] = useState('');
  const [confirmReactivate, setConfirmReactivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteConflict, setDeleteConflict] = useState<{ purchaseOrders: number; apEntries: number } | null>(null);
  const [versionConflict, setVersionConflict] = useState(false);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  // S036A duplicate-vendor warning state
  const [dupCandidates, setDupCandidates] = useState<any[] | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideForbidden, setOverrideForbidden] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<any | null>(null);

  useEffect(() => { if (id) setSelectedId(id); }, [id]);

  const { data: vendorsResult, isLoading: listLoading, isError: listError, refetch: refetchList } = useQuery({
    queryKey: ['vendors', statusFilter],
    queryFn: () => aparApi.getVendors(statusFilter ? `status=${statusFilter}` : undefined),
    retry: false,
  });
  const vendors: any[] = (vendorsResult as any)?.items ?? (Array.isArray(vendorsResult) ? vendorsResult : []);

  const { data: vendorDetail, isLoading: detailLoading, isError: detailError, error: detailErrorObj } = useQuery({
    queryKey: ['vendor', selectedId],
    queryFn: () => aparApi.getVendor(selectedId!),
    enabled: !!selectedId && !isNew,
    retry: false,
  });

  useEffect(() => {
    if (vendorDetail) {
      setForm(vendorToForm(vendorDetail));
      setIsDirty(false);
    }
  }, [vendorDetail]);

  const { data: auditEvents, isLoading: auditLoading, isError: auditError } = useQuery({
    queryKey: ['vendor-audit', selectedId],
    queryFn: () => aparApi.getVendorAuditEvents(selectedId!),
    enabled: !!selectedId && !isNew && section === 'audit',
    retry: false,
  });

  function handleMutationError(err: any) {
    const status = err?.status;
    if (err?.body?.error === 'VERSION_CONFLICT') {
      setVersionConflict(true);
      return;
    }
    if (status === 403 || err?.body?.error === 'FORBIDDEN' || err?.body?.error === 'DUPLICATE_VENDOR_OVERRIDE_FORBIDDEN') {
      setUnauthorized(err?.body?.message || 'You do not have permission to perform this action.');
      return;
    }
    if (err?.body?.error === 'VENDOR_HAS_REFERENCES') {
      setDeleteConflict(err.body.references ?? { purchaseOrders: 0, apEntries: 0 });
      return;
    }
    setNotification({ type: 'error', msg: err?.body?.message || err.message || 'Request failed' });
  }

  const saveMut = useMutation({
    mutationFn: (data: any) =>
      selectedId && !isNew
        ? aparApi.updateVendor(selectedId, data)
        : aparApi.createVendor(data),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor', selectedId] });
      setIsDirty(false);
      setIsNew(false);
      setDupCandidates(null);
      setOverrideReason('');
      setOverrideForbidden(false);
      setPendingCreate(null);
      setSelectedId(result.id);
      navigate(`/accounting/ap/vendors/${result.id}`, { replace: true });
      setNotification({ type: 'success', msg: 'Vendor saved.' });
      setTimeout(() => setNotification(null), 3000);
    },
    onError: (err: any, variables: any) => {
      // Defense in depth: the pre-flight checkVendorDuplicates() call in
      // handleSave() normally catches this before create is ever attempted,
      // but a duplicate could also appear from a race between the check and
      // the create — this branch handles that race the same way.
      if (err?.body?.error === 'DUPLICATE_VENDOR_ACKNOWLEDGEMENT_REQUIRED') {
        setDupCandidates(err.body.candidates ?? []);
        setPendingCreate(variables ?? null);
        return;
      }
      handleMutationError(err);
    },
  });

  const inactivateMut = useMutation({
    mutationFn: () => aparApi.inactivateVendor(selectedId!, { version: vendorDetail!.version, reason: inactivateReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor', selectedId] });
      setConfirmInactivate(false);
      setInactivateReason('');
      setNotification({ type: 'success', msg: 'Vendor inactivated.' });
      setTimeout(() => setNotification(null), 3000);
    },
    onError: handleMutationError,
  });

  const reactivateMut = useMutation({
    mutationFn: () => aparApi.reactivateVendor(selectedId!, { version: vendorDetail!.version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['vendor', selectedId] });
      setConfirmReactivate(false);
      setNotification({ type: 'success', msg: 'Vendor reactivated.' });
      setTimeout(() => setNotification(null), 3000);
    },
    onError: handleMutationError,
  });

  const deleteMut = useMutation({
    mutationFn: () => aparApi.deleteVendor(selectedId!, { version: vendorDetail!.version, reason: deleteReason || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      setConfirmDelete(false);
      setDeleteReason('');
      setSelectedId(null);
      setForm(emptyForm());
      setNotification({ type: 'success', msg: 'Vendor deleted.' });
      navigate('/accounting/ap/vendors', { replace: true });
      setTimeout(() => setNotification(null), 3000);
    },
    onError: (err: any) => {
      setConfirmDelete(false);
      handleMutationError(err);
    },
  });

  const setField = (field: keyof VendorForm, val: any) => {
    setForm(prev => ({ ...prev, [field]: val }));
    setIsDirty(true);
  };

  function buildPayload() {
    return {
      ...form,
      discountPercent: parseFloat(form.discountPercent) || 0,
      discountDays: parseInt(form.discountDays) || 0,
      w9ReceivedDate: form.w9ReceivedDate || undefined,
      vendorNumber: isNew ? (form.vendorNumber || undefined) : undefined,
      version: !isNew ? vendorDetail?.version : undefined,
    };
  }

  const handleSave = () => {
    if (!form.vendorName.trim()) {
      setNotification({ type: 'error', msg: 'Vendor name is required.' });
      return;
    }
    const payload = buildPayload();
    if (isNew) {
      // S036A: check for duplicates before attempting create, so the warning
      // can be shown without relying on a 409 round-trip.
      aparApi.checkVendorDuplicates({ vendorName: form.vendorName, email: form.email || undefined, phone: form.phone || undefined, zip: form.zip || undefined })
        .then((res: any) => {
          if (res.candidates?.length > 0) {
            setDupCandidates(res.candidates);
            setPendingCreate(payload);
          } else {
            saveMut.mutate(payload);
          }
        })
        .catch(() => saveMut.mutate(payload));
    } else {
      saveMut.mutate(payload);
    }
  };

  const handleCreateAnyway = () => {
    if (!overrideReason.trim()) return;
    setOverrideForbidden(false);
    saveMut.mutate(
      { ...pendingCreate, override: { reason: overrideReason } },
      {
        onError: (err: any) => {
          if (err?.body?.error === 'DUPLICATE_VENDOR_OVERRIDE_FORBIDDEN') {
            setOverrideForbidden(true);
            return;
          }
          handleMutationError(err);
        },
      },
    );
  };

  const handleNew = () => {
    setSelectedId(null);
    setForm(emptyForm());
    setIsDirty(false);
    setIsNew(true);
    setSection('address');
    navigate('/accounting/ap/vendors', { replace: true });
  };

  const filteredVendors = vendors.filter(v =>
    !search ||
    v.vendorNumber?.toLowerCase().includes(search.toLowerCase()) ||
    v.vendorName?.toLowerCase().includes(search.toLowerCase())
  );

  const selectedVendor = vendors.find((v: any) => v.id === selectedId) as any;
  const isEligibleActions = !!vendorDetail && vendorDetail.status !== 'DELETED';

  if (listLoading) return <PageLoader page="Vendor Maintenance" service="apar-service" port={3013} />;

  if (listError) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-400" />
          <p className="text-sm text-gray-600 mb-3">Could not load vendors.</p>
          <button onClick={() => refetchList()} className="text-sm text-brand hover:underline inline-flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* LEFT PANEL — Vendor List */}
      <div className="w-64 border-r flex flex-col bg-white">
        <div className="p-3 border-b space-y-2">
          <h2 className="font-bold text-sm uppercase text-gray-600">Vendors</h2>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-8 pr-2 py-1.5 text-sm border rounded focus:ring-2 focus:ring-brand focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full border rounded px-2 py-1.5 text-sm"
          >
            <option value="">Active + Inactive</option>
            <option value="ACTIVE">Active only</option>
            <option value="INACTIVE">Inactive only</option>
          </select>
          <button
            onClick={handleNew}
            className="w-full flex items-center justify-center gap-1.5 bg-brand text-white py-1.5 rounded text-sm font-medium hover:bg-brand"
          >
            <Plus className="w-3.5 h-3.5" />
            New Vendor
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {filteredVendors.map((v: any) => (
            <button
              key={v.id}
              onClick={() => {
                setSelectedId(v.id);
                setIsNew(false);
                navigate(`/accounting/ap/vendors/${v.id}`);
              }}
              className={`w-full text-left px-3 py-2 border-b hover:bg-brand-light flex items-center justify-between ${
                v.id === selectedId ? 'bg-brand-light border-l-2 border-l-blue-600' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                  {v.vendorName}
                  {v.status === 'INACTIVE' && <span className="text-[10px] uppercase font-bold text-gray-400">Inactive</span>}
                </div>
                <div className="text-xs font-mono text-gray-500">{v.vendorNumber}</div>
              </div>
              {v.holdPayments && (
                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Hold</span>
              )}
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 ml-1" />
            </button>
          ))}
          {filteredVendors.length === 0 && (
            <p className="text-center text-xs text-gray-400 py-8">No vendors found</p>
          )}
        </div>
      </div>

      {/* RIGHT PANEL — Detail Form */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
        {(!selectedId && !isNew) ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <UserX className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">Select a vendor or click New Vendor</p>
            </div>
          </div>
        ) : detailError ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              {(detailErrorObj as any)?.status === 403 ? (
                <>
                  <ShieldOff className="w-10 h-10 mx-auto mb-3 text-amber-400" />
                  <p className="text-sm text-gray-600">You don't have permission to view this vendor.</p>
                </>
              ) : (
                <>
                  <AlertCircle className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm text-gray-600">Vendor not found.</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Detail Header */}
            <div className="bg-white border-b px-6 py-3 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg flex items-center gap-2">
                  {isNew ? 'New Vendor' : (selectedVendor?.vendorName ?? vendorDetail?.vendorName ?? 'Vendor Detail')}
                  {!isNew && <StatusBadge status={vendorDetail?.status ?? selectedVendor?.status} />}
                </h2>
                {!isNew && (selectedVendor || vendorDetail) && (
                  <p className="text-xs text-gray-500 font-mono">#{(selectedVendor ?? vendorDetail)?.vendorNumber}</p>
                )}
              </div>
              <div className="flex gap-2 items-center">
                {notification && (
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm ${
                    notification.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {notification.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {notification.msg}
                  </div>
                )}
                {!isNew && vendorDetail?.status === 'ACTIVE' && (
                  <button
                    onClick={() => setConfirmInactivate(true)}
                    className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded hover:bg-red-50"
                  >
                    <UserX className="w-3.5 h-3.5 inline mr-1" />
                    Inactivate
                  </button>
                )}
                {!isNew && vendorDetail?.status === 'INACTIVE' && (
                  <>
                    <button
                      onClick={() => setConfirmReactivate(true)}
                      className="text-xs border border-green-200 text-green-700 px-3 py-1.5 rounded hover:bg-green-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5 inline mr-1" />
                      Reactivate
                    </button>
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="text-xs border border-red-300 text-red-700 px-3 py-1.5 rounded hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </>
                )}
                {isEligibleActions && (
                  <button
                    onClick={handleSave}
                    disabled={saveMut.isPending || vendorDetail?.status === 'INACTIVE'}
                    className="flex items-center gap-2 bg-brand text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-brand disabled:opacity-40"
                  >
                    <Check className="w-4 h-4" />
                    {saveMut.isPending ? 'Saving...' : isDirty ? 'Save *' : 'Save'}
                  </button>
                )}
                {isNew && (
                  <button
                    onClick={handleSave}
                    disabled={saveMut.isPending}
                    className="flex items-center gap-2 bg-brand text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-brand disabled:opacity-40"
                  >
                    <Check className="w-4 h-4" />
                    {saveMut.isPending ? 'Saving...' : 'Save'}
                  </button>
                )}
              </div>
            </div>

            {unauthorized && (
              <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center gap-2 text-sm text-amber-800">
                <ShieldOff className="w-4 h-4" /> {unauthorized}
                <button className="ml-auto text-xs underline" onClick={() => setUnauthorized(null)}>Dismiss</button>
              </div>
            )}

            {/* Section Tabs */}
            <div className="bg-white border-b px-6 flex gap-0">
              {SECTIONS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    section === s.key
                      ? 'border-blue-600 text-brand'
                      : 'border-transparent text-gray-600 hover:text-gray-800'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Form Body */}
            <div className="flex-1 overflow-auto p-6">
              {detailLoading ? (
                <p className="text-sm text-gray-400">Loading...</p>
              ) : (
                <>
                  {vendorDetail?.status === 'INACTIVE' && (
                    <div className="mb-4 flex items-start gap-2 p-3 bg-gray-100 border border-gray-300 rounded-lg">
                      <UserX className="w-4 h-4 text-gray-500 mt-0.5 shrink-0" />
                      <div className="text-sm text-gray-700">
                        <p className="font-medium">This vendor is inactive.</p>
                        <p>New-invoice eligibility is blocked. Reactivate to resume use.</p>
                        {vendorDetail.inactiveReason && <p className="text-gray-500 mt-1">Reason: {vendorDetail.inactiveReason}</p>}
                      </div>
                    </div>
                  )}

                  {/* Always-visible top row */}
                  <div className="bg-white rounded-lg shadow p-5 mb-4 grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Vendor Number</label>
                      <input
                        type="text"
                        value={form.vendorNumber}
                        onChange={e => setField('vendorNumber', e.target.value.slice(0, 20))}
                        placeholder="Auto-assigned if blank"
                        disabled={!isNew}
                        className={`w-full border rounded px-3 py-2 text-sm font-mono ${!isNew ? 'bg-gray-50 text-gray-500' : ''}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Vendor Name *</label>
                      <input
                        type="text"
                        value={form.vendorName}
                        onChange={e => setField('vendorName', e.target.value)}
                        placeholder="Company or individual name"
                        disabled={vendorDetail?.status === 'INACTIVE'}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Vendor Type</label>
                      <select
                        value={form.vendorType}
                        onChange={e => setField('vendorType', e.target.value)}
                        disabled={vendorDetail?.status === 'INACTIVE'}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                      >
                        {VENDOR_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Section: Address */}
                  {section === 'address' && (
                    <div className="bg-white rounded-lg shadow p-5 grid grid-cols-2 gap-4">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">DBA (Doing Business As)</label>
                        <input type="text" value={form.dba} onChange={e => setField('dba', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Address Line 1</label>
                        <input type="text" value={form.address1} onChange={e => setField('address1', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Address Line 2</label>
                        <input type="text" value={form.address2} onChange={e => setField('address2', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                        <input type="text" value={form.city} onChange={e => setField('city', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                          <input type="text" value={form.state} onChange={e => setField('state', e.target.value.toUpperCase().slice(0, 2))} maxLength={2} className="w-full border rounded px-3 py-2 text-sm font-mono" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">ZIP</label>
                          <input type="text" value={form.zip} onChange={e => setField('zip', e.target.value.slice(0, 10))} maxLength={10} className="w-full border rounded px-3 py-2 text-sm font-mono" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Hold Payments</label>
                        <label className="flex items-center gap-2 mt-2 cursor-pointer">
                          <input type="checkbox" checked={form.holdPayments} onChange={e => setField('holdPayments', e.target.checked)} className="rounded" />
                          <span className={`text-sm font-medium ${form.holdPayments ? 'text-red-600' : 'text-gray-600'}`}>
                            {form.holdPayments ? 'HOLD — no payments issued' : 'Payments allowed'}
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Section: Contact */}
                  {section === 'contact' && (
                    <div className="bg-white rounded-lg shadow p-5 grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Contact Name</label>
                        <input type="text" value={form.contactName} onChange={e => setField('contactName', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                        <input type="text" value={form.phone} onChange={e => setField('phone', e.target.value)} className="w-full border rounded px-3 py-2 text-sm font-mono" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Fax</label>
                        <input type="text" value={form.fax} onChange={e => setField('fax', e.target.value)} className="w-full border rounded px-3 py-2 text-sm font-mono" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                        <input type="email" value={form.email} onChange={e => setField('email', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                        <textarea value={form.notes} onChange={e => setField('notes', e.target.value)} rows={4} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                    </div>
                  )}

                  {/* Section: Tax / 1099 */}
                  {section === 'tax' && (
                    <div className="bg-white rounded-lg shadow p-5 grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Tax ID (EIN/SSN)</label>
                        <div className="w-full border rounded px-3 py-2 text-sm font-mono bg-gray-50 text-gray-500 flex items-center gap-2">
                          <Lock className="w-3.5 h-3.5" />
                          {!isNew && vendorDetail?.taxIdMasked ? vendorDetail.taxIdMasked : 'Not on file'}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          Create/edit disabled pending an approved encrypted-field platform mechanism (security dependency — see S036A blockers). Masked to last 4 digits; full reveal is not available in this release.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">1099 Type</label>
                        <input type="text" value={form.income1099Type} onChange={e => setField('income1099Type', e.target.value)} placeholder="MISC / NEC / INT" className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={form.is1099Misc} onChange={e => setField('is1099Misc', e.target.checked)} className="rounded" />
                          <span className="text-sm font-medium">1099-MISC</span>
                        </label>
                      </div>
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={form.is1099Nec} onChange={e => setField('is1099Nec', e.target.checked)} className="rounded" />
                          <span className="text-sm font-medium">1099-NEC</span>
                        </label>
                      </div>
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={form.w9OnFile} onChange={e => setField('w9OnFile', e.target.checked)} className="rounded" />
                          <span className="text-sm font-medium">W-9 on File</span>
                        </label>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">W-9 Received Date</label>
                        <input type="date" value={form.w9ReceivedDate} onChange={e => setField('w9ReceivedDate', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                    </div>
                  )}

                  {/* Section: Payment Terms */}
                  {section === 'payment' && (
                    <div className="bg-white rounded-lg shadow p-5 grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms</label>
                        <select value={form.paymentTerms} onChange={e => setField('paymentTerms', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                          <option>Net30</option>
                          <option>Net15</option>
                          <option>Net10</option>
                          <option>Net60</option>
                          <option>Net90</option>
                          <option>Due on Receipt</option>
                          <option>COD</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
                        <select value={form.paymentMethod} onChange={e => setField('paymentMethod', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                          <option>Check</option>
                          <option>ACH</option>
                          <option>Wire</option>
                          <option>Credit Card</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Discount % (if paid early)</label>
                        <input type="number" step="0.01" min="0" max="100" value={form.discountPercent} onChange={e => setField('discountPercent', e.target.value)} className="w-full border rounded px-3 py-2 text-sm text-right font-mono" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Discount Days</label>
                        <input type="number" min="0" value={form.discountDays} onChange={e => setField('discountDays', e.target.value)} className="w-full border rounded px-3 py-2 text-sm text-right font-mono" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Default GL Account</label>
                        <input type="text" value={form.defaultGlAccount} onChange={e => setField('defaultGlAccount', e.target.value)} className="w-full border rounded px-3 py-2 text-sm font-mono" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Default Expense Account</label>
                        <input type="text" value={form.defaultExpenseAccount} onChange={e => setField('defaultExpenseAccount', e.target.value)} className="w-full border rounded px-3 py-2 text-sm font-mono" />
                      </div>
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer mt-2">
                          <input type="checkbox" checked={form.separateCheck} onChange={e => setField('separateCheck', e.target.checked)} className="rounded" />
                          <span className="text-sm font-medium">Separate Check Per Invoice</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Section: Banking — S036A: out of scope, hidden/disabled */}
                  {section === 'banking' && (
                    <div className="bg-white rounded-lg shadow p-5">
                      <p className="text-sm text-gray-500 flex items-start gap-2">
                        <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                        Banking information and payment-run functionality are out of scope for vendor-master
                        maintenance. Bank account setup is managed elsewhere and is not editable from this screen.
                      </p>
                    </div>
                  )}

                  {/* Section: Audit History */}
                  {section === 'audit' && (
                    <div className="bg-white rounded-lg shadow p-5">
                      {auditLoading ? (
                        <p className="text-sm text-gray-400">Loading audit history...</p>
                      ) : auditError ? (
                        <p className="text-sm text-red-600">Could not load audit history.</p>
                      ) : !auditEvents || (auditEvents as any[]).length === 0 ? (
                        <p className="text-sm text-gray-400">No audit events recorded yet.</p>
                      ) : (
                        <ul className="space-y-3">
                          {(auditEvents as any[]).map((e: any, i: number) => (
                            <li key={e.id ?? i} className="flex items-start gap-3 text-sm border-b pb-2 last:border-0">
                              <History className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                              <div>
                                <p className="font-medium">{e.action}</p>
                                <p className="text-xs text-gray-500">
                                  {e.actorName ?? e.actorId ?? 'system'} · {e.occurredAt ? new Date(e.occurredAt).toLocaleString() : ''}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Inactivate Confirmation */}
      {confirmInactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-6 space-y-4">
            <h3 className="font-bold text-lg text-red-700">Inactivate Vendor?</h3>
            <p className="text-sm text-gray-600">
              {vendorDetail?.vendorName} will be inactivated. New invoices will be blocked. Existing invoices are not affected.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason *</label>
              <textarea value={inactivateReason} onChange={e => setInactivateReason(e.target.value)} rows={2} className="w-full border rounded px-3 py-2 text-sm" placeholder="Required" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setConfirmInactivate(false); setInactivateReason(''); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => inactivateMut.mutate()}
                disabled={inactivateMut.isPending || !inactivateReason.trim()}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                {inactivateMut.isPending ? 'Inactivating...' : 'Inactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reactivate Confirmation */}
      {confirmReactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-6 space-y-4">
            <h3 className="font-bold text-lg text-green-700">Reactivate Vendor?</h3>
            <p className="text-sm text-gray-600">
              {vendorDetail?.vendorName} will become active again and be eligible for new invoices.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmReactivate(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => reactivateMut.mutate()}
                disabled={reactivateMut.isPending}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40"
              >
                {reactivateMut.isPending ? 'Reactivating...' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation / Reference Conflict */}
      {(confirmDelete || deleteConflict) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-6 space-y-4">
            {deleteConflict ? (
              <>
                <h3 className="font-bold text-lg text-red-700">Cannot Delete Vendor</h3>
                <p className="text-sm text-gray-600">
                  This vendor is referenced by {deleteConflict.purchaseOrders} purchase order(s) and {deleteConflict.apEntries} AP invoice(s).
                  Referenced vendors cannot be deleted — inactivate it instead.
                </p>
                <div className="flex justify-end">
                  <button onClick={() => setDeleteConflict(null)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-bold text-lg text-red-700">Delete Vendor?</h3>
                <p className="text-sm text-gray-600">
                  This is a logical delete — the vendor will no longer appear in vendor lookups, but its audit history is retained.
                  This is only possible if the vendor has no referencing transactions.
                </p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Reason (optional)</label>
                  <input value={deleteReason} onChange={e => setDeleteReason(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
                </div>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setConfirmDelete(false); setDeleteReason(''); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteMut.mutate()}
                    disabled={deleteMut.isPending}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
                  >
                    {deleteMut.isPending ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Version Conflict */}
      {versionConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-base text-amber-700">This vendor changed</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Someone else updated this vendor since you loaded it. Reload to see the latest version before trying again.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setVersionConflict(false);
                  queryClient.invalidateQueries({ queryKey: ['vendor', selectedId] });
                  queryClient.invalidateQueries({ queryKey: ['vendors'] });
                }}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700"
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      )}

      {/* S036A: Duplicate-vendor warning dialog */}
      {dupCandidates && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-[480px] p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-base text-amber-700">Possible Duplicate Vendor{dupCandidates.length > 1 ? 's' : ''}</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {dupCandidates.length} existing vendor{dupCandidates.length > 1 ? 's' : ''} may match this one:
                </p>
              </div>
            </div>
            <ul className="space-y-2 max-h-48 overflow-auto">
              {dupCandidates.map((c: any) => (
                <li key={c.vendorId} className="border rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{c.vendorName} <span className="font-mono text-xs text-gray-500">#{c.vendorNumber}</span></p>
                    <p className="text-xs text-gray-500">Matched: {c.matchedSignals?.join(', ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={c.status} />
                    <button
                      className="text-xs text-brand hover:underline"
                      onClick={() => { setDupCandidates(null); setPendingCreate(null); navigate(`/accounting/ap/vendors/${c.vendorId}`); }}
                    >
                      Open
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason to create anyway *</label>
              <input value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder="Required to override" />
            </div>
            {overrideForbidden && (
              <p className="text-xs text-red-600 flex items-center gap-1"><ShieldOff className="w-3.5 h-3.5" /> You don't have permission to create a vendor anyway. Ask an administrator.</p>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => { setDupCandidates(null); setPendingCreate(null); setOverrideReason(''); setOverrideForbidden(false); }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAnyway}
                disabled={!overrideReason.trim() || saveMut.isPending}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-40"
              >
                Create Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
