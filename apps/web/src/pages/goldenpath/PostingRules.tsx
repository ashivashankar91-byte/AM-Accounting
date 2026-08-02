import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { postingEngineApi, goldenPathApi } from '../../api/client';
import { EmptyState, ErrorState, LoadingState, UnauthorizedState, SectionLabel, Drawer, DrawerRow, FilterBar, FilterField, FILTER_CONTROL_CLASS, Banner } from '../../components/report';
import { Badge, Btn } from '../../components/ui';

// D-S023 — Posting Rules administration. Author, validate and activate
// Posting DSL v1 rule-pack versions that drive the S019/S020 posting
// engine. Activated versions are immutable (DB trigger backstop) — this
// screen never posts a journal itself (see Posting Executions for that).

interface RulePackVersion {
  id: string;
  packKey: string;
  semver: string;
  dslVersion: number;
  status: string; // DRAFT | VALIDATED | ACTIVE | SUPERSEDED | REJECTED
  eventType: string;
  eventSchemaVersions: string[];
  entityId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  journalSourceCode: string;
  matchStrategy: string;
  noMatchBehavior: string;
  definition: RulePackDoc;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  validatedAt: string | null;
  activatedBy: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  validationFindings: Array<{ severity: string; code: string; path: string; ruleId?: string; message: string }> | null;
}

interface RulePackDoc {
  dslVersion: number;
  packKey: string;
  semver: string;
  eventType: string;
  supportedEventSchemaVersions: string[];
  tenantScope: string;
  entityId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  journalSourceCode: string;
  matchStrategy: string;
  noMatchBehavior: string;
  rules: RuleRow[];
}

interface RuleRow {
  ruleId: string;
  priority: number;
  description: string;
  condition: unknown;
  blueprint: unknown;
}

interface PackRow {
  pack: { id: string; packKey: string; createdBy: string; createdAt: string };
  versions: RulePackVersion[];
}

interface AuditEvent {
  id: string;
  action: string;
  actor: string;
  before: unknown;
  after: unknown;
  createdAt?: string;
  occurredAt?: string;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple'> = {
  DRAFT: 'neutral',
  VALIDATED: 'info',
  ACTIVE: 'success',
  SUPERSEDED: 'purple',
  REJECTED: 'danger',
};

function emptyDraft(entityId: string): RulePackDoc {
  return {
    dslVersion: 1,
    packKey: '',
    semver: '1.0.0',
    eventType: '',
    supportedEventSchemaVersions: ['1.0'],
    tenantScope: '',
    entityId,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: null,
    journalSourceCode: '',
    matchStrategy: 'FIRST_MATCH',
    noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
    rules: [
      {
        ruleId: 'rule-1',
        priority: 1,
        description: '',
        condition: null,
        blueprint: { memoTemplate: '', postingGroups: [{ groupId: 'grp', baseAmountPath: 'payload.amount', debitAllocations: [], creditAllocations: [] }] },
      },
    ],
  };
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PostingRules() {
  const { isAuthenticated, user, legalEntityId, legalEntityLabel } = useAuth();

  const [packs, setPacks] = useState<PackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  // CE-07 legal-entity isolation defect — rule-pack governance is inherently
  // per-entity (a rule pack always belongs to exactly one legal entity), so
  // unlike other filters below, legal entity is NOT a client-side filter
  // over a fully-loaded tenant set: every list/get call is now scoped
  // server-side by the authenticated session's own selected legalEntityId
  // (see EntityScopeContext/select-entity — the same authoritative,
  // server-validated selection every other Golden Path screen already
  // relies on). The browser never infers or offers a different entity to
  // filter by; event family and status remain genuine client-side filters
  // over that one entity's small configuration set.
  const [filterEventType, setFilterEventType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  const [selectedPackKey, setSelectedPackKey] = useState<string | null>(null);
  const [drawerVersion, setDrawerVersion] = useState<RulePackVersion | null>(null);
  const [drawerAudit, setDrawerAudit] = useState<AuditEvent[] | null>(null);
  const [drawerAuditError, setDrawerAuditError] = useState<string | null>(null);

  const [showEditor, setShowEditor] = useState(false);
  const [draft, setDraft] = useState<RulePackDoc>(() => emptyDraft(legalEntityId ?? ''));
  const [draftValid, setDraftValid] = useState<boolean | null>(null);
  const [draftFindings, setDraftFindings] = useState<RulePackVersion['validationFindings']>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  function classifyLoadError(err: any) {
    if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
    else setError(err.message);
  }

  const load = useCallback(() => {
    if (!isAuthenticated || !legalEntityId) return;
    setLoading(true);
    setError(null);
    setUnauthorized(null);
    postingEngineApi.listRulePacks(legalEntityId)
      .then((res) => setPacks(res.items as PackRow[]))
      .catch(classifyLoadError)
      .finally(() => setLoading(false));
  }, [isAuthenticated, legalEntityId]);

  useEffect(load, [load]);

  const eventTypeOptions = useMemo(
    () => Array.from(new Set(packs.flatMap((p) => p.versions.map((v) => v.eventType)))).sort(),
    [packs],
  );

  const filteredPacks = useMemo(() => {
    return packs
      .map((p) => ({
        pack: p.pack,
        versions: p.versions.filter((v) => {
          if (filterEventType && v.eventType !== filterEventType) return false;
          if (filterStatus && v.status !== filterStatus) return false;
          return true;
        }),
      }))
      .filter((p) => {
        if (filterEventType || filterStatus) {
          if (p.versions.length === 0) return false;
        }
        if (filterSearch && !p.pack.packKey.toLowerCase().includes(filterSearch.toLowerCase())) return false;
        return true;
      });
  }, [packs, filterEventType, filterStatus, filterSearch]);

  async function openVersionDrawer(version: RulePackVersion) {
    setDrawerVersion(version);
    setDrawerAudit(null);
    setDrawerAuditError(null);
    try {
      const history = await goldenPathApi.getAuditHistory('POSTING_ENGINE', version.id);
      setDrawerAudit(history as AuditEvent[]);
    } catch (err: any) {
      setDrawerAuditError(err.status === 401 || err.status === 403 ? err.message : 'Could not load audit history for this version.');
    }
  }

  async function refreshDrawerVersion(id: string, packKey: string) {
    if (!legalEntityId) return;
    const res = await postingEngineApi.getRulePack(packKey, legalEntityId);
    setPacks((prev) => prev.map((p) => (p.pack.packKey === packKey ? { pack: p.pack, versions: res.versions as RulePackVersion[] } : p)));
    const updated = (res.versions as RulePackVersion[]).find((v) => v.id === id) ?? null;
    setDrawerVersion(updated);
  }

  async function handleValidateVersion(version: RulePackVersion) {
    setActionError(null);
    setBusy(true);
    try {
      await postingEngineApi.validateVersion(version.id);
      await refreshDrawerVersion(version.id, version.packKey);
    } catch (err: any) {
      setActionError(err.body?.message ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleActivateVersion(version: RulePackVersion) {
    setActionError(null);
    setActionNotice(null);
    setBusy(true);
    try {
      await postingEngineApi.activateVersion(version.id);
      setActionNotice(`Version ${version.semver} is now ACTIVE.`);
      await refreshDrawerVersion(version.id, version.packKey);
    } catch (err: any) {
      // Self-activation refusal (D-S023-28): the identity that authored/
      // created this draft can never be the one who activates it — a
      // separate, second user must perform the activation ceremony.
      if (err.status === 403 && err.body?.error === 'SELF_ACTIVATION_FORBIDDEN') {
        setActionError(
          `Activation refused: you (${user?.email ?? 'this account'}) authored this version. A separate, ` +
          `eligible user must activate it — this is enforced by the backend, not just hidden in the UI.`,
        );
      } else {
        setActionError(err.body?.message ?? err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleValidateDraft() {
    setActionError(null);
    setBusy(true);
    try {
      const sourceText = JSON.stringify(draft);
      const result = await postingEngineApi.validateDraft(sourceText);
      setDraftValid(result.valid);
      setDraftFindings(result.findings);
    } catch (err: any) {
      setActionError(err.body?.message ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft() {
    setActionError(null);
    setBusy(true);
    try {
      const sourceText = JSON.stringify(draft);
      await postingEngineApi.createRulePackVersion(draft.packKey, sourceText);
      setShowEditor(false);
      setDraft(emptyDraft(legalEntityId ?? ''));
      setDraftValid(null);
      setDraftFindings(null);
      setActionNotice(`Draft version created for "${draft.packKey}".`);
      load();
    } catch (err: any) {
      setActionError(err.body?.message ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  function updateRule(index: number, patch: Partial<RuleRow>) {
    setDraft((d) => ({ ...d, rules: d.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  }
  function addRule() {
    setDraft((d) => ({
      ...d,
      rules: [...d.rules, { ruleId: `rule-${d.rules.length + 1}`, priority: d.rules.length + 1, description: '', condition: null, blueprint: { memoTemplate: '', postingGroups: [] } }],
    }));
  }
  function removeRule(index: number) {
    setDraft((d) => ({ ...d, rules: d.rules.filter((_, i) => i !== index) }));
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        <p className="text-slate-600">Sign in to view Posting Rules.</p>
        <Link to="/login" className="text-[#0B5CAB] hover:underline">Sign in</Link>
      </div>
    );
  }

  // CE-07 legal-entity isolation defect — rule-pack governance has no
  // "consolidated"/all-entities view: every rule pack, draft, and
  // activation belongs to exactly one legal entity, so this screen simply
  // cannot render (and must never silently fall back to "show everything")
  // until a specific entity is selected.
  if (!legalEntityId) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-6" data-testid="posting-rules-no-entity">
        <p className="text-slate-600">No legal entity selected. Posting rules are configured per legal entity.</p>
        <Link to="/golden-path/select-entity" className="text-[#0B5CAB] hover:underline">Select a legal entity</Link>
      </div>
    );
  }

  const selectedPack = filteredPacks.find((p) => p.pack.packKey === selectedPackKey) ?? null;

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-6" data-testid="posting-rules">
      <h1 className="text-xl font-semibold text-slate-900">Posting Rules</h1>
      <p className="text-[13px] text-slate-500 mt-1 max-w-[720px]">
        Author, validate and activate Posting DSL v1 rule-pack versions. Every activated version is
        immutable and requires a separate eligible user to activate it — the author of a draft can never
        activate their own version.
      </p>
      {/* CE-07 legal-entity isolation defect — the active legal entity is
          shown as authoritative, session-scoped context (never a filter the
          browser computes): every list/draft/activation call below is
          already scoped to exactly this entity server-side. */}
      <p className="text-[12px] text-slate-500 mt-1" data-testid="posting-rules-entity-context">
        Legal entity: <span className="font-medium text-slate-700">{legalEntityLabel ?? legalEntityId}</span>
      </p>

      {unauthorized ? (
        <UnauthorizedState testId="posting-rules-unauthorized" message={unauthorized} />
      ) : (
        <>
          <FilterBar>
            <FilterField label="Search pack key" width={200}>
              <input data-testid="posting-rules-filter-search" className={FILTER_CONTROL_CLASS} value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} />
            </FilterField>
            <FilterField label="Event family" width={200}>
              <select data-testid="posting-rules-filter-event-type" className={FILTER_CONTROL_CLASS} value={filterEventType} onChange={(e) => setFilterEventType(e.target.value)}>
                <option value="">All event types</option>
                {eventTypeOptions.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </FilterField>
            <FilterField label="Status" width={140}>
              <select data-testid="posting-rules-filter-status" className={FILTER_CONTROL_CLASS} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All statuses</option>
                {['DRAFT', 'VALIDATED', 'ACTIVE', 'SUPERSEDED', 'REJECTED'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </FilterField>
            <div className="flex-1" />
            <Btn size="sm" variant="primary" data-testid="posting-rules-new-draft" onClick={() => { setShowEditor(true); setActionError(null); setActionNotice(null); }}>
              New draft rule pack
            </Btn>
          </FilterBar>

          {actionNotice && <Banner kind="success" title={actionNotice} testId="posting-rules-notice" />}

          {loading && <LoadingState label="Loading rule packs…" testId="posting-rules-loading" rows={6} cols={4} />}
          {!loading && error && <ErrorState message={error} testId="posting-rules-error" onRetry={load} />}

          {!loading && !error && filteredPacks.length === 0 && (
            <EmptyState
              title="No rule packs found"
              message={packs.length === 0 ? 'No rule packs have been configured for this tenant yet.' : 'No rule packs match the current filters.'}
              testId="posting-rules-empty"
            />
          )}

          {!loading && !error && filteredPacks.length > 0 && (
            <div className="mt-4 overflow-x-auto border border-slate-200 rounded-md" data-testid="posting-rules-pack-list">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-3 h-9">Pack key</th>
                    <th className="px-3 h-9">Event type</th>
                    <th className="px-3 h-9">Legal entity</th>
                    <th className="px-3 h-9">Active version</th>
                    <th className="px-3 h-9">Versions</th>
                    <th className="px-3 h-9">Created by</th>
                    <th className="px-3 h-9"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPacks.map(({ pack, versions }) => {
                    const active = versions.find((v) => v.status === 'ACTIVE') ?? null;
                    const latest = versions[0] ?? null;
                    return (
                      <tr key={pack.id} className="h-9 border-t border-slate-100 hover:bg-slate-50" data-testid={`posting-rules-pack-${pack.packKey}`}>
                        <td className="px-3 font-medium text-slate-900">{pack.packKey}</td>
                        <td className="px-3">{latest?.eventType ?? '—'}</td>
                        <td className="px-3">{latest?.entityId ?? '—'}</td>
                        <td className="px-3">
                          {active ? <Badge variant="success">{active.semver}</Badge> : <span className="text-slate-400">none active</span>}
                        </td>
                        <td className="px-3">{versions.length}</td>
                        <td className="px-3">{pack.createdBy}</td>
                        <td className="px-3">
                          <button
                            data-testid={`posting-rules-select-${pack.packKey}`}
                            className="text-[#0B5CAB] hover:underline"
                            onClick={() => setSelectedPackKey(pack.packKey)}
                          >
                            View versions →
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selectedPack && (
            <div className="mt-6" data-testid="posting-rules-version-history">
              <SectionLabel>{selectedPack.pack.packKey} — Version History</SectionLabel>
              <div className="overflow-x-auto border border-slate-200 rounded-md">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 h-9">Semver</th>
                      <th className="px-3 h-9">Status</th>
                      <th className="px-3 h-9">Effective from</th>
                      <th className="px-3 h-9">Effective to</th>
                      <th className="px-3 h-9">Content hash</th>
                      <th className="px-3 h-9">Created</th>
                      <th className="px-3 h-9"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPack.versions.map((v) => (
                      <tr key={v.id} className="h-9 border-t border-slate-100 hover:bg-slate-50" data-testid={`posting-rules-version-row-${v.id}`}>
                        <td className="px-3 font-mono">{v.semver}</td>
                        <td className="px-3"><Badge variant={STATUS_VARIANT[v.status] ?? 'neutral'} data-testid={`posting-rules-version-status-${v.id}`}>{v.status}</Badge></td>
                        <td className="px-3">{v.effectiveFrom?.slice(0, 10)}</td>
                        <td className="px-3">{v.effectiveTo ? v.effectiveTo.slice(0, 10) : '—'}</td>
                        <td className="px-3 font-mono text-[11px]">{v.contentHash.slice(0, 12)}…</td>
                        <td className="px-3">{formatDateTime(v.createdAt)}</td>
                        <td className="px-3">
                          <button data-testid={`posting-rules-view-${v.id}`} className="text-[#0B5CAB] hover:underline" onClick={() => openVersionDrawer(v)}>
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Version detail drawer: validation results, activation ceremony, replay-relevant lineage, audit diff ── */}
      <Drawer
        open={!!drawerVersion}
        onClose={() => setDrawerVersion(null)}
        title={drawerVersion ? `Version ${drawerVersion.semver}` : ''}
        subtitle={drawerVersion?.packKey}
        testId="posting-rules-version-drawer"
        actions={
          drawerVersion?.status === 'DRAFT' ? (
            <Btn size="sm" variant="primary" disabled={busy} data-testid={`posting-rules-validate-version-${drawerVersion.id}`} onClick={() => handleValidateVersion(drawerVersion)}>
              Validate
            </Btn>
          ) : drawerVersion?.status === 'VALIDATED' ? (
            <Btn size="sm" variant="primary" disabled={busy} data-testid={`posting-rules-activate-version-${drawerVersion.id}`} onClick={() => handleActivateVersion(drawerVersion)}>
              Activate
            </Btn>
          ) : undefined
        }
      >
        {drawerVersion && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Badge variant={STATUS_VARIANT[drawerVersion.status] ?? 'neutral'} data-testid="posting-rules-version-detail-status">{drawerVersion.status}</Badge>
              {(drawerVersion.status === 'ACTIVE' || drawerVersion.status === 'SUPERSEDED') && (
                <span className="text-[12px] text-slate-500">immutable</span>
              )}
            </div>

            {actionError && <Banner kind="error" title="Action failed" testId="posting-rules-action-error">{actionError}</Banner>}

            <DrawerRow label="Event type" value={drawerVersion.eventType} />
            <DrawerRow label="Legal entity" value={drawerVersion.entityId} />
            <DrawerRow label="Journal source" value={drawerVersion.journalSourceCode} />
            <DrawerRow label="Match strategy" value={drawerVersion.matchStrategy} />
            <DrawerRow label="No-match behavior" value={drawerVersion.noMatchBehavior} />
            <DrawerRow label="Created by" value={drawerVersion.createdBy} />
            <DrawerRow label="Created at" value={formatDateTime(drawerVersion.createdAt)} />
            <DrawerRow label="Validated at" value={formatDateTime(drawerVersion.validatedAt)} />
            {drawerVersion.activatedBy && (
              <>
                <DrawerRow label="Activated by" value={drawerVersion.activatedBy} />
                <DrawerRow label="Activated at" value={formatDateTime(drawerVersion.activatedAt)} />
              </>
            )}
            <DrawerRow label="Content hash" value={<span className="font-mono text-[11px]">{drawerVersion.contentHash}</span>} />

            {drawerVersion.validationFindings && drawerVersion.validationFindings.length > 0 && (
              <div className="mt-3" data-testid="posting-rules-findings">
                <SectionLabel>Validation Findings</SectionLabel>
                <ul className="space-y-1">
                  {drawerVersion.validationFindings.map((f, i) => (
                    <li key={i} data-testid={`posting-rules-finding-${i}`} className={`text-[12px] ${f.severity === 'ERROR' ? 'text-red-700' : 'text-amber-700'}`}>
                      [{f.severity}] {f.code} @ {f.path}: {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3">
              <SectionLabel>Rules ({drawerVersion.definition?.rules?.length ?? 0})</SectionLabel>
              <div className="space-y-2">
                {(drawerVersion.definition?.rules ?? []).map((r) => (
                  <div key={r.ruleId} className="border border-slate-200 rounded p-2 text-[12px]">
                    <div className="font-medium">{r.ruleId} <span className="text-slate-400 font-normal">priority {r.priority}</span></div>
                    <div className="text-slate-500">{r.description}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3" data-testid="posting-rules-audit-diff">
              <SectionLabel>Before / After Audit Trail</SectionLabel>
              {drawerAuditError ? (
                <p className="text-[12px] text-slate-500">{drawerAuditError}</p>
              ) : drawerAudit === null ? (
                <p className="text-[12px] text-slate-500">Loading audit history…</p>
              ) : drawerAudit.length === 0 ? (
                <p className="text-[12px] text-slate-500" data-testid="posting-rules-audit-empty">No audit events recorded for this version yet.</p>
              ) : (
                <ol className="space-y-2">
                  {drawerAudit.map((a) => (
                    <li key={a.id} className="text-[12px] border-l-2 border-slate-200 pl-2">
                      <div className="font-medium">{a.action} <span className="text-slate-400 font-normal">— {a.actor} — {formatDateTime(a.occurredAt ?? a.createdAt)}</span></div>
                      {(a.before != null || a.after != null) && (
                        <div className="grid grid-cols-2 gap-2 mt-1">
                          <div>
                            <div className="text-[10px] uppercase text-slate-400">Before</div>
                            <pre className="bg-slate-50 border border-slate-200 rounded p-1.5 overflow-x-auto">{JSON.stringify(a.before, null, 2) ?? '—'}</pre>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase text-slate-400">After</div>
                            <pre className="bg-slate-50 border border-slate-200 rounded p-1.5 overflow-x-auto">{JSON.stringify(a.after, null, 2) ?? '—'}</pre>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </Drawer>

      {/* ── New draft: structured mapping editor ── */}
      <Drawer
        open={showEditor}
        onClose={() => setShowEditor(false)}
        title="New draft rule-pack version"
        subtitle="Posting DSL v1"
        testId="posting-rules-editor-drawer"
        actions={
          <>
            <Btn size="sm" variant="secondary" disabled={busy} data-testid="posting-rules-validate-draft" onClick={handleValidateDraft}>Validate</Btn>
            <Btn size="sm" variant="primary" disabled={busy || !draft.packKey || !draft.eventType} data-testid="posting-rules-save-draft" onClick={handleSaveDraft}>Save draft</Btn>
          </>
        }
      >
        {actionError && <Banner kind="error" title="Could not save" testId="posting-rules-editor-error">{actionError}</Banner>}
        {draftValid !== null && (
          <Banner kind={draftValid ? 'success' : 'warning'} title={draftValid ? 'Valid — no errors found.' : 'Invalid — see findings below.'} testId="posting-rules-draft-valid" />
        )}
        {draftFindings && draftFindings.length > 0 && (
          <ul className="mt-2 space-y-1" data-testid="posting-rules-draft-findings">
            {draftFindings.map((f, i) => (
              <li key={i} data-testid={`posting-rules-draft-finding-${i}`} className={`text-[12px] ${f.severity === 'ERROR' ? 'text-red-700' : 'text-amber-700'}`}>
                [{f.severity}] {f.code} @ {f.path}: {f.message}
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className="text-[12px] text-slate-600">
            Pack key
            <input data-testid="posting-rules-draft-pack-key" className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={draft.packKey} onChange={(e) => setDraft({ ...draft, packKey: e.target.value })} />
          </label>
          <label className="text-[12px] text-slate-600">
            Semver
            <input className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={draft.semver} onChange={(e) => setDraft({ ...draft, semver: e.target.value })} />
          </label>
          <label className="text-[12px] text-slate-600">
            Event type
            <input data-testid="posting-rules-draft-event-type" className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={draft.eventType} onChange={(e) => setDraft({ ...draft, eventType: e.target.value })} />
          </label>
          <label className="text-[12px] text-slate-600">
            Journal source code
            <input className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={draft.journalSourceCode} onChange={(e) => setDraft({ ...draft, journalSourceCode: e.target.value })} />
          </label>
          <label className="text-[12px] text-slate-600">
            Legal entity
            {/* CE-07 legal-entity isolation defect — fixed to the session's
                own authoritative legalEntityId, never a free-text field: the
                browser must not be able to author a draft claiming a
                DIFFERENT entity than the one it is actually authorized/
                scoped for. The server independently re-enforces this via
                authz scope on the create-draft route regardless. */}
            <input
              data-testid="posting-rules-draft-entity-id"
              className={`${FILTER_CONTROL_CLASS} block w-full mt-1 bg-slate-50 text-slate-500`}
              value={draft.entityId ? `${draft.entityId}${legalEntityLabel ? ` (${legalEntityLabel})` : ''}` : ''}
              readOnly
              disabled
            />
          </label>
          <label className="text-[12px] text-slate-600">
            Tenant scope
            <input className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={draft.tenantScope} onChange={(e) => setDraft({ ...draft, tenantScope: e.target.value })} />
          </label>
          <label className="text-[12px] text-slate-600">
            Effective from
            <input type="date" className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={draft.effectiveFrom?.slice(0, 10)} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} />
          </label>
          <label className="text-[12px] text-slate-600">
            Effective to
            <input type="date" className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={draft.effectiveTo?.slice(0, 10) ?? ''} onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value || null })} />
          </label>
          <label className="text-[12px] text-slate-600">
            Match strategy
            <select className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={draft.matchStrategy} onChange={(e) => setDraft({ ...draft, matchStrategy: e.target.value })}>
              <option value="FIRST_MATCH">FIRST_MATCH</option>
              <option value="MOST_SPECIFIC">MOST_SPECIFIC</option>
            </select>
          </label>
          <label className="text-[12px] text-slate-600">
            No-match behavior
            <select className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={draft.noMatchBehavior} onChange={(e) => setDraft({ ...draft, noMatchBehavior: e.target.value })}>
              <option value="NO_RULE_MATCH_EXCEPTION">NO_RULE_MATCH_EXCEPTION</option>
            </select>
          </label>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between">
            <SectionLabel>Rules</SectionLabel>
            <Btn size="sm" variant="secondary" onClick={addRule}>+ Add rule</Btn>
          </div>
          <div className="space-y-3">
            {draft.rules.map((r, i) => (
              <div key={i} className="border border-slate-200 rounded p-2.5" data-testid={`posting-rules-draft-rule-${i}`}>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-slate-500">
                    Rule ID
                    <input className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={r.ruleId} onChange={(e) => updateRule(i, { ruleId: e.target.value })} />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Priority
                    <input type="number" className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={r.priority} onChange={(e) => updateRule(i, { priority: Number(e.target.value) })} />
                  </label>
                </div>
                <label className="text-[11px] text-slate-500 block mt-2">
                  Description
                  <input className={`${FILTER_CONTROL_CLASS} block w-full mt-1`} value={r.description} onChange={(e) => updateRule(i, { description: e.target.value })} />
                </label>
                <label className="text-[11px] text-slate-500 block mt-2">
                  Condition (JSON, optional — null matches unconditionally)
                  <textarea
                    className="block w-full mt-1 text-[11px] font-mono border border-slate-300 rounded p-1.5"
                    rows={2}
                    value={JSON.stringify(r.condition, null, 2)}
                    onChange={(e) => { try { updateRule(i, { condition: JSON.parse(e.target.value) }); } catch { /* keep typing until valid JSON */ } }}
                  />
                </label>
                <label className="text-[11px] text-slate-500 block mt-2">
                  Blueprint (JSON — memo template + debit/credit allocations or dynamic line-item paths)
                  <textarea
                    className="block w-full mt-1 text-[11px] font-mono border border-slate-300 rounded p-1.5"
                    rows={6}
                    value={JSON.stringify(r.blueprint, null, 2)}
                    onChange={(e) => { try { updateRule(i, { blueprint: JSON.parse(e.target.value) }); } catch { /* keep typing until valid JSON */ } }}
                  />
                </label>
                {draft.rules.length > 1 && (
                  <button className="text-[11px] text-red-600 hover:underline mt-2" onClick={() => removeRule(i)}>Remove rule</button>
                )}
              </div>
            ))}
          </div>
        </div>
      </Drawer>

      <p className="mt-6 text-[13px]">
        <Link to="/accounting/gl/posting-executions" className="text-[#0B5CAB] hover:underline">Go to Posting Executions →</Link>
      </p>
    </div>
  );
}
