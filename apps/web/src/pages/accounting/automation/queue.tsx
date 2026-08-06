/**
 * CE-17 Automation Queue — every proposal, and what happened to it.
 *
 * The queue shows the full policy trace before anything is executed, so an
 * approver sees exactly which gates an item would pass and which would refuse
 * it. The one thing this screen will never offer is a way for the automation
 * identity to approve its own recommendation; that refusal is structural and
 * lives in the service, and this screen simply reports it.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, StateBadge, PolicyTrace,
  TRUTHFUL_STATES, money, confidence, dateTime,
} from './shared';

export default function AutomationQueue() {
  const qc = useQueryClient();
  const [stateFilter, setStateFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reverseReason, setReverseReason] = useState('');

  const list = useQuery({
    queryKey: ['automation', 'items', stateFilter],
    queryFn: () => automationApi.listItems(stateFilter ? { state: stateFilter } : {}),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'item', selectedId],
    queryFn: () => automationApi.getItem(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const lineage = useQuery({
    queryKey: ['automation', 'lineage', selectedId],
    queryFn: () => automationApi.getItemLineage(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const evaluation = useQuery({
    queryKey: ['automation', 'evaluate', selectedId],
    queryFn: () => automationApi.evaluateItem(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const approve = useMutation({
    mutationFn: (id: string) => automationApi.approveItem(id),
    onSuccess: invalidate,
  });
  const reject = useMutation({
    mutationFn: (id: string) => automationApi.rejectItem(id, { reason: rejectReason.trim() }),
    onSuccess: () => { setRejectReason(''); invalidate(); },
  });
  const execute = useMutation({
    mutationFn: (id: string) => automationApi.executeItem(id),
    onSuccess: invalidate,
  });
  const retry = useMutation({
    mutationFn: (id: string) => automationApi.retryItem(id),
    onSuccess: invalidate,
  });
  const reverse = useMutation({
    mutationFn: (id: string) => automationApi.reverseItem(id, { reason: reverseReason.trim() }),
    onSuccess: () => { setReverseReason(''); invalidate(); },
  });

  const rows: any[] = list.data?.items ?? [];
  const item: any = detail.data ?? null;
  const executions: any[] = lineage.data?.executions ?? [];

  return (
    <AutomationPage
      title="Automation Queue"
      story="CE-17"
      subtitle="Recommendations, approvals, executions and the policy trace behind each one"
      testId="automation-queue"
      permission="automation.read"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
    >
      <Card title="Queue" testId="queue-card" actions={
        <select
          data-testid="queue-state-filter"
          className="border border-slate-300 rounded px-2 py-1 text-[13px]"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="">All states</option>
          {TRUTHFUL_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      }>
        {rows.length === 0 ? (
          <p data-testid="queue-empty" className="text-[13px] text-slate-500">
            Nothing is queued. A capability at OBSERVE_ONLY produces observations, not recommendations, so an empty
            queue is a truthful answer rather than a missing one.
          </p>
        ) : (
          <Table headers={['Capability', 'State', 'Amount', 'Confidence', 'Approved by', 'Created', '']} testId="queue-table">
            {rows.map((r) => (
              <tr key={r.id} data-testid={`queue-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{r.capabilityCode}</td>
                <td className="py-2 pr-4"><StateBadge state={r.state} testId={`queue-state-${r.id}`} /></td>
                <td className="py-2 pr-4 tabular-nums">{money(r.proposedAmount)}</td>
                <td className="py-2 pr-4 text-[12px]">{confidence(r.confidence)}</td>
                <td className="py-2 pr-4 text-[12px] text-slate-600">{r.approvedBy ?? '—'}</td>
                <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(r.createdAt)}</td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`inspect-${r.id}`} onClick={() => setSelectedId(r.id)}>
                    Inspect
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {item && (
        <>
          <Card title="Item" testId="item-detail" actions={<StateBadge state={item.state} testId="item-detail-state" />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <KeyValue label="Capability" value={item.capabilityCode} testId="item-capability" />
              <KeyValue label="Story" value={item.storyId} testId="item-story" />
              <KeyValue label="Automation identity" value={item.automationIdentity} testId="item-automation-identity" />
              <KeyValue label="Idempotency key" value={<code className="text-[11px]">{item.idempotencyKey}</code>} testId="item-idempotency-key" />
              <KeyValue label="Proposed amount" value={money(item.proposedAmount)} testId="item-amount" />
              <KeyValue label="Confidence" value={confidence(item.confidence)} testId="item-confidence" />
              <KeyValue label="Rule version" value={item.ruleVersion ?? '—'} testId="item-rule-version" />
              <KeyValue label="Model version" value={item.modelVersion ?? '—'} testId="item-model-version" />
              <KeyValue label="Approval required" value={item.approvalRequired ? 'Yes' : 'No'} testId="item-approval-required" />
              <KeyValue label="Approved by" value={item.approvedBy ?? 'Not approved'} testId="item-approved-by" />
              <KeyValue label="Rejected by" value={item.rejectedBy ?? '—'} testId="item-rejected-by" />
              <KeyValue label="Retries" value={item.retryCount ?? 0} testId="item-retry-count" />
              <KeyValue label="Failure reason" value={item.failureReason ?? '—'} testId="item-failure-reason" />
              <KeyValue label="Claimed by" value={item.claimedBy ?? '—'} testId="item-claimed-by" />
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-2">
              <Btn
                variant="primary"
                size="md"
                data-testid="approve-item"
                disabled={approve.isPending || Boolean(item.approvedBy) || item.state === 'EXECUTED'}
                onClick={() => approve.mutate(item.id)}
              >
                Approve
              </Btn>
              <Btn
                variant="primary"
                size="md"
                data-testid="execute-item"
                disabled={execute.isPending || item.state === 'EXECUTED'}
                onClick={() => execute.mutate(item.id)}
              >
                Execute
              </Btn>
              <Btn
                variant="secondary"
                size="md"
                data-testid="retry-item"
                disabled={retry.isPending || item.state !== 'FAILED_CLOSED'}
                onClick={() => retry.mutate(item.id)}
              >
                Retry
              </Btn>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-end gap-2">
                <label className="text-[12px] text-slate-600 flex-1">
                  Reject
                  <input
                    data-testid="reject-reason"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Why is this being rejected?"
                  />
                </label>
                <Btn
                  variant="danger"
                  size="md"
                  data-testid="reject-item"
                  disabled={!rejectReason.trim() || reject.isPending}
                  onClick={() => reject.mutate(item.id)}
                >
                  Reject
                </Btn>
              </div>
              <div className="flex items-end gap-2">
                <label className="text-[12px] text-slate-600 flex-1">
                  Reverse an executed item
                  <input
                    data-testid="reverse-reason"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={reverseReason}
                    onChange={(e) => setReverseReason(e.target.value)}
                    placeholder="Why is this being reversed?"
                  />
                </label>
                <Btn
                  variant="danger"
                  size="md"
                  data-testid="reverse-item"
                  disabled={!reverseReason.trim() || reverse.isPending || item.state !== 'EXECUTED'}
                  onClick={() => reverse.mutate(item.id)}
                >
                  Reverse
                </Btn>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              <MutationError error={approve.error} testId="approve-error" />
              <MutationError error={reject.error} testId="reject-error" />
              <MutationError error={execute.error} testId="execute-error" />
              <MutationError error={retry.error} testId="retry-error" />
              <MutationError error={reverse.error} testId="reverse-error" />
            </div>
          </Card>

          <Card title="Policy gates" testId="policy-gates-card">
            {evaluation.error
              ? <MutationError error={evaluation.error} testId="evaluate-error" />
              : <PolicyTrace evaluation={evaluation.data} testId="item-policy-trace" />}
          </Card>

          <Card title="Lineage — source evidence to journal" testId="lineage-card">
            <div className="mb-3">
              <KeyValue
                label="Source evidence"
                value={(lineage.data?.sourceEvidenceRefs ?? []).join(', ') || 'None recorded'}
                testId="lineage-source-evidence"
              />
            </div>
            {executions.length === 0 ? (
              <p data-testid="lineage-empty" className="text-[13px] text-slate-500">
                Nothing has been executed for this item. No journal reference exists, and none is implied.
              </p>
            ) : (
              <Table headers={['Outcome', 'Journal', 'Posting execution', 'Policy', 'Reversal of', 'Recorded']} testId="lineage-table">
                {executions.map((e) => (
                  <tr key={e.id} data-testid={`execution-${e.id}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4">
                      <Badge variant={e.outcome === 'EXECUTED' ? 'success' : e.outcome === 'REVERSED' ? 'info' : 'danger'}>
                        {e.outcome}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 font-mono text-[12px]">{e.journalEntryId ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[12px]">{e.postingExecutionId ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px]">{e.policyVersion}</td>
                    <td className="py-2 pr-4 font-mono text-[11px]">{e.reversalOf ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(e.createdAt)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </AutomationPage>
  );
}
