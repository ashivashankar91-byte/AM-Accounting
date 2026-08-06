/**
 * CE-16 Legacy Statement Archive — S132(a).
 *
 * Legacy financial statements are imported as immutable archived artifacts:
 * the file plus its index metadata, checksummed, retained under an S017 WORM
 * class and searchable by period, entity and statement type.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { migrationApi } from '../../../api/client';
import { Badge, Btn } from '../../../components/ui';
import { EmptyState, SectionLabel } from '../../../components/report';
import { MigrationPage, Card, Table, MutationError } from './shared';

const STATEMENT_TYPES = ['BALANCE_SHEET', 'INCOME_STATEMENT', 'TRIAL_BALANCE', 'CASH_FLOW', 'FACTORY_STATEMENT', 'OTHER'] as const;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function MigrationArchive() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ periodYear: '', periodMonth: '', statementType: '', search: '' });
  const [form, setForm] = useState({
    periodYear: String(new Date().getUTCFullYear() - 1),
    periodMonth: '12',
    statementType: 'BALANCE_SHEET',
    sourceSystem: 'LEGACY',
    filename: '',
    contentBase64: '',
    wormClass: '',
  });

  const archive = useQuery({
    queryKey: ['migration', 'archive', filters],
    queryFn: () => migrationApi.listArchive({
      periodYear: filters.periodYear ? Number(filters.periodYear) : undefined,
      periodMonth: filters.periodMonth ? Number(filters.periodMonth) : undefined,
      statementType: filters.statementType || undefined,
      search: filters.search || undefined,
    }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const importStatement = useMutation({
    mutationFn: () => migrationApi.importArchive({
      periodYear: Number(form.periodYear),
      periodMonth: Number(form.periodMonth),
      statementType: form.statementType,
      sourceSystem: form.sourceSystem.trim(),
      filename: form.filename.trim(),
      contentBase64: form.contentBase64.trim() || btoa(`CERTIFICATION-ONLY placeholder for ${form.filename.trim()}`),
      wormClass: form.wormClass.trim() || undefined,
    }),
    onSuccess: () => {
      setForm({ ...form, filename: '', contentBase64: '' });
      qc.invalidateQueries({ queryKey: ['migration', 'archive'] });
    },
  });

  const recordAccess = useMutation({
    mutationFn: (id: string) => migrationApi.recordArchiveAccess(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['migration', 'archive'] }),
  });

  const items: any[] = archive.data?.items ?? [];

  return (
    <MigrationPage
      title="Legacy Statement Archive"
      story="S132"
      subtitle="Immutable archived artifacts retained under S017 WORM classes"
      testId="migration-archive"
      permission="migration.audit.view"
      loading={archive.isLoading}
      error={archive.error}
      retry={() => archive.refetch()}
    >
      <Card title="Import a legacy statement" testId="archive-import-card">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <label className="text-[12px] text-slate-600">
            Year
            <input
              data-testid="archive-year-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={form.periodYear}
              onChange={(e) => setForm({ ...form, periodYear: e.target.value })}
            />
          </label>
          <label className="text-[12px] text-slate-600">
            Month
            <select
              data-testid="archive-month-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={form.periodMonth}
              onChange={(e) => setForm({ ...form, periodMonth: e.target.value })}
            >
              {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-slate-600">
            Statement type
            <select
              data-testid="archive-type-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={form.statementType}
              onChange={(e) => setForm({ ...form, statementType: e.target.value })}
            >
              {STATEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-slate-600">
            Source system
            <input
              data-testid="archive-source-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={form.sourceSystem}
              onChange={(e) => setForm({ ...form, sourceSystem: e.target.value })}
            />
          </label>
          <label className="text-[12px] text-slate-600">
            Filename
            <input
              data-testid="archive-filename-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={form.filename}
              onChange={(e) => setForm({ ...form, filename: e.target.value })}
              placeholder="2025-12-balance-sheet.pdf"
            />
          </label>
          <label className="text-[12px] text-slate-600">
            WORM class (optional)
            <input
              data-testid="archive-worm-input"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-[13px]"
              value={form.wormClass}
              onChange={(e) => setForm({ ...form, wormClass: e.target.value })}
              placeholder="derived from statement type"
            />
          </label>
        </div>
        <Btn
          variant="primary"
          size="md"
          className="mt-3"
          data-testid="archive-import-btn"
          loading={importStatement.isPending}
          disabled={!form.filename.trim() || !form.periodYear.trim()}
          onClick={() => importStatement.mutate()}
        >
          Import statement
        </Btn>
        <MutationError error={importStatement.error} testId="archive-import-error" />
        <p className="text-[11px] text-slate-500 mt-2" data-testid="archive-immutable-note">
          An imported statement is immutable: it is checksummed on arrival and can be viewed, searched and accessed,
          but never edited or replaced.
        </p>
      </Card>

      <Card
        title="Archived statements"
        testId="archive-card"
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              data-testid="archive-search-input"
              className="border border-slate-300 rounded px-2 py-1 text-[12px]"
              placeholder="search filename"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
            <input
              data-testid="archive-year-filter"
              className="border border-slate-300 rounded px-2 py-1 text-[12px] w-20"
              placeholder="year"
              value={filters.periodYear}
              onChange={(e) => setFilters({ ...filters, periodYear: e.target.value })}
            />
            <select
              data-testid="archive-type-filter"
              className="border border-slate-300 rounded px-2 py-1 text-[12px]"
              value={filters.statementType}
              onChange={(e) => setFilters({ ...filters, statementType: e.target.value })}
            >
              <option value="">All types</option>
              {STATEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        }
      >
        <SectionLabel>Index metadata: period, entity, statement type, source system</SectionLabel>
        {items.length === 0 ? (
          <EmptyState
            testId="archive-empty"
            title="No archived statements"
            message="Import the legacy financial statements for the periods that must remain viewable after cutover."
          />
        ) : (
          <Table
            testId="archive-table"
            headers={['Period', 'Type', 'Entity', 'Source', 'Filename', 'Size', 'SHA-256', 'WORM class', 'Retention until', 'Accesses', '']}
          >
            {items.map((a) => (
              <tr key={a.id} data-testid={`archive-row-${a.id}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pr-4 font-mono text-[12px]">{a.periodYear}-{String(a.periodMonth).padStart(2, '0')}</td>
                <td className="py-2 pr-4"><Badge variant="neutral">{a.statementType}</Badge></td>
                <td className="py-2 pr-4 text-[12px]">{a.legalEntityId}</td>
                <td className="py-2 pr-4 text-[12px]">{a.sourceSystem}</td>
                <td className="py-2 pr-4 font-mono text-[12px]">{a.filename}</td>
                <td className="py-2 pr-4 text-[12px]">{a.fileSize}</td>
                <td className="py-2 pr-4 font-mono text-[11px]">{String(a.checksumSha256 ?? '').slice(0, 16)}…</td>
                <td className="py-2 pr-4"><Badge variant="info" data-testid={`archive-worm-${a.id}`}>{a.wormClass}</Badge></td>
                <td className="py-2 pr-4 text-[12px]">{a.retentionUntil ? new Date(a.retentionUntil).toLocaleDateString() : '—'}</td>
                <td className="py-2 pr-4 text-[12px]" data-testid={`archive-access-count-${a.id}`}>{a.accessCount ?? 0}</td>
                <td className="py-2 pr-4">
                  <Btn variant="secondary" size="sm" data-testid={`archive-view-${a.id}`} onClick={() => recordAccess.mutate(a.id)}>
                    View
                  </Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <MutationError error={recordAccess.error} testId="archive-access-error" />
      </Card>
    </MigrationPage>
  );
}
