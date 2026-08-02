/**
 * CE-16 COA Mapping Workbench — S130.
 *
 * Every distinct legacy value discovered in an extract must be dispositioned as
 * ALIGN, MAP, DIVERGE or EXCLUDED before a mapping set can be frozen. A value
 * nobody has classified stays MANUAL_REVIEW_REQUIRED — it is never guessed.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { Banner, EmptyState, SectionLabel } from '../../../components/report';
import { MigrationPage, Card, Table, KeyValue, MutationError, stateVariant } from './shared';

const CLASSIFICATIONS = ['ALIGN', 'MAP', 'DIVERGE'] as const;

function classificationVariant(c?: string) {
  if (c === 'ALIGN') return 'success' as const;
  if (c === 'MAP') return 'info' as const;
  if (c === 'DIVERGE') return 'warning' as const;
  return 'neutral' as const;
}

export default function MigrationMapping() {
  const qc = useQueryClient();
  const [setId, setSetId] = useState<string | null>(null);
  const [seedSnapshotId, setSeedSnapshotId] = useState('');
  const [draft, setDraft] = useState<Record<string, { classification: string; targetValue: string; provenanceNote: string }>>({});

  const sources = useQuery({ queryKey: ['migration', 'sources'], queryFn: () => migrationApi.listSources(), retry: false });
  const sets = useQuery({ queryKey: ['migration', 'mapping-sets'], queryFn: () => migrationApi.listMappingSets(), retry: false });

  const detail = useQuery({
    queryKey: ['migration', 'mapping-set', setId],
    queryFn: () => migrationApi.getMappingSet(setId as string),
    enabled: Boolean(setId),
    retry: false,
  });

  const createSet = useMutation({
    mutationFn: (sourceSystemId: string) => migrationApi.createMappingSet({ sourceSystemId }),
    onSuccess: (created: any) => {
      setSetId(created?.id ?? null);
      qc.invalidateQueries({ queryKey: ['migration', 'mapping-sets'] });
    },
  });

  const seed = useMutation({
    mutationFn: () => migrationApi.seedMappingSet(setId as string, { snapshotId: seedSnapshotId.trim(), fields: ['accountCode'] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migration', 'mapping-set', setId] }),
  });

  const updateEntry = useMutation({
    mutationFn: ({ entryId, patch }: { entryId: string; patch: any }) =>
      migrationApi.updateMappingEntry(setId as string, entryId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migration', 'mapping-set', setId] }),
  });

  const approveEntry = useMutation({
    mutationFn: (entryId: string) => migrationApi.approveMappingEntry(setId as string, entryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migration', 'mapping-set', setId] }),
  });

  const freeze = useMutation({
    mutationFn: () => migrationApi.freezeMappingSet(setId as string),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['migration', 'mapping-set', setId] });
      qc.invalidateQueries({ queryKey: ['migration', 'mapping-sets'] });
    },
  });

  const setList: any[] = sets.data?.items ?? [];
  const current = detail.data?.set;
  const entries: any[] = detail.data?.items ?? [];
  const coverage = detail.data?.coverage;
  const frozen = current?.status === 'FROZEN';

  return (
    <MigrationPage
      title="COA Mapping Workbench"
      story="S130"
      subtitle="Align / map / diverge classification with a versioned, immutable mapping set"
      testId="migration-mapping"
      permission="migration.mapping.view"
      loading={sets.isLoading}
      error={sets.error}
      retry={() => sets.refetch()}
    >
      <Card
        title="Mapping sets"
        testId="mapping-sets-card"
        actions={
          <div className="flex items-center gap-2">
            <select
              data-testid="mapping-source-select"
              className="border border-slate-300 rounded px-2 py-1 text-[12px]"
              defaultValue=""
              onChange={(e) => e.target.value && createSet.mutate(e.target.value)}
            >
              <option value="">New set for source…</option>
              {(sources.data?.items ?? []).map((s: any) => (
                <option key={s.id} value={s.id}>{s.systemCode}</option>
              ))}
            </select>
          </div>
        }
      >
        <MutationError error={createSet.error} testId="create-mapping-set-error" />
        {setList.length === 0 ? (
          <EmptyState
            testId="mapping-sets-empty"
            title="No mapping sets"
            message="Create a mapping set against a registered legacy source system to begin classifying its chart of accounts."
          />
        ) : (
          <Table testId="mapping-sets-table" headers={['Version', 'Source system', 'Status', 'Frozen by', 'Frozen at', '']}>
            {setList.map((s) => (
              <tr key={s.id} data-testid={`mapping-set-row-${s.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">v{s.version}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">{s.sourceSystemId}</td>
                <td className="py-2 pr-4"><Badge variant={stateVariant(s.status)}>{s.status}</Badge></td>
                <td className="py-2 pr-4 text-[12px]">{s.frozenBy ?? '—'}</td>
                <td className="py-2 pr-4 text-[12px]">{s.frozenAt ? new Date(s.frozenAt).toLocaleString() : '—'}</td>
                <td className="py-2 pr-4">
                  <Btn
                    variant={setId === s.id ? 'primary' : 'secondary'}
                    size="sm"
                    data-testid={`mapping-set-open-${s.id}`}
                    onClick={() => setSetId(s.id)}
                  >
                    Open workbench
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {setId && detail.isLoading && <p className="text-[13px] text-slate-500" data-testid="mapping-detail-loading">Loading mapping set…</p>}
      {setId && detail.error && <MutationError error={detail.error} testId="mapping-detail-error" />}

      {setId && current && (
        <>
          <Card title="Coverage meter" testId="coverage-card">
            <KeyValue label="Mapping set version" value={`v${current.version}`} testId="coverage-version" />
            <KeyValue label="Status" value={<Badge variant={stateVariant(current.status)}>{current.status}</Badge>} />
            <KeyValue label="Total entries" value={coverage?.totalEntries ?? 0} testId="coverage-total" />
            <KeyValue label="Dispositioned" value={coverage?.disposedEntries ?? 0} testId="coverage-disposed" />
            <KeyValue label="Manual review required" value={coverage?.manualReviewRequired ?? 0} testId="coverage-manual-review" />
            <KeyValue
              label="Coverage"
              value={<Badge variant={coverage?.complete ? 'success' : 'warning'}>{coverage?.coveragePercent ?? 0}%</Badge>}
              testId="coverage-percent"
            />
            {!coverage?.complete && (
              <Banner kind="warning" title="Coverage is not complete" testId="coverage-incomplete">
                <span className="text-[12.5px]">
                  100% disposition is required before this mapping set can be frozen and used for staging. Unclassified
                  values remain MANUAL_REVIEW_REQUIRED and are never assumed to align.
                </span>
              </Banner>
            )}
            {frozen && (
              <Banner kind="info" title="Mapping set is frozen" testId="mapping-frozen-banner">
                <span className="text-[12.5px]">
                  A frozen mapping set is immutable. Create a new version to change any decision; runs already staged
                  against v{current.version} stay pinned to it.
                </span>
              </Banner>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-[12px] text-slate-600">
                Seed from snapshot
                <input
                  data-testid="seed-snapshot-input"
                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                  value={seedSnapshotId}
                  onChange={(e) => setSeedSnapshotId(e.target.value)}
                  placeholder="snapshot id"
                />
              </label>
              <Btn
                variant="secondary"
                size="md"
                data-testid="seed-mapping-btn"
                loading={seed.isPending}
                disabled={frozen || !seedSnapshotId.trim()}
                onClick={() => seed.mutate()}
              >
                Discover source values
              </Btn>
              <Btn
                variant="primary"
                size="md"
                data-testid="freeze-mapping-btn"
                loading={freeze.isPending}
                disabled={frozen}
                onClick={() => freeze.mutate()}
              >
                Freeze version
              </Btn>
            </div>
            <MutationError error={seed.error} testId="seed-mapping-error" />
            <MutationError error={freeze.error} testId="freeze-mapping-error" />
          </Card>

          <Card title="Mapping decisions" testId="mapping-entries-card">
            <SectionLabel>Each legacy value must be aligned, mapped, diverged or excluded</SectionLabel>
            {entries.length === 0 ? (
              <EmptyState
                testId="mapping-entries-empty"
                title="No source values discovered"
                message="Seed the workbench from an imported extract to list the distinct legacy values that need a decision."
              />
            ) : (
              <Table
                testId="mapping-entries-table"
                headers={['Source field', 'Source value', 'Classification', 'Target value', 'Provenance', 'Status', 'Decided by', 'Approved by', '']}
              >
                {entries.map((e) => {
                  const d = draft[e.id] ?? {
                    classification: e.classification ?? '',
                    targetValue: e.targetValue ?? '',
                    provenanceNote: e.provenanceNote ?? '',
                  };
                  return (
                    <tr key={e.id} data-testid={`mapping-entry-${e.id}`} className="border-b border-slate-100 last:border-0 align-top">
                      <td className="py-2 pr-4 font-mono text-[12px]">{e.sourceField}</td>
                      <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`mapping-entry-source-${e.id}`}>{e.sourceValue}</td>
                      <td className="py-2 pr-4">
                        {frozen ? (
                          <Badge variant={classificationVariant(e.classification)}>{e.classification ?? '—'}</Badge>
                        ) : (
                          <select
                            data-testid={`mapping-classification-${e.id}`}
                            className="border border-slate-300 rounded px-1.5 py-1 text-[12px]"
                            value={d.classification}
                            onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, classification: ev.target.value } })}
                          >
                            <option value="">—</option>
                            {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {frozen ? <span className="font-mono text-[12px]">{e.targetValue ?? '—'}</span> : (
                          <input
                            data-testid={`mapping-target-${e.id}`}
                            className="border border-slate-300 rounded px-1.5 py-1 text-[12px] w-28"
                            value={d.targetValue}
                            onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, targetValue: ev.target.value } })}
                          />
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {frozen ? <span className="text-[12px]">{e.provenanceNote ?? '—'}</span> : (
                          <input
                            data-testid={`mapping-provenance-${e.id}`}
                            className="border border-slate-300 rounded px-1.5 py-1 text-[12px] w-40"
                            value={d.provenanceNote}
                            onChange={(ev) => setDraft({ ...draft, [e.id]: { ...d, provenanceNote: ev.target.value } })}
                            placeholder="why this decision"
                          />
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={stateVariant(e.status)} data-testid={`mapping-status-${e.id}`}>{e.status}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-[12px]">{e.decidedBy ?? '—'}</td>
                      <td className="py-2 pr-4 text-[12px]" data-testid={`mapping-approver-${e.id}`}>{e.approvedBy ?? '—'}</td>
                      <td className="py-2 pr-4">
                        {!frozen && (
                          <div className="flex gap-1">
                            <Btn
                              variant="secondary"
                              size="sm"
                              data-testid={`mapping-save-${e.id}`}
                              onClick={() => updateEntry.mutate({
                                entryId: e.id,
                                patch: {
                                  classification: d.classification || undefined,
                                  targetValue: d.targetValue || undefined,
                                  provenanceNote: d.provenanceNote || undefined,
                                  status: d.classification ? 'MAPPED' : undefined,
                                },
                              })}
                            >
                              Save
                            </Btn>
                            <Btn
                              variant="ghost"
                              size="sm"
                              data-testid={`mapping-approve-${e.id}`}
                              onClick={() => approveEntry.mutate(e.id)}
                            >
                              Approve
                            </Btn>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
            <MutationError error={updateEntry.error} testId="update-entry-error" />
            <MutationError error={approveEntry.error} testId="approve-entry-error" />
            <p className="text-[11px] text-slate-500 mt-3" data-testid="mapping-sod-note">
              Approval is a separate act from decision: the user who decided a mapping cannot approve it.
            </p>
          </Card>
        </>
      )}
    </MigrationPage>
  );
}
