/**
 * Deterministic TEST_ONLY stand-ins for the three PENDING_UPSTREAM_
 * TECHNICAL_RECONCILIATION sources (CE-11 open items, CE-12 RDR deliveries,
 * CE-09 AP documents) — same role as tax-service's TestFixtureEngine next
 * to NullEngine (services/tax-service/src/domain/engines/). NEVER wired by
 * default: src/index.ts only selects these when OEM_USE_FIXTURE_UPSTREAM=
 * true is explicitly set (certification/dev use), so a real deployment
 * without that flag gets the truthful Unwired* sources (empty results)
 * from domain/upstream-*.ts, never silently fabricated data.
 *
 * These fixtures let S101A/S105/S103A/S106's genuine match/chargeback/
 * accrual/claim logic — real transactions, real conservation checks, real
 * idempotency — be exercised end-to-end (including via Playwright) without
 * claiming CE-11/CE-12/CE-09 exist in this worktree.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { OemOpenItem, OemOpenItemTypeKey, OpenItemSource } from '../domain/upstream-items';
import type { DealFinalizedRdrEvent, DealFinalizedSource } from '../domain/upstream-deal-events';
import type { ApDocumentRef, ApDocumentSource } from '../domain/upstream-ap-docs';

const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures');

// Labeled fixture data is tenant-agnostic by design: it is only ever
// selected via the explicit OEM_USE_FIXTURE_UPSTREAM=true opt-in (never a
// real deployment default), so gating it further by a specific hardcoded
// tenant id would just make certification/dev brittle against whichever
// real tenant happens to be logged in (e.g. the seeded 'tenant-kunes' demo
// tenant) without adding any genuine safety — the opt-in flag is the real
// boundary. Each fixture row's tenantId is stamped with the CALLER's
// tenantId at read time rather than filtered against a fixed value.

const FIXTURE_OPEN_ITEMS: Omit<OemOpenItem, 'tenantId'>[] = [
  { itemRef: 'CLAIM-C-1001', itemType: 'WARRANTY_CLAIM', storeId: 'STORE-1', openAmount: '450.00', description: 'Warranty claim C-1001', originalClaimItemRef: 'CLAIM-C-1001' },
  { itemRef: 'CLAIM-C-1002', itemType: 'WARRANTY_CLAIM', storeId: 'STORE-1', openAmount: '350.00', description: 'Warranty claim C-1002' },
  { itemRef: 'CLAIM-C-1003', itemType: 'WARRANTY_CLAIM', storeId: 'STORE-1', openAmount: '210.00', description: 'Warranty claim C-1003' },
  { itemRef: 'CLAIM-C-5001', itemType: 'WARRANTY_CLAIM', storeId: 'STORE-1', openAmount: '610.00', description: 'Warranty claim C-5001 (GM)' },
  { itemRef: 'RETURN-R-7001', itemType: 'PARTS_RETURN_CREDIT', storeId: 'STORE-1', openAmount: '95.25', description: 'Parts return credit R-7001' },
];

export class FixtureOpenItemSource implements OpenItemSource {
  async findOpenItems(tenantId: string, storeId: string, itemType: OemOpenItemTypeKey): Promise<OemOpenItem[]> {
    return FIXTURE_OPEN_ITEMS.filter((i) => i.storeId === storeId && i.itemType === itemType).map((i) => ({ ...i, tenantId }));
  }
  async findOpenItemByRef(tenantId: string, itemRef: string): Promise<OemOpenItem | null> {
    const found = FIXTURE_OPEN_ITEMS.find((i) => i.itemRef === itemRef);
    return found ? { ...found, tenantId } : null;
  }
}

export class FixtureDealFinalizedSource implements DealFinalizedSource {
  async findRdrDeliveries(tenantId: string, storeId: string): Promise<DealFinalizedRdrEvent[]> {
    const data: DealFinalizedRdrEvent[] = JSON.parse(readFileSync(join(FIXTURES_DIR, 'rdr-deliveries.json'), 'utf-8'));
    return data.filter((d) => d.storeId === storeId).map((d) => ({ ...d, tenantId }));
  }
}

export class FixtureApDocumentSource implements ApDocumentSource {
  async findApDocument(tenantId: string, apDocumentId: string): Promise<ApDocumentRef | null> {
    const data: ApDocumentRef[] = JSON.parse(readFileSync(join(FIXTURES_DIR, 'ap-documents.json'), 'utf-8'));
    const found = data.find((d) => d.apDocumentId === apDocumentId);
    return found ? { ...found, tenantId } : null;
  }
}
