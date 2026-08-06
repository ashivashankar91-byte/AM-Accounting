/**
 * Per-test parametrizable fakes for the three PUTR upstream sources —
 * distinct from src/infrastructure/fixture-sources.ts's hardcoded
 * 'FIXTURE_TENANT' data (used for Playwright/manual certification), so
 * each application test can scope its own randomUUID tenant without
 * cross-test coordination.
 */
import type { OemOpenItem, OemOpenItemTypeKey, OpenItemSource } from '../../src/domain/upstream-items';
import type { DealFinalizedRdrEvent, DealFinalizedSource } from '../../src/domain/upstream-deal-events';
import type { ApDocumentRef, ApDocumentSource } from '../../src/domain/upstream-ap-docs';

export class FakeOpenItemSource implements OpenItemSource {
  constructor(private readonly items: OemOpenItem[]) {}
  async findOpenItems(tenantId: string, storeId: string, itemType: OemOpenItemTypeKey) {
    return this.items.filter((i) => i.tenantId === tenantId && i.storeId === storeId && i.itemType === itemType);
  }
  async findOpenItemByRef(tenantId: string, itemRef: string) {
    return this.items.find((i) => i.tenantId === tenantId && i.itemRef === itemRef) ?? null;
  }
}

export class FakeDealFinalizedSource implements DealFinalizedSource {
  constructor(private readonly deliveries: DealFinalizedRdrEvent[]) {}
  async findRdrDeliveries(tenantId: string, storeId: string) {
    return this.deliveries.filter((d) => d.tenantId === tenantId && d.storeId === storeId);
  }
}

export class FakeApDocumentSource implements ApDocumentSource {
  constructor(private readonly docs: ApDocumentRef[]) {}
  async findApDocument(tenantId: string, apDocumentId: string) {
    return this.docs.find((d) => d.tenantId === tenantId && d.apDocumentId === apDocumentId) ?? null;
  }
}
