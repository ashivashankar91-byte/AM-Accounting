/**
 * NameDatabaseLookup — S5-03
 * Replaces VendorLookup. Supports ALL entity types from the legacy Name Database:
 * CUSTOMER, VENDOR, EMPLOYEE, or ALL. Includes Smart Search (VIN last-6 / Year-Make-Model).
 */
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { aparApi } from '../../api/client';
import { ChevronDown, Search, Car } from 'lucide-react';

export type EntityType = 'ALL' | 'CUSTOMER' | 'VENDOR' | 'EMPLOYEE';

export interface NameEntity {
  id: string;
  code: string;     // customerNumber / vendorNumber / employeeNumber
  name: string;     // customerName / vendorName / employeeName
  type: EntityType;
  city?: string;
  state?: string;
  phone?: string;
  // Vendor-specific
  payment_terms?: string;
  default_gl_account?: string;
  // Vehicle-specific (Smart Search)
  vin?: string;
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
}

// Legacy compat: re-export as Vendor shape
export interface Vendor {
  vendor_code: string;
  vendor_name: string;
  payment_terms?: string;
  default_gl_account?: string;
}

interface NameDatabaseLookupProps {
  value: string;
  onChange: (code: string, entity?: NameEntity) => void;
  entityType?: EntityType;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

type SearchTab = 'name' | 'smart';

export default function NameDatabaseLookup({
  value,
  onChange,
  entityType = 'ALL',
  className = '',
  disabled = false,
  placeholder,
}: NameDatabaseLookupProps) {
  const [searchInput, setSearchInput] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [searchTab, setSearchTab] = useState<SearchTab>('name');
  const [vinSearch, setVinSearch] = useState('');
  const [vinYear, setVinYear] = useState('');
  const [vinMake, setVinMake] = useState('');
  const [vinModel, setVinModel] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const defaultPlaceholder = entityType === 'VENDOR'
    ? 'Search vendors...'
    : entityType === 'CUSTOMER'
    ? 'Search customers...'
    : entityType === 'EMPLOYEE'
    ? 'Search employees...'
    : 'Search name database...';

  // ── Vendor query (backward compat) ──────────────────────────────────────
  const { data: vendorData, isLoading: vendorLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => aparApi.getVendors(),
    staleTime: 60_000,
    enabled: (entityType === 'VENDOR' || entityType === 'ALL') && true,
    retry: 1,
  });

  // ── Customer query ───────────────────────────────────────────────────────
  const { data: customerData, isLoading: customerLoading } = useQuery({
    queryKey: ['customers', searchInput, 'name'],
    queryFn: () => aparApi.getCustomers(searchInput ? `?q=${encodeURIComponent(searchInput)}&mode=name` : undefined),
    staleTime: 30_000,
    enabled: (entityType === 'CUSTOMER' || entityType === 'ALL') && searchInput.length > 1,
    retry: 1,
  });

  // ── VIN / Vehicle Smart Search ───────────────────────────────────────────
  const vinQuery = vinSearch.length >= 6 || !!(vinYear && vinMake);
  const { data: vinData } = useQuery({
    queryKey: ['vin-search', vinSearch, vinYear, vinMake, vinModel],
    queryFn: () => {
      const params = new URLSearchParams();
      if (vinSearch) params.set('vin_last6', vinSearch);
      if (vinYear) params.set('year', vinYear);
      if (vinMake) params.set('make', vinMake);
      if (vinModel) params.set('model', vinModel);
      return aparApi.getCustomers(`?${params.toString()}&mode=vehicle`);
    },
    enabled: vinQuery,
    retry: 1,
  });

  // ── Normalise results into NameEntity[] ──────────────────────────────────
  const allEntities: NameEntity[] = [];

  if (entityType === 'VENDOR' || entityType === 'ALL') {
    ((vendorData ?? []) as any[])
      .filter((v: any) =>
        !searchInput ||
        v.vendorNumber?.toLowerCase().includes(searchInput.toLowerCase()) ||
        v.vendorName?.toLowerCase().includes(searchInput.toLowerCase())
      )
      .forEach((v: any) => allEntities.push({
        id: v.id,
        code: v.vendorNumber,
        name: v.vendorName,
        type: 'VENDOR',
        city: v.city,
        state: v.state,
        phone: v.phone,
        payment_terms: v.paymentTerms,
        default_gl_account: v.defaultGlAccount,
      }));
  }

  if (entityType === 'CUSTOMER' || entityType === 'ALL') {
    ((customerData ?? []) as any[]).forEach((c: any) => allEntities.push({
      id: c.id,
      code: c.customerNumber,
      name: c.customerName,
      type: 'CUSTOMER',
      city: c.city,
      state: c.state,
      phone: c.phone,
    }));
  }

  const isLoading = vendorLoading || customerLoading;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || allEntities.length === 0) {
      if (e.key === 'Enter') onChange(searchInput);
      return;
    }
    switch (e.key) {
      case 'Escape': setIsOpen(false); break;
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(i => (i + 1) % allEntities.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(i => (i - 1 + allEntities.length) % allEntities.length);
        break;
      case 'Enter': {
        e.preventDefault();
        const selected = allEntities[highlightedIndex];
        if (selected) handleSelect(selected);
        break;
      }
    }
  };

  const handleSelect = (entity: NameEntity) => {
    setSearchInput(entity.code);
    onChange(entity.code, entity);
    setIsOpen(false);
  };

  const handleBlur = () => setTimeout(() => setIsOpen(false), 200);

  const typeColor = (t: EntityType) => {
    switch (t) {
      case 'VENDOR': return 'bg-blue-100 text-brand';
      case 'CUSTOMER': return 'bg-green-100 text-green-700';
      case 'EMPLOYEE': return 'bg-purple-100 text-purple-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          type="text"
          value={searchInput}
          onChange={e => { setSearchInput(e.target.value); setIsOpen(true); setHighlightedIndex(0); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder={placeholder ?? defaultPlaceholder}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        <ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-80 overflow-hidden flex flex-col">
          {/* Smart Search tab bar */}
          <div className="flex border-b text-xs font-medium">
            <button
              onMouseDown={e => { e.preventDefault(); setSearchTab('name'); }}
              className={`flex-1 py-1.5 flex items-center justify-center gap-1 ${searchTab === 'name' ? 'bg-brand-light text-brand border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <Search className="w-3 h-3" /> Name
            </button>
            <button
              onMouseDown={e => { e.preventDefault(); setSearchTab('smart'); }}
              className={`flex-1 py-1.5 flex items-center justify-center gap-1 ${searchTab === 'smart' ? 'bg-brand-light text-brand border-b-2 border-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <Car className="w-3 h-3" /> VIN / Vehicle
            </button>
          </div>

          {searchTab === 'name' && (
            <div className="overflow-y-auto max-h-60">
              {isLoading && <div className="p-3 text-center text-sm text-gray-500">Loading...</div>}
              {!isLoading && allEntities.length === 0 && (
                <div className="p-3 text-center text-sm text-gray-500">
                  {searchInput.length < 2 ? 'Type at least 2 characters to search' : 'No results found'}
                </div>
              )}
              {allEntities.map((entity, index) => (
                <div
                  key={entity.id}
                  onMouseDown={() => handleSelect(entity)}
                  className={`px-3 py-2 cursor-pointer border-b last:border-b-0 ${index === highlightedIndex ? 'bg-brand-light' : 'hover:bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-gray-900">{entity.code}</div>
                      <div className="text-xs text-gray-600 truncate">{entity.name}</div>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${typeColor(entity.type)}`}>
                      {entity.type.charAt(0)}
                    </span>
                  </div>
                  {(entity.city || entity.state) && (
                    <div className="text-xs text-gray-400 mt-0.5">{[entity.city, entity.state].filter(Boolean).join(', ')}</div>
                  )}
                  {entity.payment_terms && <div className="text-xs text-gray-400">Terms: {entity.payment_terms}</div>}
                </div>
              ))}
            </div>
          )}

          {searchTab === 'smart' && (
            <div className="p-3 space-y-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Last 6 VIN digits</label>
                <input
                  type="text"
                  maxLength={6}
                  value={vinSearch}
                  onMouseDown={e => e.stopPropagation()}
                  onChange={e => setVinSearch(e.target.value.toUpperCase())}
                  placeholder="e.g. 4F2XKL"
                  className="w-full border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
              <div className="text-xs text-gray-400 text-center">— or search by vehicle —</div>
              <div className="grid grid-cols-3 gap-1">
                <input type="text" value={vinYear} onChange={e => setVinYear(e.target.value)}
                  onMouseDown={e => e.stopPropagation()}
                  placeholder="Year" className="border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
                <input type="text" value={vinMake} onChange={e => setVinMake(e.target.value)}
                  onMouseDown={e => e.stopPropagation()}
                  placeholder="Make" className="border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
                <input type="text" value={vinModel} onChange={e => setVinModel(e.target.value)}
                  onMouseDown={e => e.stopPropagation()}
                  placeholder="Model" className="border rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
              </div>
              <div className="overflow-y-auto max-h-32">
                {((vinData ?? []) as any[]).map((c: any) => (
                  <div key={c.id} onMouseDown={() => handleSelect({
                    id: c.id, code: c.customerNumber, name: c.customerName, type: 'CUSTOMER',
                    vin: c.vin, vehicleYear: c.vehicleYear, vehicleMake: c.vehicleMake, vehicleModel: c.vehicleModel,
                  })}
                    className="px-2 py-1.5 cursor-pointer hover:bg-brand-light border-b last:border-b-0 text-xs">
                    <span className="font-bold">{c.customerName}</span>
                    {c.vin && <span className="text-gray-400 ml-2 font-mono">VIN: ...{c.vin.slice(-6)}</span>}
                    {c.vehicleYear && <span className="text-gray-400 ml-2">{c.vehicleYear} {c.vehicleMake} {c.vehicleModel}</span>}
                  </div>
                ))}
                {vinQuery && ((vinData ?? []) as any[]).length === 0 && (
                  <p className="text-center text-xs text-gray-400 py-3">No matching vehicles found</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
