/**
 * S212 — Journal Source Registry unit tests.
 * Strategy: in-memory fake Prisma + fake event publisher via tsyringe.
 * Covers BR212-1 (system source not usable by manual path, API), BR212-2
 * (reserved immutable, tenants add manual only), BR212-3 (deactivation),
 * flag behavior, and every §9 4xx path with a named test.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import {
  SourceService,
  SourceValidationError,
  DuplicateSourceError,
  SystemSourceCreationError,
  ReservedImmutableError,
  SystemSourceNotManualError,
  SourceNotFoundError,
} from '../src/application/source-service';
import { RESERVED_SOURCES } from '../src/domain/journal-source';

const TENANT = 'tenant-kunes';

function makePrisma(seed: any[] = []) {
  const rows: any[] = [...seed];
  const audits: any[] = [];
  const outbox: any[] = [];
  const key = (t: string, c: string) => `${t}::${c}`;
  const client: any = {
    _rows: rows,
    _audits: audits,
    _outbox: outbox,
    journalSource: {
      findUnique: async ({ where }: any) => {
        const { tenantId, code } = where.tenantId_code;
        return rows.find((r) => key(r.tenantId, r.code) === key(tenantId, code)) ?? null;
      },
      findMany: async ({ where }: any) =>
        rows
          .filter((r) => r.tenantId === where.tenantId)
          .filter((r) => (where.sourceClass ? r.sourceClass === where.sourceClass : true))
          .filter((r) => (where.status ? r.status === where.status : true)),
      create: async ({ data }: any) => {
        rows.push(data);
        return data;
      },
      update: async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
          else row[k] = v;
        }
        return row;
      },
    },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
  };
  client.$transaction = async (arg: any) =>
    typeof arg === 'function' ? arg(client) : Promise.all(arg);
  return client;

}

function makeEvents() {
  const published: any[] = [];
  return { published, publish: async (e: any) => void published.push(e) };
}

function setup(seed: any[] = []) {
  container.reset();
  const prisma = makePrisma(seed);
  const events = makeEvents();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.register('SourceService', { useClass: SourceService });
  return { svc: container.resolve<SourceService>('SourceService'), prisma, events };
}

describe('S212 — create (BR212-2 tenants add MANUAL)', () => {
  it('creates a MANUAL source, emits coa.source.created + audit', async () => {
    const { svc, prisma, events } = setup();
    const row = await svc.create({ tenantId: TENANT, code: 'misc', name: 'Miscellaneous', actor: 'ctrl' });
    expect(row.code).toBe('MISC'); // upper-cased
    expect(row.sourceClass).toBe('MANUAL');
    expect(row.reserved).toBe(false);
    expect(row.status).toBe('ACTIVE');
    expect(events.published.find((e) => e.type === 'coa.source.created')).toBeTruthy();
    expect(prisma._audits.find((a) => a.action === 'CREATE')).toBeTruthy();
  });

  it('422 CANNOT_CREATE_SYSTEM_SOURCE when class=SYSTEM', async () => {
    const { svc } = setup();
    await expect(
      svc.create({ tenantId: TENANT, code: 'SYS1', name: 'x', sourceClass: 'SYSTEM', actor: 'a' }),
    ).rejects.toBeInstanceOf(SystemSourceCreationError);
  });

  it('422 INVALID_CODE for bad code', async () => {
    const { svc } = setup();
    await expect(svc.create({ tenantId: TENANT, code: 'a', name: 'x', actor: 'a' })).rejects.toMatchObject({
      code: 'INVALID_CODE',
    });
  });

  it('422 INVALID_NAME for empty name', async () => {
    const { svc } = setup();
    await expect(svc.create({ tenantId: TENANT, code: 'AB', name: '  ', actor: 'a' })).rejects.toBeInstanceOf(
      SourceValidationError,
    );
  });

  it('409 DUPLICATE_SOURCE_CODE', async () => {
    const { svc } = setup();
    await svc.create({ tenantId: TENANT, code: 'DUP', name: 'first', actor: 'a' });
    await expect(svc.create({ tenantId: TENANT, code: 'dup', name: 'second', actor: 'a' })).rejects.toBeInstanceOf(
      DuplicateSourceError,
    );
  });

  it('adopts flags on the created source', async () => {
    const { svc } = setup();
    const row = await svc.create({
      tenantId: TENANT,
      code: 'YEEXT',
      name: 'YE extra',
      flags: { yearEndOnly: true },
      actor: 'a',
    });
    expect(row.yearEndOnly).toBe(true);
    expect(row.autoPost).toBe(false);
  });
});

describe('S212 — bootstrap reserved + BR212-1 manual guard', () => {
  it('bootstrap is idempotent (created then merged) and seeds MANUAL + SYSTEM reserved', async () => {
    const { svc, prisma } = setup();
    const r1 = await svc.bootstrapReserved(TENANT, 'sys');
    expect(r1.created).toBe(RESERVED_SOURCES.length);
    expect(r1.merged).toBe(0);
    const r2 = await svc.bootstrapReserved(TENANT, 'sys');
    expect(r2.created).toBe(0);
    expect(r2.merged).toBe(RESERVED_SOURCES.length);
    // GJ is MANUAL reserved, SVC is SYSTEM reserved
    expect(prisma._rows.find((r) => r.code === 'GJ').sourceClass).toBe('MANUAL');
    expect(prisma._rows.find((r) => r.code === 'SVC').sourceClass).toBe('SYSTEM');
    expect(prisma._rows.every((r) => r.reserved === true)).toBe(true);
  });

  it('BR212-1 assertUsableByManual → 422 for SYSTEM source', async () => {
    const { svc } = setup();
    await svc.bootstrapReserved(TENANT, 'sys');
    await expect(svc.assertUsableByManual(TENANT, 'SVC')).rejects.toBeInstanceOf(SystemSourceNotManualError);
  });

  it('BR212-1 assertUsableByManual → ok for MANUAL source', async () => {
    const { svc } = setup();
    await svc.bootstrapReserved(TENANT, 'sys');
    const row = await svc.assertUsableByManual(TENANT, 'GJ');
    expect(row.code).toBe('GJ');
  });

  it('assertUsableByManual → 422 SOURCE_INACTIVE for a deactivated manual source', async () => {
    const { svc } = setup();
    await svc.create({ tenantId: TENANT, code: 'TMP', name: 'temp', actor: 'a' });
    await svc.deactivate(TENANT, 'TMP', 'a');
    await expect(svc.assertUsableByManual(TENANT, 'TMP')).rejects.toMatchObject({ code: 'SOURCE_INACTIVE' });
  });
});

describe('S212 — reserved immutability (BR212-2) + update/deactivate (BR212-3)', () => {
  it('422 RESERVED_SOURCE_IMMUTABLE on update of a reserved source', async () => {
    const { svc } = setup();
    await svc.bootstrapReserved(TENANT, 'sys');
    await expect(svc.update({ tenantId: TENANT, code: 'GJ', name: 'renamed', actor: 'a' })).rejects.toBeInstanceOf(
      ReservedImmutableError,
    );
  });

  it('422 RESERVED_SOURCE_IMMUTABLE on deactivate of a reserved source', async () => {
    const { svc } = setup();
    await svc.bootstrapReserved(TENANT, 'sys');
    await expect(svc.deactivate(TENANT, 'SVC', 'a')).rejects.toBeInstanceOf(ReservedImmutableError);
  });

  it('updates a custom MANUAL source name + flags and emits updated', async () => {
    const { svc, events } = setup();
    await svc.create({ tenantId: TENANT, code: 'CUS', name: 'Custom', actor: 'a' });
    const row = await svc.update({ tenantId: TENANT, code: 'CUS', name: 'Custom 2', flags: { autoPost: true }, actor: 'a' });
    expect(row.name).toBe('Custom 2');
    expect(row.autoPost).toBe(true);
    expect(row.version).toBe(2);
    expect(events.published.find((e) => e.type === 'coa.source.updated')).toBeTruthy();
  });

  it('BR212-3 deactivate custom source → INACTIVE, idempotent, emits deactivated', async () => {
    const { svc, events } = setup();
    await svc.create({ tenantId: TENANT, code: 'OLD', name: 'Old', actor: 'a' });
    const row = await svc.deactivate(TENANT, 'OLD', 'a');
    expect(row.status).toBe('INACTIVE');
    const again = await svc.deactivate(TENANT, 'OLD', 'a');
    expect(again.status).toBe('INACTIVE');
    expect(events.published.filter((e) => e.type === 'coa.source.deactivated')).toHaveLength(1);
  });

  it('404 SOURCE_NOT_FOUND for unknown code', async () => {
    const { svc } = setup();
    await expect(svc.get(TENANT, 'NOPE')).rejects.toBeInstanceOf(SourceNotFoundError);
  });
});

describe('S212 — list filters', () => {
  it('filters by class and status', async () => {
    const { svc } = setup();
    await svc.bootstrapReserved(TENANT, 'sys');
    await svc.create({ tenantId: TENANT, code: 'CUS', name: 'Custom', actor: 'a' });
    const manual = await svc.list(TENANT, { sourceClass: 'MANUAL' });
    expect(manual.every((r) => r.sourceClass === 'MANUAL')).toBe(true);
    const system = await svc.list(TENANT, { sourceClass: 'SYSTEM' });
    expect(system.every((r) => r.sourceClass === 'SYSTEM')).toBe(true);
    expect(system.length).toBe(RESERVED_SOURCES.filter((r) => r.sourceClass === 'SYSTEM').length);
  });
});
