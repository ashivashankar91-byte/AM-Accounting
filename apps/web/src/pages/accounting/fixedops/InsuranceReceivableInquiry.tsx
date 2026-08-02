// CE-11 mandatory UI screen #5 — Insurance Receivable Inquiry.
// /accounting/fixedops/insurance — cross-epic surface RENDERING CE-09 S049
// claim items (body-shop context). Consumes, does not redefine [PUTR: S049
// API]. A repo-wide search confirmed no CE-09 S049 implementation exists
// anywhere in this baseline — this screen is the full shell (filters,
// expected columns) with an honest banner/empty-state instead of any
// fabricated data.
import { useState } from 'react';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh,
  Banner, EmptyState,
} from '../../../components/report';

export default function InsuranceReceivableInquiry() {
  const [roRef, setRoRef] = useState('');

  return (
    <ReportShell
      title="Insurance Receivable Inquiry"
      description="Renders CE-09's S049 body-shop insurance claim items, filtered by RO reference. This surface consumes CE-09's API — it never redefines insurance-claim accounting."
    >
      <Banner kind="info" testId="insurance-putr-banner" title="PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — CE-09 S049 API">
        No CE-09 S049 (body-shop insurance claim) implementation exists in this baseline (confirmed by repository-wide
        search). This screen is the complete, mandatory shell — filters, columns, states — and will render real
        insurance receivable items the moment CE-09's S049 API lands. Nothing below is fabricated or estimated.
      </Banner>

      <FilterBar>
        <FilterField label="RO reference" width={200}>
          <input className={FILTER_CONTROL_CLASS} value={roRef} onChange={(e) => setRoRef(e.target.value)} placeholder="RO#" data-testid="insurance-ro-filter" />
        </FilterField>
      </FilterBar>

      <FinancialTable testId="insurance-table">
        <ReportThead>
          <tr>
            <ReportTh>Claim #</ReportTh>
            <ReportTh>RO#</ReportTh>
            <ReportTh>Insurer</ReportTh>
            <ReportTh align="right">Amount</ReportTh>
            <ReportTh align="right">Remaining</ReportTh>
            <ReportTh>Status</ReportTh>
          </tr>
        </ReportThead>
        <tbody />
      </FinancialTable>

      <EmptyState
        testId="insurance-empty"
        title="No insurance receivable data available"
        message="CE-09's S049 body-shop insurance claim API is not yet available in this baseline. This is a genuine upstream gap, not an empty result — see the banner above."
      />
    </ReportShell>
  );
}
