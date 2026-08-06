/**
 * CE-17 S022 — Rule Simulation Sandbox.
 *
 * The sandbox never posts and never mutates. That is not a policy preference —
 * it is a structural fact: the service has no posting client and no item
 * service. Every completed run carries a mutationProof field that says exactly
 * this, and this screen surfaces it as evidence rather than as assertion.
 *
 * Proposed journals shown on this screen are labelled as proposed, never
 * posted, and the diff viewer makes the same guarantee visible. Nothing here
 * implies that any entry reached the ledger.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, Empty, StateBadge,
  dateTime, useLegalEntityFromQuery,
} from './shared';
import { Banner } from '../../../components/report';

const SCENARIO_TYPES = ['HISTORICAL_REPLAY', 'SYNTHETIC', 'DRAFT_PACK_PREVIEW'] as const;

export default function AutomationSandbox() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [showRunForm, setShowRunForm] = useState(false);
  const [runForm, setRunForm] = useState({
    name: '',
    description: '',
    scenarioType: 'HISTORICAL_REPLAY' as (typeof SCENARIO_TYPES)[number],
    rulePackVersion: '',
  });

  const list = useQuery({
    queryKey: ['automation', 'sandboxes', legalEntityId],
    queryFn: () => automationApi.listSandboxes({ legalEntityId }),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'sandbox', selectedId],
    queryFn: () => automationApi.getSandbox(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const diff = useQuery({
    queryKey: ['automation', 'sandbox-diff', selectedId],
    queryFn: () => automationApi.getSandboxDiff(selectedId as string),
    enabled: Boolean(selectedId) && showDiff,
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const runSandbox = useMutation({
    mutationFn: () => automationApi.runSandbox({
      legalEntityId,
      name: runForm.name,
      description: runForm.description || undefined,
      scenarioType: runForm.scenarioType,
      rulePackVersion: runForm.rulePackVersion || null,
    }),
    onSuccess: () => {
      setShowRunForm(false);
      setRunForm({ name: '', description: '', scenarioType: 'HISTORICAL_REPLAY', rulePackVersion: '' });
      invalidate();
    },
  });

  const rows: any[] = list.data?.items ?? [];
  const sandbox: any = detail.data?.sandbox ?? null;
  const result: any = detail.data?.result ?? null;
  const diffData: any = diff.data ?? null;

  const proposedJournals: any[] = diffData?.proposedJournals ?? [];
  const ruleHits: any[] = diffData?.ruleHits ?? [];
  const diffVsActual: any[] = Array.isArray(diffData?.diffVsActual) ? diffData.diffVsActual : [];

  return (
    <AutomationPage
      title="Rule Simulation Sandbox"
      story="S022"
      subtitle="Run scenarios against historical or synthetic data — nothing here reaches the ledger"
      testId="automation-sandbox"
      permission="automation.read"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="run-sandbox-btn" onClick={() => setShowRunForm((v) => !v)}>
          Run sandbox
        </Btn>
      }
    >
      {/* Permanent no-post banner — must always be visible */}
      <Banner kind="info" title="This sandbox never posts and never mutates" testId="sandbox-no-post-banner">
        <span className="text-[12.5px]">
          The sandbox service has no posting client and no item service. There is no code path that could cause a journal
          entry to reach the ledger, even if someone asked it to. Every completed run carries a{' '}
          <code className="font-mono text-[11px]">mutationProof</code> field confirming zero postings attempted and zero
          rows mutated. Proposed journals shown here are labelled <strong>proposed, never posted</strong> — they describe
          what the rules <em>would</em> have done, not what they did.
        </span>
      </Banner>

      {/* Run form */}
      {showRunForm && (
        <Card title="Configure and run a sandbox scenario" testId="run-sandbox-form">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="text-[12px] text-slate-600">
              Scenario name *
              <input
                data-testid="form-sandbox-name"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={runForm.name}
                onChange={(e) => setRunForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Q4-2025 ingestion replay"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Scenario type *
              <select
                data-testid="form-sandbox-scenario-type"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={runForm.scenarioType}
                onChange={(e) => setRunForm((f) => ({ ...f, scenarioType: e.target.value as (typeof SCENARIO_TYPES)[number] }))}
              >
                {SCENARIO_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              Rule pack version (blank = latest)
              <input
                data-testid="form-sandbox-rule-pack"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={runForm.rulePackVersion}
                onChange={(e) => setRunForm((f) => ({ ...f, rulePackVersion: e.target.value }))}
                placeholder="e.g. rule-pack-v2.1.0"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Description
              <input
                data-testid="form-sandbox-description"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={runForm.description}
                onChange={(e) => setRunForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What is this run testing?"
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Btn
              variant="primary"
              size="md"
              data-testid="run-sandbox-submit"
              disabled={!runForm.name.trim() || runSandbox.isPending}
              onClick={() => runSandbox.mutate()}
            >
              {runSandbox.isPending ? 'Running…' : 'Run sandbox'}
            </Btn>
            <Btn variant="secondary" size="md" data-testid="cancel-sandbox-btn" onClick={() => setShowRunForm(false)}>
              Cancel
            </Btn>
          </div>
          <div className="mt-3"><MutationError error={runSandbox.error} testId="run-sandbox-error" /></div>
        </Card>
      )}

      {/* Sandbox list */}
      <Card title="Sandbox runs" testId="sandbox-list-card">
        {rows.length === 0 ? (
          <Empty
            testId="sandbox-list-empty"
            title="No sandbox runs yet"
            message="Run a scenario above. The sandbox only produces proposed journals — nothing here has been or will be posted."
          />
        ) : (
          <Table
            headers={['Name', 'Scenario type', 'State', 'Rule pack version', 'Created', '']}
            testId="sandbox-list-table"
          >
            {rows.map((r) => (
              <tr key={r.id} data-testid={`sandbox-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 text-[13px]" data-testid={`sandbox-name-${r.id}`}>{r.name}</td>
                <td className="py-2 pr-4">
                  <Badge variant="neutral" data-testid={`sandbox-scenario-type-${r.id}`}>{r.scenarioType}</Badge>
                </td>
                <td className="py-2 pr-4">
                  <StateBadge state={r.state} testId={`sandbox-state-${r.id}`} />
                </td>
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`sandbox-rule-pack-${r.id}`}>
                  {r.rulePackVersion ?? '—'}
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(r.createdAt)}</td>
                <td className="py-2 pr-4">
                  <Btn
                    variant="secondary"
                    size="sm"
                    data-testid={`inspect-sandbox-${r.id}`}
                    onClick={() => {
                      setSelectedId(r.id === selectedId ? null : r.id);
                      setShowDiff(false);
                    }}
                  >
                    {r.id === selectedId ? 'Hide' : 'Inspect'}
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Sandbox detail */}
      {sandbox && (
        <Card
          title={`Run: ${sandbox.name}`}
          testId="sandbox-detail-card"
          actions={<StateBadge state={sandbox.state} testId="sandbox-detail-state" />}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 mb-4">
            <KeyValue label="Scenario type" value={sandbox.scenarioType} testId="sandbox-detail-scenario-type" />
            <KeyValue label="State" value={sandbox.state} testId="sandbox-detail-state-value" />
            <KeyValue label="Rule pack version" value={sandbox.rulePackVersion ?? '—'} testId="sandbox-detail-rule-pack" />
            <KeyValue label="Created by" value={sandbox.createdBy} testId="sandbox-detail-created-by" />
            <KeyValue label="Created" value={dateTime(sandbox.createdAt)} testId="sandbox-detail-created-at" />
            {result && (
              <KeyValue
                label="Exportable as baseline"
                value={result.exportableBaseline ? <Badge variant="info">Yes</Badge> : <Badge variant="neutral">No</Badge>}
                testId="sandbox-detail-exportable"
              />
            )}
          </div>

          {/* Mutation proof — must always be shown when available */}
          {sandbox.mutationProof && (
            <div
              data-testid="sandbox-mutation-proof"
              className="mb-4 bg-green-50 border border-green-200 rounded px-3 py-2"
            >
              <p className="text-[12px] font-semibold text-green-800 mb-1">Mutation proof</p>
              <p className="text-[12.5px] text-green-700">
                {typeof sandbox.mutationProof === 'object'
                  ? sandbox.mutationProof.statement ?? JSON.stringify(sandbox.mutationProof)
                  : String(sandbox.mutationProof)}
              </p>
              {typeof sandbox.mutationProof === 'object' && (
                <div className="flex gap-4 mt-1">
                  <span className="text-[12px] text-green-600" data-testid="mutation-proof-postings">
                    Postings attempted: <strong>{sandbox.mutationProof.postingsAttempted ?? 0}</strong>
                  </span>
                  <span className="text-[12px] text-green-600" data-testid="mutation-proof-rows">
                    Rows mutated: <strong>{sandbox.mutationProof.rowsMutated ?? 0}</strong>
                  </span>
                </div>
              )}
            </div>
          )}

          {sandbox.state === 'COMPLETED' && (
            <Btn
              variant="secondary"
              size="md"
              data-testid="show-diff-btn"
              onClick={() => setShowDiff((v) => !v)}
            >
              {showDiff ? 'Hide diff' : 'Show diff and proposed journals'}
            </Btn>
          )}
        </Card>
      )}

      {/* Diff viewer */}
      {showDiff && selectedId && (
        <Card title="Diff — proposed journals vs actual (never posted)" testId="sandbox-diff-card">
          {diff.isLoading ? (
            <p className="text-[13px] text-slate-500">Loading diff…</p>
          ) : !diffData?.available ? (
            <p data-testid="sandbox-diff-unavailable" className="text-[13px] text-slate-500">
              {diffData?.detail ?? 'Diff is not available for this run.'}
            </p>
          ) : (
            <>
              {/* Proposed journals — labelled unmistakably */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-[14px] font-semibold text-slate-800">Proposed journals</h3>
                  <Badge variant="warning" data-testid="proposed-journals-label">PROPOSED — NEVER POSTED</Badge>
                  <span className="text-[12px] text-slate-500">({proposedJournals.length} entries)</span>
                </div>
                <p className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3" data-testid="proposed-journals-disclaimer">
                  These journal entries describe what the active rules <em>would have</em> produced against the scenario
                  data. They have not been posted, are not pending posting, and carry no journal entry ID. The mutation
                  proof above confirms zero postings were attempted.
                </p>
                {proposedJournals.length === 0 ? (
                  <p data-testid="proposed-journals-empty" className="text-[13px] text-slate-500">
                    No journals were proposed. Either no rules matched the scenario rows, or the scenario produced no
                    eligible transactions.
                  </p>
                ) : (
                  <Table headers={['Description', 'Debit account', 'Credit account', 'Amount', 'Rule code']} testId="proposed-journals-table">
                    {proposedJournals.map((j, i) => (
                      <tr key={i} data-testid={`proposed-journal-${i}`} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 text-[12px]">{j.description ?? '—'}</td>
                        <td className="py-2 pr-4 font-mono text-[12px]">{j.debitAccount ?? j.debit ?? '—'}</td>
                        <td className="py-2 pr-4 font-mono text-[12px]">{j.creditAccount ?? j.credit ?? '—'}</td>
                        <td className="py-2 pr-4 tabular-nums text-[12px]">{j.amount ?? '—'}</td>
                        <td className="py-2 pr-4 font-mono text-[11px] text-slate-500">{j.ruleCode ?? '—'}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>

              {/* Rule hits */}
              <div className="mb-6">
                <h3 className="text-[14px] font-semibold text-slate-800 mb-2">Rule hits</h3>
                {ruleHits.length === 0 ? (
                  <p data-testid="rule-hits-empty" className="text-[13px] text-slate-500">
                    No rules matched rows in this scenario. Either the rule pack version produced no matches or the scenario
                    contained no eligible rows.
                  </p>
                ) : (
                  <Table headers={['Rule code', 'Match field', 'Match value', 'Rows matched']} testId="rule-hits-table">
                    {ruleHits.map((h, i) => (
                      <tr key={i} data-testid={`rule-hit-${i}`} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 font-mono text-[12px]">{h.ruleCode}</td>
                        <td className="py-2 pr-4 font-mono text-[12px]">{h.matchField ?? '—'}</td>
                        <td className="py-2 pr-4 font-mono text-[12px]">{h.matchValue ?? '—'}</td>
                        <td className="py-2 pr-4 tabular-nums text-[12px]">{h.rowsMatched ?? h.count ?? '—'}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>

              {/* Diff vs actual */}
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800 mb-2">Diff vs actual</h3>
                {diffVsActual.length === 0 ? (
                  <p data-testid="diff-vs-actual-empty" className="text-[13px] text-slate-500">
                    No diff against actual is available. This is expected for SYNTHETIC scenarios, which have no actual
                    postings to compare against.
                  </p>
                ) : (
                  <Table headers={['Field', 'Proposed', 'Actual', 'Match']} testId="diff-vs-actual-table">
                    {diffVsActual.map((d, i) => (
                      <tr key={i} data-testid={`diff-row-${i}`} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 pr-4 font-mono text-[12px]">{d.field}</td>
                        <td className="py-2 pr-4 text-[12px]">{d.proposed ?? '—'}</td>
                        <td className="py-2 pr-4 text-[12px]">{d.actual ?? '—'}</td>
                        <td className="py-2 pr-4">
                          <Badge variant={d.match ? 'success' : 'danger'}>{d.match ? 'Match' : 'Mismatch'}</Badge>
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>
            </>
          )}
        </Card>
      )}
    </AutomationPage>
  );
}
