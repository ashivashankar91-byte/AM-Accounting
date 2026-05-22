import { useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { glApi } from '../../api/client';
import { ChevronDown } from 'lucide-react';

export interface GLAccount {
  account_code: string;
  description: string;
  type: 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE' | 'EQUITY';
  current_balance: number;
}

interface GLAccountLookupProps {
  value: string;
  onChange: (code: string, account?: GLAccount) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

const typeColors: Record<string, string> = {
  ASSET: 'bg-blue-100 text-blue-800',
  LIABILITY: 'bg-red-100 text-red-800',
  INCOME: 'bg-green-100 text-green-800',
  EXPENSE: 'bg-orange-100 text-orange-800',
  EQUITY: 'bg-purple-100 text-purple-800',
};

export default function GLAccountLookup({
  value,
  onChange,
  className = '',
  disabled = false,
  placeholder = 'Search GL accounts...',
}: GLAccountLookupProps) {
  const [searchInput, setSearchInput] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['gl-accounts', searchInput],
    queryFn: () => glApi.searchAccounts(searchInput),
    enabled: searchInput.length >= 2,
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    setHighlightedIndex(0);
  }, [accounts]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || !accounts || accounts.length === 0) {
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
        setHighlightedIndex((prev) => (prev + 1) % accounts.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + accounts.length) % accounts.length);
        break;
      case 'Enter':
        e.preventDefault();
        const selected = accounts[highlightedIndex];
        if (selected) {
          setSearchInput(selected.account_code);
          onChange(selected.account_code, selected);
          setIsOpen(false);
        }
        break;
    }
  };

  const handleBlur = () => {
    setTimeout(() => setIsOpen(false), 200);
  };

  const handleSelect = (account: GLAccount) => {
    setSearchInput(account.account_code);
    onChange(account.account_code, account);
    setIsOpen(false);
  };

  const displayAccounts = accounts || [];

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
            <div className="p-3 text-center text-sm text-gray-500">Searching...</div>
          )}
          {!isLoading && displayAccounts.length === 0 && searchInput.length >= 2 && (
            <div className="p-3 text-center text-sm text-gray-500">No accounts found</div>
          )}
          {!isLoading && searchInput.length < 2 && displayAccounts.length === 0 && (
            <div className="p-3 text-center text-sm text-gray-500">Type at least 2 characters</div>
          )}
          {displayAccounts.map((account, index) => (
            <div
              key={account.account_code}
              onClick={() => handleSelect(account)}
              className={`px-3 py-2 cursor-pointer border-b last:border-b-0 ${
                index === highlightedIndex ? 'bg-brand-light' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-gray-900">{account.account_code}</div>
                  <div className="text-xs text-gray-600 truncate">{account.description}</div>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap flex-shrink-0 ${typeColors[account.type] || 'bg-gray-100 text-gray-800'}`}>
                  {account.type}
                </span>
              </div>
              <div className="font-mono text-right text-xs text-gray-500 mt-1">
                Balance: ${account.current_balance.toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
