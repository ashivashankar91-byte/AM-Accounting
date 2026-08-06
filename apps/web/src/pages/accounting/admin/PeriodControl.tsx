import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { goldenPathApi } from '../../../api/client';
import { PageHeader, Btn, Badge, EmptyState } from '../../../components/ui';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';

// S008 Story Contract (P01-SCR-01, "Period Status Timeline") — Controller-
// facing governance screen. State machine: FUTURE -> OPEN -> SOFT_CLOSED ->
// HARD_CLOSED -> LOCKED. LOCKED is terminal: no unlock path exists at any
// layer, so a LOCKED row renders with no action buttons, ever. Reopen is a
// two-tier model landing on OPEN either way: SOFT_CLOSED->OPEN ("Reopen",
// Controller+Admin) or the elevated HARD_CLOSED->OPEN ("Reopen (elevated)",
// Admin-only, two-step confirm). The interaction logic here mirrors the
// already-certified `pages/goldenpath/FiscalPeriod.tsx` (same API calls, same
// two-step confirm handling, same blocking-drafts worklist) — this screen
// restyles it to Accounting UI Foundation V1 and adds the timeline strip
// P01 catalogues as a new pattern; it does not change any behavior.

type PeriodStatus = 'FUTURE' | 'OPEN' | 'SOFT_CLOSED' | 'HARD_CLOSED' | 'LOCKED';
type CeremonyKind = 'soft-close' | 'hard-close' | 'reopen' | 'reopen-hard-closed' | 'lock';

interface BlockingDraft {
  draftId: string;
  entryDate: string | null;
  amount: string;
  preparer: string;
}

interface PeriodRow {
  periodId: string;
  periodCode: string;
  periodNumber: number;
  fiscalYear: number;
  status: PeriodStatus;
  adjustmentsOnly: boolean;
  openDrafts: number;
  lastTransition: { fromStatus: string | null; toStatus: string; reason: string | null; actor: string; at: string } | null;
}

interface Ceremony {
  periodId: string;
  periodCode: string;
  kind: CeremonyKind;
  reason: string;
  typedConfirm: string;
  // Two-step ceremonies (lock, reopen-hard-closed) land here after the first
  // submit returns requiresConfirmation=true — a second, explicit click is
  // required; never auto-confirmed on the caller's behalf.
  pendingConfirm: boolean;
  message?: string;
  blockingDrafts?: BlockingDraft[];
}

const STATUS_META: Record<PeriodStatus, { label: string; badge: 'success' | 'warning' | 'neutral' | 'danger'; dot: string }> = {
  FUTURE:      { label: 'Future',      badge: 'neutral', dot: 'border-slate-300 bg-white' },
  OPEN:        { label: 'Open',        badge: 'success', dot: 'border-emerald-500 bg-emerald-50' },
  SOFT_CLOSED: { label: 'Soft closed', badge: 'warning', dot: 'border-amber-500 bg-amber-50' },
  HARD_CLOSED: { label: 'Hard closed', badge: 'neutral', dot: 'border-slate-500 bg-slate-200' },
  LOCKED:      { label: 'Locked',      badge: 'danger',  dot: 'border-red-600 bg-red-600' },
};

const CEREMONY_LABEL: Record<CeremonyKind, string> = {
  'soft-close': 'Soft close',
  'hard-close': 'Hard close',
  reopen: 'Reopen',
  'reopen-hard-closed': 'Reopen (elevated)',
  lock: 'Lock (terminal)',
};

// Destructive-ceremony pattern (Foundation V1): irreversible/high-severity
// transitions require typing the period code, not just a click, before the
// submit button enables.
const REQUIRES_TYPED_CONFIRM: Record<CeremonyKind, boolean> = {
  'soft-close': false,
  'hard-close': true,
  reopen: false,
  'reopen-hard-closed': true,
  lock: true,
};

export default function PeriodControl() {
  const { legalEntityId } = useAuth();
  const queryClient = useQueryClient();
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);

  const { data, isLoading, error, refetch } = useQuery<{ board: PeriodRow[] }>({
    queryKey: ['fiscal-period-board', legalEntityId],
    queryFn: () => goldenPathApi.getPeriodBoard(legalEntityId!),
    enabled: Boolean(legalEntityId),
    retry: false,
  });

  const board = useMemo(
    () => (data?.board ?? []).slice().sort((a, b) => a.fiscalYear - b.fiscalYear || a.periodNumber - b.periodNumber),
    [data],
  );

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['fiscal-period-board', legalEntityId] });
  }

  function startCeremony(p: PeriodRow, kind: CeremonyKind) {
    setCeremony({ periodId: p.periodId, periodCode: p.periodCode, kind, reason: '', typedConfirm: '', pendingConfirm: false });
  }
  function cancelCeremony() {
    setCeremony(null);
  }

  // FUTURE->OPEN (S209, pre-existing) — auto-confirms the skip-open warning
  // if one is returned, matching goldenpath/FiscalPeriod.tsx's open() exactly.
  async function openPeriod(periodId: string) {
    const result = await goldenPathApi.openPeriod(periodId, false);
    if (result.requiresConfirmation) {
      await goldenPathApi.openPeriod(periodId, true);
    }
    await refresh();
  }

  async function submitCeremony() {
    if (!ceremony) return;
    if (!ceremony.reason.trim()) {
      setCeremony({ ...ceremony, message: 'A reason is required.' });
      return;
    }
    if (REQUIRES_TYPED_CONFIRM[ceremony.kind] && ceremony.typedConfirm.trim() !== ceremony.periodCode) {
      setCeremony({ ...ceremony, message: `Type "${ceremony.periodCode}" exactly to confirm.` });
      return;
    }
    try {
      const { periodId, kind, reason } = ceremony;
      let result: any;
      if (kind === 'soft-close') result = await goldenPathApi.softClosePeriod(periodId, reason);
      else if (kind === 'hard-close') result = await goldenPathApi.hardClosePeriod(periodId, reason);
      else if (kind === 'reopen') result = await goldenPathApi.reopenPeriod(periodId, reason);
      else if (kind === 'reopen-hard-closed') result = await goldenPathApi.reopenHardClosedPeriod(periodId, reason, false);
      else result = await goldenPathApi.lockPeriod(periodId, reason, false);

      if (result.requiresConfirmation) {
        setCeremony({ ...ceremony, pendingConfirm: true, message: result.message });
      } else {
        setCeremony(null);
        await refresh();
      }
    } catch (err: any) {
      // AC008-4 — hard-close blocked by open drafts: named worklist, no transition.
      if (err.body?.error === 'HARD_CLOSE_BLOCKED_BY_DRAFTS') {
        setCeremony({ ...ceremony, blockingDrafts: err.body.blockingDrafts, message: err.body.message });
      } else {
        setCeremony({ ...ceremony, message: err.message });
      }
    }
  }

  // Second, explicit step for the two-step ceremonies (lock, reopen-hard-closed).
  async function confirmCeremony() {
    if (!ceremony) return;
    try {
      const { periodId, kind, reason } = ceremony;
      if (kind === 'reopen-hard-closed') await goldenPathApi.reopenHardClosedPeriod(periodId, reason, true);
      else await goldenPathApi.lockPeriod(periodId, reason, true);
      setCeremony(null);
      await refresh();
    } catch (err: any) {
      setCeremony({ ...ceremony, message: err.message });
    }
  }

  // Per-status action set. LOCKED gets none — terminal, by design (S008 v1
  // has no unlock operation of any kind).
  function actionsFor(p: PeriodRow) {
    switch (p.status) {
      case 'FUTURE':
        return [
          { label: 'Open', variant: 'secondary' as const, onClick: () => openPeriod(p.periodId), testid: `open-period-${p.periodCode}` },
        ];
      case 'OPEN':
        return [
          { label: 'Soft close…', variant: 'secondary' as const, onClick: () => startCeremony(p, 'soft-close'), testid: `soft-close-${p.periodCode}` },
        ];
      case 'SOFT_CLOSED':
        return [
          { label: 'Hard close…', variant: 'primary' as const, onClick: () => startCeremony(p, 'hard-close'), testid: `hard-close-${p.periodCode}` },
          { label: 'Reopen…', variant: 'secondary' as const, onClick: () => startCeremony(p, 'reopen'), testid: `reopen-${p.periodCode}` },
        ];
      case 'HARD_CLOSED':
        return [
          { label: 'Reopen (elevated)…', variant: 'secondary' as const, onClick: () => startCeremony(p, 'reopen-hard-closed'), testid: `reopen-hard-closed-${p.periodCode}` },
          { label: 'Lock…', variant: 'danger' as const, onClick: () => startCeremony(p, 'lock'), testid: `lock-${p.periodCode}` },
        ];
      default:
        return [];
    }
  }

  if (!legalEntityId) {
    return (
      <div className="p-7">
        <EmptyState title="No legal entity selected" description="Select a legal entity to manage its fiscal periods." />
      </div>
    );
  }

  if (isLoading) return <PageLoader page="Fiscal Period Control" service="coa-service" port={3016} />;
  if (error) return <PageError error={error as Error} serviceName="coa-service" port={3016} retry={() => refetch()} />;

  return (
    <div className="p-7 min-h-full">
      <PageHeader
        title="Fiscal Period Control"
        subtitle="Governed state machine: FUTURE → OPEN → SOFT_CLOSED → HARD_CLOSED → LOCKED — terminal, no unlock. No transition skips a state."
      />

      {/* Timeline strip (P01-SCR-01: new catalogued pattern) */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-5 overflow-x-auto">
        <div className="flex items-center min-w-max" data-testid="period-timeline">
          {board.map((p, i) => {
            const meta = STATUS_META[p.status];
            return (
              <div key={p.periodId} className="flex items-center">
                <div className="flex flex-col items-center gap-1.5 px-3">
                  <div className={`w-4 h-4 rounded-full border-2 ${meta.dot}`} title={meta.label} />
                  <span className="text-[11px] font-semibold text-slate-600 whitespace-nowrap">{meta.label}</span>
                  <span className="text-[11px] font-mono text-slate-400">{p.periodCode}</span>
                </div>
                {i < board.length - 1 && <div className="w-8 h-px bg-slate-300 mb-6" />}
              </div>
            );
          })}
          {board.length === 0 && <span className="text-sm text-slate-400 px-2">No periods yet for this fiscal calendar.</span>}
        </div>
      </div>

      {/* Period table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
        {board.length === 0 ? (
          <EmptyState title="No fiscal periods yet" description="Generate a fiscal year from Fiscal Calendar setup to begin." />
        ) : (
          <table className="w-full border-collapse" data-testid="period-board">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Period</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                <th className="px-4 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-slate-600">Open drafts</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Last transition</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {board.map((p) => {
                const meta = STATUS_META[p.status];
                const actions = actionsFor(p);
                return (
                  <tr key={p.periodId} data-testid={`period-row-${p.periodCode}`} className="h-9 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-0 font-mono text-[13px] font-semibold text-slate-800">{p.periodCode}</td>
                    <td className="px-4 py-0" data-testid={`period-status-${p.periodCode}`}>
                      <Badge variant={meta.badge} dot>{p.status}</Badge>
                    </td>
                    <td className="px-4 py-0 text-center font-mono text-[13px]" data-testid={`period-open-drafts-${p.periodCode}`}>
                      {p.openDrafts > 0 ? <span className="text-amber-700 font-semibold">{p.openDrafts}</span> : <span className="text-slate-400">0</span>}
                    </td>
                    <td className="px-4 py-0 text-[12px] text-slate-500" data-testid={`period-last-transition-${p.periodCode}`}>
                      {p.lastTransition
                        ? `${p.lastTransition.fromStatus ?? '—'} → ${p.lastTransition.toStatus} · ${p.lastTransition.actor}${p.lastTransition.reason ? ` — “${p.lastTransition.reason}”` : ''}`
                        : '—'}
                    </td>
                    <td className="px-4 py-1">
                      <div className="flex flex-wrap gap-1.5">
                        {actions.map((a) => (
                          <Btn key={a.testid} data-testid={a.testid} variant={a.variant} size="sm" onClick={a.onClick}>
                            {a.label}
                          </Btn>
                        ))}
                        {p.status === 'LOCKED' && (
                          <span data-testid={`period-terminal-${p.periodCode}`} className="text-[12px] text-slate-400 italic flex items-center gap-1">
                            <Lock size={12} /> Terminal — no further action
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Ceremony panel */}
      {ceremony && (
        <div
          data-testid="period-ceremony-panel"
          className={`bg-white border-l-4 ${ceremony.kind === 'lock' ? 'border-l-danger' : 'border-l-amber-500'} border-y border-r border-slate-200 rounded-xl shadow-sm p-5 max-w-lg`}
        >
          <h3 className="text-sm font-bold text-slate-900 mb-1">
            {CEREMONY_LABEL[ceremony.kind]} — {ceremony.periodCode}
          </h3>

          {(ceremony.kind === 'lock' || ceremony.kind === 'reopen-hard-closed') && (
            <p className="text-xs text-amber-700 font-medium mb-3 mt-2 flex items-start gap-1.5">
              <ShieldAlert size={14} className="shrink-0 mt-0.5" />
              {ceremony.kind === 'lock'
                ? 'Locking is PERMANENT and IRREVERSIBLE — no unlock path exists in S008 v1.'
                : 'Reopening a HARD_CLOSED period is a high-severity, Admin-only action.'}
            </p>
          )}

          <label className="block text-xs font-semibold text-slate-600 mb-1 mt-2">Reason</label>
          <textarea
            data-testid="period-ceremony-reason"
            value={ceremony.reason}
            onChange={(e) => setCeremony({ ...ceremony, reason: e.target.value })}
            disabled={ceremony.pendingConfirm}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent disabled:bg-slate-50"
            placeholder="Required — e.g. ops cutoff, late vendor invoice #A-118"
          />

          {REQUIRES_TYPED_CONFIRM[ceremony.kind] && !ceremony.pendingConfirm && (
            <>
              <label className="block text-xs font-semibold text-slate-600 mb-1 mt-3">
                Type the period to confirm: <span className="font-mono text-slate-800">{ceremony.periodCode}</span>
              </label>
              <input
                data-testid="period-ceremony-typed-confirm"
                value={ceremony.typedConfirm}
                onChange={(e) => setCeremony({ ...ceremony, typedConfirm: e.target.value })}
                placeholder={ceremony.periodCode}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
              />
            </>
          )}

          {ceremony.message && (
            <p data-testid="period-ceremony-message" className="text-xs text-danger font-medium mt-3">
              {ceremony.message}
            </p>
          )}

          {ceremony.blockingDrafts && ceremony.blockingDrafts.length > 0 && (
            <div data-testid="period-blocking-drafts" className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-bold text-red-700 mb-1.5">Blocking drafts — post or void first:</p>
              <ul className="space-y-1">
                {ceremony.blockingDrafts.map((d) => (
                  <li key={d.draftId} data-testid={`period-blocking-draft-${d.draftId}`} className="text-xs font-mono text-red-800">
                    {d.entryDate} · {d.amount} · {d.preparer}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2 mt-4">
            <Btn variant="ghost" size="sm" data-testid="period-ceremony-cancel" onClick={cancelCeremony}>
              Cancel
            </Btn>
            {!ceremony.pendingConfirm ? (
              <Btn
                variant={ceremony.kind === 'lock' ? 'danger' : 'primary'}
                size="sm"
                data-testid="period-ceremony-submit"
                onClick={submitCeremony}
                disabled={REQUIRES_TYPED_CONFIRM[ceremony.kind] && ceremony.typedConfirm.trim() !== ceremony.periodCode}
              >
                {CEREMONY_LABEL[ceremony.kind]}
              </Btn>
            ) : (
              <Btn variant="danger" size="sm" data-testid="period-ceremony-confirm" onClick={confirmCeremony}>
                Confirm — {CEREMONY_LABEL[ceremony.kind]}
              </Btn>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
