/**
 * CE-16 S129/S130/S131/S132 — shared test helpers for the migration screens.
 *
 * Every migration page is a react-query screen over `migrationApi`. These
 * helpers give each spec the same wrapper and a fully stubbed api surface so a
 * test only has to say what the *one* call it cares about returns.
 */
import React from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export const MIGRATION_API_METHODS = [
  'listRuns', 'createRun', 'getRun', 'transitionRun', 'getRunAudit', 'getReadiness', 'attestFreeze', 'markDeltaComplete',
  'listSources', 'registerSource', 'listSnapshots', 'registerSnapshot', 'listSnapshotFiles', 'importFile', 'listSnapshotRows',
  'listMappingSets', 'createMappingSet', 'getMappingSet', 'listMappingEntries', 'seedMappingSet', 'updateMappingEntry',
  'approveMappingEntry', 'freezeMappingSet', 'preview', 'stage', 'validate', 'listDatasets', 'listStagingRows',
  'listGates', 'listControlTotals', 'listExceptions', 'dispositionException', 'promote', 'listLineage',
  'listComparisons', 'createComparison', 'getComparison', 'classifyDiff', 'signOffComparison',
  'getCeremony', 'prepareCutover', 'approveCutover', 'executeCutover', 'rollback', 'getRestartPlan',
  'listArchive', 'importArchive', 'recordArchiveAccess',
  'listRunbookTemplates', 'createRunbookTemplate', 'listRunbooks', 'createRunbook', 'getRunbook', 'updateRunbookStep',
] as const;

export function makeMigrationApiMock() {
  const api: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of MIGRATION_API_METHODS) api[method] = vi.fn();
  return api;
}

/**
 * Factory body for `vi.mock('../../../api/client', ...)`.
 *
 * vi.mock factories are hoisted above imports, so a spec must reach this
 * through an async dynamic import rather than a top-level binding.
 */
export function migrationApiMockModule() {
  return { migrationApi: makeMigrationApiMock() };
}

/** A promise that never settles — the honest way to hold a screen in loading. */
export const pending = () => new Promise(() => {});

export function wrap(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        {ui}
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Resolves every stubbed method to an empty collection so a screen can mount. */
export function resolveAllEmpty(api: Record<string, any>) {
  for (const method of MIGRATION_API_METHODS) {
    api[method].mockResolvedValue({ items: [], total: 0 });
  }
}
