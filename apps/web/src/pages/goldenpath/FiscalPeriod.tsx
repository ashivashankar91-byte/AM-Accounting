import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';

type CeremonyKind = 'soft-close' | 'hard-close' | 'reopen' | 'reopen-hard-closed' | 'lock';

interface BlockingDraft {
  draftId: string;
  entryDate: string | null;
  amount: string;
  preparer: string;
}

interface Ceremony {
  periodId: string;
  periodCode: string;
  kind: CeremonyKind;
  reason: string;
  // Two-step ceremonies (lock, reopen-hard-closed) land here after the first
  // submit returns requiresConfirmation=true — a second, explicit user click
  // is required; this is never auto-confirmed on the caller's behalf.
  pendingConfirm: boolean;
  message?: string;
  blockingDrafts?: BlockingDraft[];
}

const CEREMONY_LABEL: Record<CeremonyKind, string> = {
  'soft-close': 'Soft close',
  'hard-close': 'Hard close',
  reopen: 'Reopen',
  'reopen-hard-closed': 'Reopen (elevated)',
  lock: 'Lock (terminal)',
};

// S008 Story Contract — extends S209 (FUTURE->OPEN only) with the full
// OPEN/SOFT_CLOSED/HARD_CLOSED/LOCKED lifecycle. LOCKED is terminal: no
// unlock path exists in S008 v1, so a LOCKED period below renders with no
// action buttons at all, ever.
export default function FiscalPeriod() {
  const { legalEntityId } = useAuth();
  const navigate = useNavigate();
  const [calendar, setCalendar] = useState<any>(null);
  const [board, setBoard] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ceremony, setCeremony] = useState<Ceremony | null>(null);

  async function refresh() {
    if (!legalEntityId) return;
    setError(null);
    try {
      const cal = await goldenPathApi.getFiscalCalendar(legalEntityId).catch(() => null);
      setCalendar(cal);
      const { board } = await goldenPathApi.getPeriodBoard(legalEntityId);
      setBoard(board);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => { refresh(); }, [legalEntityId]);

  if (!legalEntityId) {
    return (
      <div style={{ margin: 40 }}>
        <p>No legal entity selected.</p>
        <Link to="/golden-path/select-entity">Select a legal entity</Link>
      </div>
    );
  }

  async function defineAndGenerate() {
    setBusy(true);
    setError(null);
    try {
      if (!calendar) {
        await goldenPathApi.defineFiscalCalendar(legalEntityId!, 1);
      }
      const fy = new Date().getFullYear();
      await goldenPathApi.generateFiscalYear(legalEntityId!, fy).catch(() => undefined);
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function open(periodId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await goldenPathApi.openPeriod(periodId, false);
      if (result.requiresConfirmation) {
        await goldenPathApi.openPeriod(periodId, true);
      }
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startCeremony(periodId: string, periodCode: string, kind: CeremonyKind) {
    setError(null);
    setCeremony({ periodId, periodCode, kind, reason: '', pendingConfirm: false });
  }

  function cancelCeremony() {
    setCeremony(null);
  }

  // Submits the ceremony's mandatory reason. For soft-close/hard-close/reopen
  // this is a single-step call. For reopen-hard-closed/lock it is step one of
  // two: the API returns requiresConfirmation without transitioning, and this
  // function surfaces that as a distinct "Confirm" affordance the caller must
  // click a second time (confirmCeremony below) — never auto-submitted.
  async function submitCeremony() {
    if (!ceremony) return;
    if (!ceremony.reason.trim()) {
      setCeremony({ ...ceremony, message: 'A reason is required.' });
      return;
    }
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  // Second, explicit step for the two-step ceremonies (lock, reopen-hard-closed).
  async function confirmCeremony() {
    if (!ceremony) return;
    setBusy(true);
    try {
      const { periodId, kind, reason } = ceremony;
      if (kind === 'reopen-hard-closed') await goldenPathApi.reopenHardClosedPeriod(periodId, reason, true);
      else await goldenPathApi.lockPeriod(periodId, reason, true);
      setCeremony(null);
      await refresh();
    } catch (err: any) {
      setCeremony({ ...ceremony, message: err.message });
    } finally {
      setBusy(false);
    }
  }

  const hasOpenPeriod = board.some((p) => p.status === 'OPEN');

  // Per-status action set. LOCKED gets none — terminal, by design (S008 v1
  // has no unlock operation of any kind).
  function actionsFor(p: any) {
    switch (p.status) {
      case 'FUTURE':
        return [{ label: 'Open', onClick: () => open(p.periodId), testid: `open-period-${p.periodCode}` }];
      case 'OPEN':
        return [
          { label: 'Soft close…', onClick: () => startCeremony(p.periodId, p.periodCode, 'soft-close'), testid: `soft-close-${p.periodCode}` },
        ];
      case 'SOFT_CLOSED':
        return [
          { label: 'Hard close…', onClick: () => startCeremony(p.periodId, p.periodCode, 'hard-close'), testid: `hard-close-${p.periodCode}` },
          { label: 'Reopen…', onClick: () => startCeremony(p.periodId, p.periodCode, 'reopen'), testid: `reopen-${p.periodCode}` },
        ];
      case 'HARD_CLOSED':
        return [
          { label: 'Reopen (elevated)…', onClick: () => startCeremony(p.periodId, p.periodCode, 'reopen-hard-closed'), testid: `reopen-hard-closed-${p.periodCode}` },
          { label: 'Lock…', onClick: () => startCeremony(p.periodId, p.periodCode, 'lock'), testid: `lock-${p.periodCode}` },
        ];
      default:
        return [];
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Fiscal Calendar &amp; Accounting Period</h1>
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

      <section style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 16 }}>Fiscal Calendar</h2>
        {calendar ? (
          <p data-testid="fiscal-calendar-status">
            Defined — FY start month {calendar.fyStartMonth}, structure {calendar.structure}, status {calendar.status}
          </p>
        ) : (
          <p data-testid="fiscal-calendar-status">Not yet defined for this entity.</p>
        )}
        <button data-testid="fiscal-define-generate" onClick={defineAndGenerate} disabled={busy}>
          {calendar ? 'Generate current fiscal year' : 'Define calendar & generate year'}
        </button>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16 }}>Accounting Periods</h2>
        <table data-testid="period-board" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Period</th>
              <th>Status</th>
              <th>Open drafts</th>
              <th style={{ textAlign: 'left' }}>Last transition</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {board.map((p) => (
              <tr key={p.periodId} data-testid={`period-row-${p.periodCode}`}>
                <td>{p.periodCode}</td>
                <td data-testid={`period-status-${p.periodCode}`}>{p.status}</td>
                <td style={{ textAlign: 'center' }} data-testid={`period-open-drafts-${p.periodCode}`}>
                  {p.openDrafts ?? 0}
                </td>
                <td data-testid={`period-last-transition-${p.periodCode}`}>
                  {p.lastTransition
                    ? `${p.lastTransition.fromStatus ?? '—'} → ${p.lastTransition.toStatus} by ${p.lastTransition.actor}${p.lastTransition.reason ? ` (“${p.lastTransition.reason}”)` : ''}`
                    : '—'}
                </td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {actionsFor(p).map((a) => (
                    <button key={a.testid} data-testid={a.testid} onClick={a.onClick} disabled={busy}>
                      {a.label}
                    </button>
                  ))}
                  {p.status === 'LOCKED' && <span data-testid={`period-terminal-${p.periodCode}`} style={{ color: '#6b7280' }}>Terminal — no further action</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {ceremony && (
        <section
          data-testid="period-ceremony-panel"
          style={{ marginTop: 16, border: '1px solid #ddd', padding: 12, maxWidth: 480 }}
        >
          <h3 style={{ fontSize: 15, marginTop: 0 }}>
            {CEREMONY_LABEL[ceremony.kind]} — {ceremony.periodCode}
          </h3>

          {(ceremony.kind === 'lock' || ceremony.kind === 'reopen-hard-closed') && (
            <p style={{ color: '#92400e', fontSize: 13 }}>
              {ceremony.kind === 'lock'
                ? 'Locking is PERMANENT and IRREVERSIBLE — no unlock path exists in S008 v1.'
                : 'Reopening a HARD_CLOSED period is a high-severity action.'}
            </p>
          )}

          <label style={{ display: 'block', marginTop: 8 }}>
            Reason
            <input
              data-testid="period-ceremony-reason"
              value={ceremony.reason}
              onChange={(e) => setCeremony({ ...ceremony, reason: e.target.value })}
              disabled={ceremony.pendingConfirm}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
          </label>

          {ceremony.message && (
            <p data-testid="period-ceremony-message" style={{ color: '#b91c1c', fontSize: 13 }}>
              {ceremony.message}
            </p>
          )}

          {ceremony.blockingDrafts && ceremony.blockingDrafts.length > 0 && (
            <div data-testid="period-blocking-drafts" style={{ marginTop: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 600 }}>Blocking drafts (must be posted or voided first):</p>
              <ul>
                {ceremony.blockingDrafts.map((d) => (
                  <li key={d.draftId} data-testid={`period-blocking-draft-${d.draftId}`} style={{ fontSize: 13 }}>
                    {d.entryDate} — {d.amount} — {d.preparer}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button data-testid="period-ceremony-cancel" onClick={cancelCeremony} disabled={busy}>
              Cancel
            </button>
            {!ceremony.pendingConfirm ? (
              <button data-testid="period-ceremony-submit" onClick={submitCeremony} disabled={busy}>
                {CEREMONY_LABEL[ceremony.kind]}
              </button>
            ) : (
              <button data-testid="period-ceremony-confirm" onClick={confirmCeremony} disabled={busy}>
                Confirm — {CEREMONY_LABEL[ceremony.kind]}
              </button>
            )}
          </div>
        </section>
      )}

      <button
        data-testid="fiscal-continue"
        style={{ marginTop: 24 }}
        disabled={!hasOpenPeriod}
        onClick={() => navigate('/golden-path/coa')}
      >
        Continue to Chart of Accounts
      </button>
      {!hasOpenPeriod && <p style={{ color: '#92400e' }}>At least one OPEN period is required to continue.</p>}
    </div>
  );
}
