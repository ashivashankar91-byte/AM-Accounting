import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';

// FINAL-R0 Golden Path step 11 (final): review audit history for a journal
// entry, wired to the real audit-service (S007) through the real gateway.
export default function AuditHistory() {
  const { entityType, entityId } = useParams<{ entityType: string; entityId: string }>();
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  // GOLDEN-R0 Phase 4 UX fix (verified functional gap, not cosmetic): while
  // the outbox-drain poll below is still in flight, this page previously
  // showed "No audit events found" -- a genuinely misleading false-empty
  // state, not just a missing spinner, since a user landing here right
  // after posting/reversing a journal would see "no events" for up to
  // several seconds before the real rows arrive.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!entityType || !entityId) return;
    let cancelled = false;
    let attempts = 0;
    setLoading(true);
    // The audit trail is populated asynchronously from an outbox drainer
    // (S007), so a query issued immediately after an action (e.g. a reverse
    // just performed on the previous page) can race the drain. Poll briefly
    // rather than showing a false "no events" empty state.
    async function poll() {
      try {
        const result = await goldenPathApi.getAuditHistory(entityType!, entityId!);
        if (cancelled) return;
        if (result.length > 0 || attempts >= 5) {
          setEvents(result);
          setLoading(false);
          return;
        }
        attempts += 1;
        setTimeout(poll, 1000);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }
    poll();
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Audit History</h1>
      <p style={{ color: '#555' }}>{entityType} / {entityId}</p>
      {error && <p data-testid="audit-error" style={{ color: '#b91c1c' }}>{error}</p>}
      {loading && !error && <p data-testid="audit-loading">Loading audit history…</p>}

      <ul data-testid="audit-event-list" style={{ listStyle: 'none', padding: 0 }}>
        {events.map((ev) => (
          <li key={ev.id} data-testid="audit-event" style={{ borderBottom: '1px solid #eee', padding: '8px 0' }}>
            <strong>{ev.action}</strong> — {ev.eventType} — actor {ev.actorId} — {ev.occurredAt ?? ev.createdAt}
          </li>
        ))}
      </ul>
      {!loading && events.length === 0 && !error && <p data-testid="audit-empty">No audit events found.</p>}

      <Link to="/golden-path/select-entity">Back to Golden Path start</Link>
    </div>
  );
}
