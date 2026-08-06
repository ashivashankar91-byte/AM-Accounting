import {
  AdapterStatus, ReferenceDataEntry, ReferenceDataQuery, TaxCalculationRequest,
  TaxCalculationResult, TaxEngineAdapter,
} from '../tax-adapter-contract';

/**
 * Truthful default engine for any tenant with no TaxEngineConfig row
 * effective at businessDate. Always returns NOT_CONFIGURED — never
 * fabricates a rate, never estimates. This is what an unconfigured tenant
 * gets (S124 AC7).
 */
export class NullEngine implements TaxEngineAdapter {
  readonly engineType = 'NULL_ENGINE';

  async calculate(request: TaxCalculationRequest): Promise<TaxCalculationResult> {
    return {
      status: 'NOT_CONFIGURED',
      engineType: this.engineType,
      engineVersion: null,
      contentVersion: null,
      engineResultId: null,
      engineRejectReason: `No tax engine is configured for tenant '${request.tenantId}' / legal entity '${request.legalEntityId}' as of ${request.businessDate}`,
      currency: request.currency,
      totalTaxableBase: '0.00',
      totalTax: '0.00',
      lines: [],
      calculatedAt: new Date().toISOString(),
    };
  }

  async getStatus(): Promise<AdapterStatus> {
    return { engineType: this.engineType, configured: false, lastSuccessfulCallAt: null };
  }

  async browseReferenceData(_query: ReferenceDataQuery): Promise<ReferenceDataEntry[]> {
    return [];
  }

  async testConnection(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: false, detail: 'NullEngine has no connection — no tax engine is configured' };
  }
}
