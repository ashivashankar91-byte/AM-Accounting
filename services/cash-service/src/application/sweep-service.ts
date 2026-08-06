import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import {
  isValidSweepDirection, canPostSweep, canVoidSweep,
  SweepInputError, SweepConfigNotFoundError, SweepNotFoundError, SweepNotPostableError, SweepNotVoidableError,
} from '../domain/sweep';
import { buildMatrixRowEnvelope } from '../domain/posting-envelope';

export interface ConfigureSweepPairDTO {
  tenantId: string;
  entityId: string;
  storeAccountCode: string;
  operatingAccountCode: string;
  actor: string;
}

export interface RecordSweepDTO {
  tenantId: string;
  pairConfigId: string;
  sweepDate: string; // YYYY-MM-DD
  direction: string;
  amount: number | string;
  confirmationState?: 'MANUAL_RECORDED' | 'FEED_CONFIRMED';
  idempotencyKey: string;
  actor: string;
}

/**
 * S056 — ZBA sweep recording + posting between a configurable
 * store/operating account pair. Each sweep is a single amount + direction
 * (never two independently entered legs), so the posted journal pair nets
 * exactly zero across the two accounts by construction. confirmationState
 * is truthful: callers may only set FEED_CONFIRMED when they actually have
 * a matched bank-feed line; this service does not fabricate feed
 * confirmation — the default and only always-available path is
 * MANUAL_RECORDED.
 */
@injectable()
export class SweepService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  async configurePair(dto: ConfigureSweepPairDTO) {
    if (!dto.storeAccountCode || !dto.operatingAccountCode) {
      throw new SweepInputError('storeAccountCode and operatingAccountCode are required');
    }
    const existing = await this.prisma.sweepAccountPairConfig.findFirst({
      where: { tenantId: dto.tenantId, storeAccountCode: dto.storeAccountCode, operatingAccountCode: dto.operatingAccountCode },
    });
    if (existing) return { ...existing, idempotent: true };

    const created = await this.prisma.sweepAccountPairConfig.create({
      data: {
        id: crypto.randomUUID(), tenantId: dto.tenantId, entityId: dto.entityId,
        storeAccountCode: dto.storeAccountCode, operatingAccountCode: dto.operatingAccountCode,
        active: true, createdBy: dto.actor,
      },
    });
    return { ...created, idempotent: false };
  }

  async listPairs(tenantId: string) {
    return this.prisma.sweepAccountPairConfig.findMany({ where: { tenantId, active: true } });
  }

  async recordSweep(dto: RecordSweepDTO) {
    if (!dto.idempotencyKey) throw new SweepInputError('idempotencyKey is required');
    if (!isValidSweepDirection(dto.direction)) throw new SweepInputError('direction must be STORE_TO_OPERATING or OPERATING_TO_STORE');
    const amountCents = Math.round(Number(dto.amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) throw new SweepInputError('amount must be a positive number');

    const prior = await this.prisma.zbaSweep.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
    });
    if (prior) return { ...prior, idempotent: true };

    const pairConfig = await this.prisma.sweepAccountPairConfig.findFirst({
      where: { id: dto.pairConfigId, tenantId: dto.tenantId, active: true },
    });
    if (!pairConfig) throw new SweepConfigNotFoundError();

    const sweepId = crypto.randomUUID();
    try {
      const created = await this.prisma.zbaSweep.create({
        data: {
          id: sweepId, tenantId: dto.tenantId, pairConfigId: dto.pairConfigId,
          sweepDate: new Date(dto.sweepDate), direction: dto.direction, amount: dto.amount as any,
          confirmationState: dto.confirmationState ?? 'MANUAL_RECORDED',
          status: 'RECORDED',
          idempotencyKey: dto.idempotencyKey, recordedBy: dto.actor,
        },
      });
      return { ...created, idempotent: false };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.zbaSweep.findUnique({
          where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
        });
        if (winner) return { ...winner, idempotent: true };
      }
      throw err;
    }
  }

  async getById(tenantId: string, sweepId: string) {
    const sweep = await this.prisma.zbaSweep.findFirst({ where: { id: sweepId, tenantId } });
    if (!sweep) throw new SweepNotFoundError();
    return sweep;
  }

  async search(tenantId: string, filters: { status?: string; pairConfigId?: string; limit?: number; offset?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const where: any = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.pairConfigId) where.pairConfigId = filters.pairConfigId;
    const [items, total] = await Promise.all([
      this.prisma.zbaSweep.findMany({ where, orderBy: { recordedAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.zbaSweep.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  /**
   * BR: idempotent. Emits `cash.sweep.posted` as a single matrix-row
   * envelope carrying both legs (source account CR / destination account DR,
   * both ACCOUNT_MAPPING_VALUES_PENDING — resolved by the posting engine),
   * so the AC "sweep pair nets exactly zero" holds by construction: one
   * amount, one event, two legs of equal magnitude and opposite sign.
   */
  async postSweep(tenantId: string, sweepId: string, actor: string) {
    const sweep = await this.getById(tenantId, sweepId);
    if (sweep.status === 'POSTED') return { ...sweep, idempotent: true };
    if (!canPostSweep(sweep.status as any)) throw new SweepNotPostableError();

    const pairConfig = await this.prisma.sweepAccountPairConfig.findFirst({ where: { id: sweep.pairConfigId, tenantId } });
    if (!pairConfig) throw new SweepConfigNotFoundError();

    const [fromAccount, toAccount] = sweep.direction === 'STORE_TO_OPERATING'
      ? [pairConfig.storeAccountCode, pairConfig.operatingAccountCode]
      : [pairConfig.operatingAccountCode, pairConfig.storeAccountCode];

    const eventId = crypto.randomUUID();
    const updated = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.zbaSweep.update({
        where: { id: sweepId },
        data: { status: 'POSTED', postedAt: new Date(), version: { increment: 1 } },
      });

      const envelope = buildMatrixRowEnvelope({
        eventId, tenantId, legalEntityId: pairConfig.entityId,
        eventType: 'cash.sweep.posted',
        sourceEntityType: 'ZBA_SWEEP', sourceEntityId: sweepId,
        businessDate: sweep.sweepDate.toISOString().slice(0, 10),
        correlationId: sweepId,
        idempotencyIdentity: `cash.sweep.posted:${tenantId}:${sweepId}`,
        accountingAmounts: [{ amount: sweep.amount.toString(), currency: 'USD', kind: 'GROSS' }],
        accountingReferences: [{ referenceNumber: sweepId }],
        metadata: { fromAccount, toAccount, direction: sweep.direction, confirmationState: sweep.confirmationState },
      });

      await tx.cashOutboxEvent.create({
        data: { id: eventId, tenantId, eventType: 'cash.sweep.posted', aggregateId: sweepId, payload: envelope as any },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId, docType: 'ZBA_SWEEP', docId: sweepId,
          action: 'ZBA_SWEEP_POSTED', before: { status: 'RECORDED' } as any,
          after: { status: 'POSTED', amount: sweep.amount } as any, actor,
        },
      });
      return tx.zbaSweep.findUniqueOrThrow({ where: { id: sweepId } });
    });

    try {
      await this.events.publish({ type: 'cash.sweep.posted', tenantId, payload: { sweepId }, occurredAt: new Date().toISOString(), correlationId: sweepId } as any);
    } catch {
      /* outbox row already durable */
    }

    return { ...updated, idempotent: false };
  }

  async voidSweep(tenantId: string, sweepId: string, reason: string, actor: string) {
    const sweep = await this.getById(tenantId, sweepId);
    if (sweep.status === 'VOID') return { ...sweep, idempotent: true };
    if (!canVoidSweep(sweep.status as any)) throw new SweepNotVoidableError();

    const updated = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.zbaSweep.update({ where: { id: sweepId }, data: { status: 'VOID', version: { increment: 1 } } });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId, docType: 'ZBA_SWEEP', docId: sweepId,
          action: 'ZBA_SWEEP_VOIDED', before: { status: 'RECORDED' } as any, after: { status: 'VOID', reason } as any, actor,
        },
      });
      return tx.zbaSweep.findUniqueOrThrow({ where: { id: sweepId } });
    });
    return { ...updated, idempotent: false };
  }
}
