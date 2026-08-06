/**
 * CE-16 Migration Sources — S130 source inventory.
 *
 * Registers the legacy systems and the extracts taken from them. Checksums are
 * declared by the importer and verified by the service; a duplicate file is
 * refused rather than silently re-imported.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { EmptyState, SectionLabel } from '../../../components/report';
import {
  MigrationPage, Card, Table, MutationError, stateVariant, UpstreamPendingBanner, PENDING_UPSTREAM,
} from './shared';

const SOURCE_TYPES = ['AUTOMATE', 'COMPETITOR'] as const;

export default function MigrationSources() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [form, setForm] = useState({ systemCode: '', systemName: '', sourceType: 'AUTOMATE' });
  const [snapForm, setSnapForm] = useState({ snapshotRef: '', isDelta: false });

  const sources = useQuery({
    queryKey: ['migration', 'sources'],
    queryFn: () => migrationApi.listSources(),
    retry: false,
  });

  const snapshots = useQuery({
    queryKey: ['migration', 'snapshots', selected],
    queryFn: () => migrationApi.listSnapshots(selected as string),
    enabled: Boolean(selected),
    retry: false,
  });

  const rows = useQuery({
    queryKey: ['migration', 'snapshot-rows', selected, selectedSnapshot],
    queryFn: () => migrationApi.listSnapshotRows(selected as string, selectedSnapshot as string, { limit: 25 }),
    enabled: Boolean(selected && selectedSnapshot),
    retry: false,
  });

  const files = useQuery({
    queryKey: ['migration', 'snapshot-files', selected, selectedSnapshot],
    queryFn: () => migrationApi.listSnapshotFiles(selected as string, selectedSnapshot as string),
    enabled: Boolean(selected && selectedSnapshot),
    retry: false,
  });

  const register = useMutation({
    mutationFn: () => migrationApi.registerSource({
      systemCode: form.systemCode.trim(),
      systemName: form.systemName.trim(),
      sourceType: form.sourceType,
    }),
    onSuccess: () => {
      setForm({ systemCode: '', systemName: '', sourceType: 'AUTOMATE' });
      qc.invalidateQueries({ queryKey: ['migration', 'sources'] });
    },
  });

  const registerSnapshot = useMutation({
    mutationFn: () => migrationApi.registerSnapshot(selected as string, {
      snapshotRef: snapForm.snapshotRef.trim(),
      extractedAt: new Date().toISOString(),
      isDelta: snapForm.isDelta,
    }),
    onSuccess: () => {
      setSnapForm({ snapshotRef: '', isDelta: false });
      qc.invalidateQueries({ queryKey: ['migration', 'snapshots'] });
    },
  });

  const systems: any[] = sources.data?.items ?? [];
  const configured = sources.data?.configured ?? systems.length > 0;
  const pendingModules = (sources.data?.upstreamSignals ?? [])
    .filter((s: any) => s.status === PENDING_UPSTREAM)
    .map((s: any) => s.moduleCode);

  return (
    <MigrationPage
      title="Migration Sources"
      story="S130"
      subtitle="Legacy system inventory, extracts and row-level inspection"
      testId="migration-sources"
      permission="migration.source.view"
      loading={sources.isLoading}
      error={sources.error}
      retry={() => sources.refetch()}
    >
      <UpstreamPendingBanner modules={pendingModules} testId="sources-upstream-pending" />

      <Card title="Register a legacy source system" testId="register-source-card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-[12px] text-slate-600">
            System code
            <input
              data-testid="source-code-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={form.systemCode}
              onChange={(e) => setForm({ ...form, systemCode: e.target.value })}
              placeholder="LEGACY-DMS"
            />
          </label>
          <label className="text-[12px] text-slate-600">
            System name
            <input
              data-testid="source-name-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={form.systemName}
              onChange={(e) => setForm({ ...form, systemName: e.target.value })}
              placeholder="Legacy Dealer Management System"
            />
          </label>
          <label className="text-[12px] text-slate-600">
            Source type
            <select
              data-testid="source-type-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={form.sourceType}
              onChange={(e) => setForm({ ...form, sourceType: e.target.value })}
            >
              {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div className="flex items-end">
            <Btn
              variant="primary"
              size="md"
              data-testid="register-source-btn"
              loading={register.isPending}
              disabled={!form.systemCode.trim() || !form.systemName.trim()}
              onClick={() => register.mutate()}
            >
              Register source
            </Btn>
          </div>
        </div>
        <MutationError error={register.error} testId="register-source-error" />
      </Card>

      <Card title="Registered source systems" testId="sources-card">
        {!configured || systems.length === 0 ? (
          <EmptyState
            testId="sources-not-configured"
            title="SOURCE_NOT_CONFIGURED"
            message="No legacy source system has been registered for this tenant. Register one above before any extract, mapping or staging work can begin."
          />
        ) : (
          <Table testId="sources-table" headers={['Code', 'Name', 'Type', 'Connection', 'Configured', '']}>
            {systems.map((s) => (
              <tr key={s.id} data-testid={`source-row-${s.systemCode}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{s.systemCode}</td>
                <td className="py-2 pr-4">{s.systemName}</td>
                <td className="py-2 pr-4">{s.sourceType}</td>
                <td className="py-2 pr-4"><Badge variant={stateVariant(s.connectionStatus)}>{s.connectionStatus}</Badge></td>
                <td className="py-2 pr-4 text-[12px]">{s.configuredAt ? new Date(s.configuredAt).toLocaleDateString() : '—'}</td>
                <td className="py-2 pr-4">
                  <Btn
                    variant={selected === s.id ? 'primary' : 'secondary'}
                    size="sm"
                    data-testid={`source-select-${s.systemCode}`}
                    onClick={() => { setSelected(s.id); setSelectedSnapshot(null); }}
                  >
                    {selected === s.id ? 'Selected' : 'Extracts'}
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {selected && (
        <Card title="Extracts (source snapshots)" testId="snapshots-card">
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <label className="text-[12px] text-slate-600">
              Snapshot reference
              <input
                data-testid="snapshot-ref-input"
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
                value={snapForm.snapshotRef}
                onChange={(e) => setSnapForm({ ...snapForm, snapshotRef: e.target.value })}
                placeholder="snapshot-2026-08-01"
              />
            </label>
            <label className="text-[12px] text-slate-600 flex items-center gap-2 pb-2">
              <input
                type="checkbox"
                data-testid="snapshot-delta-input"
                checked={snapForm.isDelta}
                onChange={(e) => setSnapForm({ ...snapForm, isDelta: e.target.checked })}
              />
              Delta extract
            </label>
            <Btn
              variant="primary"
              size="md"
              data-testid="register-snapshot-btn"
              loading={registerSnapshot.isPending}
              disabled={!snapForm.snapshotRef.trim()}
              onClick={() => registerSnapshot.mutate()}
            >
              Register extract
            </Btn>
          </div>
          <MutationError error={registerSnapshot.error} testId="register-snapshot-error" />

          {snapshots.isLoading && <p className="text-[13px] text-slate-500" data-testid="snapshots-loading">Loading extracts…</p>}
          {snapshots.error && <MutationError error={snapshots.error} testId="snapshots-error" />}
          {!snapshots.isLoading && !snapshots.error && (snapshots.data?.items ?? []).length === 0 && (
            <EmptyState testId="snapshots-empty" title="No extracts registered" message="Register an extract to import legacy rows into controlled staging." />
          )}
          {(snapshots.data?.items ?? []).length > 0 && (
            <Table testId="snapshots-table" headers={['Reference', 'Extracted', 'Files', 'Rows', 'Status', 'Delta', '']}>
              {(snapshots.data?.items ?? []).map((snap: any) => (
                <tr key={snap.id} data-testid={`snapshot-row-${snap.snapshotRef}`} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4 font-mono text-[12px]">{snap.snapshotRef}</td>
                  <td className="py-2 pr-4 text-[12px]">{snap.extractedAt ? new Date(snap.extractedAt).toLocaleString() : '—'}</td>
                  <td className="py-2 pr-4">{snap.fileCount ?? 0}</td>
                  <td className="py-2 pr-4">{snap.totalRows ?? 0}</td>
                  <td className="py-2 pr-4"><Badge variant={stateVariant(snap.status)}>{snap.status}</Badge></td>
                  <td className="py-2 pr-4">{snap.isDelta ? <Badge variant="info">DELTA</Badge> : '—'}</td>
                  <td className="py-2 pr-4">
                    <Btn
                      variant={selectedSnapshot === snap.id ? 'primary' : 'secondary'}
                      size="sm"
                      data-testid={`snapshot-inspect-${snap.snapshotRef}`}
                      onClick={() => setSelectedSnapshot(snap.id)}
                    >
                      Inspect rows
                    </Btn>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {selected && selectedSnapshot && (
        <Card title="Source rows" testId="source-rows-card">
          <SectionLabel>Imported files and verified checksums</SectionLabel>
          {(files.data?.items ?? []).length === 0 ? (
            <p className="text-[13px] text-slate-500 mb-4" data-testid="source-files-empty">
              No file has been imported into this extract yet.
            </p>
          ) : (
            <div className="mb-4">
              <Table testId="source-files-table" headers={['Filename', 'Rows', 'Size', 'SHA-256', 'Status']}>
                {(files.data?.items ?? []).map((f: any) => (
                  <tr key={f.id} data-testid={`source-file-${f.id}`} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 font-mono text-[12px]">{f.filename}</td>
                    <td className="py-2 pr-4">{f.rowCount}</td>
                    <td className="py-2 pr-4">{f.fileSize}</td>
                    <td className="py-2 pr-4 font-mono text-[11px] break-all">{f.checksumSha256}</td>
                    <td className="py-2 pr-4"><Badge variant={stateVariant(f.status)}>{f.status}</Badge></td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          <SectionLabel>Row-level inspection</SectionLabel>
          {rows.isLoading && <p className="text-[13px] text-slate-500" data-testid="source-rows-loading">Loading rows…</p>}
          {rows.error && <MutationError error={rows.error} testId="source-rows-error" />}
          {!rows.isLoading && !rows.error && (rows.data?.items ?? []).length === 0 && (
            <EmptyState testId="source-rows-empty" title="No rows imported" message="Import a file into this extract to inspect legacy rows." />
          )}
          {(rows.data?.items ?? []).length > 0 && (
            <Table testId="source-rows-table" headers={['#', 'Row hash', 'Status', 'Raw data', 'Error']}>
              {(rows.data?.items ?? []).map((r: any) => (
                <tr key={r.id} data-testid={`source-row-${r.rowIndex}`} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-4">{r.rowIndex}</td>
                  <td className="py-2 pr-4 font-mono text-[11px]">{String(r.rowHash ?? '').slice(0, 16)}…</td>
                  <td className="py-2 pr-4"><Badge variant={stateVariant(r.status)}>{r.status}</Badge></td>
                  <td className="py-2 pr-4 font-mono text-[11px] max-w-md truncate">{JSON.stringify(r.rawData)}</td>
                  <td className="py-2 pr-4 text-[12px] text-red-600">{r.errorReason ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="text-[11px] text-slate-500 mt-3" data-testid="sensitive-note">
            Sensitive legacy values are masked unless the caller holds migration.sensitive.view.
          </p>
        </Card>
      )}
    </MigrationPage>
  );
}
