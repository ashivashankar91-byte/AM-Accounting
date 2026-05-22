// NS-036: Service GL Accounts Numbers File
// BR-SGL-001: GL Group + VIN Prefix (8 chars, ^ wildcard fallback)
// BR-SGL-002: 4 pay types × 4 line types = 16 GL accounts per mapping

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Save, Info } from 'lucide-react';
import { CheckCircle, AlertTriangle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────
type PayType = 'C' | 'W' | 'I' | 'S';
type LineType = 'LABOR' | 'PARTS' | 'SUBLET' | 'FLUIDS';

interface MiscServiceAccounts {
  svcContractDeduct: string;
  warrantyCustDeduct: string;
  discount: string;
  shopCharge: string;
  salesTax: string;
}

// Key format: `${PayType}_${LineType}` — e.g. 'C_LABOR', 'W_PARTS'
type GLMapping = Record<string, string>;

// ── Constants ────────────────────────────────────────────────────
const PAY_TYPES: { code: PayType; label: string }[] = [
  { code: 'C', label: 'C — Customer Pay' },
  { code: 'W', label: 'W — Warranty' },
  { code: 'I', label: 'I — Internal' },
  { code: 'S', label: 'S — Sublet' },
];

const LINE_TYPES: LineType[] = ['LABOR', 'PARTS', 'SUBLET', 'FLUIDS'];

// Default GL account numbers — realistic automotive service GL
const DEFAULT_MAPPING: GLMapping = {
  C_LABOR:  '400',
  C_PARTS:  '302',
  C_SUBLET: '408',
  C_FLUIDS: '302A',
  W_LABOR:  '401',
  W_PARTS:  '302W',
  W_SUBLET: '408W',
  W_FLUIDS: '302A',
  I_LABOR:  '402',
  I_PARTS:  '302I',
  I_SUBLET: '408I',
  I_FLUIDS: '302A',
  S_LABOR:  '403',
  S_PARTS:  '302S',
  S_SUBLET: '408S',
  S_FLUIDS: '302A',
};

const DEFAULT_MISC: MiscServiceAccounts = {
  svcContractDeduct: '420',
  warrantyCustDeduct: '422',
  discount:          '480',
  shopCharge:        '490',
  salesTax:          '214',
};

// ── Mock API ─────────────────────────────────────────────────────
function mockLoad(_glGroup: number, _vinPrefix: string): Promise<{
  mapping: GLMapping;
  misc: MiscServiceAccounts;
}> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ mapping: { ...DEFAULT_MAPPING }, misc: { ...DEFAULT_MISC } }), 300);
  });
}

function mockSave(_data: any): Promise<void> {
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
export default function ServiceGLAccounts() {
  const [glGroup, setGlGroup] = useState<number>(1);
  const [vinPrefix, setVinPrefix] = useState<string>('^');
  const [mapping, setMapping] = useState<GLMapping>({ ...DEFAULT_MAPPING });
  const [misc, setMisc] = useState<MiscServiceAccounts>({ ...DEFAULT_MISC });
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  // Manual-trigger load
  const [loadTrigger, setLoadTrigger] = useState(0);

  const loadQuery = useQuery({
    queryKey: ['service-gl-accounts', glGroup, vinPrefix, loadTrigger],
    queryFn: () => mockLoad(glGroup, vinPrefix),
    enabled: loadTrigger > 0,
    staleTime: 0,
  });

  useEffect(() => {
    if (loadQuery.data && loadTrigger > 0) {
      setMapping({ ...(loadQuery.data as any).mapping });
      setMisc({ ...(loadQuery.data as any).misc });
    }
  }, [loadQuery.data, loadTrigger]);

  const saveMutation = useMutation({
    mutationFn: () => mockSave({ glGroup, vinPrefix, mapping, misc }),
    onSuccess: () => setToast({ msg: 'Service GL accounts saved', type: 'success' }),
    onError: (err: Error) => setToast({ msg: `Save failed: ${err.message}`, type: 'error' }),
  });

  function handleCellChange(payType: PayType, lineType: LineType, value: string) {
    const key = `${payType}_${lineType}`;
    setMapping((prev) => ({ ...prev, [key]: value }));
  }

  function handleMiscChange(key: keyof MiscServiceAccounts, value: string) {
    setMisc((prev) => ({ ...prev, [key]: value }));
  }

  const cellValue = (payType: PayType, lineType: LineType) =>
    mapping[`${payType}_${lineType}`] ?? '';

  return (
    <div className="max-w-5xl mx-auto p-6 font-[Inter,sans-serif]">
      {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={dismissToast} />}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Service GL Account Numbers</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Service 11 — BR-SGL-001/002: GL Group + VIN Prefix × 16 GL slots
        </p>
      </div>

      {/* Parameters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap gap-6 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">GL Group #</label>
            <input
              type="number"
              min={1}
              max={99}
              value={glGroup}
              onChange={(e) => setGlGroup(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
              className="h-8 w-24 border border-gray-300 rounded px-2 font-mono text-sm text-gray-900
                focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
              VIN Prefix <span className="text-gray-400 font-normal">(8 chars, ^ = wildcard)</span>
            </label>
            <input
              type="text"
              maxLength={8}
              value={vinPrefix}
              onChange={(e) => setVinPrefix(e.target.value.toUpperCase())}
              placeholder="^"
              className="h-8 w-32 border border-gray-300 rounded px-2 font-mono text-sm text-gray-900
                focus:outline-none focus:ring-2 focus:ring-brand uppercase"
            />
            <span className="text-xs text-gray-400">Use ^ as wildcard for all VINs not matched by specific prefix</span>
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
      </div>

      {/* Amber Info Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6 flex items-start gap-2 text-sm text-amber-800">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          <strong>BR-SGL-001:</strong> Lookup falls through: exact VIN prefix &rarr; wildcard (^) &rarr; error.
          Each GL Group + VIN Prefix combination has 16 GL accounts.
        </span>
      </div>

      {/* 16-Cell Grid */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          GL Account Mapping (4 Pay Types × 4 Line Types)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="pb-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide w-44">Pay Type</th>
                {LINE_TYPES.map((lt) => (
                  <th key={lt} className="pb-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide pr-4">
                    {lt.charAt(0) + lt.slice(1).toLowerCase()} GL
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {PAY_TYPES.map(({ code, label }) => (
                <tr key={code} className="h-9">
                  <td className="py-1 pr-4 font-medium text-gray-800 text-sm whitespace-nowrap">{label}</td>
                  {LINE_TYPES.map((lt) => (
                    <td key={lt} className="py-1 pr-4">
                      <input
                        type="text"
                        value={cellValue(code, lt)}
                        onChange={(e) => handleCellChange(code, lt, e.target.value)}
                        className="h-8 w-28 border border-gray-300 rounded px-2 font-mono text-sm text-gray-900
                          focus:outline-none focus:ring-2 focus:ring-brand focus:border-blue-500"
                        placeholder="—"
                        aria-label={`${code} ${lt} GL account`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Misc GL Accounts */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mt-4">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Miscellaneous GL Accounts</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {(
            [
              { key: 'svcContractDeduct', label: 'Svc Contract Deduct GL' },
              { key: 'warrantyCustDeduct', label: 'Warranty Cust Deduct GL' },
              { key: 'discount',          label: 'Discount GL' },
              { key: 'shopCharge',        label: 'Shop Charge GL' },
              { key: 'salesTax',          label: 'Sales Tax GL' },
            ] as { key: keyof MiscServiceAccounts; label: string }[]
          ).map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">{label}</label>
              <input
                type="text"
                value={misc[key]}
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
              Save Service GL Accounts
            </>
          )}
        </button>
      </div>
    </div>
  );
}
