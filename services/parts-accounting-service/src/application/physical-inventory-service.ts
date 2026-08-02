import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { PrismaClient } from '.prisma/parts-accounting-client';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { PartsAccountMappingService } from './account-mapping-service';
import { withSerializableRetry } from '../lib/serializable-retry';
import { toCents, centsToDollars } from '../lib/money';
import { NotFoundError, ConflictError } from '../domain/errors';
import { EVENT_FAMILY, EVENT_FAMILY_ROLES } from '../domain/event-families';

/**
 * S069 — Parts Physical Inventory. Session immutable after freeze/approval.
 * Unapproved counts change nothing — no movement/journal exists until
 * approve(). Adjustment posts via the PHYSICAL_ADJUSTMENT family, one
 * journal per approved session, corrects the perpetual balance.
 */
@injectable()
export class PhysicalInventoryService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject(PartsAccountMappingService) private readonly mappings: PartsAccountMappingService,
  ) {}

  async openSession(input: { tenantId: string; legalEntityId: string; storeId: string; scopeDescription: string; blindCount: boolean; varianceThreshold?: number | null }) {
    return this.prisma.physicalInventorySession.create({
      data: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId,
        scopeDescription: input.scopeDescription, blindCount: input.blindCount,
        varianceThreshold: input.varianceThreshold ?? null, status: 'OPEN',
      },
    });
  }

  async freeze(tenantId: string, legalEntityId: string, sessionId: string, partNumbers: string[]) {
    const session = await this.prisma.physicalInventorySession.findFirst({ where: { tenantId, legalEntityId, id: sessionId } });
    if (!session) throw new NotFoundError(`Physical inventory session ${sessionId} not found.`);
    if (session.status !== 'OPEN') throw new ConflictError(`Session ${sessionId} must be OPEN to freeze (current: ${session.status}).`);

    const balances = await this.prisma.partsPerpetualBalance.findMany({
      where: { tenantId, legalEntityId: session.legalEntityId, storeId: session.storeId, partNumber: { in: partNumbers } },
    });
    const byPart = new Map(balances.map((b) => [b.partNumber, b]));

    await this.prisma.physicalInventoryCountLine.createMany({
      data: partNumbers.map((p) => {
        const b = byPart.get(p);
        return { sessionId, partNumber: p, perpetualQtySnapshot: b ? b.onHandQty : 0, perpetualValueSnapshot: b ? b.onHandValue : 0 };
      }),
    });
    return this.prisma.physicalInventorySession.update({ where: { id: sessionId }, data: { status: 'FROZEN', frozenAt: new Date() }, include: { lines: true } });
  }

  /** blindCount sessions never return perpetualQtySnapshot to the counter — enforced by the caller (HTTP layer) stripping it, not here. */
  async enterCounts(tenantId: string, legalEntityId: string, sessionId: string, counts: Array<{ partNumber: string; countedQty: number }>) {
    const session = await this.prisma.physicalInventorySession.findFirst({ where: { tenantId, legalEntityId, id: sessionId } });
    if (!session) throw new NotFoundError(`Session ${sessionId} not found.`);
    if (session.status !== 'FROZEN') throw new ConflictError(`Session ${sessionId} must be FROZEN before counts can be entered (current: ${session.status}).`);

    for (const c of counts) {
      const line = await this.prisma.physicalInventoryCountLine.findFirst({ where: { sessionId, partNumber: c.partNumber } });
      if (!line) continue;
      const varianceQty = c.countedQty - Number(line.perpetualQtySnapshot);
      const unitValue = Number(line.perpetualQtySnapshot) !== 0 ? Number(line.perpetualValueSnapshot) / Number(line.perpetualQtySnapshot) : 0;
      await this.prisma.physicalInventoryCountLine.update({
        where: { id: line.id },
        data: { countedQty: c.countedQty, varianceQty, varianceValue: centsToDollars(Math.round(toCents(unitValue) * varianceQty)) },
      });
    }
    return this.prisma.physicalInventorySession.update({ where: { id: sessionId }, data: { status: 'COUNTED', countedAt: new Date() }, include: { lines: true } });
  }

  async varianceReport(tenantId: string, legalEntityId: string, sessionId: string) {
    const session = await this.prisma.physicalInventorySession.findFirst({ where: { tenantId, legalEntityId, id: sessionId }, include: { lines: true } });
    if (!session) throw new NotFoundError(`Session ${sessionId} not found.`);
    if (session.status !== 'COUNTED') throw new ConflictError(`Session ${sessionId} must be COUNTED before a variance report (current: ${session.status}).`);
    const totalVarianceCents = session.lines.reduce((sum, l) => sum + toCents(l.varianceValue ?? 0), 0);
    const exceedsThreshold = session.varianceThreshold != null && Math.abs(totalVarianceCents) > toCents(session.varianceThreshold);
    await this.prisma.physicalInventorySession.update({ where: { id: sessionId }, data: { status: 'VARIANCE_REVIEW' } });
    return { session, totalVariance: centsToDollars(totalVarianceCents), exceedsThreshold, requiresElevatedApproval: exceedsThreshold };
  }

  async approve(input: { tenantId: string; legalEntityId: string; sessionId: string; approvedBy: string; correlationId: string; businessDate: string }) {
    const session = await this.prisma.physicalInventorySession.findFirst({ where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, id: input.sessionId }, include: { lines: true } });
    if (!session) throw new NotFoundError(`Session ${input.sessionId} not found.`);
    if (session.status === 'POSTED') return { session, idempotent: true };
    if (session.status !== 'VARIANCE_REVIEW') throw new ConflictError(`Session ${input.sessionId} must be in VARIANCE_REVIEW before approval (current: ${session.status}).`);

    const varianceLines = session.lines.filter((l) => l.varianceQty != null && Number(l.varianceQty) !== 0);
    const totalVarianceCents = varianceLines.reduce((sum, l) => sum + toCents(l.varianceValue ?? 0), 0);

    const roles = EVENT_FAMILY_ROLES[EVENT_FAMILY.PHYSICAL_ADJUSTMENT];
    const accounts = await this.mappings.resolveAll(input.tenantId, session.legalEntityId, EVENT_FAMILY.PHYSICAL_ADJUSTMENT, roles);

    const eventId = crypto.randomUUID();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, eventType: 'parts.physical.adjustment-approved.v1', eventSchemaVersion: '1.0',
      occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
      sourceSystem: 'parts-accounting-service', sourceEntityType: 'PHYSICAL_INVENTORY_SESSION', sourceEntityId: input.sessionId,
      correlationId: input.correlationId, causationId: null, businessDate: input.businessDate,
      payload: { sessionId: input.sessionId, totalVariance: centsToDollars(totalVarianceCents), lines: varianceLines.map((l) => ({ partNumber: l.partNumber, varianceQty: l.varianceQty, varianceValue: l.varianceValue })), accounts },
      metadata: null,
    };
    const result = await this.postingClient.submit(envelope);

    return withSerializableRetry(this.prisma, async (tx) => {
      for (const l of varianceLines) {
        await tx.partsPerpetualBalance.upsert({
          where: { tenantId_legalEntityId_storeId_partNumber: { tenantId: input.tenantId, legalEntityId: session.legalEntityId, storeId: session.storeId, partNumber: l.partNumber } },
          create: { tenantId: input.tenantId, legalEntityId: session.legalEntityId, storeId: session.storeId, partNumber: l.partNumber, onHandQty: l.varianceQty ?? 0, onHandValue: l.varianceValue ?? 0 },
          update: { onHandQty: { increment: l.varianceQty ?? 0 }, onHandValue: { increment: l.varianceValue ?? 0 } },
        });
        await tx.partsMovement.create({
          data: {
            tenantId: input.tenantId, legalEntityId: session.legalEntityId, storeId: session.storeId, partNumber: l.partNumber,
            movementFamily: 'ADJUSTMENT', movementId: `physical-${input.sessionId}-${l.partNumber}`,
            quantity: l.varianceQty ?? 0, unitValue: 0, totalValue: l.varianceValue ?? 0,
            sourceDocType: 'PHYSICAL_INVENTORY_SESSION', sourceDocId: input.sessionId, sourceEventId: eventId, correlationId: input.correlationId,
            businessDate: new Date(input.businessDate), status: result.status === 'POSTED' ? 'POSTED' : 'EXCEPTION',
            journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          },
        });
      }
      const updated = await tx.physicalInventorySession.update({
        where: { id: session.id },
        data: { status: 'POSTED', approvedBy: input.approvedBy, approvedAt: new Date(), sourceEventId: eventId, journalEntryId: result.journalEntryId ?? null },
        include: { lines: true },
      });
      await tx.auditOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'PHYSICAL_INVENTORY_SESSION', docId: session.id, action: 'APPROVED', before: { status: 'VARIANCE_REVIEW' } as any, after: updated as any, actor: input.approvedBy, correlationId: input.correlationId },
      });
      return { session: updated, idempotent: false, postingStatus: result.status };
    });
  }

  async get(tenantId: string, legalEntityId: string, sessionId: string) {
    const session = await this.prisma.physicalInventorySession.findFirst({ where: { tenantId, legalEntityId, id: sessionId }, include: { lines: true } });
    if (!session) throw new NotFoundError(`Session ${sessionId} not found.`);
    return session;
  }
  async list(tenantId: string, legalEntityId: string) {
    return this.prisma.physicalInventorySession.findMany({ where: { tenantId, legalEntityId }, orderBy: { createdAt: 'desc' } });
  }
}
