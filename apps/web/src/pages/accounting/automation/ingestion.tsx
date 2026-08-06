/**
 * CE-17 S040 — OCR/EDI Invoice Ingestion.
 *
 * Extraction produces a DRAFT and nothing else. Every field carries its own
 * confidence alongside a reference to the source image or EDI segment it was
 * read from, so a clerk is approving what the machine extracted, not what it
 * concluded. A low-confidence draft is not an invoice — it is an extraction
 * awaiting a clerk, and this screen says so plainly.
 *
 * An accepted draft becomes an S039 AP invoice through the normal invoice
 * path. This service never books a liability itself; it only tells the AP
 * workflow what it found.
 *
 * Duplicate suspects are warned loudly: the dedup key is derived from vendor,
 * invoice number and amount, so the same invoice arriving by OCR on Monday and
 * by EDI on Tuesday is flagged rather than paid twice. A DUPLICATE draft
 * cannot be accepted without an explicit override.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, Empty, StateBadge,
  confidence, dateTime, useLegalEntityFromQuery,
} from './shared';
import { Banner } from '../../../components/report';

const CHANNELS = ['OCR', 'EDI'] as const;
const DRAFT_STATES = ['DRAFT', 'CLERK_REVIEW', 'ACCEPTED', 'REJECTED', 'DUPLICATE'] as const;

export default function AutomationIngestion() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;

  const [stateFilter, setStateFilter] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acceptForm, setAcceptForm] = useState({ s039InvoiceId: '', overrideDuplicate: false });
  const [rejectReason, setRejectReason] = useState('');

  const list = useQuery({
    queryKey: ['automation', 'ingestion', legalEntityId, stateFilter, channelFilter],
    queryFn: () => automationApi.listIngestionDrafts({
      legalEntityId,
      state: stateFilter || undefined,
      channel: channelFilter || undefined,
    }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'ingestion-draft', selectedId],
    queryFn: () => automationApi.getIngestionDraft(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const accept = useMutation({
    mutationFn: () => automationApi.acceptIngestionDraft(selectedId as string, {
      s039InvoiceId: acceptForm.s039InvoiceId.trim() || null,
      overrideDuplicate: acceptForm.overrideDuplicate,
    }),
    onSuccess: () => { setAcceptForm({ s039InvoiceId: '', overrideDuplicate: false }); invalidate(); },
  });

  const reject = useMutation({
    mutationFn: () => automationApi.rejectIngestionDraft(selectedId as string, { reason: rejectReason.trim() }),
    onSuccess: () => { setRejectReason(''); invalidate(); },
  });

  const rows: any[] = list.data?.items ?? [];
  const draft: any = detail.data ?? null;
  const fieldConfidence: Record<string, number> = draft?.fieldConfidence ?? {};
  const extractedFields: Record<string, unknown> = draft?.extractedFields ?? {};
  const suggestedCoding: Record<string, unknown> = draft?.suggestedCoding ?? {};

  return (
    <AutomationPage
      title="Invoice Ingestion"
      story="S040"
      subtitle="OCR and EDI extractions — drafts awaiting clerk review, never invoices until accepted"
      testId="automation-ingestion"
      permission="automation.read"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
    >
      {/* Permanent clarification banner */}
      <Banner kind="info" title="These are extraction drafts, not invoices" testId="ingestion-draft-banner">
        <span className="text-[12.5px]">
          Everything on this screen is a <strong>DRAFT</strong> produced by OCR or EDI parsing. No liability has been
          recorded and no payment is scheduled. An extraction becomes an AP invoice only after a clerk reviews and
          accepts it — at which point it is routed through the normal S039 AP path. A low-confidence extraction
          requires extra scrutiny before acceptance; the confidence figures on each field show exactly what the
          extractor was uncertain about.
        </span>
      </Banner>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          data-testid="ingestion-state-filter"
          className="border border-slate-300 rounded px-2 py-1 text-[13px]"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="">All states</option>
          {DRAFT_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          data-testid="ingestion-channel-filter"
          className="border border-slate-300 rounded px-2 py-1 text-[13px]"
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
        >
          <option value="">All channels</option>
          {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Draft list */}
      <Card title="Ingestion drafts" testId="ingestion-list-card">
        {rows.length === 0 ? (
          <Empty
            testId="ingestion-list-empty"
            title="No ingestion drafts in this filter"
            message="Drafts are created when an OCR scan or EDI transaction arrives. A draft has no effect on the ledger until a clerk explicitly accepts it. Filtering by CLERK_REVIEW shows everything waiting for human eyes."
          />
        ) : (
          <Table
            headers={['Channel', 'State', 'Vendor ref', 'Confidence', 'Duplicate?', 'Extractor version', 'Created', '']}
            testId="ingestion-list-table"
          >
            {rows.map((r) => (
              <tr key={r.id} data-testid={`ingestion-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4">
                  <Badge variant={r.channel === 'OCR' ? 'info' : 'neutral'} data-testid={`ingestion-channel-${r.id}`}>
                    {r.channel}
                  </Badge>
                </td>
                <td className="py-2 pr-4">
                  <StateBadge state={r.state} testId={`ingestion-state-${r.id}`} />
                </td>
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`ingestion-vendor-${r.id}`}>
                  {r.vendorMatchRef ?? '—'}
                </td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`ingestion-confidence-${r.id}`}>
                  {confidence(r.overallConfidence)}
                </td>
                <td className="py-2 pr-4" data-testid={`ingestion-duplicate-${r.id}`}>
                  {r.isDuplicateSuspect
                    ? <Badge variant="danger">⚠ Duplicate suspect</Badge>
                    : <Badge variant="neutral">No</Badge>}
                </td>
                <td className="py-2 pr-4 font-mono text-[11px] text-slate-500" data-testid={`ingestion-extractor-${r.id}`}>
                  {r.extractorVersion ?? '—'}
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(r.createdAt)}</td>
                <td className="py-2 pr-4">
                  <Btn
                    variant="secondary"
                    size="sm"
                    data-testid={`inspect-draft-${r.id}`}
                    onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}
                  >
                    {r.id === selectedId ? 'Hide' : 'Review'}
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Draft detail */}
      {draft && (
        <>
          <Card
            title="Draft detail"
            testId="ingestion-detail-card"
            actions={<StateBadge state={draft.state} testId="ingestion-detail-state" />}
          >
            {/* Duplicate warning — must be prominent */}
            {draft.isDuplicateSuspect && (
              <Banner kind="error" title="⚠ Duplicate suspect — do not accept without investigation" testId="duplicate-warning">
                <span className="text-[12.5px]">
                  This draft matches an existing invoice on vendor reference, invoice number, and amount (dedup key:{' '}
                  <code className="font-mono text-[11px]">{draft.dedupKey}</code>). The server will refuse acceptance
                  unless you explicitly check the override box below. Accepting a genuine duplicate causes a double
                  payment.
                </span>
              </Banner>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 mt-3">
              <KeyValue label="Channel" value={draft.channel} testId="detail-channel" />
              <KeyValue
                label="Overall confidence"
                value={
                  <span data-testid="detail-overall-confidence" className={Number(draft.overallConfidence) < 0.7 ? 'text-amber-600 font-semibold' : ''}>
                    {confidence(draft.overallConfidence)}
                    {Number(draft.overallConfidence) < 0.7 && ' — low confidence, scrutinise carefully'}
                  </span>
                }
              />
              <KeyValue label="Vendor match reference" value={draft.vendorMatchRef ?? '—'} testId="detail-vendor-ref" />
              <KeyValue label="PO match reference" value={draft.poMatchRef ?? '—'} testId="detail-po-ref" />
              <KeyValue label="Dedup key" value={<code className="font-mono text-[11px]">{draft.dedupKey ?? '—'}</code>} testId="detail-dedup-key" />
              <KeyValue label="Duplicate suspect" value={draft.isDuplicateSuspect ? '⚠ Yes' : 'No'} testId="detail-is-duplicate" />
              <KeyValue label="Extractor version" value={draft.extractorVersion ?? '—'} testId="detail-extractor-version" />
              <KeyValue label="Reviewed by" value={draft.reviewedBy ?? '—'} testId="detail-reviewed-by" />
              <KeyValue label="Reviewed at" value={dateTime(draft.reviewedAt)} testId="detail-reviewed-at" />
              {draft.s039InvoiceId && (
                <KeyValue
                  label="S039 AP invoice"
                  value={<code className="font-mono text-[11px]">{draft.s039InvoiceId}</code>}
                  testId="detail-s039-invoice"
                />
              )}
              {draft.sourceImageRef && (
                <KeyValue
                  label="Source image"
                  value={<a href={draft.sourceImageRef} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline text-[12px]" data-testid="detail-source-image">{draft.sourceImageRef}</a>}
                />
              )}
              {draft.ediTransactionRef && (
                <KeyValue label="EDI transaction ref" value={<code className="font-mono text-[11px]">{draft.ediTransactionRef}</code>} testId="detail-edi-ref" />
              )}
            </div>
          </Card>

          {/* Extracted fields with per-field confidence */}
          <Card title="Extracted fields with per-field confidence" testId="field-confidence-card">
            <p className="text-[12.5px] text-slate-600 mb-3">
              Each field below shows the confidence the extractor assigned to its own reading. A field the extractor
              was unsure about is shown in amber. The overall confidence is the lowest individual field — the
              document is only as trustworthy as the figure someone will actually pay against.
            </p>
            {Object.keys(extractedFields).length === 0 ? (
              <p data-testid="extracted-fields-empty" className="text-[13px] text-slate-500">No extracted fields recorded.</p>
            ) : (
              <Table headers={['Field', 'Extracted value', 'Confidence']} testId="extracted-fields-table">
                {Object.entries(extractedFields).map(([field, value]) => {
                  const conf = fieldConfidence[field];
                  const low = typeof conf === 'number' && conf < 0.7;
                  return (
                    <tr key={field} data-testid={`field-row-${field}`} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 font-mono text-[12px]">{field}</td>
                      <td className="py-2 pr-4 text-[13px]" data-testid={`field-value-${field}`}>{String(value ?? '—')}</td>
                      <td className="py-2 pr-4" data-testid={`field-confidence-${field}`}>
                        {conf !== undefined
                          ? <span className={low ? 'text-amber-600 font-semibold' : 'text-slate-700'}>{confidence(conf)}</span>
                          : <span className="text-slate-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>

          {/* Suggested coding */}
          {Object.keys(suggestedCoding).length > 0 && (
            <Card title="Suggested GL coding" testId="suggested-coding-card">
              <p className="text-[12.5px] text-slate-600 mb-3">
                These are the extractor's coding suggestions. They do not update the ledger — they are offered for the
                clerk to accept, adjust, or discard during the AP invoice creation step.
              </p>
              <Table headers={['Field', 'Suggested value']} testId="suggested-coding-table">
                {Object.entries(suggestedCoding).map(([field, value]) => (
                  <tr key={field} data-testid={`coding-row-${field}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 font-mono text-[12px]">{field}</td>
                    <td className="py-2 pr-4 text-[13px]">{String(value ?? '—')}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {/* Accept / Reject actions */}
          {(draft.state === 'CLERK_REVIEW' || draft.state === 'DUPLICATE' || draft.state === 'DRAFT') && (
            <Card title="Clerk review — accept or reject this draft" testId="clerk-review-card">
              <p className="text-[12.5px] text-slate-600 mb-4">
                You are acting as a clerk, not the automation service. Accepting this draft creates an S039 AP invoice
                through the normal AP path. Rejecting it records the reason and closes the draft — the ledger is
                not affected either way by this action alone.
              </p>

              {/* Accept form */}
              <div className="mb-5 p-4 bg-slate-50 border border-slate-200 rounded">
                <p className="text-[13px] font-semibold text-slate-800 mb-3">Accept</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  <label className="text-[12px] text-slate-600">
                    S039 AP Invoice ID (if already created; leave blank to create later)
                    <input
                      data-testid="accept-s039-invoice-id"
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                      value={acceptForm.s039InvoiceId}
                      onChange={(e) => setAcceptForm((f) => ({ ...f, s039InvoiceId: e.target.value }))}
                      placeholder="Optional invoice ID"
                    />
                  </label>
                </div>
                {draft.isDuplicateSuspect && (
                  <label className="flex items-center gap-2 text-[12.5px] text-amber-700 mb-3" data-testid="override-duplicate-label">
                    <input
                      type="checkbox"
                      data-testid="override-duplicate-checkbox"
                      checked={acceptForm.overrideDuplicate}
                      onChange={(e) => setAcceptForm((f) => ({ ...f, overrideDuplicate: e.target.checked }))}
                    />
                    I have verified this is not a duplicate and explicitly override the duplicate flag
                  </label>
                )}
                <Btn
                  variant="primary"
                  size="md"
                  data-testid="accept-draft-btn"
                  disabled={accept.isPending || (draft.isDuplicateSuspect && !acceptForm.overrideDuplicate)}
                  onClick={() => accept.mutate()}
                >
                  {accept.isPending ? 'Accepting…' : 'Accept draft'}
                </Btn>
                <div className="mt-2"><MutationError error={accept.error} testId="accept-draft-error" /></div>
              </div>

              {/* Reject form */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded">
                <p className="text-[13px] font-semibold text-slate-800 mb-3">Reject</p>
                <div className="flex items-end gap-3">
                  <label className="text-[12px] text-slate-600 flex-1">
                    Rejection reason *
                    <input
                      data-testid="reject-draft-reason"
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Why is this extraction being rejected?"
                    />
                  </label>
                  <Btn
                    variant="danger"
                    size="md"
                    data-testid="reject-draft-btn"
                    disabled={!rejectReason.trim() || reject.isPending}
                    onClick={() => reject.mutate()}
                  >
                    {reject.isPending ? 'Rejecting…' : 'Reject draft'}
                  </Btn>
                </div>
                <div className="mt-2"><MutationError error={reject.error} testId="reject-draft-error" /></div>
              </div>
            </Card>
          )}

          {draft.state === 'ACCEPTED' && (
            <Card title="Draft accepted" testId="accepted-notice-card">
              <p data-testid="accepted-notice" className="text-[13px] text-slate-600">
                This draft was accepted by <strong>{draft.reviewedBy}</strong> at {dateTime(draft.reviewedAt)}.
                {draft.s039InvoiceId
                  ? <> It has been linked to AP invoice <code className="font-mono text-[11px]">{draft.s039InvoiceId}</code>.</>
                  : ' No AP invoice ID was recorded at acceptance — link it through the AP workflow.'}
              </p>
            </Card>
          )}

          {draft.state === 'REJECTED' && (
            <Card title="Draft rejected" testId="rejected-notice-card">
              <p data-testid="rejected-notice" className="text-[13px] text-slate-600">
                Rejected by <strong>{draft.reviewedBy}</strong> at {dateTime(draft.reviewedAt)}.
              </p>
            </Card>
          )}
        </>
      )}
    </AutomationPage>
  );
}
