import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search, Plus, Save, X, AlertTriangle, ChevronDown, ChevronRight,
  User, Car, FileText, MapPin, Clock, AlertCircle, Check, Loader2,
  ArrowRight,
} from 'lucide-react';
import { aparApi, glApi } from '../../api/client';
import GLAccountLookup from '../../components/accounting/GLAccountLookup';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Customer {
  id?: string;
  customerNumber?: string;
  customerName: string;
  customerType: 'Individual' | 'Business' | 'Government' | 'Fleet';
  salespersonCode?: string;
  arAccountOverride?: string;
  companyNumber?: string;
  taxId?: string;
  taxExemptStatus: boolean;
  taxExemptCertNumber?: string;
  taxExemptExpiration?: string;
  creditLimit: number;
  creditTerms: string;
  preferredContactMethod: string;
  customerSince?: string;
  doNotSolicit: boolean;
  doNotMail: boolean;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  phone2?: string;
  fax?: string;
  email?: string;
  secondaryStreet?: string;
  secondaryCity?: string;
  secondaryState?: string;
  secondaryZip?: string;
  secondaryCountry?: string;
  addressLabel?: string;
  flagAR?: boolean;
  flagVehicle?: boolean;
  flagParts?: boolean;
  flagService?: boolean;
  flagFI?: boolean;
  employeeFlag?: boolean;
  notes?: { timestamp: string; user: string; text: string }[];
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

type SearchMode = 'name' | 'number' | 'phone';
type DetailTab = 'module-data' | 'vehicle' | 'notes' | 'address' | 'audit';

const CREDIT_TERMS = ['COD', 'Net10', 'Net15', 'Net30', 'Net45', 'Net60'];
const CONTACT_METHODS = ['Phone', 'Email', 'Mail', 'Text'];
const CUSTOMER_TYPES = ['Individual', 'Business', 'Government', 'Fleet'] as const;

function emptyCustomer(): Customer {
  return {
    customerName: '',
    customerType: 'Individual',
    taxExemptStatus: false,
    creditLimit: 0,
    creditTerms: 'Net30',
    preferredContactMethod: 'Phone',
    doNotSolicit: false,
    doNotMail: false,
    country: 'US',
    flagAR: true,
  };
}

// ─── Name Database System Flags ──────────────────────────────────────────────

function SystemFlags({ c }: { c: Customer }) {
  const codes = [
    c.flagAR && 'A',
    c.flagVehicle && 'V',
    c.flagParts && 'P',
    c.flagService && 'S',
    c.flagFI && 'F',
    c.employeeFlag && 'E',
  ].filter(Boolean);
  if (codes.length === 0) return <span className="text-gray-400 text-xs">—</span>;
  return (
    <span className="font-mono text-xs tracking-widest">
      {codes.join('')}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CustomerMaintenance() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>('name');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [formData, setFormData] = useState<Customer>(emptyCustomer());
  const [activeTab, setActiveTab] = useState<DetailTab>('module-data');
  const [duplicates, setDuplicates] = useState<any[]>([]);
  const [showDupWarning, setShowDupWarning] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const notify = (type: 'success' | 'error', msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 4000);
  };

  // Search query
  const searchParams = searchInput
    ? `?q=${encodeURIComponent(searchInput)}&mode=${searchMode}`
    : undefined;

  const { data: customers, isFetching } = useQuery({
    queryKey: ['customers', searchInput, searchMode],
    queryFn: () => aparApi.getCustomers(searchParams),
    staleTime: 30_000,
  });

  // Load selected customer
  const { data: selectedCustomer } = useQuery({
    queryKey: ['customer', selectedId],
    queryFn: () => selectedId ? aparApi.getCustomer(selectedId) : Promise.resolve(null),
    enabled: !!selectedId && !isNew,
  });

  useEffect(() => {
    if (selectedCustomer) setFormData(selectedCustomer);
  }, [selectedCustomer]);

  const set = (key: keyof Customer, val: any) => setFormData(prev => ({ ...prev, [key]: val }));

  // Mutations
  const createMut = useMutation({
    mutationFn: (data: Customer) => aparApi.createCustomer(data),
    onSuccess: (res) => {
      if (res.duplicateCandidates?.length > 0 && !showDupWarning) {
        setDuplicates(res.duplicateCandidates);
        setShowDupWarning(true);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setSelectedId(res.id);
      setIsNew(false);
      setDuplicates([]);
      setShowDupWarning(false);
      notify('success', `Customer ${res.customerNumber} created.`);
    },
    onError: (err: any) => notify('error', err.message ?? 'Save failed'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Customer }) => aparApi.updateCustomer(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', selectedId] });
      notify('success', 'Customer updated.');
    },
    onError: (err: any) => notify('error', err.message ?? 'Save failed'),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => aparApi.deactivateCustomer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setSelectedId(null);
      setIsNew(false);
      setFormData(emptyCustomer());
      setConfirmDeactivate(false);
      notify('success', 'Customer deactivated.');
    },
    onError: (err: any) => notify('error', err.message ?? 'Deactivate failed'),
  });

  const handleSave = () => {
    setShowDupWarning(false);
    if (isNew) createMut.mutate(formData);
    else if (selectedId) updateMut.mutate({ id: selectedId, data: formData });
  };

  const handleNewCustomer = () => {
    setSelectedId(null);
    setIsNew(true);
    setFormData(emptyCustomer());
    setActiveTab('module-data');
    setDuplicates([]);
    setShowDupWarning(false);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const handleCancel = () => {
    setIsNew(false);
    if (!selectedId) setFormData(emptyCustomer());
    else setFormData(selectedCustomer ?? emptyCustomer());
    setDuplicates([]);
    setShowDupWarning(false);
  };

  const handleAddNote = () => {
    if (!newNoteText.trim()) return;
    const entry = { timestamp: new Date().toISOString(), user: 'Current User', text: newNoteText };
    set('notes', [...(formData.notes ?? []), entry]);
    setNewNoteText('');
  };

  // Duplicate detection on name blur
  const handleNameBlur = async () => {
    if (!isNew || !formData.customerName.trim()) return;
    const res = await aparApi.getCustomers(`?q=${encodeURIComponent(formData.customerName)}&mode=name`);
    if (res && (res as any[]).length > 0) {
      setDuplicates(res as any[]);
      setShowDupWarning(true);
    }
  };

  const isSaving = createMut.isPending || updateMut.isPending;
  const isEditing = isNew || !!selectedId;

  const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString('en-US') : '—';
  const fmtAmt = (n: any) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

  return (
    <div className="flex h-full gap-0 bg-gray-100 min-h-screen">
      {/* ── LEFT PANEL: Customer Search ──────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        {/* Search header */}
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-sm text-gray-800">Customer Maintenance</h2>
            <button
              onClick={handleNewCustomer}
              className="flex items-center gap-1 bg-brand text-white text-xs px-2.5 py-1.5 rounded hover:bg-brand"
            >
              <Plus className="w-3.5 h-3.5" />
              New
            </button>
          </div>

          {/* Search mode toggle */}
          <div className="flex border rounded-lg overflow-hidden text-xs font-medium">
            {(['name', 'number', 'phone'] as SearchMode[]).map(m => (
              <button
                key={m}
                onClick={() => setSearchMode(m)}
                className={`flex-1 py-1.5 capitalize transition-colors ${
                  searchMode === m ? 'bg-brand text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {m === 'number' ? 'Control#' : m === 'phone' ? 'Phone' : 'Name'}
              </button>
            ))}
          </div>

          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={
                searchMode === 'name' ? 'Search by name...' :
                searchMode === 'number' ? 'Control number...' :
                'Phone number...'
              }
              className="w-full pl-8 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand"
            />
            {isFetching && <Loader2 className="absolute right-2.5 top-2 w-3.5 h-3.5 text-gray-400 animate-spin" />}
          </div>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-auto">
          {((customers ?? []) as Customer[]).map((c: any) => (
            <div
              key={c.id}
              onClick={() => { setSelectedId(c.id); setIsNew(false); setActiveTab('module-data'); }}
              className={`px-3 py-2.5 border-b cursor-pointer hover:bg-brand-light transition-colors ${
                selectedId === c.id ? 'bg-brand-light border-l-2 border-l-blue-600' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 truncate">{c.customerName}</p>
                  <p className="text-xs text-gray-500 font-mono">{c.customerNumber}</p>
                </div>
                <SystemFlags c={c} />
              </div>
              {(c.city || c.state) && (
                <p className="text-xs text-gray-400 mt-0.5">{[c.city, c.state].filter(Boolean).join(', ')}</p>
              )}
              {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                c.customerType === 'Fleet' ? 'bg-purple-100 text-purple-700' :
                c.customerType === 'Business' ? 'bg-brand-light text-brand' :
                c.customerType === 'Government' ? 'bg-green-100 text-green-700' :
                'bg-gray-100 text-gray-600'
              }`}>{c.customerType}</span>
            </div>
          ))}
          {(customers ?? []).length === 0 && searchInput && !isFetching && (
            <p className="text-xs text-gray-400 text-center py-8">No customers found</p>
          )}
          {!searchInput && !isFetching && (
            <p className="text-xs text-gray-400 text-center py-8">Type to search customers</p>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL: Customer Detail ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!isEditing ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <User className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Select a customer or click New</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-5 space-y-4">
            {/* Notification */}
            {notification && (
              <div className={`px-4 py-3 rounded-lg flex items-center gap-2 text-sm ${
                notification.type === 'success'
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {notification.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                {notification.msg}
              </div>
            )}

            {/* Employee Guard — S5-02 */}
            {formData.employeeFlag && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-800 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="font-medium">This record is an employee. Edit in Payroll module.</span>
                </div>
                <button className="flex items-center gap-1.5 text-amber-700 border border-amber-300 px-3 py-1.5 rounded text-xs hover:bg-amber-100">
                  Go to Payroll <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Duplicate Warning */}
            {showDupWarning && duplicates.length > 0 && (
              <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-800 mb-2">
                      Possible duplicates found — continue creating?
                    </p>
                    <ul className="text-xs text-amber-700 space-y-0.5 mb-3">
                      {duplicates.slice(0, 5).map((d: any) => (
                        <li key={d.id}>
                          #{d.customerNumber} — {d.customerName}
                          <button
                            onClick={() => { setSelectedId(d.id); setIsNew(false); setShowDupWarning(false); }}
                            className="ml-2 text-brand underline"
                          >
                            Open
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-2">
                      <button onClick={handleSave}
                        className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded hover:bg-amber-700">
                        Create anyway
                      </button>
                      <button onClick={() => setShowDupWarning(false)}
                        className="text-xs border border-amber-300 text-amber-700 px-3 py-1.5 rounded hover:bg-amber-50">
                        Go back
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Summary card */}
            <div className="bg-white rounded-lg shadow p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                  {/* Row 1: Name + Control# */}
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Customer Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        ref={nameRef}
                        type="text"
                        value={formData.customerName}
                        onChange={e => set('customerName', e.target.value)}
                        onBlur={handleNameBlur}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100"
                        placeholder="Full customer name"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Control #</label>
                      <input
                        type="text"
                        value={formData.customerNumber ?? ''}
                        onChange={e => set('customerNumber', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm font-mono disabled:bg-gray-100"
                        placeholder="Auto-generated"
                      />
                    </div>
                  </div>

                  {/* Row 2: address */}
                  <div className="grid grid-cols-4 gap-3">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Address</label>
                      <input type="text" value={formData.address1 ?? ''} onChange={e => set('address1', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100" placeholder="Street line 1" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                      <input type="text" value={formData.city ?? ''} onChange={e => set('city', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100" />
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">ST</label>
                        <input type="text" maxLength={2} value={formData.state ?? ''} onChange={e => set('state', e.target.value.toUpperCase())}
                          disabled={formData.employeeFlag}
                          className="w-full border rounded px-2 py-2 text-sm font-mono uppercase disabled:bg-gray-100" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">ZIP</label>
                        <input type="text" maxLength={10} value={formData.zip ?? ''} onChange={e => set('zip', e.target.value)}
                          disabled={formData.employeeFlag}
                          className="w-full border rounded px-2 py-2 text-sm font-mono disabled:bg-gray-100" />
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Phone/Email */}
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                      <input type="tel" value={formData.phone ?? ''} onChange={e => set('phone', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Phone 2</label>
                      <input type="tel" value={formData.phone2 ?? ''} onChange={e => set('phone2', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Fax</label>
                      <input type="tel" value={formData.fax ?? ''} onChange={e => set('fax', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                      <input type="email" value={formData.email ?? ''} onChange={e => set('email', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100" />
                    </div>
                  </div>
                </div>

                {/* Computed summary */}
                <div className="flex-shrink-0 w-56 bg-gray-50 rounded-lg p-3 text-xs space-y-2">
                  <p className="font-semibold text-gray-700 text-xs mb-2">Account Summary</p>
                  <div className="flex justify-between">
                    <span className="text-gray-500">AR Balance</span>
                    <span className="font-mono font-bold">${fmtAmt(0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Credit Limit</span>
                    <span className="font-mono">${fmtAmt(formData.creditLimit)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1">
                    <span className="text-gray-500">Available</span>
                    <span className="font-mono font-bold text-green-700">
                      ${fmtAmt(formData.creditLimit - 0)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t pt-1">
                    <span className="text-gray-500">Systems</span>
                    <SystemFlags c={formData} />
                  </div>
                  {formData.customerSince && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Since</span>
                      <span>{fmtDate(formData.customerSince as any)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Tab bar */}
            <div className="bg-white rounded-lg shadow">
              <div className="flex border-b px-4 gap-1">
                {([
                  { id: 'module-data', label: 'Module Data', icon: User },
                  { id: 'vehicle', label: 'Vehicle', icon: Car },
                  { id: 'notes', label: 'Notes', icon: FileText },
                  { id: 'address', label: 'Alt. Address', icon: MapPin },
                  { id: 'audit', label: 'Audit Log', icon: Clock },
                ] as { id: DetailTab; label: string; icon: any }[]).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-1.5 py-3 px-3 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === id
                        ? 'border-blue-600 text-brand'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {/* TAB 1: Module Data */}
                {activeTab === 'module-data' && (
                  <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Customer Type</label>
                      <select
                        value={formData.customerType}
                        onChange={e => set('customerType', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100"
                      >
                        {CUSTOMER_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Salesperson Code</label>
                      <input type="text" maxLength={10} value={formData.salespersonCode ?? ''}
                        onChange={e => set('salespersonCode', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm font-mono disabled:bg-gray-100" />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">AR Account Override</label>
                      <GLAccountLookup
                        value={formData.arAccountOverride ?? ''}
                        onChange={id => set('arAccountOverride', id)}
                        disabled={formData.employeeFlag}
                        placeholder="Default AR account"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Company #</label>
                      <input type="text" maxLength={4} value={formData.companyNumber ?? ''}
                        onChange={e => set('companyNumber', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm font-mono disabled:bg-gray-100" />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Tax ID (SSN / EIN)</label>
                      <input type="text" value={formData.taxId ?? ''}
                        onChange={e => set('taxId', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm font-mono disabled:bg-gray-100" />
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={formData.taxExemptStatus}
                          onChange={e => set('taxExemptStatus', e.target.checked)}
                          disabled={formData.employeeFlag}
                          className="rounded" />
                        <span className="text-sm">Tax Exempt</span>
                      </label>
                      {formData.taxExemptStatus && (
                        <div className="grid grid-cols-2 gap-2 pl-5">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Cert #</label>
                            <input type="text" value={formData.taxExemptCertNumber ?? ''}
                              onChange={e => set('taxExemptCertNumber', e.target.value)}
                              className="w-full border rounded px-2 py-1.5 text-xs" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Expiration</label>
                            <input type="date" value={formData.taxExemptExpiration?.slice(0, 10) ?? ''}
                              onChange={e => set('taxExemptExpiration', e.target.value)}
                              className="w-full border rounded px-2 py-1.5 text-xs" />
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Credit Limit</label>
                      <input type="number" min="0" step="0.01" value={formData.creditLimit}
                        onChange={e => set('creditLimit', parseFloat(e.target.value) || 0)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm font-mono text-right disabled:bg-gray-100" />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Credit Terms</label>
                      <select value={formData.creditTerms}
                        onChange={e => set('creditTerms', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100">
                        {CREDIT_TERMS.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Preferred Contact</label>
                      <select value={formData.preferredContactMethod}
                        onChange={e => set('preferredContactMethod', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100">
                        {CONTACT_METHODS.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={formData.doNotSolicit}
                          onChange={e => set('doNotSolicit', e.target.checked)}
                          disabled={formData.employeeFlag} className="rounded" />
                        <span className="text-sm">Do Not Solicit</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={formData.doNotMail}
                          onChange={e => set('doNotMail', e.target.checked)}
                          disabled={formData.employeeFlag} className="rounded" />
                        <span className="text-sm">Do Not Mail</span>
                      </label>
                    </div>

                    {/* System Flags (Name Database AVPSFE) */}
                    <div className="col-span-2 pt-2 border-t">
                      <p className="text-xs font-semibold text-gray-600 mb-2">Module Flags (Name Database)</p>
                      <div className="flex gap-4 flex-wrap">
                        {([
                          { key: 'flagAR', label: 'A — Accounts Receivable' },
                          { key: 'flagVehicle', label: 'V — Vehicle' },
                          { key: 'flagParts', label: 'P — Parts' },
                          { key: 'flagService', label: 'S — Service' },
                          { key: 'flagFI', label: 'F — F&I' },
                        ] as { key: keyof Customer; label: string }[]).map(({ key, label }) => (
                          <label key={key} className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={!!(formData[key])}
                              onChange={e => set(key, e.target.checked)}
                              disabled={formData.employeeFlag} className="rounded" />
                            <span className="text-sm">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 2: Vehicle */}
                {activeTab === 'vehicle' && (
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="text-sm font-semibold text-gray-700">Associated Vehicles</h4>
                      <p className="text-xs text-gray-400">Read-only — manage in Vehicle Inventory module</p>
                    </div>
                    <table className="w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Year</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Make</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Model</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">VIN</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Stock #</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                          <th className="px-4 py-2.5 w-24"></th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-xs text-gray-400">
                            No vehicles on record
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* TAB 3: Notes */}
                {activeTab === 'notes' && (
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <textarea
                        value={newNoteText}
                        onChange={e => setNewNoteText(e.target.value)}
                        rows={2}
                        disabled={formData.employeeFlag}
                        className="flex-1 border rounded px-3 py-2 text-sm resize-none disabled:bg-gray-100"
                        placeholder="Add a note..."
                      />
                      <button
                        onClick={handleAddNote}
                        disabled={!newNoteText.trim() || !!formData.employeeFlag}
                        className="self-start px-3 py-2 bg-brand text-white rounded text-sm hover:bg-brand disabled:opacity-40"
                      >
                        Add Note
                      </button>
                    </div>
                    <div className="space-y-2 max-h-80 overflow-auto">
                      {[...(formData.notes ?? [])].reverse().map((n, i) => (
                        <div key={i} className="bg-gray-50 rounded-lg px-4 py-3 border">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-gray-700">{n.user}</span>
                            <span className="text-xs text-gray-400">{new Date(n.timestamp).toLocaleString()}</span>
                          </div>
                          <p className="text-sm text-gray-800">{n.text}</p>
                        </div>
                      ))}
                      {(formData.notes ?? []).length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-6">No notes yet</p>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 4: Additional Address */}
                {activeTab === 'address' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Address Label</label>
                      <input type="text" value={formData.addressLabel ?? ''}
                        onChange={e => set('addressLabel', e.target.value)}
                        disabled={formData.employeeFlag}
                        placeholder="Billing / Shipping / Summer Home"
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100" />
                    </div>
                    <div />
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Street</label>
                      <input type="text" value={formData.secondaryStreet ?? ''}
                        onChange={e => set('secondaryStreet', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
                      <input type="text" value={formData.secondaryCity ?? ''}
                        onChange={e => set('secondaryCity', e.target.value)}
                        disabled={formData.employeeFlag}
                        className="w-full border rounded px-3 py-2 text-sm disabled:bg-gray-100" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
                        <input type="text" maxLength={2} value={formData.secondaryState ?? ''}
                          onChange={e => set('secondaryState', e.target.value.toUpperCase())}
                          disabled={formData.employeeFlag}
                          className="w-full border rounded px-2 py-2 text-sm font-mono uppercase disabled:bg-gray-100" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">ZIP</label>
                        <input type="text" maxLength={10} value={formData.secondaryZip ?? ''}
                          onChange={e => set('secondaryZip', e.target.value)}
                          disabled={formData.employeeFlag}
                          className="w-full border rounded px-2 py-2 text-sm font-mono disabled:bg-gray-100" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Country</label>
                        <input type="text" maxLength={2} value={formData.secondaryCountry ?? 'US'}
                          onChange={e => set('secondaryCountry', e.target.value.toUpperCase())}
                          disabled={formData.employeeFlag}
                          className="w-full border rounded px-2 py-2 text-sm font-mono uppercase disabled:bg-gray-100" />
                      </div>
                    </div>
                  </div>
                )}

                {/* TAB 5: Audit Log */}
                {activeTab === 'audit' && selectedId && (
                  <p className="text-sm text-gray-400 text-center py-8">Audit log available in audit service — entityType: Customer, id: {selectedId}</p>
                )}
                {activeTab === 'audit' && !selectedId && (
                  <p className="text-sm text-gray-400 text-center py-8">Save the customer first to view audit log.</p>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between bg-white rounded-lg shadow p-4">
              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !!formData.employeeFlag}
                  className="flex items-center gap-2 bg-brand text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-40"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-2 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
              </div>
              {selectedId && !isNew && (
                <button
                  onClick={() => setConfirmDeactivate(true)}
                  disabled={!!formData.employeeFlag}
                  className="text-sm text-red-500 border border-red-200 px-4 py-2 rounded-lg hover:bg-red-50 disabled:opacity-40"
                >
                  Deactivate Customer
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Deactivate confirmation dialog */}
      {confirmDeactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-6 space-y-4">
            <h3 className="font-bold text-lg text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Deactivate Customer?
            </h3>
            <p className="text-sm text-gray-600">
              This will soft-delete <strong>{formData.customerName}</strong>. The record will be hidden
              from searches but retained for history. This cannot be easily undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmDeactivate(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => selectedId && deactivateMut.mutate(selectedId)}
                disabled={deactivateMut.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                {deactivateMut.isPending ? 'Deactivating...' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
