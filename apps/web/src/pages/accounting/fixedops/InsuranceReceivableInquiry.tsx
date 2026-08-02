// CE-11 / Integration-fix — Insurance Receivable Inquiry wired to CE-09 S049.
// Phase 5 reconciliation: replaced the PENDING_UPSTREAM_TECHNICAL_RECONCILIATION
// shell with the real CE-09 insuranceClaimApi. No insurance accounting is
// defined here — this surface consumes, never redefines, S049.
import { useEffect, useState } from 'react';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh,
  EmptyState,
} from '../../../components/report';
import { insuranceClaimApi } from '../../../api/client';

interface InsuranceClaim {
  id: string;
  claimNumber: string;
  roReference?: string | null;
  insurerName: string;
  insurerReference?: string | null;
  customerId: string;
  claimAmount: number;
  effectiveClaimAmount: number;
  remainingBalance: number;
  status: string;
  glEntryId?: string | null;
  glPostingError?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  PARTIALLY_PAID: 'Partial',
  SETTLED: 'Settled',
  SHORT_PAY_DISPOSITIONED: 'Short Pay',
  WRITTEN_OFF: 'Written Off',
};

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-blue-50 text-blue-700',
  PARTIALLY_PAID: 'bg-yellow-50 text-yellow-700',
  SETTLED: 'bg-green-50 text-green-700',
  SHORT_PAY_DISPOSITIONED: 'bg-orange-50 text-orange-700',
  WRITTEN_OFF: 'bg-gray-50 text-gray-500',
};

function fmtAmt(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
}

export default function InsuranceReceivableInquiry() {
  const [roRef, setRoRef] = useState('');
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    insuranceClaimApi.list()
      .then((rows: any[]) => { setClaims(rows as InsuranceClaim[]); })
      .catch((e: any) => { setError(e?.message ?? 'Failed to load insurance claims'); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = roRef.trim()
    ? claims.filter((c) => c.roReference?.toLowerCase().includes(roRef.trim().toLowerCase()))
    : claims;

  return (
    <ReportShell
      title="Insurance Receivable Inquiry"
      description="Body-shop insurance claim receivables from CE-09 S049. This surface consumes CE-09's API and never redefines insurance-claim accounting."
    >
      <FilterBar>
        <FilterField label="RO reference" width={200}>
          <input
            className={FILTER_CONTROL_CLASS}
            value={roRef}
            onChange={(e) => setRoRef(e.target.value)}
            placeholder="RO#"
            data-testid="insurance-ro-filter"
          />
        </FilterField>
      </FilterBar>

      {loading && (
        <div data-testid="insurance-loading" className="py-8 text-center text-sm text-gray-500">
          Loading insurance claims…
        </div>
      )}

      {!loading && error && (
        <div data-testid="insurance-error" className="py-4 text-sm text-red-600 font-medium">
          {error}
        </div>
      )}

      {!loading && !error && (
        <FinancialTable testId="insurance-table">
          <ReportThead>
            <tr>
              <ReportTh>Claim #</ReportTh>
              <ReportTh>RO#</ReportTh>
              <ReportTh>Insurer</ReportTh>
              <ReportTh align="right">Claim Amount</ReportTh>
              <ReportTh align="right">Remaining</ReportTh>
              <ReportTh>Status</ReportTh>
              <ReportTh>Journal</ReportTh>
            </tr>
          </ReportThead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50" data-testid="insurance-claim-row">
                <td className="px-3 py-2 text-sm font-mono text-blue-700">{c.claimNumber}</td>
                <td className="px-3 py-2 text-sm text-gray-600">{c.roReference ?? '—'}</td>
                <td className="px-3 py-2 text-sm">{c.insurerName}{c.insurerReference ? ` (${c.insurerReference})` : ''}</td>
                <td className="px-3 py-2 text-sm text-right font-mono">{fmtAmt(c.effectiveClaimAmount)}</td>
                <td className="px-3 py-2 text-sm text-right font-mono">{fmtAmt(c.remainingBalance)}</td>
                <td className="px-3 py-2 text-sm">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[c.status] ?? 'bg-gray-50 text-gray-600'}`}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                  {c.glPostingError && (
                    <span className="ml-1 text-xs text-red-500" data-testid="insurance-gl-error">GL error</span>
                  )}
                </td>
                <td className="px-3 py-2 text-sm font-mono text-gray-400 text-xs">{c.glEntryId ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </FinancialTable>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          testId="insurance-empty"
          title="No insurance receivable items"
          message={
            roRef.trim()
              ? `No insurance claims found for RO reference "${roRef}".`
              : 'No insurance claims have been recorded for this tenant yet.'
          }
        />
      )}
    </ReportShell>
  );
}
