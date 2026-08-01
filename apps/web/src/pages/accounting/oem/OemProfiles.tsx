import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, ShieldCheck } from 'lucide-react';
import { oemApi } from '../../../api/client';
import { PageHeader, Btn, Badge } from '../../../components/ui';
import { Banner, LoadingState, EmptyState, ErrorState, UnauthorizedState } from '../../../components/report';

// CE-14 S098 — OEM Profiles & Adapter Status. Per-make cards with the
// truthful connectionStatus enum (NOT_CONFIGURED/TEST_ONLY/
// CERTIFICATION_PENDING/CERTIFIED — CERTIFIED only ever shown alongside its
// evidence ref), an import drop zone (feed or manual), and the immutable
// staged-document browser with UNPARSED flags + diff alerts. Permissions:
// oem.profile.view / oem.profile.manage, oem.staging.view / oem.staging.import.
const STATUS_VARIANT: Record<string, 'neutral' | 'warning' | 'info' | 'success'> = {
  NOT_CONFIGURED: 'neutral',
  TEST_ONLY: 'warning',
  CERTIFICATION_PENDING: 'info',
  CERTIFIED: 'success',
};

export default function OemProfiles() {
  const qc = useQueryClient();
  const [newMake, setNewMake] = useState('');
  const [importMake, setImportMake] = useState('FORD');
  const [importContent, setImportContent] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const profilesQ = useQuery({ queryKey: ['oem-profiles'], queryFn: () => oemApi.listProfiles(), retry: false });
  const stagedQ = useQuery({ queryKey: ['oem-staged-documents'], queryFn: () => oemApi.listStagedDocuments(), retry: false });
  const alertsQ = useQuery({ queryKey: ['oem-diff-alerts'], queryFn: () => oemApi.listDiffAlerts(), retry: false });

  async function createProfile() {
    if (!newMake.trim()) return;
    await oemApi.createProfile({ make: newMake.trim() });
    setNewMake('');
    qc.invalidateQueries({ queryKey: ['oem-profiles'] });
  }

  async function runImport() {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await oemApi.importFeed({ make: importMake, rawContent: importContent });
      setImportResult(
        res.deduped
          ? 'Byte-identical re-delivery — deduped, no new document created.'
          : `Imported document ${res.document.id}${res.diffAlert ? ' — a diff alert was raised (re-delivery differs from the prior version).' : ''}`,
      );
      qc.invalidateQueries({ queryKey: ['oem-staged-documents'] });
      qc.invalidateQueries({ queryKey: ['oem-diff-alerts'] });
    } catch (err: any) {
      setImportError(err.message);
    } finally {
      setImportBusy(false);
    }
  }

  if (profilesQ.error) {
    const status = (profilesQ.error as any)?.status;
    if (status === 401 || status === 403) {
      return <div className="p-7"><UnauthorizedState testId="oem-profiles-unauthorized" message="You do not have the oem.profile.view permission required to view OEM Profiles. Contact your Controller or Admin." /></div>;
    }
    return <div className="p-7"><ErrorState testId="oem-profiles-error" message={(profilesQ.error as Error).message} onRetry={() => profilesQ.refetch()} /></div>;
  }

  return (
    <div className="p-7 min-h-full" data-testid="oem-profiles-page">
      <PageHeader
        title="OEM Profiles & Adapter Status"
        subtitle="Per-make connection status is truthful: CERTIFIED only ever appears with a recorded certification evidence reference. No path here fabricates factory acknowledgment (S098)."
      />

      <div className="flex items-center gap-2 mb-4">
        <input
          className="h-8 px-3 text-sm border border-slate-200 rounded-lg"
          placeholder="New make (e.g. HONDA)"
          value={newMake}
          onChange={(e) => setNewMake(e.target.value)}
          data-testid="oem-new-make-input"
        />
        <Btn size="sm" variant="secondary" onClick={createProfile} data-testid="oem-create-profile-btn">Add profile</Btn>
      </div>

      {profilesQ.isLoading ? (
        <LoadingState label="Loading OEM profiles..." testId="oem-profiles-loading" />
      ) : !profilesQ.data?.length ? (
        <EmptyState testId="oem-profiles-empty" title="No OEM profiles configured" message="Add a make above to begin — every capability ships truthfully labeled until certification evidence is recorded." />
      ) : (
        <div className="grid grid-cols-3 gap-3 mb-6" data-testid="oem-profiles-grid">
          {profilesQ.data.map((p: any) => (
            <div key={p.id} className="border border-slate-200 rounded-lg p-4" data-testid={`oem-profile-card-${p.make}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-slate-900">{p.make}</span>
                <Badge variant={STATUS_VARIANT[p.connectionStatus]}>{p.connectionStatus}</Badge>
              </div>
              <p className="text-xs text-slate-500">Spec version: {p.statementSpecVersion ?? 'not set'}</p>
              <p className="text-xs text-slate-500">Dealer codes: {p.dealerCodes?.length ?? 0} store(s)</p>
              {p.connectionStatus === 'CERTIFIED' && (
                <p className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1"><ShieldCheck size={12} /> evidence: {p.certificationEvidenceRef}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <PageHeader title="Import" subtitle="Feed import through a registered make adapter, or manual entry for any make (S098: manual import always available)." />
      <div className="border border-slate-200 rounded-lg p-4 mb-6" data-testid="oem-import-panel">
        <div className="flex items-center gap-2 mb-2">
          <select className="h-8 px-2 text-sm border border-slate-200 rounded-lg" value={importMake} onChange={(e) => setImportMake(e.target.value)} data-testid="oem-import-make-select">
            {(profilesQ.data ?? []).map((p: any) => <option key={p.make} value={p.make}>{p.make}</option>)}
          </select>
          <Btn size="sm" variant="primary" icon={<Upload size={14} />} onClick={runImport} loading={importBusy} data-testid="oem-import-submit-btn">
            Import fixture feed
          </Btn>
        </div>
        <textarea
          className="w-full h-28 text-xs font-mono border border-slate-200 rounded-lg p-2"
          placeholder="HEADER|FORD|REMITTANCE|FS-2026-07-001|2.1|F12345&#10;REMIT|C-1001|450.00|..."
          value={importContent}
          onChange={(e) => setImportContent(e.target.value)}
          data-testid="oem-import-content-textarea"
        />
        {importResult && <Banner kind="success" testId="oem-import-result-banner" title={importResult} />}
        {importError && <ErrorState testId="oem-import-error" message={importError} />}
      </div>

      {!!alertsQ.data?.length && (
        <>
          <PageHeader title="Diff alerts" subtitle="A re-delivered document differed from its staged predecessor — field-level comparison, never silently overwritten." />
          <div className="space-y-2 mb-6" data-testid="oem-diff-alerts-list">
            {alertsQ.data.map((a: any) => (
              <div key={a.id} className="border border-amber-200 bg-amber-50 rounded-lg p-3" data-testid={`oem-diff-alert-${a.id}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-amber-900">Diff alert — {a.fieldDiffs.length} field(s) changed</span>
                  {!a.resolvedAt && (
                    <Btn size="sm" variant="secondary" onClick={async () => { await oemApi.resolveDiffAlert(a.id); qc.invalidateQueries({ queryKey: ['oem-diff-alerts'] }); }} data-testid={`oem-diff-alert-resolve-${a.id}`}>
                      Mark reviewed
                    </Btn>
                  )}
                </div>
                <ul className="text-xs text-amber-800 mt-1 font-mono">
                  {a.fieldDiffs.slice(0, 6).map((d: any, i: number) => (
                    <li key={i}>{d.path}: {JSON.stringify(d.before)} → {JSON.stringify(d.after)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}

      <PageHeader title="Staged documents" subtitle="Immutable raw + parsed rows. UNPARSED rows are staged, never dropped or guessed." />
      {stagedQ.isLoading ? (
        <LoadingState label="Loading staged documents..." testId="oem-staged-loading" />
      ) : !stagedQ.data?.length ? (
        <EmptyState testId="oem-staged-empty" title="No staged documents yet" message="Import a feed or manual statement above." />
      ) : (
        <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden" data-testid="oem-staged-table">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="text-left p-2">Make</th><th className="text-left p-2">Kind</th><th className="text-left p-2">Source</th><th className="text-left p-2">Rows</th><th className="text-left p-2">UNPARSED</th><th className="text-left p-2">Imported</th></tr>
          </thead>
          <tbody>
            {stagedQ.data.map((d: any) => (
              <tr key={d.id} className="border-t border-slate-100" data-testid={`oem-staged-row-${d.id}`}>
                <td className="p-2">{d.make}</td>
                <td className="p-2">{d.kind}</td>
                <td className="p-2">{d.sourceType}</td>
                <td className="p-2">{d.rows?.length ?? 0}</td>
                <td className="p-2">{d.rows?.filter((r: any) => r.parseStatus === 'UNPARSED').length > 0 ? (
                  <Badge variant="warning">{d.rows.filter((r: any) => r.parseStatus === 'UNPARSED').length} UNPARSED</Badge>
                ) : <span className="text-slate-400">0</span>}</td>
                <td className="p-2 text-xs text-slate-500">{new Date(d.importedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
