/**
 * CE-17 S058 — Lockbox remittance matching.
 *
 * Matching happens in two strictly-ordered phases and neither phase can be
 * skipped or reordered. Deterministic exact-key matching runs first: if the
 * apply number, remittance ref, and amount together uniquely identify an AR
 * item, the line is matched without any scoring. Scoring is applied only to
 * the residual the exact-key pass could not match — never to the whole file.
 * Lines the scorer cannot place are UNMATCHED and must be dispositioned by a
 * human. The same file delivered twice produces one set of lines, not two,
 * because ingestion is idempotent on the content hash.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, StateBadge, Empty, money, confidence, dateTime,
} from './shared';

const MATCH_TYPE_ORDER: Record<string, number> = { EXACT_KEY: 0, SCORED: 1, UNMATCHED: 2 };

export default function AutomationLockbox() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [matchTypeFilter, setMatchTypeFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'ACCEPTED' | 'REJECTED' | 'EXCEPTION'>('ACCEPTED');
  const [reviewReason, setReviewReason] = useState('');

  // Ingest form
  const [showIngestForm, setShowIngestForm] = useState(false);
  const [ingestFileRef, setIngestFileRef] = useState('');
  const [ingestSourceBank, setIngestSourceBank] = useState('');
  const [ingestDepositDate, setIngestDepositDate] = useState('');
  const [ingestLines, setIngestLines] = useState('');

  const files = useQuery({
    queryKey: ['automation', 'lockbox', 'files'],
    queryFn: () => automationApi.listLockboxFiles(),
    retry: false,
  });

  const lines = useQuery({
    queryKey: ['automation', 'lockbox', 'lines', selectedFileId, matchTypeFilter, stateFilter],
    queryFn: () =>
      automationApi.listLockboxLines(selectedFileId as string, {
        ...(matchTypeFilter ? { matchType: matchTypeFilter } : {}),
        ...(stateFilter ? { state: stateFilter } : {}),
      }),
    enabled: Boolean(selectedFileId),
    retry: false,
  });

  const ingest = useMutation({
    mutationFn: (data: any) => automationApi.ingestLockboxFile(data),
    onSuccess: () => {
      setShowIngestForm(false);
      setIngestFileRef('');
      setIngestSourceBank('');
      setIngestDepositDate('');
      setIngestLines('');
      invalidate();
    },
  });

  const review = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => automationApi.reviewLockboxLine(id, data),
    onSuccess: () => {
      setSelectedLineId(null);
      setReviewDecision('ACCEPTED');
      setReviewReason('');
      invalidate();
    },
  });

  const fileRows: any[] = files.data?.items ?? [];
  const lineRows: any[] = [...(lines.data?.items ?? [])].sort(
    (a, b) => (MATCH_TYPE_ORDER[a.matchType ?? 'UNMATCHED'] ?? 3) - (MATCH_TYPE_ORDER[b.matchType ?? 'UNMATCHED'] ?? 3),
  );
  const summary: any = lines.data?.summary ?? null;
  const selectedFile = fileRows.find((f) => f.id === selectedFileId) ?? null;

  function handleIngestSubmit() {
    let parsedLines: any[];
    try {
      parsedLines = JSON.parse(ingestLines);
    } catch {
      return;
    }
    ingest.mutate({
      fileRef: ingestFileRef.trim(),
      sourceBank: ingestSourceBank.trim() || undefined,
      depositDate: ingestDepositDate,
      lines: parsedLines,
    });
  }

  return (
    <AutomationPage
      title="Lockbox Remittance Matching"
      story="S058"
      subtitle="Exact-key matching first — scoring only touches what exact keys could not reach"
      testId="automation-lockbox"
      permission="automation.read"
      loading={files.isLoading}
      error={files.error}
      retry={() => files.refetch()}
      actions={
        <Btn variant="secondary" size="md" data-testid="ingest-toggle" onClick={() => setShowIngestForm((v) => !v)}>
          {showIngestForm ? 'Cancel ingest' : 'Ingest file'}
        </Btn>
      }
    >
      <Card
        title="Matching order: deterministic exact keys, then scored residual"
        testId="lockbox-matching-order-banner"
      >
        <p className="text-[12.5px] text-slate-600 leading-relaxed">
          Phase 1 — <strong>EXACT_KEY</strong>: a line whose apply number, remittance reference, and amount resolve
          uniquely to an open AR item is matched deterministically. No score is computed and none is needed.{' '}
          Phase 2 — <strong>SCORED</strong>: only lines that exact-key matching could not place are passed to the
          scoring engine. A SCORED suggestion is always a suggestion; a human must accept or reject it.{' '}
          Phase 3 — <strong>UNMATCHED / EXCEPTION</strong>: lines the scorer cannot place, and lines the upstream AR
          adapter could not supply candidates for. These sit in the residual queue for human disposition.
        </p>
      </Card>

      {showIngestForm && (
        <Card title="Ingest a lockbox file" testId="ingest-form">
          <p className="text-[12.5px] text-slate-600 mb-3">
            Ingestion is idempotent on the file's content hash (<code className="text-[11px]">fileHash</code>): the
            same file delivered twice produces one set of lines, not two sets of cash. The hash is computed from the
            file reference, deposit date, and line set sorted by line ref.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <label className="text-[12px] text-slate-600">
              File ref *
              <input
                data-testid="ingest-file-ref"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={ingestFileRef}
                onChange={(e) => setIngestFileRef(e.target.value)}
                placeholder="LBX-2024-001"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Source bank
              <input
                data-testid="ingest-source-bank"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={ingestSourceBank}
                onChange={(e) => setIngestSourceBank(e.target.value)}
                placeholder="FIRST_NATIONAL"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Deposit date *
              <input
                data-testid="ingest-deposit-date"
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={ingestDepositDate}
                onChange={(e) => setIngestDepositDate(e.target.value)}
              />
            </label>
          </div>
          <label className="text-[12px] text-slate-600 block mb-3">
            Lines (JSON array of {'{'}lineRef, amount, applyNumber?, remittanceRef?{'}'}) *
            <textarea
              data-testid="ingest-lines"
              rows={4}
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[12px] font-mono"
              value={ingestLines}
              onChange={(e) => setIngestLines(e.target.value)}
              placeholder='[{"lineRef":"L001","amount":"1250.00","applyNumber":"INV-4422","remittanceRef":"RMT-007"}]'
            />
          </label>
          <Btn
            variant="primary"
            size="md"
            data-testid="ingest-submit"
            disabled={!ingestFileRef.trim() || !ingestDepositDate || !ingestLines.trim() || ingest.isPending}
            onClick={handleIngestSubmit}
          >
            {ingest.isPending ? 'Ingesting…' : 'Ingest and match'}
          </Btn>
          <div className="mt-3"><MutationError error={ingest.error} testId="ingest-error" /></div>
          {ingest.data?.deduplicated && (
            <p data-testid="ingest-deduplicated" className="mt-2 text-[12.5px] text-amber-700">
              This file was already ingested (content hash matched). The existing lines are shown below — nothing was
              duplicated.
            </p>
          )}
        </Card>
      )}

      <Card
        title="Lockbox files"
        testId="lockbox-files-card"
        actions={
          <div className="flex gap-2">
            <select
              data-testid="file-state-filter"
              className="border border-slate-300 rounded px-2 py-1 text-[13px]"
              onChange={(e) => { setSelectedFileId(null); }}
            >
              <option value="">All states</option>
              {['INGESTED', 'MATCHED', 'REVIEWED'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        }
      >
        {fileRows.length === 0 ? (
          <Empty
            testId="lockbox-files-empty"
            title="No lockbox files ingested yet"
            message="Use the ingest form above to submit the first file. The same file delivered a second time will be deduplicated on its content hash."
          />
        ) : (
          <Table
            headers={['File ref', 'Source bank', 'Deposit date', 'State', 'File hash (idempotency key)', 'Processed']}
            testId="lockbox-files-table"
          >
            {fileRows.map((f) => (
              <tr
                key={f.id}
                data-testid={`lockbox-file-row-${f.id}`}
                className={[
                  'border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50',
                  selectedFileId === f.id ? 'bg-blue-50' : '',
                ].join(' ')}
                onClick={() => setSelectedFileId(f.id)}
              >
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`file-ref-${f.id}`}>{f.fileRef}</td>
                <td className="py-2 pr-4 text-slate-600">{f.sourceBank ?? '—'}</td>
                <td className="py-2 pr-4 tabular-nums">{f.depositDate ? new Date(f.depositDate).toLocaleDateString() : '—'}</td>
                <td className="py-2 pr-4"><StateBadge state={f.state} testId={`file-state-${f.id}`} /></td>
                <td className="py-2 pr-4 font-mono text-[11px] text-slate-500 max-w-[180px] truncate" data-testid={`file-hash-${f.id}`} title={f.fileHash}>
                  {f.fileHash}
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(f.processedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {selectedFile && (
        <>
          <Card
            title={`Lines — ${selectedFile.fileRef}`}
            testId="lockbox-lines-card"
            actions={
              <div className="flex gap-2">
                <select
                  data-testid="line-match-type-filter"
                  className="border border-slate-300 rounded px-2 py-1 text-[13px]"
                  value={matchTypeFilter}
                  onChange={(e) => setMatchTypeFilter(e.target.value)}
                >
                  <option value="">All match types</option>
                  <option value="EXACT_KEY">EXACT_KEY (deterministic)</option>
                  <option value="SCORED">SCORED (residual)</option>
                  <option value="UNMATCHED">UNMATCHED (no candidate)</option>
                </select>
                <select
                  data-testid="line-state-filter"
                  className="border border-slate-300 rounded px-2 py-1 text-[13px]"
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                >
                  <option value="">All states</option>
                  {['PENDING', 'SUGGESTED', 'ACCEPTED', 'REJECTED', 'EXCEPTION'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            }
          >
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 mb-4">
                <KeyValue label="Total lines" value={summary.total ?? lineRows.length} testId="lines-summary-total" />
                <KeyValue label="Exact-key matched" value={summary.exactKey ?? '—'} testId="lines-summary-exact" />
                <KeyValue label="Scored suggestions" value={summary.scored ?? '—'} testId="lines-summary-scored" />
                <KeyValue label="Unmatched / Exception" value={summary.unmatched ?? '—'} testId="lines-summary-unmatched" />
              </div>
            )}

            {lines.isLoading ? (
              <p data-testid="lockbox-lines-loading" className="text-[13px] text-slate-500">Loading lines…</p>
            ) : lineRows.length === 0 ? (
              <Empty
                testId="lockbox-lines-empty"
                title="No lines match the current filter"
                message={
                  matchTypeFilter || stateFilter
                    ? 'Change the match type or state filter to see more lines.'
                    : 'This file has no lines — it may have been ingested with an empty line set.'
                }
              />
            ) : (
              <Table
                headers={['Line ref', 'Match type', 'State', 'Amount', 'Apply #', 'Remittance ref', 'Score', 'Version', 'Matched AR item', 'Receipt posting', '']}
                testId="lockbox-lines-table"
              >
                {lineRows.map((l) => (
                  <tr
                    key={l.id}
                    data-testid={`lockbox-line-row-${l.id}`}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`line-ref-${l.id}`}>{l.lineRef}</td>
                    <td className="py-2 pr-4">
                      <Badge
                        variant={l.matchType === 'EXACT_KEY' ? 'success' : l.matchType === 'SCORED' ? 'info' : 'neutral'}
                        data-testid={`line-match-type-${l.id}`}
                      >
                        {l.matchType ?? 'UNMATCHED'}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4"><StateBadge state={l.state} testId={`line-state-${l.id}`} /></td>
                    <td className="py-2 pr-4 tabular-nums font-mono" data-testid={`line-amount-${l.id}`}>{money(l.amount)}</td>
                    <td className="py-2 pr-4 text-[12px]" data-testid={`line-apply-${l.id}`}>{l.applyNumber ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px]" data-testid={`line-remit-${l.id}`}>{l.remittanceRef ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px]" data-testid={`line-score-${l.id}`}>{confidence(l.matchScore)}</td>
                    <td className="py-2 pr-4 font-mono text-[11px] text-slate-500" data-testid={`line-version-${l.id}`}>{l.matchVersion ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`line-ar-item-${l.id}`}>{l.matchedArItemId ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`line-receipt-${l.id}`}>{l.receiptPostingId ?? '—'}</td>
                    <td className="py-2 pr-4">
                      {['SUGGESTED', 'PENDING'].includes(l.state) && (
                        <Btn
                          variant="secondary"
                          size="sm"
                          data-testid={`review-line-btn-${l.id}`}
                          onClick={() => setSelectedLineId(l.id)}
                        >
                          Review
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {selectedLineId && (
            <Card title="Review line" testId="review-line-card">
              <p className="text-[12.5px] text-slate-600 mb-3">
                A SCORED suggestion is a proposal — accepting it records the match; rejecting it removes the candidate
                and places the line in the residual queue. An EXACT_KEY line can be accepted without further review,
                but a human must still confirm disposition.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div>
                  <p className="text-[12px] text-slate-500 mb-1">Decision</p>
                  <div className="flex gap-2">
                    {(['ACCEPTED', 'REJECTED', 'EXCEPTION'] as const).map((d) => (
                      <Btn
                        key={d}
                        variant={reviewDecision === d ? 'primary' : 'secondary'}
                        size="sm"
                        data-testid={`review-decision-${d}`}
                        onClick={() => setReviewDecision(d)}
                      >
                        {d}
                      </Btn>
                    ))}
                  </div>
                </div>
                <label className="text-[12px] text-slate-600 md:col-span-2">
                  Reason (optional)
                  <input
                    data-testid="review-reason"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={reviewReason}
                    onChange={(e) => setReviewReason(e.target.value)}
                    placeholder="Why is this being accepted, rejected, or escalated?"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Btn
                  variant="primary"
                  size="md"
                  data-testid="review-submit"
                  disabled={review.isPending}
                  onClick={() => review.mutate({ id: selectedLineId, data: { decision: reviewDecision, reason: reviewReason.trim() || undefined } })}
                >
                  {review.isPending ? 'Saving…' : 'Save decision'}
                </Btn>
                <Btn variant="secondary" size="md" data-testid="review-cancel" onClick={() => setSelectedLineId(null)}>
                  Cancel
                </Btn>
              </div>
              <div className="mt-3"><MutationError error={review.error} testId="review-error" /></div>
            </Card>
          )}
        </>
      )}
    </AutomationPage>
  );
}
