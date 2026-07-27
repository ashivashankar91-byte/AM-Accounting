import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';

// FINAL-R0 Golden Path steps 3-4: fiscal calendar + accounting period, wired
// to the real coa-service fiscal/period endpoints (S208/S209) through the
// real gateway.
export default function FiscalPeriod() {
  const { legalEntityId } = useAuth();
  const navigate = useNavigate();
  const [calendar, setCalendar] = useState<any>(null);
  const [board, setBoard] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const hasOpenPeriod = board.some((p) => p.status === 'OPEN');

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
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
            <tr><th style={{ textAlign: 'left' }}>Period</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {board.map((p) => (
              <tr key={p.periodId}>
                <td>{p.periodCode}</td>
                <td>{p.status}</td>
                <td>
                  {p.status !== 'OPEN' && (
                    <button data-testid={`open-period-${p.periodCode}`} onClick={() => open(p.periodId)} disabled={busy}>
                      Open
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

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
