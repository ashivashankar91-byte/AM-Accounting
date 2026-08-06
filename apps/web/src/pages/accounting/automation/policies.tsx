/**
 * CE-17 Automation Policy Gates.
 *
 * Policy authoring and activation live on this screen, but they can never be
 * performed by the same person. That constraint is structural — the server
 * enforces separation of duties at the activation endpoint — and this screen
 * says so plainly rather than hiding the rule in a tooltip.
 *
 * An authored version changes nothing: only an activated version whose
 * effective date has arrived is ever consulted by the policy evaluator. A
 * draft sitting here is harmless. An activated version is immutable, which
 * is what makes the policy trace on an executed item meaningful months later.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { automationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import {
  AutomationPage, Card, Table, KeyValue, MutationError, Empty, AuthorityBadge,
  money, confidence, dateTime, useLegalEntityFromQuery, useCapabilityFromQuery,
} from './shared';

export default function AutomationPolicies() {
  const qc = useQueryClient();
  const legalEntityId = useLegalEntityFromQuery() ?? undefined;
  const capabilityCode = useCapabilityFromQuery() ?? undefined;

  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    capabilityCode: capabilityCode ?? '',
    policyVersion: '',
    effectiveDate: '',
    monetaryLimit: '',
    confidenceMin: '',
    circuitBreakerThreshold: '5',
    allowedExceptionCategories: '',
    highRiskCategories: '',
    intendedAuthority: '',
  });

  const list = useQuery({
    queryKey: ['automation', 'policies', legalEntityId, capabilityCode],
    queryFn: () => automationApi.listPolicies({ legalEntityId, capabilityCode }),
    retry: false,
  });

  const effective = useQuery({
    queryKey: ['automation', 'policies', 'effective', legalEntityId, capabilityCode],
    queryFn: () => automationApi.getEffectivePolicy({ legalEntityId, capabilityCode }),
    enabled: Boolean(capabilityCode),
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automation'] });

  const save = useMutation({
    mutationFn: () => automationApi.savePolicy({
      legalEntityId,
      capabilityCode: form.capabilityCode,
      policyVersion: form.policyVersion,
      effectiveDate: form.effectiveDate,
      monetaryLimit: form.monetaryLimit || null,
      confidenceMin: form.confidenceMin || null,
      circuitBreakerThreshold: form.circuitBreakerThreshold ? Number(form.circuitBreakerThreshold) : 5,
      allowedExceptionCategories: form.allowedExceptionCategories
        ? form.allowedExceptionCategories.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      highRiskCategories: form.highRiskCategories
        ? form.highRiskCategories.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      intendedAuthority: form.intendedAuthority || undefined,
    }),
    onSuccess: () => {
      setShowForm(false);
      setForm({
        capabilityCode: capabilityCode ?? '',
        policyVersion: '',
        effectiveDate: '',
        monetaryLimit: '',
        confidenceMin: '',
        circuitBreakerThreshold: '5',
        allowedExceptionCategories: '',
        highRiskCategories: '',
        intendedAuthority: '',
      });
      invalidate();
    },
  });

  const activate = useMutation({
    mutationFn: (id: string) => automationApi.activatePolicy(id),
    onSuccess: invalidate,
  });

  const rows: any[] = list.data?.items ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const gate: any = effective.data?.gate ?? null;

  return (
    <AutomationPage
      title="Policy Gates"
      story="CE-17"
      subtitle="Authored by one identity, activated by a different one — the server enforces this"
      testId="automation-policies"
      permission="automation.read"
      loading={list.isLoading}
      error={list.error}
      retry={() => list.refetch()}
      actions={
        <Btn variant="primary" size="md" data-testid="author-policy-btn" onClick={() => setShowForm((v) => !v)}>
          Author new version
        </Btn>
      }
    >
      {/* Effective gate summary when scoped to a single capability */}
      {capabilityCode && (
        <Card title={`Effective gate — ${capabilityCode}`} testId="effective-gate-card">
          {effective.isLoading ? (
            <p className="text-[13px] text-slate-500">Loading effective gate…</p>
          ) : !gate ? (
            <p data-testid="effective-gate-none" className="text-[13px] text-slate-500">
              No activated policy version is in effect for {capabilityCode}. Until one is, the capability can only observe — it is
              configured at OBSERVE_ONLY and cannot be promoted.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
              <KeyValue label="Policy version" value={gate.policyVersion} testId="effective-policy-version" />
              <KeyValue label="Monetary limit" value={gate.monetaryLimit ? money(gate.monetaryLimit) : 'None set'} testId="effective-monetary-limit" />
              <KeyValue
                label="Confidence minimum"
                value={gate.confidenceMin ? confidence(gate.confidenceMin) : 'None set'}
                testId="effective-confidence-min"
              />
              <KeyValue label="Circuit breaker threshold" value={gate.circuitBreakerThreshold ?? 5} testId="effective-circuit-breaker" />
              <KeyValue
                label="Allowed exception categories"
                value={(gate.allowedExceptionCategories ?? []).join(', ') || 'None'}
                testId="effective-exception-categories"
              />
              <KeyValue
                label="High-risk categories"
                value={(gate.highRiskCategories ?? []).join(', ') || 'None'}
                testId="effective-high-risk-categories"
              />
            </div>
          )}
        </Card>
      )}

      {/* Author new policy version form */}
      {showForm && (
        <Card title="Author a new policy version" testId="author-policy-form">
          <p className="text-[12.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4" data-testid="sod-notice">
            <strong>Separation of duties:</strong> the person who authors this version cannot activate it. The server
            refuses activation from the same identity that authored it — this is not a UI guard, it is a server-enforced
            invariant. Once authored, a different person must open this screen and activate it before it takes effect.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="text-[12px] text-slate-600">
              Capability code *
              <input
                data-testid="form-capability-code"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={form.capabilityCode}
                onChange={(e) => setForm((f) => ({ ...f, capabilityCode: e.target.value }))}
                placeholder="e.g. S040_OCR_INGESTION"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Policy version *
              <input
                data-testid="form-policy-version"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={form.policyVersion}
                onChange={(e) => setForm((f) => ({ ...f, policyVersion: e.target.value }))}
                placeholder="e.g. v1.0.0"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Effective date *
              <input
                data-testid="form-effective-date"
                type="date"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={form.effectiveDate}
                onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Monetary limit (blank = no limit)
              <input
                data-testid="form-monetary-limit"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={form.monetaryLimit}
                onChange={(e) => setForm((f) => ({ ...f, monetaryLimit: e.target.value }))}
                placeholder="e.g. 25000.00"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Confidence minimum (0–1; blank = not enforced)
              <input
                data-testid="form-confidence-min"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={form.confidenceMin}
                onChange={(e) => setForm((f) => ({ ...f, confidenceMin: e.target.value }))}
                placeholder="e.g. 0.85"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Circuit breaker threshold (consecutive failures before auto-suspend)
              <input
                data-testid="form-circuit-breaker-threshold"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px] font-mono"
                value={form.circuitBreakerThreshold}
                onChange={(e) => setForm((f) => ({ ...f, circuitBreakerThreshold: e.target.value }))}
                placeholder="5"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Allowed exception categories (comma-separated)
              <input
                data-testid="form-allowed-exception-categories"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={form.allowedExceptionCategories}
                onChange={(e) => setForm((f) => ({ ...f, allowedExceptionCategories: e.target.value }))}
                placeholder="e.g. ROUNDING, INTERCOMPANY"
              />
            </label>
            <label className="text-[12px] text-slate-600">
              High-risk categories (comma-separated)
              <input
                data-testid="form-high-risk-categories"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={form.highRiskCategories}
                onChange={(e) => setForm((f) => ({ ...f, highRiskCategories: e.target.value }))}
                placeholder="e.g. STATUTORY, REVERSAL"
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Btn
              variant="primary"
              size="md"
              data-testid="save-policy-btn"
              disabled={!form.capabilityCode.trim() || !form.policyVersion.trim() || !form.effectiveDate || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save draft'}
            </Btn>
            <Btn variant="secondary" size="md" data-testid="cancel-policy-btn" onClick={() => setShowForm(false)}>
              Cancel
            </Btn>
          </div>
          <div className="mt-3"><MutationError error={save.error} testId="save-policy-error" /></div>
        </Card>
      )}

      {/* Policy version list */}
      <Card title="Policy versions" testId="policy-list-card">
        {rows.length === 0 ? (
          <Empty
            testId="policy-list-empty"
            title="No policy versions authored yet"
            message="Author a version above. Until an activated version exists, this capability cannot be promoted past OBSERVE_ONLY — an absent policy is a refusal, not a free pass."
          />
        ) : (
          <Table
            headers={['Capability', 'Version', 'Effective date', 'Authored by', 'Activated by', 'Monetary limit', 'Confidence min', 'Circuit breaker', '']}
            testId="policy-list-table"
          >
            {rows.map((r) => (
              <tr key={r.id} data-testid={`policy-row-${r.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{r.capabilityCode}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">{r.policyVersion}</td>
                <td className="py-2 pr-4 text-[12px] text-slate-600">{r.effectiveDate ? dateTime(r.effectiveDate) : '—'}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`policy-authored-by-${r.id}`}>{r.authoredBy}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`policy-activated-by-${r.id}`}>
                  {r.activatedBy
                    ? <span className="text-green-700 font-medium">{r.activatedBy}</span>
                    : <Badge variant="neutral">Not activated</Badge>}
                </td>
                <td className="py-2 pr-4 tabular-nums text-[12px]">{r.monetaryLimit ? money(r.monetaryLimit) : '—'}</td>
                <td className="py-2 pr-4 text-[12px]">{r.confidenceMin ? confidence(r.confidenceMin) : '—'}</td>
                <td className="py-2 pr-4 text-[12px]">{r.circuitBreakerThreshold ?? 5}</td>
                <td className="py-2 pr-4 flex gap-2">
                  <Btn variant="secondary" size="sm" data-testid={`inspect-policy-${r.id}`} onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}>
                    {r.id === selectedId ? 'Hide' : 'Detail'}
                  </Btn>
                  {!r.activatedBy && (
                    <Btn
                      variant="primary"
                      size="sm"
                      data-testid={`activate-policy-${r.id}`}
                      disabled={activate.isPending}
                      onClick={() => activate.mutate(r.id)}
                    >
                      Activate
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {activate.error && <div className="mt-3"><MutationError error={activate.error} testId="activate-policy-error" /></div>}
      </Card>

      {/* Detail for selected version */}
      {selected && (
        <Card title={`Version detail — ${selected.policyVersion}`} testId="policy-detail-card">
          <div className="mb-3">
            <p className="text-[12.5px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-3 py-2" data-testid="sod-detail-notice">
              Authored by <strong>{selected.authoredBy}</strong>.{' '}
              {selected.activatedBy
                ? <>Activated by <strong>{selected.activatedBy}</strong> — a different person, as the server required.</>
                : <>Not yet activated. A <em>different</em> person must activate it; the server refuses activation from the same identity that authored it.</>}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            <KeyValue label="Capability" value={selected.capabilityCode} testId="detail-capability-code" />
            <KeyValue label="Policy version" value={selected.policyVersion} testId="detail-policy-version" />
            <KeyValue label="Effective date" value={dateTime(selected.effectiveDate)} testId="detail-effective-date" />
            <KeyValue label="Authored by" value={selected.authoredBy} testId="detail-authored-by" />
            <KeyValue
              label="Activated by"
              value={selected.activatedBy ?? <Badge variant="neutral">Not activated</Badge>}
              testId="detail-activated-by"
            />
            <KeyValue label="Monetary limit" value={selected.monetaryLimit ? money(selected.monetaryLimit) : 'None'} testId="detail-monetary-limit" />
            <KeyValue
              label="Confidence minimum"
              value={selected.confidenceMin ? confidence(selected.confidenceMin) : 'None'}
              testId="detail-confidence-min"
            />
            <KeyValue label="Circuit breaker threshold" value={selected.circuitBreakerThreshold ?? 5} testId="detail-circuit-breaker" />
            <KeyValue
              label="Allowed exception categories"
              value={(selected.allowedExceptionCategories ?? []).join(', ') || 'None'}
              testId="detail-exception-categories"
            />
            <KeyValue
              label="High-risk categories"
              value={(selected.highRiskCategories ?? []).join(', ') || 'None'}
              testId="detail-high-risk-categories"
            />
            <KeyValue label="Created" value={dateTime(selected.createdAt)} testId="detail-created-at" />
            <KeyValue label="Last updated" value={dateTime(selected.updatedAt)} testId="detail-updated-at" />
          </div>
          {!selected.activatedBy && (
            <div className="mt-4 flex items-center gap-3">
              <Btn
                variant="primary"
                size="md"
                data-testid="activate-policy-detail-btn"
                disabled={activate.isPending}
                onClick={() => activate.mutate(selected.id)}
              >
                {activate.isPending ? 'Activating…' : 'Activate this version'}
              </Btn>
              <span className="text-[12px] text-slate-500">You must be a different person from {selected.authoredBy}</span>
            </div>
          )}
          {selected.activatedBy && (
            <p className="mt-4 text-[12px] text-slate-500">
              This version is activated and immutable. Author a new version to change any parameter.
            </p>
          )}
          <AuthorityBadge authority={undefined} testId="detail-authority-placeholder" />
        </Card>
      )}
    </AutomationPage>
  );
}
