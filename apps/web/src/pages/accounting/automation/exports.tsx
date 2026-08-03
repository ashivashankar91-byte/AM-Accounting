/**
 * CE-17 S107 — NCM / NADA Composite Export.
 *
 * The composite export produces a FILE plus retained evidence. There is NO
 * live transmission to NCM or NADA from this system — a response is RECORDED
 * by a person, not received by the system. The export hash is what makes the
 * retained evidence verifiable: if the hash of the file on disk matches the
 * hash stored here, the retained evidence is intact. Generate → Approve →
 * Record response.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, StateBadge, Empty,
  dateTime, useLegalEntityFromQuery,
} from './shared';

export default function AutomationExports() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [exportTypeFilter, setExportTypeFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [responseNote, setResponseNote] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [genForm, setGenForm] = useState({
    exportType: 'NCM',
    formatProfileVersion: '',
    periodYear: String(currentYear),
    periodMonth: String(currentMonth),
  });

  const list = useQuery({
    queryKey: ['automation', 'exports', 'list', legalEntityId, exportTypeFilter, stateFilter],
    queryFn: () => automationApi.listExports({
      legalEntityId,
      exportType: exportTypeFilter || undefined,
      state: stateFilter || undefined,
    }),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'exports', 'detail', selectedId],
    queryFn: () => automationApi.getExport(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const baseline = useQuery({
    queryKey: ['automation', 'exports', 'baseline', legalEntityId],
    queryFn: () => automationApi.getExportBaselineStatus({ legalEntityId }),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const generate = useMutation({
    mutationFn: () => automationApi.generateExport({
      legalEntityId,
      exportType: genForm.exportType,
      formatProfileVersion: genForm.formatProfileVersion,
      periodYear: Number(genForm.periodYear),
      periodMonth: Number(genForm.periodMonth),
    }),
    onSuccess: () => {
      setShowGenerate(false);
      setGenForm({ exportType: 'NCM', formatProfileVersion: '', periodYear: String(currentYear), periodMonth: String(currentMonth) });
      invalidate();
    },
  });

  const approve = useMutation({
    mutationFn: (id: string) => automationApi.approveExport(id, {}),
    onSuccess: invalidate,
  });

  const recordResponse = useMutation({
    mutationFn: (id: string) => automationApi.recordExportResponse(id, { note: responseNote.trim() }),
    onSuccess: () => { setResponseNote(''); invalidate(); },
  });

  const rows: any[] = list.data?.items ?? [];
  const exp: any = detail.data ?? null;
  const bl: any = baseline.data ?? null;

  return (
    <AutomationPage
      title="Composite Export — NCM / NADA / Twenty Group"
      story="S107"
      subtitle="Generates a file and retained evidence — no live transmission. Responses are recorded by a person."
      testId="automation-exports"
      permission="automation.read"
      capabilityCode="S107_COMPOSITE_EXPORT"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="generate-export-toggle" onClick={() => setShowGenerate((v) => !v)}>
          Generate export
        </Btn>
      }
    >
      {/* ── Baseline status panel ─────────────────────────────────────────── */}
      <Card title="Export baseline status" testId="export-baseline-card">
        {baseline.isLoading ? (
          <p data-testid="export-baseline-loading" className="text-[13px] text-slate-500">Loading baseline status…</p>
        ) : baseline.error ? (
          <MutationError error={baseline.error} testId="export-baseline-error" />
        ) : !bl ? (
          <Empty testId="export-baseline-empty" title="No baseline status" message="No export baseline has been established for this legal entity." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <KeyValue label="Legal entity" value={bl.legalEntityId ?? '—'} testId="baseline-legal-entity" />
            <KeyValue label="Last export type" value={bl.lastExportType ?? '—'} testId="baseline-last-type" />
            <KeyValue label="Last period" value={bl.lastPeriodYear && bl.lastPeriodMonth ? `${bl.lastPeriodYear}-${String(bl.lastPeriodMonth).padStart(2, '0')}` : '—'} testId="baseline-last-period" />
            <KeyValue label="Last export hash" value={bl.lastExportHash ? <code className="text-[11px] break-all">{bl.lastExportHash}</code> : '—'} testId="baseline-last-hash" />
            <KeyValue label="Baseline established at" value={dateTime(bl.establishedAt)} testId="baseline-established-at" />
            <KeyValue label="Retention ref" value={bl.retentionRef ?? '—'} testId="baseline-retention-ref" />
          </div>
        )}
      </Card>

      {/* ── Generate panel ─────────────────────────────────────────────────── */}
      {showGenerate && (
        <Card title="Generate export" testId="generate-export-panel">
          <p className="text-[12.5px] text-slate-600 mb-3">
            Generates the export file and records the hash for retained evidence. There is NO live transmission to
            NCM or NADA — this system produces the file only. Once generated, a different person must approve
            before the export is considered authorised. When the OEM or group acknowledges the submission, a person
            records that response manually — the system does not receive it automatically.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="text-[12px] text-slate-600">
              Export type
              <select
                data-testid="gen-export-type"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={genForm.exportType}
                onChange={(e) => setGenForm((f) => ({ ...f, exportType: e.target.value }))}
              >
                <option value="NCM">NCM</option>
                <option value="NADA">NADA</option>
                <option value="TWENTY_GROUP">Twenty Group</option>
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              Format profile version
              <input
                data-testid="gen-format-version"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={genForm.formatProfileVersion}
                placeholder="e.g. 2024-v1"
                onChange={(e) => setGenForm((f) => ({ ...f, formatProfileVersion: e.target.value }))}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Period year
              <input
                data-testid="gen-period-year"
                type="number"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={genForm.periodYear}
                onChange={(e) => setGenForm((f) => ({ ...f, periodYear: e.target.value }))}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Period month
              <input
                data-testid="gen-period-month"
                type="number"
                min={1}
                max={12}
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={genForm.periodMonth}
                onChange={(e) => setGenForm((f) => ({ ...f, periodMonth: e.target.value }))}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Btn
              variant="primary"
              size="md"
              data-testid="generate-export-submit"
              disabled={generate.isPending || !genForm.formatProfileVersion}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? 'Generating…' : 'Generate'}
            </Btn>
            <Btn variant="secondary" size="md" data-testid="generate-export-cancel" onClick={() => setShowGenerate(false)}>
              Cancel
            </Btn>
          </div>
          <div className="mt-3"><MutationError error={generate.error} testId="generate-export-error" /></div>
        </Card>
      )}

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 mb-3">
        <label className="text-[12px] text-slate-600">
          Export type
          <select
            data-testid="exports-type-filter"
            className="ml-2 border border-slate-300 rounded px-2 py-1 text-[13px]"
            value={exportTypeFilter}
            onChange={(e) => setExportTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {['NCM', 'NADA', 'TWENTY_GROUP'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-[12px] text-slate-600">
          State
          <select
            data-testid="exports-state-filter"
            className="ml-2 border border-slate-300 rounded px-2 py-1 text-[13px]"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">All states</option>
            {['PENDING', 'GENERATED', 'APPROVED', 'SUBMITTED_EXPORT'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {/* ── Exports list ──────────────────────────────────────────────────── */}
      <Card title="Composite exports" testId="exports-list-card">
        {rows.length === 0 ? (
          <Empty
            testId="exports-list-empty"
            title="No exports"
            message={
              exportTypeFilter || stateFilter
                ? `No exports matching the selected filters. Exports are generated here and submitted manually — the system does not transmit to NCM or NADA.`
                : 'No composite exports have been generated yet. Use Generate export to produce the first one. The system creates the file and hash; submission to NCM or NADA is a manual action by a person.'
            }
          />
        ) : (
          <Table
            headers={['Type', 'Period', 'Format ver', 'File ref', 'Hash', 'Generated by', 'Approved by', 'State', '']}
            testId="exports-list-table"
          >
            {rows.map((r) => (
              <tr key={r.id} data-testid={`export-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4">
                  <Badge variant="neutral" data-testid={`export-type-${r.id}`}>{r.exportType}</Badge>
                </td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`export-period-${r.id}`}>
                  {r.periodYear}-{String(r.periodMonth).padStart(2, '0')}
                </td>
                <td className="py-2 pr-4 font-mono text-[11px]">{r.formatProfileVersion}</td>
                <td className="py-2 pr-4 font-mono text-[11px]" data-testid={`export-file-ref-${r.id}`}>{r.exportFileRef ?? '—'}</td>
                <td className="py-2 pr-4 font-mono text-[10px] text-slate-500 max-w-[100px] truncate" data-testid={`export-hash-${r.id}`} title={r.exportHash ?? ''}>
                  {r.exportHash ? r.exportHash.slice(0, 12) + '…' : '—'}
                </td>
                <td className="py-2 pr-4 text-[12px]">{r.generatedBy ?? '—'}</td>
                <td className="py-2 pr-4 text-[12px]">{r.approvedBy ?? '—'}</td>
                <td className="py-2 pr-4"><StateBadge state={r.state} testId={`export-state-${r.id}`} /></td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`export-inspect-${r.id}`} onClick={() => setSelectedId(r.id)}>
                    Inspect
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Export detail ─────────────────────────────────────────────────── */}
      {exp && (
        <Card
          title="Export detail"
          testId="export-detail-card"
          actions={<StateBadge state={exp.state} testId="export-detail-state" />}
        >
          <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-[12.5px] text-slate-700">
              <strong>No live transmission.</strong> This system produces the export file and retained evidence only.
              There is no automated connection to NCM, NADA, or any Twenty Group portal. When you receive an
              acknowledgement from the OEM or group, you record it here — the system does not receive it on your behalf.
              The <strong>export hash</strong> is what makes the retained evidence verifiable: if the hash of the file
              on disk matches the hash below, the evidence is intact.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <KeyValue label="Export type" value={exp.exportType} testId="detail-export-type" />
            <KeyValue label="Format profile version" value={exp.formatProfileVersion} testId="detail-format-version" />
            <KeyValue label="Period" value={`${exp.periodYear}-${String(exp.periodMonth).padStart(2, '0')}`} testId="detail-period" />
            <KeyValue label="Export file ref" value={exp.exportFileRef ?? '—'} testId="detail-file-ref" />
            <KeyValue
              label="Export hash (verifies retained evidence)"
              value={exp.exportHash ? <code className="text-[11px] break-all">{exp.exportHash}</code> : '—'}
              testId="detail-export-hash"
            />
            <KeyValue label="Generated by" value={exp.generatedBy ?? '—'} testId="detail-generated-by" />
            <KeyValue label="Approved by" value={exp.approvedBy ?? 'Not yet approved'} testId="detail-approved-by" />
            <KeyValue label="Approved at" value={dateTime(exp.approvedAt)} testId="detail-approved-at" />
            <KeyValue label="Retention ref" value={exp.retentionRef ?? '—'} testId="detail-retention-ref" />
          </div>

          {exp.responseRecord && (
            <div className="mt-4">
              <h3 className="text-[13px] font-semibold text-slate-700 mb-2">Recorded response</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                {Object.entries(exp.responseRecord as Record<string, unknown>).map(([k, v]) => (
                  <KeyValue key={k} label={k} value={String(v)} testId={`response-record-${k}`} />
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {exp.state === 'GENERATED' && (
              <div className="flex items-center gap-3">
                <Btn
                  variant="primary"
                  size="md"
                  data-testid="approve-export"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(exp.id)}
                >
                  {approve.isPending ? 'Approving…' : 'Approve export'}
                </Btn>
                <span className="text-[12px] text-slate-500">
                  You must be a different person than the one who generated this export.
                </span>
              </div>
            )}

            {(exp.state === 'APPROVED' || exp.state === 'SUBMITTED_EXPORT') && (
              <div className="flex items-end gap-2">
                <label className="text-[12px] text-slate-600 flex-1">
                  Record OEM / group response
                  <input
                    data-testid="record-response-note"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={responseNote}
                    placeholder="Acknowledgement reference, date, or confirmation details"
                    onChange={(e) => setResponseNote(e.target.value)}
                  />
                </label>
                <Btn
                  variant="primary"
                  size="md"
                  data-testid="record-response-submit"
                  disabled={!responseNote.trim() || recordResponse.isPending}
                  onClick={() => recordResponse.mutate(exp.id)}
                >
                  {recordResponse.isPending ? 'Recording…' : 'Record response'}
                </Btn>
              </div>
            )}

            <MutationError error={approve.error} testId="approve-export-error" />
            <MutationError error={recordResponse.error} testId="record-response-error" />
          </div>
        </Card>
      )}
    </AutomationPage>
  );
}
