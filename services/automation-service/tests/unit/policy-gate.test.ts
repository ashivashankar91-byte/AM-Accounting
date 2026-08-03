/**
 * The policy gate is the one place in CE-17 where "may this act?" is decided,
 * so it is tested as a pure function against every refusal it can produce —
 * including the two that matter most in practice: an unknown answer from an
 * upstream is a refusal, and a capability whose class is irreversible can never
 * be talked into unattended execution however generous the numbers are.
 */

import { describe, it, expect } from 'vitest';
import { evaluatePolicy, assertPolicyAllows, PolicyEvaluationInput, PolicyGateConfig } from '../../src/domain/policy-gate-evaluator';
import { requireCapabilityDefinition } from '../../src/domain/capabilities';

const GATE: PolicyGateConfig = {
  monetaryLimit: '10000.00',
  confidenceMin: '0.9000',
  allowedExceptionCategories: ['ROUNDING'],
  highRiskCategories: ['MANUAL_OVERRIDE'],
  circuitBreakerThreshold: 3,
  policyVersion: '1.0',
};

function baseInput(overrides: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  return {
    capability: requireCapabilityDefinition('S101B_OEM_MATCHER'),
    authority: 'AUTO_EXECUTE_WITHIN_POLICY',
    gate: GATE,
    itemLegalEntityId: 'LE-1',
    requestLegalEntityId: 'LE-1',
    amount: '100.00',
    confidence: '0.9900',
    exceptionCategory: null,
    periodClosed: false,
    accountMappingComplete: true,
    statutorySupported: true,
    alreadyApprovedBy: null,
    automationIdentity: 'automation:ce17',
    circuitBreakerCount: 0,
    capabilitySuspended: false,
    ...overrides,
  };
}

describe('policy gate evaluation', () => {
  it('allows an in-policy action at AUTO and records a full trace', () => {
    const result = evaluatePolicy(baseInput());
    expect(result.allowed).toBe(true);
    expect(result.effectiveState).toBe('EXECUTION_PENDING');
    expect(result.checks.length).toBeGreaterThanOrEqual(11);
    expect(result.checks.every((c) => c.detail.length > 0)).toBe(true);
    expect(result.policyVersion).toBe('1.0');
  });

  it('refuses a suspended capability before looking at anything else', () => {
    const result = evaluatePolicy(baseInput({ capabilitySuspended: true }));
    expect(result.allowed).toBe(false);
    expect(result.effectiveState).toBe('SUSPENDED');
    expect(result.refusalGate).toBe('CAPABILITY_SUSPENDED');
    // The refusal is immediate: no monetary or confidence check was even run.
    expect(result.checks.map((c) => c.gate)).toEqual(['CAPABILITY_SUSPENDED']);
  });

  it('refuses when no policy gate has been activated', () => {
    const result = evaluatePolicy(baseInput({ gate: null }));
    expect(result.allowed).toBe(false);
    expect(result.refusalGate).toBe('POLICY_GATE_CONFIGURED');
  });

  it('refuses an amount over the monetary limit', () => {
    const result = evaluatePolicy(baseInput({ amount: '10000.01' }));
    expect(result.refusalGate).toBe('MONETARY_LIMIT');
    expect(result.refusalReason).toContain('10000.01');
  });

  it('applies the monetary limit to the absolute value, so a large credit is refused too', () => {
    const result = evaluatePolicy(baseInput({ amount: '-25000.00' }));
    expect(result.refusalGate).toBe('MONETARY_LIMIT');
  });

  it('refuses confidence below the configured floor', () => {
    const result = evaluatePolicy(baseInput({ confidence: '0.8999' }));
    expect(result.refusalGate).toBe('CONFIDENCE_THRESHOLD');
  });

  it('refuses a missing confidence score when a floor is configured', () => {
    const result = evaluatePolicy(baseInput({ confidence: null }));
    expect(result.refusalGate).toBe('CONFIDENCE_THRESHOLD');
    expect(result.refusalReason).toContain('carries no confidence score');
  });

  it('refuses a closed period', () => {
    const result = evaluatePolicy(baseInput({ periodClosed: true }));
    expect(result.refusalGate).toBe('CLOSED_PERIOD');
  });

  it('refuses when the period close state is unknown rather than assuming it is open', () => {
    const result = evaluatePolicy(baseInput({ periodClosed: null }));
    expect(result.refusalGate).toBe('CLOSED_PERIOD');
    expect(result.refusalReason).toContain('could not be determined');
  });

  it('refuses a missing account mapping', () => {
    const result = evaluatePolicy(baseInput({ accountMappingComplete: false }));
    expect(result.refusalGate).toBe('MISSING_ACCOUNT_MAPPING');
  });

  it('refuses when mapping completeness is unknown rather than guessing an account', () => {
    const result = evaluatePolicy(baseInput({ accountMappingComplete: null }));
    expect(result.refusalGate).toBe('MISSING_ACCOUNT_MAPPING');
    expect(result.refusalReason).toContain('guessed account');
  });

  it('refuses an unsupported statutory treatment rather than approximating it', () => {
    const result = evaluatePolicy(baseInput({ statutorySupported: false }));
    expect(result.refusalGate).toBe('STATUTORY_SUPPORTED');
  });

  it('refuses a cross-entity action even when the numbers are in policy', () => {
    const result = evaluatePolicy(baseInput({ requestLegalEntityId: 'LE-2' }));
    expect(result.refusalGate).toBe('CROSS_ENTITY');
    expect(result.refusalReason).toContain('LE-2');
  });

  it('refuses once the circuit breaker threshold is reached', () => {
    const result = evaluatePolicy(baseInput({ circuitBreakerCount: 3 }));
    expect(result.refusalGate).toBe('CIRCUIT_BREAKER');
  });

  it('refuses an exception category outside the permitted set', () => {
    const result = evaluatePolicy(baseInput({ exceptionCategory: 'UNKNOWN_CATEGORY' }));
    expect(result.refusalGate).toBe('EXCEPTION_CATEGORY');
  });

  it('permits an exception category that is explicitly allowed', () => {
    const result = evaluatePolicy(baseInput({ exceptionCategory: 'ROUNDING' }));
    expect(result.allowed).toBe(true);
  });

  it('refuses below EXECUTE_WITH_APPROVAL authority', () => {
    for (const authority of ['OBSERVE_ONLY', 'RECOMMEND', 'PREPARE_DRAFT'] as const) {
      const result = evaluatePolicy(baseInput({ authority }));
      expect(result.allowed, authority).toBe(false);
      expect(result.refusalGate, authority).toBe('AUTHORITY_SUFFICIENT');
    }
  });

  it('requires approval at EXECUTE_WITH_APPROVAL even when every gate passes', () => {
    const result = evaluatePolicy(baseInput({ authority: 'EXECUTE_WITH_APPROVAL' }));
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.effectiveState).toBe('APPROVAL_REQUIRED');
  });

  it('proceeds at EXECUTE_WITH_APPROVAL once a human other than automation has approved', () => {
    const result = evaluatePolicy(baseInput({ authority: 'EXECUTE_WITH_APPROVAL', alreadyApprovedBy: 'user-approver' }));
    expect(result.allowed).toBe(true);
    expect(result.effectiveState).toBe('EXECUTION_PENDING');
  });

  it('does not accept the automation identity as its own approver', () => {
    const result = evaluatePolicy(baseInput({
      authority: 'EXECUTE_WITH_APPROVAL',
      alreadyApprovedBy: 'automation:ce17',
    }));
    expect(result.allowed).toBe(false);
    expect(result.effectiveState).toBe('APPROVAL_REQUIRED');
  });

  it('forces approval for an irreversible capability even at AUTO authority', () => {
    const result = evaluatePolicy(baseInput({
      capability: requireCapabilityDefinition('S126_DSAR'),
      authority: 'AUTO_EXECUTE_WITHIN_POLICY',
    }));
    expect(result.allowed).toBe(false);
    expect(result.effectiveState).toBe('APPROVAL_REQUIRED');
    expect(result.refusalReason).toContain('irreversible');
  });

  it('forces approval for a high-risk exception category even at AUTO authority', () => {
    const result = evaluatePolicy(baseInput({
      exceptionCategory: 'MANUAL_OVERRIDE',
      gate: { ...GATE, allowedExceptionCategories: ['MANUAL_OVERRIDE'] },
    }));
    expect(result.effectiveState).toBe('APPROVAL_REQUIRED');
    expect(result.refusalReason).toContain('high-risk');
  });

  it('is deterministic: the same input yields the same verdict and trace', () => {
    const input = baseInput({ amount: '9999.99' });
    const a = evaluatePolicy(input);
    const b = evaluatePolicy(input);
    expect(a.allowed).toBe(b.allowed);
    expect(a.checks.map((c) => `${c.gate}:${c.passed}`)).toEqual(b.checks.map((c) => `${c.gate}:${c.passed}`));
  });

  it('evaluates every gate rather than stopping at the first failure, so the trace is complete', () => {
    const result = evaluatePolicy(baseInput({
      amount: '99999.00',
      confidence: '0.10',
      periodClosed: true,
      accountMappingComplete: false,
      statutorySupported: false,
    }));
    const failed = result.checks.filter((c) => !c.passed).map((c) => c.gate);
    expect(failed).toContain('MONETARY_LIMIT');
    expect(failed).toContain('CONFIDENCE_THRESHOLD');
    expect(failed).toContain('CLOSED_PERIOD');
    expect(failed).toContain('MISSING_ACCOUNT_MAPPING');
    expect(failed).toContain('STATUTORY_SUPPORTED');
  });

  it('assertPolicyAllows throws a typed refusal carrying the trace', () => {
    const refused = evaluatePolicy(baseInput({ amount: '50000.00' }));
    expect(() => assertPolicyAllows(refused)).toThrowError(/exceeds the configured limit/);

    const suspended = evaluatePolicy(baseInput({ capabilitySuspended: true }));
    expect(() => assertPolicyAllows(suspended)).toThrowError(/SUSPENDED/i);

    const approval = evaluatePolicy(baseInput({ authority: 'EXECUTE_WITH_APPROVAL' }));
    expect(() => assertPolicyAllows(approval)).toThrowError(/approval/i);

    expect(() => assertPolicyAllows(evaluatePolicy(baseInput()))).not.toThrow();
  });
});
