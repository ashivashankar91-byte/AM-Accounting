/**
 * AMACC-CH04 S036B: Vendor Compliance Adapters — the external-provider
 * integration boundary.
 *
 * Per the BRD (automate2-accounting-brd.md, Platform Feature 4): AMACC's own
 * role is an immutable audit trail, not a compliance rules engine —
 * regulatory interpretation belongs to an external compliance platform. This
 * interface is that boundary: a real external verification provider is a
 * distinct future adapter implementing the same contract; nothing here
 * assumes or hard-codes what that provider is.
 *
 * ManualComplianceAdapter is the only adapter shipped in this slice. It never
 * fabricates a successful verification — it always reports NOT_CONFIGURED,
 * truthfully, because no external provider is wired up. A future adapter
 * that calls a real provider and cannot reach it must report
 * VERIFICATION_UNAVAILABLE, not silently fall back to a fake pass.
 */

export type ComplianceAdapterOutcome = 'NOT_CONFIGURED' | 'VERIFICATION_UNAVAILABLE';

export interface ComplianceVerificationRequest {
  tenantId: string;
  vendorId: string;
  checkType: string;
  externalReference?: string | null;
}

export interface ComplianceVerificationResult {
  status: ComplianceAdapterOutcome;
  providerName: string;
  message: string;
}

export interface ComplianceVerificationAdapter {
  /** Name reported on the check record's providerName field. */
  readonly name: string;
  verify(request: ComplianceVerificationRequest): Promise<ComplianceVerificationResult>;
}

/**
 * Default/fallback adapter — used whenever no tenant-specific external
 * provider is configured (i.e. always, in this slice; no such provider
 * exists repository-wide). Deliberately incapable of returning VERIFIED —
 * that outcome is reserved for an explicit human review action
 * (VendorComplianceService.review), never an automated adapter result.
 */
export class ManualComplianceAdapter implements ComplianceVerificationAdapter {
  readonly name = 'MANUAL';

  async verify(request: ComplianceVerificationRequest): Promise<ComplianceVerificationResult> {
    return {
      status: 'NOT_CONFIGURED',
      providerName: this.name,
      message: `No external compliance verification provider is configured for ${request.checkType}. A manual reviewer must verify this check.`,
    };
  }
}
