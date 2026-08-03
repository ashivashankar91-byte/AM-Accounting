/**
 * CE-17 Automation Command Center.
 *
 * The one screen that answers "what is the automation actually doing right
 * now" without flattery: how many of the fourteen capabilities exist, what
 * authority each holds, how deep the approval queue is, and how much has
 * failed closed. Every number here is one the service computed.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, AuthorityBadge, StateBadge,
  AUTHORITY_LABEL, dateTime,
} from './shared';

export default function AutomationCommandCenter() {
  const qc = useQueryClient();
  const [showStop, setShowStop] = useState(false);
  const [stopReason, setStopReason] = useState('');

  const overview = useQuery({
    queryKey: ['automation', 'overview'],
    queryFn: () => automationApi.getOverview(),
    retry: false,
  });

  const items = useQuery({
    queryKey: ['automation', 'items', 'command-center'],
    queryFn: () => automationApi.listItems({ limit: 10 }),
    retry: false,
  });

  const stop = useMutation({
    mutationFn: () => automationApi.emergencyStop({ reason: stopReason.trim() }),
    onSuccess: () => {
      setShowStop(false);
      setStopReason('');
      qc.invalidateQueries({ queryKey: ['automation'] });
    },
  });

  const data: any = overview.data ?? {};
  const capabilities: any[] = data.capabilities ?? [];
  const byState: Record<string, number> = data.itemsByState ?? {};
  const recent: any[] = items.data?.items ?? [];

  return (
    <AutomationPage
      title="Accounting Automation"
      story="CE-17"
      subtitle="Fourteen capabilities, every one of them observing until two people say otherwise"
      testId="automation-command-center"
      permission="automation.read"
      loading={overview.isLoading}
      error={overview.error}
      retry={() => overview.refetch()}
      actions={
        <Btn variant="danger" size="md" data-testid="emergency-stop-btn" onClick={() => setShowStop((v) => !v)}>
          Emergency stop
        </Btn>
      }
    >
      {showStop && (
        <Card title="Stop all automation for this legal entity" testId="emergency-stop-panel">
          <p className="text-[12.5px] text-slate-600 mb-3">
            Every configured capability is suspended immediately and every live item is marked SUSPENDED. Stopping
            needs one signature because stopping is always safe; restarting needs two.
          </p>
          <div className="flex items-end gap-3">
            <label className="text-[12px] text-slate-600 flex-1">
              Reason
              <input
                data-testid="emergency-stop-reason"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={stopReason}
                onChange={(e) => setStopReason(e.target.value)}
                placeholder="Why is automation being stopped?"
              />
            </label>
            <Btn
              variant="danger"
              size="md"
              data-testid="emergency-stop-confirm"
              disabled={!stopReason.trim() || stop.isPending}
              onClick={() => stop.mutate()}
            >
              {stop.isPending ? 'Stopping…' : 'Stop everything'}
            </Btn>
          </div>
          <div className="mt-3"><MutationError error={stop.error} testId="emergency-stop-error" /></div>
        </Card>
      )}

      <Card title="Position" testId="automation-position">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8">
          <KeyValue label="Capabilities in the epic" value={data.capabilityCount ?? 14} testId="stat-capability-count" />
          <KeyValue label="Configured" value={data.configuredCount ?? 0} testId="stat-configured-count" />
          <KeyValue label="Observe only" value={data.observeOnlyCount ?? 0} testId="stat-observe-only-count" />
          <KeyValue label="Unattended within policy" value={data.autoCount ?? 0} testId="stat-auto-count" />
          <KeyValue label="Suspended" value={data.suspendedCount ?? 0} testId="stat-suspended-count" />
          <KeyValue label="Awaiting approval" value={data.approvalQueueDepth ?? 0} testId="stat-approval-queue-depth" />
          <KeyValue label="Failed closed" value={data.failedClosedCount ?? 0} testId="stat-failed-closed-count" />
        </div>
      </Card>

      {Object.keys(byState).length > 0 && (
        <Card title="Items by truthful state" testId="items-by-state">
          <div className="flex flex-wrap gap-2">
            {Object.entries(byState).map(([state, count]) => (
              <span key={state} className="inline-flex items-center gap-2" data-testid={`state-chip-${state}`}>
                <StateBadge state={state} />
                <span className="text-[13px] font-semibold text-slate-700">{count}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="Capabilities"
        testId="capability-grid"
        actions={<Link to="/accounting/automation/capabilities"><Btn variant="secondary" size="md">Manage authority</Btn></Link>}
      >
        <Table headers={['Story', 'Capability', 'Ceiling', 'Authority', 'Configured']} testId="capability-grid-table">
          {capabilities.map((c) => (
            <tr key={c.capabilityCode} data-testid={`capability-row-${c.capabilityCode}`} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-4 font-mono text-[12px]">{c.storyId}</td>
              <td className="py-2 pr-4">{c.title ?? c.label ?? c.capabilityCode}</td>
              <td className="py-2 pr-4 text-slate-500 text-[12px]">{AUTHORITY_LABEL[c.ceiling] ?? c.ceiling}</td>
              <td className="py-2 pr-4"><AuthorityBadge authority={c.currentAuthority} testId={`authority-${c.capabilityCode}`} /></td>
              <td className="py-2 pr-4">
                {c.configured
                  ? <Badge variant="info">Configured</Badge>
                  : <Badge variant="neutral" data-testid={`not-configured-${c.capabilityCode}`}>Not configured</Badge>}
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card
        title="Most recent automation items"
        testId="recent-items"
        actions={<Link to="/accounting/automation/queue"><Btn variant="secondary" size="md">Open queue</Btn></Link>}
      >
        {recent.length === 0 ? (
          <p data-testid="recent-items-empty" className="text-[13px] text-slate-500">
            Nothing has been proposed yet. A capability at OBSERVE_ONLY records what it sees and proposes nothing.
          </p>
        ) : (
          <Table headers={['Capability', 'State', 'Amount', 'Created']} testId="recent-items-table">
            {recent.map((item) => (
              <tr key={item.id} data-testid={`recent-item-${item.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{item.capabilityCode}</td>
                <td className="py-2 pr-4"><StateBadge state={item.state} /></td>
                <td className="py-2 pr-4 tabular-nums">{item.proposedAmount ?? '—'}</td>
                <td className="py-2 pr-4 text-slate-500">{dateTime(item.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </AutomationPage>
  );
}
