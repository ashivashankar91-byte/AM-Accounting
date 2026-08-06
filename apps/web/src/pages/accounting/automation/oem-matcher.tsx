/**
 * CE-17 S101B — OEM Statement Auto-Matcher.
 *
 * Deterministic rules run FIRST. Only exact rule matches (EXACT_RULE) may ever
 * be applied unattended — scored suggestions (SCORED_SUGGESTION) always require
 * a person. Judgment-class items (isJudgmentClass) must ALWAYS be dispositioned
 * by a human; no bulk auto-action is ever offered for them. The automation
 * identity that produced a suggestion can never be the one to dispose of it —
 * that separation is structural in the service, and this screen simply
 * reflects it.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, StateBadge, Empty,
  confidence, money, dateTime, useLegalEntityFromQuery,
} from './shared';

export default function AutomationOemMatcher() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;

  const [stateFilter, setStateFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [disposeAction, setDisposeAction] = useState<'ACCEPTED' | 'REJECTED' | 'ESCALATED' | ''>('');
  const [disposeNote, setDisposeNote] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [genSessionId, setGenSessionId] = useState('');

  const list = useQuery({
    queryKey: ['automation', 'oem', 'suggestions', legalEntityId, stateFilter],
    queryFn: () => automationApi.listOemSuggestions({ legalEntityId, state: stateFilter || undefined }),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'oem', 'suggestion', selectedId],
    queryFn: () => {
      const rows: any[] = list.data?.items ?? [];
      return rows.find((r) => r.id === selectedId) ?? null;
    },
    enabled: Boolean(selectedId) && Boolean(list.data),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const generate = useMutation({
    mutationFn: () => automationApi.generateOemSuggestions({ legalEntityId, sessionId: genSessionId || undefined }),
    onSuccess: () => { setShowGenerate(false); setGenSessionId(''); invalidate(); },
  });

  const dispose = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: string; note: string }) =>
      automationApi.disposeOemSuggestion(id, { disposition: action, note: note || undefined }),
    onSuccess: () => { setDisposeAction(''); setDisposeNote(''); invalidate(); },
  });

  const rows: any[] = list.data?.items ?? [];
  const exactRows = rows.filter((r) => r.matchType === 'EXACT_RULE');
  const scoredRows = rows.filter((r) => r.matchType === 'SCORED_SUGGESTION');
  const suggestion: any = detail.data ?? null;

  return (
    <AutomationPage
      title="OEM Statement Auto-Matcher"
      story="S101B"
      subtitle="Deterministic rules first — exact rule matches only run unattended; scored suggestions always need a person"
      testId="automation-oem-matcher"
      permission="automation.read"
      capabilityCode="S101B_OEM_MATCHER"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="generate-suggestions-toggle" onClick={() => setShowGenerate((v) => !v)}>
          Generate suggestions
        </Btn>
      }
    >
      {/* ── Generate panel ─────────────────────────────────────────────────── */}
      {showGenerate && (
        <Card title="Generate matching suggestions" testId="generate-suggestions-panel">
          <p className="text-[12.5px] text-slate-600 mb-3">
            The matcher runs deterministic rules first. Any item with an exact rule match is marked EXACT_RULE and may
            be applied without a person. Items that reach the scoring stage are marked SCORED_SUGGESTION and always
            require human disposition — no exceptions. The automation identity that produces a suggestion can never
            dispose of it.
          </p>
          <div className="flex items-end gap-3">
            <label className="text-[12px] text-slate-600 flex-1">
              S101A session ID (optional)
              <input
                data-testid="generate-session-id"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={genSessionId}
                placeholder="Session ID from S101A run"
                onChange={(e) => setGenSessionId(e.target.value)}
              />
            </label>
            <Btn
              variant="primary"
              size="md"
              data-testid="generate-suggestions-submit"
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? 'Generating…' : 'Generate'}
            </Btn>
            <Btn variant="secondary" size="md" data-testid="generate-suggestions-cancel" onClick={() => setShowGenerate(false)}>
              Cancel
            </Btn>
          </div>
          <div className="mt-3"><MutationError error={generate.error} testId="generate-suggestions-error" /></div>
        </Card>
      )}

      {/* ── State filter ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-3">
        <label className="text-[12px] text-slate-600">
          Filter by state
          <select
            data-testid="oem-state-filter"
            className="ml-2 border border-slate-300 rounded px-2 py-1 text-[13px]"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">All states</option>
            {['SUGGESTED', 'ACCEPTED', 'REJECTED', 'ESCALATED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {/* ── EXACT_RULE group — deterministic, shown first ───────────────────── */}
      <Card title="Exact rule matches — deterministic, unattended-eligible" testId="oem-exact-rule-card">
        <p className="text-[12.5px] text-slate-500 mb-3">
          These matched via deterministic rules. An exact rule match is the only category that may be applied
          without a person present. Judgment-class items are always human-only regardless of match type.
        </p>
        {exactRows.length === 0 ? (
          <Empty
            testId="oem-exact-empty"
            title="No exact rule matches"
            message={
              stateFilter
                ? `No EXACT_RULE suggestions with state ${stateFilter}.`
                : 'No exact rule matches in this run. The deterministic rules found no certain match — items fell through to scoring or were not processed yet.'
            }
          />
        ) : (
          <Table
            headers={['Claim #', 'Amount', 'Version', 'Judgment class', 'Suggested disposition', 'State', 'Disposed by', '']}
            testId="oem-exact-table"
          >
            {exactRows.map((r) => (
              <tr key={r.id} data-testid={`oem-exact-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`oem-claim-${r.id}`}>{r.claimNumber ?? '—'}</td>
                <td className="py-2 pr-4 tabular-nums" data-testid={`oem-amount-${r.id}`}>{money(r.amount)}</td>
                <td className="py-2 pr-4 font-mono text-[11px]">{r.matchVersion}</td>
                <td className="py-2 pr-4">
                  {r.isJudgmentClass
                    ? <Badge variant="warning" data-testid={`oem-judgment-${r.id}`}>Judgment class — human required</Badge>
                    : <Badge variant="neutral">Standard</Badge>}
                </td>
                <td className="py-2 pr-4 text-[12px]">{r.suggestedDisposition ?? '—'}</td>
                <td className="py-2 pr-4"><StateBadge state={r.state} testId={`oem-state-${r.id}`} /></td>
                <td className="py-2 pr-4 text-[12px] text-slate-600">{r.disposedBy ?? '—'}</td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`oem-inspect-${r.id}`} onClick={() => setSelectedId(r.id)}>
                    Inspect
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── SCORED_SUGGESTION group — always human ─────────────────────────── */}
      <Card title="Scored suggestions — always require human disposition" testId="oem-scored-card">
        <p className="text-[12.5px] text-slate-500 mb-3">
          These reached the scoring stage. A score is a probability, not a certainty. Scored suggestions always
          require a person to accept, reject, or escalate — the system never applies them unattended.
        </p>
        {scoredRows.length === 0 ? (
          <Empty
            testId="oem-scored-empty"
            title="No scored suggestions"
            message={
              stateFilter
                ? `No SCORED_SUGGESTION items with state ${stateFilter}.`
                : 'No scored suggestions yet. Items appear here when the deterministic rules find no exact match and the scorer produces a candidate.'
            }
          />
        ) : (
          <Table
            headers={['Claim #', 'Amount', 'Score', 'Version', 'Judgment class', 'Suggested disposition', 'State', 'Disposed by', '']}
            testId="oem-scored-table"
          >
            {scoredRows.map((r) => (
              <tr key={r.id} data-testid={`oem-scored-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`oem-scored-claim-${r.id}`}>{r.claimNumber ?? '—'}</td>
                <td className="py-2 pr-4 tabular-nums" data-testid={`oem-scored-amount-${r.id}`}>{money(r.amount)}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`oem-scored-score-${r.id}`}>{confidence(r.matchScore)}</td>
                <td className="py-2 pr-4 font-mono text-[11px]">{r.matchVersion}</td>
                <td className="py-2 pr-4">
                  {r.isJudgmentClass
                    ? <Badge variant="warning" data-testid={`oem-scored-judgment-${r.id}`}>Judgment class — human required</Badge>
                    : <Badge variant="neutral">Standard</Badge>}
                </td>
                <td className="py-2 pr-4 text-[12px]">{r.suggestedDisposition ?? '—'}</td>
                <td className="py-2 pr-4"><StateBadge state={r.state} testId={`oem-scored-state-${r.id}`} /></td>
                <td className="py-2 pr-4 text-[12px] text-slate-600">{r.disposedBy ?? '—'}</td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`oem-scored-inspect-${r.id}`} onClick={() => setSelectedId(r.id)}>
                    Inspect
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Suggestion detail and disposition ─────────────────────────────── */}
      {selectedId && (
        <Card
          title="Suggestion detail"
          testId="oem-detail-card"
          actions={
            suggestion
              ? <StateBadge state={suggestion.state} testId="oem-detail-state" />
              : undefined
          }
        >
          {!suggestion ? (
            <p data-testid="oem-detail-loading" className="text-[13px] text-slate-500">Loading…</p>
          ) : (
            <>
              {suggestion.isJudgmentClass && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <Badge variant="warning" data-testid="oem-detail-judgment-banner">Judgment class</Badge>
                  <p className="mt-1 text-[12.5px] text-amber-800">
                    This item is judgment class. It must always be dispositioned by a human — the system will never
                    auto-apply it regardless of match type or score.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                <KeyValue label="S101A session" value={<code className="text-[11px]">{suggestion.s101aSessionId}</code>} testId="detail-session-id" />
                <KeyValue label="Claim number" value={suggestion.claimNumber ?? '—'} testId="detail-claim-number" />
                <KeyValue label="Amount" value={money(suggestion.amount)} testId="detail-amount" />
                <KeyValue label="Match type" value={
                  <Badge variant={suggestion.matchType === 'EXACT_RULE' ? 'success' : 'info'} data-testid="detail-match-type">
                    {suggestion.matchType}
                  </Badge>
                } />
                <KeyValue label="Match score" value={confidence(suggestion.matchScore)} testId="detail-match-score" />
                <KeyValue label="Match version" value={suggestion.matchVersion} testId="detail-match-version" />
                <KeyValue label="Suggested disposition" value={suggestion.suggestedDisposition ?? '—'} testId="detail-suggested-disposition" />
                <KeyValue label="Automation identity" value={suggestion.automationIdentity} testId="detail-automation-identity" />
                <KeyValue label="Judgment class" value={suggestion.isJudgmentClass ? 'Yes — human required' : 'No'} testId="detail-judgment-class" />
                <KeyValue label="Disposed by" value={suggestion.disposedBy ?? 'Not yet disposed'} testId="detail-disposed-by" />
                <KeyValue label="Disposed at" value={dateTime(suggestion.disposedAt)} testId="detail-disposed-at" />
                <KeyValue label="Created" value={dateTime(suggestion.createdAt)} testId="detail-created-at" />
              </div>

              <p className="text-[11.5px] text-slate-500 mt-3">
                The automation identity shown above produced this suggestion. It may not dispose of it — the separation
                is structural and enforced by the service.
              </p>

              {suggestion.state === 'SUGGESTED' && (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-[12px] text-slate-600">
                      Disposition
                      <select
                        data-testid="dispose-action-select"
                        className="mt-1 block border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                        value={disposeAction}
                        onChange={(e) => setDisposeAction(e.target.value as any)}
                      >
                        <option value="">Choose action…</option>
                        <option value="ACCEPTED">Accept</option>
                        <option value="REJECTED">Reject</option>
                        <option value="ESCALATED">Escalate</option>
                      </select>
                    </label>
                    <label className="text-[12px] text-slate-600 flex-1">
                      Note (optional)
                      <input
                        data-testid="dispose-note"
                        className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                        value={disposeNote}
                        placeholder="Reason or note"
                        onChange={(e) => setDisposeNote(e.target.value)}
                      />
                    </label>
                    <Btn
                      variant="primary"
                      size="md"
                      data-testid="dispose-submit"
                      disabled={!disposeAction || dispose.isPending}
                      onClick={() => dispose.mutate({ id: suggestion.id, action: disposeAction, note: disposeNote })}
                    >
                      {dispose.isPending ? 'Saving…' : 'Save disposition'}
                    </Btn>
                  </div>
                  <MutationError error={dispose.error} testId="dispose-error" />
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </AutomationPage>
  );
}
