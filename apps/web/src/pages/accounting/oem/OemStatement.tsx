import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { oemApi } from '../../../api/client';
import { PageHeader, Btn, Badge, MoneyCell } from '../../../components/ui';
import { LoadingState, EmptyState, ErrorState, UnauthorizedState, Banner } from '../../../components/report';

// CE-14 S104 — OEM Financial Statement. Profile selector + period, rendered
// statement w/ cell drill, validation panel (cross-foot + TB tie, loud
// variance), export history, profile-mapping admin tab (governed
// authorship, author != activator). Permissions: oem.statement.view /
// oem.statement.render / oem.statement.mapping.author / .activate.
export default function OemStatement() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'render' | 'mappings'>('render');
  const [storeId, setStoreId] = useState('STORE-1');
  const [profileId, setProfileId] = useState('');
  const [period, setPeriod] = useState('2026-07');
  const [renderId, setRenderId] = useState<string | null>(null);
  const [drillCell, setDrillCell] = useState<{ lineRef: string; contributingAccounts: string[] } | null>(null);
  const [glAccountId, setGlAccountId] = useState('');
  const [lineRef, setLineRef] = useState('');
  const [mappingActionError, setMappingActionError] = useState<string | null>(null);
  const [newProfileMake, setNewProfileMake] = useState('FORD');
  const [newProfileVersion, setNewProfileVersion] = useState('1.0');
  const [createProfileError, setCreateProfileError] = useState<string | null>(null);

  const profilesQ = useQuery({ queryKey: ['oem-statement-profiles'], queryFn: () => oemApi.listStatementProfiles(), retry: false });
  const mappingsQ = useQuery({ queryKey: ['oem-statement-mappings', profileId], queryFn: () => oemApi.listStatementMappings(profileId), enabled: !!profileId, retry: false });
  const renderQ = useQuery({ queryKey: ['oem-statement-render', renderId], queryFn: () => oemApi.getStatementRender(renderId!), enabled: !!renderId, retry: false });
  const exportsQ = useQuery({ queryKey: ['oem-statement-exports', renderId], queryFn: () => oemApi.listStatementExports(renderId ?? undefined), retry: false });

  const [renderError, setRenderError] = useState<string | null>(null);

  async function doRender(injectVariance?: string) {
    setRenderError(null);
    try {
      const r = await oemApi.renderStatement({ storeId, statementProfileId: profileId, period, injectVarianceForCertification: injectVariance });
      setRenderId(r.id);
    } catch (err: any) { setRenderError(err.message); }
  }

  async function doDrill(ref: string) {
    if (!renderId) return;
    const d = await oemApi.drillStatementCell(renderId, ref);
    setDrillCell(d);
  }

  async function doExport() {
    if (!renderId) return;
    await oemApi.exportStatementRender(renderId);
    qc.invalidateQueries({ queryKey: ['oem-statement-exports'] });
  }

  // Statement-spec page/line definitions are versioned, factory-doc-sourced
  // configuration (package "THE OEM BOUNDARY") — this fixture shape (net
  // Revenue/COGS lines rolling into a Gross Profit total) is a labeled
  // TEST_ONLY stand-in, not a claim about a real factory statement layout.
  const FIXTURE_PAGE_LINE_DEFS = {
    lines: [
      { lineRef: 'REVENUE', label: 'Revenue', section: 'INCOME' },
      { lineRef: 'COGS', label: 'Cost of Goods Sold', section: 'INCOME' },
    ],
    totals: [
      { lineRef: 'GROSS_PROFIT', label: 'Gross Profit', componentLineRefs: ['REVENUE', 'COGS'] },
    ],
  };

  async function createProfile() {
    setCreateProfileError(null);
    try {
      const p = await oemApi.createStatementProfile({
        make: newProfileMake, version: newProfileVersion,
        pageLineDefinitions: FIXTURE_PAGE_LINE_DEFS, effectiveFrom: new Date().toISOString().slice(0, 10),
      });
      setProfileId(p.id);
      qc.invalidateQueries({ queryKey: ['oem-statement-profiles'] });
    } catch (err: any) { setCreateProfileError(err.message); }
  }

  async function authorMapping() {
    if (!profileId || !glAccountId || !lineRef) return;
    await oemApi.authorStatementMapping(profileId, { glAccountId, statementLineRef: lineRef });
    setGlAccountId(''); setLineRef('');
    qc.invalidateQueries({ queryKey: ['oem-statement-mappings', profileId] });
  }

  async function activateMapping(id: string) {
    setMappingActionError(null);
    try {
      await oemApi.activateStatementMapping(id);
      qc.invalidateQueries({ queryKey: ['oem-statement-mappings', profileId] });
    } catch (err: any) {
      // SoD boundary: the real backend check is against the authenticated
      // actor, not a UI-supplied name — the author cannot activate their
      // own mapping, surfaced here rather than simulated client-side.
      setMappingActionError(err.message);
    }
  }

  if (profilesQ.error) {
    const status = (profilesQ.error as any)?.status;
    if (status === 401 || status === 403) {
      return <div className="p-7"><UnauthorizedState testId="oem-statement-unauthorized" message="You do not have the oem.statement.view permission required to view the OEM Financial Statement." /></div>;
    }
    return <div className="p-7"><ErrorState testId="oem-statement-error" message={(profilesQ.error as Error).message} onRetry={() => profilesQ.refetch()} /></div>;
  }

  const render = renderQ.data;
  const cells = render ? Object.entries(render.cellValues as Record<string, number>).filter(([k]) => !k.startsWith('__')) : [];

  return (
    <div className="p-7 min-h-full" data-testid="oem-statement-page">
      <PageHeader title="OEM Financial Statement" subtitle="Rendered from the same ledger truth as the trial balance. Absent profile content blocks rendering truthfully — never approximated (S104)." />

      <div className="flex gap-2 mb-4">
        <button className={`text-xs px-3 py-1.5 rounded-full border ${tab === 'render' ? 'border-brand bg-brand-light text-brand' : 'border-slate-200'}`} onClick={() => setTab('render')} data-testid="oem-statement-tab-render">Render</button>
        <button className={`text-xs px-3 py-1.5 rounded-full border ${tab === 'mappings' ? 'border-brand bg-brand-light text-brand' : 'border-slate-200'}`} onClick={() => setTab('mappings')} data-testid="oem-statement-tab-mappings">Account mapping admin</button>
      </div>

      <div className="flex items-center gap-2 mb-4 border border-slate-200 rounded-lg p-3" data-testid="oem-statement-create-profile-panel">
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-24" value={newProfileMake} onChange={(e) => setNewProfileMake(e.target.value)} placeholder="Make" data-testid="oem-statement-new-profile-make-input" />
        <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-20" value={newProfileVersion} onChange={(e) => setNewProfileVersion(e.target.value)} placeholder="Version" data-testid="oem-statement-new-profile-version-input" />
        <Btn size="sm" variant="secondary" onClick={createProfile} data-testid="oem-statement-create-profile-btn">Author statement profile (fixture spec)</Btn>
      </div>
      {createProfileError && <ErrorState testId="oem-statement-create-profile-error" message={createProfileError} />}

      {profilesQ.isLoading ? (
        <LoadingState label="Loading statement profiles..." testId="oem-statement-profiles-loading" />
      ) : !profilesQ.data?.length ? (
        <EmptyState testId="oem-statement-profiles-empty" title="No statement profile authored yet" message="Statement-spec content is versioned, factory-doc-sourced configuration — none exists for this tenant yet." />
      ) : (
        <div className="flex items-center gap-2 mb-4">
          <select className="h-8 px-2 text-sm border border-slate-200 rounded-lg" value={profileId} onChange={(e) => { setProfileId(e.target.value); setRenderId(null); }} data-testid="oem-statement-profile-select">
            <option value="">Select a profile...</option>
            {profilesQ.data.map((p: any) => <option key={p.id} value={p.id}>{p.make} v{p.version}</option>)}
          </select>
          {tab === 'render' && <>
            <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-24" value={storeId} onChange={(e) => setStoreId(e.target.value)} data-testid="oem-statement-store-input" />
            <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg w-24" value={period} onChange={(e) => setPeriod(e.target.value)} data-testid="oem-statement-period-input" />
            <Btn size="sm" variant="primary" onClick={() => doRender()} disabled={!profileId} data-testid="oem-statement-render-btn">Render</Btn>
            <Btn size="sm" variant="danger" onClick={() => doRender('500.00')} disabled={!profileId} data-testid="oem-statement-inject-variance-btn">Render with injected TEST variance</Btn>
          </>}
        </div>
      )}

      {tab === 'mappings' && profileId && (
        <div data-testid="oem-statement-mappings-panel">
          <div className="flex items-center gap-2 mb-3">
            <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg" placeholder="GL account" value={glAccountId} onChange={(e) => setGlAccountId(e.target.value)} data-testid="oem-mapping-gl-input" />
            <input className="h-8 px-2 text-sm border border-slate-200 rounded-lg" placeholder="Statement line ref" value={lineRef} onChange={(e) => setLineRef(e.target.value)} data-testid="oem-mapping-line-input" />
            <Btn size="sm" variant="secondary" onClick={authorMapping} data-testid="oem-mapping-author-btn">Author (draft)</Btn>
          </div>
          {mappingActionError && <ErrorState testId="oem-mapping-action-error" message={mappingActionError} />}
          {!mappingsQ.data?.length ? (
            <EmptyState testId="oem-mappings-empty" title="Blank until authored" message="No account mapping authored yet for this profile — truthful, not approximated." />
          ) : (
            <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="text-left p-2">GL account</th><th className="text-left p-2">Line</th><th className="text-left p-2">Status</th><th className="text-left p-2">Authored by</th><th className="text-left p-2">Action</th></tr></thead>
              <tbody>
                {mappingsQ.data.map((m: any) => (
                  <tr key={m.id} className="border-t border-slate-100" data-testid={`oem-mapping-row-${m.id}`}>
                    <td className="p-2">{m.glAccountId}</td><td className="p-2">{m.statementLineRef}</td>
                    <td className="p-2"><Badge variant={m.status === 'ACTIVE' ? 'success' : 'neutral'}>{m.status}</Badge></td>
                    <td className="p-2 text-xs">{m.authoredBy}</td>
                    <td className="p-2">
                      {m.status === 'DRAFT' && <Btn size="sm" variant="secondary" onClick={() => activateMapping(m.id)} data-testid={`oem-mapping-activate-${m.id}`}>Activate</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'render' && renderError && <ErrorState testId="oem-statement-render-error" message={renderError} />}

      {tab === 'render' && render && (
        <div className="mt-4" data-testid="oem-statement-render-result">
          <div className="flex gap-2 mb-3">
            <Badge variant={render.crossFootOk ? 'success' : 'danger'}>{render.crossFootOk ? 'Cross-foot OK' : 'Cross-foot FAILED'}</Badge>
            <Badge variant={render.tbTieOk ? 'success' : 'danger'}>{render.tbTieOk ? 'TB tie OK' : 'TB VARIANCE'}</Badge>
            <Btn size="sm" variant="secondary" onClick={doExport} data-testid="oem-statement-export-btn">Export</Btn>
          </div>
          {!render.tbTieOk && (
            <Banner kind="error" testId="oem-statement-variance-banner" title={`Variance detected: ${render.varianceAmount}`}>
              This statement does not tie to the trial balance — rendered with a loud banner rather than silently balanced.
            </Banner>
          )}
          <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden mt-3">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="text-left p-2">Line</th><th className="text-left p-2">Value</th><th className="text-left p-2">Drill</th></tr></thead>
            <tbody>
              {cells.map(([ref, val]) => (
                <tr key={ref} className="border-t border-slate-100" data-testid={`oem-statement-cell-${ref}`}>
                  <td className="p-2 font-mono text-xs">{ref}</td>
                  <td className="p-2"><MoneyCell value={val} /></td>
                  <td className="p-2"><Btn size="sm" variant="ghost" onClick={() => doDrill(ref)} data-testid={`oem-statement-drill-${ref}`}>Drill</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
          {drillCell && (
            <div className="mt-2 text-xs text-slate-600" data-testid="oem-statement-drill-result">
              {drillCell.lineRef}: GL accounts {drillCell.contributingAccounts.join(', ') || '(none)'}
            </div>
          )}
        </div>
      )}

      {!!exportsQ.data?.length && (
        <div className="mt-6" data-testid="oem-statement-export-history">
          <PageHeader title="Export history" />
          <ul className="text-xs text-slate-600 space-y-1">
            {exportsQ.data.map((e: any) => <li key={e.id}>{e.specVersion} — {e.format} — {new Date(e.exportedAt).toLocaleString()} — retained: {String(e.retained)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
