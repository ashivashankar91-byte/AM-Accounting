// CE-12 / S084-S085 — Deal Posting Inquiry. Searchable/filterable list of
// deals with a recap-vs-journal, rule-pack-pinned detail per row. Mirrors
// ScheduleOpenItems.tsx's hand-rolled Tailwind table + expandable-row
// pattern exactly. Every dollar figure and every rule-pack version shown
// here comes straight through from deal-accounting-service's real
// GET /deals and GET /deals/:dealNumber responses — nothing is computed in
// this file.
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { ce12DealApi, type Deal, type DealType } from '../../../api/ce12-deal-client';
import { JournalDrillDrawer } from '../../../components/ce12/JournalDrillDrawer';

const fmt = (n: number | string | null | undefined) => {
  if (n == null) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return String(n);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—';

const DEAL_STATUS_BADGE: Record<string, string> = {
  DESKED: 'bg-gray-100 text-gray-600',
  FINALIZED: 'bg-amber-100 text-amber-700',
  POSTED: 'bg-emerald-100 text-emerald-700',
  UNWOUND: 'bg-purple-100 text-purple-700',
  RECONTRACTED: 'bg-blue-100 text-blue-700',
};

const COA_STATUS_BADGE: Record<string, string> = {
  POSTED: 'bg-emerald-100 text-emerald-700',
  NO_RULE_MATCH: 'bg-amber-100 text-amber-700',
  REJECTED: 'bg-red-100 text-red-700',
  FAILED: 'bg-red-100 text-red-700',
};

function Badge({ status, map }: { status: string; map: Record<string, string> }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium tracking-wide ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// Recap key figures worth showing next to the journal — real recap payload
// fields only, no derived math.
const RECAP_DISPLAY_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'saleAmount', label: 'Sale amount' },
  { key: 'dealerTradeAmount', label: 'Dealer trade amount' },
  { key: 'wholesaleAmount', label: 'Wholesale amount' },
  { key: 'leaseCapitalizedCostAmount', label: 'Lease cap cost' },
  { key: 'leaseResidualAmount', label: 'Lease residual' },
  { key: 'unitCostAmount', label: 'Unit cost' },
  { key: 'tradeAllowanceAmount', label: 'Trade allowance' },
  { key: 'tradeAcvAmount', label: 'Trade ACV' },
  { key: 'tradePayoffAmount', label: 'Trade payoff' },
  { key: 'financedAmount', label: 'Financed (CIT)' },
  { key: 'reserveIncomeAmount', label: 'Reserve income' },
  { key: 'feesAmount', label: 'Fees' },
  { key: 'rebateReceivableAmount', label: 'Rebate receivable' },
];

function DealDetailRow({ dealNumber, onDrillJournal }: { dealNumber: string; onDrillJournal: (journalNumber: string) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ce12-deal-inquiry-detail', dealNumber],
    queryFn: () => ce12DealApi.getDeal(dealNumber),
  });

  if (isLoading) {
    return (
      <tr>
        <td colSpan={8} className="px-3 py-4 text-center">
          <Loader2 size={16} className="animate-spin text-brand inline" />
        </td>
      </tr>
    );
  }
  if (error) {
    return (
      <tr>
        <td colSpan={8} className="px-3 py-3 text-red-600 text-xs flex items-center gap-1">
          <AlertCircle size={13} /> {(error as any)?.status === 403 ? 'Not authorized to view this deal.' : (error as Error).message}
        </td>
      </tr>
    );
  }
  const latestRecap = data?.recaps?.[data.recaps.length - 1];
  const payload: any = latestRecap?.payload ?? {};

  return (
    <tr className="bg-gray-50">
      <td colSpan={8} className="px-3 py-3" data-testid={`deal-detail-panel-${dealNumber}`}>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Recap v{latestRecap?.recapVersion ?? '—'} (authoritative input)
            </div>
            <table className="w-full text-[11px]">
              <tbody>
                {RECAP_DISPLAY_FIELDS.filter((f) => payload[f.key] != null).map((f) => (
                  <tr key={f.key}>
                    <td className="text-gray-500 pr-2 py-0.5">{f.label}</td>
                    <td className="font-mono text-right py-0.5">{fmt(payload[f.key])}</td>
                  </tr>
                ))}
                {(payload.products ?? []).map((p: any, i: number) => (
                  <tr key={`product-${i}`}>
                    <td className="text-gray-500 pr-2 py-0.5">Product {p.productCode}</td>
                    <td className="font-mono text-right py-0.5">{fmt(p.customerPriceAmount)} / cost {fmt(p.providerCostAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Posted journal segments (rule-pack pinned)</div>
            <table className="w-full text-[11px] border-collapse" data-testid={`deal-journal-segments-${dealNumber}`}>
              <thead>
                <tr className="text-gray-500 text-left">
                  <th className="pr-2 py-0.5 font-medium">Segment</th>
                  <th className="pr-2 py-0.5 font-medium">Journal#</th>
                  <th className="pr-2 py-0.5 font-medium">Rule pack ver.</th>
                  <th className="pr-2 py-0.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.postingRecords ?? []).length === 0 && (
                  <tr><td colSpan={4} className="text-gray-400 py-1">No posting segments yet.</td></tr>
                )}
                {(data?.postingRecords ?? []).map((pr) => (
                  <tr key={pr.id} data-testid={`journal-segment-row-${pr.id}`} className="border-t border-gray-200">
                    <td className="pr-2 py-0.5">
                      {pr.segmentType}{pr.reversedAt ? ' (reversed)' : ''}
                    </td>
                    <td className="pr-2 py-0.5 font-mono">
                      {pr.journalNumber ? (
                        <button
                          type="button"
                          className="text-brand hover:underline"
                          data-testid={`journal-drill-link-${pr.id}`}
                          onClick={() => onDrillJournal(pr.journalNumber!)}
                        >
                          {pr.journalNumber}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="pr-2 py-0.5 font-mono">{pr.rulePackVersionId ?? '—'}</td>
                    <td className="pr-2 py-0.5"><Badge status={pr.coaStatus} map={COA_STATUS_BADGE} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function DealPostingInquiry() {
  const [search, setSearch] = useState('');
  const [variant, setVariant] = useState<DealType | ''>('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drillJournal, setDrillJournal] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ce12-deal-postings'],
    queryFn: () => ce12DealApi.listDeals(),
  });

  const deals: Deal[] = data?.items ?? [];

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      if (variant && d.dealType !== variant) return false;
      if (statusFilter && d.status !== statusFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!d.dealNumber.toLowerCase().includes(s) && !(d.vin ?? '').toLowerCase().includes(s) && !(d.stockNumber ?? '').toLowerCase().includes(s)) {
          return false;
        }
      }
      return true;
    });
  }, [deals, variant, statusFilter, search]);

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">
      <div className="bg-white border-b border-gray-200 px-4 pt-2 pb-2">
        <h1 className="text-sm font-semibold text-gray-900 mb-2">Deal Posting Inquiry</h1>
        <div className="flex items-center flex-wrap gap-3">
          <div className="flex items-center gap-1">
            <label className="text-xs font-medium text-gray-600">Search:</label>
            <input
              data-testid="deal-posting-search-input"
              className="h-8 w-48 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Deal# / VIN / Stock#"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs font-medium text-gray-600">Variant:</label>
            <select
              data-testid="deal-posting-variant-filter"
              className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
              value={variant}
              onChange={(e) => setVariant(e.target.value as DealType | '')}
            >
              <option value="">All variants</option>
              <option value="RETAIL">Retail</option>
              <option value="LEASE">Lease</option>
              <option value="WHOLESALE">Wholesale</option>
              <option value="DEALER_TRADE">Dealer trade</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs font-medium text-gray-600">Status:</label>
            <select
              data-testid="deal-posting-status-filter"
              className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="DESKED">Desked</option>
              <option value="FINALIZED">Finalized</option>
              <option value="POSTED">Posted</option>
              <option value="UNWOUND">Unwound</option>
              <option value="RECONTRACTED">Recontracted</option>
            </select>
          </div>
          <button
            data-testid="deal-posting-refresh-button"
            className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium"
            onClick={() => refetch()}
          >
            <Search size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-brand" />
          </div>
        )}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm" data-testid="deal-posting-error">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'You do not have permission to view deal postings.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="deal-posting-empty">
            No deals found for this filter.
          </div>
        )}
        {!isLoading && !error && filtered.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="w-6 border-b border-gray-200" />
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Deal#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Variant</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Stock#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-32">VIN</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-20">Recap ver.</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <Fragment key={d.id}>
                  <tr data-testid={`deal-row-${d.dealNumber}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                    <td className="px-1 text-center">
                      <button
                        data-testid={`expand-deal-button-${d.dealNumber}`}
                        onClick={() => setExpanded(expanded === d.dealNumber ? null : d.dealNumber)}
                        aria-label="Expand"
                      >
                        {expanded === d.dealNumber ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>
                    </td>
                    <td className="px-3 font-mono">{d.dealNumber}</td>
                    <td className="px-3">{d.dealType.replace('_', ' ')}</td>
                    <td className="px-3 font-mono">{d.stockNumber ?? '—'}</td>
                    <td className="px-3 font-mono">{d.vin ?? '—'}</td>
                    <td className="px-3">{d.currentRecapVersion}</td>
                    <td className="px-3">
                      <Badge status={d.status} map={DEAL_STATUS_BADGE} />
                      {d.fundedFlag && <span className="ml-1 text-[10px] text-emerald-600">funded</span>}
                    </td>
                    <td className="px-3">
                      <Link
                        data-testid={`view-deal-button-${d.dealNumber}`}
                        className="text-brand hover:underline text-[11px] font-medium"
                        to={`/accounting/deals/${encodeURIComponent(d.dealNumber)}`}
                      >
                        View detail
                      </Link>
                    </td>
                  </tr>
                  {expanded === d.dealNumber && <DealDetailRow dealNumber={d.dealNumber} onDrillJournal={setDrillJournal} />}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {drillJournal && <JournalDrillDrawer journalNumber={drillJournal} onClose={() => setDrillJournal(null)} />}
    </div>
  );
}
