import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { postingEngineApi, postingRecoveryApi } from '../../api/client';
import { EmptyState, ErrorState, LoadingState, UnauthorizedState, SectionLabel, FilterBar, FilterField, FILTER_CONTROL_CLASS, Banner, MoneyTd } from '../../components/report';
import { Badge, Btn } from '../../components/ui';

// ACC-S020 — Posting Executions screen. Inquiry-only: find a certification
// event's execution by event ID / source entity ID / correlation ID / status,
// and see its outcome (posted, duplicate no-op, no-rule-match, identity
// conflict, rejected/failed) with full traceability back to the rule pack
// version and rule that produced it, the authoritative gl-service journal,
// any linked S021 recovery case, and the replay evidence trail.

interface ExecutionRow {
  id: string;
  eventId: string;
  eventType: string;
  eventSchemaVersion: string;
  // CE-07 legal-entity isolation defect — denormalized on the execution
  // itself (see PostingExecution.entityId, schema.prisma) so inquiry can
  // display the authoritative legal entity this execution belongs to
  // without inferring it from the rule-pack version (which can be null on
  // a NO_RULE_MATCH/REJECTED outcome).
  entityId: string | null;
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

interface ReplayRow {
  id: string;
  originalRulePackVersionId: string | null;
  replayRulePackVersionId: string | null;
  replayActor: string;
  replayReason: string;
  resultingStatus: string;
  resultingJournalEntryId: string | null;
  resultingJournalNumber: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = ['', 'POSTED', 'NO_RULE_MATCH', 'REJECTED', 'FAILED'];
const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  POSTED: 'success', NO_RULE_MATCH: 'warning', REJECTED: 'danger', FAILED: 'danger',
};
const REPLAY_ELIGIBLE = new Set(['NO_RULE_MATCH', 'REJECTED', 'FAILED']);

function StatusBadge({ s }: { s: string }) {
  return <Badge variant={STATUS_VARIANT[s] ?? 'neutral'} data-testid={`posting-executions-status-badge-${s}`}>{s}</Badge>;
}

export default function PostingExecutions() {
  const { isAuthenticated, legalEntityId, legalEntityLabel } = useAuth();

  const [eventId, setEventId] = useState('');
  const [sourceEntityId, setSourceEntityId] = useState('');
  const [correlationId, setCorrelationId] = useState('');
  const [status, setStatus] = useState('');

  const [results, setResults] = useState<ExecutionRow[] | null>(null);
  const [selected, setSelected] = useState<ExecutionRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Full lineage for the selected execution: replay evidence + linked S021 case.
  const [replays, setReplays] = useState<ReplayRow[]>([]);
  const [recoveryCase, setRecoveryCase] = useState<{ id: string; status: string } | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);

  const [replaying, setReplaying] = useState(false);
  const [replayReason, setReplayReason] = useState('');
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayNotice, setReplayNotice] = useState<string | null>(null);

  // ── Simulation: proposed balanced-journal preview, never posts ────────────
  const [simEnvelopeJson, setSimEnvelopeJson] = useState('');
  const [simBusy, setSimBusy] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<{
    wouldPost: boolean; status: string; rulePackVersionId?: string | null; ruleId?: string | null;
    proposedJournal?: { entityId: string; date: string; sourceCode: string; lines: Array<{ accountNumber: string; storeId: string; deptCode?: string | null; dr: number; cr: number; memo?: string | null }> } | null;
    failureReason?: string | null;
  } | null>(null);

  // Test-only: submit a certification event through the supported internal
  // application boundary (POST /posting-engine/events). Not a production
  // feature — this is how the certification browser journey (and manual
  // testing) drives the posting engine end to end from the UI.
  const [submitEnvelopeJson, setSubmitEnvelopeJson] = useState('');
  const [submitResult, setSubmitResult] = useState<{ executionId: string; eventId: string; status: string; idempotent: boolean; journalNumber?: string | null } | null>(null);
  const [submitConflict, setSubmitConflict] = useState<{ executionId: string; eventId: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);

  async function handleSimulate() {
    setSimError(null);
    setSimResult(null);
    setSimBusy(true);
    try {
      const envelope = JSON.parse(simEnvelopeJson);
      const result = await postingEngineApi.simulateEvent(envelope);
      setSimResult(result);
    } catch (err: any) {
      setSimError(err.body?.message ?? err.message ?? 'Invalid envelope JSON.');
    } finally {
      setSimBusy(false);
    }
  }

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
      if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
      else if (err.status === 409 && err.body?.error === 'EVENT_IDENTITY_CONFLICT') {
        setSubmitConflict({ executionId: err.body.executionId, eventId: err.body.eventId });
      } else {
        setSubmitError(err.message);
      }
    } finally {
      setSubmitBusy(false);
    }
  }

  async function loadLineage(exec: ExecutionRow, opts: { resetBanners?: boolean } = {}) {
    setLineageLoading(true);
    setReplays([]);
    setRecoveryCase(null);
    // A replay refreshes lineage right after setting its own success/error
    // banner — resetting banners here too would wipe that message out before
    // the user ever sees it. Only reset when selecting a NEW execution.
    if (opts.resetBanners) {
      setReplayNotice(null);
      setReplayError(null);
    }
    try {
      const [replayRes, recoveryRes] = await Promise.all([
        postingEngineApi.listReplaysForExecution(exec.id).catch(() => ({ items: [] })),
        // S021 linkage: a recovery case's `search` filter matches on its own
        // correlationId — the exact field every posting execution carries,
        // so this is real, persisted cross-service linkage, not a guess.
        postingRecoveryApi.listQueue(`search=${encodeURIComponent(exec.correlationId)}`).catch(() => ({ items: [] })),
      ]);
      setReplays(replayRes.items as ReplayRow[]);
      const match = (recoveryRes.items as any[])[0];
      setRecoveryCase(match ? { id: match.id, status: match.status } : null);
    } finally {
      setLineageLoading(false);
    }
  }

  async function runSearch() {
    if (!legalEntityId) return;
    setLoading(true);
    setError(null);
    setUnauthorized(null);
    setNotFound(false);
    setSelected(null);
    setSearched(true);
    try {
      if (eventId.trim()) {
        // CE-07 legal-entity isolation defect — the server denies (403) a
        // lookup for an execution belonging to a DIFFERENT entity than this
        // session's authz scope (see posting-engine-routes.ts's async scope
        // resolution for this route); no entityId query param is needed
        // here since the resource itself is the authority.
        const exec = await postingEngineApi.getExecutionByEventId(eventId.trim());
        setResults([exec]);
      } else {
        const res = await postingEngineApi.searchExecutions(legalEntityId, {
          correlationId: correlationId.trim() || undefined,
          sourceEntityId: sourceEntityId.trim() || undefined,
          status: status || undefined,
        });
        setResults(res.items as ExecutionRow[]);
      }
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
      else if (err.status === 404) { setNotFound(true); setResults([]); }
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function selectExecution(r: ExecutionRow) {
    setSelected(r);
    loadLineage(r, { resetBanners: true });
  }

  async function handleReplay() {
    if (!selected || !replayReason.trim()) return;
    setReplaying(true);
    setReplayError(null);
    setReplayNotice(null);
    try {
      const result = await postingEngineApi.replayExecution(selected.id, replayReason.trim());
      setSelected({ ...selected, status: result.status, rulePackVersionId: result.rulePackVersionId ?? selected.rulePackVersionId, ruleId: result.ruleId ?? selected.ruleId, journalEntryId: result.journalEntryId ?? selected.journalEntryId, journalNumber: result.journalNumber ?? selected.journalNumber, failureReason: result.failureReason ?? null });
      setReplayNotice(`Replay ${result.status === 'POSTED' ? 'posted' : 'completed'} — status ${result.status}.`);
      setReplayReason('');
      await loadLineage({ ...selected, status: result.status });
    } catch (err: any) {
      setReplayError(err.body?.message ?? err.message);
    } finally {
      setReplaying(false);
    }
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        <p className="text-slate-600">Sign in to view Posting Executions.</p>
        <Link to="/login" className="text-[#0B5CAB] hover:underline">Sign in</Link>
      </div>
    );
  }

  // CE-07 legal-entity isolation defect — execution inquiry (list/search)
  // is entityId-scoped server-side (never a browser-computed "show
  // everything" fallback); a specific legal entity must be selected first.
  if (!legalEntityId) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-6" data-testid="posting-executions-no-entity">
        <p className="text-slate-600">No legal entity selected. Posting executions are scoped per legal entity.</p>
        <Link to="/golden-path/select-entity" className="text-[#0B5CAB] hover:underline">Select a legal entity</Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-6" data-testid="posting-executions">
      <h1 className="text-xl font-semibold text-slate-900">Posting Executions</h1>
      <p className="text-[13px] text-slate-500 mt-1 max-w-[720px]">
        Look up a certification event's posting execution by event ID, source entity ID, correlation ID,
        or status — with full lineage back to the exact rule-pack version, the authoritative gl-service
        journal, any linked S021 recovery case, and the replay evidence trail.
      </p>
      <p className="text-[12px] text-slate-500 mt-1" data-testid="posting-executions-entity-context">
        Legal entity: <span className="font-medium text-slate-700">{legalEntityLabel ?? legalEntityId}</span>
      </p>

      {unauthorized ? (
        <UnauthorizedState testId="posting-executions-unauthorized" message={unauthorized} />
      ) : (
        <>
          <FilterBar>
            <FilterField label="Event ID" width={220}>
              <input data-testid="posting-executions-search-event-id" className={FILTER_CONTROL_CLASS} value={eventId} onChange={(e) => setEventId(e.target.value)} />
            </FilterField>
            <FilterField label="Source entity ID" width={200}>
              <input data-testid="posting-executions-search-source-entity-id" className={FILTER_CONTROL_CLASS} value={sourceEntityId} onChange={(e) => setSourceEntityId(e.target.value)} />
            </FilterField>
            <FilterField label="Correlation ID" width={220}>
              <input data-testid="posting-executions-search-correlation-id" className={FILTER_CONTROL_CLASS} value={correlationId} onChange={(e) => setCorrelationId(e.target.value)} />
            </FilterField>
            <FilterField label="Status" width={160}>
              <select data-testid="posting-executions-search-status" className={FILTER_CONTROL_CLASS} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || 'Any'}</option>)}
              </select>
            </FilterField>
            <Btn size="sm" variant="primary" data-testid="posting-executions-search-button" disabled={loading} onClick={runSearch}>
              Search
            </Btn>
          </FilterBar>

          {loading && <LoadingState label="Searching…" testId="posting-executions-loading" rows={5} cols={4} />}
          {!loading && error && <ErrorState message={error} testId="posting-executions-error" onRetry={runSearch} />}
          {!loading && notFound && !error && (
            <EmptyState title="No execution found" message="No execution found for that event ID." testId="posting-executions-not-found" />
          )}
          {!loading && searched && !error && !notFound && results && results.length === 0 && (
            <EmptyState title="No executions match" message="No executions match this search." testId="posting-executions-empty" />
          )}

          {!loading && results && results.length > 0 && (
            <div className="mt-4 overflow-x-auto border border-slate-200 rounded-md" data-testid="posting-executions-results">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-3 h-9">Event ID</th><th className="px-3 h-9">Status</th><th className="px-3 h-9">Legal entity</th><th className="px-3 h-9">Source entity</th><th className="px-3 h-9">Journal #</th><th className="px-3 h-9"></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id} className="h-9 border-t border-slate-100 hover:bg-slate-50" data-testid={`posting-executions-row-${r.eventId}`}>
                      <td className="px-3 font-mono text-[12px]">{r.eventId}</td>
                      <td className="px-3"><StatusBadge s={r.status} /></td>
                      <td className="px-3 font-mono text-[12px]">{r.entityId ?? '—'}</td>
                      <td className="px-3">{r.sourceEntityId}</td>
                      <td className="px-3">{r.journalNumber ?? '—'}</td>
                      <td className="px-3">
                        <button data-testid={`posting-executions-view-${r.eventId}`} className="text-[#0B5CAB] hover:underline" onClick={() => selectExecution(r)}>View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selected && (
            <div className="mt-6" data-testid="posting-executions-detail">
              <SectionLabel>Execution for event <span className="font-mono">{selected.eventId}</span></SectionLabel>
              <div className="flex items-center gap-2 mb-2"><StatusBadge s={selected.status} /></div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
                <div><dt className="text-slate-500">Event type / schema version</dt><dd>{selected.eventType} / {selected.eventSchemaVersion}</dd></div>
                <div><dt className="text-slate-500">Legal entity</dt><dd className="font-mono text-[12px]" data-testid="posting-executions-detail-entity-id">{selected.entityId ?? '—'}</dd></div>
                <div><dt className="text-slate-500">Correlation ID</dt><dd className="font-mono text-[12px]">{selected.correlationId}</dd></div>
                <div><dt className="text-slate-500">Exact rule-pack version used</dt><dd className="font-mono text-[12px]" data-testid="posting-executions-detail-rule-pack-version">{selected.rulePackVersionId ?? '—'}</dd></div>
                <div><dt className="text-slate-500">Selected rule ID</dt><dd data-testid="posting-executions-detail-rule-id">{selected.ruleId ?? '—'}</dd></div>
                <div><dt className="text-slate-500">Blueprint hash</dt><dd className="font-mono text-[11px]">{selected.blueprintHash ?? '—'}</dd></div>
              </dl>

              {selected.status === 'POSTED' && (
                <div className="mt-3" data-testid="posting-executions-posted-state">
                  <Banner kind="success" title={`Journal ${selected.journalNumber} was posted — authoritative gl-service linkage`}>
                    <Link data-testid="posting-executions-journal-link" to={`/golden-path/journal?journalNumber=${encodeURIComponent(selected.journalNumber ?? '')}`} className="underline">
                      Open journal {selected.journalNumber} in Journal Inquiry →
                    </Link>
                  </Banner>
                </div>
              )}
              {selected.status === 'NO_RULE_MATCH' && (
                <div className="mt-3" data-testid="posting-executions-no-rule-match-state">
                  <Banner kind="warning" title="No rule pack matched">No active rule pack version matched this event. Recorded as a durable posting exception.</Banner>
                </div>
              )}
              {selected.status === 'REJECTED' && (
                <div className="mt-3" data-testid="posting-executions-rejected-state">
                  <Banner kind="error" title="Posting rejected">{selected.failureReason}</Banner>
                </div>
              )}
              {selected.status === 'FAILED' && (
                <div className="mt-3" data-testid="posting-executions-failed-state">
                  <Banner kind="error" title="Posting failed">{selected.failureReason}</Banner>
                </div>
              )}

              {/* ── S021 recovery-case linkage ── */}
              <div className="mt-4" data-testid="posting-executions-recovery-linkage">
                <SectionLabel>S021 Recovery Case Linkage</SectionLabel>
                {lineageLoading ? (
                  <p className="text-[12px] text-slate-500">Loading…</p>
                ) : recoveryCase ? (
                  <Link to={`/accounting/gl/posting-recovery/${recoveryCase.id}`} className="text-[#0B5CAB] hover:underline text-[13px]" data-testid="posting-executions-recovery-case-link">
                    Recovery case {recoveryCase.id.slice(0, 8)} — <Badge variant="neutral">{recoveryCase.status}</Badge> →
                  </Link>
                ) : (
                  <p className="text-[12px] text-slate-500" data-testid="posting-executions-no-recovery-case">No S021 recovery case is linked to this execution.</p>
                )}
              </div>

              {/* ── Replay evidence ── */}
              <div className="mt-4" data-testid="posting-executions-replay-evidence">
                <SectionLabel>Replay Evidence</SectionLabel>
                {lineageLoading ? (
                  <p className="text-[12px] text-slate-500">Loading…</p>
                ) : replays.length === 0 ? (
                  <p className="text-[12px] text-slate-500" data-testid="posting-executions-replay-empty">No replay has been executed for this execution yet.</p>
                ) : (
                  <table className="w-full text-[12px] border border-slate-200 rounded" data-testid="posting-executions-replay-table">
                    <thead>
                      <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="px-2 h-8">When</th><th className="px-2 h-8">Actor</th><th className="px-2 h-8">Original version</th><th className="px-2 h-8">Replay version</th><th className="px-2 h-8">Result</th><th className="px-2 h-8">Journal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {replays.map((r) => (
                        <tr key={r.id} className="border-t border-slate-100">
                          <td className="px-2">{new Date(r.createdAt).toLocaleString()}</td>
                          <td className="px-2">{r.replayActor}</td>
                          <td className="px-2 font-mono">{r.originalRulePackVersionId?.slice(0, 8) ?? '—'}</td>
                          <td className="px-2 font-mono">{r.replayRulePackVersionId?.slice(0, 8) ?? '—'}</td>
                          <td className="px-2"><StatusBadge s={r.resultingStatus} /></td>
                          <td className="px-2">{r.resultingJournalNumber ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {selected.status !== 'POSTED' && REPLAY_ELIGIBLE.has(selected.status) && (
                  <div className="mt-2 flex items-end gap-2" data-testid="posting-executions-replay-action">
                    <label className="text-[12px] text-slate-600 flex-1">
                      Replay reason
                      <input className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={replayReason} onChange={(e) => setReplayReason(e.target.value)} placeholder="Why this execution is being replayed" />
                    </label>
                    <Btn size="sm" variant="primary" disabled={replaying || !replayReason.trim()} onClick={handleReplay} data-testid="posting-executions-replay-button">
                      {replaying ? 'Replaying…' : 'Replay'}
                    </Btn>
                  </div>
                )}
                {replayError && <Banner kind="error" title="Replay failed" testId="posting-executions-replay-error">{replayError}</Banner>}
                {replayNotice && <Banner kind="success" title={replayNotice} testId="posting-executions-replay-notice" />}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Simulation: proposed balanced-journal preview, never posts ── */}
      <div className="mt-8 border-t border-slate-200 pt-5">
        <SectionLabel>Simulate</SectionLabel>
        <p className="text-[12px] text-slate-500 mb-2">
          Runs rule-pack matching and blueprint evaluation only — never posts a journal. The envelope's own
          <code className="mx-1 px-1 bg-slate-100 rounded">legalEntityId</code>
          field is authoritative — candidate rule packs are matched against exactly that entity, never inferred.
        </p>
        <textarea
          data-testid="posting-executions-simulate-envelope-json"
          value={simEnvelopeJson}
          onChange={(e) => setSimEnvelopeJson(e.target.value)}
          rows={8}
          className="block w-full font-mono text-[12px] border border-slate-300 rounded p-2"
          placeholder={`{"eventId": "...", "tenantId": "...", "legalEntityId": "${legalEntityId}", "eventType": "...", ...}`}
        />
        <Btn size="sm" variant="primary" className="mt-2" disabled={simBusy || !simEnvelopeJson} onClick={handleSimulate} data-testid="posting-executions-simulate-button">
          Simulate
        </Btn>
        {simError && <Banner kind="error" title="Simulation failed" testId="posting-executions-simulate-error">{simError}</Banner>}
        {simResult && (
          <div className="mt-2" data-testid="posting-executions-simulate-result">
            <div className="flex items-center gap-2">
              <StatusBadge s={simResult.status} />
              {simResult.wouldPost && <span className="text-[12px] text-emerald-700">would post a balanced journal</span>}
            </div>
            {simResult.failureReason && <p className="text-[12px] text-slate-500 mt-1">{simResult.failureReason}</p>}
            {simResult.proposedJournal && (
              <table className="w-full text-[12px] border border-slate-200 rounded mt-2" data-testid="posting-executions-proposed-journal">
                <thead>
                  <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="px-2 h-8">Account</th><th className="px-2 h-8">Store</th><th className="px-2 h-8">Memo</th><th className="px-2 h-8 text-right">Debit</th><th className="px-2 h-8 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {simResult.proposedJournal.lines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 font-mono">{l.accountNumber}</td>
                      <td className="px-2">{l.storeId}</td>
                      <td className="px-2">{l.memo ?? '—'}</td>
                      <MoneyTd value={l.dr || null} />
                      <MoneyTd value={l.cr || null} />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="mt-8 border-t border-slate-200 pt-5">
        <SectionLabel>Submit certification event (test)</SectionLabel>
        <p className="text-[12px] text-slate-500 mb-2">
          Test-only. Submits a canonical source-event envelope through the internal application boundary.
          The envelope's own <code className="mx-1 px-1 bg-slate-100 rounded">legalEntityId</code> is
          authoritative for candidate-pack selection — never inferred from the pack that happens to match.
        </p>
        <textarea
          data-testid="posting-executions-submit-envelope-json"
          value={submitEnvelopeJson}
          onChange={(e) => setSubmitEnvelopeJson(e.target.value)}
          rows={8}
          className="block w-full font-mono text-[12px] border border-slate-300 rounded p-2"
          placeholder={`{"eventId": "...", "tenantId": "...", "legalEntityId": "${legalEntityId}", "eventType": "...", ...}`}
        />
        <Btn size="sm" variant="secondary" className="mt-2" disabled={submitBusy || !submitEnvelopeJson} onClick={handleSubmitEvent} data-testid="posting-executions-submit-event-button">
          Submit event
        </Btn>

        {submitError && <Banner kind="error" title="Submit failed" testId="posting-executions-submit-error">{submitError}</Banner>}

        {submitConflict && (
          <div className="mt-2" data-testid="posting-executions-identity-conflict-state">
            <Banner kind="warning" title="Identity conflict">
              Event <span className="font-mono">{submitConflict.eventId}</span> was already received with different
              content. Original execution: <span className="font-mono">{submitConflict.executionId}</span>.
            </Banner>
          </div>
        )}

        {submitResult && (
          <div className="mt-2" data-testid={submitResult.idempotent ? 'posting-executions-duplicate-noop-state' : 'posting-executions-submit-result'}>
            <div className="flex items-center gap-2 text-[13px]">
              <span>Execution <span className="font-mono">{submitResult.executionId}</span></span>
              <StatusBadge s={submitResult.status} />
              {submitResult.idempotent && <strong className="text-amber-700">duplicate no-op — no new journal was created</strong>}
            </div>
            {submitResult.journalNumber && <p className="text-[13px] mt-1">Journal: {submitResult.journalNumber}</p>}
          </div>
        )}
      </div>

      <p className="mt-6 text-[13px]">
        <Link to="/accounting/gl/posting-rules" className="text-[#0B5CAB] hover:underline">Go to Posting Rules →</Link>
      </p>
    </div>
  );
}
