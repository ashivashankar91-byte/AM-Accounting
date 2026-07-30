import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { posReceiptApi, goldenPathApi } from '../../../api/client';
import { Banner, ErrorState, LoadingState, UnauthorizedState, ReportShell, formatMoney } from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

export default function ReceiptDetails() {
  const { receiptId } = useParams<{ receiptId: string }>();
  const navigate = useNavigate();

  const [receipt, setReceipt] = useState<any>(null);
  const [auditHistory, setAuditHistory] = useState<any[] | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    if (!receiptId) return;
    setPageLoading(true);
    setPageError(null);
    setUnauthorized(null);
    posReceiptApi
      .getReceipt(receiptId)
      .then(setReceipt)
      .catch((err: any) => {
        if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
        else setPageError(err.message);
      })
      .finally(() => setPageLoading(false));

    // Best-effort — the audit-service exposes a generic entity-history
    // endpoint keyed by docType/docId; this section simply doesn't render
    // if it's unavailable, since browsing a receipt must never depend on it.
    goldenPathApi.getAuditHistory('CASH_RECEIPT', receiptId).then(setAuditHistory).catch(() => setAuditHistory(null));
  }

  useEffect(load, [receiptId]);

  async function submitVoid() {
    if (!receipt || !voidReason.trim()) return;
    setVoidError(null);
    setBusy(true);
    try {
      const updated = await posReceiptApi.voidReceipt(receipt.id, voidReason.trim());
      setReceipt(updated);
      setVoiding(false);
      setVoidReason('');
    } catch (err: any) {
      setVoidError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (unauthorized) return <UnauthorizedState testId="receipt-details-unauthorized" message={unauthorized} />;
  if (pageError) return <ErrorState testId="receipt-details-error" message={pageError} onRetry={load} onBack={() => navigate(-1)} />;
  if (pageLoading) return <LoadingState testId="receipt-details-loading" label="Loading receipt…" />;
  if (!receipt) return null;

  const canVoid = receipt.status === 'ISSUED';

  return (
    <ReportShell
      title={`Receipt ${receipt.receiptNumber}`}
      status={{ label: receipt.status, variant: receipt.status === 'ISSUED' ? 'success' : 'neutral' }}
      actions={
        <>
          <Btn data-testid="receipt-details-print" variant="secondary" onClick={() => navigate(`/golden-path/cash/receipts/${receipt.id}/print`)}>Print</Btn>
          {canVoid && (
            <Btn data-testid="receipt-details-void-cta" variant="danger" onClick={() => setVoiding(true)}>Void Receipt</Btn>
          )}
        </>
      }
    >
      <div className="bg-white border border-slate-200 rounded-md p-5" data-testid="receipt-details-card">
        <div className="text-[15px] font-semibold text-slate-900 mb-2">{receipt.receiptNumber}</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[12.5px] text-slate-600 mb-4">
          <div>Source <span className="font-medium text-slate-900">{receipt.sourceDocType} · {receipt.sourceDisplayNumber ?? receipt.sourceDocId}</span></div>
          <div>Cashier <span className="font-medium text-slate-900">{receipt.cashierId}</span></div>
          <div>Issued <span className="font-medium text-slate-900">{new Date(receipt.issuedAt).toLocaleString()}</span></div>
          <div>Payer <span className="font-medium text-slate-900">{receipt.payerReference ?? '—'}</span></div>
        </div>

        <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Tenders</div>
        <div className="text-[13px] mb-4">
          {receipt.tenders.map((t: any) => (
            <div key={t.id} className="flex justify-between border-b border-slate-100 py-1">
              <span>{t.tenderType}{t.checkNumber ? ` #${t.checkNumber}` : ''}</span>
              <span className="font-mono">{formatMoney(Number(t.amount))}</span>
            </div>
          ))}
        </div>
        <div className="text-[15px] font-semibold mb-2">Total: <span className="font-mono">{formatMoney(Number(receipt.totalAmount))}</span></div>

        {receipt.status === 'VOIDED' && (
          <Banner kind="warning" title="This receipt was voided" testId="receipt-details-voided-banner">
            Reason: {receipt.voidReason} — voided by {receipt.voidedBy} at {receipt.voidedAt ? new Date(receipt.voidedAt).toLocaleString() : '—'}.
            Original financial details above are preserved unchanged.
          </Banner>
        )}

        {voiding && (
          <div className="mt-4 border border-red-200 bg-red-50 rounded-md p-4" data-testid="receipt-void-dialog">
            <div className="font-semibold text-red-800 mb-2">Void this receipt</div>
            <textarea
              data-testid="receipt-void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Reason (required)"
              className="w-full h-16 border border-slate-300 rounded-md p-2 text-[13px]"
            />
            {voidError && <ErrorState testId="receipt-void-error" message={voidError} />}
            <div className="flex gap-2 mt-2">
              <Btn data-testid="receipt-void-confirm" variant="danger" onClick={submitVoid} disabled={!voidReason.trim() || busy} loading={busy}>Confirm Void</Btn>
              <Btn variant="ghost" onClick={() => { setVoiding(false); setVoidError(null); }}>Cancel</Btn>
            </div>
          </div>
        )}

        {auditHistory && auditHistory.length > 0 && (
          <div className="mt-5">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Audit Timeline</div>
            <ul className="text-[12.5px] text-slate-600 list-none p-0 m-0 flex flex-col gap-1">
              {auditHistory.map((a: any, i: number) => (
                <li key={i}>{new Date(a.occurredAt ?? a.createdAt).toLocaleString()} — {a.action} by {a.actorName ?? a.actorId}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-3">
        <Btn variant="ghost" size="sm" onClick={() => navigate('/golden-path/cash/receipts')}>Back to search</Btn>
      </div>
    </ReportShell>
  );
}
