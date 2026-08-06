import { PayrollSourceAdapter, PayrollWithholdingRequest, PayrollWithholdingResult } from '../payroll-adapter-contract';
import { NonTestTenantRefusedError, TEST_TENANT_CE13_CERTIFICATION_ONLY } from '../errors';

/**
 * Deterministic, clearly-labeled fixture withholding for CE-13 certification
 * and local development ONLY. Refuses to run for any tenant other than the
 * labeled TEST-TENANT — the one hard rule that prevents a fixture from ever
 * masquerading as a production calculation for a real dealer tenant.
 * `productionCertified` is always `false` for this source.
 *
 * Fixture rates below are test-labeled constants, not real IRS/state
 * withholding tables — they exist solely to prove the run → validate →
 * post → clearing-zero → YTD pipeline end-to-end without any production
 * statutory content.
 */
export class TestFixturePayrollSource implements PayrollSourceAdapter {
  readonly sourceType = 'TEST_FIXTURE';
  private static readonly FIXTURE_FEDERAL_RATE = 0.12; // TEST-LABELED FIXTURE RATE
  private static readonly FIXTURE_STATE_RATE = 0.04; // TEST-LABELED FIXTURE RATE
  private static readonly FIXTURE_FICA_RATE = 0.062; // matches statutory-equivalent structure only for fixture math shape
  private static readonly FIXTURE_MEDICARE_RATE = 0.0145;

  async resolve(request: PayrollWithholdingRequest): Promise<PayrollWithholdingResult> {
    if (request.tenantId !== TEST_TENANT_CE13_CERTIFICATION_ONLY) {
      throw new NonTestTenantRefusedError(request.tenantId);
    }
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const fica = round2(request.grossPay * TestFixturePayrollSource.FIXTURE_FICA_RATE);
    const medicare = round2(request.grossPay * TestFixturePayrollSource.FIXTURE_MEDICARE_RATE);
    return {
      status: 'TEST_FIXTURE',
      lines: {
        federalTax: round2(request.grossPay * TestFixturePayrollSource.FIXTURE_FEDERAL_RATE),
        stateTax: round2(request.grossPay * TestFixturePayrollSource.FIXTURE_STATE_RATE),
        socialSecurity: fica,
        medicare,
        employerFICA: fica,
        employerMedicare: medicare,
        employerFUTA: round2(Math.min(request.grossPay, 7000) * 0.006),
        employerSUTA: round2(Math.min(request.grossPay, 7000) * 0.027),
      },
      productionCertified: false,
      source: 'TEST_FIXTURE_ENGINE',
      sourceDocumentRef: 'FIXTURE-NOT-PRODUCTION',
    };
  }

  async getStatus() {
    return { sourceType: this.sourceType, configured: true };
  }
}
