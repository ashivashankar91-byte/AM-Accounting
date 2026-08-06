/**
 * CE-17 — Deterministic policy gate evaluation.
 *
 * This is the single place where "may this automation act?" is answered. It is
 * pure: same inputs, same verdict, every time, with a trace an auditor can
 * replay. The service layer gathers the facts; this file decides. Nothing here
 * reads a database or a clock beyond what it is handed.
 *
 * Order matters. A suspended capability is refused before its money is even
 * looked at, and an irreversible capability can never reach AUTO no matter how
 * generous the numbers are.
 */

import { AuthorityLevel, authorityRank } from './authority';
import { CapabilityDefinition } from './capabilities';
import { PolicyGateViolationError, ApprovalRequiredError, CapabilitySuspendedError } from './errors';

export type Money = string | number | null | undefined;

export interface PolicyGateConfig {
  monetaryLimit: Money;
  confidenceMin: Money;
  allowedExceptionCategories: string[];
  highRiskCategories: string[];
  circuitBreakerThreshold: number;
  policyVersion: string;
}

export interface PolicyEvaluationInput {
  capability: CapabilityDefinition;
  authority: AuthorityLevel;
  gate: PolicyGateConfig | null;
  /** Entity the item belongs to, and the entity the caller is scoped to. */
  itemLegalEntityId: string;
  requestLegalEntityId: string;
  amount: Money;
  confidence: Money;
  exceptionCategory?: string | null;
  periodClosed: boolean | null;
  /** null = the mapping service could not be consulted; that is a refusal. */
  accountMappingComplete: boolean | null;
  statutorySupported: boolean;
  alreadyApprovedBy?: string | null;
  automationIdentity: string;
  circuitBreakerCount: number;
  capabilitySuspended: boolean;
}

export interface GateCheck {
  gate: string;
  passed: boolean;
  detail: string;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  requiresApproval: boolean;
  effectiveState: 'EXECUTION_PENDING' | 'APPROVAL_REQUIRED' | 'FAILED_CLOSED' | 'SUSPENDED';
  checks: GateCheck[];
  refusalGate?: string;
  refusalReason?: string;
  policyVersion: string;
  evaluatedAt: string;
}

/** Decimal-safe comparison. Money arrives as a NUMERIC string from Postgres. */
export function toNumber(value: Money): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function pass(gate: string, detail: string): GateCheck {
  return { gate, passed: true, detail };
}

function fail(gate: string, detail: string): GateCheck {
  return { gate, passed: false, detail };
}

/**
 * Evaluates every gate and returns a complete trace — it never short-circuits
 * on the first failure, because "which gates would also have refused this" is
 * exactly the question a reviewer asks next.
 */
export function evaluatePolicy(input: PolicyEvaluationInput): PolicyEvaluationResult {
  const checks: GateCheck[] = [];
  const evaluatedAt = new Date().toISOString();
  const policyVersion = input.gate?.policyVersion ?? 'UNVERSIONED';

  // 1 — capability must not be SUSPENDED.
  if (input.capabilitySuspended || input.authority === 'SUSPENDED') {
    checks.push(fail('CAPABILITY_SUSPENDED', 'Capability is SUSPENDED and may not act.'));
    return {
      allowed: false, requiresApproval: false, effectiveState: 'SUSPENDED', checks,
      refusalGate: 'CAPABILITY_SUSPENDED', refusalReason: 'Capability is SUSPENDED and may not act.',
      policyVersion, evaluatedAt,
    };
  }
  checks.push(pass('CAPABILITY_SUSPENDED', 'Capability is not suspended.'));

  // 2 — a capability with no activated policy gate has nothing to be measured
  //     against, and an unmeasured automation does not execute.
  if (!input.gate) {
    checks.push(fail('POLICY_GATE_CONFIGURED', 'No activated policy gate for this capability.'));
  } else {
    checks.push(pass('POLICY_GATE_CONFIGURED', `Policy gate ${input.gate.policyVersion} is active.`));
  }

  // 3 — authority must reach at least EXECUTE_WITH_APPROVAL to touch anything.
  const rank = authorityRank(input.authority);
  const canExecuteAtAll = rank >= authorityRank('EXECUTE_WITH_APPROVAL');
  checks.push(canExecuteAtAll
    ? pass('AUTHORITY_SUFFICIENT', `Authority ${input.authority} permits execution.`)
    : fail('AUTHORITY_SUFFICIENT', `Authority ${input.authority} is below EXECUTE_WITH_APPROVAL; this capability may only observe, recommend or draft.`));

  // 4 — monetary limit.
  const amount = toNumber(input.amount);
  const limit = toNumber(input.gate?.monetaryLimit);
  if (limit === null) {
    checks.push(pass('MONETARY_LIMIT', 'No monetary limit configured for this capability.'));
  } else if (amount === null) {
    checks.push(pass('MONETARY_LIMIT', 'Action carries no monetary effect.'));
  } else if (Math.abs(amount) > limit) {
    checks.push(fail('MONETARY_LIMIT', `Amount ${amount.toFixed(2)} exceeds the configured limit ${limit.toFixed(2)}.`));
  } else {
    checks.push(pass('MONETARY_LIMIT', `Amount ${amount.toFixed(2)} is within the limit ${limit.toFixed(2)}.`));
  }

  // 5 — confidence threshold.
  const confidence = toNumber(input.confidence);
  const minConfidence = toNumber(input.gate?.confidenceMin);
  if (minConfidence === null) {
    checks.push(pass('CONFIDENCE_THRESHOLD', 'No confidence threshold configured.'));
  } else if (confidence === null) {
    checks.push(fail('CONFIDENCE_THRESHOLD', `A confidence threshold of ${minConfidence} is configured but the item carries no confidence score.`));
  } else if (confidence < minConfidence) {
    checks.push(fail('CONFIDENCE_THRESHOLD', `Confidence ${confidence} is below the required minimum ${minConfidence}.`));
  } else {
    checks.push(pass('CONFIDENCE_THRESHOLD', `Confidence ${confidence} meets the minimum ${minConfidence}.`));
  }

  // 6 — closed period. An unknown period state is a refusal, not a pass.
  if (input.periodClosed === null) {
    checks.push(fail('CLOSED_PERIOD', 'Period close state could not be determined from CE-15; refusing rather than assuming the period is open.'));
  } else if (input.periodClosed) {
    checks.push(fail('CLOSED_PERIOD', 'The accounting period is closed; automation may not post into it.'));
  } else {
    checks.push(pass('CLOSED_PERIOD', 'The accounting period is open.'));
  }

  // 7 — account mapping completeness.
  if (input.accountMappingComplete === null) {
    checks.push(fail('MISSING_ACCOUNT_MAPPING', 'Account mapping completeness could not be determined; refusing rather than posting to a guessed account.'));
  } else if (!input.accountMappingComplete) {
    checks.push(fail('MISSING_ACCOUNT_MAPPING', 'One or more required account mappings are missing.'));
  } else {
    checks.push(pass('MISSING_ACCOUNT_MAPPING', 'All required account mappings are present.'));
  }

  // 8 — statutory support.
  checks.push(input.statutorySupported
    ? pass('STATUTORY_SUPPORTED', 'The statutory treatment required by this action is supported.')
    : fail('STATUTORY_SUPPORTED', 'The statutory treatment required by this action is not supported; automation refuses rather than approximating it.'));

  // 9 — cross-entity. An item belonging to one entity is never actioned under
  //     another entity's scope, whatever the body of the request says.
  checks.push(input.itemLegalEntityId === input.requestLegalEntityId
    ? pass('CROSS_ENTITY', `Legal entity scope matches (${input.itemLegalEntityId}).`)
    : fail('CROSS_ENTITY', `Item belongs to legal entity ${input.itemLegalEntityId} but the request is scoped to ${input.requestLegalEntityId}.`));

  // 10 — circuit breaker.
  const threshold = input.gate?.circuitBreakerThreshold ?? 5;
  checks.push(input.circuitBreakerCount < threshold
    ? pass('CIRCUIT_BREAKER', `${input.circuitBreakerCount} consecutive failures, threshold ${threshold}.`)
    : fail('CIRCUIT_BREAKER', `${input.circuitBreakerCount} consecutive failures reached the threshold ${threshold}; capability must be reviewed before acting again.`));

  // 11 — exception category allow-list.
  const category = input.exceptionCategory ?? null;
  const allowed = input.gate?.allowedExceptionCategories ?? [];
  if (!category) {
    checks.push(pass('EXCEPTION_CATEGORY', 'Action carries no exception category.'));
  } else if (allowed.length === 0) {
    checks.push(fail('EXCEPTION_CATEGORY', `Exception category ${category} is present but no categories are permitted for this capability.`));
  } else if (!allowed.includes(category)) {
    checks.push(fail('EXCEPTION_CATEGORY', `Exception category ${category} is not in the permitted set [${allowed.join(', ')}].`));
  } else {
    checks.push(pass('EXCEPTION_CATEGORY', `Exception category ${category} is permitted.`));
  }

  const refusal = checks.find((c) => !c.passed);
  if (refusal) {
    return {
      allowed: false, requiresApproval: false, effectiveState: 'FAILED_CLOSED', checks,
      refusalGate: refusal.gate, refusalReason: refusal.detail, policyVersion, evaluatedAt,
    };
  }

  // ── Everything passed. Now decide whether it still needs a human. ──────────

  const highRisk = category !== null && (input.gate?.highRiskCategories ?? []).includes(category);
  const irreversible = input.capability.irreversible;
  const belowAuto = rank < authorityRank('AUTO_EXECUTE_WITHIN_POLICY');

  // An irreversible capability is ceilinged at EXECUTE_WITH_APPROVAL by
  // definition; even if a row somehow says AUTO, it is treated as requiring
  // approval here. Defence in depth against a bad config surviving validation.
  const reasons: string[] = [];
  if (irreversible) reasons.push('capability class is irreversible');
  if (highRisk) reasons.push(`exception category ${category} is high-risk`);
  if (belowAuto) reasons.push(`authority ${input.authority} is below AUTO_EXECUTE_WITHIN_POLICY`);

  const needsApproval = reasons.length > 0;
  if (needsApproval) {
    checks.push(pass('APPROVAL_DISPOSITION', `Human approval required: ${reasons.join('; ')}.`));
  } else {
    checks.push(pass('APPROVAL_DISPOSITION', 'Within AUTO_EXECUTE_WITHIN_POLICY envelope; no separate approval required.'));
  }

  const hasApproval = Boolean(input.alreadyApprovedBy) && input.alreadyApprovedBy !== input.automationIdentity;
  if (needsApproval && !hasApproval) {
    return {
      allowed: false, requiresApproval: true, effectiveState: 'APPROVAL_REQUIRED', checks,
      refusalGate: 'APPROVAL_REQUIRED', refusalReason: `Human approval required: ${reasons.join('; ')}.`,
      policyVersion, evaluatedAt,
    };
  }

  return {
    allowed: true, requiresApproval: needsApproval, effectiveState: 'EXECUTION_PENDING',
    checks, policyVersion, evaluatedAt,
  };
}

/** Throws the typed refusal that matches an evaluation result. */
export function assertPolicyAllows(result: PolicyEvaluationResult): void {
  if (result.allowed) return;
  const detail = { checks: result.checks, policyVersion: result.policyVersion };
  if (result.effectiveState === 'SUSPENDED') {
    throw new CapabilitySuspendedError(result.refusalReason ?? 'Capability is suspended.', detail);
  }
  if (result.effectiveState === 'APPROVAL_REQUIRED') {
    throw new ApprovalRequiredError(result.refusalReason ?? 'Approval required.', detail);
  }
  throw new PolicyGateViolationError(result.refusalGate ?? 'UNKNOWN', result.refusalReason ?? 'Policy gate refused the action.', detail);
}
