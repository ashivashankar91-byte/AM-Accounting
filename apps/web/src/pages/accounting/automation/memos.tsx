/**
 * CE-17 S118 GAAP Bridge Memo Generator.
 *
 * Authority ceiling: PREPARE_DRAFT. The automation drafts a memo backed by
 * sourced policy differences; a person must finalize it. The system can never
 * finalize its own output, and it can never execute anything — it has no
 * authority above PREPARE_DRAFT. Every assertion in a generated memo must be
 * sourced from a recognized snapshot (S016, S073, S091B, etc.). An unsourced
 * assertion is not permitted and will not appear on this page.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, Empty, StateBadge,
  money, dateTime, useLegalEntityFromQuery,
} from './shared';

const MEMO_STATES = ['DRAFT', 'UNDER_REVIEW', 'FINALIZED'];

export default function AutomationMemos() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;

  const [stateFilter, setStateFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Draft form
  const [showDraft, setShowDraft] = useState(false);
  const [draftYear, setDraftYear] = useState(String(new Date().getFullYear()));
  const [draftMonth, setDraftMonth] = useState(String(new Date().getMonth() + 1));
  const [draftLegalEntity, setDraftLegalEntity] = useState(legalEntityId ?? '');

  // Edit form
  const [showEdit, setShowEdit] = useState(false);
  const [editNarrative, setEditNarrative] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const list = useQuery({
    queryKey: ['automation', 'memos', legalEntityId, stateFilter, yearFilter, monthFilter],
    queryFn: () => automationApi.listMemos({
      legalEntityId,
      state: stateFilter || undefined,
      periodYear: yearFilter ? Number(yearFilter) : undefined,
      periodMonth: monthFilter ? Number(monthFilter) : undefined,
    }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'memo', selectedId],
    queryFn: () => automationApi.getMemo(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const draft = useMutation({
    mutationFn: () => automationApi.draftMemo({
      legalEntityId: draftLegalEntity,
      periodYear: Number(draftYear),
      periodMonth: Number(draftMonth),
    }),
    onSuccess: () => { setShowDraft(false); invalidate(); },
  });

  const edit = useMutation({
    mutationFn: () => automationApi.editMemo(selectedId as string, { narrative: editNarrative }),
    onSuccess: () => { setShowEdit(false); invalidate(); },
  });

  const finalize = useMutation({
    mutationFn: (id: string) => automationApi.finalizeMemo(id),
    onSuccess: invalidate,
  });

  const rows: any[] = list.data?.items ?? [];
  const memo: any = detail.data ?? null;
  const scaffold: any = memo?.scaffold ?? {};
  const differences: any[] = memo?.policyDifferences ?? [];
  const history: any[] = memo?.editorHistory ?? [];

  return (
    <AutomationPage
      title="GAAP Bridge Memo Generator"
      story="S118"
      subtitle="Ceiling: PREPARE_DRAFT — the system drafts, a human finalizes. Every assertion must be sourced."
      testId="automation-memos"
      permission="automation.read"
      capabilityCode="S118_GAAP_BRIDGE_MEMO"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="draft-memo-btn" onClick={() => setShowDraft((v) => !v)}>
          Draft memo
        </Btn>
      }
    >
      {/* Authority notice — always visible so there is no ambiguity */}
      <div
        data-testid="memo-authority-notice"
        className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-900"
      >
        <strong>Authority ceiling: PREPARE_DRAFT.</strong> The automation drafts memos from sourced policy snapshots
        (S016, S073, S091B). A human accountant must open a draft, review it, and finalize it. The automation identity
        can never finalize its own output and can never execute anything. An assertion without a source reference is not
        permitted and will not appear in any draft produced by this system.
      </div>

      {showDraft && (
        <Card title="Draft a new GAAP bridge memo" testId="draft-memo-panel">
          <p className="text-[12.5px] text-slate-600 mb-3">
            Drafting generates a structured memo with sourced GAAP/IFRS difference assertions. The draft is in state
            DRAFT until a person edits and finalizes it. The automation does not finalize.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <label className="text-[12px] text-slate-600">
              Legal entity ID
              <input
                data-testid="draft-legal-entity"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={draftLegalEntity}
                onChange={(e) => setDraftLegalEntity(e.target.value)}
                placeholder="e.g. LE-001"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Period year
              <input
                data-testid="draft-year"
                type="number"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={draftYear}
                onChange={(e) => setDraftYear(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Period month
              <input
                data-testid="draft-month"
                type="number"
                min={1}
                max={12}
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={draftMonth}
                onChange={(e) => setDraftMonth(e.target.value)}
              />
            </label>
          </div>
          <Btn
            variant="primary"
            size="md"
            data-testid="draft-memo-confirm"
            disabled={!draftLegalEntity.trim() || draft.isPending}
            onClick={() => draft.mutate()}
          >
            {draft.isPending ? 'Drafting…' : 'Generate draft'}
          </Btn>
          <div className="mt-3"><MutationError error={draft.error} testId="draft-memo-error" /></div>
        </Card>
      )}

      <Card
        title="Memos"
        testId="memos-card"
        actions={
          <div className="flex gap-2">
            <select
              data-testid="memo-state-filter"
              className="border border-slate-300 rounded px-2 py-1 text-[13px]"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="">All states</option>
              {MEMO_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              data-testid="memo-year-filter"
              type="number"
              placeholder="Year"
              className="w-20 border border-slate-300 rounded px-2 py-1 text-[13px]"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
            />
            <input
              data-testid="memo-month-filter"
              type="number"
              placeholder="Mo"
              min={1}
              max={12}
              className="w-16 border border-slate-300 rounded px-2 py-1 text-[13px]"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
            />
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty
            testId="memos-empty"
            title="No memos for these filters"
            message="No GAAP bridge memos exist for the selected legal entity, period and state. Draft one to begin the sourced memo generation workflow."
          />
        ) : (
          <Table
            headers={['Legal entity', 'Period', 'State', 'Finalized by', 'Finalized at', 'Updated', '']}
            testId="memos-table"
          >
            {rows.map((r: any) => (
              <tr key={r.id} data-testid={`memo-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 text-[12px] font-mono" data-testid={`memo-entity-${r.id}`}>{r.legalEntityId}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`memo-period-${r.id}`}>{r.periodYear}-{String(r.periodMonth).padStart(2, '0')}</td>
                <td className="py-2 pr-4">
                  <StateBadge state={r.state} testId={`memo-state-${r.id}`} />
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-600" data-testid={`memo-finalized-by-${r.id}`}>{r.finalizedBy ?? '—'}</td>
                <td className="py-2 pr-4 text-[12px] text-slate-500" data-testid={`memo-finalized-at-${r.id}`}>{dateTime(r.finalizedAt)}</td>
                <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(r.updatedAt)}</td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`inspect-memo-${r.id}`} onClick={() => setSelectedId(r.id)}>
                    Open
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {memo && (
        <>
          <Card
            title="Memo"
            testId="memo-detail"
            actions={<StateBadge state={memo.state} testId="memo-detail-state" />}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 mb-4">
              <KeyValue label="Legal entity" value={memo.legalEntityId} testId="memo-detail-entity" />
              <KeyValue label="Period" value={`${memo.periodYear}-${String(memo.periodMonth).padStart(2, '0')}`} testId="memo-detail-period" />
              <KeyValue label="State" value={<StateBadge state={memo.state} />} testId="memo-detail-state-kv" />
              <KeyValue label="Finalized by" value={memo.finalizedBy ?? '—'} testId="memo-detail-finalized-by" />
              <KeyValue label="Finalized at" value={dateTime(memo.finalizedAt)} testId="memo-detail-finalized-at" />
              <KeyValue label="S016 snapshot ref" value={memo.s016SnapshotRef ?? '—'} testId="memo-detail-snapshot-ref" />
              <KeyValue label="Last updated" value={dateTime(memo.updatedAt)} testId="memo-detail-updated-at" />
            </div>

            {/* Edit history — who touched this memo and when */}
            {history.length > 0 && (
              <div className="mb-4">
                <h3 className="text-[12px] uppercase tracking-wide text-slate-500 mb-2">Edit history</h3>
                <Table headers={['Actor', 'Action', 'At']} testId="memo-history-table">
                  {history.map((h: any, i: number) => (
                    <tr key={i} data-testid={`memo-history-row-${i}`} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 text-[12px]" data-testid={`memo-history-actor-${i}`}>{h.actor ?? '—'}</td>
                      <td className="py-2 pr-4 text-[12px]">{h.action ?? '—'}</td>
                      <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(h.at)}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-2">
              <Btn
                variant="secondary"
                size="md"
                data-testid="edit-memo-btn"
                disabled={memo.state === 'FINALIZED'}
                onClick={() => setShowEdit((v) => !v)}
              >
                Edit memo
              </Btn>
              <Btn
                variant="primary"
                size="md"
                data-testid="finalize-memo-btn"
                disabled={finalize.isPending || memo.state === 'FINALIZED'}
                onClick={() => finalize.mutate(memo.id)}
              >
                {finalize.isPending ? 'Finalizing…' : 'Finalize (human act)'}
              </Btn>
            </div>
            <p className="mt-2 text-[11.5px] text-slate-500" data-testid="finalize-notice">
              Finalize is a human act. The automation identity cannot finalize its own draft.
            </p>
            <MutationError error={finalize.error} testId="finalize-memo-error" />
          </Card>

          {showEdit && (
            <Card title="Edit memo narrative" testId="edit-memo-panel">
              <label className="text-[12px] text-slate-600 block mb-3">
                Narrative
                <textarea
                  data-testid="edit-narrative"
                  rows={6}
                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                  value={editNarrative}
                  onChange={(e) => setEditNarrative(e.target.value)}
                  placeholder="Human-authored narrative to attach to this memo…"
                />
              </label>
              <Btn
                variant="primary"
                size="md"
                data-testid="edit-memo-confirm"
                disabled={!editNarrative.trim() || edit.isPending}
                onClick={() => edit.mutate()}
              >
                {edit.isPending ? 'Saving…' : 'Save edit'}
              </Btn>
              <MutationError error={edit.error} testId="edit-memo-error" />
            </Card>
          )}

          {/* Sourced assertions — the core truth of S118 */}
          <Card title="Sourced GAAP / IFRS policy differences" testId="memo-differences-card">
            <p className="text-[12.5px] text-slate-600 mb-3" data-testid="sourced-assertion-notice">
              Every assertion below is sourced from a recognized snapshot or service output. An unsourced assertion is
              not permitted — if a difference cannot be cited, it does not appear in this memo.
            </p>
            {differences.length === 0 ? (
              <Empty
                testId="memo-differences-empty"
                title="No sourced differences recorded"
                message="The draft has not yet generated any GAAP / IFRS difference assertions. This is expected on a newly created draft before the extraction pipeline runs."
              />
            ) : (
              <Table
                headers={['#', 'Policy area', 'GAAP treatment', 'IFRS treatment', 'Amount impact', 'Source ref', 'Confidence']}
                testId="memo-differences-table"
              >
                {differences.map((d: any, i: number) => (
                  <tr key={i} data-testid={`memo-diff-row-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 text-[12px] text-slate-500">{i + 1}</td>
                    <td className="py-2 pr-4 text-[12px]" data-testid={`memo-diff-area-${i}`}>{d.policyArea ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px]">{d.gaapTreatment ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px]">{d.ifrsTreatment ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-right" data-testid={`memo-diff-amount-${i}`}>
                      {money(d.amountImpact)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-[11px]" data-testid={`memo-diff-source-${i}`}>
                      {d.sourceRef
                        ? <Badge variant="info">{d.sourceRef}</Badge>
                        : <Badge variant="danger">NO SOURCE — not permitted</Badge>}
                    </td>
                    <td className="py-2 pr-4 text-[12px]">{d.confidence ?? '—'}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {/* Scaffold — the structured memo body */}
          {scaffold && Object.keys(scaffold).length > 0 && (
            <Card title="Memo scaffold" testId="memo-scaffold-card">
              <pre
                data-testid="memo-scaffold-body"
                className="text-[12px] font-mono text-slate-700 whitespace-pre-wrap break-all"
              >
                {JSON.stringify(scaffold, null, 2)}
              </pre>
            </Card>
          )}
        </>
      )}
    </AutomationPage>
  );
}
