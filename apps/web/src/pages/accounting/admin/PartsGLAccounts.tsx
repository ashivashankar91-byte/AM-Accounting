// NS-035: Parts GL Account Numbers by Vendors
// BR-SGL-003: 15 sale types (01-15) × franchise + 5 misc GL accounts

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { CheckCircle, AlertTriangle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────
type Franchise = '01-GM' | '02-Ford' | '03-Toyota' | '04-Honda' | '05-BMW' | '06-Mercedes' | '07-Other';

interface MiscAccounts {
  tax: string;
  handling: string;
  freight: string;
  charge: string;
  discount: string;
}

interface SaleType {
  code: string;
  description: string;
}

// ── Constants ────────────────────────────────────────────────────
const FRANCHISES: Franchise[] = [
  '01-GM', '02-Ford', '03-Toyota', '04-Honda', '05-BMW', '06-Mercedes', '07-Other',
];

const SALE_TYPES: SaleType[] = [
  { code: '01', description: 'New Parts Retail' },
  { code: '02', description: 'Used Parts Retail' },
  { code: '03', description: 'Warranty Parts' },
  { code: '04', description: 'Internal Parts' },
  { code: '05', description: 'Sublet Parts' },
  { code: '06', description: 'Counter Retail' },
  { code: '07', description: 'Fleet Parts' },
  { code: '08', description: 'Wholesale Parts' },
  { code: '09', description: 'Body Shop Parts' },
  { code: '10', description: 'Quick Lube Parts' },
  { code: '11', description: 'Special Order Parts' },
  { code: '12', description: 'Parts Returns' },
  { code: '13', description: 'Parts Adjustments' },
  { code: '14', description: 'Parts Transfers' },
  { code: '15', description: 'Miscellaneous Parts' },
];

// Realistic default GL accounts per sale type
const DEFAULT_SALE_ACCOUNTS: Record<string, string> = {
  '01': '302',
  '02': '302B',
  '03': '302W',
  '04': '302I',
  '05': '302S',
  '06': '302C',
  '07': '302F',
  '08': '302H',
  '09': '302Y',
  '10': '302Q',
  '11': '302O',
  '12': '302R',
  '13': '302A',
  '14': '302T',
  '15': '302M',
};

const DEFAULT_MISC: MiscAccounts = {
  tax:      '214',
  handling: '302X',
  freight:  '620',
  charge:   '302Z',
  discount: '480',
};

// ── Mock API ─────────────────────────────────────────────────────
function mockLoadAccounts(_franchise: Franchise): Promise<{
  saleTypeAccounts: Record<string, string>;
  miscAccounts: MiscAccounts;
}> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ saleTypeAccounts: { ...DEFAULT_SALE_ACCOUNTS }, miscAccounts: { ...DEFAULT_MISC } }), 300);
  });
}

function mockSaveAccounts(_data: any): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 600));
}

// ── Toast ────────────────────────────────────────────────────────
function Toast({ msg, type, onDismiss }: { msg: string; type: 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium
        ${type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}
    >
      {type === 'success'
        ? <CheckCircle className="w-4 h-4 shrink-0" />
        : <AlertTriangle className="w-4 h-4 shrink-0" />}
      {msg}
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100 text-lg leading-none">&times;</button>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────
export default function PartsGLAccounts() {
  const [franchise, setFranchise] = useState<Franchise>('01-GM');
  const [saleTypeAccounts, setSaleTypeAccounts] = useState<Record<string, string>>({ ...DEFAULT_SALE_ACCOUNTS });
  const [miscAccounts, setMiscAccounts] = useState<MiscAccounts>({ ...DEFAULT_MISC });
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  // Load query — enabled only when user clicks Load (manual trigger)
  const [loadTrigger, setLoadTrigger] = useState(0);
  const loadQuery = useQuery({
    queryKey: ['parts-gl-accounts', franchise, loadTrigger],
    queryFn: () => mockLoadAccounts(franchise),
    enabled: loadTrigger > 0,
    staleTime: 0,
  });

  useEffect(() => {
    if (loadQuery.data && loadTrigger > 0) {
      setSaleTypeAccounts({ ...(loadQuery.data as any).saleTypeAccounts });
      setMiscAccounts({ ...(loadQuery.data as any).miscAccounts });
    }
  }, [loadQuery.data, loadTrigger]);

  const saveMutation = useMutation({
    mutationFn: () => mockSaveAccounts({ franchise, saleTypeAccounts, miscAccounts }),
    onSuccess: () => setToast({ msg: 'Parts GL accounts saved', type: 'success' }),
    onError: (err: Error) => setToast({ msg: `Save failed: ${err.message}`, type: 'error' }),
  });

  function handleSaleAccountChange(code: string, value: string) {
    setSaleTypeAccounts((prev) => ({ ...prev, [code]: value }));
  }

  function handleMiscChange(key: keyof MiscAccounts, value: string) {
    setMiscAccounts((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="max-w-5xl mx-auto p-6 font-[Inter,sans-serif]">
      {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={dismissToast} />}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Parts GL Account Numbers</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Parts 7 Option 5 — BR-SGL-003: 15 sale types × franchise + 5 misc GL accounts
        </p>
      </div>

      {/* Parameters Row */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Franchise / OEM</label>
          <select
            value={franchise}
            onChange={(e) => setFranchise(e.target.value as Franchise)}
            className="h-8 w-48 border border-gray-300 rounded px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {FRANCHISES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setLoadTrigger((n) => n + 1)}
          disabled={loadQuery.isFetching}
          className="h-8 px-4 text-sm border border-gray-300 rounded text-gray-700 bg-white hover:bg-gray-50
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loadQuery.isFetching ? 'Loading…' : 'Load'}
        </button>
      </div>

      {/* Sale Types Grid */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Sale Types 01–15</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="pb-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide w-20">Sale Type</th>
              <th className="pb-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">Description</th>
              <th className="pb-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide w-40">GL Account</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {SALE_TYPES.map((st) => (
              <tr key={st.code} className="h-9">
                <td className="py-1 pr-4 font-mono font-semibold text-brand">{st.code}</td>
                <td className="py-1 pr-4 text-gray-800">{st.description}</td>
                <td className="py-1">
                  <input
                    type="text"
                    value={saleTypeAccounts[st.code] ?? ''}
                    onChange={(e) => handleSaleAccountChange(st.code, e.target.value)}
                    className="h-8 w-32 border border-gray-300 rounded px-2 font-mono text-sm text-gray-900
                      focus:outline-none focus:ring-2 focus:ring-brand focus:border-blue-500"
                    placeholder="—"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Misc GL Accounts */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mt-4">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Miscellaneous GL Accounts</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {(
            [
              { key: 'tax',      label: 'Tax GL Account' },
              { key: 'handling', label: 'Handling GL Account' },
              { key: 'freight',  label: 'Freight GL Account' },
              { key: 'charge',   label: 'Charge GL Account' },
              { key: 'discount', label: 'Discount GL Account' },
            ] as { key: keyof MiscAccounts; label: string }[]
          ).map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">{label}</label>
              <input
                type="text"
                value={miscAccounts[key]}
                onChange={(e) => handleMiscChange(key, e.target.value)}
                className="h-8 w-32 border border-gray-300 rounded px-2 font-mono text-sm text-gray-900
                  focus:outline-none focus:ring-2 focus:ring-brand focus:border-blue-500"
                placeholder="—"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="mt-6">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full h-10 flex items-center justify-center gap-2 bg-brand text-white text-sm font-semibold rounded-md
            hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saveMutation.isPending ? (
            <>
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Saving…
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Parts GL Accounts
            </>
          )}
        </button>
      </div>
    </div>
  );
}
