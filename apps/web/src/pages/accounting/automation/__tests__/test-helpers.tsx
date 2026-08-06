/**
 * CE-17 — shared test helpers for the automation screens.
 *
 * Every automation page is a react-query screen over `automationApi`. These
 * helpers give each spec the same wrapper and a fully stubbed api surface, so
 * a test only has to say what the *one* call it cares about returns.
 */
import React from 'react';
import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export const AUTOMATION_API_METHODS = [
  'getOverview', 'emergencyStop',
  'listCapabilities', 'getCapability', 'configureCapability', 'grantAuthority', 'activateAuthority', 'suspendCapability',
  'listPolicies', 'getEffectivePolicy', 'savePolicy', 'activatePolicy',
  'listItems', 'getItem', 'getItemLineage', 'evaluateItem', 'claimItem', 'approveItem', 'rejectItem',
  'executeItem', 'retryItem', 'reverseItem',
  'getHealthMetrics', 'listVersions', 'getVersion', 'recordVersion',
  'listSandboxes', 'getSandbox', 'getSandboxDiff', 'runSandbox',
  'listIngestionDrafts', 'getIngestionDraft', 'createIngestionDraft', 'acceptIngestionDraft', 'rejectIngestionDraft',
  'listLockboxFiles', 'listLockboxLines', 'ingestLockboxFile', 'reviewLockboxLine',
  'listLifoPools', 'createLifoPool', 'computeLifoLayer', 'approveLifoLayer',
  'listChargebackModels', 'getChargebackModel', 'runChargebackModel', 'adoptChargebackModel',
  'listPortfolioStatements', 'getPortfolioStatement', 'enterPortfolioStatement', 'allocatePortfolioStatement', 'approvePortfolioStatement',
  'listCessionStatements', 'getCessionStatement', 'getCessionPosition', 'enterCessionStatement', 'approveCessionStatement',
  'listOemSuggestions', 'generateOemSuggestions', 'disposeOemSuggestion',
  'listIncentiveRecommendations', 'getIncentiveRecommendation', 'computeIncentiveRecommendation',
  'approveIncentiveRecommendation', 'rejectIncentiveRecommendation',
  'listExports', 'getExport', 'getExportBaselineStatus', 'generateExport', 'approveExport', 'recordExportResponse',
  'listMemos', 'getMemo', 'draftMemo', 'editMemo', 'finalizeMemo',
  'listDsarCases', 'getDsarCase', 'createDsarCase', 'scanDsarCase', 'produceDsarDisclosure',
  'authorizeDsarErasure', 'executeDsarErasure', 'closeDsarCase',
  'listUnclaimedProperty', 'getUnclaimedPropertyItem', 'identifyUnclaimedProperty', 'recordDueDiligence', 'prepareRemittance',
  'listControls', 'registerControl', 'listBinders', 'getBinder', 'harvestBinder', 'attestBinder',
] as const;

export function makeAutomationApiMock() {
  const api: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of AUTOMATION_API_METHODS) api[method] = vi.fn();
  return api;
}

/**
 * Factory body for `vi.mock('../../../../api/client', ...)`.
 *
 * vi.mock factories are hoisted above imports, so a spec must reach this
 * through an async dynamic import rather than a top-level binding.
 */
export function automationApiMockModule() {
  return { automationApi: makeAutomationApiMock() };
}

/** A promise that never settles — the honest way to hold a screen in loading. */
export const pending = () => new Promise(() => {});

/** An error shaped the way `apiFetch` shapes a refusal. */
export function refusal(status: number, message: string): Error {
  const err: any = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
}

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
  for (const method of AUTOMATION_API_METHODS) {
    api[method].mockResolvedValue({ items: [], total: 0 });
  }
}
