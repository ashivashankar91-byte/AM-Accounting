import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { cashDrawerApi, posReceiptApi } from '../../../api/client';
import { Banner, EmptyState, ErrorState, LoadingState, UnauthorizedState, ReportShell } from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

const STATUS_BADGE: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  OPEN: { label: 'Open', variant: 'success' },
  BLIND_COUNT_SUBMITTED: { label: 'Blind Count Submitted', variant: 'info' },
  VARIANCE_REVIEW_REQUIRED: { label: 'Variance Review Required', variant: 'warning' },
  RECONCILED: { label: 'Reconciled', variant: 'neutral' },
};

export default function DrawerHome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [drawer, setDrawer] = useState<any>(null);
  const [receiptCount, setReceiptCount] = useState<number | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  function load() {
    if (!user) return undefined;
    // Guard against out-of-order resolution of overlapping requests (e.g. two
    // effect invocations from the same mount, or a rapid re-mount) so a
    // slower, stale response can never clobber a newer, correct one.
    let cancelled = false;
    setPageLoading(true);
    setPageError(null);
    setUnauthorized(null);
    cashDrawerApi
      .getActiveDrawer({ cashierId: user.id })
      .then(async (res) => {
        if (cancelled) return;
        const receipts = res.drawer
          ? await posReceiptApi.searchReceipts({ drawerId: res.drawer.id, status: 'ISSUED' })
          : null;
        if (cancelled) return;
        setDrawer(res.drawer);
        setReceiptCount(receipts ? receipts.total : null);
      })
      .catch((err: any) => {
        if (cancelled) return;
        if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
        else setPageError(err.message);
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(load, [user]);

  const status = drawer ? STATUS_BADGE[drawer.status] : null;

  return (
    <ReportShell title="Cashier Drawer" description="Open a drawer, receive payments and submit your blind close.">
      {unauthorized && <UnauthorizedState testId="cash-drawer-home-unauthorized" message={unauthorized} />}
      {pageError && <ErrorState testId="cash-drawer-home-error" message={pageError} onRetry={load} />}
      {pageLoading && <LoadingState testId="cash-drawer-home-loading" label="Loading your drawer…" />}

      {!pageLoading && !unauthorized && !pageError && (
        <>
          {!drawer && (
            <EmptyState
              testId="cash-drawer-home-empty"
              title="No active drawer"
              message="Open a drawer to start receiving cash and check payments."
              action={<Btn data-testid="cash-open-drawer-cta" onClick={() => navigate('/accounting/cash/open')}>Open Drawer</Btn>}
            />
          )}

          {drawer && (
            <div className="bg-white border border-slate-200 rounded-md p-5" data-testid="cash-drawer-home-card">
              <div className="flex items-center gap-3 mb-3">
                <span className="font-semibold text-slate-900 text-[15px]">Drawer at {drawer.terminalCode}</span>
                {status && <Badge variant={status.variant}>{status.label}</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[12.5px] text-slate-600 mb-4">
                <div>Store <span className="font-medium text-slate-900">{drawer.storeCode}</span></div>
                <div>Business date <span className="font-medium text-slate-900">{String(drawer.businessDate).slice(0, 10)}</span></div>
                <div>Opening float <span className="font-mono font-medium text-slate-900">{Number(drawer.openingFloat).toFixed(2)}</span></div>
                <div>Receipts issued <span className="font-medium text-slate-900" data-testid="cash-drawer-receipt-count">{receiptCount ?? '—'}</span></div>
              </div>

              {drawer.status === 'OPEN' && (
                <div className="flex gap-2">
                  <Btn data-testid="cash-receive-payment-cta" onClick={() => navigate(`/accounting/cash/receive?drawerId=${drawer.id}`)}>
                    Receive Payment
                  </Btn>
                  <Btn data-testid="cash-blind-close-cta" variant="secondary" onClick={() => navigate(`/accounting/cash/drawers/${drawer.id}/blind-close`)}>
                    Blind Close
                  </Btn>
                </div>
              )}

              {(drawer.status === 'BLIND_COUNT_SUBMITTED' || drawer.status === 'VARIANCE_REVIEW_REQUIRED') && (
                <Banner kind="info" title="Blind close submitted" testId="cash-drawer-blind-submitted-banner">
                  This drawer is waiting on supervisor reconciliation. No further receipts or voids can be entered.
                </Banner>
              )}

              {drawer.status === 'RECONCILED' && (
                <Banner kind="success" title="Drawer reconciled" testId="cash-drawer-reconciled-banner">
                  This drawer is permanently closed and read-only.
                </Banner>
              )}

              <div className="mt-3">
                <Btn variant="ghost" size="sm" onClick={() => navigate(`/accounting/cash/receipts?drawerId=${drawer.id}`)}>
                  View receipts for this drawer
                </Btn>
              </div>
            </div>
          )}
        </>
      )}
    </ReportShell>
  );
}
