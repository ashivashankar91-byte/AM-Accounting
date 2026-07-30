import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cashDrawerApi } from '../../../api/client';
import { Banner, ErrorState, LoadingState, UnauthorizedState, ReportShell, formatMoney } from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

const CLASSIFICATION_BADGE: Record<string, 'success' | 'info' | 'danger' | 'warning'> = {
  EXACT: 'success', WITHIN_TOLERANCE: 'info', OUTSIDE_TOLERANCE: 'danger', NON_CASH_EXCEPTION: 'warning',
};

export default function SupervisorReconciliation() {
  const { drawerId } = useParams<{ drawerId: string }>();
  const navigate = useNavigate();

  const [view, setView] = useState<any>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  const [approvalReason, setApprovalReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    if (!drawerId) return;
    setPageLoading(true);
    setPageError(null);
    setUnauthorized(null);
    cashDrawerApi
      .getReconciliation(drawerId)
      .then(setView)
      .catch((err: any) => {
        if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
        else if (err.status === 409) setPageError('This drawer has no blind count submitted yet.');
        else setPageError(err.message);
      })
      .finally(() => setPageLoading(false));
  }

  useEffect(load, [drawerId]);

  async function approve() {
    if (!drawerId || !approvalReason.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await cashDrawerApi.approveVariance(drawerId, approvalReason.trim());
      load();
      setApprovalReason('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    if (!drawerId) return;
    setError(null);
    setBusy(true);
    try {
      await cashDrawerApi.reconcileDrawer(drawerId);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (unauthorized) return <UnauthorizedState testId="supervisor-recon-unauthorized" message={unauthorized} />;
  if (pageError) return <ErrorState testId="supervisor-recon-error" message={pageError} onRetry={load} onBack={() => navigate(-1)} />;
  if (pageLoading) return <LoadingState testId="supervisor-recon-loading" label="Loading reconciliation…" />;
  if (!view) return null;

  const { drawer, variance, approval } = view;
  const isReconciled = drawer.status === 'RECONCILED';
  const needsApproval = variance.requiresApproval && !approval;
  const canReconcile = drawer.status === 'BLIND_COUNT_SUBMITTED';

  return (
    <ReportShell
      title="Supervisor Drawer Reconciliation"
      status={{ label: drawer.status.replace(/_/g, ' '), variant: isReconciled ? 'neutral' : 'info' }}
    >
      <div className="bg-white border border-slate-200 rounded-md p-5" data-testid="supervisor-recon-card">
        <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-[13px] mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Expected cash</div>
            <div className="font-mono text-[15px]" data-testid="recon-expected-cash">{formatMoney(Number(variance.expectedCash))}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Counted cash</div>
            <div className="font-mono text-[15px]" data-testid="recon-counted-cash">{formatMoney(Number(variance.countedCash))}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Cash variance</div>
            <div className="font-mono text-[15px]" data-testid="recon-cash-variance">{formatMoney(Number(variance.cashVariance))}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Classification</div>
            <Badge variant={CLASSIFICATION_BADGE[variance.classification] ?? 'neutral'}>{variance.classification.replace(/_/g, ' ')}</Badge>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Checks — expected</div>
            <div className="font-mono">{variance.expectedCheckCount} / {formatMoney(Number(variance.expectedCheckTotal))}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Checks — counted</div>
            <div className="font-mono">{variance.countedCheckCount} / {formatMoney(Number(variance.countedCheckTotal))}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Deposit-eligible cash</div>
            <div className="font-mono text-[15px]">{formatMoney(Number(variance.depositEligibleCash))}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Tolerance applied</div>
            <div className="font-mono">{formatMoney(Number(variance.toleranceApplied))}</div>
          </div>
        </div>

        {variance.checkDiscrepancy && (
          <Banner kind="warning" title="Check discrepancy" testId="recon-check-discrepancy">
            Counted checks do not match expected checks. This is tracked separately from the cash variance.
          </Banner>
        )}

        {approval && (
          <Banner kind="success" title="Variance approved" testId="recon-approval-recorded">
            Approved by {approval.approvedBy} — {approval.approvalReason}
          </Banner>
        )}

        {needsApproval && (
          <div className="mt-4 border border-amber-200 bg-amber-50 rounded-md p-4" data-testid="recon-approval-dialog">
            <div className="font-semibold text-amber-800 mb-2">This variance requires approval before the drawer can be reconciled</div>
            <textarea
              data-testid="recon-approval-reason"
              value={approvalReason}
              onChange={(e) => setApprovalReason(e.target.value)}
              placeholder="Approval reason (required)"
              className="w-full h-16 border border-slate-300 rounded-md p-2 text-[13px]"
            />
            <Btn data-testid="recon-approve-cta" className="mt-2" onClick={approve} disabled={!approvalReason.trim() || busy} loading={busy}>
              Approve Variance
            </Btn>
          </div>
        )}

        {error && <ErrorState testId="supervisor-recon-action-error" message={error} />}

        {isReconciled ? (
          <Banner kind="success" title="Drawer reconciled" testId="recon-reconciled-banner">
            Reconciled at {drawer.reconciledAt ? new Date(drawer.reconciledAt).toLocaleString() : '—'} by {drawer.reconciledBy}. This drawer is permanently read-only.
          </Banner>
        ) : (
          <div className="mt-4">
            <Btn
              data-testid="recon-reconcile-cta"
              onClick={reconcile}
              disabled={!canReconcile || busy}
              loading={busy}
              title={!canReconcile ? 'Approve the pending variance first' : undefined}
            >
              Reconcile Drawer
            </Btn>
          </div>
        )}
      </div>
    </ReportShell>
  );
}
