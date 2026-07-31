import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { posReceiptApi } from '../../../api/client';
import {
  EmptyState, ErrorState, LoadingState, UnauthorizedState, ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd, MoneyTd,
} from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

const STATUS_BADGE: Record<string, 'success' | 'neutral'> = { ISSUED: 'success', VOIDED: 'neutral' };

export default function ReceiptSearch() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [receiptNumber, setReceiptNumber] = useState('');
  const [sourceDocId, setSourceDocId] = useState('');
  const [status, setStatus] = useState('');
  const drawerId = params.get('drawerId') ?? '';

  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  function search() {
    setLoading(true);
    setError(null);
    setUnauthorized(null);
    posReceiptApi
      .searchReceipts({ receiptNumber: receiptNumber || undefined, sourceDocId: sourceDocId || undefined, status: status || undefined, drawerId: drawerId || undefined })
      .then((res) => { setItems(res.items); setTotal(res.total); })
      .catch((err: any) => {
        if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
        else setError(err.message);
      })
      .finally(() => setLoading(false));
  }

  useEffect(search, [drawerId]);

  return (
    <ReportShell title="Receipt Search" description="Search cash receipts by number, source reference, or status.">
      {unauthorized && <UnauthorizedState testId="receipt-search-unauthorized" message={unauthorized} />}

      {!unauthorized && (
        <>
          <FilterBar>
            <FilterField label="Receipt #" width={180}>
              <input data-testid="receipt-search-number" value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <FilterField label="Source reference" width={180}>
              <input data-testid="receipt-search-source" value={sourceDocId} onChange={(e) => setSourceDocId(e.target.value)} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <FilterField label="Status" width={150}>
              <select data-testid="receipt-search-status" value={status} onChange={(e) => setStatus(e.target.value)} className={FILTER_CONTROL_CLASS}>
                <option value="">All</option>
                <option value="ISSUED">Issued</option>
                <option value="VOIDED">Voided</option>
              </select>
            </FilterField>
            <Btn data-testid="receipt-search-run" size="sm" onClick={search}>Search</Btn>
          </FilterBar>

          {error && <ErrorState testId="receipt-search-error" message={error} onRetry={search} />}
          {loading && <LoadingState testId="receipt-search-loading" label="Searching receipts…" />}

          {!loading && !error && items.length === 0 && (
            <EmptyState testId="receipt-search-empty" title="No receipts found" message="Try adjusting your search filters." />
          )}

          {!loading && !error && items.length > 0 && (
            <FinancialTable testId="receipt-search-table">
              <ReportThead>
                <tr>
                  <ReportTh>Receipt #</ReportTh>
                  <ReportTh>Source</ReportTh>
                  <ReportTh>Cashier</ReportTh>
                  <ReportTh align="right">Total</ReportTh>
                  <ReportTh>Status</ReportTh>
                  <ReportTh>Issued</ReportTh>
                </tr>
              </ReportThead>
              <tbody>
                {items.map((r) => (
                  <ReportTr key={r.id} testId={`receipt-row-${r.receiptNumber}`} onClick={() => navigate(`/accounting/cash/receipts/${r.id}`)}>
                    <ReportTd className="font-mono">{r.receiptNumber}</ReportTd>
                    <ReportTd>{r.sourceDisplayNumber ?? r.sourceDocId}</ReportTd>
                    <ReportTd>{r.cashierId}</ReportTd>
                    <MoneyTd value={Number(r.totalAmount)} />
                    <ReportTd><Badge variant={STATUS_BADGE[r.status] ?? 'neutral'}>{r.status}</Badge></ReportTd>
                    <ReportTd>{new Date(r.issuedAt).toLocaleString()}</ReportTd>
                  </ReportTr>
                ))}
              </tbody>
            </FinancialTable>
          )}
          {!loading && !error && <p className="text-[12px] text-slate-500 mt-2">{total} result{total === 1 ? '' : 's'}</p>}
        </>
      )}
    </ReportShell>
  );
}
