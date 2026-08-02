/**
 * CE-16 Migration Runbooks — S132(b).
 *
 * A runbook instance is created from a template and walked step by step:
 * discovery → mapping → rehearsal → parallel → freeze → delta → cutover →
 * post-cutover. A step linked to a gate cannot be completed until that gate is
 * genuinely satisfied, and no step completes without evidence.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { Banner, EmptyState, SectionLabel } from '../../../components/report';
import { MigrationPage, Card, Table, KeyValue, MutationError, stateVariant } from './shared';

const STEP_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED', 'SKIPPED'] as const;

export default function MigrationRunbooks() {
  const qc = useQueryClient();
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [newRunId, setNewRunId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [draft, setDraft] = useState<Record<string, { status: string; owner: string; evidence: string; note: string }>>({});

  const runs = useQuery({ queryKey: ['migration', 'runs'], queryFn: () => migrationApi.listRuns(), retry: false });
  const templates = useQuery({ queryKey: ['migration', 'runbook-templates'], queryFn: () => migrationApi.listRunbookTemplates(), retry: false });
  const instances = useQuery({ queryKey: ['migration', 'runbooks'], queryFn: () => migrationApi.listRunbooks(), retry: false });

  const detail = useQuery({
    queryKey: ['migration', 'runbook', instanceId],
    queryFn: () => migrationApi.getRunbook(instanceId as string),
    enabled: Boolean(instanceId),
    retry: false,
  });

  const createInstance = useMutation({
    mutationFn: () => migrationApi.createRunbook({ runId: newRunId, templateId: templateId || undefined }),
    onSuccess: (created: any) => {
      setInstanceId(created?.id ?? null);
      qc.invalidateQueries({ queryKey: ['migration', 'runbooks'] });
    },
  });

  const updateStep = useMutation({
    mutationFn: ({ stepCode, body }: { stepCode: string; body: any }) =>
      migrationApi.updateRunbookStep(instanceId as string, stepCode, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migration', 'runbook', instanceId] }),
  });

  const instanceList: any[] = instances.data?.items ?? [];
  const instance = detail.data?.instance;
  const steps: any[] = detail.data?.steps ?? [];
  const progress = detail.data?.progress;
  const satisfiedGates: string[] = detail.data?.satisfiedGates ?? [];

  return (
    <MigrationPage
      title="Migration Runbooks"
      story="S132"
      subtitle="Discovery → mapping → rehearsal → parallel → freeze → delta → cutover → post-cutover"
      testId="migration-runbooks"
      permission="migration.run.read"
      loading={instances.isLoading}
      error={instances.error}
      retry={() => instances.refetch()}
    >
      <Card title="Create a runbook instance" testId="create-runbook-card">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-[12px] text-slate-600">
            Migration run
            <select
              data-testid="runbook-run-select"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={newRunId}
              onChange={(e) => setNewRunId(e.target.value)}
            >
              <option value="">Select a run…</option>
              {(runs.data?.items ?? []).map((r: any) => <option key={r.id} value={r.runId}>{r.runId}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-slate-600">
            Template
            <select
              data-testid="runbook-template-select"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              <option value="">Standard migration runbook</option>
              {(templates.data?.items ?? []).filter((t: any) => !t.builtIn).map((t: any) => (
                <option key={t.id} value={t.id}>{t.name} v{t.version}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Btn
              variant="primary"
              size="md"
              data-testid="create-runbook-btn"
              loading={createInstance.isPending}
              disabled={!newRunId}
              onClick={() => createInstance.mutate()}
            >
              Create runbook
            </Btn>
          </div>
        </div>
        <MutationError error={createInstance.error} testId="create-runbook-error" />
      </Card>

      <Card title="Runbook instances" testId="runbooks-card">
        {instanceList.length === 0 ? (
          <EmptyState
            testId="runbooks-empty"
            title="No runbook instances"
            message="Create a runbook instance for a migration run so every phase has a named owner, a status and evidence."
          />
        ) : (
          <Table testId="runbooks-table" headers={['Run', 'Legal entity', 'State', 'Created', '']}>
            {instanceList.map((i) => (
              <tr key={i.id} data-testid={`runbook-row-${i.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{i.runId}</td>
                <td className="py-2 pr-4 text-[12px]">{i.legalEntityId}</td>
                <td className="py-2 pr-4"><Badge variant={stateVariant(i.state)}>{i.state}</Badge></td>
                <td className="py-2 pr-4 text-[12px]">{i.createdAt ? new Date(i.createdAt).toLocaleDateString() : '—'}</td>
                <td className="py-2 pr-4">
                  <Btn
                    variant={instanceId === i.id ? 'primary' : 'secondary'}
                    size="sm"
                    data-testid={`runbook-open-${i.id}`}
                    onClick={() => setInstanceId(i.id)}
                  >
                    Open
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {instanceId && detail.isLoading && <p className="text-[13px] text-slate-500" data-testid="runbook-detail-loading">Loading runbook…</p>}
      {instanceId && detail.error && <MutationError error={detail.error} testId="runbook-detail-error" />}

      {instance && (
        <Card title="Runbook steps" testId="runbook-steps-card">
          <KeyValue label="Run" value={<span className="font-mono">{instance.runId}</span>} />
          <KeyValue label="State" value={<Badge variant={stateVariant(instance.state)}>{instance.state}</Badge>} />
          <KeyValue
            label="Progress"
            value={<Badge variant={progress?.percent === 100 ? 'success' : 'info'} data-testid="runbook-progress">{progress?.complete ?? 0} / {progress?.total ?? 0} ({progress?.percent ?? 0}%)</Badge>}
          />
          <KeyValue label="Blocked steps" value={progress?.blocked ?? 0} testId="runbook-blocked" />
          <KeyValue
            label="Satisfied gates"
            value={satisfiedGates.length === 0 ? 'None yet' : satisfiedGates.join(', ')}
            testId="runbook-satisfied-gates"
          />

          <Banner kind="info" title="Gate-linked steps cannot be completed early" testId="runbook-gate-note">
            <span className="text-[12.5px]">
              A step linked to a gate stays incomplete until the service confirms that gate is satisfied, and no step
              can be marked complete without an evidence reference.
            </span>
          </Banner>

          <div className="mt-4">
            <SectionLabel>Each step carries an owner, a status, evidence and its gate linkage</SectionLabel>
            <Table testId="runbook-steps-table" headers={['Phase', 'Step', 'Title', 'Owner', 'Status', 'Gate linkage', 'Evidence', 'Action']}>
              {steps.map((s) => {
                const d = draft[s.code] ?? {
                  status: s.status, owner: s.owner ?? '', evidence: (s.evidenceRefs ?? []).join(','), note: s.note ?? '',
                };
                const gateSatisfied = !s.gateLinkage || satisfiedGates.includes(s.gateLinkage);
                return (
                  <tr key={s.code} data-testid={`runbook-step-${s.code}`} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="py-2 pr-4 text-[12px]">{s.phase}</td>
                    <td className="py-2 pr-4 font-mono text-[12px]">{s.code}</td>
                    <td className="py-2 pr-4 text-[12px] max-w-xs">{s.title}</td>
                    <td className="py-2 pr-4">
                      <input
                        data-testid={`step-owner-${s.code}`}
                        className="border border-slate-300 rounded px-1.5 py-1 text-[12px] w-28"
                        value={d.owner}
                        onChange={(e) => setDraft({ ...draft, [s.code]: { ...d, owner: e.target.value } })}
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <select
                        data-testid={`step-status-${s.code}`}
                        className="border border-slate-300 rounded px-1.5 py-1 text-[12px]"
                        value={d.status}
                        onChange={(e) => setDraft({ ...draft, [s.code]: { ...d, status: e.target.value } })}
                      >
                        {STEP_STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-4">
                      {s.gateLinkage ? (
                        <Badge variant={gateSatisfied ? 'success' : 'warning'} data-testid={`step-gate-${s.code}`}>
                          {s.gateLinkage}
                        </Badge>
                      ) : <span className="text-[12px] text-slate-400">—</span>}
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        data-testid={`step-evidence-${s.code}`}
                        className="border border-slate-300 rounded px-1.5 py-1 text-[12px] w-36"
                        placeholder="evidence refs"
                        value={d.evidence}
                        onChange={(e) => setDraft({ ...draft, [s.code]: { ...d, evidence: e.target.value } })}
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <Btn
                        variant="secondary"
                        size="sm"
                        data-testid={`step-save-${s.code}`}
                        onClick={() => updateStep.mutate({
                          stepCode: s.code,
                          body: {
                            status: d.status,
                            owner: d.owner.trim() || undefined,
                            evidenceRefs: d.evidence.split(',').map((x) => x.trim()).filter(Boolean),
                            note: d.note.trim() || undefined,
                          },
                        })}
                      >
                        Save
                      </Btn>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </div>
          <MutationError error={updateStep.error} testId="step-update-error" />
        </Card>
      )}

      <Card title="Runbook templates" testId="templates-card">
        {(templates.data?.items ?? []).length === 0 ? (
          <EmptyState testId="templates-empty" title="No templates" message="The standard migration runbook is always available." />
        ) : (
          <Table testId="templates-table" headers={['Name', 'Version', 'Steps', 'Built in']}>
            {(templates.data?.items ?? []).map((t: any) => (
              <tr key={t.id} data-testid={`template-row-${t.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4">{t.name}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">v{t.version}</td>
                <td className="py-2 pr-4">{(t.steps ?? []).length}</td>
                <td className="py-2 pr-4">{t.builtIn ? <Badge variant="info">BUILT-IN</Badge> : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </MigrationPage>
  );
}
