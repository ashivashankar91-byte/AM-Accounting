/**
 * Separation of duties. The single structural rule this epic exists to
 * guarantee is that an automation identity cannot approve its own
 * recommendation; the rest of this file is that same idea applied to grants,
 * policies, attestations, model adoption and irreversible dual authorization.
 */

import { describe, it, expect } from 'vitest';
import {
  isAutomationIdentity, assertApproverIsNotAutomation, assertGrantSoD, assertPolicySoD,
  assertDualAuthorization, assertAttestationSoD, assertAdoptionSoD, AUTOMATION_IDENTITY,
} from '../../src/domain/sod';

describe('automation identity recognition', () => {
  it('recognises the identities automation acts under', () => {
    for (const id of ['automation:ce17', 'agent:gl', 'system:batch', 'svc-poster', 'service.worker']) {
      expect(isAutomationIdentity(id), id).toBe(true);
    }
    expect(isAutomationIdentity(AUTOMATION_IDENTITY)).toBe(true);
  });

  it('does not mistake a person for automation', () => {
    for (const id of ['user-approver', 'jane.doe@example.com', 'controller-1', 'automatic-teller']) {
      expect(isAutomationIdentity(id), id).toBe(false);
    }
  });

  it('treats an absent identity as not-automation rather than throwing', () => {
    expect(isAutomationIdentity(null)).toBe(false);
    expect(isAutomationIdentity(undefined)).toBe(false);
    expect(isAutomationIdentity('')).toBe(false);
  });

  it('is not defeated by surrounding whitespace', () => {
    expect(isAutomationIdentity('  automation:ce17  ')).toBe(true);
  });
});

describe('self-approval is structurally impossible', () => {
  it('refuses when the approver is the automation identity that produced the item', () => {
    expect(() => assertApproverIsNotAutomation('automation:ce17', 'automation:ce17', 'item-1'))
      .toThrowError(/cannot approve it/i);
  });

  it('refuses any automation identity as an approver, not just the producing one', () => {
    expect(() => assertApproverIsNotAutomation('agent:gl', 'automation:ce17', 'item-1'))
      .toThrowError(/automation/i);
  });

  it('permits a human approver', () => {
    expect(() => assertApproverIsNotAutomation('user-approver', 'automation:ce17', 'item-1')).not.toThrow();
  });

  it('reports a 403 with the item in the detail so the refusal is auditable', () => {
    try {
      assertApproverIsNotAutomation('automation:ce17', 'automation:ce17', 'item-42');
      throw new Error('should have refused');
    } catch (err: any) {
      expect(err.name).toBe('SoDViolationError');
      expect(err.statusCode).toBe(403);
      expect(JSON.stringify(err.details ?? err)).toContain('item-42');
    }
  });
});

describe('two-person ceremonies', () => {
  it('refuses a grant activated by its own grantor', () => {
    expect(() => assertGrantSoD('user-a', 'user-a', 'S040_OCR_INGESTION')).toThrowError(/grant/i);
    expect(() => assertGrantSoD('user-a', 'user-b', 'S040_OCR_INGESTION')).not.toThrow();
  });

  it('refuses an automation identity on either side of a grant', () => {
    expect(() => assertGrantSoD('automation:ce17', 'user-b', 'S040_OCR_INGESTION')).toThrow();
    expect(() => assertGrantSoD('user-a', 'automation:ce17', 'S040_OCR_INGESTION')).toThrow();
  });

  it('refuses a policy activated by its own author', () => {
    expect(() => assertPolicySoD('user-a', 'user-a', 'S058_LOCKBOX_MATCHING')).toThrowError(/polic/i);
    expect(() => assertPolicySoD('user-a', 'user-b', 'S058_LOCKBOX_MATCHING')).not.toThrow();
  });

  it('refuses an automation identity as a policy activator', () => {
    expect(() => assertPolicySoD('user-a', 'automation:ce17', 'S058_LOCKBOX_MATCHING')).toThrow();
  });

  it('requires two distinct humans for dual authorization', () => {
    expect(() => assertDualAuthorization('user-a', 'user-a', 'dsar-1')).toThrowError(/two distinct/i);
    expect(() => assertDualAuthorization('user-a', 'user-b', 'dsar-1')).not.toThrow();
  });

  it('refuses dual authorization where either signature is automation', () => {
    expect(() => assertDualAuthorization('automation:ce17', 'user-b', 'dsar-1')).toThrow();
    expect(() => assertDualAuthorization('user-a', 'automation:ce17', 'dsar-1')).toThrow();
  });

  it('refuses a binder attested by whoever assembled it', () => {
    expect(() => assertAttestationSoD('user-a', 'user-a', 'binder-1')).toThrowError(/assembled/i);
    expect(() => assertAttestationSoD('user-a', 'user-b', 'binder-1')).not.toThrow();
  });

  it('never lets automation attest control evidence, even for a binder it did not assemble', () => {
    expect(() => assertAttestationSoD(null, 'automation:ce17', 'binder-1')).toThrowError(/attest/i);
    expect(() => assertAttestationSoD(AUTOMATION_IDENTITY, 'user-b', 'binder-1')).not.toThrow();
  });

  it('never lets automation adopt its own model output', () => {
    expect(() => assertAdoptionSoD(null, 'automation:ce17', 'model-1.2')).toThrowError(/adopt/i);
    expect(() => assertAdoptionSoD('user-a', 'user-a', 'model-1.2')).toThrowError(/produced/i);
    expect(() => assertAdoptionSoD('user-a', 'user-b', 'model-1.2')).not.toThrow();
    expect(() => assertAdoptionSoD(null, 'user-b', 'model-1.2')).not.toThrow();
  });
});
