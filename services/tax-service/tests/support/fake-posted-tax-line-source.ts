import type { PostedTaxLine, PostedTaxLineSource } from '../../src/application/reconciliation-service';

/**
 * Test double for the PENDING_UPSTREAM_TECHNICAL_RECONCILIATION posted-
 * tax-line data source — lets reconciliation-service tests fully exercise
 * the three-way-tie logic (including injected variance/orphan detection)
 * without a real CE-07 posting-engine wiring.
 */
export class FakePostedTaxLineSource implements PostedTaxLineSource {
  private readonly byKey = new Map<string, PostedTaxLine[]>();

  seed(tenantId: string, legalEntityId: string, period: string, lines: PostedTaxLine[]): void {
    this.byKey.set(`${tenantId}::${legalEntityId}::${period}`, lines);
  }

  async findPostedTaxLines(tenantId: string, legalEntityId: string, period: string): Promise<PostedTaxLine[]> {
    return this.byKey.get(`${tenantId}::${legalEntityId}::${period}`) ?? [];
  }
}
