import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { posReceiptApi } from '../../../api/client';
import { ErrorState, LoadingState, UnauthorizedState, formatMoney } from '../../../components/report';
import { Btn } from '../../../components/ui';

export default function ReceiptPrint() {
  const { receiptId } = useParams<{ receiptId: string }>();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  function load() {
    if (!receiptId) return;
    setLoading(true);
    setError(null);
    setUnauthorized(null);
    posReceiptApi
      .getPrintableReceipt(receiptId)
      .then(setReceipt)
      .catch((err: any) => {
        if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
        else setError(err.message);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [receiptId]);

  if (unauthorized) return <UnauthorizedState testId="receipt-print-unauthorized" message={unauthorized} />;
  if (error) return <ErrorState testId="receipt-print-error" message={error} onRetry={load} onBack={() => navigate(-1)} />;
  if (loading) return <LoadingState testId="receipt-print-loading" label="Loading receipt…" />;
  if (!receipt) return null;

  return (
    <div className="max-w-md mx-auto py-8 print:py-0">
      <div className="mb-4 flex gap-2 print:hidden">
        <Btn data-testid="receipt-print-button" onClick={() => window.print()}>Print</Btn>
        <Btn variant="secondary" onClick={() => navigate(-1)}>Back</Btn>
      </div>
      <div className="bg-white border border-slate-200 rounded-md p-6 font-mono text-[13px]" data-testid="receipt-printable">
        <div className="text-center font-semibold text-[15px] mb-1">CASH RECEIPT</div>
        <div className="text-center text-slate-500 mb-4">{receipt.drawer?.storeCode} · Terminal {receipt.drawer?.terminalCode}</div>
        <div className="border-t border-b border-dashed border-slate-300 py-2 mb-2">
          <div>Receipt #: {receipt.receiptNumber}</div>
          <div>Date: {new Date(receipt.issuedAt).toLocaleString()}</div>
          <div>Source: {receipt.sourceDocType} {receipt.sourceDisplayNumber ?? receipt.sourceDocId}</div>
          {receipt.payerReference && <div>Payer: {receipt.payerReference}</div>}
        </div>
        {receipt.tenders.map((t: any, i: number) => (
          <div key={i} className="flex justify-between">
            <span>{t.tenderType}{t.checkNumber ? ` #${t.checkNumber}` : ''}</span>
            <span>{formatMoney(Number(t.amount))}</span>
          </div>
        ))}
        {receipt.tenders.some((t: any) => Number(t.changeGiven) > 0) && (
          <div className="flex justify-between text-slate-500">
            <span>Change</span>
            <span>{formatMoney(receipt.tenders.reduce((s: number, t: any) => s + Number(t.changeGiven ?? 0), 0))}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold border-t border-slate-300 mt-2 pt-2">
          <span>Total</span>
          <span>{formatMoney(Number(receipt.totalAmount))}</span>
        </div>
        {receipt.status === 'VOIDED' && (
          <div className="text-center text-red-600 font-semibold mt-3">*** VOIDED ***</div>
        )}
      </div>
    </div>
  );
}
