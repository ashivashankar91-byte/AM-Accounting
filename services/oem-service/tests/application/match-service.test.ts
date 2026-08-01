import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RlsTenantContext } from '@amacc/shared-kernel';
import { makeTestPrisma, cleanupTenant } from '../support/db';
import { OemProfileService } from '../../src/application/profile-service';
import { OemStagingService } from '../../src/application/staging-service';
import { OemMatchService } from '../../src/application/match-service';
import { OemAdapterRegistry } from '../../src/domain/adapter-spi';
import { FordAdapter } from '../../src/domain/adapters/ford-adapter';
import { FixtureOpenItemSource } from '../../src/infrastructure/fixture-sources';
import { OemValidationError } from '../../src/domain/errors';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');
const prisma = makeTestPrisma();
const tenantId = 'FIXTURE_TENANT'; // matches infrastructure/fixture-sources.ts's fixture rows
const storeId = 'STORE-1';

const registry = new OemAdapterRegistry();
registry.register(new FordAdapter());
const openItems = new FixtureOpenItemSource();

const profiles = new OemProfileService(prisma as any);
const staging = new OemStagingService(prisma as any, registry as any);
const match = new OemMatchService(prisma as any, openItems);

beforeAll(async () => {
  RlsTenantContext.set(tenantId);
  await prisma.$connect();
  await profiles.create(tenantId, { make: 'FORD' }, 'tester');
});
afterAll(async () => { await cleanupTenant(prisma, tenantId); await prisma.$disconnect(); });

describe('S101A Statement Match Workbench', () => {
  it('exact match, short-pay, and factory-only rows resolve; ours-not-on-statement rows auto-append; session completes only at 100% disposition', async () => {
    const raw = readFileSync(join(FIXTURES, 'ford', 'remittance-2026-07-v1.txt'), 'utf-8');
    const { document } = await staging.importFeed(tenantId, { make: 'FORD', rawContent: raw }, 'tester');

    const session = await match.createSession(tenantId, storeId, document.id, 'tester');
    // Fixture has 4 PARSED rows (2 REMIT/CLAIM, 1 INCENTIVE, 1 COOP) + 1 UNPARSED (excluded from match rows).
    expect(session.rows).toHaveLength(4);

    // Completion is blocked while rows are PENDING.
    await expect(match.completeSession(tenantId, session.id, 'tester')).rejects.toThrow(OemValidationError);

    const claimRowExact = session.rows.find((r: any) => (r as any).openItemRef === 'CLAIM-C-1001');
    const claimRowShort = session.rows.find((r: any) => (r as any).openItemRef === 'CLAIM-C-1002');
    const incentiveRow = session.rows.find((r: any) => (r as any).openItemType === 'INCENTIVE_ACCRUAL');
    const coopRow = session.rows.find((r: any) => (r as any).openItemType === 'COOP_CLAIM');

    // Exact match: statement amount 450.00 == fixture open item CLAIM-C-1001 (450.00).
    const matched = await match.disposeRow(tenantId, session.id, claimRowExact!.id, 'MATCHED', 'tester');
    expect(matched.disposition).toBe('MATCHED');
    expect(matched.appliedAmount.toString()).toBe('450');
    expect(matched.applyNumber).toBeTruthy();

    // Short-pay: statement amount 320.50, fixture open item CLAIM-C-1002 open amount 350.00 -> writeDown = 29.50, conserves.
    const shortPaid = await match.disposeRow(tenantId, session.id, claimRowShort!.id, 'SHORT_PAY', 'tester', 'partial factory remit');
    expect(shortPaid.disposition).toBe('SHORT_PAID');
    expect(Number(shortPaid.appliedAmount) + Number(shortPaid.writeDownAmount)).toBeCloseTo(350.0, 2);

    // Incentive/co-op rows: dispositioned INVESTIGATION for this test (true-up/response ceremonies are separate stories' tests).
    await match.disposeRow(tenantId, session.id, incentiveRow!.id, 'INVESTIGATION', 'tester');
    await match.disposeRow(tenantId, session.id, coopRow!.id, 'INVESTIGATION', 'tester');

    // Idempotent replay: disposing the same row again returns the same result, does not double-apply.
    const replay = await match.disposeRow(tenantId, session.id, claimRowExact!.id, 'MATCHED', 'tester');
    expect(replay.id).toBe(matched.id);

    const completed = await match.completeSession(tenantId, session.id, 'tester');
    expect(completed.status).toBe('COMPLETE');

    // "ours-not-on-statement" system rows auto-added for open WARRANTY_CLAIM items never referenced (C-1003, C-5001).
    const systemRows = completed.rows.filter((r: any) => r.isSystemGenerated);
    expect(systemRows.map((r: any) => r.openItemRef).sort()).toEqual(['CLAIM-C-1003', 'CLAIM-C-5001']);
    expect(systemRows.every((r: any) => r.disposition === 'INVESTIGATION')).toBe(true);

    // Every row is dispositioned — no silent leftovers.
    expect(completed.rows.every((r: any) => r.disposition !== 'PENDING')).toBe(true);
  });

  it('cannot dispose a row once the session is complete', async () => {
    const sessions = await match.listSessions(tenantId, storeId);
    const completeSession = sessions.find((s: any) => s.status === 'COMPLETE');
    const full = await match.getSession(tenantId, completeSession!.id);
    await expect(match.disposeRow(tenantId, completeSession!.id, full.rows[0].id, 'MATCHED', 'tester')).rejects.toThrow(OemValidationError);
  });
});
