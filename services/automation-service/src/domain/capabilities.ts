/**
 * CE-17 — The 14 canonical capabilities.
 *
 * Each capability declares its authority *ceiling*. The ceiling is not a
 * suggestion: a grant above it is refused at config-save time, so no operator
 * can quietly hand AUTO_EXECUTE to an irreversible or statutory-adjacent
 * capability by editing a row.
 */

import { AuthorityLevel } from './authority';

export interface CapabilityDefinition {
  code: string;
  storyId: string;
  label: string;
  /** Highest authority this capability may ever hold. */
  ceiling: AuthorityLevel;
  /** Effects that cannot be undone by a compensating entry alone. */
  irreversible: boolean;
  /** Touches statutory / tax-elected treatment — never fully automated. */
  statutoryAdjacent: boolean;
  /** True when this capability may never post or mutate anything at all. */
  zeroMutation: boolean;
  /** Requires a human adoption ceremony before its output can be used. */
  requiresAdoptionCeremony: boolean;
  /** Requires two distinct approvers before it may execute. */
  dualAuthorization: boolean;
}

export const CAPABILITIES: CapabilityDefinition[] = [
  {
    code: 'S022_RULE_SANDBOX', storyId: 'S022', label: 'Rule Simulation Sandbox',
    ceiling: 'AUTO_EXECUTE_WITHIN_POLICY',
    irreversible: false, statutoryAdjacent: false, zeroMutation: true,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S040_OCR_INGESTION', storyId: 'S040', label: 'OCR/EDI Invoice Ingestion',
    ceiling: 'AUTO_EXECUTE_WITHIN_POLICY',
    irreversible: false, statutoryAdjacent: false, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S058_LOCKBOX_MATCHING', storyId: 'S058', label: 'Lockbox AI Remittance Matching',
    ceiling: 'AUTO_EXECUTE_WITHIN_POLICY',
    irreversible: false, statutoryAdjacent: false, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S073_LIFO_OVERLAY', storyId: 'S073', label: 'LIFO Overlay',
    ceiling: 'EXECUTE_WITH_APPROVAL',
    irreversible: false, statutoryAdjacent: true, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S091B_CHARGEBACK_MODEL', storyId: 'S091B', label: 'Experience-Rated Chargeback Model',
    ceiling: 'RECOMMEND',
    irreversible: false, statutoryAdjacent: false, zeroMutation: false,
    requiresAdoptionCeremony: true, dualAuthorization: false,
  },
  {
    code: 'S095_PORTFOLIO_RESERVE', storyId: 'S095', label: 'Retro/Portfolio Reserve Accrual',
    ceiling: 'EXECUTE_WITH_APPROVAL',
    irreversible: false, statutoryAdjacent: false, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S096_CESSION', storyId: 'S096', label: 'Reinsurance/DOWC Cession',
    ceiling: 'EXECUTE_WITH_APPROVAL',
    irreversible: false, statutoryAdjacent: true, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S101B_OEM_MATCHER', storyId: 'S101B', label: 'OEM Statement Auto-Matcher',
    ceiling: 'AUTO_EXECUTE_WITHIN_POLICY',
    irreversible: false, statutoryAdjacent: false, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S103B_INCENTIVE_ACCRUAL', storyId: 'S103B', label: 'Probability-Weighted Incentive Accruals',
    ceiling: 'EXECUTE_WITH_APPROVAL',
    irreversible: false, statutoryAdjacent: false, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S107_COMPOSITE_EXPORT', storyId: 'S107', label: 'NCM/NADA Composite Export',
    ceiling: 'EXECUTE_WITH_APPROVAL',
    irreversible: false, statutoryAdjacent: false, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S118_GAAP_MEMO', storyId: 'S118', label: 'GAAP Bridge Memo Generator',
    ceiling: 'PREPARE_DRAFT',
    irreversible: false, statutoryAdjacent: true, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S126_DSAR', storyId: 'S126', label: 'DSAR Automation',
    ceiling: 'EXECUTE_WITH_APPROVAL',
    irreversible: true, statutoryAdjacent: true, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: true,
  },
  {
    code: 'S127_UNCLAIMED_PROPERTY', storyId: 'S127', label: 'Unclaimed Property Module',
    ceiling: 'EXECUTE_WITH_APPROVAL',
    irreversible: false, statutoryAdjacent: true, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
  {
    code: 'S128_SOX_EVIDENCE', storyId: 'S128', label: 'SOX Evidence Automation',
    ceiling: 'EXECUTE_WITH_APPROVAL',
    irreversible: false, statutoryAdjacent: false, zeroMutation: false,
    requiresAdoptionCeremony: false, dualAuthorization: false,
  },
];

export const CAPABILITY_BY_CODE = new Map(CAPABILITIES.map((c) => [c.code, c]));
export const CAPABILITY_BY_STORY = new Map(CAPABILITIES.map((c) => [c.storyId, c]));

export function requireCapabilityDefinition(code: string): CapabilityDefinition {
  const def = CAPABILITY_BY_CODE.get(code);
  if (!def) {
    const err: any = new Error(`Unknown automation capability ${code}`);
    err.name = 'UnknownCapabilityError';
    err.statusCode = 400;
    err.code = 'UNKNOWN_CAPABILITY';
    throw err;
  }
  return def;
}
