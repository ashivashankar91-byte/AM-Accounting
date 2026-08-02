/**
 * CE-07 — authoritative GL idempotency (final closing pass). Proves, against
 * a real database, that gl-service's own posting door — not just any
 * caller's bookkeeping (e.g. coa-service's PostingExecution claim row) — is
 * the authoritative duplicate-prevention layer for a journal created with an
 * idempotencyKey:
 *
 *   1. the same key returns the ORIGINAL journal on a sequential retry
 *      (the "timeout/retry after successful GL persistence" scenario);
 *   2. concurrent duplicate submissions of the SAME key create exactly one
 *      journal, enforced by a real database-level partial unique index —
 *      not just application-level coordination;
 *   3. the DB-level UNIQUE constraint itself rejects a bypass attempt
 *      (raw SQL insert), proving the guarantee doesn't depend on every
 *      caller going through PrismaJournalRepository.create();
 *   4. no idempotency key is required for existing callers — behavior is
 *      unchanged and no auto-approval ever occurs (every path here ends at
 *      DRAFT, never POSTED — this repository method never calls approve).
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../node_modules/.prisma/gl-client';
import { randomUUID } from 'crypto';
import { PrismaJournalRepository } from '../src/infrastructure/journal-repository';

const DATABASE_URL = process.env['DATABASE_URL'];

describe.skipIf(!DATABASE_URL)('CE-07 — authoritative GL idempotency (journal_entries.idempotency_key)', () => {
  let prisma: PrismaClient;
  let repo: PrismaJournalRepository;
  const TENANT = `idem-${randomUUID()}`;
  let drAcctId: string;
  let crAcctId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    repo = new PrismaJournalRepository(prisma as any);

    drAcctId = randomUUID();
    crAcctId = randomUUID();
    await prisma.gLAccount.createMany({
      data: [
        { id: drAcctId, tenantId: TENANT, code: '19000', name: 'Idempotency DR fixture (test only)', type: 'ASSET', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
        { id: crAcctId, tenantId: TENANT, code: '19100', name: 'Idempotency CR fixture (test only)', type: 'ASSET', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.journalLine.deleteMany({ where: { journalEntry: { tenantId: TENANT } } });
    await prisma.journalEntry.deleteMany({ where: { tenantId: TENANT } });
    await prisma.gLAccount.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  function dto(idempotencyKey: string | undefined, description: string) {
    return {
      entryDate: new Date('2026-08-03'),
      description,
      source: 'PE',
      sourceRef: 'IDEMTEST',
      lines: [
        { glAccountId: drAcctId, debit: 100, credit: 0, memo: 'dr' },
        { glAccountId: crAcctId, debit: 0, credit: 100, memo: 'cr' },
      ],
      idempotencyKey,
    } as any;
  }

  it('a sequential retry with the SAME idempotencyKey returns the ORIGINAL journal — never a second row', async () => {
    const key = `retry-${randomUUID()}`;
    const first = await repo.create(dto(key, 'first attempt'), TENANT as any);
    expect(first.status).toBe('DRAFT'); // never auto-approved

    // Simulates the caller losing the response after gl-service already
    // committed the journal (network timeout, process crash) and retrying
    // the identical request.
    const second = await repo.create(dto(key, 'first attempt'), TENANT as any);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe('DRAFT');

    const count = await prisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey: key } as any });
    expect(count).toBe(1);
  });

  it('concurrent duplicate submissions of the SAME idempotencyKey create exactly one journal', async () => {
    const key = `race-${randomUUID()}`;
    const [a, b, c] = await Promise.allSettled([
      repo.create(dto(key, 'race attempt A'), TENANT as any),
      repo.create(dto(key, 'race attempt B'), TENANT as any),
      repo.create(dto(key, 'race attempt C'), TENANT as any),
    ]);
    for (const r of [a, b, c]) expect(r.status, 'every concurrent attempt for a first-time key must succeed, never error').toBe('fulfilled');

    const ids = new Set([a, b, c].filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled').map((r) => r.value.id));
    expect(ids.size).toBe(1); // all three resolved to the SAME journal id

    const count = await prisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey: key } as any });
    expect(count).toBe(1);
  });

  it('the database-level partial unique index rejects a duplicate key even bypassing the repository (raw SQL) — the guarantee is not merely application-level', async () => {
    const key = `raw-sql-${randomUUID()}`;
    const first = await repo.create(dto(key, 'via repository'), TENANT as any);
    expect(first.status).toBe('DRAFT');

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO journal_entries (id, tenant_id, entry_date, description, source, status, idempotency_key) VALUES ($1, $2, $3, 'direct SQL duplicate attempt', 'PE', 'DRAFT', $4)`,
        randomUUID(), TENANT, new Date('2026-08-03'), key,
      ),
    ).rejects.toThrow(/already exists|duplicate key|unique constraint|23505/i);

    const count = await prisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey: key } as any });
    expect(count).toBe(1);
  });

  it('two DIFFERENT idempotencyKeys create two DIFFERENT journals — the constraint never over-collapses distinct events', async () => {
    const first = await repo.create(dto(`distinct-a-${randomUUID()}`, 'distinct A'), TENANT as any);
    const second = await repo.create(dto(`distinct-b-${randomUUID()}`, 'distinct B'), TENANT as any);
    expect(first.id).not.toBe(second.id);
  });

  it('omitting idempotencyKey entirely preserves existing (legacy caller) behavior — every call creates its own journal, never collapsed together', async () => {
    const first = await repo.create(dto(undefined, 'no key A'), TENANT as any);
    const second = await repo.create(dto(undefined, 'no key B'), TENANT as any);
    expect(first.id).not.toBe(second.id);

    // Any number of NULL idempotency_key rows coexist — the partial index
    // (WHERE idempotency_key IS NOT NULL) never applies to them.
    const nullCount = await prisma.journalEntry.count({ where: { tenantId: TENANT, idempotencyKey: null } as any });
    expect(nullCount).toBeGreaterThanOrEqual(2);
  });
});
