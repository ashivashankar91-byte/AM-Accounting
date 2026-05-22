// NS-045: Service View/Print History — Search + HISTORY1/2/3 (Service Program 8)
// Route: /service/history

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Printer, X, ChevronDown, ChevronRight } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type HistoryTab = 'HISTORY1' | 'HISTORY2' | 'HISTORY3';
type ROStatus = 'OPEN' | 'CLOSED' | 'VOIDED' | 'PENDING';

interface ROLine {
  line: string;
  type: string;
  desc: string;
  tech: string;
  laborHrs: number;
  laborAmt: number;
  partsAmt: number;
  subletAmt: number;
  total: number;
}

interface RORecord {
  ro: string;
  date: string;
  customer: string;
  vin: string;
  status: ROStatus;
  total: number;
  tech: string;
  lines?: ROLine[];
}

interface SearchParams {
  ro: string;
  customer: string;
  vin: string;
  fromDate: string;
  toDate: string;
}

// ── Mock Data ──────────────────────────────────────────────────────────────────

const HISTORY1_DATA: RORecord[] = [
  {
    ro: 'RO-24891',
    date: '2026-05-15',
    customer: 'John Smith',
    vin: '4K8Z91',
    status: 'CLOSED',
    total: 824.50,
    tech: 'T001-Johnson',
    lines: [
      { line: '001', type: 'Labor', desc: 'Oil Change', tech: 'T001', laborHrs: 0.5, laborAmt: 47.50, partsAmt: 28.95, subletAmt: 0, total: 76.45 },
      { line: '002', type: 'Labor', desc: 'Tire Rotation', tech: 'T001', laborHrs: 0.3, laborAmt: 28.50, partsAmt: 0, subletAmt: 0, total: 28.50 },
    ],
  },
  { ro: 'RO-24890', date: '2026-05-14', customer: 'Mary Johnson', vin: 'Z2B6K4', status: 'CLOSED', total: 1249.75, tech: 'T002-Chen' },
  { ro: 'RO-24889', date: '2026-05-14', customer: 'Bob Davis', vin: '8M3T21', status: 'CLOSED', total: 3892.00, tech: 'T001-Johnson' },
  { ro: 'RO-24888', date: '2026-05-13', customer: 'Alice Wilson', vin: 'P7N4Q9', status: 'VOIDED', total: 0, tech: 'T004-Williams' },
];

const HISTORY2_DATA: RORecord[] = [
  { ro: 'RO-23101', date: '2025-12-20', customer: 'James Carter', vin: 'Q3R7X2', status: 'CLOSED', total: 582.00, tech: 'T002-Chen' },
  { ro: 'RO-22987', date: '2025-11-30', customer: 'Patricia Lee', vin: 'K9N2W5', status: 'CLOSED', total: 214.00, tech: 'T004-Williams' },
  { ro: 'RO-22801', date: '2025-10-05', customer: 'Michael Brown', vin: 'B1V4Y8', status: 'CLOSED', total: 1875.50, tech: 'T001-Johnson' },
  { ro: 'RO-22650', date: '2025-09-17', customer: 'Linda Taylor', vin: 'H6Z3P1', status: 'PENDING', total: 0, tech: 'T003-Rodriguez' },
];

const HISTORY3_DATA: RORecord[] = [
  { ro: 'RO-18445', date: '2024-02-14', customer: 'Robert Anderson', vin: 'C4M8J6', status: 'CLOSED', total: 3410.00, tech: 'T001-Johnson' },
  { ro: 'RO-16732', date: '2023-08-22', customer: 'Susan Thomas', vin: 'X7F2L9', status: 'CLOSED', total: 728.00, tech: 'T002-Chen' },
  { ro: 'RO-14891', date: '2022-11-03', customer: 'Charles Jackson', vin: 'M5G0R3', status: 'VOIDED', total: 0, tech: 'T004-Williams' },
  { ro: 'RO-12200', date: '2022-01-18', customer: 'Karen Harris', vin: 'T8W6A4', status: 'CLOSED', total: 4960.25, tech: 'T001-Johnson' },
];

const DATA_MAP: Record<HistoryTab, RORecord[]> = {
  HISTORY1: HISTORY1_DATA,
  HISTORY2: HISTORY2_DATA,
  HISTORY3: HISTORY3_DATA,
};

// ── Status Badge ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<ROStatus, string> = {
  OPEN: 'bg-brand-light text-brand',
  CLOSED: 'bg-green-100 text-green-700',
  VOIDED: 'bg-gray-200 text-gray-500',
  PENDING: 'bg-amber-100 text-amber-700',
};

function ROStatusBadge({ status }: { status: ROStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status]}`}>
      {status}
    </span>
  );
}

// ── Currency formatter ─────────────────────────────────────────────────────────

const fmtCurrency = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

// ── Detail Panel ───────────────────────────────────────────────────────────────

function RODetailPanel({ rec, onClose }: { rec: RORecord; onClose: () => void }) {
  const lines = rec.lines ?? [];

  const laborTotal = lines.reduce((s, l) => s + l.laborAmt, 0);
  const partsTotal = lines.reduce((s, l) => s + l.partsAmt, 0);
  const subletTotal = lines.reduce((s, l) => s + l.subletAmt, 0);
  const grandTotal = lines.length > 0
    ? lines.reduce((s, l) => s + l.total, 0)
    : rec.total;

  return (
    <tr>
      <td colSpan={7} className="p-0 border-b border-brand-border">
        <div className="bg-brand-light border-l-4 border-blue-600 p-4 rounded-b">
          {/* Header info */}
          <div className="flex items-start justify-between mb-4">
            <div className="grid grid-cols-3 gap-x-8 gap-y-1 text-sm">
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">RO#</span>
                <p className="font-mono font-semibold text-gray-900">{rec.ro}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Date</span>
                <p className="font-mono text-gray-800">{rec.date}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Customer</span>
                <p className="text-gray-800 font-medium">{rec.customer}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">VIN (Last 6)</span>
                <p className="font-mono text-gray-800">{rec.vin}</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Status</span>
                <div className="mt-0.5"><ROStatusBadge status={rec.status} /></div>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Technician</span>
                <p className="font-mono text-gray-800">{rec.tech}</p>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => window.print()}
                className="h-8 px-3 flex items-center gap-1.5 bg-white border border-gray-300 rounded text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                Print
              </button>
              <button
                onClick={onClose}
                className="h-8 px-3 flex items-center gap-1.5 bg-white border border-gray-300 rounded text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Close
              </button>
            </div>
          </div>

          {/* Line items */}
          {lines.length > 0 ? (
            <>
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Repair Order Lines</p>
              <div className="overflow-hidden rounded border border-brand-border mb-4">
                <table className="w-full text-xs">
                  <thead className="bg-white border-b border-brand-border">
                    <tr>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Line</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Tech</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Labor Hrs</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Labor $</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Parts $</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Sublet $</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(l => (
                      <tr key={l.line} className="h-9 border-b border-blue-100 last:border-0">
                        <td className="px-3 py-0 font-mono text-gray-600">{l.line}</td>
                        <td className="px-3 py-0 text-gray-600">{l.type}</td>
                        <td className="px-3 py-0 text-gray-800 font-medium">{l.desc}</td>
                        <td className="px-3 py-0 font-mono text-gray-600">{l.tech}</td>
                        <td className="px-3 py-0 text-right font-mono tabular-nums text-gray-700">{l.laborHrs.toFixed(1)}</td>
                        <td className="px-3 py-0 text-right font-mono tabular-nums text-gray-900">{fmtCurrency(l.laborAmt)}</td>
                        <td className="px-3 py-0 text-right font-mono tabular-nums text-gray-900">{fmtCurrency(l.partsAmt)}</td>
                        <td className="px-3 py-0 text-right font-mono tabular-nums text-gray-900">{fmtCurrency(l.subletAmt)}</td>
                        <td className="px-3 py-0 text-right font-mono tabular-nums font-semibold text-gray-900">{fmtCurrency(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals row */}
              <div className="flex justify-end">
                <div className="grid grid-cols-4 gap-6 text-xs border border-brand-border rounded bg-white px-4 py-3">
                  <div className="text-right">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Parts Total</p>
                    <p className="font-mono tabular-nums font-semibold text-gray-900">{fmtCurrency(partsTotal)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Labor Total</p>
                    <p className="font-mono tabular-nums font-semibold text-gray-900">{fmtCurrency(laborTotal)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Sublet Total</p>
                    <p className="font-mono tabular-nums font-semibold text-gray-900">{fmtCurrency(subletTotal)}</p>
                  </div>
                  <div className="text-right border-l border-brand-border pl-6">
                    <p className="text-[10px] text-brand uppercase tracking-wide font-semibold mb-0.5">Grand Total</p>
                    <p className="font-mono tabular-nums font-bold text-brand text-sm">{fmtCurrency(grandTotal)}</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-xs text-gray-500 italic py-2">
              No line detail available in mock data — line items would load from service API in production.
              <span className="ml-2 font-mono">Grand Total: {fmtCurrency(rec.total)}</span>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ServiceHistory() {
  const [activeHistoryTab, setActiveHistoryTab] = useState<HistoryTab>('HISTORY1');
  const [searchParams, setSearchParams] = useState<SearchParams>({
    ro: '',
    customer: '',
    vin: '',
    fromDate: '',
    toDate: '',
  });
  const [appliedSearch, setAppliedSearch] = useState<SearchParams>({
    ro: '',
    customer: '',
    vin: '',
    fromDate: '',
    toDate: '',
  });
  const [selectedRo, setSelectedRo] = useState<string | null>(null);

  // useQuery wired up for future API integration
  useQuery<any>({
    queryKey: ['service-history', activeHistoryTab, appliedSearch],
    queryFn: async () => null,
    enabled: false,
  });

  const TAB_LABELS: Record<HistoryTab, string> = {
    HISTORY1: 'HISTORY1 — Recent (0–90 days)',
    HISTORY2: 'HISTORY2 — Standard (91–365 days)',
    HISTORY3: 'HISTORY3 — Archive (1–5 years)',
  };

  const allData = DATA_MAP[activeHistoryTab];

  const filteredResults = useMemo(() => {
    return allData.filter(r => {
      if (appliedSearch.ro && !r.ro.toLowerCase().includes(appliedSearch.ro.toLowerCase())) return false;
      if (appliedSearch.customer && !r.customer.toLowerCase().includes(appliedSearch.customer.toLowerCase())) return false;
      if (appliedSearch.vin && !r.vin.toLowerCase().includes(appliedSearch.vin.toLowerCase())) return false;
      if (appliedSearch.fromDate && r.date < appliedSearch.fromDate) return false;
      if (appliedSearch.toDate && r.date > appliedSearch.toDate) return false;
      return true;
    });
  }, [allData, appliedSearch]);

  function handleSearch() {
    setAppliedSearch({ ...searchParams });
    setSelectedRo(null);
  }

  function handleParamChange(key: keyof SearchParams, value: string) {
    setSearchParams(prev => ({ ...prev, [key]: value }));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSearch();
  }

  const inputCls =
    'h-8 rounded border border-gray-300 px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent bg-white';

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* ── Header ── */}
      <div className="mb-5">
        <h1 className="text-3xl font-bold text-gray-900">Service History</h1>
        <p className="text-sm text-gray-500 mt-1">Service Program 8 — View and print repair order history</p>
      </div>

      {/* ── History Tabs ── */}
      <div className="flex border-b border-gray-200 mb-4">
        {(Object.keys(TAB_LABELS) as HistoryTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveHistoryTab(tab); setSelectedRo(null); }}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeHistoryTab === tab
                ? 'border-blue-600 text-brand'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* ── Search Panel ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex gap-4 flex-wrap items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">RO#</label>
          <input
            type="text"
            value={searchParams.ro}
            onChange={e => handleParamChange('ro', e.target.value)}
            onKeyDown={handleKeyDown}
            className={`${inputCls} w-28 font-mono`}
            placeholder="RO-XXXXX"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Customer</label>
          <input
            type="text"
            value={searchParams.customer}
            onChange={e => handleParamChange('customer', e.target.value)}
            onKeyDown={handleKeyDown}
            className={`${inputCls} w-48`}
            placeholder="Customer name..."
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">VIN (Last 6)</label>
          <input
            type="text"
            value={searchParams.vin}
            onChange={e => handleParamChange('vin', e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
            maxLength={6}
            className={`${inputCls} w-28 font-mono uppercase`}
            placeholder="XXXXXX"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">From Date</label>
          <input
            type="date"
            value={searchParams.fromDate}
            onChange={e => handleParamChange('fromDate', e.target.value)}
            className={`${inputCls} w-36`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">To Date</label>
          <input
            type="date"
            value={searchParams.toDate}
            onChange={e => handleParamChange('toDate', e.target.value)}
            className={`${inputCls} w-36`}
          />
        </div>

        <button
          onClick={handleSearch}
          className="h-8 px-4 bg-brand text-white rounded font-semibold text-sm hover:bg-brand-hover transition-colors flex items-center gap-2"
        >
          <Search className="w-3.5 h-3.5" />
          Search
        </button>
      </div>

      {/* ── Results Table ── */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">RO#</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Date</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">VIN (Last 6)</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              <th className="text-right px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Total</th>
              <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Technician</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">
                  No repair orders found matching your search criteria.
                </td>
              </tr>
            )}
            {filteredResults.map(rec => {
              const isSelected = selectedRo === rec.ro;
              return (
                <React.Fragment key={rec.ro}>
                  <tr
                    onClick={() => setSelectedRo(isSelected ? null : rec.ro)}
                    className={`h-9 border-b border-gray-100 cursor-pointer transition-colors ${
                      isSelected ? 'bg-brand-light' : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Expand indicator */}
                    <td className="px-3 py-0 text-gray-400">
                      {isSelected
                        ? <ChevronDown className="w-3.5 h-3.5 text-brand" />
                        : <ChevronRight className="w-3.5 h-3.5" />
                      }
                    </td>
                    <td className="px-4 py-0">
                      <span className="font-mono text-brand font-semibold cursor-pointer hover:underline">
                        {rec.ro}
                      </span>
                    </td>
                    <td className="px-4 py-0 font-mono text-gray-700 tabular-nums">{rec.date}</td>
                    <td className="px-4 py-0 text-gray-800 font-medium">{rec.customer}</td>
                    <td className="px-4 py-0 font-mono text-gray-700 tabular-nums">{rec.vin}</td>
                    <td className="px-4 py-0">
                      <ROStatusBadge status={rec.status} />
                    </td>
                    <td className="px-4 py-0 text-right font-mono tabular-nums text-gray-900 font-semibold">
                      {fmtCurrency(rec.total)}
                    </td>
                    <td className="px-4 py-0 font-mono text-xs text-gray-600">{rec.tech}</td>
                  </tr>

                  {/* Detail panel inline */}
                  {isSelected && (
                    <RODetailPanel
                      key={`detail-${rec.ro}`}
                      rec={rec}
                      onClose={() => setSelectedRo(null)}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Footer row count */}
        {filteredResults.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
            <p className="text-xs text-gray-500">
              {filteredResults.length} repair order{filteredResults.length !== 1 ? 's' : ''} found
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
