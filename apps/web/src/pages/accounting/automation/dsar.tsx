/**
 * CE-17 S126 DSAR Automation.
 *
 * Three facts that must never be ambiguous on this page:
 *
 * 1. DSAR ERASURE IS IRREVERSIBLE. Once erasure executes, the record of the
 *    subject's PII is gone. There is no undo.
 *
 * 2. DUAL AUTHORIZATION REQUIRED. Two different, named people must independently
 *    authorize every erasure. The automation cannot be one of them. The execute
 *    button is disabled until both authorizations are recorded.
 *
 * 3. FINANCIAL INTEGRITY IS PRESERVED. Records required for financial reporting
 *    are redacted under a legal basis or retained under statutory authority —
 *    they are never silently deleted. The financial-integrity proof record is
 *    rendered on every case.
 *
 * The system can never run erasure unattended at any authority level.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, Empty, StateBadge,
  dateTime,
} from './shared';

const DSAR_STATES = [
  'INTAKE', 'SCANNING', 'DISCLOSURE_READY', 'ERASURE_PENDING_APPROVAL', 'ERASED', 'CLOSED',
];

const REQUEST_TYPES = ['DISCLOSURE', 'ERASURE', 'BOTH'];

export default function AutomationDsar() {
  const qc = useQueryClient();

  const [stateFilter, setStateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createSubject, setCreateSubject] = useState('');
  const [createType, setCreateType] = useState<string>('DISCLOSURE');
  const [createEvidence, setCreateEvidence] = useState('');

  // Authorize erasure
  const [showAuthorize, setShowAuthorize] = useState(false);
  const [authNote, setAuthNote] = useState('');

  // Execute erasure
  const [executeConfirm, setExecuteConfirm] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const list = useQuery({
    queryKey: ['automation', 'dsar', stateFilter, typeFilter],
    queryFn: () => automationApi.listDsarCases({ state: stateFilter || undefined, requestType: typeFilter || undefined }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'dsar-case', selectedId],
    queryFn: () => automationApi.getDsarCase(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => automationApi.createDsarCase({
      subjectIdentifier: createSubject,
      requestType: createType,
      verificationEvidence: createEvidence ? { note: createEvidence } : {},
    }),
    onSuccess: () => { setShowCreate(false); invalidate(); },
  });

  const scan = useMutation({
    mutationFn: (id: string) => automationApi.scanDsarCase(id),
    onSuccess: invalidate,
  });

  const disclosure = useMutation({
    mutationFn: (id: string) => automationApi.produceDsarDisclosure(id),
    onSuccess: invalidate,
  });

  const authorize = useMutation({
    mutationFn: (id: string) => automationApi.authorizeDsarErasure(id, { note: authNote }),
    onSuccess: () => { setShowAuthorize(false); setAuthNote(''); invalidate(); },
  });

  const executeErasure = useMutation({
    mutationFn: (id: string) => automationApi.executeDsarErasure(id, { confirmPhrase: executeConfirm }),
    onSuccess: () => { setExecuteConfirm(''); invalidate(); },
  });

  const close = useMutation({
    mutationFn: (id: string) => automationApi.closeDsarCase(id),
    onSuccess: invalidate,
  });

  const rows: any[] = list.data?.items ?? [];
  const kase: any = detail.data ?? null;
  const scanResult: any = kase?.scanResult ?? {};
  const fiProof: any = kase?.financialIntegrityProof ?? {};

  // Both authorizations must be recorded before erasure is permitted.
  const bothAuthorized = Boolean(kase?.erasureApproval1By && kase?.erasureApproval2By);

  return (
    <AutomationPage
      title="DSAR Automation"
      story="S126"
      subtitle="Dual-authorization, irreversible erasure that preserves financial integrity. Never unattended."
      testId="automation-dsar"
      permission="automation.read"
      capabilityCode="S126_DSAR"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="create-dsar-btn" onClick={() => setShowCreate((v) => !v)}>
          New DSAR case
        </Btn>
      }
    >
      {/* Three permanent notices — these must never be hidden */}
      <div className="mb-4 space-y-2">
        <div
          data-testid="dsar-irreversible-notice"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900"
        >
          <strong>⚠ Erasure is irreversible.</strong> Once erasure executes, the subject's PII is permanently removed.
          There is no reversal, no undo, and no recovery path. Verify both authorizations and the financial-integrity
          proof before executing.
        </div>
        <div
          data-testid="dsar-dual-auth-notice"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"
        >
          <strong>Dual authorization required.</strong> Two different, named human authorizers must independently
          approve every erasure. The automation identity cannot be one of them. The execute-erasure action is
          disabled until both authorizations are recorded.
        </div>
        <div
          data-testid="dsar-financial-integrity-notice"
          className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-900"
        >
          <strong>Financial integrity is preserved.</strong> Records required for financial reporting are redacted
          under a legal basis or retained under statutory authority. They are never silently deleted. The
          financial-integrity proof record is displayed on every case.
        </div>
      </div>

      {showCreate && (
        <Card title="Open a new DSAR case" testId="create-dsar-panel">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <label className="text-[12px] text-slate-600">
              Subject identifier
              <input
                data-testid="create-dsar-subject"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={createSubject}
                onChange={(e) => setCreateSubject(e.target.value)}
                placeholder="Email, customer ID, or national ID"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Request type
              <select
                data-testid="create-dsar-type"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={createType}
                onChange={(e) => setCreateType(e.target.value)}
              >
                {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-slate-600 md:col-span-2">
              Verification evidence (optional note)
              <input
                data-testid="create-dsar-evidence"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={createEvidence}
                onChange={(e) => setCreateEvidence(e.target.value)}
                placeholder="How the subject's identity was verified"
              />
            </label>
          </div>
          <Btn
            variant="primary"
            size="md"
            data-testid="create-dsar-confirm"
            disabled={!createSubject.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Opening…' : 'Open case'}
          </Btn>
          <MutationError error={create.error} testId="create-dsar-error" />
        </Card>
      )}

      <Card
        title="DSAR cases"
        testId="dsar-cases-card"
        actions={
          <div className="flex gap-2">
            <select
              data-testid="dsar-state-filter"
              className="border border-slate-300 rounded px-2 py-1 text-[13px]"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="">All states</option>
              {DSAR_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              data-testid="dsar-type-filter"
              className="border border-slate-300 rounded px-2 py-1 text-[13px]"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">All types</option>
              {REQUEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty
            testId="dsar-cases-empty"
            title="No DSAR cases found"
            message="No Data Subject Access Request cases match the current filters. Cases are opened when a data subject submits a formal request under applicable privacy law."
          />
        ) : (
          <Table
            headers={['Subject', 'Type', 'State', 'Deadline', 'Auth 1', 'Auth 2', 'Created', '']}
            testId="dsar-cases-table"
          >
            {rows.map((r: any) => (
              <tr key={r.id} data-testid={`dsar-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 text-[12px] font-mono" data-testid={`dsar-subject-${r.id}`}>{r.subjectIdentifier}</td>
                <td className="py-2 pr-4">
                  <Badge variant="neutral" data-testid={`dsar-type-${r.id}`}>{r.requestType}</Badge>
                </td>
                <td className="py-2 pr-4">
                  <StateBadge state={r.state} testId={`dsar-state-${r.id}`} />
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-500" data-testid={`dsar-deadline-${r.id}`}>
                  {dateTime(r.statutoryDeadline)}
                </td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`dsar-auth1-${r.id}`}>
                  {r.erasureApproval1By
                    ? <Badge variant="success">{r.erasureApproval1By}</Badge>
                    : <Badge variant="neutral">Pending</Badge>}
                </td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`dsar-auth2-${r.id}`}>
                  {r.erasureApproval2By
                    ? <Badge variant="success">{r.erasureApproval2By}</Badge>
                    : <Badge variant="neutral">Pending</Badge>}
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(r.createdAt)}</td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`inspect-dsar-${r.id}`} onClick={() => setSelectedId(r.id)}>
                    Open
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {kase && (
        <>
          <Card title="Case" testId="dsar-case-detail" actions={<StateBadge state={kase.state} testId="dsar-detail-state" />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 mb-4">
              <KeyValue label="Subject identifier" value={kase.subjectIdentifier} testId="dsar-detail-subject" />
              <KeyValue label="Request type" value={kase.requestType} testId="dsar-detail-type" />
              <KeyValue label="Statutory deadline" value={dateTime(kase.statutoryDeadline)} testId="dsar-detail-deadline" />
              <KeyValue label="Disclosure package" value={kase.disclosurePackageRef ?? '—'} testId="dsar-detail-disclosure-ref" />
              <KeyValue label="S017 shred event" value={kase.s017ShredEventRef ?? '—'} testId="dsar-detail-shred-ref" />
              <KeyValue label="Closed at" value={dateTime(kase.closedAt)} testId="dsar-detail-closed-at" />
            </div>

            {/* Dual authorization status — rendered prominently */}
            <div
              data-testid="dsar-dual-auth-status"
              className={[
                'rounded-lg border px-4 py-3 mb-4',
                bothAuthorized ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50',
              ].join(' ')}
            >
              <p className={`text-[13px] font-semibold mb-2 ${bothAuthorized ? 'text-green-900' : 'text-amber-900'}`}>
                Dual authorization — {bothAuthorized ? 'both authorizations recorded' : 'waiting for authorizations'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div data-testid="dsar-auth1-block">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">First authorizer</p>
                  {kase.erasureApproval1By ? (
                    <>
                      <p className="text-[13px] font-semibold text-slate-900" data-testid="dsar-auth1-by">{kase.erasureApproval1By}</p>
                      <p className="text-[12px] text-slate-500" data-testid="dsar-auth1-at">{dateTime(kase.erasureApproval1At)}</p>
                    </>
                  ) : (
                    <Badge variant="neutral" data-testid="dsar-auth1-pending">Not yet authorized</Badge>
                  )}
                </div>
                <div data-testid="dsar-auth2-block">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">Second authorizer (must be a different person)</p>
                  {kase.erasureApproval2By ? (
                    <>
                      <p className="text-[13px] font-semibold text-slate-900" data-testid="dsar-auth2-by">{kase.erasureApproval2By}</p>
                      <p className="text-[12px] text-slate-500" data-testid="dsar-auth2-at">{dateTime(kase.erasureApproval2At)}</p>
                    </>
                  ) : (
                    <Badge variant="neutral" data-testid="dsar-auth2-pending">Not yet authorized</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Lifecycle actions */}
            <div className="flex flex-wrap gap-2 mb-4">
              <Btn
                variant="secondary"
                size="md"
                data-testid="scan-dsar-btn"
                disabled={scan.isPending || kase.state !== 'INTAKE'}
                onClick={() => scan.mutate(kase.id)}
              >
                {scan.isPending ? 'Scanning…' : 'Scan'}
              </Btn>
              <Btn
                variant="secondary"
                size="md"
                data-testid="disclose-dsar-btn"
                disabled={disclosure.isPending || kase.state !== 'SCANNING'}
                onClick={() => disclosure.mutate(kase.id)}
              >
                {disclosure.isPending ? 'Preparing…' : 'Produce disclosure'}
              </Btn>
              <Btn
                variant="secondary"
                size="md"
                data-testid="authorize-erasure-btn"
                disabled={authorize.isPending || kase.state === 'ERASED' || kase.state === 'CLOSED'}
                onClick={() => setShowAuthorize((v) => !v)}
              >
                Authorize erasure
              </Btn>
              <Btn
                variant="secondary"
                size="md"
                data-testid="close-dsar-btn"
                disabled={close.isPending || kase.state === 'CLOSED'}
                onClick={() => close.mutate(kase.id)}
              >
                {close.isPending ? 'Closing…' : 'Close case'}
              </Btn>
            </div>

            {/* Authorize erasure sub-form */}
            {showAuthorize && (
              <div className="border border-amber-300 rounded-lg p-4 mb-4 bg-amber-50" data-testid="authorize-erasure-panel">
                <p className="text-[12.5px] text-amber-900 font-semibold mb-2">
                  You are recording your authorization for erasure. A second, different person must also authorize
                  before the execute button becomes available.
                </p>
                <div className="flex items-end gap-3">
                  <label className="text-[12px] text-slate-600 flex-1">
                    Authorization note
                    <input
                      data-testid="authorize-erasure-note"
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                      value={authNote}
                      onChange={(e) => setAuthNote(e.target.value)}
                      placeholder="Why you are authorizing this erasure"
                    />
                  </label>
                  <Btn
                    variant="secondary"
                    size="md"
                    data-testid="authorize-erasure-confirm"
                    disabled={!authNote.trim() || authorize.isPending}
                    onClick={() => authorize.mutate(kase.id)}
                  >
                    {authorize.isPending ? 'Recording…' : 'Record my authorization'}
                  </Btn>
                </div>
                <MutationError error={authorize.error} testId="authorize-erasure-error" />
              </div>
            )}

            {/* Execute erasure — visually distinct, hard-blocked until both authorizations exist */}
            <div
              data-testid="execute-erasure-panel"
              className={[
                'border-2 rounded-lg p-4 mb-4',
                bothAuthorized ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-slate-50 opacity-60',
              ].join(' ')}
            >
              <p className="text-[13px] font-bold text-red-800 mb-1" data-testid="execute-erasure-heading">
                ⚠ Execute erasure — IRREVERSIBLE
              </p>
              {!bothAuthorized && (
                <p className="text-[12px] text-slate-600 mb-2" data-testid="execute-erasure-blocked-msg">
                  Disabled. Both authorizations must be recorded before erasure can execute. The automation
                  cannot be one of the two authorizers.
                </p>
              )}
              {bothAuthorized && (
                <>
                  <p className="text-[12.5px] text-red-900 mb-2">
                    Both authorizations are recorded. Type <strong>ERASE</strong> to confirm. This action cannot be
                    undone. Financial records are preserved per the integrity proof below.
                  </p>
                  <div className="flex items-end gap-3">
                    <label className="text-[12px] text-slate-600 flex-1">
                      Confirm phrase
                      <input
                        data-testid="execute-erasure-confirm-input"
                        className="mt-1 w-full border border-red-400 rounded px-2 py-1.5 text-[13px]"
                        value={executeConfirm}
                        onChange={(e) => setExecuteConfirm(e.target.value)}
                        placeholder="Type ERASE"
                      />
                    </label>
                    <Btn
                      variant="danger"
                      size="md"
                      data-testid="execute-erasure-btn"
                      disabled={executeConfirm !== 'ERASE' || executeErasure.isPending || kase.state === 'ERASED'}
                      onClick={() => executeErasure.mutate(kase.id)}
                    >
                      {executeErasure.isPending ? 'Executing…' : 'Execute erasure'}
                    </Btn>
                  </div>
                  <MutationError error={executeErasure.error} testId="execute-erasure-error" />
                </>
              )}
            </div>

            <div className="space-y-2">
              <MutationError error={scan.error} testId="scan-dsar-error" />
              <MutationError error={disclosure.error} testId="disclose-dsar-error" />
              <MutationError error={close.error} testId="close-dsar-error" />
            </div>
          </Card>

          {/* Scan result */}
          <Card title="PII scan result" testId="dsar-scan-result-card">
            {Object.keys(scanResult).length === 0 ? (
              <Empty
                testId="dsar-scan-empty"
                title="No scan result recorded"
                message="The case has not been scanned yet, or the scan produced no PII location records."
              />
            ) : (
              <pre
                data-testid="dsar-scan-result-body"
                className="text-[12px] font-mono text-slate-700 whitespace-pre-wrap break-all"
              >
                {JSON.stringify(scanResult, null, 2)}
              </pre>
            )}
          </Card>

          {/* Financial integrity proof — always rendered */}
          <Card title="Financial integrity preservation record" testId="dsar-fi-proof-card">
            <p className="text-[12.5px] text-slate-600 mb-3" data-testid="dsar-fi-notice">
              Records required for financial reporting are never silently deleted. Each is either redacted under a
              documented legal basis or retained under statutory authority. This record is generated before erasure
              executes and is immutable after that point.
            </p>
            {Object.keys(fiProof).length === 0 ? (
              <Empty
                testId="dsar-fi-proof-empty"
                title="Financial integrity proof not yet generated"
                message="The financial integrity proof is generated during the disclosure step and is immutable once erasure executes."
              />
            ) : (
              <pre
                data-testid="dsar-fi-proof-body"
                className="text-[12px] font-mono text-slate-700 whitespace-pre-wrap break-all"
              >
                {JSON.stringify(fiProof, null, 2)}
              </pre>
            )}
          </Card>
        </>
      )}
    </AutomationPage>
  );
}
