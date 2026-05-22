import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { fsApi } from '../api/client';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';
import { HYUNDAI_006 } from '../data/hyundai006Structure';
import type { FSFormLine, FSFormPage, OEMFormDefinition, FinancialStatementData } from '../types/financial-statements';
import { FSLineSource, Department } from '../types/financial-statements';

// ── Supported OEMs — add new form definitions here ──────────────────────

const OEM_FORMS: Record<string, OEMFormDefinition> = {
  HYUNDAI: HYUNDAI_006,
};

const OEM_LIST = [
  'HYUNDAI', 'GENESIS', 'GM', 'FORD', 'FCA', 'TOYOTA', 'HONDA',
  'NISSAN', 'BMW', 'MERCEDES', 'ACURA', 'AUDI', 'KIA', 'SUBARU',
];

// ── Amount formatting ───────────────────────────────────────────────────

const fmt = (cents: number | undefined): string => {
  if (cents == null) return '';
  const val = cents / 100;
  const sign = val < 0 ? '(' : '';
  const end = val < 0 ? ')' : '';
  return `${sign}$${Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}${end}`;
};

// ── Resolve a single line's value from statement data ───────────────────

function resolveLineAmount(
  line: FSFormLine,
  data: FinancialStatementData | undefined,
  field: 'month' | 'ytd',
  dept?: Department,
): number | undefined {
  if (!data) return undefined;
  if (line.source === FSLineSource.HEADER || line.source === FSLineSource.BLANK) return undefined;

  if (line.source === FSLineSource.GL_BALANCE) {
    let total = 0;
    for (const acct of line.oemAccounts) {
      const bucket = dept && dept !== Department.TOTAL
        ? data.departmentAmounts?.[dept]?.[acct]
        : data.lineAmounts?.[acct];
      total += bucket?.[field] ?? 0;
    }
    return line.isContra ? -total : total;
  }

  if (line.source === FSLineSource.SUPPLEMENTAL || line.source === FSLineSource.EXTERNAL_MODULE) {
    const key = line.formula ?? '';
    return data.supplementalData?.[key] ?? data.externalModuleData?.[key] ?? undefined;
  }

  // SUBTOTAL, FORMULA, PERCENT are computed client-side from resolved peer lines.
  // The backend returns already-computed values for these in lineAmounts.
  if (line.oemAccounts.length === 0 && line.formula) {
    const key = `_calc_${line.lineNumber}`;
    const bucket = dept && dept !== Department.TOTAL
      ? data.departmentAmounts?.[dept]?.[key]
      : data.lineAmounts?.[key];
    return bucket?.[field] ?? undefined;
  }
  return undefined;
}

// ── Page Table Renderers ────────────────────────────────────────────────

function BalanceSheetTable({ page, data }: { page: FSFormPage; data?: FinancialStatementData }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 border-b">
          <th className="py-1 w-12">Line</th>
          <th className="py-1">Description</th>
          <th className="py-1 text-right w-24">Units</th>
          <th className="py-1 text-right w-32">Current Month</th>
          <th className="py-1 text-right w-32">YTD</th>
        </tr>
      </thead>
      <tbody>
        {(page.lines ?? []).map((line, i) => {
          const isHdr = line.source === FSLineSource.HEADER;
          const month = resolveLineAmount(line, data, 'month');
          const ytd = resolveLineAmount(line, data, 'ytd');
          return (
            <tr key={i} className={`border-b border-gray-100 ${line.isTotal ? 'bg-gray-50 font-semibold' : ''} ${isHdr ? 'bg-brand-light' : ''}`}>
              <td className="py-1 text-gray-400 text-xs">{isHdr ? '' : line.lineNumber}</td>
              <td className="py-1" style={{ paddingLeft: `${(line.indent ?? 0) * 16 + (isHdr ? 0 : 8)}px` }}>
                {isHdr ? <span className="font-semibold text-brand text-xs uppercase tracking-wide">{line.label}</span> : line.label}
              </td>
              <td className="py-1 text-right font-mono text-xs">{line.hasUnits ? '—' : ''}</td>
              <td className="py-1 text-right font-mono text-xs">{fmt(month)}</td>
              <td className="py-1 text-right font-mono text-xs">{fmt(ytd)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DepartmentalTable({ page, data }: { page: FSFormPage; data?: FinancialStatementData }) {
  const depts = page.departments ?? [Department.TOTAL];
  const deptLabels: Record<string, string> = {
    [Department.TOTAL]: 'Total',
    [Department.NEW_VEHICLE]: 'New Vehicle',
    [Department.USED_VEHICLE]: 'Used Vehicle',
    [Department.SERVICE]: 'Service',
    [Department.PARTS]: 'Parts & Acc.',
    [Department.BODY_SHOP]: 'Body Shop',
    [Department.ADMIN]: 'Admin',
  };

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 border-b">
          <th className="py-1 w-10">Line</th>
          <th className="py-1">Description</th>
          {depts.map((d) => (
            <th key={d} className="py-1 text-right w-28">{deptLabels[d] ?? d}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(page.lines ?? []).map((line, i) => {
          const isHdr = line.source === FSLineSource.HEADER;
          return (
            <tr key={i} className={`border-b border-gray-100 ${line.isTotal ? 'bg-gray-50 font-semibold' : ''} ${isHdr ? 'bg-brand-light' : ''}`}>
              <td className="py-1 text-gray-400 text-xs">{isHdr ? '' : line.lineNumber}</td>
              <td className="py-1" style={{ paddingLeft: `${(line.indent ?? 0) * 16 + (isHdr ? 0 : 8)}px` }}>
                {isHdr ? <span className="font-semibold text-brand text-xs uppercase tracking-wide">{line.label}</span> : line.label}
              </td>
              {depts.map((d) => {
                const val = resolveLineAmount(line, data, 'month', d);
                return <td key={d} className="py-1 text-right font-mono text-xs">{fmt(val)}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ModelDetailTable({ page, data }: { page: FSFormPage; data?: FinancialStatementData }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 border-b">
          <th className="py-1 w-10">Line</th>
          <th className="py-1">Model</th>
          <th className="py-1 text-right w-20">Units</th>
          <th className="py-1 text-right w-28">Sales</th>
          <th className="py-1 text-right w-28">Gross Profit</th>
        </tr>
      </thead>
      <tbody>
        {(page.lines ?? []).map((line, i) => {
          const isHdr = line.source === FSLineSource.HEADER;
          const month = resolveLineAmount(line, data, 'month');
          return (
            <tr key={i} className={`border-b border-gray-100 ${line.isTotal ? 'bg-gray-50 font-semibold' : ''} ${isHdr ? 'bg-brand-light' : ''}`}>
              <td className="py-1 text-gray-400 text-xs">{isHdr ? '' : line.lineNumber}</td>
              <td className="py-1" style={{ paddingLeft: `${(line.indent ?? 0) * 16 + (isHdr ? 0 : 8)}px` }}>
                {isHdr ? <span className="font-semibold text-brand text-xs uppercase tracking-wide">{line.label}</span> : line.label}
              </td>
              <td className="py-1 text-right font-mono text-xs">{line.hasUnits ? '—' : ''}</td>
              <td className="py-1 text-right font-mono text-xs">{fmt(month)}</td>
              <td className="py-1 text-right font-mono text-xs">{isHdr ? '' : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ServicePartsTable({ page, data }: { page: FSFormPage; data?: FinancialStatementData }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 border-b">
          <th className="py-1 w-10">Line</th>
          <th className="py-1">Description</th>
          <th className="py-1 text-right w-28">Sales</th>
          <th className="py-1 text-right w-28">Cost of Sales</th>
          <th className="py-1 text-right w-28">Gross Profit</th>
        </tr>
      </thead>
      <tbody>
        {(page.lines ?? []).map((line, i) => {
          const isHdr = line.source === FSLineSource.HEADER;
          const month = resolveLineAmount(line, data, 'month');
          return (
            <tr key={i} className={`border-b border-gray-100 ${line.isTotal ? 'bg-gray-50 font-semibold' : ''} ${isHdr ? 'bg-brand-light' : ''}`}>
              <td className="py-1 text-gray-400 text-xs">{isHdr ? '' : line.lineNumber}</td>
              <td className="py-1" style={{ paddingLeft: `${(line.indent ?? 0) * 16 + (isHdr ? 0 : 8)}px` }}>
                {isHdr ? <span className="font-semibold text-brand text-xs uppercase tracking-wide">{line.label}</span> : line.label}
              </td>
              <td className="py-1 text-right font-mono text-xs">{fmt(month)}</td>
              <td className="py-1 text-right font-mono text-xs">{isHdr ? '' : '—'}</td>
              <td className="py-1 text-right font-mono text-xs">{isHdr ? '' : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ManagementInfoTable({ page, data }: { page: FSFormPage; data?: FinancialStatementData }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500 border-b">
          <th className="py-1 w-10">Line</th>
          <th className="py-1">Description</th>
          <th className="py-1 text-right w-28">Current Month</th>
          <th className="py-1 text-right w-28">YTD</th>
        </tr>
      </thead>
      <tbody>
        {(page.lines ?? []).map((line, i) => {
          const isHdr = line.source === FSLineSource.HEADER;
          const isSup = line.source === FSLineSource.SUPPLEMENTAL;
          const month = resolveLineAmount(line, data, 'month');
          const ytd = resolveLineAmount(line, data, 'ytd');
          return (
            <tr key={i} className={`border-b border-gray-100 ${line.isTotal ? 'bg-gray-50 font-semibold' : ''} ${isHdr ? 'bg-brand-light' : ''} ${isSup ? 'bg-purple-50' : ''}`}>
              <td className="py-1 text-gray-400 text-xs">{isHdr ? '' : line.lineNumber}</td>
              <td className="py-1" style={{ paddingLeft: `${(line.indent ?? 0) * 16 + (isHdr ? 0 : 8)}px` }}>
                {isHdr ? <span className="font-semibold text-brand text-xs uppercase tracking-wide">{line.label}</span> : line.label}
                {isSup && <span className="ml-2 text-xs text-purple-500">(supplemental)</span>}
              </td>
              <td className="py-1 text-right font-mono text-xs">{isSup ? (month ?? '—') : fmt(month)}</td>
              <td className="py-1 text-right font-mono text-xs">{isSup ? (ytd ?? '—') : fmt(ytd)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Page renderer dispatcher ────────────────────────────────────────────

function FSPageRenderer({ page, data }: { page: FSFormPage; data?: FinancialStatementData }) {
  switch (page.pageNumber) {
    case 1: return <BalanceSheetTable page={page} data={data} />;
    case 2: return <DepartmentalTable page={page} data={data} />;
    case 3: return <DepartmentalTable page={page} data={data} />;
    case 4: return <ModelDetailTable page={page} data={data} />;
    case 5: return <ModelDetailTable page={page} data={data} />;
    case 6: return <ServicePartsTable page={page} data={data} />;
    case 7: return <ManagementInfoTable page={page} data={data} />;
    default: return <BalanceSheetTable page={page} data={data} />;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function FSPreview() {
  const tenantId = localStorage.getItem('tenantId') ?? '';
  const queryClient = useQueryClient();
  const [company, setCompany] = useState('03');
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [oem, setOem] = useState('HYUNDAI');
  const [activePage, setActivePage] = useState(1);

  const formDef = useMemo(() => OEM_FORMS[oem], [oem]);

  // Fetch aggregated GL data for this company/period/oem
  const { data: fsData, isLoading, error } = useQuery<FinancialStatementData>({
    queryKey: ['fs-data', company, period, oem],
    queryFn: () => fsApi.getData(company, period, oem),
    enabled: !!tenantId,
    retry: false,
  });

  const submitMut = useMutation({
    mutationFn: () => fsApi.submit(company, period, oem),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fs-data'] }),
  });

  const currentPage = formDef?.pages.find((p) => p.pageNumber === activePage);

  return (
    <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold">Financial Statement Preview</h1><p className="text-sm text-gray-500 mt-0.5">OEM-formatted financial statement generation and submission. Source: FS Service.</p></div>
        <HelpButton help={SCREEN_HELP['financial-statements']} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end bg-white rounded-lg shadow p-4">
        <div>
          <label className="text-sm font-medium text-gray-700">Company</label>
          <input type="text" value={company} onChange={(e) => setCompany(e.target.value)}
            className="block mt-1 border rounded px-3 py-2 text-sm w-20" maxLength={2} />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">Period</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)}
            className="block mt-1 border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700">OEM Franchise</label>
          <select value={oem} onChange={(e) => { setOem(e.target.value); setActivePage(1); }}
            className="block mt-1 border rounded px-3 py-2 text-sm">
            {OEM_LIST.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
        <button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}
          className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
          {submitMut.isPending ? 'Submitting...' : 'Submit to OEM'}
        </button>
      </div>

      {isLoading && <p className="text-gray-500">Loading financial statement data from GL...</p>}
      {error && <p className="text-amber-600">No data available for this period. Ensure GL entries are posted and gl_relate mappings exist.</p>}

      {/* Statement header */}
      {fsData && (
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <h3 className="text-lg font-bold">{fsData.companyName ?? `Company ${company}`}</h3>
          <p className="text-sm text-gray-500">
            {oem} Financial Statement — Form {formDef?.formCode ?? '—'} — Period: {period}
          </p>
          <p className="text-xs text-gray-400">Generated {fsData.generatedAt ? new Date(fsData.generatedAt).toLocaleString() : 'N/A'}</p>
        </div>
      )}

      {/* Page tabs */}
      {formDef && (
        <div className="flex gap-1 flex-wrap">
          {formDef.pages.map((p) => (
            <button key={p.pageNumber}
              onClick={() => setActivePage(p.pageNumber)}
              className={`px-3 py-1.5 rounded-t text-sm border-b-2 transition-colors ${
                activePage === p.pageNumber
                  ? 'bg-white border-blue-600 text-brand font-semibold shadow-sm'
                  : 'bg-gray-100 border-transparent text-gray-600 hover:bg-gray-200'
              }`}>
              P{p.pageNumber}
            </button>
          ))}
        </div>
      )}

      {/* Active page content */}
      {formDef && currentPage && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-md font-semibold mb-3 border-b pb-2">
            Page {currentPage.pageNumber}: {currentPage.pageTitle}
          </h3>
          <FSPageRenderer page={currentPage} data={fsData} />
          <div className="mt-2 text-xs text-gray-400 text-right">
            {(currentPage.lines ?? []).filter((l) => l.source !== FSLineSource.HEADER).length} line items
          </div>
        </div>
      )}

      {/* No form definition */}
      {!formDef && (
        <div className="bg-amber-50 rounded-lg shadow p-6 text-center">
          <p className="text-amber-700 font-medium">Form definition not available for {oem}.</p>
          <p className="text-sm text-gray-500 mt-1">Only OEMs with registered form structures can be previewed.</p>
        </div>
      )}

      {/* Warnings / Unmapped accounts */}
      {fsData?.warnings && fsData.warnings.length > 0 && (
        <div className="bg-amber-50 rounded-lg shadow p-4">
          <h3 className="text-md font-semibold mb-2 text-amber-700">Validation Warnings</h3>
          {fsData.warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-600">{w}</p>
          ))}
        </div>
      )}

      {fsData?.unmappedAccounts && fsData.unmappedAccounts.length > 0 && (
        <div className="bg-red-50 rounded-lg shadow p-4">
          <h3 className="text-md font-semibold mb-2 text-red-700">
            Unmapped GL Accounts ({fsData.unmappedAccounts.length})
          </h3>
          <p className="text-xs text-gray-500 mb-2">
            These GL accounts have balances but no gl_relate mapping to OEM lines.
          </p>
          <div className="flex flex-wrap gap-1">
            {fsData.unmappedAccounts.map((a) => (
              <span key={a} className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-mono">{a}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
