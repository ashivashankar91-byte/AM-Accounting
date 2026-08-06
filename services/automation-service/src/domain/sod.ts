/**
 * CE-17 — Separation of duties.
 *
 * The single structural rule this epic exists to guarantee: an automation
 * identity cannot approve its own recommendation. Everything else here is the
 * same idea applied to grants, policies and attestations — whoever proposes is
 * never whoever blesses.
 */

import { SoDViolationError } from './errors';

/** Identities that belong to the automation itself, not to a person. */
const AUTOMATION_IDENTITY_PATTERN = /^(automation|agent|system|svc|service)[:\-.]/i;

/** The identity CE-17 acts under when it produces or assembles anything itself. */
export const AUTOMATION_IDENTITY = 'automation:ce17';

export function isAutomationIdentity(identity: string | null | undefined): boolean {
  if (!identity) return false;
  return AUTOMATION_IDENTITY_PATTERN.test(identity.trim());
}

/**
 * The approve path's structural guard.
 *
 * Two refusals live here, and both matter:
 *   - the approver being the *same* identity that produced the item, and
 *   - the approver being *any* automation identity at all.
 * The second is what stops one agent rubber-stamping another agent's work.
 */
export function assertApproverIsNotAutomation(approver: string, automationIdentity: string, itemId: string): void {
  if (approver === automationIdentity) {
    throw new SoDViolationError(
      'The automation identity that produced this recommendation cannot approve it.',
      { itemId, approver, automationIdentity, rule: 'SELF_APPROVAL' },
    );
  }
  if (isAutomationIdentity(approver)) {
    throw new SoDViolationError(
      'Automation identities may not approve automation recommendations; approval requires an eligible human user.',
      { itemId, approver, automationIdentity, rule: 'AUTOMATION_APPROVAL' },
    );
  }
}

/** Grant author and grant activator must be different people. */
export function assertGrantSoD(grantedBy: string, activatedBy: string, capabilityCode: string): void {
  if (grantedBy === activatedBy) {
    throw new SoDViolationError(
      'An authority grant cannot be activated by the same identity that granted it.',
      { capabilityCode, grantedBy, activatedBy, rule: 'GRANT_ACTIVATION' },
    );
  }
  if (isAutomationIdentity(grantedBy)) {
    throw new SoDViolationError(
      'Automation identities may not grant authority.',
      { capabilityCode, grantedBy, rule: 'AUTOMATION_GRANT' },
    );
  }
  if (isAutomationIdentity(activatedBy)) {
    throw new SoDViolationError(
      'Automation identities may not activate authority grants.',
      { capabilityCode, activatedBy, rule: 'AUTOMATION_ACTIVATION' },
    );
  }
}

/** Policy author and policy activator must be different people. */
export function assertPolicySoD(authoredBy: string, activatedBy: string, capabilityCode: string): void {
  if (authoredBy === activatedBy) {
    throw new SoDViolationError(
      'A policy version cannot be activated by the identity that authored it.',
      { capabilityCode, authoredBy, activatedBy, rule: 'POLICY_ACTIVATION' },
    );
  }
  if (isAutomationIdentity(authoredBy)) {
    throw new SoDViolationError(
      'Automation identities may not author policy versions.',
      { capabilityCode, authoredBy, rule: 'AUTOMATION_POLICY_AUTHORSHIP' },
    );
  }
  if (isAutomationIdentity(activatedBy)) {
    throw new SoDViolationError(
      'Automation identities may not activate policy versions.',
      { capabilityCode, activatedBy, rule: 'AUTOMATION_POLICY_ACTIVATION' },
    );
  }
}

/** Dual authorization: two distinct human identities, neither automated. */
export function assertDualAuthorization(first: string | null, second: string, subject: string): void {
  if (isAutomationIdentity(second) || isAutomationIdentity(first)) {
    throw new SoDViolationError(
      'Automation identities may not provide erasure authorization.',
      { subject, first, approver: second, rule: 'AUTOMATION_DUAL_AUTH' },
    );
  }
  if (first && first === second) {
    throw new SoDViolationError(
      'Dual authorization requires two distinct approvers; the same identity cannot supply both.',
      { subject, first, second, rule: 'DUAL_AUTHORIZATION' },
    );
  }
}

/** An attestation cannot be signed by whoever assembled the evidence. */
export function assertAttestationSoD(assembledBy: string | null, attestedBy: string, binderId: string): void {
  if (isAutomationIdentity(attestedBy)) {
    throw new SoDViolationError(
      'Automation identities may not attest control evidence binders.',
      { binderId, attestedBy, rule: 'AUTOMATION_ATTESTATION' },
    );
  }
  if (assembledBy && assembledBy === attestedBy) {
    throw new SoDViolationError(
      'The identity that assembled a binder cannot attest it.',
      { binderId, assembledBy, attestedBy, rule: 'ATTESTATION' },
    );
  }
}

/** Model adoption is a human ceremony; the model's producer cannot adopt it. */
export function assertAdoptionSoD(producedBy: string | null, adoptedBy: string, modelVersion: string): void {
  if (isAutomationIdentity(adoptedBy)) {
    throw new SoDViolationError(
      'A model recommendation must be adopted by a human; automation may not adopt its own output.',
      { modelVersion, adoptedBy, rule: 'AUTOMATION_ADOPTION' },
    );
  }
  if (producedBy && producedBy === adoptedBy) {
    throw new SoDViolationError(
      'The identity that produced a model output cannot adopt it.',
      { modelVersion, producedBy, adoptedBy, rule: 'ADOPTION' },
    );
  }
}
