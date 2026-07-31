import { useState } from 'react';
import { Link } from 'react-router-dom';
import { postingEngineApi } from '../../api/client';

// ACC-S020 — Posting Executions screen. Inquiry-only: find a certification
// event's execution by event ID / source entity ID / correlation ID / status,
// and see its outcome (posted, duplicate no-op, no-rule-match, identity
// conflict, rejected/failed) with full traceability back to the rule pack
// version and rule that produced it.

interface ExecutionRow {
  id: string;
  eventId: string;
  eventType: string;
  eventSchemaVersion: string;
  sourceEntityId: string;
  correlationId: string;
  status: string;
  rulePackVersionId: string | null;
  ruleId: string | null;
  blueprintHash: string | null;
  journalEntryId: string | null;
  journalNumber: string | null;
  failureReason: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = ['', 'POSTED', 'NO_RULE_MATCH', 'REJECTED', 'FAILED'];

export default function PostingExecutions() {
  const [eventId, setEventId] = useState('');
  const [sourceEntityId, setSourceEntityId] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [status, setStatus] = useState('');

  const [results, setResults] = useState<ExecutionRow[] | null>(null);
  const [selected, setSelected] = useState<ExecutionRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Test-only: submit a certification event through the supported internal
  // application boundary (POST /posting-engine/events). Not a production
  // feature — this is how the certification browser journey (and manual
  // testing) drives the posting engine end to end from the UI.
  const [submitEnvelopeJson, setSubmitEnvelopeJson] = useState('');
  const [submitResult, setSubmitResult] = useState<{ executionId: string; eventId: string; status: string; idempotent: boolean; journalNumber?: string | null } | null>(null);
  const [submitConflict, setSubmitConflict] = useState<{ executionId: string; eventId: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);

  async function handleSubmitEvent() {
    setSubmitError(null);
    setSubmitResult(null);
    setSubmitConflict(null);
    setSubmitBusy(true);
    try {
      const envelope = JSON.parse(submitEnvelopeJson);
      const result = await postingEngineApi.submitEvent(envelope);
      setSubmitResult(result);
    } catch (err: any) {
      if (err.status === 401) setUnauthorized(true);
      else if (err.status === 403) setForbidden(true);
      else if (err.status === 409 && err.body?.error === 'EVENT_IDENTITY_CONFLICT') {
        setSubmitConflict({ executionId: err.body.executionId, eventId: err.body.eventId });
      } else {
        setSubmitError(err.message);
      }
    } finally {
      setSubmitBusy(false);
    }
  }

  async function runSearch() {
    setLoading(true);
    setError(null);
    setUnauthorized(false);
    setForbidden(false);
    setNotFound(false);
    setSelected(null);
    setSearched(true);
    try {
      if (eventId.trim()) {
        const exec = await postingEngineApi.getExecutionByEventId(eventId.trim());
        setResults([exec]);
      } else {
        const res = await postingEngineApi.searchExecutions({
          correlationId: correlationId.trim() || undefined,
          sourceEntityId: sourceEntityId.trim() || undefined,
          status: status || undefined,
        });
        setResults(res.items);
      }
    } catch (err: any) {
      if (err.status === 401) setUnauthorized(true);
      else if (err.status === 403) setForbidden(true);
      else if (err.status === 404) { setNotFound(true); setResults([]); }
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function statusBadge(s: string) {
    const colors: Record<string, string> = {
      POSTED: '#166534', NO_RULE_MATCH: '#92400e', REJECTED: '#b91c1c', FAILED: '#b91c1c',
    };
    return (
      <span data-testid={`posting-executions-status-badge-${s}`} style={{ color: colors[s] ?? '#334155', fontWeight: 600 }}>
        {s}
      </span>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Posting Executions</h1>
      <p style={{ color: '#555' }}>
        Look up a certification event's posting execution by event ID, source entity ID, correlation ID, or status.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <label>
          Event ID
          <input data-testid="posting-executions-search-event-id" value={eventId} onChange={(e) => setEventId(e.target.value)} style={{ display: 'block' }} />
        </label>
        <label>
          Source entity ID
          <input data-testid="posting-executions-search-source-entity-id" value={sourceEntityId} onChange={(e) => setSourceEntityId(e.target.value)} style={{ display: 'block' }} />
        </label>
        <label>
          Correlation ID
          <input data-testid="posting-executions-search-correlation-id" value={correlationId} onChange={(e) => setCorrelationId(e.target.value)} style={{ display: 'block' }} />
        </label>
        <label>
          Status
          <select data-testid="posting-executions-search-status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ display: 'block' }}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || 'Any'}</option>)}
          </select>
        </label>
        <button data-testid="posting-executions-search-button" onClick={runSearch} disabled={loading} style={{ alignSelf: 'flex-end' }}>
          Search
        </button>
      </div>

      {loading && <p data-testid="posting-executions-loading">Searching…</p>}
      {unauthorized && <p data-testid="posting-executions-unauthorized" style={{ color: '#b91c1c' }}>You must sign in to view posting executions.</p>}
      {forbidden && !unauthorized && <p data-testid="posting-executions-forbidden" style={{ color: '#b91c1c' }}>You do not have permission to view posting executions.</p>}
      {error && !unauthorized && !forbidden && <p data-testid="posting-executions-error" style={{ color: '#b91c1c' }}>{error}</p>}
      {notFound && !error && <p data-testid="posting-executions-not-found">No execution found for that event ID.</p>}

      {!loading && searched && !error && !unauthorized && !forbidden && !notFound && results && results.length === 0 && (
        <p data-testid="posting-executions-empty">No executions match this search.</p>
      )}

      {!loading && results && results.length > 0 && (
        <table data-testid="posting-executions-results" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th>Event ID</th><th>Status</th><th>Source entity</th><th>Journal #</th><th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.id} data-testid={`posting-executions-row-${r.eventId}`} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{r.eventId}</td>
                <td>{statusBadge(r.status)}</td>
                <td>{r.sourceEntityId}</td>
                <td>{r.journalNumber ?? '—'}</td>
                <td><button data-testid={`posting-executions-view-${r.eventId}`} onClick={() => setSelected(r)}>View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && (
        <div data-testid="posting-executions-detail" style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>
            Execution for event <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{selected.eventId}</span>
          </h2>
          <p>Status: {statusBadge(selected.status)}</p>
          <dl style={{ fontSize: 13 }}>
            <dt style={{ fontWeight: 600 }}>Event type / schema version</dt>
            <dd>{selected.eventType} / {selected.eventSchemaVersion}</dd>
            <dt style={{ fontWeight: 600 }}>Rule pack version</dt>
            <dd data-testid="posting-executions-detail-rule-pack-version">{selected.rulePackVersionId ?? '—'}</dd>
            <dt style={{ fontWeight: 600 }}>Selected rule ID</dt>
            <dd data-testid="posting-executions-detail-rule-id">{selected.ruleId ?? '—'}</dd>
            <dt style={{ fontWeight: 600 }}>Blueprint hash</dt>
            <dd style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{selected.blueprintHash ?? '—'}</dd>
          </dl>

          {selected.status === 'POSTED' && (
            <div data-testid="posting-executions-posted-state" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: 12 }}>
              <p>Journal <strong>{selected.journalNumber}</strong> was posted.</p>
              <Link data-testid="posting-executions-journal-link" to="/golden-path/journal">Open in Journal Inquiry →</Link>
            </div>
          )}
          {selected.status === 'NO_RULE_MATCH' && (
            <div data-testid="posting-executions-no-rule-match-state" style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: 12 }}>
              <p>No active rule pack version matched this event. Recorded as a durable posting exception.</p>
            </div>
          )}
          {selected.status === 'REJECTED' && (
            <div data-testid="posting-executions-rejected-state" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 12 }}>
              <p>Posting rejected: {selected.failureReason}</p>
            </div>
          )}
          {selected.status === 'FAILED' && (
            <div data-testid="posting-executions-failed-state" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 12 }}>
              <p>Posting failed: {selected.failureReason}</p>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 32, borderTop: '1px solid #eee', paddingTop: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Submit certification event (test)</h2>
        <p style={{ fontSize: 12, color: '#777' }}>
          Test-only. Submits a canonical source-event envelope through the internal application boundary.
        </p>
        <textarea
          data-testid="posting-executions-submit-envelope-json"
          value={submitEnvelopeJson}
          onChange={(e) => setSubmitEnvelopeJson(e.target.value)}
          rows={10}
          style={{ display: 'block', width: '100%', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
        />
        <button data-testid="posting-executions-submit-event-button" disabled={submitBusy || !submitEnvelopeJson} onClick={handleSubmitEvent} style={{ marginTop: 8 }}>
          Submit event
        </button>

        {submitError && <p data-testid="posting-executions-submit-error" style={{ color: '#b91c1c' }}>{submitError}</p>}

        {submitConflict && (
          <div data-testid="posting-executions-identity-conflict-state" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 12, marginTop: 8 }}>
            <p>
              Identity conflict: event <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{submitConflict.eventId}</span> was
              already received with different content. Original execution: <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{submitConflict.executionId}</span>.
            </p>
          </div>
        )}

        {submitResult && (
          <div
            data-testid={submitResult.idempotent ? 'posting-executions-duplicate-noop-state' : 'posting-executions-submit-result'}
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 12, marginTop: 8 }}
          >
            <p>
              Execution <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{submitResult.executionId}</span> — status: {statusBadge(submitResult.status)}
              {submitResult.idempotent && <strong> (duplicate no-op — no new journal was created)</strong>}
            </p>
            {submitResult.journalNumber && <p>Journal: {submitResult.journalNumber}</p>}
          </div>
        )}
      </div>

      <p style={{ marginTop: 24 }}>
        <Link to="/accounting/gl/posting-rules">Go to Posting Rules</Link>
      </p>
    </div>
  );
}
