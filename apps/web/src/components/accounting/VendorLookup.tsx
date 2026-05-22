import { useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { aparApi } from '../../api/client';
import { ChevronDown } from 'lucide-react';

export interface Vendor {
  vendor_code: string;
  vendor_name: string;
  payment_terms?: string;
  default_gl_account?: string;
}

interface VendorLookupProps {
  value: string;
  onChange: (code: string, vendor?: Vendor) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export default function VendorLookup({
  value,
  onChange,
  className = '',
  disabled = false,
  placeholder = 'Search vendors...',
}: VendorLookupProps) {
  const [searchInput, setSearchInput] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: allVendors, isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: () => aparApi.getAP(),
    staleTime: 60_000,
    retry: 1,
  });

  const filteredVendors = allVendors?.filter((vendor: any) =>
    vendor.vendor_code?.toLowerCase().includes(searchInput.toLowerCase()) ||
    vendor.vendor_name?.toLowerCase().includes(searchInput.toLowerCase())
  ) || [];

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredVendors]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || filteredVendors.length === 0) {
      if (e.key === 'Enter') {
        onChange(searchInput);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        setIsOpen(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % filteredVendors.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + filteredVendors.length) % filteredVendors.length);
        break;
      case 'Enter':
        e.preventDefault();
        const selected = filteredVendors[highlightedIndex];
        if (selected) {
          setSearchInput(selected.vendor_code);
          onChange(selected.vendor_code, selected);
          setIsOpen(false);
        }
        break;
    }
  };

  const handleBlur = () => {
    setTimeout(() => setIsOpen(false), 200);
  };

  const handleSelect = (vendor: Vendor) => {
    setSearchInput(vendor.vendor_code);
    onChange(vendor.vendor_code, vendor);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        <ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
          {isLoading && (
            <div className="p-3 text-center text-sm text-gray-500">Loading vendors...</div>
          )}
          {!isLoading && filteredVendors.length === 0 && (
            <div className="p-3 text-center text-sm text-gray-500">No vendors found</div>
          )}
          {filteredVendors.map((vendor: any, index: number) => (
            <div
              key={vendor.vendor_code}
              onClick={() => handleSelect(vendor)}
              className={`px-3 py-2 cursor-pointer border-b last:border-b-0 ${
                index === highlightedIndex ? 'bg-brand-light' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-900">{vendor.vendor_code}</div>
                  <div className="text-xs text-gray-600 truncate">{vendor.vendor_name}</div>
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-1 space-y-0.5">
                {vendor.payment_terms && <div>Terms: {vendor.payment_terms}</div>}
                {vendor.default_gl_account && <div>GL: {vendor.default_gl_account}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
