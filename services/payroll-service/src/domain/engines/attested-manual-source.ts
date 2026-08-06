import { PayrollSourceAdapter, PayrollWithholdingRequest, PayrollWithholdingResult } from '../payroll-adapter-contract';

/**
 * ATTESTED_MANUAL_ENTRY path — a human copies figures from the provider's
 * own register/paystub and attests to their accuracy. This adapter NEVER
 * computes a withholding value: `entered` must carry every line already
 * populated by the caller from the source document. Missing lines default
 * to 0 (documented as entered zero, not a computed exemption).
 */
export class AttestedManualSource implements PayrollSourceAdapter {
  readonly sourceType = 'ATTESTED_MANUAL_ENTRY';

  async resolve(
    request: PayrollWithholdingRequest,
    entered?: { federalTax?: number; stateTax?: number; socialSecurity?: number; medicare?: number; employerFICA?: number; employerMedicare?: number; employerFUTA?: number; employerSUTA?: number; attestedBy?: string; sourceDocumentRef?: string },
  ): Promise<PayrollWithholdingResult> {
    if (!entered || !entered.attestedBy || !entered.sourceDocumentRef) {
      return {
        status: 'NOT_CONFIGURED',
        lines: { federalTax: 0, stateTax: 0, socialSecurity: 0, medicare: 0, employerFICA: 0, employerMedicare: 0, employerFUTA: 0, employerSUTA: 0 },
        productionCertified: false,
        source: 'NOT_CONFIGURED',
        rejectReason: 'Attested manual entry requires attestedBy and sourceDocumentRef (the provider register/paystub reference) — figures cannot be entered anonymously or without a source document citation.',
      };
    }
    return {
      status: 'ATTESTED_MANUAL_ENTRY',
      lines: {
        federalTax: entered.federalTax ?? 0,
        stateTax: entered.stateTax ?? 0,
        socialSecurity: entered.socialSecurity ?? 0,
        medicare: entered.medicare ?? 0,
        employerFICA: entered.employerFICA ?? 0,
        employerMedicare: entered.employerMedicare ?? 0,
        employerFUTA: entered.employerFUTA ?? 0,
        employerSUTA: entered.employerSUTA ?? 0,
      },
      productionCertified: true,
      source: 'MANUAL_ATTESTED_REGISTER',
      attestedBy: entered.attestedBy,
      attestedAt: new Date().toISOString(),
      sourceDocumentRef: entered.sourceDocumentRef,
    };
  }

  async getStatus() {
    return { sourceType: this.sourceType, configured: true };
  }
}
