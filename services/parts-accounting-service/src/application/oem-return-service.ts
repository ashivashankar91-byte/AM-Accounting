import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { PrismaClient } from '.prisma/parts-accounting-client';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { PartsAccountMappingService } from './account-mapping-service';
import { toCents, centsToDollars } from '../lib/money';
import { NotFoundError, ConflictError, RefusedError } from '../domain/errors';
import { EVENT_FAMILY, EVENT_FAMILY_ROLES } from '../domain/event-families';

export interface ReturnLine { partNumber: string; qty: number; value: number; }

/**
 * S071 (R5) — OEM Parts-Return Pipeline. Authorization → shipment → factory
 * credit → discrepancy disposition (mirrors S065's short-pay pattern:
 * explicit, audited, never silent). Program terms are configuration only —
 * never invented.
 */
@injectable()
export class OemReturnService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject(PartsAccountMappingService) private readonly mappings: PartsAccountMappingService,
  ) {}

  /** Governed OEM return-program terms — allowance/restocking-fee rates are
   * config, never invented at authorization time (mirrors S071's own
   * "config only" rule for authorize()/applyCredit()). */
  async setProgramConfig(input: { tenantId: string; legalEntityId: string; oemCode: string; allowancePct: number; restockingFeePct: number; effectiveFrom: string; actor: string }) {
    const config = await this.prisma.oemReturnProgramConfig.upsert({
      where: { tenantId_legalEntityId_oemCode_effectiveFrom: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, oemCode: input.oemCode, effectiveFrom: new Date(input.effectiveFrom) } },
      create: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, oemCode: input.oemCode, allowancePct: input.allowancePct, restockingFeePct: input.restockingFeePct, effectiveFrom: new Date(input.effectiveFrom) },
      update: { allowancePct: input.allowancePct, restockingFeePct: input.restockingFeePct },
    });
    await this.prisma.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'OEM_RETURN_PROGRAM_CONFIG', docId: config.id, action: 'SET', before: null as any, after: config as any, actor: input.actor },
    });
    return config;
  }

  async authorize(input: { tenantId: string; legalEntityId: string; storeId: string; oemCode: string; returnAuthNumber: string; lines: ReturnLine[]; actor: string }) {
    const existing = await this.prisma.oemReturnAuthorization.findFirst({ where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, returnAuthNumber: input.returnAuthNumber } });
    if (existing) return { authorization: existing, idempotent: true };

    const program = await this.prisma.oemReturnProgramConfig.findFirst({
      where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, oemCode: input.oemCode },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!program) {
      throw new RefusedError('OEM_RETURN_PROGRAM_CONFIG_MISSING', `No OemReturnProgramConfig exists for OEM "${input.oemCode}" — authorization refused rather than inventing allowance terms.`);
    }

    const authorization = await this.prisma.oemReturnAuthorization.create({
      data: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId, oemCode: input.oemCode,
        returnAuthNumber: input.returnAuthNumber, status: 'AUTHORIZED',
        lines: { create: input.lines.map((l) => ({ partNumber: l.partNumber, qty: l.qty, value: l.value })) },
      },
      include: { lines: true },
    });
    await this.prisma.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'OEM_RETURN_AUTHORIZATION', docId: authorization.id, action: 'AUTHORIZED', before: null as any, after: authorization as any, actor: input.actor },
    });
    return { authorization, idempotent: false };
  }

  async ship(input: { tenantId: string; legalEntityId: string; returnAuthNumber: string; correlationId: string; businessDate: string; actor: string }) {
    const auth = await this.prisma.oemReturnAuthorization.findFirst({ where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, returnAuthNumber: input.returnAuthNumber }, include: { lines: true } });
    if (!auth) throw new NotFoundError(`OEM return ${input.returnAuthNumber} not found.`);
    if (auth.status === 'SHIPPED') return { authorization: auth, idempotent: true };
    if (auth.status !== 'AUTHORIZED') throw new ConflictError(`Return ${input.returnAuthNumber} must be AUTHORIZED before shipment (current: ${auth.status}).`);

    const totalValueCents = auth.lines.reduce((sum, l) => sum + toCents(l.value), 0);
    const roles = EVENT_FAMILY_ROLES[EVENT_FAMILY.OEM_RETURN_SHIP];
    const accounts = await this.mappings.resolveAll(input.tenantId, auth.legalEntityId, EVENT_FAMILY.OEM_RETURN_SHIP, roles);

    const eventId = crypto.randomUUID();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, eventType: 'parts.oemreturn.shipped.v1', eventSchemaVersion: '1.0',
      occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
      sourceSystem: 'parts-accounting-service', sourceEntityType: 'OEM_RETURN_AUTHORIZATION', sourceEntityId: input.returnAuthNumber,
      correlationId: input.correlationId, causationId: null, businessDate: input.businessDate,
      payload: { returnAuthNumber: input.returnAuthNumber, totalValue: centsToDollars(totalValueCents), accounts },
      metadata: null,
    };
    const result = await this.postingClient.submit(envelope);
    const updated = await this.prisma.oemReturnAuthorization.update({
      where: { id: auth.id }, data: { status: 'SHIPPED', shipSourceEventId: eventId, shipJournalEntryId: result.journalEntryId ?? null }, include: { lines: true },
    });
    await this.prisma.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'OEM_RETURN_AUTHORIZATION', docId: auth.id, action: 'SHIPPED', before: { status: 'AUTHORIZED' } as any, after: updated as any, actor: input.actor, correlationId: input.correlationId },
    });
    return { authorization: updated, idempotent: false, postingStatus: result.status };
  }

  async applyCredit(input: { tenantId: string; legalEntityId: string; returnAuthNumber: string; creditAmount: number; correlationId: string; businessDate: string; actor: string }) {
    const auth = await this.prisma.oemReturnAuthorization.findFirst({ where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, returnAuthNumber: input.returnAuthNumber }, include: { lines: true } });
    if (!auth) throw new NotFoundError(`OEM return ${input.returnAuthNumber} not found.`);
    if (auth.status === 'CREDIT_APPLIED') return { authorization: auth, idempotent: true };
    if (auth.status !== 'SHIPPED') throw new ConflictError(`Return ${input.returnAuthNumber} must be SHIPPED before credit can apply (current: ${auth.status}).`);

    const program = await this.prisma.oemReturnProgramConfig.findFirst({ where: { tenantId: input.tenantId, legalEntityId: auth.legalEntityId, oemCode: auth.oemCode }, orderBy: { effectiveFrom: 'desc' } });
    const shippedValueCents = auth.lines.reduce((sum, l) => sum + toCents(l.value), 0);
    const restockingFeeCents = program ? Math.round(shippedValueCents * (Number(program.restockingFeePct) / 100)) : 0;
    const varianceCents = shippedValueCents - toCents(input.creditAmount) - restockingFeeCents;

    const roles = EVENT_FAMILY_ROLES[EVENT_FAMILY.OEM_RETURN_CREDIT];
    const accounts = await this.mappings.resolveAll(input.tenantId, auth.legalEntityId, EVENT_FAMILY.OEM_RETURN_CREDIT, roles);

    const eventId = crypto.randomUUID();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, eventType: 'parts.oemreturn.credit-applied.v1', eventSchemaVersion: '1.0',
      occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
      sourceSystem: 'parts-accounting-service', sourceEntityType: 'OEM_RETURN_AUTHORIZATION', sourceEntityId: input.returnAuthNumber,
      correlationId: input.correlationId, causationId: auth.shipSourceEventId, businessDate: input.businessDate,
      payload: { returnAuthNumber: input.returnAuthNumber, creditAmount: input.creditAmount, restockingFee: centsToDollars(restockingFeeCents), variance: centsToDollars(varianceCents), accounts },
      metadata: null,
    };
    const result = await this.postingClient.submit(envelope);
    const updated = await this.prisma.oemReturnAuthorization.update({
      where: { id: auth.id },
      data: {
        // Variance (if any) is captured in restockingFeeVariance and handled
        // via the explicit disposition() step below — it never silently
        // changes the lifecycle status on its own.
        status: 'CREDIT_APPLIED',
        creditSourceEventId: eventId, creditJournalEntryId: result.journalEntryId ?? null, restockingFeeVariance: centsToDollars(varianceCents),
      },
      include: { lines: true },
    });
    await this.prisma.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'OEM_RETURN_AUTHORIZATION', docId: auth.id, action: 'CREDIT_APPLIED', before: { status: 'SHIPPED' } as any, after: updated as any, actor: input.actor, correlationId: input.correlationId },
    });
    return { authorization: updated, idempotent: false, postingStatus: result.status, variance: centsToDollars(varianceCents) };
  }

  /** Discrepancy disposition — explicit, audited clerk action, mirrors S065's short-pay pattern. Never silent. */
  async disposition(input: { tenantId: string; legalEntityId: string; returnAuthNumber: string; reason: string; actor: string; correlationId: string }) {
    const auth = await this.prisma.oemReturnAuthorization.findFirst({ where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, returnAuthNumber: input.returnAuthNumber } });
    if (!auth) throw new NotFoundError(`OEM return ${input.returnAuthNumber} not found.`);
    if (auth.status !== 'CREDIT_APPLIED') throw new ConflictError(`Return ${input.returnAuthNumber} must have CREDIT_APPLIED before discrepancy disposition (current: ${auth.status}).`);

    const updated = await this.prisma.oemReturnAuthorization.update({ where: { id: auth.id }, data: { status: 'DISPOSITIONED' } });
    await this.prisma.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'OEM_RETURN_AUTHORIZATION', docId: auth.id, action: 'DISPOSITIONED', before: { status: 'CREDIT_APPLIED' } as any, after: updated as any, actor: input.actor, reason: input.reason, correlationId: input.correlationId },
    });
    return updated;
  }

  async get(tenantId: string, legalEntityId: string, returnAuthNumber: string) {
    const auth = await this.prisma.oemReturnAuthorization.findFirst({ where: { tenantId, legalEntityId, returnAuthNumber }, include: { lines: true } });
    if (!auth) throw new NotFoundError(`OEM return ${returnAuthNumber} not found.`);
    return auth;
  }
  async list(tenantId: string, legalEntityId: string) {
    return this.prisma.oemReturnAuthorization.findMany({ where: { tenantId, legalEntityId }, orderBy: { createdAt: 'desc' }, include: { lines: true } });
  }
}
