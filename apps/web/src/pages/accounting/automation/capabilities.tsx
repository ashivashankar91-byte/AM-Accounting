/**
 * CE-17 Capability & Authority — the two-person ceremony, made visible.
 *
 * A promotion is proposed by one identity and activated by another. This
 * screen never lets one person do both, and it never offers a rung the
 * capability's declared ceiling forbids — an irreversible or
 * statutory-adjacent capability simply has no unattended option to click.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, AuthorityBadge,
  AUTHORITY_LADDER, AUTHORITY_LABEL, dateTime,
} from './shared';

/** The next rung up, or null when the ceiling has been reached. */
function nextAuthority(current: string, ceiling: string): string | null {
  const ladder = AUTHORITY_LADDER as readonly string[];
  const ci = ladder.indexOf(current);
  const ti = ladder.indexOf(ceiling);
  if (ci < 0 || ti < 0 || ci >= ti) return null;
  return ladder[ci + 1] ?? null;
}

export default function AutomationCapabilities() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [baselineRef, setBaselineRef] = useState('');
  const [suspendReason, setSuspendReason] = useState('');

  const list = useQuery({
    queryKey: ['automation', 'capabilities'],
    queryFn: () => automationApi.listCapabilities(),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const configure = useMutation({
    mutationFn: (capabilityCode: string) =>
      automationApi.configureCapability({ capabilityCode, baselineEvidenceRef: baselineRef.trim() || undefined }),
    onSuccess: invalidate,
  });

  const grant = useMutation({
    mutationFn: ({ id, toAuthority }: { id: string; toAuthority: string }) =>
      automationApi.grantAuthority(id, { toAuthority, evidenceRefs: baselineRef.trim() ? [baselineRef.trim()] : [] }),
    onSuccess: invalidate,
  });

  const activate = useMutation({
    mutationFn: ({ id, grantId }: { id: string; grantId?: string }) =>
      automationApi.activateAuthority(id, grantId ? { grantId } : {}),
    onSuccess: invalidate,
  });

  const suspend = useMutation({
    mutationFn: (id: string) => automationApi.suspendCapability(id, { reason: suspendReason.trim() }),
    onSuccess: () => { setSuspendReason(''); invalidate(); },
  });

  const rows: any[] = list.data?.items ?? [];
  const current = rows.find((r) => r.capabilityCode === selected) ?? null;

  return (
    <AutomationPage
      title="Capabilities & Authority"
      story="CE-17"
      subtitle="Every capability begins at OBSERVE_ONLY and climbs one rung at a time, never by one hand alone"
      testId="automation-capabilities"
      permission="automation.read"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
    >
      <Card title="The fourteen capabilities" testId="capabilities-card">
        <Table
          headers={['Story', 'Capability', 'Ceiling', 'Authority', 'Constraints', 'Pending grant', '']}
          testId="capabilities-table"
        >
          {rows.map((c) => {
            const next = nextAuthority(c.currentAuthority, c.ceiling);
            return (
              <tr key={c.capabilityCode} data-testid={`capability-${c.capabilityCode}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{c.storyId}</td>
                <td className="py-2 pr-4">{c.label ?? c.capabilityCode}</td>
                <td className="py-2 pr-4 text-[12px] text-slate-500" data-testid={`ceiling-${c.capabilityCode}`}>
                  {AUTHORITY_LABEL[c.ceiling] ?? c.ceiling}
                </td>
                <td className="py-2 pr-4">
                  <AuthorityBadge authority={c.configured ? c.currentAuthority : 'NOT_CONFIGURED'} testId={`authority-${c.capabilityCode}`} />
                </td>
                <td className="py-2 pr-4">
                  <div className="flex flex-wrap gap-1">
                    {c.irreversible && <Badge variant="danger" data-testid={`irreversible-${c.capabilityCode}`}>Irreversible</Badge>}
                    {c.statutoryAdjacent && <Badge variant="warning" data-testid={`statutory-${c.capabilityCode}`}>Statutory-adjacent</Badge>}
                    {c.zeroMutation && <Badge variant="info" data-testid={`zero-mutation-${c.capabilityCode}`}>Never mutates</Badge>}
                    {c.dualAuthorization && <Badge variant="warning" data-testid={`dual-auth-${c.capabilityCode}`}>Dual authorization</Badge>}
                    {c.requiresAdoptionCeremony && <Badge variant="info" data-testid={`adoption-${c.capabilityCode}`}>Adoption ceremony</Badge>}
                    {c.circuitBreakerTripped && <Badge variant="danger" data-testid={`breaker-${c.capabilityCode}`}>Breaker tripped</Badge>}
                  </div>
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-600">
                  {c.pendingGrant
                    ? (
                      <span data-testid={`pending-grant-${c.capabilityCode}`}>
                        → {AUTHORITY_LABEL[c.pendingGrant.toAuthority] ?? c.pendingGrant.toAuthority}
                        <br />
                        <span className="text-slate-400">by {c.pendingGrant.grantedBy}</span>
                      </span>
                    )
                    : <span className="text-slate-400">—</span>}
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {!c.configured
                    ? (
                      <Btn
                        variant="primary"
                        size="sm"
                        data-testid={`configure-${c.capabilityCode}`}
                        disabled={configure.isPending}
                        onClick={() => configure.mutate(c.capabilityCode)}
                      >
                        Configure
                      </Btn>
                    )
                    : (
                      <div className="flex gap-1">
                        <Btn variant="secondary" size="sm" data-testid={`select-${c.capabilityCode}`} onClick={() => setSelected(c.capabilityCode)}>
                          Details
                        </Btn>
                        {c.pendingGrant && (
                          <Btn
                            variant="primary"
                            size="sm"
                            data-testid={`activate-${c.capabilityCode}`}
                            disabled={activate.isPending}
                            onClick={() => activate.mutate({ id: c.id, grantId: c.pendingGrant.id })}
                          >
                            Activate
                          </Btn>
                        )}
                        {!c.pendingGrant && next && (
                          <Btn
                            variant="secondary"
                            size="sm"
                            data-testid={`grant-${c.capabilityCode}`}
                            disabled={grant.isPending}
                            onClick={() => grant.mutate({ id: c.id, toAuthority: next })}
                          >
                            Propose {AUTHORITY_LABEL[next] ?? next}
                          </Btn>
                        )}
                        {!c.pendingGrant && !next && (
                          <span data-testid={`at-ceiling-${c.capabilityCode}`} className="text-[12px] text-slate-400 self-center">
                            At ceiling
                          </span>
                        )}
                      </div>
                    )}
                </td>
              </tr>
            );
          })}
        </Table>
        <div className="mt-3 space-y-2">
          <MutationError error={configure.error} testId="configure-error" />
          <MutationError error={grant.error} testId="grant-error" />
          <MutationError error={activate.error} testId="activate-error" />
        </div>
      </Card>

      <Card title="Baseline evidence" testId="baseline-card">
        <p className="text-[12.5px] text-slate-600 mb-2">
          A capability cannot leave OBSERVE_ONLY without a measured baseline. The reference entered here is attached to
          the grant, so the promotion carries its own evidence.
        </p>
        <input
          data-testid="baseline-evidence-input"
          className="w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
          value={baselineRef}
          onChange={(e) => setBaselineRef(e.target.value)}
          placeholder="evidence reference, e.g. doc://baseline-2026-q1"
        />
      </Card>

      {current && (
        <Card title={`${current.storyId} — ${current.label ?? current.capabilityCode}`} testId="capability-detail">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <KeyValue label="Capability code" value={current.capabilityCode} testId="detail-code" />
            <KeyValue label="Current authority" value={AUTHORITY_LABEL[current.currentAuthority] ?? current.currentAuthority} testId="detail-authority" />
            <KeyValue label="Declared ceiling" value={AUTHORITY_LABEL[current.ceiling] ?? current.ceiling} testId="detail-ceiling" />
            <KeyValue label="Policy version" value={current.policyVersion ?? '—'} testId="detail-policy-version" />
            <KeyValue label="Baseline evidence" value={current.baselineEvidenceRef ?? 'Not recorded'} testId="detail-baseline" />
            <KeyValue label="Consecutive failures" value={current.circuitBreakerCount ?? 0} testId="detail-breaker-count" />
            <KeyValue label="Suspension reason" value={current.suspendReason ?? '—'} testId="detail-suspend-reason" />
            <KeyValue
              label="Pending grant"
              value={current.pendingGrant ? `${current.pendingGrant.toAuthority} (${dateTime(current.pendingGrant.grantedAt)})` : '—'}
              testId="detail-pending-grant"
            />
          </div>

          {current.configured && (
            <div className="mt-4 flex items-end gap-3">
              <label className="text-[12px] text-slate-600 flex-1">
                Suspend this capability
                <input
                  data-testid="suspend-reason"
                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                  value={suspendReason}
                  onChange={(e) => setSuspendReason(e.target.value)}
                  placeholder="Reason for stopping this capability"
                />
              </label>
              <Btn
                variant="danger"
                size="md"
                data-testid="suspend-confirm"
                disabled={!suspendReason.trim() || suspend.isPending}
                onClick={() => suspend.mutate(current.id)}
              >
                Suspend
              </Btn>
            </div>
          )}
          <div className="mt-3"><MutationError error={suspend.error} testId="suspend-error" /></div>
        </Card>
      )}
    </AutomationPage>
  );
}
