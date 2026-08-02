import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { PrismaClient } from '.prisma/parts-accounting-client';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { PartsAccountMappingService } from './account-mapping-service';
import { withSerializableRetry } from '../lib/serializable-retry';
import { NotFoundError, ConflictError, RefusedError } from '../domain/errors';
import { EVENT_FAMILY, EVENT_FAMILY_ROLES } from '../domain/event-families';

/**
 * S070 — Special-Order Deposits & Escheat. Deposit at order → apply at
 * sale (race-safe, exactly-once) → refund (refused if already applied) →
 * abandoned aging queue → escheat (jurisdiction-config-driven only, never
 * invented).
 */
@injectable()
export class DepositService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject(PartsAccountMappingService) private readonly mappings: PartsAccountMappingService,
  ) {}

  async createDeposit(input: {
    tenantId: string; legalEntityId: string; storeId: string; orderNumber: string; customerRef: string;
    depositAmount: number; receiptId: string; correlationId: string; businessDate: string; actor: string;
  }) {
    const existing = await this.prisma.specialOrderDeposit.findFirst({ where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, orderNumber: input.orderNumber } });
    if (existing) return { deposit: existing, idempotent: true };

    const roles = EVENT_FAMILY_ROLES[EVENT_FAMILY.SPECIAL_ORDER_DEPOSIT];
    const accounts = await this.mappings.resolveAll(input.tenantId, input.legalEntityId, EVENT_FAMILY.SPECIAL_ORDER_DEPOSIT, roles);

    const eventId = crypto.randomUUID();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, eventType: 'parts.deposit.received.v1', eventSchemaVersion: '1.0',
      occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
      sourceSystem: 'parts-accounting-service', sourceEntityType: 'SPECIAL_ORDER_DEPOSIT', sourceEntityId: input.orderNumber,
      correlationId: input.correlationId, causationId: null, businessDate: input.businessDate,
      payload: { orderNumber: input.orderNumber, depositAmount: input.depositAmount, receiptId: input.receiptId, accounts },
      metadata: null,
    };
    const result = await this.postingClient.submit(envelope);

    // PENDING_CE07_TECHNICAL_RECONCILIATION — coa-service's outbox event does not yet
    // carry the JOURNAL_ENTRY_POSTED shape (applyNumber/scheduleNumber) schedule-service
    // consumes; this row is CE-11's own narrow schedule-effect projection until that lands.
    const deposit = await this.prisma.specialOrderDeposit.create({
      data: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId,
        orderNumber: input.orderNumber, customerRef: input.customerRef, depositAmount: input.depositAmount,
        status: 'OPEN', depositSourceEventId: eventId, depositJournalEntryId: result.journalEntryId ?? '',
        agingSinceDate: new Date(input.businessDate),
      },
    });
    await this.prisma.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'SPECIAL_ORDER_DEPOSIT', docId: deposit.id, action: 'CREATED', before: null as any, after: deposit as any, actor: input.actor, correlationId: input.correlationId },
    });
    return { deposit, idempotent: false, postingStatus: result.status };
  }

  async apply(input: { tenantId: string; legalEntityId: string; orderNumber: string; saleAmount: number; correlationId: string; businessDate: string; actor: string }) {
    return withSerializableRetry(this.prisma, async (tx) => {
      const deposit = await tx.specialOrderDeposit.findFirst({ where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, orderNumber: input.orderNumber } });
      if (!deposit) throw new NotFoundError(`Special-order deposit ${input.orderNumber} not found.`);
      if (deposit.status === 'APPLIED') return { deposit, idempotent: true }; // exactly-once relief — race loses to whichever tx commits first
      if (deposit.status !== 'OPEN') throw new ConflictError(`Deposit ${input.orderNumber} cannot be applied from status ${deposit.status}.`);

      const roles = EVENT_FAMILY_ROLES[EVENT_FAMILY.SPECIAL_ORDER_DEPOSIT_APPLY];
      const accounts = await this.mappings.resolveAll(input.tenantId, deposit.legalEntityId, EVENT_FAMILY.SPECIAL_ORDER_DEPOSIT_APPLY, roles);

      const eventId = crypto.randomUUID();
      const envelope: SourceEventEnvelope = {
        eventId, tenantId: input.tenantId, eventType: 'parts.deposit.applied.v1', eventSchemaVersion: '1.0',
        occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
        sourceSystem: 'parts-accounting-service', sourceEntityType: 'SPECIAL_ORDER_DEPOSIT', sourceEntityId: input.orderNumber,
        correlationId: input.correlationId, causationId: deposit.depositSourceEventId, businessDate: input.businessDate,
        payload: { orderNumber: input.orderNumber, appliedAmount: deposit.depositAmount, saleAmount: input.saleAmount, accounts },
        metadata: null,
      };
      const result = await this.postingClient.submit(envelope);

      const updated = await tx.specialOrderDeposit.update({
        where: { id: deposit.id },
        data: { status: 'APPLIED', appliedJournalEntryId: result.journalEntryId ?? null },
      });
      await tx.auditOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'SPECIAL_ORDER_DEPOSIT', docId: deposit.id, action: 'APPLIED', before: { status: 'OPEN' } as any, after: updated as any, actor: input.actor, correlationId: input.correlationId },
      });
      return { deposit: updated, idempotent: false, postingStatus: result.status };
    });
  }

  async refund(input: { tenantId: string; legalEntityId: string; orderNumber: string; correlationId: string; businessDate: string; actor: string; reason: string }) {
    return withSerializableRetry(this.prisma, async (tx) => {
      const deposit = await tx.specialOrderDeposit.findFirst({ where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, orderNumber: input.orderNumber } });
      if (!deposit) throw new NotFoundError(`Deposit ${input.orderNumber} not found.`);
      if (deposit.status === 'APPLIED') {
        throw new RefusedError('REFUND_REFUSED_ALREADY_APPLIED', `Deposit ${input.orderNumber} was already applied to a sale — cannot refund. Use the sale-side adjustment path instead.`);
      }
      if (deposit.status !== 'OPEN') throw new ConflictError(`Deposit ${input.orderNumber} cannot be refunded from status ${deposit.status}.`);

      const roles = EVENT_FAMILY_ROLES[EVENT_FAMILY.SPECIAL_ORDER_DEPOSIT_REFUND];
      const accounts = await this.mappings.resolveAll(input.tenantId, deposit.legalEntityId, EVENT_FAMILY.SPECIAL_ORDER_DEPOSIT_REFUND, roles);

      const eventId = crypto.randomUUID();
      const envelope: SourceEventEnvelope = {
        eventId, tenantId: input.tenantId, eventType: 'parts.deposit.refunded.v1', eventSchemaVersion: '1.0',
        occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
        sourceSystem: 'parts-accounting-service', sourceEntityType: 'SPECIAL_ORDER_DEPOSIT', sourceEntityId: input.orderNumber,
        correlationId: input.correlationId, causationId: deposit.depositSourceEventId, businessDate: input.businessDate,
        payload: { orderNumber: input.orderNumber, refundAmount: deposit.depositAmount, reason: input.reason, accounts },
        metadata: null,
      };
      const result = await this.postingClient.submit(envelope);
      const updated = await tx.specialOrderDeposit.update({ where: { id: deposit.id }, data: { status: 'REFUNDED', refundJournalEntryId: result.journalEntryId ?? null } });
      await tx.auditOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'SPECIAL_ORDER_DEPOSIT', docId: deposit.id, action: 'REFUNDED', before: { status: 'OPEN' } as any, after: updated as any, actor: input.actor, reason: input.reason, correlationId: input.correlationId },
      });
      return { deposit: updated, idempotent: false, postingStatus: result.status };
    });
  }

  async abandonedQueue(tenantId: string, legalEntityId: string, asOfDate: string) {
    const configs = await this.prisma.escheatJurisdictionConfig.findMany({ where: { tenantId, legalEntityId } });
    if (configs.length === 0) {
      return { items: [], note: 'No EscheatJurisdictionConfig configured for this legal entity — queue is truthfully empty, not estimated.' };
    }
    const shortestDormancy = Math.min(...configs.map((c) => c.dormancyPeriodDays));
    const cutoff = new Date(asOfDate);
    cutoff.setDate(cutoff.getDate() - shortestDormancy);
    const items = await this.prisma.specialOrderDeposit.findMany({
      where: { tenantId, legalEntityId, status: 'OPEN', agingSinceDate: { lte: cutoff } },
      orderBy: { agingSinceDate: 'asc' },
    });
    return { items, note: null };
  }

  async escheat(input: { tenantId: string; legalEntityId: string; orderNumber: string; jurisdiction: string; correlationId: string; businessDate: string; actor: string }) {
    const deposit = await this.prisma.specialOrderDeposit.findFirst({ where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, orderNumber: input.orderNumber } });
    if (!deposit) throw new NotFoundError(`Deposit ${input.orderNumber} not found.`);
    if (deposit.status !== 'OPEN') throw new ConflictError(`Deposit ${input.orderNumber} cannot be escheated from status ${deposit.status}.`);

    const config = await this.prisma.escheatJurisdictionConfig.findFirst({
      where: { tenantId: input.tenantId, legalEntityId: deposit.legalEntityId, jurisdiction: input.jurisdiction },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!config) {
      throw new RefusedError('ESCHEAT_JURISDICTION_CONFIG_MISSING', `No EscheatJurisdictionConfig exists for jurisdiction "${input.jurisdiction}" — escheat action refused rather than inventing a dormancy rule.`);
    }
    const daysSinceAging = Math.floor((new Date(input.businessDate).getTime() - deposit.agingSinceDate.getTime()) / 86400000);
    if (daysSinceAging < config.dormancyPeriodDays) {
      throw new RefusedError('ESCHEAT_NOT_YET_DORMANT', `Deposit ${input.orderNumber} has only aged ${daysSinceAging} days; jurisdiction ${input.jurisdiction} requires ${config.dormancyPeriodDays}.`);
    }
    const updated = await this.prisma.specialOrderDeposit.update({ where: { id: deposit.id }, data: { status: 'ESCHEATED', jurisdiction: input.jurisdiction } });
    await this.prisma.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'SPECIAL_ORDER_DEPOSIT', docId: deposit.id, action: 'ESCHEATED', before: { status: 'OPEN' } as any, after: updated as any, actor: input.actor, correlationId: input.correlationId },
    });
    return updated;
  }

  async get(tenantId: string, legalEntityId: string, orderNumber: string) {
    const deposit = await this.prisma.specialOrderDeposit.findFirst({ where: { tenantId, legalEntityId, orderNumber } });
    if (!deposit) throw new NotFoundError(`Deposit ${orderNumber} not found.`);
    return deposit;
  }
  async list(tenantId: string, legalEntityId: string, status?: string) {
    return this.prisma.specialOrderDeposit.findMany({ where: { tenantId, legalEntityId, ...(status ? { status } : {}) }, orderBy: { createdAt: 'desc' } });
  }
}
