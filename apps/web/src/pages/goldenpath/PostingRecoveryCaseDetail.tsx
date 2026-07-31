import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { postingRecoveryApi } from '../../api/client';
import { ErrorState, LoadingState, UnauthorizedState, SectionLabel } from '../../components/report';
import { Badge, Btn } from '../../components/ui';

interface CaseDetail {
  id: string;
  status: string;
  sourceEventId: string;
  sourceEventType: string;
  sourceSystem: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceTransactionId: string | null;
  correlationId: string;
  causationId: string | null;
  originalEventTimestamp: string;
  businessDate: string | null;
  postingIdempotencyKey: string;
  payload: Record<string, unknown> | null;
  payloadRedacted: boolean;
  containsSensitiveData: boolean;
  firstFailureAt: string;
  latestFailureAt: string;
  latestFailureCategory: string;
  latestFailureCode: string;
  latestFailureMessage: string;
  attemptCount: number;
  assignedOwner: string | null;
  escalationState: string | null;
  journalReference: string | null;
  version: number;
  /** R1 S021-completion. */
  canReplay: boolean;
  replayEligible: boolean;
  missingReplayFields: string[];
  failures: Array<{
    id: string;
    failureCategory: string;
    failureCode: string;
    failureStage: string;
    failureMessage: string;
    fieldErrors: Record<string, unknown> | null;
    ruleContext: Record<string, unknown> | null;
    occurredAt: string;
  }>;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

const OPERATOR_GUIDANCE: Record<string, string> = {
  EVENT_CONTRACT_INVALID: 'The source event failed contract validation before posting was attempted. Coordinate with the source system owner to correct and resend the event.',
  RULE_NOT_FOUND: 'No posting rule pack matched this event type/tenant. A rule pack must be configured before this event can post.',
  RULE_CONFIGURATION_INVALID: 'A matching rule pack exists but is misconfigured. Review the rule pack configuration referenced below.',
  ACCOUNTING_MAPPING_UNRESOLVED: 'A required GL account mapping could not be resolved. Verify the mapping configuration for the referenced dimension.',
  REFERENCE_DATA_MISSING: 'Required reference data (store, entity, department, etc.) was not found. Verify the reference exists and is active.',
  ACCOUNTING_PERIOD_BLOCKED: 'The accounting period for this event is closed or blocked. Confirm the correct period before any future replay.',
  SOURCE_STATE_CONFLICT: 'The source transaction state conflicts with what posting expected. Verify the source record\'s current state.',
  IDEMPOTENCY_CONFLICT: 'A different payload was already recorded under this event identity. This requires manual investigation before any resolution.',
  AUTHORIZATION_FAILURE: 'The posting request was not authorized. Verify service-to-service credentials/scopes.',
  DOWNSTREAM_TRANSIENT: 'A downstream dependency failed transiently. This may resolve without correction once the dependency recovers.',
  DOWNSTREAM_PERMANENT: 'A downstream dependency failed permanently. Investigate the downstream service before considering replay.',
  INFRASTRUCTURE_FAILURE: 'An infrastructure-level failure occurred. Check platform health before considering replay.',
  UNKNOWN_FAILURE: 'The failure could not be categorized. Escalate for investigation.',
};

export default function PostingRecoveryCaseDetail() {
  const { isAuthenticated } = useAuth();
  const { id } = useParams<{ id: string }>();

  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [lineage, setLineage] = useState<any | null>(null);
  const [auditTimeline, setAuditTimeline] = useState<any[]>([]);
  const [auditUnauthorized, setAuditUnauthorized] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // R1 S021-completion — real replay execution.
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState<{
    outcome: string; message: string | null; journalReference: string | null;
  } | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);

  const load = useCallback(async (opts: { showSpinner?: boolean } = {}) => {
    const { showSpinner = true } = opts;
    if (!isAuthenticated || !id) return;
    if (showSpinner) setLoading(true);
    setError(null);
    setUnauthorized(null);
    setNotFound(false);
    try {
      const [detail, attemptsRes, correctionsRes, lineageRes] = await Promise.all([
        postingRecoveryApi.getCase(id),
        postingRecoveryApi.getAttempts(id),
        postingRecoveryApi.getCorrections(id),
        postingRecoveryApi.getLineage(id),
      ]);
      setCaseDetail(detail);
      setAttempts(attemptsRes.items);
      setCorrections(correctionsRes.items);
      setLineage(lineageRes);

      try {
        const timeline = await postingRecoveryApi.getAuditTimeline(id);
        setAuditTimeline(timeline.items);
      } catch (auditErr: any) {
        if (auditErr.status === 401 || auditErr.status === 403) setAuditUnauthorized(auditErr.message);
      }
    } catch (err: any) {
      if (err.status === 404) setNotFound(true);
      else if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
      else setError(err.message);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [isAuthenticated, id]);

  useEffect(() => { load(); }, [load]);

  const handleReplay = useCallback(async () => {
    if (!id || replaying) return;
    setReplaying(true);
    setReplayResult(null);
    setReplayError(null);
    try {
      const result = await postingRecoveryApi.replay(id);
      setReplayResult(result);
      // No full-page loading spinner here — that would unmount the result
      // banner we just set. Refreshes status/attempts/journalReference from
      // the server, not local guesswork.
      await load({ showSpinner: false });
    } catch (err: any) {
      setReplayError(err.message ?? 'Replay failed unexpectedly.');
    } finally {
      setReplaying(false);
    }
  }, [id, replaying, load]);

  if (!isAuthenticated) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-6">
        <p className="text-slate-600">Sign in to view this case.</p>
        <Link to="/login" className="text-[#0B5CAB] hover:underline">Sign in</Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-6" data-testid="prd-loading-wrap">
        <LoadingState label="Loading case…" testId="prd-loading" rows={10} cols={3} />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-6">
        <UnauthorizedState testId="prd-unauthorized" message={unauthorized} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-6" data-testid="prd-not-found">
        <h1 className="text-lg font-semibold text-slate-900">Case not found</h1>
        <p className="text-[13px] text-slate-500 mt-1">No posting-recovery case exists with id {id}.</p>
        <Link to="/accounting/gl/posting-recovery" className="text-[#0B5CAB] hover:underline text-[13px]">Back to queue</Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-6" data-testid="prd-error-wrap">
        <ErrorState message={error} testId="prd-error" onRetry={load} />
      </div>
    );
  }

  if (!caseDetail) return null;

  const latestFailure = caseDetail.failures[caseDetail.failures.length - 1] ?? null;

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-6" data-testid="posting-recovery-case-detail">
      <Link to="/accounting/gl/posting-recovery" className="text-[12px] text-[#0B5CAB] hover:underline">&larr; Back to queue</Link>

      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Case {caseDetail.id.slice(0, 8)}</h1>
        <Badge variant="danger" data-testid="prd-status">{caseDetail.status}</Badge>
        {caseDetail.escalationState && <Badge variant="purple">{caseDetail.escalationState}</Badge>}
      </div>
      <p className="text-[13px] text-slate-500 mt-1" data-testid="prd-failure-summary">
        {caseDetail.latestFailureCategory} — {caseDetail.latestFailureMessage}
      </p>

      {caseDetail.journalReference && (
        <p className="text-[13px] mt-1">
          Journal reference: <span className="font-mono">{caseDetail.journalReference}</span>
        </p>
      )}

      <section className="mt-5">
        <SectionLabel>Source Event Metadata</SectionLabel>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]" data-testid="prd-source-metadata">
          <div><dt className="text-slate-500">Event Type</dt><dd>{caseDetail.sourceEventType}</dd></div>
          <div><dt className="text-slate-500">Source Service</dt><dd>{caseDetail.sourceSystem}</dd></div>
          <div><dt className="text-slate-500">Source Transaction ID</dt><dd className="font-mono" data-testid="prd-source-transaction-id">{caseDetail.sourceTransactionId ?? '—'}</dd></div>
          <div><dt className="text-slate-500">Original Event Timestamp</dt><dd data-testid="prd-original-timestamp">{formatDateTime(caseDetail.originalEventTimestamp)}</dd></div>
          <div><dt className="text-slate-500">Original Correlation ID</dt><dd className="font-mono" data-testid="prd-correlation-id">{caseDetail.correlationId}</dd></div>
          <div><dt className="text-slate-500">Causation ID</dt><dd className="font-mono">{caseDetail.causationId ?? '—'}</dd></div>
          <div><dt className="text-slate-500">Business Date</dt><dd>{caseDetail.businessDate ?? '—'}</dd></div>
          <div>
            <dt className="text-slate-500">Posting Idempotency Identity</dt>
            <dd className="font-mono" data-testid="prd-idempotency-key">{caseDetail.postingIdempotencyKey}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-5">
        <SectionLabel>Failure Details</SectionLabel>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]" data-testid="prd-failure-details">
          <div><dt className="text-slate-500">Failure Stage</dt><dd>{latestFailure?.failureStage ?? '—'}</dd></div>
          <div><dt className="text-slate-500">Failure Code</dt><dd className="font-mono">{caseDetail.latestFailureCode}</dd></div>
        </dl>
        {latestFailure?.fieldErrors && (
          <div className="mt-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">Field-level validation</div>
            <pre className="mt-1 text-[12px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto">{JSON.stringify(latestFailure.fieldErrors, null, 2)}</pre>
          </div>
        )}
        {latestFailure?.ruleContext && (
          <div className="mt-2" data-testid="prd-rule-context">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">CH01 rule context</div>
            <pre className="mt-1 text-[12px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto">{JSON.stringify(latestFailure.ruleContext, null, 2)}</pre>
          </div>
        )}
        <div className="mt-2 text-[13px] bg-blue-50 border border-blue-100 text-blue-900 rounded p-2" data-testid="prd-operator-guidance">
          {OPERATOR_GUIDANCE[caseDetail.latestFailureCategory] ?? 'Review the failure details and escalate if the cause is unclear.'}
        </div>
      </section>

      <section className="mt-5">
        <SectionLabel>Original Payload</SectionLabel>
        {caseDetail.payloadRedacted ? (
          <p className="text-[13px] text-slate-500" data-testid="prd-payload-redacted">
            You don&rsquo;t have permission to view this case&rsquo;s payload.
          </p>
        ) : (
          <>
            {caseDetail.containsSensitiveData && (
              <p className="text-[12px] text-amber-700 mb-1">Sensitive fields are masked unless you hold payload.read-sensitive.</p>
            )}
            <pre className="text-[12px] bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto" data-testid="prd-payload">
              {JSON.stringify(caseDetail.payload, null, 2)}
            </pre>
          </>
        )}
      </section>

      <section className="mt-5">
        <SectionLabel>Replay Attempt History</SectionLabel>
        {attempts.length === 0 ? (
          <p className="text-[13px] text-slate-500" data-testid="prd-attempts-empty">No replay attempts have been made for this case.</p>
        ) : (
          <table className="w-full text-[13px] mt-1 border border-slate-200 rounded" data-testid="prd-attempts">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-2 h-8">#</th><th className="px-2 h-8">Status</th><th className="px-2 h-8">Requested</th><th className="px-2 h-8">Result</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a) => (
                <tr key={a.id} className="border-t border-slate-100 h-8">
                  <td className="px-2">{a.attemptNumber}</td>
                  <td className="px-2"><Badge variant={a.status === 'SUCCEEDED' ? 'success' : a.status === 'FAILED' || a.status === 'REJECTED' ? 'danger' : 'neutral'}>{a.status}</Badge></td>
                  <td className="px-2">{formatDateTime(a.requestedAt)}</td>
                  <td className="px-2">{a.resultMessage ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-2" data-testid="prd-replay-action">
          {!caseDetail.canReplay ? (
            <Btn size="sm" variant="secondary" disabled title="You don't have permission to execute a replay (posting-recovery.replay.execute)">
              Replay (no permission)
            </Btn>
          ) : caseDetail.status === 'REPLAY_IN_PROGRESS' || replaying ? (
            <Btn size="sm" variant="secondary" disabled data-testid="prd-replay-in-progress">
              Replay in progress…
            </Btn>
          ) : !caseDetail.replayEligible ? (
            <Btn
              size="sm"
              variant="secondary"
              disabled
              title={
                caseDetail.status !== 'READY_FOR_REPLAY'
                  ? `Case must be READY_FOR_REPLAY to replay (currently ${caseDetail.status})`
                  : `Missing required field(s) for replay: ${caseDetail.missingReplayFields.join(', ')}`
              }
            >
              Replay (not eligible)
            </Btn>
          ) : (
            <Btn size="sm" variant="primary" onClick={handleReplay} data-testid="prd-replay-button">
              Replay
            </Btn>
          )}

          {replayError && (
            <div className="mt-2 text-[13px] bg-red-50 border border-red-200 text-red-800 rounded p-2" data-testid="prd-replay-error">
              {replayError}
            </div>
          )}

          {replayResult && (
            <div
              className={`mt-2 text-[13px] rounded p-2 border ${
                replayResult.outcome === 'POSTED' || replayResult.outcome === 'NOOP_ALREADY_POSTED'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
              data-testid="prd-replay-result"
            >
              <strong>{replayResult.outcome}</strong>
              {replayResult.journalReference && <> — journal <span className="font-mono">{replayResult.journalReference}</span></>}
              {replayResult.message && <div className="mt-0.5">{replayResult.message}</div>}
            </div>
          )}
        </div>
      </section>

      <section className="mt-5">
        <SectionLabel>Correction History</SectionLabel>
        {corrections.length === 0 ? (
          <p className="text-[13px] text-slate-500" data-testid="prd-corrections-empty">No corrections have been proposed for this case.</p>
        ) : (
          <table className="w-full text-[13px] mt-1 border border-slate-200 rounded" data-testid="prd-corrections">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-2 h-8">#</th><th className="px-2 h-8">Type</th><th className="px-2 h-8">Description</th><th className="px-2 h-8">Status</th>
              </tr>
            </thead>
            <tbody>
              {corrections.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 h-8">
                  <td className="px-2">{c.revisionNumber}</td>
                  <td className="px-2">{c.correctionType}</td>
                  <td className="px-2">{c.description}</td>
                  <td className="px-2"><Badge variant="neutral">{c.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-5">
        <SectionLabel>Source-to-Failure Lineage</SectionLabel>
        {lineage && (
          <div className="text-[13px]" data-testid="prd-lineage">
            <p>
              <span className="font-mono">{lineage.sourceTransactionId ?? lineage.sourceEventId}</span>
              {' '}({lineage.sourceSystem}) → event <span className="font-mono">{lineage.sourceEventId}</span> → failure <Badge variant="neutral">{caseDetail.latestFailureCategory}</Badge>
            </p>
            {lineage.transitions.length > 0 && (
              <ol className="mt-2 space-y-1">
                {lineage.transitions.map((t: any) => (
                  <li key={t.id} className="text-[12px] text-slate-600">
                    {formatDateTime(t.occurredAt)} — {t.fromStatus ?? 'intake'} → {t.toStatus} ({t.actor}{t.reason ? `: ${t.reason}` : ''})
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>

      <section className="mt-5 mb-8">
        <SectionLabel>Recovery Audit Timeline</SectionLabel>
        {auditUnauthorized ? (
          <UnauthorizedState testId="prd-audit-unauthorized" message={auditUnauthorized} />
        ) : auditTimeline.length === 0 ? (
          <p className="text-[13px] text-slate-500" data-testid="prd-audit-empty">No audit events recorded yet.</p>
        ) : (
          <ol className="space-y-1 mt-1" data-testid="prd-audit-timeline">
            {auditTimeline.map((a) => (
              <li key={a.id} className="text-[12px] text-slate-600">
                {formatDateTime(a.occurredAt)} — {a.eventType} ({a.actor})
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
