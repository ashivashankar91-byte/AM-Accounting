import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { cashDrawerApi, posReceiptApi } from '../../../api/client';
import { Banner, ErrorState, LoadingState, UnauthorizedState, ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS, formatMoney } from '../../../components/report';
import { Btn } from '../../../components/ui';

type TenderRow = { tenderType: 'CASH' | 'CHECK'; amount: string; cashTendered: string; checkNumber: string; checkPayer: string };

function emptyCashTender(): TenderRow {
  return { tenderType: 'CASH', amount: '', cashTendered: '', checkNumber: '', checkPayer: '' };
}
function emptyCheckTender(): TenderRow {
  return { tenderType: 'CHECK', amount: '', cashTendered: '', checkNumber: '', checkPayer: '' };
}

export default function ReceivePayment() {
  const { legalEntityId, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const drawerId = params.get('drawerId');

  const [drawer, setDrawer] = useState<any>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  const [sourceDocType, setSourceDocType] = useState('SERVICE_RO');
  const [sourceDocId, setSourceDocId] = useState('');
  const [sourceDisplayNumber, setSourceDisplayNumber] = useState('');
  const [payerReference, setPayerReference] = useState('');
  const [amountDue, setAmountDue] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [useSplit, setUseSplit] = useState(false);
  const [cashTender, setCashTender] = useState<TenderRow>(emptyCashTender());
  const [checkTender, setCheckTender] = useState<TenderRow>(emptyCheckTender());
  const [tenderMode, setTenderMode] = useState<'CASH' | 'CHECK' | 'SPLIT'>('CASH');

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);
  // Stable across re-renders (and across a retry after a network error) so a
  // resubmit never mints a second receipt — the backend's idempotencyKey
  // uniqueness is only useful if the client actually reuses the same key.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!drawerId) {
      setPageLoading(false);
      return;
    }
    setPageLoading(true);
    setPageError(null);
    setUnauthorized(null);
    cashDrawerApi
      .getDrawer(drawerId)
      .then(setDrawer)
      .catch((err: any) => {
        if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
        else setPageError(err.message);
      })
      .finally(() => setPageLoading(false));
  }, [drawerId]);

  const totalCents = Math.round((Number(totalAmount) || 0) * 100);
  const cashCents = tenderMode !== 'CHECK' ? Math.round((Number(cashTender.amount) || 0) * 100) : 0;
  const checkCents = tenderMode !== 'CASH' ? Math.round((Number(checkTender.amount) || 0) * 100) : 0;
  const tenderSumCents = tenderMode === 'SPLIT' ? cashCents + checkCents : tenderMode === 'CASH' ? cashCents : checkCents;
  const tenderMismatch = totalCents > 0 && tenderSumCents !== totalCents;
  const changeCents = tenderMode !== 'CHECK' && cashTender.cashTendered
    ? Math.round((Number(cashTender.cashTendered) || 0) * 100) - cashCents
    : 0;

  const canSubmit = Boolean(drawer && drawer.status === 'OPEN' && sourceDocId.trim() && totalCents > 0 && !tenderMismatch && !busy);

  async function submit() {
    if (!drawer) return;
    setError(null);
    setBusy(true);
    try {
      const tenders: any[] = [];
      if (tenderMode !== 'CHECK' && cashCents > 0) {
        tenders.push({ tenderType: 'CASH', amount: cashTender.amount, cashTendered: cashTender.cashTendered || cashTender.amount });
      }
      if (tenderMode !== 'CASH' && checkCents > 0) {
        tenders.push({ tenderType: 'CHECK', amount: checkTender.amount, checkNumber: checkTender.checkNumber || null, checkPayer: checkTender.checkPayer || null });
      }
      const result = await posReceiptApi.createReceipt(drawer.id, {
        entityId: legalEntityId!,
        sourceDocType,
        sourceDocId: sourceDocId.trim(),
        sourceDisplayNumber: sourceDisplayNumber.trim() || null,
        payerReference: payerReference.trim() || null,
        amountDue: amountDue ? amountDue : null,
        totalAmount,
        tenders,
        idempotencyKey,
      });
      setReceipt(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!drawerId) {
    return (
      <ReportShell title="Receive Payment">
        <Banner kind="warning" title="No drawer selected" testId="receive-payment-no-drawer">
          Open a drawer first, then come back here to receive a payment.
        </Banner>
        <div className="mt-3"><Btn variant="secondary" onClick={() => navigate('/accounting/cash')}>Back to drawer</Btn></div>
      </ReportShell>
    );
  }

  if (receipt) {
    return (
      <ReportShell title="Receipt Confirmation" status={{ label: 'Issued', variant: 'success' }}>
        <div className="bg-white border border-slate-200 rounded-md p-5 max-w-lg" data-testid="receipt-confirmation">
          <div className="text-[18px] font-semibold font-mono text-slate-900 mb-1" data-testid="receipt-confirmation-number">{receipt.receiptNumber}</div>
          <div className="text-[12.5px] text-slate-500 mb-3">{receipt.sourceDocType} · {receipt.sourceDocId}</div>
          <div className="text-[12.5px] text-slate-600 mb-3">
            {receipt.tenders.map((t: any, i: number) => (
              <div key={i}>{t.tenderType} — {formatMoney(Number(t.amount))}{t.changeGiven ? ` (change ${formatMoney(Number(t.changeGiven))})` : ''}</div>
            ))}
          </div>
          <div className="text-[15px] font-semibold mb-4">Total: <span className="font-mono">{formatMoney(Number(receipt.totalAmount))}</span></div>
          <div className="flex gap-2">
            <Btn data-testid="receipt-confirmation-print" variant="secondary" onClick={() => navigate(`/accounting/cash/receipts/${receipt.id}/print`)}>Print Receipt</Btn>
            <Btn data-testid="receipt-confirmation-next" onClick={() => navigate(`/accounting/cash/receive?drawerId=${drawer.id}`)}>Next Receipt</Btn>
            <Btn variant="ghost" onClick={() => navigate('/accounting/cash')}>Back to Drawer</Btn>
          </div>
        </div>
      </ReportShell>
    );
  }

  return (
    <ReportShell title="Receive Payment" description="Enter the source document and tender to issue an immutable receipt.">
      {unauthorized && <UnauthorizedState testId="receive-payment-unauthorized" message={unauthorized} />}
      {pageError && <ErrorState testId="receive-payment-page-error" message={pageError} onRetry={() => window.location.reload()} />}
      {pageLoading && <LoadingState testId="receive-payment-loading" label="Loading drawer…" />}

      {!pageLoading && !unauthorized && !pageError && drawer && drawer.status !== 'OPEN' && (
        <Banner kind="warning" title="Drawer is not open" testId="receive-payment-drawer-not-open">
          This drawer is {drawer.status.replace(/_/g, ' ').toLowerCase()} — receipts can only be issued against an open drawer.
        </Banner>
      )}

      {!pageLoading && !unauthorized && !pageError && drawer && drawer.status === 'OPEN' && (
        <div className="bg-white border border-slate-200 rounded-md p-5 max-w-2xl">
          <FilterBar>
            <FilterField label="Source type" width={180}>
              <select data-testid="receive-source-type" value={sourceDocType} onChange={(e) => setSourceDocType(e.target.value)} className={FILTER_CONTROL_CLASS}>
                <option value="SERVICE_RO">Service RO</option>
                <option value="PARTS_INVOICE">Parts Invoice</option>
                <option value="OTHER">Other</option>
              </select>
            </FilterField>
            <FilterField label="Source reference #" width={180}>
              <input data-testid="receive-source-id" value={sourceDocId} onChange={(e) => setSourceDocId(e.target.value)} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <FilterField label="Display number" width={160}>
              <input data-testid="receive-source-display" value={sourceDisplayNumber} onChange={(e) => setSourceDisplayNumber(e.target.value)} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <FilterField label="Payer / customer" width={180}>
              <input data-testid="receive-payer" value={payerReference} onChange={(e) => setPayerReference(e.target.value)} className={FILTER_CONTROL_CLASS} />
            </FilterField>
          </FilterBar>
          <FilterBar>
            <FilterField label="Amount due" width={130}>
              <input data-testid="receive-amount-due" type="number" step="0.01" value={amountDue} onChange={(e) => setAmountDue(e.target.value)} className={`${FILTER_CONTROL_CLASS} font-mono text-right`} />
            </FilterField>
            <FilterField label="Receipt total" width={130}>
              <input data-testid="receive-total-amount" type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} className={`${FILTER_CONTROL_CLASS} font-mono text-right`} />
            </FilterField>
            <FilterField label="Tender" width={220}>
              <select
                data-testid="receive-tender-mode"
                value={tenderMode}
                onChange={(e) => setTenderMode(e.target.value as any)}
                className={FILTER_CONTROL_CLASS}
              >
                <option value="CASH">Cash only</option>
                <option value="CHECK">Check only</option>
                <option value="SPLIT">Split cash / check</option>
              </select>
            </FilterField>
          </FilterBar>

          {tenderMode !== 'CHECK' && (
            <FilterBar>
              <FilterField label="Cash amount" width={130}>
                <input data-testid="receive-cash-amount" type="number" step="0.01" value={cashTender.amount} onChange={(e) => setCashTender((t) => ({ ...t, amount: e.target.value }))} className={`${FILTER_CONTROL_CLASS} font-mono text-right`} />
              </FilterField>
              <FilterField label="Cash tendered" width={130}>
                <input data-testid="receive-cash-tendered" type="number" step="0.01" value={cashTender.cashTendered} onChange={(e) => setCashTender((t) => ({ ...t, cashTendered: e.target.value }))} placeholder={cashTender.amount} className={`${FILTER_CONTROL_CLASS} font-mono text-right`} />
              </FilterField>
              <FilterField label="Change" width={100}>
                <div className="h-8 flex items-center font-mono text-[13px]" data-testid="receive-change">{formatMoney(changeCents / 100)}</div>
              </FilterField>
            </FilterBar>
          )}

          {tenderMode !== 'CASH' && (
            <FilterBar>
              <FilterField label="Check amount" width={130}>
                <input data-testid="receive-check-amount" type="number" step="0.01" value={checkTender.amount} onChange={(e) => setCheckTender((t) => ({ ...t, amount: e.target.value }))} className={`${FILTER_CONTROL_CLASS} font-mono text-right`} />
              </FilterField>
              <FilterField label="Check #" width={140}>
                <input data-testid="receive-check-number" value={checkTender.checkNumber} onChange={(e) => setCheckTender((t) => ({ ...t, checkNumber: e.target.value }))} className={FILTER_CONTROL_CLASS} />
              </FilterField>
              <FilterField label="Check payer" width={160}>
                <input data-testid="receive-check-payer" value={checkTender.checkPayer} onChange={(e) => setCheckTender((t) => ({ ...t, checkPayer: e.target.value }))} className={FILTER_CONTROL_CLASS} />
              </FilterField>
            </FilterBar>
          )}

          {tenderMismatch && (
            <Banner kind="error" title="Tender does not match the receipt total" testId="receive-tender-mismatch">
              Tendered {formatMoney(tenderSumCents / 100)} against a total of {formatMoney(totalCents / 100)}.
            </Banner>
          )}
          {error && <ErrorState testId="receive-payment-error" message={error} />}

          <div className="mt-4">
            <Btn data-testid="receive-payment-submit" onClick={submit} disabled={!canSubmit} loading={busy}>
              Issue Receipt
            </Btn>
          </div>
        </div>
      )}
    </ReportShell>
  );
}
