import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Check, AlertCircle, UserX, RefreshCw, ChevronRight, AlertTriangle } from 'lucide-react';
import { aparApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';

interface VendorForm {
  vendorNumber: string;
  vendorName: string;
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
  taxId: string;
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
  bankName: string;
  bankRoutingNumber: string;
  bankAccountNumber: string;
  bankAccountType: string;
  separateCheck: boolean;
  holdPayments: boolean;
  defaultExpenseAccount: string;
  notes: string;
}

const emptyForm = (): VendorForm => ({
  vendorNumber: '', vendorName: '', dba: '', contactName: '',
  phone: '', fax: '', email: '',
  address1: '', address2: '', city: '', state: '', zip: '',
  taxId: '', is1099Misc: false, is1099Nec: false, income1099Type: '', w9OnFile: false, w9ReceivedDate: '',
  paymentTerms: 'Net30', defaultGlAccount: '', paymentMethod: 'Check',
  discountPercent: '0', discountDays: '0',
  bankName: '', bankRoutingNumber: '', bankAccountNumber: '', bankAccountType: '',
  separateCheck: false, holdPayments: false, defaultExpenseAccount: '', notes: '',
});

const vendorToForm = (v: any): VendorForm => ({
  vendorNumber: v.vendorNumber ?? '',
  vendorName: v.vendorName ?? '',
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
  taxId: v.taxId ?? '',
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
  bankName: v.bankName ?? '',
  bankRoutingNumber: v.bankRoutingNumber ?? '',
  bankAccountNumber: v.bankAccountNumber ?? '',
  bankAccountType: v.bankAccountType ?? '',
  separateCheck: v.separateCheck ?? false,
  holdPayments: v.holdPayments ?? false,
  defaultExpenseAccount: v.defaultExpenseAccount ?? '',
  notes: v.notes ?? '',
});

type Section = 'address' | 'contact' | 'tax' | 'payment' | 'banking';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'address',  label: 'Address' },
  { key: 'contact',  label: 'Contact' },
  { key: 'tax',      label: 'Tax / 1099' },
  { key: 'payment',  label: 'Payment Terms' },
  { key: 'banking',  label: 'Banking' },
];

export default function VendorMaintenance() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(id ?? null);
  const [form, setForm] = useState<VendorForm>(emptyForm());
  const [section, setSection] = useState<Section>('address');
  const [isDirty, setIsDirty] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  // S7-06: duplicate tax ID warning state
  const [dupTaxIdWarning, setDupTaxIdWarning] = useState<{ name: string; vendorNumber: string } | null>(null);

  // Sync URL param → selectedId
  useEffect(() => { if (id) setSelectedId(id); }, [id]);

  const { data: vendors, isLoading: listLoading, refetch } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => aparApi.getVendors(),
    retry: false,
  });

  const { data: vendorDetail, isLoading: detailLoading } = useQuery({
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
      setSelectedId(result.id);
      navigate(`/accounting/ap/vendors/${result.id}`, { replace: true });
      setNotification({ type: 'success', msg: 'Vendor saved.' });
      setTimeout(() => setNotification(null), 3000);
    },
    onError: (err: any) => {
      setNotification({ type: 'error', msg: err.message || 'Save failed' });
    },
  });

  const deactivateMut = useMutation({
    mutationFn: () => aparApi.deactivateVendor(selectedId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      setConfirmDeactivate(false);
      setSelectedId(null);
      setForm(emptyForm());
      setNotification({ type: 'success', msg: 'Vendor deactivated.' });
      navigate('/accounting/ap/vendors', { replace: true });
      setTimeout(() => setNotification(null), 3000);
    },
  });

  // S7-07: YTD payments query for 1099 threshold badge
  const is1099Eligible = form.is1099Misc || form.is1099Nec;
  const { data: ytdData } = useQuery({
    queryKey: ['vendor-ytd', selectedId],
    queryFn: () => aparApi.getVendorYtdPayments(selectedId!),
    enabled: !!selectedId && !isNew && is1099Eligible,
    retry: false,
  });
  const ytdTotal: number = (ytdData as any)?.ytdTotal ?? 0;

  // S7-06: blur handler for tax ID duplicate detection
  async function handleTaxIdBlur() {
    const taxId = form.taxId.trim();
    if (!taxId || taxId.length < 4) return;
    try {
      const matches = await aparApi.getVendorsByTaxId(taxId) as any[];
      const others = matches.filter((v: any) => v.id !== selectedId);
      if (others.length > 0) {
        setDupTaxIdWarning({ name: others[0].vendorName, vendorNumber: others[0].vendorNumber ?? others[0].id });
      }
    } catch {
      // best-effort
    }
  }

  const setField = (field: keyof VendorForm, val: any) => {
    setForm(prev => ({ ...prev, [field]: val }));
    setIsDirty(true);
  };

  const handleSave = () => {
    if (!form.vendorName.trim()) {
      setNotification({ type: 'error', msg: 'Vendor name is required.' });
      return;
    }
    const payload = {
      ...form,
      discountPercent: parseFloat(form.discountPercent) || 0,
      discountDays: parseInt(form.discountDays) || 0,
      w9ReceivedDate: form.w9ReceivedDate || undefined,
      vendorNumber: form.vendorNumber || undefined,
    };
    saveMut.mutate(payload);
  };

  const handleNew = () => {
    setSelectedId(null);
    setForm(emptyForm());
    setIsDirty(false);
    setIsNew(true);
    setSection('address');
    navigate('/accounting/ap/vendors', { replace: true });
  };

  const filteredVendors = ((vendors ?? []) as any[]).filter(v =>
    !search ||
    v.vendorNumber?.toLowerCase().includes(search.toLowerCase()) ||
    v.vendorName?.toLowerCase().includes(search.toLowerCase())
  );

  const selectedVendor = (vendors ?? []).find((v: any) => v.id === selectedId) as any;

  if (listLoading) return <PageLoader page="Vendor Maintenance" service="apar-service" port={3013} />;

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
              <div>
                <div className="text-sm font-medium truncate">{v.vendorName}</div>
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
        ) : (
          <>
            {/* Detail Header */}
            <div className="bg-white border-b px-6 py-3 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">
                  {isNew ? 'New Vendor' : (selectedVendor?.vendorName ?? 'Vendor Detail')}
                </h2>
                {!isNew && selectedVendor && (
                  <p className="text-xs text-gray-500 font-mono">#{selectedVendor.vendorNumber}</p>
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
                {!isNew && selectedId && (
                  <button
                    onClick={() => setConfirmDeactivate(true)}
                    className="text-xs border border-red-200 text-red-600 px-3 py-1.5 rounded hover:bg-red-50"
                  >
                    <UserX className="w-3.5 h-3.5 inline mr-1" />
                    Deactivate
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saveMut.isPending}
                  className="flex items-center gap-2 bg-brand text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-brand disabled:opacity-40"
                >
                  <Check className="w-4 h-4" />
                  {saveMut.isPending ? 'Saving...' : isDirty ? 'Save *' : 'Save'}
                </button>
              </div>
            </div>

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
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Vendor Name *</label>
                      <input
                        type="text"
                        value={form.vendorName}
                        onChange={e => setField('vendorName', e.target.value)}
                        placeholder="Company or individual name"
                        className="w-full border rounded px-3 py-2 text-sm"
                      />
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
                        <input
                          type="text"
                          value={form.taxId}
                          onChange={e => setField('taxId', e.target.value)}
                          onBlur={handleTaxIdBlur}
                          placeholder="XX-XXXXXXX"
                          className="w-full border rounded px-3 py-2 text-sm font-mono"
                        />
                        <p className="text-xs text-gray-400 mt-1">Stored encrypted. Masked in display.</p>
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

                      {/* S7-07: YTD 1099 threshold badge */}
                      {is1099Eligible && selectedId && !isNew && (
                        <div className="col-span-2 flex items-center gap-3 p-3 rounded-lg border bg-gray-50">
                          <span className="text-xs font-medium text-gray-600">YTD Payments (1099 Threshold):</span>
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            ytdTotal >= 600
                              ? 'bg-green-100 text-green-800'
                              : ytdTotal > 0
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            ${ytdTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {ytdTotal >= 600 ? ' ✓ Threshold Met' : ytdTotal > 0 ? ' — Below $600' : ' — No Payments'}
                          </span>
                        </div>
                      )}

                      {/* S7-07: W-9 warnings */}
                      {is1099Eligible && !form.w9OnFile && (
                        <div className="col-span-2 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                          <p className="text-sm text-red-700">W-9 not on file. Required before issuing 1099.</p>
                        </div>
                      )}
                      {is1099Eligible && form.w9OnFile && form.w9ReceivedDate && (() => {
                        const received = new Date(form.w9ReceivedDate);
                        const threeYearsAgo = new Date();
                        threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
                        return received < threeYearsAgo;
                      })() && (
                        <div className="col-span-2 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                          <p className="text-sm text-amber-700">W-9 on file is over 3 years old. Consider requesting a new W-9.</p>
                        </div>
                      )}
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

                  {/* Section: Banking */}
                  {section === 'banking' && (
                    <div className="bg-white rounded-lg shadow p-5 grid grid-cols-2 gap-4">
                      <p className="col-span-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                        Bank information is sensitive. Only users with AP Admin role can view account numbers.
                      </p>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Bank Name</label>
                        <input type="text" value={form.bankName} onChange={e => setField('bankName', e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Account Type</label>
                        <select value={form.bankAccountType} onChange={e => setField('bankAccountType', e.target.value)} className="w-full border rounded px-3 py-2 text-sm">
                          <option value="">— Select —</option>
                          <option>Checking</option>
                          <option>Savings</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Routing Number</label>
                        <input
                          type="text"
                          value={form.bankRoutingNumber}
                          onChange={e => setField('bankRoutingNumber', e.target.value.replace(/\D/g, '').slice(0, 9))}
                          maxLength={9}
                          placeholder="9 digits"
                          className="w-full border rounded px-3 py-2 text-sm font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Account Number</label>
                        <input
                          type="text"
                          value={form.bankAccountNumber}
                          onChange={e => setField('bankAccountNumber', e.target.value)}
                          placeholder="Stored encrypted"
                          className="w-full border rounded px-3 py-2 text-sm font-mono"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Deactivate Confirmation */}
      {confirmDeactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-6 space-y-4">
            <h3 className="font-bold text-lg text-red-700">Deactivate Vendor?</h3>
            <p className="text-sm text-gray-600">
              {selectedVendor?.vendorName} will be deactivated and will no longer appear in AP invoice lookups.
              Existing invoices are not affected. This can be reversed by an administrator.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDeactivate(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => deactivateMut.mutate()}
                disabled={deactivateMut.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                {deactivateMut.isPending ? 'Deactivating...' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* S7-06: Duplicate Tax ID warning dialog */}
      {dupTaxIdWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-base text-amber-700">Duplicate Tax ID Detected</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Another vendor already has this Tax ID on file:
                </p>
                <p className="text-sm font-semibold text-gray-800 mt-1">
                  {dupTaxIdWarning.name} (Vendor# {dupTaxIdWarning.vendorNumber})
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  This may be a duplicate vendor. Review before saving.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => { setField('taxId', ''); setDupTaxIdWarning(null); }}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Clear Tax ID
              </button>
              <button
                onClick={() => setDupTaxIdWarning(null)}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700"
              >
                Continue Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
