/**
 * CE-17 Automation Health.
 *
 * Health is reported from what happened, not from what was intended. The
 * service aggregates per-capability counters over a rolling window and reports
 * accuracy against a captured baseline — where no baseline was captured, the
 * figure is null and this screen says so plainly rather than substituting a
 * flattering default.
 *
 * Drift is reported as a warning, not suppressed. A drifted capability that
 * looks healthy is more dangerous than one that shows its drift.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, Empty, AuthorityBadge,
  confidence, dateTime, useLegalEntityFromQuery, useCapabilityFromQuery,
} from './shared';

export default function AutomationHealth() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;
  const capabilityCode = useCapabilityFromQuery() ?? undefined;

  const [days, setDays] = useState(30);
  const [showVersionForm, setShowVersionForm] = useState(false);
  const [versionForm, setVersionForm] = useState({
    capabilityCode: capabilityCode ?? '',
    versionTag: '',
    versionType: 'RULE' as 'RULE' | 'MODEL',
    description: '',
    artifactRef: '',
    trainingWindowStart: '',
    trainingWindowEnd: '',
  });

  const metrics = useQuery({
    queryKey: ['automation', 'health-metrics', legalEntityId, capabilityCode, days],
    queryFn: () => automationApi.getHealthMetrics({ legalEntityId, capabilityCode, days }),
    retry: false,
  });

  const versions = useQuery({
    queryKey: ['automation', 'versions', capabilityCode],
    queryFn: () => automationApi.listVersions({ capabilityCode }),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const recordVersion = useMutation({
    mutationFn: () => automationApi.recordVersion({
      capabilityCode: versionForm.capabilityCode,
      versionTag: versionForm.versionTag,
      versionType: versionForm.versionType,
      description: versionForm.description || null,
      artifactRef: versionForm.artifactRef || null,
      trainingWindowStart: versionForm.trainingWindowStart || null,
      trainingWindowEnd: versionForm.trainingWindowEnd || null,
    }),
    onSuccess: () => {
      setShowVersionForm(false);
      setVersionForm({
        capabilityCode: capabilityCode ?? '',
        versionTag: '',
        versionType: 'RULE',
        description: '',
        artifactRef: '',
        trainingWindowStart: '',
        trainingWindowEnd: '',
      });
      invalidate();
    },
  });

  const metricItems: any[] = metrics.data?.items ?? [];
  const versionItems: any[] = versions.data?.items ?? [];

  return (
    <AutomationPage
      title="Automation Health"
      story="CE-17"
      subtitle="Per-capability metrics and the rule/model version register"
      testId="automation-health"
      permission="automation.read"
      loading={metrics.isLoading}
      error={metrics.error}
      retry={() => metrics.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="record-version-btn" onClick={() => setShowVersionForm((v) => !v)}>
          Record version
        </Btn>
      }
    >
      {/* Days filter */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-[12px] text-slate-600">Window:</span>
        {[7, 14, 30, 60, 90].map((d) => (
          <Btn
            key={d}
            variant={days === d ? 'primary' : 'secondary'}
            size="sm"
            data-testid={`days-filter-${d}`}
            onClick={() => setDays(d)}
          >
            {d}d
          </Btn>
        ))}
      </div>

      {/* Record version form */}
      {showVersionForm && (
        <Card title="Record a rule or model version" testId="record-version-form">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="text-[12px] text-slate-600">
              Capability code *
              <input
                data-testid="form-version-capability"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={versionForm.capabilityCode}
                onChange={(e) => setVersionForm((f) => ({ ...f, capabilityCode: e.target.value }))}
                placeholder="e.g. S040_OCR_INGESTION"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Version tag *
              <input
                data-testid="form-version-tag"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={versionForm.versionTag}
                onChange={(e) => setVersionForm((f) => ({ ...f, versionTag: e.target.value }))}
                placeholder="e.g. rule-pack-v2.1.0"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Version type *
              <select
                data-testid="form-version-type"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={versionForm.versionType}
                onChange={(e) => setVersionForm((f) => ({ ...f, versionType: e.target.value as 'RULE' | 'MODEL' }))}
              >
                <option value="RULE">Rule pack</option>
                <option value="MODEL">ML model</option>
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              Artifact reference
              <input
                data-testid="form-version-artifact"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={versionForm.artifactRef}
                onChange={(e) => setVersionForm((f) => ({ ...f, artifactRef: e.target.value }))}
                placeholder="S3 key, container digest, etc."
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Training window start (model only)
              <input
                data-testid="form-training-start"
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={versionForm.trainingWindowStart}
                onChange={(e) => setVersionForm((f) => ({ ...f, trainingWindowStart: e.target.value }))}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Training window end (model only)
              <input
                data-testid="form-training-end"
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={versionForm.trainingWindowEnd}
                onChange={(e) => setVersionForm((f) => ({ ...f, trainingWindowEnd: e.target.value }))}
              />
            </label>
            <label className="text-[12px] text-slate-600 md:col-span-2">
              Description
              <textarea
                data-testid="form-version-description"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                rows={2}
                value={versionForm.description}
                onChange={(e) => setVersionForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What changed in this version?"
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Btn
              variant="primary"
              size="md"
              data-testid="save-version-btn"
              disabled={!versionForm.capabilityCode.trim() || !versionForm.versionTag.trim() || recordVersion.isPending}
              onClick={() => recordVersion.mutate()}
            >
              {recordVersion.isPending ? 'Saving…' : 'Record version'}
            </Btn>
            <Btn variant="secondary" size="md" data-testid="cancel-version-btn" onClick={() => setShowVersionForm(false)}>
              Cancel
            </Btn>
          </div>
          <div className="mt-3"><MutationError error={recordVersion.error} testId="record-version-error" /></div>
        </Card>
      )}

      {/* Per-capability metrics */}
      <Card title={`Per-capability metrics — last ${days} days`} testId="health-metrics-card">
        {metricItems.length === 0 ? (
          <Empty
            testId="health-metrics-empty"
            title="No metrics recorded in this window"
            message="Metrics accumulate as the automation service processes items. A capability at OBSERVE_ONLY produces no proposals and therefore records zero metrics — that is truthful, not missing."
          />
        ) : (
          <Table
            headers={['Capability', 'Authority', 'Total', 'Accepted', 'Rejected', 'Executed', 'Failed closed', 'Accuracy vs baseline', 'Drift']}
            testId="health-metrics-table"
          >
            {metricItems.map((m) => (
              <tr key={m.capabilityCode} data-testid={`health-row-${m.capabilityCode}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{m.capabilityCode}</td>
                <td className="py-2 pr-4">
                  <AuthorityBadge authority={m.currentAuthority} testId={`health-authority-${m.capabilityCode}`} />
                </td>
                <td className="py-2 pr-4 tabular-nums text-[12px]" data-testid={`health-total-${m.capabilityCode}`}>{m.totalItems}</td>
                <td className="py-2 pr-4 tabular-nums text-[12px]" data-testid={`health-accepted-${m.capabilityCode}`}>{m.accepted}</td>
                <td className="py-2 pr-4 tabular-nums text-[12px]" data-testid={`health-rejected-${m.capabilityCode}`}>{m.rejected}</td>
                <td className="py-2 pr-4 tabular-nums text-[12px]" data-testid={`health-executed-${m.capabilityCode}`}>{m.executed}</td>
                <td className="py-2 pr-4 tabular-nums text-[12px]" data-testid={`health-failed-${m.capabilityCode}`}>{m.failedClosed}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`health-accuracy-${m.capabilityCode}`}>
                  {m.series.length > 0 && m.series[m.series.length - 1].accuracyVsBaseline
                    ? confidence(m.series[m.series.length - 1].accuracyVsBaseline)
                    : <span className="text-slate-400">Not measured — no baseline captured</span>}
                </td>
                <td className="py-2 pr-4" data-testid={`health-drift-${m.capabilityCode}`}>
                  {m.driftFlagged
                    ? <Badge variant="warning">Drift detected</Badge>
                    : <Badge variant="neutral">None</Badge>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Per-capability circuit breaker counts */}
      {metricItems.some((m) => m.circuitBreakerCount > 0) && (
        <Card title="Circuit breaker counts" testId="circuit-breaker-card">
          <p className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
            A capability is suspended when consecutive failures reach the circuit breaker threshold in its active policy.
          </p>
          <Table headers={['Capability', 'Consecutive failures', 'Suspended']} testId="circuit-breaker-table">
            {metricItems.filter((m) => m.circuitBreakerCount > 0).map((m) => (
              <tr key={m.capabilityCode} data-testid={`cb-row-${m.capabilityCode}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{m.capabilityCode}</td>
                <td className="py-2 pr-4 tabular-nums" data-testid={`cb-count-${m.capabilityCode}`}>{m.circuitBreakerCount}</td>
                <td className="py-2 pr-4">
                  {m.suspended
                    ? <Badge variant="danger">Suspended</Badge>
                    : <Badge variant="warning">Not suspended yet</Badge>}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {/* Rule/model version register */}
      <Card title="Rule and model version register" testId="version-register-card">
        {versionItems.length === 0 ? (
          <Empty
            testId="version-register-empty"
            title="No versions recorded"
            message="Record a version above when a new rule pack or model is deployed. Until a version is recorded, accuracy figures cannot be attributed to a specific artifact."
          />
        ) : (
          <Table
            headers={['Capability', 'Type', 'Tag', 'Deployed at', 'Deployed by', 'Training window', 'Artifact ref', 'Description']}
            testId="version-register-table"
          >
            {versionItems.map((v) => (
              <tr key={v.id} data-testid={`version-row-${v.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{v.capabilityCode}</td>
                <td className="py-2 pr-4">
                  <Badge variant={v.versionType === 'MODEL' ? 'info' : 'neutral'} data-testid={`version-type-${v.id}`}>
                    {v.versionType}
                  </Badge>
                </td>
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`version-tag-${v.id}`}>{v.versionTag}</td>
                <td className="py-2 pr-4 text-[12px] text-slate-600" data-testid={`version-deployed-at-${v.id}`}>{dateTime(v.deployedAt)}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`version-deployed-by-${v.id}`}>{v.deployedBy}</td>
                <td className="py-2 pr-4 text-[11px] text-slate-500" data-testid={`version-training-window-${v.id}`}>
                  {v.trainingWindowStart && v.trainingWindowEnd
                    ? `${dateTime(v.trainingWindowStart)} → ${dateTime(v.trainingWindowEnd)}`
                    : v.versionType === 'MODEL' ? 'Not recorded' : '—'}
                </td>
                <td className="py-2 pr-4 font-mono text-[11px] text-slate-600 max-w-[160px] truncate" data-testid={`version-artifact-${v.id}`}>
                  {v.artifactRef ?? '—'}
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-600">{v.description ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </AutomationPage>
  );
}
