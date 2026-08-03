import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '../node_modules/.prisma/gl-client';
import {
  StatementLineService,
  StatementMetadataOverlapError,
} from '../src/application/statement-line-service';

/**
 * S009 — live-DB proof of the effective-dated statement-metadata governance
 * model (BLK-09, Option 2, approved 2026-07-28): every mapping requires an
 * effective period, reason, and actor; ranges are non-overlapping and
 * immutable once superseded; historical resolution must return the mapping
 * that was effective for the requested period, not whatever is current.
 */

const DATABASE_URL = process.env['DATABASE_URL'];

describe.skipIf(!DATABASE_URL)('StatementLineService (S009 live-DB proof)', () => {
  let prisma: PrismaClient;
  let svc: StatementLineService;
  const tenantId = `s009-tenant-${randomUUID()}`;
  const accountId = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL + "?connection_limit=1" } } });
    await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantId}'`);
    await prisma.$connect();
    svc = new StatementLineService(prisma as any);

    await prisma.gLAccount.create({
      data: {
        id: accountId,
        tenantId,
        code: '5900',
        name: 'Cost of Goods Sold',
        type: 'COST_OF_SALES',
        normalBalance: 'DEBIT',
        allowPosting: true,
        openingBalance: 0,
      },
    });
  });

  afterAll(async () => {
    await prisma.gLAccountStatementLineHistory.deleteMany({ where: { tenantId } });
    await prisma.outboxEvent.deleteMany({ where: { tenantId } });
    await prisma.gLAccount.deleteMany({ where: { tenantId } });
    await prisma.statementLine.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  it('creates a statement-line catalog entry and emits an audit outbox event', async () => {
    const line = await svc.createStatementLine(
      tenantId,
      { code: 'COGS', name: 'Cost of Sales', statement: 'IS', section: 'COST_OF_SALES', sortOrder: 10 },
      'sme-1',
    );
    expect(line.code).toBe('COGS');

    const event = await prisma.outboxEvent.findFirst({ where: { tenantId, eventType: 'GL_STATEMENT_LINE_CREATED' } });
    expect(event).not.toBeNull();
    expect((event!.payload as any).statementLineId).toBe(line.id);
  });

  it('BLK-09: sets an effective-dated mapping, rejects an overlapping range, and allows a valid sequential reclassification', async () => {
    const line = await svc.createStatementLine(
      tenantId,
      { code: 'COGS2', name: 'Cost of Sales (v2)', statement: 'IS', section: 'COST_OF_SALES' },
      'sme-1',
    );

    const first = await svc.setAccountStatementMetadata(tenantId, {
      glAccountId: accountId,
      statementLineId: line.id,
      effectiveFrom: '2026-01-01',
      reason: 'bootstrap classification',
      actor: 'sme-1',
      isBootstrap: true,
    });
    expect(first.effectiveTo).toBeNull();

    // Overlapping range (starts before the open range's effectiveFrom) must be rejected.
    await expect(
      svc.setAccountStatementMetadata(tenantId, {
        glAccountId: accountId,
        statementLineId: line.id,
        effectiveFrom: '2025-06-01',
        reason: 'bad backdate',
        actor: 'sme-2',
      }),
    ).rejects.toBeInstanceOf(StatementMetadataOverlapError);

    // Valid prospective reclassification closes the first range and opens a new one.
    const second = await svc.setAccountStatementMetadata(tenantId, {
      glAccountId: accountId,
      statementLineId: line.id,
      effectiveFrom: '2026-06-01',
      reason: 'reclass to updated presentation',
      actor: 'sme-2',
    });
    expect(second.effectiveTo).toBeNull();

    const closedFirst = await prisma.gLAccountStatementLineHistory.findUnique({ where: { id: first.id } });
    expect(closedFirst?.effectiveTo?.toISOString().slice(0, 10)).toBe('2026-06-01');

    // Historical resolution: a report "as of" March 2026 must resolve the
    // FIRST mapping, not whatever is current today.
    const marchResolved = await svc.resolveEffectiveStatementLine(tenantId, accountId, '2026-03-15');
    expect(marchResolved?.id).toBe(first.id);

    const julyResolved = await svc.resolveEffectiveStatementLine(tenantId, accountId, '2026-07-15');
    expect(julyResolved?.id).toBe(second.id);

    // GL account's denormalized "current" pointer reflects the latest mapping.
    const account = await prisma.gLAccount.findUnique({ where: { id: accountId } });
    expect(account?.statementLineId).toBe(line.id);

    const changeEvents = await prisma.outboxEvent.count({
      where: { tenantId, eventType: 'GL_ACCOUNT_STATEMENT_METADATA_CHANGED' },
    });
    expect(changeEvents).toBe(2); // first + second (the rejected overlap never committed)
  });
});
