import { PayrollSourceAdapter, PayrollWithholdingRequest, PayrollWithholdingResult, ZERO_WITHHOLDING } from '../payroll-adapter-contract';

/**
 * Truthful default source for any tenant with no attested register entry
 * and no test-fixture mode enabled. Always returns NOT_CONFIGURED — never
 * fabricates a rate, never estimates. This is what an unconfigured tenant
 * gets, matching CE-10's NullEngine precedent exactly.
 */
export class NullPayrollSource implements PayrollSourceAdapter {
  readonly sourceType = 'NOT_CONFIGURED';

  async resolve(request: PayrollWithholdingRequest): Promise<PayrollWithholdingResult> {
    return {
      status: 'NOT_CONFIGURED',
      lines: ZERO_WITHHOLDING,
      productionCertified: false,
      source: 'NOT_CONFIGURED',
      rejectReason: `PAYROLL_SOURCE_NOT_CONFIGURED — no certified payroll source is configured for tenant '${request.tenantId}', employee '${request.employeeId}'. Enter attested provider-register figures or configure a certified source before this employee can be added to a payroll run.`,
    };
  }

  async getStatus() {
    return { sourceType: this.sourceType, configured: false };
  }
}
