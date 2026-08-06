export type ScrubSeverity = 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO';

export interface ScrubRule {
  code: string;
  severity: ScrubSeverity;
  description: string;
}

export interface ScrubFindingResult {
  ruleCode: string;
  severity: ScrubSeverity;
  description: string;
  sourceRef?: string;
}

export const DEFAULT_RULES: ScrubRule[] = [
  { code: 'UNPOSTED_JOURNALS', severity: 'ERROR', description: 'Unposted journal entries exist for the period' },
  { code: 'UNRECONCILED_ACCOUNTS', severity: 'ERROR', description: 'Reconciliation register has unreconciled accounts' },
  { code: 'MISSING_EVIDENCE', severity: 'WARNING', description: 'Reconciliation items missing evidence' },
  { code: 'STALE_RATES', severity: 'WARNING', description: 'Translation rates may be stale' },
  { code: 'OPEN_FINDINGS', severity: 'INFO', description: 'Open scrub findings from previous runs' },
];

export function runScrubRules(
  _rules: ScrubRule[],
  context: { unpostedJournals: number; unreconciledAccounts: number; missingEvidence: number; staleRates: boolean; openFindings: number }
): ScrubFindingResult[] {
  const findings: ScrubFindingResult[] = [];
  if (context.unpostedJournals > 0) findings.push({ ruleCode: 'UNPOSTED_JOURNALS', severity: 'ERROR', description: `${context.unpostedJournals} unposted journal entries`, sourceRef: 'gl-service' });
  if (context.unreconciledAccounts > 0) findings.push({ ruleCode: 'UNRECONCILED_ACCOUNTS', severity: 'ERROR', description: `${context.unreconciledAccounts} unreconciled accounts` });
  if (context.missingEvidence > 0) findings.push({ ruleCode: 'MISSING_EVIDENCE', severity: 'WARNING', description: `${context.missingEvidence} items missing evidence` });
  if (context.staleRates) findings.push({ ruleCode: 'STALE_RATES', severity: 'WARNING', description: 'Translation rates older than 1 day' });
  if (context.openFindings > 0) findings.push({ ruleCode: 'OPEN_FINDINGS', severity: 'INFO', description: `${context.openFindings} open findings from previous runs` });
  return findings;
}
