import {
  AdapterStatus, EngineTransientError, ReferenceDataEntry, ReferenceDataQuery,
  TaxCalculationRequest, TaxCalculationResult, TaxEngineAdapter,
} from '../tax-adapter-contract';
import { NonTestTenantRefusedError } from '../errors';
import { TEST_TENANT_CE10_CERTIFICATION_ONLY } from '../tax-attachment';

/** Labeled, deterministic fixture reference data — for certification only.
 * These ARE NOT real jurisdiction rates: they exist solely to prove the
 * adapter contract end-to-end without any production tax-law content. */
const FIXTURE_JURISDICTIONS: ReferenceDataEntry[] = [
  { ref: 'TEST-JURISDICTION-STATE-01', label: 'Test State Jurisdiction 01', level: 'STATE' },
  { ref: 'TEST-JURISDICTION-COUNTY-01', label: 'Test County Jurisdiction 01', level: 'COUNTY' },
];

const FIXTURE_EXEMPTION_TYPES: ReferenceDataEntry[] = [
  { ref: 'TEST-EXEMPTION-RESALE', label: 'Test Resale Exemption' },
];

/**
 * Deterministic labeled fixtures for S124 certification only. Refuses to
 * run for any tenantId that is not the labeled TEST-TENANT — this is the
 * one hard rule that prevents a fixture engine from ever masquerading as a
 * production calculation for a real dealer tenant.
 *
 * Fixture behavior (deterministic, keyed off itemClassCode so tests can
 * exercise every status without a live vendor):
 *  - itemClassCode 'TEST-EXEMPT'      -> EXEMPT_APPLIED (0 tax)
 *  - itemClassCode 'TEST-REJECT'      -> ENGINE_REJECTED
 *  - itemClassCode 'TEST-UNAVAILABLE' -> throws EngineTransientError (simulated outage)
 *  - anything else                     -> CALCULATED at a FIXED, LABELED test
 *    rate (never a real jurisdiction rate) applied uniformly, purely to
 *    prove the contract shape.
 */
export class TestFixtureEngine implements TaxEngineAdapter {
  readonly engineType = 'TEST_FIXTURE_ENGINE';
  private static readonly FIXTURE_RATE = '0.100000'; // TEST-LABELED FIXTURE RATE — not a real jurisdiction rate
  private lastSuccessfulCallAt: string | null = null;

  private assertTestTenant(tenantId: string): void {
    if (tenantId !== TEST_TENANT_CE10_CERTIFICATION_ONLY) {
      throw new NonTestTenantRefusedError(tenantId);
    }
  }

  async calculate(request: TaxCalculationRequest): Promise<TaxCalculationResult> {
    this.assertTestTenant(request.tenantId);

    const calculatedAt = new Date().toISOString();
    const anyRejected = request.lines.some((l) => l.itemClassCode === 'TEST-REJECT');
    if (anyRejected) {
      return {
        status: 'ENGINE_REJECTED',
        engineType: this.engineType,
        engineVersion: 'fixture-1.0.0',
        contentVersion: 'fixture-content-1.0.0',
        engineResultId: null,
        engineRejectReason: 'TEST-REJECT fixture line present — engine rejected the request',
        currency: request.currency,
        totalTaxableBase: '0.00',
        totalTax: '0.00',
        lines: [],
        calculatedAt,
      };
    }

    const anyUnavailable = request.lines.some((l) => l.itemClassCode === 'TEST-UNAVAILABLE');
    if (anyUnavailable) {
      throw new EngineTransientError('TEST-UNAVAILABLE fixture line present — simulated transient engine outage');
    }

    const anyExempt = request.lines.some((l) => l.exemptionRef);
    const engineResultId = `FIXTURE-RESULT-${request.idempotencyKey}`;

    let totalTaxableBase = 0;
    let totalTax = 0;
    const lines = request.lines.map((line) => {
      const amount = Number(line.amount);
      totalTaxableBase += amount;
      const exempt = Boolean(line.exemptionRef);
      const taxAmount = exempt ? 0 : Math.round(amount * Number(TestFixtureEngine.FIXTURE_RATE) * 100) / 100;
      totalTax += taxAmount;
      return {
        lineId: line.lineId,
        jurisdictionId: 'TEST-JURISDICTION-STATE-01',
        jurisdictionLevel: 'STATE',
        taxType: 'TEST-SALES-TAX',
        rate: exempt ? '0.000000' : TestFixtureEngine.FIXTURE_RATE,
        taxableBase: amount.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        engineResultLineId: `${engineResultId}-${line.lineId}`,
      };
    });

    this.lastSuccessfulCallAt = calculatedAt;

    return {
      status: anyExempt ? 'EXEMPT_APPLIED' : 'CALCULATED',
      engineType: this.engineType,
      engineVersion: 'fixture-1.0.0',
      contentVersion: 'fixture-content-1.0.0',
      engineResultId,
      engineRejectReason: null,
      currency: request.currency,
      totalTaxableBase: totalTaxableBase.toFixed(2),
      totalTax: totalTax.toFixed(2),
      lines,
      calculatedAt,
    };
  }

  async getStatus(): Promise<AdapterStatus> {
    return {
      engineType: this.engineType,
      engineVersion: 'fixture-1.0.0',
      contentVersion: 'fixture-content-1.0.0',
      configured: true,
      lastSuccessfulCallAt: this.lastSuccessfulCallAt,
    };
  }

  async browseReferenceData(query: ReferenceDataQuery): Promise<ReferenceDataEntry[]> {
    const source = query.kind === 'EXEMPTION_TYPE' ? FIXTURE_EXEMPTION_TYPES : FIXTURE_JURISDICTIONS;
    if (!query.search) return source;
    const needle = query.search.toLowerCase();
    return source.filter((e) => e.ref.toLowerCase().includes(needle) || e.label.toLowerCase().includes(needle));
  }

  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: 'TestFixtureEngine is a deterministic in-process fixture — always reachable' };
  }
}
