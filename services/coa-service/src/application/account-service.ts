import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import crypto from 'crypto';
import {
  AccountType,
  NormalBalance,
  defaultNormalBalance,
  isContra,
  isValidAccountNumber,
  isValidName,
  isValidNormalBalance,
  isValidType,
} from '../domain/gl-account';
import {
  MAX_TREE_DEPTH,
  TreeAccount,
  buildTree,
  projectedMaxDepth,
  wouldCreateCycle,
} from '../domain/account-tree';

// ── Errors (mapped to HTTP status in the route layer) ────────────────────────

export class AccountValidationError extends Error {
  readonly code: string;
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'AccountValidationError';
    this.code = code;
  }
}

/** BR210-1 — account number already exists for the entity → 409. */
export class DuplicateAccountError extends Error {
  readonly code = 'DUPLICATE_ACCOUNT_NUMBER';
  constructor(entityId: string, accountNumber: string) {
    super(`Account ${accountNumber} already exists for entity ${entityId}`);
    this.name = 'DuplicateAccountError';
  }
}

/** BR210-2 — type cannot change once the account has postings → 422. */
export class TypeImmutableError extends Error {
  readonly code = 'TYPE_IMMUTABLE_AFTER_POSTING';
  constructor(accountNumber: string) {
    super(`Account ${accountNumber} type is immutable after first posting`);
    this.name = 'TypeImmutableError';
  }
}

/** BR210-4 — cannot deactivate while balance != 0 → 422 (carries the balance). */
export class NonZeroBalanceError extends Error {
  readonly code = 'NONZERO_BALANCE';
  readonly balance: string;
  constructor(accountNumber: string, balance: string) {
    super(`Account ${accountNumber} cannot be deactivated while balance is ${balance}`);
    this.name = 'NonZeroBalanceError';
    this.balance = balance;
  }
}

export class AccountNotFoundError extends Error {
  readonly code = 'ACCOUNT_NOT_FOUND';
  constructor(id: string) {
    super(`Account ${id} not found`);
    this.name = 'AccountNotFoundError';
  }
}

/** BR211-1 — re-parenting would create a cycle → 422. */
export class CycleError extends Error {
  readonly code = 'CYCLE_DETECTED';
  constructor(accountId: string, parentId: string) {
    super(`Re-parenting ${accountId} under ${parentId} would create a cycle`);
    this.name = 'CycleError';
  }
}

/** BR211 — re-parenting would exceed the maximum tree depth → 422. */
export class MaxDepthError extends Error {
  readonly code = 'MAX_DEPTH_EXCEEDED';
  constructor(readonly maxDepth: number) {
    super(`Re-parenting would exceed the maximum hierarchy depth of ${maxDepth}`);
    this.name = 'MaxDepthError';
  }
}

/** BR211-2 — a parent (subtotal) node must be non-postable → 422. */
export class ParentNotSummaryError extends Error {
  readonly code = 'PARENT_NOT_SUMMARY';
  constructor(parentNumber: string) {
    super(`Parent account ${parentNumber} must be a non-postable summary node`);
    this.name = 'ParentNotSummaryError';
  }
}

/** S211 — the requested parent does not exist in the account's entity → 422. */
export class ParentNotFoundError extends Error {
  readonly code = 'PARENT_NOT_FOUND';
  constructor(parentId: string) {
    super(`Parent account ${parentId} not found in this entity`);
    this.name = 'ParentNotFoundError';
  }
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateAccountDTO {
  tenantId: string;
  entityId: string;
  accountNumber: string;
  name: string;
  type: string;
  normalBalance?: string;
  postable?: boolean;
  contraReason?: string;
  parentId?: string;
  actor: string;
}

export interface UpdateAccountDTO {
  tenantId: string;
  id: string;
  actor: string;
  name?: string;
  type?: string;
  normalBalance?: string;
  postable?: boolean;
  contraReason?: string;
}

export interface ReparentAccountDTO {
  tenantId: string;
  id: string;
  parentId: string | null;
  effectiveFrom?: string;
  actor: string;
}

/** Project a persisted account row onto the tree-domain shape. */
function toTreeAccount(a: any): TreeAccount {
  return {
    id: a.id,
    parentId: a.parentId ?? null,
    accountNumber: a.accountNumber,
    name: a.name,
    type: a.type,
    normalBalance: a.normalBalance,
    postable: a.postable,
    status: a.status,
  };
}

@injectable()
export class AccountService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(dto: CreateAccountDTO) {
    this.assertNumber(dto.accountNumber);
    this.assertName(dto.name);
    const type = this.assertType(dto.type);

    const normalBalance = this.resolveNormalBalance(type, dto.normalBalance, dto.contraReason);

    const existing = await this.prisma.glAccount.findUnique({
      where: { entityId_accountNumber: { entityId: dto.entityId, accountNumber: dto.accountNumber } },
    });
    if (existing) throw new DuplicateAccountError(dto.entityId, dto.accountNumber);

    const contra = isContra(type, normalBalance);
    const created = await this.prisma.glAccount.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: dto.tenantId,
        entityId: dto.entityId,
        accountNumber: dto.accountNumber,
        name: dto.name,
        type,
        normalBalance,
        isContra: contra,
        contraReason: contra ? (dto.contraReason ?? null) : null,
        postable: dto.postable ?? true,
        parentId: dto.parentId ?? null,
        status: 'ACTIVE',
        version: 1,
      },
    });

    await this.audit(dto.tenantId, created.id, 'CREATE', dto.actor, null, this.snapshot(created));
    await this.emit('coa.account.created', dto.tenantId, created.entityId, created.accountNumber, dto.actor, {
      created: this.snapshot(created),
    });
    return created;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async get(tenantId: string, id: string) {
    return this.load(tenantId, id);
  }

  async list(tenantId: string, entityId: string, status?: string) {
    return this.prisma.glAccount.findMany({
      where: { tenantId, entityId, ...(status ? { status } : {}) },
      orderBy: { accountNumber: 'asc' },
    });
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(dto: UpdateAccountDTO) {
    const account = await this.load(dto.tenantId, dto.id);
    const before = this.snapshot(account);
    const changes: Record<string, unknown> = {};

    let type = account.type as AccountType;
    if (dto.type !== undefined && dto.type !== account.type) {
      // BR210-2 — type immutable once the account has postings.
      if (account.hasPostings) throw new TypeImmutableError(account.accountNumber);
      type = this.assertType(dto.type);
      changes['type'] = { from: account.type, to: type };
    }

    if (dto.name !== undefined) {
      this.assertName(dto.name);
      if (dto.name !== account.name) changes['name'] = { from: account.name, to: dto.name };
    }

    let normalBalance = account.normalBalance as NormalBalance;
    let contraReason = account.contraReason;
    if (dto.normalBalance !== undefined || dto.type !== undefined) {
      normalBalance = this.resolveNormalBalance(
        type,
        dto.normalBalance ?? account.normalBalance,
        dto.contraReason ?? account.contraReason ?? undefined,
      );
      const contra = isContra(type, normalBalance);
      contraReason = contra ? (dto.contraReason ?? account.contraReason ?? null) : null;
      if (normalBalance !== account.normalBalance) {
        changes['normalBalance'] = { from: account.normalBalance, to: normalBalance };
      }
    }

    let postable = account.postable;
    if (dto.postable !== undefined && dto.postable !== account.postable) {
      postable = dto.postable;
      changes['postable'] = { from: account.postable, to: postable };
    }

    if (Object.keys(changes).length === 0) return account; // no-op

    const updated = await this.prisma.glAccount.update({
      where: { id: account.id },
      data: {
        name: dto.name ?? account.name,
        type,
        normalBalance,
        isContra: isContra(type, normalBalance),
        contraReason,
        postable,
        version: { increment: 1 },
      },
    });

    await this.audit(dto.tenantId, updated.id, 'UPDATE', dto.actor, before, this.snapshot(updated));
    await this.emit('coa.account.updated', dto.tenantId, updated.entityId, updated.accountNumber, dto.actor, changes);
    return updated;
  }

  // ── Deactivate ───────────────────────────────────────────────────────────────

  async deactivate(tenantId: string, id: string, actor: string) {
    const account = await this.load(tenantId, id);
    if (account.status === 'INACTIVE') return account; // idempotent

    // BR210-4 — blocked while balance != 0.
    if (!account.balance.equals(0)) {
      throw new NonZeroBalanceError(account.accountNumber, account.balance.toString());
    }

    const before = this.snapshot(account);
    const updated = await this.prisma.glAccount.update({
      where: { id: account.id },
      data: { status: 'INACTIVE', version: { increment: 1 } },
    });
    await this.audit(tenantId, updated.id, 'DEACTIVATE', actor, before, this.snapshot(updated));
    await this.emit('coa.account.deactivated', tenantId, updated.entityId, updated.accountNumber, actor, {
      status: { from: 'ACTIVE', to: 'INACTIVE' },
    });
    return updated;
  }

  // ── Hierarchy (S211) ─────────────────────────────────────────────────────────

  /** Nested tree for an entity, roots first, children ordered by number. */
  async tree(tenantId: string, entityId: string) {
    const accounts = await this.prisma.glAccount.findMany({ where: { tenantId, entityId } });
    return buildTree(accounts.map(toTreeAccount));
  }

  /**
   * BR211-1/2/3 — effective-dated single-parent re-parent.
   * Rejects self/descendant cycles (422), non-summary parents (422),
   * depth > MAX_TREE_DEPTH (422), and unknown parents (422).
   */
  async reparent(dto: ReparentAccountDTO) {
    const account = await this.load(dto.tenantId, dto.id);
    const newParentId = dto.parentId ?? null;

    if (newParentId === account.id) throw new CycleError(account.id, newParentId);

    // Whole-entity snapshot drives tree math.
    const siblings = await this.prisma.glAccount.findMany({
      where: { tenantId: dto.tenantId, entityId: account.entityId },
    });
    const treeAccounts = siblings.map(toTreeAccount);

    if (newParentId !== null) {
      const parent = siblings.find((a) => a.id === newParentId);
      if (!parent) throw new ParentNotFoundError(newParentId);
      // BR211-2 — subtotal (parent) nodes are non-postable.
      if (parent.postable) throw new ParentNotSummaryError(parent.accountNumber);
      // BR211-1 — cycle guard (self or descendant).
      if (wouldCreateCycle(account.id, newParentId, treeAccounts)) {
        throw new CycleError(account.id, newParentId);
      }
    }

    // Depth guard — recompute against the proposed link.
    if (projectedMaxDepth(account.id, newParentId, treeAccounts) > MAX_TREE_DEPTH) {
      throw new MaxDepthError(MAX_TREE_DEPTH);
    }

    if ((account.parentId ?? null) === newParentId) return account; // no-op

    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    const before = this.snapshot(account);
    const oldParentId = account.parentId ?? null;

    const updated = await this.prisma.glAccount.update({
      where: { id: account.id },
      data: { parentId: newParentId, parentEffectiveFrom: effectiveFrom, version: { increment: 1 } },
    });

    // BR211-3 — append-only effective-dated trail.
    try {
      await this.prisma.glAccountReparent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: dto.tenantId,
          entityId: account.entityId,
          accountId: account.id,
          oldParentId,
          newParentId,
          effectiveFrom,
          actor: dto.actor,
        },
      });
    } catch {
      /* history write is non-fatal */
    }

    await this.audit(dto.tenantId, updated.id, 'REPARENT', dto.actor, before, this.snapshot(updated));
    await this.emitReparented(dto.tenantId, updated, oldParentId, newParentId, effectiveFrom, dto.actor);
    return updated;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async load(tenantId: string, id: string) {
    const account = await this.prisma.glAccount.findUnique({ where: { id } });
    if (!account || account.tenantId !== tenantId) throw new AccountNotFoundError(id);
    return account;
  }

  private assertNumber(n: string) {
    if (!isValidAccountNumber(n)) {
      throw new AccountValidationError(`Account number must be 5 digits, got "${n}"`, 'INVALID_ACCOUNT_NUMBER');
    }
  }

  private assertName(name: string) {
    if (!isValidName(name)) {
      throw new AccountValidationError('Account name must be 1-120 characters', 'INVALID_NAME');
    }
  }

  private assertType(type: string): AccountType {
    if (!isValidType(type)) {
      throw new AccountValidationError(`Invalid account type "${type}"`, 'INVALID_TYPE');
    }
    return type;
  }

  /** BR210-3 — default by type; a contra override (non-default) requires a reason. */
  private resolveNormalBalance(
    type: AccountType,
    requested: string | undefined,
    contraReason: string | undefined,
  ): NormalBalance {
    if (requested === undefined) return defaultNormalBalance(type);
    if (!isValidNormalBalance(requested)) {
      throw new AccountValidationError(`Invalid normal balance "${requested}"`, 'INVALID_NORMAL_BALANCE');
    }
    if (isContra(type, requested) && !(contraReason && contraReason.trim().length > 0)) {
      throw new AccountValidationError(
        `Contra normal balance (${requested}) for ${type} account requires a reason`,
        'CONTRA_REASON_REQUIRED',
      );
    }
    return requested;
  }

  private snapshot(a: any) {
    return {
      accountNumber: a.accountNumber,
      name: a.name,
      type: a.type,
      normalBalance: a.normalBalance,
      isContra: a.isContra,
      contraReason: a.contraReason,
      postable: a.postable,
      status: a.status,
      version: a.version,
    };
  }

  private async audit(
    tenantId: string,
    docId: string,
    action: string,
    actor: string,
    before: unknown,
    after: unknown,
  ) {
    try {
      await this.prisma.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          docType: 'gl_account',
          docId,
          action,
          before: (before ?? undefined) as any,
          after: (after ?? undefined) as any,
          actor,
        },
      });
    } catch {
      /* AuditPort write is non-fatal */
    }
  }

  private async emit(
    eventType: 'coa.account.created' | 'coa.account.updated' | 'coa.account.deactivated',
    tenantId: string,
    entityId: string,
    accountNumber: string,
    actor: string,
    changes: Record<string, unknown>,
  ) {
    const eventId = crypto.randomUUID();
    const payload = {
      eventId,
      entityId,
      accountNumber,
      changes,
      actor,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    try {
      await this.prisma.coaOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          eventType,
          aggregateId: accountNumber,
          payload: payload as any,
        },
      });
    } catch {
      /* non-fatal */
    }
    try {
      await this.events.publish({
        type: eventType,
        tenantId,
        payload,
        occurredAt: new Date(),
        correlationId: eventId,
      } as any);
    } catch {
      /* best-effort; outbox row is the record of truth */
    }
  }

  private async emitReparented(
    tenantId: string,
    account: any,
    oldParentId: string | null,
    newParentId: string | null,
    effectiveFrom: Date,
    actor: string,
  ) {
    const eventId = crypto.randomUUID();
    const payload = {
      eventId,
      accountId: account.id,
      oldParentId,
      newParentId,
      effectiveFrom: effectiveFrom.toISOString(),
      actor,
      ts: new Date().toISOString(),
      schemaV: 1,
    };
    try {
      await this.prisma.coaOutboxEvent.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          eventType: 'coa.account.reparented',
          aggregateId: account.accountNumber,
          payload: payload as any,
        },
      });
    } catch {
      /* non-fatal */
    }
    try {
      await this.events.publish({
        type: 'coa.account.reparented',
        tenantId,
        payload,
        occurredAt: new Date(),
        correlationId: eventId,
      } as any);
    } catch {
      /* best-effort */
    }
  }
}
