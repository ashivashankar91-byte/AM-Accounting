import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RlsTenantContext } from '@amacc/shared-kernel';
import { makeTestPrisma, cleanupTenant } from '../support/db';
import { OemProfileService } from '../../src/application/profile-service';
import { OemStagingService } from '../../src/application/staging-service';
import { OemAdapterRegistry } from '../../src/domain/adapter-spi';
import { FordAdapter } from '../../src/domain/adapters/ford-adapter';
import { OemValidationError } from '../../src/domain/errors';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');
const prisma = makeTestPrisma();
const tenantId = `test-tenant-${randomUUID()}`;

const registry = new OemAdapterRegistry();
registry.register(new FordAdapter());

const profiles = new OemProfileService(prisma as any);
const staging = new OemStagingService(prisma as any, registry as any);

beforeAll(async () => {
  // These tests call application services directly (bypassing the HTTP
  // layer's tenantContextHook), so the RLS AsyncLocalStorage context that
  // hook normally sets per-request must be set explicitly here — this
  // mirrors production behavior for the app-role connection these tests
  // deliberately use (see tests/support/db.ts).
  RlsTenantContext.set(tenantId);
  await prisma.$connect();
});
afterAll(async () => { await cleanupTenant(prisma, tenantId); await prisma.$disconnect(); });

describe('S098 OemProfileService — truthful status enum', () => {
  it('creates a profile defaulting to NOT_CONFIGURED', async () => {
    const p = await profiles.create(tenantId, { make: 'ford' }, 'tester');
    expect(p.make).toBe('FORD');
    expect(p.connectionStatus).toBe('NOT_CONFIGURED');
    expect(p.certificationEvidenceRef).toBeNull();
  });

  it('refuses CERTIFIED without a certificationEvidenceRef — never fabricates certification', async () => {
    await expect(profiles.setConnectionStatus(tenantId, 'FORD', 'CERTIFIED', null, 'tester')).rejects.toThrow(OemValidationError);
  });

  it('allows CERTIFIED with an evidence ref, and clears it on downgrade', async () => {
    const certified = await profiles.setConnectionStatus(tenantId, 'FORD', 'CERTIFIED', 'EVID-REF-123', 'tester');
    expect(certified.connectionStatus).toBe('CERTIFIED');
    expect(certified.certificationEvidenceRef).toBe('EVID-REF-123');

    const downgraded = await profiles.setConnectionStatus(tenantId, 'FORD', 'TEST_ONLY', null, 'tester');
    expect(downgraded.connectionStatus).toBe('TEST_ONLY');
    expect(downgraded.certificationEvidenceRef).toBeNull();
  });

  it('sets a per-store dealer code', async () => {
    const dc = await profiles.setDealerCode(tenantId, 'FORD', 'STORE-1', 'F12345', 'tester');
    expect(dc.dealerCode).toBe('F12345');
  });
});

describe('S098 OemStagingService — import, dedupe, diff alerts, UNPARSED', () => {
  it('refuses import for a make with no profile — never silently proceeds', async () => {
    await expect(
      staging.importFeed(tenantId, { make: 'HONDA', rawContent: 'x' }, 'tester'),
    ).rejects.toThrow(OemValidationError);
  });

  it('imports the Ford fixture feed byte-accountably, one row UNPARSED', async () => {
    const raw = readFileSync(join(FIXTURES, 'ford', 'remittance-2026-07-v1.txt'), 'utf-8');
    const { document, deduped } = await staging.importFeed(tenantId, { make: 'FORD', rawContent: raw }, 'tester');
    expect(deduped).toBe(false);
    const full = await staging.getDocument(tenantId, document.id);
    expect(full.rows).toHaveLength(5);
    expect(full.rows.filter((r: any) => r.parseStatus === 'UNPARSED')).toHaveLength(1);
  });

  it('byte-identical re-delivery dedupes silently (no new row, no diff alert)', async () => {
    const raw = readFileSync(join(FIXTURES, 'ford', 'remittance-2026-07-v1.txt'), 'utf-8');
    const before = await staging.listDocuments(tenantId, 'FORD');
    const { deduped, diffAlert } = await staging.importFeed(tenantId, { make: 'FORD', rawContent: raw }, 'tester');
    expect(deduped).toBe(true);
    expect(diffAlert).toBeNull();
    const after = await staging.listDocuments(tenantId, 'FORD');
    expect(after).toHaveLength(before.length); // no duplicate row created
  });

  it('a re-delivered ALTERED document raises a field-level diff alert, never silently overwrites', async () => {
    const rawV2 = readFileSync(join(FIXTURES, 'ford', 'remittance-2026-07-v2-redelivery.txt'), 'utf-8');
    const { document, diffAlert, deduped } = await staging.importFeed(tenantId, { make: 'FORD', rawContent: rawV2 }, 'tester');
    expect(deduped).toBe(false);
    expect(diffAlert).not.toBeNull();
    expect(diffAlert.fieldDiffs.length).toBeGreaterThan(0);
    expect(diffAlert.fieldDiffs.some((d: any) => d.path === 'specVersion')).toBe(true);

    const alerts = await staging.listDiffAlerts(tenantId, false);
    expect(alerts.some((a: any) => a.id === diffAlert.id)).toBe(true);

    const resolved = await staging.resolveDiffAlert(tenantId, diffAlert.id, 'tester');
    expect(resolved.resolvedAt).not.toBeNull();

    // Original document is untouched — immutability.
    const originalRows = await prisma.oemStagedDocumentRow.findMany({ where: { documentId: document.supersedesDocumentId } });
    expect(originalRows.find((r: any) => (r.fields as any).ref === 'C-1001')?.fields).toMatchObject({ amount: '450.00' });
  });

  it('manual import works identically for a no-adapter make (S101A "manual-entry statement fully equivalent")', async () => {
    await profiles.create(tenantId, { make: 'HONDA' }, 'tester');
    const { document, deduped } = await staging.importManual(tenantId, {
      make: 'HONDA', kind: 'REMITTANCE', naturalKey: 'HONDA-MANUAL-1',
      rows: [{ canonicalType: 'RECEIVABLE_REMITTANCE', fields: { ref: 'H-1', amount: '200.00' } }],
    }, 'tester');
    expect(deduped).toBe(false);
    const full = await staging.getDocument(tenantId, document.id);
    expect(full.rows).toHaveLength(1);
    expect(full.rows[0].parseStatus).toBe('PARSED');
  });
});
