/**
 * CE-17 S095 — retro / portfolio reserve accrual.
 *
 * The ceiling is EXECUTE_WITH_APPROVAL. The workflow is linear and
 * unambiguous: Enter → Allocate (preview) → Approve. Nothing is posted until
 * the approve step, and the allocation step is labelled throughout as a
 * preview that has posted nothing.
 *
 * The evidence reference is the authoritative link to the source document —
 * it is required on entry and displayed prominently. The allocation basis is
 * configuration-defined: the service will not invent one, and a statement
 * stays in ENTERED if no basis is supplied.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, StateBadge, Empty, money, dateTime,
} from './shared';

export default function AutomationPortfolio() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const [stateFilter, setStateFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showEnterForm, setShowEnterForm] = useState(false);
  const [showApproveForm, setShowApproveForm] = useState(false);

  // Enter form
  const [statementDate, setStatementDate] = useState('');
  const [lenderRef, setLenderRef] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');
  const [allocationBasis, setAllocationBasis] = useState('');
  const [enterActor, setEnterActor] = useState('');

  // Approve form
  const [approver, setApprover] = useState('');
  const [reserveAccountCode, setReserveAccountCode] = useState('');
  const [offsetAccountCode, setOffsetAccountCode] = useState('');

  const list = useQuery({
    queryKey: ['automation', 'portfolio', 'statements', stateFilter],
    queryFn: () => automationApi.listPortfolioStatements(stateFilter ? { state: stateFilter } : {}),
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'portfolio', 'statement', selectedId],
    queryFn: () => automationApi.getPortfolioStatement(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const enterStatement = useMutation({
    mutationFn: (data: any) => automationApi.enterPortfolioStatement(data),
    onSuccess: () => {
      setShowEnterForm(false);
      setStatementDate(''); setLenderRef(''); setTotalAmount('');
      setEvidenceRef(''); setAllocationBasis(''); setEnterActor('');
      invalidate();
    },
  });

  const allocate = useMutation({
    mutationFn: (id: string) => automationApi.allocatePortfolioStatement(id),
    onSuccess: invalidate,
  });

  const approveStatement = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      automationApi.approvePortfolioStatement(id, data),
    onSuccess: () => {
      setShowApproveForm(false);
      setApprover(''); setReserveAccountCode(''); setOffsetAccountCode('');
      invalidate();
    },
  });

  const rows: any[] = list.data?.items ?? [];
  const item: any = detail.data ?? null;
  const allocations: any[] = (item?.allocations as any)?.lines ?? [];

  return (
    <AutomationPage
      title="Portfolio Reserve Accrual"
      story="S095"
      subtitle="Enter → Allocate (preview) → Approve — nothing is posted until the approve step"
      testId="automation-portfolio"
      permission="automation.read"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="secondary" size="md" data-testid="enter-statement-toggle" onClick={() => setShowEnterForm((v) => !v)}>
          {showEnterForm ? 'Cancel' : 'Enter statement'}
        </Btn>
      }
    >
      <Card title="Authority ceiling: EXECUTE_WITH_APPROVAL — preview-then-approve, never unattended" testId="portfolio-authority-notice">
        <p className="text-[12.5px] text-slate-600 leading-relaxed">
          Portfolio reserve accrual is <strong>EXECUTE_WITH_APPROVAL</strong>. The allocation step produces a preview
          that distributes the statement total across deals; this preview has posted nothing. Only the approve step,
          performed by a person, creates the automation item that travels through the CE-07 governed posting path.
          The approver's identity is recorded on the statement and the posting item.
        </p>
        <p className="text-[12.5px] text-slate-600 leading-relaxed mt-2">
          The <strong>evidence reference</strong> is the authoritative link to the lender's source document. It is
          required on entry and displayed prominently — there is no portfolio reserve without a source. The{' '}
          <strong>allocation basis</strong> is configuration-defined: if no basis has been configured, the statement
          stays in ENTERED and the allocate step will refuse.
        </p>
      </Card>

      {showEnterForm && (
        <Card title="Enter portfolio statement" testId="enter-statement-form">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <label className="text-[12px] text-slate-600">
              Statement date *
              <input
                data-testid="enter-statement-date"
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={statementDate}
                onChange={(e) => setStatementDate(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Lender reference *
              <input
                data-testid="enter-lender-ref"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={lenderRef}
                onChange={(e) => setLenderRef(e.target.value)}
                placeholder="ALLY-STMT-2024-12"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Total amount *
              <input
                data-testid="enter-total-amount"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="125000.00"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Evidence reference * (link to source document)
              <input
                data-testid="enter-evidence-ref"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={evidenceRef}
                onChange={(e) => setEvidenceRef(e.target.value)}
                placeholder="DOC-ALLY-RES-2024-12 / S3://bucket/path/to/stmt.pdf"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Allocation basis * (must be a configured value)
              <input
                data-testid="enter-allocation-basis"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={allocationBasis}
                onChange={(e) => setAllocationBasis(e.target.value)}
                placeholder="ORIGINATED_AMOUNT"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Actor *
              <input
                data-testid="enter-actor"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={enterActor}
                onChange={(e) => setEnterActor(e.target.value)}
                placeholder="accountant@dealership.com"
              />
            </label>
          </div>
          <Btn
            variant="primary"
            size="md"
            data-testid="enter-statement-submit"
            disabled={
              !statementDate || !lenderRef.trim() || !totalAmount.trim() ||
              !evidenceRef.trim() || !allocationBasis.trim() || !enterActor.trim() ||
              enterStatement.isPending
            }
            onClick={() =>
              enterStatement.mutate({
                statementDate, lenderRef: lenderRef.trim(),
                totalAmount: totalAmount.trim(), evidenceRef: evidenceRef.trim(),
                allocationBasis: allocationBasis.trim(), actor: enterActor.trim(),
              })
            }
          >
            {enterStatement.isPending ? 'Entering…' : 'Enter statement'}
          </Btn>
          <div className="mt-3"><MutationError error={enterStatement.error} testId="enter-statement-error" /></div>
        </Card>
      )}

      <Card
        title="Portfolio statements"
        testId="portfolio-statements-card"
        actions={
          <select
            data-testid="statement-state-filter"
            className="border border-slate-300 rounded px-2 py-1 text-[13px]"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
          >
            <option value="">All states</option>
            {['ENTERED', 'ALLOCATED', 'APPROVED', 'POSTED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        }
      >
        {rows.length === 0 ? (
          <Empty
            testId="portfolio-statements-empty"
            title={stateFilter ? `No statements in state ${stateFilter}` : 'No portfolio statements yet'}
            message={
              stateFilter
                ? 'Change the state filter to see statements in other states.'
                : 'Enter a statement to begin. A statement stays in ENTERED until the allocate step produces a preview.'
            }
          />
        ) : (
          <Table
            headers={['Lender ref', 'Statement date', 'State', 'Total amount', 'Evidence ref', 'Allocation basis', 'Approved by', 'Posting item', '']}
            testId="portfolio-statements-table"
          >
            {rows.map((r) => (
              <tr
                key={r.id}
                data-testid={`statement-row-${r.id}`}
                className={[
                  'border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50',
                  selectedId === r.id ? 'bg-blue-50' : '',
                ].join(' ')}
                onClick={() => { setSelectedId(r.id); setShowApproveForm(false); }}
              >
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`statement-lender-${r.id}`}>{r.lenderRef}</td>
                <td className="py-2 pr-4 tabular-nums">{r.statementDate ? new Date(r.statementDate).toLocaleDateString() : '—'}</td>
                <td className="py-2 pr-4"><StateBadge state={r.state} testId={`statement-state-${r.id}`} /></td>
                <td className="py-2 pr-4 tabular-nums font-mono font-semibold" data-testid={`statement-amount-${r.id}`}>{money(r.totalAmount)}</td>
                <td className="py-2 pr-4 font-mono text-[11px] text-slate-500 max-w-[160px] truncate" data-testid={`statement-evidence-${r.id}`} title={r.evidenceRef}>
                  {r.evidenceRef}
                </td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`statement-basis-${r.id}`}>{r.allocationBasis}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`statement-approved-by-${r.id}`}>{r.approvedBy ?? '—'}</td>
                <td className="py-2 pr-4 font-mono text-[11px]" data-testid={`statement-posting-item-${r.id}`}>{r.postingItemId ?? '—'}</td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`inspect-statement-${r.id}`} onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); }}>
                    Inspect
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {item && (
        <>
          <Card
            title="Statement detail"
            testId="statement-detail-card"
            actions={<StateBadge state={item.state} testId="statement-detail-state" />}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <KeyValue label="Lender reference" value={<code className="text-[11px]">{item.lenderRef}</code>} testId="detail-lender-ref" />
              <KeyValue label="Statement date" value={item.statementDate ? new Date(item.statementDate).toLocaleDateString() : '—'} testId="detail-statement-date" />
              <KeyValue label="Total amount" value={<span className="tabular-nums font-mono font-semibold">{money(item.totalAmount)}</span>} testId="detail-total-amount" />
              <KeyValue
                label="Evidence reference (source document)"
                value={<code className="text-[11px]" data-testid="detail-evidence-ref">{item.evidenceRef}</code>}
              />
              <KeyValue label="Allocation basis (config-defined)" value={item.allocationBasis} testId="detail-allocation-basis" />
              <KeyValue label="Approved by" value={item.approvedBy ?? '—'} testId="detail-approved-by" />
              <KeyValue label="Approved at" value={dateTime(item.approvedAt)} testId="detail-approved-at" />
              <KeyValue label="Posting item ID" value={<code className="text-[11px]">{item.postingItemId ?? '—'}</code>} testId="detail-posting-item" />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {item.state === 'ENTERED' && (
                <Btn
                  variant="secondary"
                  size="md"
                  data-testid="allocate-btn"
                  disabled={allocate.isPending}
                  onClick={() => allocate.mutate(item.id)}
                >
                  {allocate.isPending ? 'Allocating…' : 'Allocate (preview — posts nothing)'}
                </Btn>
              )}
              {item.state === 'ALLOCATED' && (
                <Btn
                  variant="primary"
                  size="md"
                  data-testid="approve-statement-toggle"
                  onClick={() => setShowApproveForm((v) => !v)}
                >
                  {showApproveForm ? 'Cancel approval' : 'Approve'}
                </Btn>
              )}
            </div>
            <div className="mt-3 space-y-2">
              <MutationError error={allocate.error} testId="allocate-error" />
            </div>
          </Card>

          {item.state === 'ALLOCATED' && (
            <Card title="Allocation preview — this has posted nothing" testId="allocation-preview-card">
              <div className="mb-3 flex items-center gap-3">
                <Badge variant="warning" data-testid="allocation-preview-badge">Preview — not posted</Badge>
                <span className="text-[12px] text-slate-500">
                  Basis: <strong>{(item.allocations as any)?.basis ?? item.allocationBasis}</strong>
                </span>
              </div>
              <p className="text-[12.5px] text-slate-600 mb-3">
                The allocation below distributes the statement total across deals by the configured basis. It is a
                preview only. Nothing has been written to the ledger and nothing will be until the approve step
                below creates the governed posting item.
              </p>
              {allocations.length === 0 ? (
                <Empty
                  testId="allocation-lines-empty"
                  title="No allocation lines"
                  message="The allocation produced no deal lines — the deal cohort data may be unavailable or empty for this statement date."
                />
              ) : (
                <Table
                  headers={['Deal ref', 'Weight', 'Allocated amount (preview)']}
                  testId="allocation-lines-table"
                >
                  {allocations.map((a: any, i: number) => (
                    <tr key={a.dealRef ?? i} data-testid={`alloc-line-${a.dealRef ?? i}`} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-4 font-mono text-[12px]">{a.dealRef}</td>
                      <td className="py-2 pr-4 tabular-nums text-[12px] text-slate-500">{a.weight}</td>
                      <td className="py-2 pr-4 tabular-nums font-mono font-semibold" data-testid={`alloc-amount-${a.dealRef ?? i}`}>{money(a.amount)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          )}

          {showApproveForm && item.state === 'ALLOCATED' && (
            <Card title="Approve statement — requires a person" testId="approve-statement-form">
              <p className="text-[12.5px] text-slate-600 mb-3">
                Approval creates an automation item that travels through the CE-07 governed posting path. The
                approver must be a human identity — an automation identity will be refused. The approved allocation
                preview becomes the posting basis.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <label className="text-[12px] text-slate-600">
                  Approver (person identity) *
                  <input
                    data-testid="approve-approver"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={approver}
                    onChange={(e) => setApprover(e.target.value)}
                    placeholder="controller@dealership.com"
                  />
                </label>
                <label className="text-[12px] text-slate-600">
                  Reserve GL account code *
                  <input
                    data-testid="approve-reserve-account"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={reserveAccountCode}
                    onChange={(e) => setReserveAccountCode(e.target.value)}
                    placeholder="2830"
                  />
                </label>
                <label className="text-[12px] text-slate-600">
                  Offset GL account code *
                  <input
                    data-testid="approve-offset-account"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={offsetAccountCode}
                    onChange={(e) => setOffsetAccountCode(e.target.value)}
                    placeholder="5830"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Btn
                  variant="primary"
                  size="md"
                  data-testid="approve-statement-submit"
                  disabled={
                    !approver.trim() || !reserveAccountCode.trim() || !offsetAccountCode.trim() ||
                    approveStatement.isPending
                  }
                  onClick={() =>
                    approveStatement.mutate({
                      id: item.id,
                      data: {
                        approver: approver.trim(),
                        reserveAccountCode: reserveAccountCode.trim(),
                        offsetAccountCode: offsetAccountCode.trim(),
                      },
                    })
                  }
                >
                  {approveStatement.isPending ? 'Approving…' : 'Approve statement'}
                </Btn>
                <Btn variant="secondary" size="md" data-testid="approve-statement-cancel" onClick={() => setShowApproveForm(false)}>
                  Cancel
                </Btn>
              </div>
              <div className="mt-3"><MutationError error={approveStatement.error} testId="approve-statement-error" /></div>
            </Card>
          )}
        </>
      )}
    </AutomationPage>
  );
}
