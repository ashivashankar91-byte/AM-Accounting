/**
 * S210 — Basic Chart of Accounts CRUD unit tests.
 *
 * Strategy: in-memory fake Prisma + fake event publisher via tsyringe (matches
 * S208/S209). Balance is a Decimal-like with .equals()/.toString() to mirror the
 * Prisma runtime. Real audit_outbox / coa_outbox_events rows are Docker evidence.
 *
 * Covers every §9 4xx path with a named negative: 409 duplicate, 422 type-change-
 * after-posting, 422 nonzero-balance-on-deactivate, plus validation + tenant scope.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import crypto from 'crypto';
import {
  AccountService,
  AccountValidationError,
  DuplicateAccountError,
  TypeImmutableError,
  NonZeroBalanceError,
  AccountNotFoundError,
} from '../src/application/account-service';
import {
  ACCOUNT_TYPES,
  defaultNormalBalance,
  isContra,
  isValidAccountNumber,
} from '../src/domain/gl-account';

const TENANT = 'tenant-kunes';
const ENTITY = 'a24612ec-d281-4360-a159-9c0debc8610b';
const ENTITY2 = 'd423b81a-0a1f-4155-be04-1d181b57306f';
const ACTOR = 'controller-1';

// Decimal-like matching the shape AccountService relies on.
function dec(n: number) {
  return { _v: n, equals: (x: any) => n === Number(x), toString: () => String(n) };
}

function makePrisma(seed: any[] = []) {
  const accounts: any[] = [...seed];
  const audits: any[] = [];
  const outbox: any[] = [];
  const client: any = {
    _accounts: accounts,
    _audits: audits,
    _outbox: outbox,
    glAccount: {
      findUnique: async ({ where }: any) => {
        if (where.id) return accounts.find((a) => a.id === where.id) ?? null;
        if (where.entityId_accountNumber) {
          const { entityId, accountNumber } = where.entityId_accountNumber;
          return accounts.find((a) => a.entityId === entityId && a.accountNumber === accountNumber) ?? null;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const row = {
          ...data,
          balance: data.balance ?? dec(0),
          hasPostings: data.hasPostings ?? false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        accounts.push(row);
        return row;
      },
      findMany: async ({ where, orderBy }: any) => {
        let rows = accounts.filter(
          (a) =>
            a.tenantId === where.tenantId &&
            a.entityId === where.entityId &&
            (where.status === undefined || a.status === where.status),
        );
        if (orderBy?.accountNumber === 'asc') {
          rows = rows.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
        }
        return rows;
      },
      update: async ({ where, data }: any) => {
        const row = accounts.find((a) => a.id === where.id);
        for (const [k, v] of Object.entries<any>(data)) {
          if (v && typeof v === 'object' && 'increment' in v) row[k] = (row[k] ?? 0) + v.increment;
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

function account(overrides: Partial<any> = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    tenantId: TENANT,
    entityId: ENTITY,
    accountNumber: '10000',
    name: 'Cash',
    type: 'ASSET',
    normalBalance: 'DR',
    isContra: false,
    contraReason: null,
    postable: true,
    parentId: null,
    status: 'ACTIVE',
    balance: dec(0),
    hasPostings: false,
    version: 1,
    ...overrides,
  };
}

function setup(seed: any[] = []) {
  container.reset();
  const prisma = makePrisma(seed);
  const events = makeEvents();
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.register('AccountService', { useClass: AccountService });
  const svc = container.resolve<AccountService>('AccountService');
  return { svc, prisma, events };
}

// ── Pure domain ─────────────────────────────────────────────────────────────────

describe('S210 domain', () => {
  it('exposes the 5 canonical account types', () => {
    expect(ACCOUNT_TYPES).toEqual(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
  });
  it('defaults normal balance by type', () => {
    expect(defaultNormalBalance('ASSET')).toBe('DR');
    expect(defaultNormalBalance('EXPENSE')).toBe('DR');
    expect(defaultNormalBalance('LIABILITY')).toBe('CR');
    expect(defaultNormalBalance('EQUITY')).toBe('CR');
    expect(defaultNormalBalance('REVENUE')).toBe('CR');
  });
  it('flags contra when normal balance differs from the type default', () => {
    expect(isContra('ASSET', 'CR')).toBe(true);
    expect(isContra('ASSET', 'DR')).toBe(false);
  });
  it('validates 5-digit account numbers', () => {
    expect(isValidAccountNumber('10000')).toBe(true);
    expect(isValidAccountNumber('1000')).toBe(false);
    expect(isValidAccountNumber('ABCDE')).toBe(false);
  });
});

// ── Create ──────────────────────────────────────────────────────────────────────

describe('S210 service — create', () => {
  it('creates 10000 Cash/ASSET/DR postable & ACTIVE, emits coa.account.created + audit', async () => {
    const { svc, prisma, events } = setup();
    const a = await svc.create({
      tenantId: TENANT, entityId: ENTITY, accountNumber: '10000', name: 'Cash', type: 'ASSET', actor: ACTOR,
    });
    expect(a).toMatchObject({ accountNumber: '10000', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE', version: 1 });
    expect(events.published.find((e) => e.type === 'coa.account.created').payload).toMatchObject({ entityId: ENTITY, accountNumber: '10000', schemaV: 1 });
    expect(prisma._audits.some((x) => x.docType === 'gl_account' && x.action === 'CREATE')).toBe(true);
    expect(prisma._outbox.some((o) => o.eventType === 'coa.account.created')).toBe(true);
  });

  it('defaults REVENUE to CR normal balance', async () => {
    const { svc } = setup();
    const a = await svc.create({ tenantId: TENANT, entityId: ENTITY, accountNumber: '49000', name: 'Sales', type: 'REVENUE', actor: ACTOR });
    expect(a.normalBalance).toBe('CR');
    expect(a.isContra).toBe(false);
  });

  it('allows a contra asset (12430 CR) when a reason is supplied (BR210-3)', async () => {
    const { svc } = setup();
    const a = await svc.create({
      tenantId: TENANT, entityId: ENTITY, accountNumber: '12430', name: 'Allowance for Doubtful Accounts',
      type: 'ASSET', normalBalance: 'CR', contraReason: 'Contra-asset valuation allowance', actor: ACTOR,
    });
    expect(a).toMatchObject({ normalBalance: 'CR', isContra: true });
    expect(a.contraReason).toMatch(/allowance/i);
  });
});

// ── Named negatives (packet §9 + validation) ────────────────────────────────────

describe('S210 service — negative paths', () => {
  it('409 DUPLICATE_ACCOUNT_NUMBER for a repeated number in the same entity (BR210-1)', async () => {
    const { svc } = setup([account({ accountNumber: '10000' })]);
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, accountNumber: '10000', name: 'Dup', type: 'ASSET', actor: ACTOR }),
    ).rejects.toBeInstanceOf(DuplicateAccountError);
  });

  it('allows the same number in a different entity', async () => {
    const { svc } = setup([account({ accountNumber: '10000', entityId: ENTITY })]);
    const a = await svc.create({ tenantId: TENANT, entityId: ENTITY2, accountNumber: '10000', name: 'Cash 02', type: 'ASSET', actor: ACTOR });
    expect(a.entityId).toBe(ENTITY2);
  });

  it('422 contra normal balance without a reason (CONTRA_REASON_REQUIRED)', async () => {
    const { svc } = setup();
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, accountNumber: '12430', name: 'Contra', type: 'ASSET', normalBalance: 'CR', actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'CONTRA_REASON_REQUIRED' });
  });

  it('422 invalid account number (not 5 digits)', async () => {
    const { svc } = setup();
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, accountNumber: '999', name: 'Bad', type: 'ASSET', actor: ACTOR }),
    ).rejects.toBeInstanceOf(AccountValidationError);
  });

  it('422 invalid type', async () => {
    const { svc } = setup();
    await expect(
      svc.create({ tenantId: TENANT, entityId: ENTITY, accountNumber: '10001', name: 'X', type: 'CONTROL', actor: ACTOR }),
    ).rejects.toMatchObject({ code: 'INVALID_TYPE' });
  });

  it('422 TYPE_IMMUTABLE_AFTER_POSTING when changing type on a posted account (BR210-2)', async () => {
    const { svc } = setup([account({ id: 'acc-1', hasPostings: true })]);
    await expect(
      svc.update({ tenantId: TENANT, id: 'acc-1', type: 'EXPENSE', actor: ACTOR }),
    ).rejects.toBeInstanceOf(TypeImmutableError);
  });

  it('422 NONZERO_BALANCE on deactivate carries the balance (BR210-4)', async () => {
    const { svc } = setup([account({ id: 'acc-1', balance: dec(150.5) })]);
    await expect(
      svc.deactivate(TENANT, 'acc-1', ACTOR),
    ).rejects.toMatchObject({ code: 'NONZERO_BALANCE', balance: '150.5' });
  });

  it('404 ACCOUNT_NOT_FOUND on get for an unknown id', async () => {
    const { svc } = setup();
    await expect(svc.get(TENANT, 'nope')).rejects.toBeInstanceOf(AccountNotFoundError);
  });

  it('tenant isolation: another tenant cannot read the account', async () => {
    const { svc } = setup([account({ id: 'acc-1' })]);
    await expect(svc.get('tenant-other', 'acc-1')).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});

// ── Update + deactivate happy paths ─────────────────────────────────────────────

describe('S210 service — update + deactivate', () => {
  it('updates name, bumps version, emits coa.account.updated with changes', async () => {
    const { svc, events } = setup([account({ id: 'acc-1', name: 'Cash' })]);
    const u = await svc.update({ tenantId: TENANT, id: 'acc-1', name: 'Operating Cash', actor: ACTOR });
    expect(u).toMatchObject({ name: 'Operating Cash', version: 2 });
    expect(events.published.find((e) => e.type === 'coa.account.updated').payload.changes).toHaveProperty('name');
  });

  it('changes type when the account has no postings', async () => {
    const { svc } = setup([account({ id: 'acc-1', type: 'ASSET', hasPostings: false })]);
    const u = await svc.update({ tenantId: TENANT, id: 'acc-1', type: 'EXPENSE', actor: ACTOR });
    expect(u.type).toBe('EXPENSE');
  });

  it('deactivates a zero-balance account -> INACTIVE, emits coa.account.deactivated', async () => {
    const { svc, events } = setup([account({ id: 'acc-1', balance: dec(0) })]);
    const d = await svc.deactivate(TENANT, 'acc-1', ACTOR);
    expect(d.status).toBe('INACTIVE');
    expect(events.published.some((e) => e.type === 'coa.account.deactivated')).toBe(true);
  });

  it('deactivate is idempotent when already INACTIVE', async () => {
    const { svc, events } = setup([account({ id: 'acc-1', status: 'INACTIVE', balance: dec(0) })]);
    const d = await svc.deactivate(TENANT, 'acc-1', ACTOR);
    expect(d.status).toBe('INACTIVE');
    expect(events.published).toHaveLength(0);
  });

  it('lists accounts ordered by number, filtered by status', async () => {
    const { svc } = setup([
      account({ id: 'a', accountNumber: '49000', status: 'ACTIVE' }),
      account({ id: 'b', accountNumber: '10000', status: 'ACTIVE' }),
      account({ id: 'c', accountNumber: '20000', status: 'INACTIVE' }),
    ]);
    const active = await svc.list(TENANT, ENTITY, 'ACTIVE');
    expect(active.map((a) => a.accountNumber)).toEqual(['10000', '49000']);
  });
});
