/**
 * CE-17 S127 Unclaimed Property Automation.
 *
 * Authority ceiling: EXECUTE_WITH_APPROVAL.
 *
 * The flow is: candidates → due diligence → remittance preparation.
 * The system identifies candidates and prepares a remittance package.
 * Nothing is escheated by the system — it prepares the remittance and
 * a human submits it to the state. The state tracks jurisdiction and aging.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, Empty, StateBadge,
  money, dateTime, useLegalEntityFromQuery,
} from './shared';

const UP_STATES = [
  'CANDIDATE', 'DUE_DILIGENCE', 'NOTICE_SENT', 'REMITTANCE_READY', 'REMITTED', 'CLOSED',
];

const SOURCE_QUEUES = ['AP', 'AR', 'DEPOSIT', 'CREDIT'];

export default function AutomationUnclaimedProperty() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;

  const [stateFilter, setStateFilter] = useState('');
  const [jurisdictionFilter, setJurisdictionFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Identify form
  const [showIdentify, setShowIdentify] = useState(false);
  const [idLegalEntity, setIdLegalEntity] = useState(legalEntityId ?? '');
  const [idSourceQueue, setIdSourceQueue] = useState<string>('AP');
  const [idSourceItemId, setIdSourceItemId] = useState('');
  const [idJurisdiction, setIdJurisdiction] = useState('');
  const [idPropertyType, setIdPropertyType] = useState('');
  const [idAmount, setIdAmount] = useState('');
  const [idDormancyDate, setIdDormancyDate] = useState('');

  // Due diligence form
  const [showDueDiligence, setShowDueDiligence] = useState(false);
  const [ddMethod, setDdMethod] = useState<'LETTER' | 'PHONE' | 'EMAIL' | 'OTHER'>('LETTER');
  const [ddOutcome, setDdOutcome] = useState('');
  const [ddNotes, setDdNotes] = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const list = useQuery({
    queryKey: ['automation', 'unclaimed-property', legalEntityId, stateFilter, jurisdictionFilter],
    queryFn: () => automationApi.listUnclaimedProperty({
      legalEntityId,
      state: stateFilter || undefined,
      jurisdiction: jurisdictionFilter || undefined,
    }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const detail = useQuery({
    queryKey: ['automation', 'unclaimed-property-item', selectedId],
    queryFn: () => automationApi.getUnclaimedPropertyItem(selectedId as string),
    enabled: Boolean(selectedId),
    retry: false,
  });

  const identify = useMutation({
    mutationFn: () => automationApi.identifyUnclaimedProperty({
      legalEntityId: idLegalEntity,
      sourceQueue: idSourceQueue,
      sourceItemId: idSourceItemId,
      holderState: idJurisdiction,
      propertyType: idPropertyType,
      amount: idAmount,
      dormancyDate: idDormancyDate,
    }),
    onSuccess: () => { setShowIdentify(false); invalidate(); },
  });

  const dueDiligence = useMutation({
    mutationFn: () => automationApi.recordDueDiligence(selectedId as string, {
      method: ddMethod,
      outcome: ddOutcome,
      notes: ddNotes || undefined,
    }),
    onSuccess: () => { setShowDueDiligence(false); setDdOutcome(''); setDdNotes(''); invalidate(); },
  });

  const remittance = useMutation({
    mutationFn: (id: string) => automationApi.prepareRemittance(id),
    onSuccess: invalidate,
  });

  const rows: any[] = list.data?.items ?? [];
  const item: any = detail.data ?? null;
  const ddRefs: any[] = item?.dueDiligenceRefs ?? [];

  return (
    <AutomationPage
      title="Unclaimed Property"
      story="S127"
      subtitle="Ceiling: EXECUTE_WITH_APPROVAL — the system prepares a remittance; a human submits it to the state."
      testId="automation-unclaimed-property"
      permission="automation.read"
      capabilityCode="S127_UNCLAIMED_PROPERTY"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="identify-up-btn" onClick={() => setShowIdentify((v) => !v)}>
          Identify candidate
        </Btn>
      }
    >
      <div
        data-testid="up-authority-notice"
        className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-900"
      >
        <strong>Authority ceiling: EXECUTE_WITH_APPROVAL.</strong> The automation identifies dormant items,
        records due-diligence attempts, and prepares a remittance package. It does not escheat anything to the
        state — a human reviews the package and submits it. Nothing leaves the dealership's records until a
        person approves and submits the remittance.
      </div>

      {showIdentify && (
        <Card title="Identify an unclaimed property candidate" testId="identify-up-panel">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <label className="text-[12px] text-slate-600">
              Legal entity ID
              <input
                data-testid="id-legal-entity"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={idLegalEntity}
                onChange={(e) => setIdLegalEntity(e.target.value)}
                placeholder="e.g. LE-001"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Source queue
              <select
                data-testid="id-source-queue"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={idSourceQueue}
                onChange={(e) => setIdSourceQueue(e.target.value)}
              >
                {SOURCE_QUEUES.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              Source item ID
              <input
                data-testid="id-source-item"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={idSourceItemId}
                onChange={(e) => setIdSourceItemId(e.target.value)}
                placeholder="AP invoice ID, AR receipt ID, etc."
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Jurisdiction (holder state)
              <input
                data-testid="id-jurisdiction"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={idJurisdiction}
                onChange={(e) => setIdJurisdiction(e.target.value)}
                placeholder="e.g. IL, TX, CA"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Property type
              <input
                data-testid="id-property-type"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={idPropertyType}
                onChange={(e) => setIdPropertyType(e.target.value)}
                placeholder="e.g. UNCASHED_CHECK, CREDIT_BALANCE"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Amount
              <input
                data-testid="id-amount"
                type="number"
                step="0.01"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={idAmount}
                onChange={(e) => setIdAmount(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Dormancy date
              <input
                data-testid="id-dormancy-date"
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={idDormancyDate}
                onChange={(e) => setIdDormancyDate(e.target.value)}
              />
            </label>
          </div>
          <Btn
            variant="primary"
            size="md"
            data-testid="identify-up-confirm"
            disabled={!idLegalEntity.trim() || !idSourceItemId.trim() || identify.isPending}
            onClick={() => identify.mutate()}
          >
            {identify.isPending ? 'Identifying…' : 'Identify candidate'}
          </Btn>
          <MutationError error={identify.error} testId="identify-up-error" />
        </Card>
      )}

      <Card
        title="Unclaimed property items"
        testId="up-items-card"
        actions={
          <div className="flex gap-2">
            <select
              data-testid="up-state-filter"
              className="border border-slate-300 rounded px-2 py-1 text-[13px]"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="">All states</option>
              {UP_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              data-testid="up-jurisdiction-filter"
              className="w-20 border border-slate-300 rounded px-2 py-1 text-[13px]"
              placeholder="State"
              value={jurisdictionFilter}
              onChange={(e) => setJurisdictionFilter(e.target.value)}
            />
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty
            testId="up-items-empty"
            title="No unclaimed property candidates"
            message="No items match the current jurisdiction and state filters. Candidates are identified when dormant AP, AR, deposit, or credit items exceed the statutory dormancy period for their jurisdiction."
          />
        ) : (
          <Table
            headers={['Legal entity', 'Source', 'Jurisdiction', 'Property type', 'Amount', 'Dormancy date', 'State', '']}
            testId="up-items-table"
          >
            {rows.map((r: any) => (
              <tr key={r.id} data-testid={`up-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 text-[12px] font-mono" data-testid={`up-entity-${r.id}`}>{r.legalEntityId}</td>
                <td className="py-2 pr-4">
                  <Badge variant="neutral" data-testid={`up-source-${r.id}`}>{r.sourceQueue}</Badge>
                </td>
                <td className="py-2 pr-4 text-[12px] font-semibold" data-testid={`up-jurisdiction-${r.id}`}>{r.holderState}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`up-property-type-${r.id}`}>{r.propertyType}</td>
                <td className="py-2 pr-4 font-mono tabular-nums text-right" data-testid={`up-amount-${r.id}`}>
                  {money(r.amount)}
                </td>
                <td className="py-2 pr-4 text-[12px] text-slate-500" data-testid={`up-dormancy-${r.id}`}>
                  {r.dormancyDate ? new Date(r.dormancyDate).toLocaleDateString() : '—'}
                </td>
                <td className="py-2 pr-4">
                  <StateBadge state={r.state} testId={`up-state-${r.id}`} />
                </td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`inspect-up-${r.id}`} onClick={() => setSelectedId(r.id)}>
                    Open
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {item && (
        <>
          <Card title="Item" testId="up-item-detail" actions={<StateBadge state={item.state} testId="up-detail-state" />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 mb-4">
              <KeyValue label="Legal entity" value={item.legalEntityId} testId="up-detail-entity" />
              <KeyValue label="Source queue" value={item.sourceQueue} testId="up-detail-source" />
              <KeyValue label="Source item ID" value={item.sourceItemId} testId="up-detail-source-item" />
              <KeyValue label="Jurisdiction (holder state)" value={item.holderState} testId="up-detail-jurisdiction" />
              <KeyValue label="Property type" value={item.propertyType} testId="up-detail-property-type" />
              <KeyValue label="Amount" value={<span className="font-mono tabular-nums">{money(item.amount)}</span>} testId="up-detail-amount" />
              <KeyValue
                label="Dormancy date"
                value={item.dormancyDate ? new Date(item.dormancyDate).toLocaleDateString() : '—'}
                testId="up-detail-dormancy"
              />
              <KeyValue label="Notice attempts" value={item.noticeAttempts ?? 0} testId="up-detail-notice-attempts" />
              <KeyValue label="Remittance export ref" value={item.remittanceExportRef ?? '—'} testId="up-detail-remittance-ref" />
              <KeyValue label="Posting item ID" value={item.postingItemId ?? '—'} testId="up-detail-posting-item" />
            </div>

            <div className="flex flex-wrap gap-2">
              <Btn
                variant="secondary"
                size="md"
                data-testid="record-dd-btn"
                onClick={() => setShowDueDiligence((v) => !v)}
                disabled={item.state === 'REMITTED' || item.state === 'CLOSED'}
              >
                Record due diligence
              </Btn>
              <Btn
                variant="primary"
                size="md"
                data-testid="prepare-remittance-btn"
                disabled={remittance.isPending || item.state === 'REMITTANCE_READY' || item.state === 'REMITTED'}
                onClick={() => remittance.mutate(item.id)}
              >
                {remittance.isPending ? 'Preparing…' : 'Prepare remittance'}
              </Btn>
            </div>
            <p className="mt-2 text-[11.5px] text-slate-500" data-testid="up-prepare-notice">
              Preparing a remittance creates an export package for the state. Nothing is transmitted — a human
              reviews and submits it.
            </p>
            <MutationError error={remittance.error} testId="prepare-remittance-error" />
          </Card>

          {showDueDiligence && (
            <Card title="Record due diligence attempt" testId="due-diligence-panel">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <label className="text-[12px] text-slate-600">
                  Method
                  <select
                    data-testid="dd-method"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={ddMethod}
                    onChange={(e) => setDdMethod(e.target.value as typeof ddMethod)}
                  >
                    {(['LETTER', 'PHONE', 'EMAIL', 'OTHER'] as const).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[12px] text-slate-600">
                  Outcome
                  <input
                    data-testid="dd-outcome"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={ddOutcome}
                    onChange={(e) => setDdOutcome(e.target.value)}
                    placeholder="e.g. NO_RESPONSE, RETURNED_MAIL, CLAIMED"
                  />
                </label>
                <label className="text-[12px] text-slate-600 md:col-span-2">
                  Notes (optional)
                  <input
                    data-testid="dd-notes"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={ddNotes}
                    onChange={(e) => setDdNotes(e.target.value)}
                    placeholder="Additional context for this attempt"
                  />
                </label>
              </div>
              <Btn
                variant="primary"
                size="md"
                data-testid="record-dd-confirm"
                disabled={!ddOutcome.trim() || dueDiligence.isPending}
                onClick={() => dueDiligence.mutate()}
              >
                {dueDiligence.isPending ? 'Recording…' : 'Record attempt'}
              </Btn>
              <MutationError error={dueDiligence.error} testId="dd-error" />
            </Card>
          )}

          {/* Due diligence history */}
          <Card title="Due diligence attempts" testId="up-dd-history-card">
            {ddRefs.length === 0 ? (
              <Empty
                testId="up-dd-empty"
                title="No due diligence attempts recorded"
                message="Most jurisdictions require at least one owner contact attempt before remittance. Record each attempt with its method, date, and outcome."
              />
            ) : (
              <Table headers={['#', 'Method', 'Outcome', 'Date', 'Notes']} testId="up-dd-table">
                {ddRefs.map((d: any, i: number) => (
                  <tr key={i} data-testid={`dd-row-${i}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 text-[12px] text-slate-500">{i + 1}</td>
                    <td className="py-2 pr-4 text-[12px]" data-testid={`dd-method-${i}`}>{d.method ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px]" data-testid={`dd-outcome-${i}`}>{d.outcome ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px] text-slate-500" data-testid={`dd-date-${i}`}>{dateTime(d.at ?? d.date)}</td>
                    <td className="py-2 pr-4 text-[12px] text-slate-600">{d.notes ?? '—'}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </AutomationPage>
  );
}
