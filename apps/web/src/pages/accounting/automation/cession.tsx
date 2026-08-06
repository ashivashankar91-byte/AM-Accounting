/**
 * CE-17 S096 — Reinsurance / DOWC Cession.
 *
 * The system NEVER derives or recalculates a cession. Every figure here is
 * exactly what the reinsurer / DOWC administrator stated on their statement.
 * The statementEvidenceRef beside every figure is the proof of that: a cession
 * without a source reference is not a cession at all. Ceiling is
 * EXECUTE_WITH_APPROVAL — nothing posts unattended.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, StateBadge, Empty,
  money, dateTime, useLegalEntityFromQuery,
} from './shared';

export default function AutomationCession() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;

  const [stateFilter, setStateFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showEnter, setShowEnter] = useState(false);

  // Enter-statement form state
  const [form, setForm] = useState({
    legalEntityId: legalEntityId ?? '',
    statementDate: '',
    programAdminRef: '',
    treatyCode: '',
    premiumCession: '',
    reserveCession: '',
    claimCession: '',
    statementEvidenceRef: '',
  });

  const list = useQuery({
    queryKey: ['automation', 'cession', 'statements', legalEntityId, stateFilter],
    queryFn: () => automationApi.listCessionStatements({ legalEntityId, state: stateFilter || undefined }),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'cession', 'statement', selectedId],
    queryFn: () => automationApi.getCessionStatement(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const position = useQuery({
    queryKey: ['automation', 'cession', 'position', legalEntityId],
    queryFn: () => automationApi.getCessionPosition({ legalEntityId }),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const enter = useMutation({
    mutationFn: () => automationApi.enterCessionStatement({ ...form }),
    onSuccess: () => { setShowEnter(false); setForm({ legalEntityId: legalEntityId ?? '', statementDate: '', programAdminRef: '', treatyCode: '', premiumCession: '', reserveCession: '', claimCession: '', statementEvidenceRef: '' }); invalidate(); },
  });

  const approve = useMutation({
    mutationFn: (id: string) => automationApi.approveCessionStatement(id, {}),
    onSuccess: invalidate,
  });

  const rows: any[] = list.data?.items ?? [];
  const stmt: any = detail.data ?? null;
  const pos: any = position.data ?? null;

  return (
    <AutomationPage
      title="Cession — Reinsurance / DOWC"
      story="S096"
      subtitle="Statement figures only — the system never derives or recalculates a cession"
      testId="automation-cession"
      permission="automation.read"
      capabilityCode="S096_CESSION"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="enter-statement-toggle" onClick={() => setShowEnter((v) => !v)}>
          Enter statement
        </Btn>
      }
    >
      {/* ── Treaty position panel ─────────────────────────────────────────── */}
      <Card title="Treaty position" testId="cession-position-card">
        {position.isLoading ? (
          <p data-testid="cession-position-loading" className="text-[13px] text-slate-500">Loading position…</p>
        ) : position.error ? (
          <MutationError error={position.error} testId="cession-position-error" />
        ) : !pos ? (
          <Empty testId="cession-position-empty" title="No position data" message="No treaty position has been recorded for this legal entity and treaty." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <KeyValue label="Legal entity" value={pos.legalEntityId ?? '—'} testId="position-legal-entity" />
            <KeyValue label="Treaty code" value={pos.treatyCode ?? '—'} testId="position-treaty-code" />
            <KeyValue label="Cumulative premium ceded" value={money(pos.cumulativePremiumCession)} testId="position-cumulative-premium" />
            <KeyValue label="Cumulative reserve ceded" value={money(pos.cumulativeReserveCession)} testId="position-cumulative-reserve" />
            <KeyValue label="Cumulative claims ceded" value={money(pos.cumulativeClaimCession)} testId="position-cumulative-claims" />
            <KeyValue label="Last posting item" value={pos.lastPostingItemId ?? '—'} testId="position-last-posting-item" />
            <KeyValue label="Position tracking ref" value={pos.positionTrackingRef ?? '—'} testId="position-tracking-ref" />
            <KeyValue label="As of" value={dateTime(pos.asOf)} testId="position-as-of" />
          </div>
        )}
      </Card>

      {/* ── Enter statement form ───────────────────────────────────────────── */}
      {showEnter && (
        <Card title="Enter cession statement" testId="enter-statement-panel">
          <p className="text-[12.5px] text-slate-600 mb-3">
            All figures are taken verbatim from the reinsurer or DOWC administrator's statement. The system does not
            compute, derive, or adjust them. Provide the statement evidence reference so the figures can be traced back
            to their source. EXECUTE_WITH_APPROVAL: this statement will not post until a different person approves it.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {[
              { key: 'legalEntityId', label: 'Legal entity ID', placeholder: 'LE-0001', testId: 'enter-legal-entity' },
              { key: 'statementDate', label: 'Statement date', placeholder: 'YYYY-MM-DD', testId: 'enter-statement-date', type: 'date' },
              { key: 'programAdminRef', label: 'Program admin ref', placeholder: 'PAR-0001', testId: 'enter-program-admin-ref' },
              { key: 'treatyCode', label: 'Treaty code', placeholder: 'TRY-001', testId: 'enter-treaty-code' },
              { key: 'premiumCession', label: 'Premium cession (as stated)', placeholder: '0.00', testId: 'enter-premium-cession' },
              { key: 'reserveCession', label: 'Reserve cession (as stated)', placeholder: '0.00', testId: 'enter-reserve-cession' },
              { key: 'claimCession', label: 'Claim cession (as stated)', placeholder: '0.00', testId: 'enter-claim-cession' },
              { key: 'statementEvidenceRef', label: 'Statement evidence ref', placeholder: 'EVD-001', testId: 'enter-statement-evidence-ref' },
            ].map(({ key, label, placeholder, testId: tid, type }) => (
              <label key={key} className="text-[12px] text-slate-600">
                {label}
                <input
                  data-testid={tid}
                  type={type ?? 'text'}
                  className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                  value={(form as any)[key]}
                  placeholder={placeholder}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Btn
              variant="primary"
              size="md"
              data-testid="enter-statement-submit"
              disabled={enter.isPending || !form.statementDate || !form.treatyCode || !form.statementEvidenceRef}
              onClick={() => enter.mutate()}
            >
              {enter.isPending ? 'Entering…' : 'Enter statement'}
            </Btn>
            <Btn variant="secondary" size="md" data-testid="enter-statement-cancel" onClick={() => setShowEnter(false)}>
              Cancel
            </Btn>
          </div>
          <div className="mt-3"><MutationError error={enter.error} testId="enter-statement-error" /></div>
        </Card>
      )}

      {/* ── Statement list ─────────────────────────────────────────────────── */}
      <Card
        title="Cession statements"
        testId="cession-list-card"
        actions={
          <select
            data-testid="cession-state-filter"
            className="border border-slate-300 rounded px-2 py-1 text-[13px]"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">All states</option>
            {['ENTERED', 'APPROVED', 'POSTED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        }
      >
        {rows.length === 0 ? (
          <Empty
            testId="cession-list-empty"
            title="No cession statements"
            message={
              stateFilter
                ? `No cession statements with state ${stateFilter}. Statements are entered directly from the reinsurer or DOWC administrator's paper statement.`
                : 'No cession statements have been entered yet. Enter a statement from the reinsurer or DOWC administrator — the system does not generate figures on its own.'
            }
          />
        ) : (
          <Table
            headers={['Treaty', 'Stmt date', 'Premium ceded', 'Reserve ceded', 'Claims ceded', 'Evidence ref', 'State', '']}
            testId="cession-list-table"
          >
            {rows.map((r) => (
              <tr key={r.id} data-testid={`cession-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`cession-treaty-${r.id}`}>{r.treatyCode}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`cession-date-${r.id}`}>{r.statementDate ? new Date(r.statementDate).toLocaleDateString() : '—'}</td>
                <td className="py-2 pr-4 tabular-nums" data-testid={`cession-premium-${r.id}`}>{money(r.premiumCession)}</td>
                <td className="py-2 pr-4 tabular-nums" data-testid={`cession-reserve-${r.id}`}>{money(r.reserveCession)}</td>
                <td className="py-2 pr-4 tabular-nums" data-testid={`cession-claim-${r.id}`}>{money(r.claimCession)}</td>
                <td className="py-2 pr-4 font-mono text-[11px]" data-testid={`cession-evidence-${r.id}`}>{r.statementEvidenceRef}</td>
                <td className="py-2 pr-4">
                  <StateBadge state={r.state} testId={`cession-state-${r.id}`} />
                </td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`cession-inspect-${r.id}`} onClick={() => setSelectedId(r.id)}>
                    Inspect
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Statement detail ───────────────────────────────────────────────── */}
      {stmt && (
        <Card
          title="Statement detail"
          testId="cession-detail-card"
          actions={<StateBadge state={stmt.state} testId="cession-detail-state" />}
        >
          <p className="text-[12.5px] text-slate-500 mb-3">
            These figures are the reinsurer's or DOWC administrator's own numbers, recorded verbatim.
            The statement evidence reference is the proof that they came from a paper statement, not a
            system derivation. EXECUTE_WITH_APPROVAL: a different person must approve before anything posts.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <KeyValue label="Statement date" value={stmt.statementDate ? new Date(stmt.statementDate).toLocaleDateString() : '—'} testId="detail-statement-date" />
            <KeyValue label="Program admin ref" value={stmt.programAdminRef} testId="detail-program-admin-ref" />
            <KeyValue label="Treaty code" value={stmt.treatyCode} testId="detail-treaty-code" />
            <KeyValue label="Statement evidence ref" value={<code className="text-[11px]">{stmt.statementEvidenceRef}</code>} testId="detail-evidence-ref" />
            <KeyValue label="Premium cession (as stated)" value={money(stmt.premiumCession)} testId="detail-premium-cession" />
            <KeyValue label="Reserve cession (as stated)" value={money(stmt.reserveCession)} testId="detail-reserve-cession" />
            <KeyValue label="Claim cession (as stated)" value={money(stmt.claimCession)} testId="detail-claim-cession" />
            <KeyValue label="Approved by" value={stmt.approvedBy ?? 'Not yet approved'} testId="detail-approved-by" />
            <KeyValue label="Approved at" value={dateTime(stmt.approvedAt)} testId="detail-approved-at" />
            <KeyValue label="Posting item" value={stmt.postingItemId ?? '—'} testId="detail-posting-item" />
            <KeyValue label="Position tracking ref" value={stmt.positionTrackingRef ?? '—'} testId="detail-position-tracking-ref" />
          </div>

          {stmt.state === 'ENTERED' && (
            <div className="mt-4 flex items-center gap-3">
              <Btn
                variant="primary"
                size="md"
                data-testid="approve-cession"
                disabled={approve.isPending}
                onClick={() => approve.mutate(stmt.id)}
              >
                {approve.isPending ? 'Approving…' : 'Approve statement'}
              </Btn>
              <span className="text-[12px] text-slate-500">
                Approving posts the figures as-stated. You must be a different person than the one who entered this statement.
              </span>
            </div>
          )}

          <div className="mt-3"><MutationError error={approve.error} testId="approve-cession-error" /></div>
        </Card>
      )}
    </AutomationPage>
  );
}
