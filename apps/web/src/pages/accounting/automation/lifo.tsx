/**
 * CE-17 S073 — LIFO overlay.
 *
 * The ceiling is EXECUTE_WITH_APPROVAL and it is structural: a LIFO reserve
 * is a statutory-adjacent position and this capability can never run
 * unattended. The service will refuse any approval attempt made by an
 * automation identity regardless of current authority level.
 *
 * The index value and its evidence reference are *entered* data, never
 * derived by the system. The system computes the reserve amount (baseCost ×
 * (indexValue − 1)) but the index itself must come from the operator with a
 * cited evidence document. A derived index would be an unsupported tax
 * position.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, AuthorityBadge, Empty, money, dateTime,
} from './shared';

export default function AutomationLifo() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);
  const [showCreatePool, setShowCreatePool] = useState(false);
  const [showComputeLayer, setShowComputeLayer] = useState(false);
  const [approvingLayerId, setApprovingLayerId] = useState<string | null>(null);

  // Create pool form
  const [poolCode, setPoolCode] = useState('');
  const [poolName, setPoolName] = useState('');
  const [methodElection, setMethodElection] = useState('LIFO_DOLLAR_VALUE');
  const [indexSource, setIndexSource] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [electedBy, setElectedBy] = useState('');
  const [electionEvidence, setElectionEvidence] = useState('');

  // Compute layer form
  const [layerYear, setLayerYear] = useState('');
  const [layerMonth, setLayerMonth] = useState('');
  const [baseQuantity, setBaseQuantity] = useState('');
  const [baseCost, setBaseCost] = useState('');
  const [indexValue, setIndexValue] = useState('');
  const [indexEvidenceRef, setIndexEvidenceRef] = useState('');

  // Approve layer form
  const [approver, setApprover] = useState('');
  const [reserveAccountCode, setReserveAccountCode] = useState('');
  const [offsetAccountCode, setOffsetAccountCode] = useState('');

  const pools = useQuery({
    queryKey: ['automation', 'lifo', 'pools'],
    queryFn: () => automationApi.listLifoPools(),
    retry: false,
  });

  const poolRows: any[] = pools.data?.items ?? [];
  const selectedPool = poolRows.find((p) => p.id === selectedPoolId) ?? null;
  const layers: any[] = selectedPool?.layers ?? [];

  const createPool = useMutation({
    mutationFn: (data: any) => automationApi.createLifoPool(data),
    onSuccess: () => {
      setShowCreatePool(false);
      setPoolCode(''); setPoolName(''); setMethodElection('LIFO_DOLLAR_VALUE');
      setIndexSource(''); setEffectiveDate(''); setElectedBy(''); setElectionEvidence('');
      invalidate();
    },
  });

  const computeLayer = useMutation({
    mutationFn: ({ poolId, data }: { poolId: string; data: any }) =>
      automationApi.computeLifoLayer(poolId, data),
    onSuccess: () => {
      setShowComputeLayer(false);
      setLayerYear(''); setLayerMonth(''); setBaseQuantity('');
      setBaseCost(''); setIndexValue(''); setIndexEvidenceRef('');
      invalidate();
    },
  });

  const approveLayer = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      automationApi.approveLifoLayer(id, data),
    onSuccess: () => {
      setApprovingLayerId(null);
      setApprover(''); setReserveAccountCode(''); setOffsetAccountCode('');
      invalidate();
    },
  });

  return (
    <AutomationPage
      title="LIFO Overlay"
      story="S073"
      subtitle="Statutory-adjacent reserve — execute with approval, never unattended"
      testId="automation-lifo"
      permission="automation.read"
      loading={pools.isLoading}
      error={pools.error}
      retry={() => pools.refetch()}
      actions={
        <Btn variant="secondary" size="md" data-testid="create-pool-toggle" onClick={() => setShowCreatePool((v) => !v)}>
          {showCreatePool ? 'Cancel' : 'Create pool'}
        </Btn>
      }
    >
      <Card title="Authority ceiling: EXECUTE_WITH_APPROVAL — this capability never runs unattended" testId="lifo-authority-notice">
        <p className="text-[12.5px] text-slate-600 leading-relaxed">
          The LIFO overlay is statutory-adjacent. Its ceiling is{' '}
          <strong>EXECUTE_WITH_APPROVAL</strong> and cannot be raised further — the service will refuse any attempt to
          approve a layer made by an automation identity, regardless of the current authority level. Every layer
          approval must be made by a person and that person's identity is recorded with the layer.
        </p>
        <p className="text-[12.5px] text-slate-600 leading-relaxed mt-2">
          The index value (<code className="text-[11px]">indexValue</code>) and its evidence reference (
          <code className="text-[11px]">indexEvidenceRef</code>) are <strong>entered evidence</strong>, not system
          output. The service computes the reserve amount from the entered index but does not derive or obtain the
          index itself. A submitted index without an evidence reference is refused.
        </p>
      </Card>

      {showCreatePool && (
        <Card title="Create LIFO pool" testId="create-pool-form">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <label className="text-[12px] text-slate-600">
              Pool code *
              <input
                data-testid="pool-code"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={poolCode}
                onChange={(e) => setPoolCode(e.target.value)}
                placeholder="PARTS-MAIN"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Pool name *
              <input
                data-testid="pool-name"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
                placeholder="Main Parts Inventory Pool"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Method election *
              <select
                data-testid="pool-method-election"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={methodElection}
                onChange={(e) => setMethodElection(e.target.value)}
              >
                <option value="LIFO_DOLLAR_VALUE">LIFO_DOLLAR_VALUE</option>
                <option value="LIFO_UNIT">LIFO_UNIT</option>
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              Index source *
              <input
                data-testid="pool-index-source"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={indexSource}
                onChange={(e) => setIndexSource(e.target.value)}
                placeholder="IRS Publication 538 / NADA / CPI-U"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Effective date *
              <input
                data-testid="pool-effective-date"
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Elected by (person, not automation identity) *
              <input
                data-testid="pool-elected-by"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={electedBy}
                onChange={(e) => setElectedBy(e.target.value)}
                placeholder="controller@dealership.com"
              />
            </label>
            <label className="text-[12px] text-slate-600 md:col-span-2">
              Election evidence reference * (e.g. Form 970 filing or CPA engagement letter)
              <input
                data-testid="pool-election-evidence"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={electionEvidence}
                onChange={(e) => setElectionEvidence(e.target.value)}
                placeholder="FORM-970-2024 / DOC-1234"
              />
            </label>
          </div>
          <Btn
            variant="primary"
            size="md"
            data-testid="create-pool-submit"
            disabled={
              !poolCode.trim() || !poolName.trim() || !indexSource.trim() ||
              !effectiveDate || !electedBy.trim() || !electionEvidence.trim() ||
              createPool.isPending
            }
            onClick={() =>
              createPool.mutate({
                poolCode: poolCode.trim(), poolName: poolName.trim(),
                methodElection, indexSource: indexSource.trim(), effectiveDate,
                electedBy: electedBy.trim(), electionEvidence: electionEvidence.trim(),
              })
            }
          >
            {createPool.isPending ? 'Creating…' : 'Create pool'}
          </Btn>
          <div className="mt-3"><MutationError error={createPool.error} testId="create-pool-error" /></div>
        </Card>
      )}

      <Card title="LIFO pools" testId="lifo-pools-card">
        {poolRows.length === 0 ? (
          <Empty
            testId="lifo-pools-empty"
            title="No LIFO pools defined"
            message="Create a pool to begin. The pool records the method election and its evidence — a pool without election evidence cannot be created."
          />
        ) : (
          <Table
            headers={['Pool code', 'Pool name', 'Method', 'Index source', 'Effective date', 'Elected by', 'Election evidence', 'Layers']}
            testId="lifo-pools-table"
          >
            {poolRows.map((p) => (
              <tr
                key={p.id}
                data-testid={`pool-row-${p.id}`}
                className={[
                  'border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50',
                  selectedPoolId === p.id ? 'bg-blue-50' : '',
                ].join(' ')}
                onClick={() => { setSelectedPoolId(p.id); setShowComputeLayer(false); setApprovingLayerId(null); }}
              >
                <td className="py-2 pr-4 font-mono text-[12px]" data-testid={`pool-code-${p.id}`}>{p.poolCode}</td>
                <td className="py-2 pr-4">{p.poolName}</td>
                <td className="py-2 pr-4">
                  <Badge variant="neutral" data-testid={`pool-method-${p.id}`}>{p.methodElection}</Badge>
                </td>
                <td className="py-2 pr-4 text-slate-600 text-[12px]">{p.indexSource}</td>
                <td className="py-2 pr-4 tabular-nums text-[12px]">{p.effectiveDate ? new Date(p.effectiveDate).toLocaleDateString() : '—'}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`pool-elected-by-${p.id}`}>{p.electedBy}</td>
                <td className="py-2 pr-4 font-mono text-[11px] text-slate-500" data-testid={`pool-evidence-${p.id}`}>{p.electionEvidence}</td>
                <td className="py-2 pr-4 text-slate-500 text-[12px]">{(p.layers ?? []).length}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {selectedPool && (
        <>
          <Card
            title={`Layers — ${selectedPool.poolCode}`}
            testId="lifo-layers-card"
            actions={
              <Btn variant="secondary" size="md" data-testid="compute-layer-toggle" onClick={() => setShowComputeLayer((v) => !v)}>
                {showComputeLayer ? 'Cancel' : 'Compute layer'}
              </Btn>
            }
          >
            {showComputeLayer && (
              <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-[12px] text-slate-600 mb-3">
                  Enter the base quantities and the <strong>index value as entered evidence</strong> with its evidence
                  reference. The reserve amount will be computed as baseCost × (indexValue − 1) and written as an
                  unapproved preview. Nothing is posted at this step.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                  <label className="text-[12px] text-slate-600">
                    Layer year *
                    <input
                      data-testid="layer-year"
                      type="number"
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                      value={layerYear}
                      onChange={(e) => setLayerYear(e.target.value)}
                      placeholder="2024"
                    />
                  </label>
                  <label className="text-[12px] text-slate-600">
                    Layer month *
                    <input
                      data-testid="layer-month"
                      type="number"
                      min="1"
                      max="12"
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                      value={layerMonth}
                      onChange={(e) => setLayerMonth(e.target.value)}
                      placeholder="12"
                    />
                  </label>
                  <label className="text-[12px] text-slate-600">
                    Base quantity *
                    <input
                      data-testid="layer-base-quantity"
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                      value={baseQuantity}
                      onChange={(e) => setBaseQuantity(e.target.value)}
                      placeholder="1250"
                    />
                  </label>
                  <label className="text-[12px] text-slate-600">
                    Base cost *
                    <input
                      data-testid="layer-base-cost"
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                      value={baseCost}
                      onChange={(e) => setBaseCost(e.target.value)}
                      placeholder="95000.00"
                    />
                  </label>
                  <label className="text-[12px] text-slate-600">
                    Index value (entered evidence) *
                    <input
                      data-testid="layer-index-value"
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                      value={indexValue}
                      onChange={(e) => setIndexValue(e.target.value)}
                      placeholder="1.032"
                    />
                  </label>
                  <label className="text-[12px] text-slate-600">
                    Index evidence ref * (cited source for the index)
                    <input
                      data-testid="layer-index-evidence-ref"
                      className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                      value={indexEvidenceRef}
                      onChange={(e) => setIndexEvidenceRef(e.target.value)}
                      placeholder="IRS-PUB538-TABLE-2024 / CPI-U-2024-12"
                    />
                  </label>
                </div>
                <Btn
                  variant="primary"
                  size="md"
                  data-testid="compute-layer-submit"
                  disabled={
                    !layerYear || !layerMonth || !baseQuantity || !baseCost ||
                    !indexValue || !indexEvidenceRef.trim() || computeLayer.isPending
                  }
                  onClick={() =>
                    computeLayer.mutate({
                      poolId: selectedPool.id,
                      data: {
                        layers: [{
                          layerYear: Number(layerYear), layerMonth: Number(layerMonth),
                          baseQuantity, baseCost, indexValue,
                          indexEvidenceRef: indexEvidenceRef.trim(),
                        }],
                      },
                    })
                  }
                >
                  {computeLayer.isPending ? 'Computing…' : 'Compute (preview — nothing posted)'}
                </Btn>
                <div className="mt-3"><MutationError error={computeLayer.error} testId="compute-layer-error" /></div>
              </div>
            )}

            {layers.length === 0 ? (
              <Empty
                testId="lifo-layers-empty"
                title="No layers computed for this pool yet"
                message="Use the compute form to create a layer preview. The preview is not posted until a person approves it."
              />
            ) : (
              <Table
                headers={['Year', 'Month', 'Base qty', 'Base cost', 'Index value (entered evidence)', 'Evidence ref', 'Reserve amount', 'Approved', 'Approved by', 'Approved at', 'Posting item', '']}
                testId="lifo-layers-table"
              >
                {layers.map((l) => (
                  <tr key={l.id} data-testid={`layer-row-${l.id}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 tabular-nums" data-testid={`layer-year-${l.id}`}>{l.layerYear}</td>
                    <td className="py-2 pr-4 tabular-nums" data-testid={`layer-month-${l.id}`}>{String(l.layerMonth).padStart(2, '0')}</td>
                    <td className="py-2 pr-4 tabular-nums font-mono text-[12px]">{l.baseQuantity}</td>
                    <td className="py-2 pr-4 tabular-nums font-mono" data-testid={`layer-base-cost-${l.id}`}>{money(l.baseCost)}</td>
                    <td className="py-2 pr-4 tabular-nums font-mono" data-testid={`layer-index-value-${l.id}`}>{l.indexValue}</td>
                    <td className="py-2 pr-4 font-mono text-[11px] text-slate-500" data-testid={`layer-index-evidence-${l.id}`}>{l.indexEvidenceRef ?? '—'}</td>
                    <td className="py-2 pr-4 tabular-nums font-mono font-semibold" data-testid={`layer-reserve-${l.id}`}>{money(l.reserveAmount)}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={l.approved ? 'success' : 'warning'} data-testid={`layer-approved-${l.id}`}>
                        {l.approved ? 'Approved' : 'Preview'}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-[12px]" data-testid={`layer-approved-by-${l.id}`}>{l.approvedBy ?? '—'}</td>
                    <td className="py-2 pr-4 text-[12px] text-slate-500">{dateTime(l.approvedAt)}</td>
                    <td className="py-2 pr-4 font-mono text-[11px]" data-testid={`layer-posting-item-${l.id}`}>{l.postingItemId ?? '—'}</td>
                    <td className="py-2 pr-4">
                      {!l.approved && (
                        <Btn
                          variant="secondary"
                          size="sm"
                          data-testid={`approve-layer-btn-${l.id}`}
                          onClick={() => setApprovingLayerId(l.id)}
                        >
                          Approve
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          {approvingLayerId && (
            <Card title="Approve LIFO layer — requires a person" testId="approve-layer-form">
              <p className="text-[12.5px] text-slate-600 mb-3">
                Layer approval is a statutory act. The approver must be a human — an automation identity will be
                refused. Approval creates an automation item that travels through the CE-07 governed posting path.
                Nothing is written to the ledger until that item executes.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <label className="text-[12px] text-slate-600">
                  Approver (person identity) *
                  <input
                    data-testid="approve-layer-approver"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={approver}
                    onChange={(e) => setApprover(e.target.value)}
                    placeholder="controller@dealership.com"
                  />
                </label>
                <label className="text-[12px] text-slate-600">
                  Reserve GL account code *
                  <input
                    data-testid="approve-layer-reserve-account"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={reserveAccountCode}
                    onChange={(e) => setReserveAccountCode(e.target.value)}
                    placeholder="2820"
                  />
                </label>
                <label className="text-[12px] text-slate-600">
                  Offset GL account code *
                  <input
                    data-testid="approve-layer-offset-account"
                    className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                    value={offsetAccountCode}
                    onChange={(e) => setOffsetAccountCode(e.target.value)}
                    placeholder="5820"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Btn
                  variant="primary"
                  size="md"
                  data-testid="approve-layer-submit"
                  disabled={
                    !approver.trim() || !reserveAccountCode.trim() || !offsetAccountCode.trim() ||
                    approveLayer.isPending
                  }
                  onClick={() =>
                    approveLayer.mutate({
                      id: approvingLayerId,
                      data: {
                        approver: approver.trim(),
                        reserveAccountCode: reserveAccountCode.trim(),
                        offsetAccountCode: offsetAccountCode.trim(),
                      },
                    })
                  }
                >
                  {approveLayer.isPending ? 'Approving…' : 'Approve layer'}
                </Btn>
                <Btn variant="secondary" size="md" data-testid="approve-layer-cancel" onClick={() => setApprovingLayerId(null)}>
                  Cancel
                </Btn>
              </div>
              <div className="mt-3"><MutationError error={approveLayer.error} testId="approve-layer-error" /></div>
            </Card>
          )}
        </>
      )}
    </AutomationPage>
  );
}
