/**
 * AMACC-CH04 S036B — ManualComplianceAdapter tests. Verifies the adapter
 * never fabricates a successful verification — the one non-negotiable
 * requirement of the external-provider integration boundary.
 */
import { describe, it, expect } from 'vitest';
import { ManualComplianceAdapter } from '../src/application/compliance-adapter';

describe('ManualComplianceAdapter', () => {
  it('always reports NOT_CONFIGURED, never VERIFIED', async () => {
    const adapter = new ManualComplianceAdapter();
    const result = await adapter.verify({ tenantId: 't-1', vendorId: 'v-1', checkType: 'INSURANCE_CERTIFICATE' });
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.status).not.toBe('VERIFIED');
    expect(result.providerName).toBe('MANUAL');
  });

  it('reports the same truthful outcome regardless of check type', async () => {
    const adapter = new ManualComplianceAdapter();
    for (const checkType of ['TAX_ID_VERIFICATION', 'W9_VERIFICATION', 'GENERAL_COMPLIANCE_DOCUMENT', 'OTHER']) {
      const result = await adapter.verify({ tenantId: 't-1', vendorId: 'v-1', checkType });
      expect(result.status).toBe('NOT_CONFIGURED');
    }
  });

  it('includes a human-readable, non-misleading message', async () => {
    const adapter = new ManualComplianceAdapter();
    const result = await adapter.verify({ tenantId: 't-1', vendorId: 'v-1', checkType: 'INSURANCE_CERTIFICATE' });
    expect(result.message).toMatch(/no external compliance verification provider is configured/i);
  });
});
