import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { PrismaClient } from '.prisma/parts-accounting-client';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { PartsAccountMappingService } from './account-mapping-service';
import { toCents, centsToDollars } from '../lib/money';
import { ValidationError, NotFoundError, ConflictError } from '../domain/errors';
import { EVENT_FAMILY, EVENT_FAMILY_ROLES } from '../domain/event-families';

export interface LoadTapeLineDTO { partNumber: string; oldValue: number; newValue: number; qtyOnHand: number; effectiveFrom: string; }

/**
 * S067 — OEM Price-Tape Revaluation. Preview-approve pattern: tape load
 * NEVER auto-posts. Only the explicit approval ceremony posts, and only
 * when approvedTotal === previewTotal exactly.
 */
@injectable()
export class PriceTapeService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject(PartsAccountMappingService) private readonly mappings: PartsAccountMappingService,
  ) {}

  async load(tenantId: string, legalEntityId: string, loadBatchId: string, lines: LoadTapeLineDTO[]) {
    const existing = await this.prisma.priceTapeLoad.findFirst({ where: { tenantId, legalEntityId, loadBatchId } });
    if (existing) return { load: existing, idempotent: true }; // reload of same batch is idempotent — no duplicate lines

    const load = await this.prisma.priceTapeLoad.create({
      data: {
        tenantId, legalEntityId, loadBatchId, status: 'LOADED',
        lines: {
          create: lines.map((l) => ({
            partNumber: l.partNumber, oldValue: l.oldValue, newValue: l.newValue, qtyOnHand: l.qtyOnHand,
            deltaValue: centsToDollars(Math.round((toCents(l.newValue) - toCents(l.oldValue)) * l.qtyOnHand)),
            effectiveFrom: new Date(l.effectiveFrom),
          })),
        },
      },
      include: { lines: true },
    });
    return { load, idempotent: false };
  }

  async preview(tenantId: string, legalEntityId: string, loadBatchId: string) {
    const load = await this.prisma.priceTapeLoad.findFirst({ where: { tenantId, legalEntityId, loadBatchId }, include: { lines: true } });
    if (!load) throw new NotFoundError(`Price tape load ${loadBatchId} not found.`);
    const previewTotalCents = load.lines.reduce((sum, l) => sum + toCents(l.deltaValue), 0);
    return this.prisma.priceTapeLoad.update({
      where: { id: load.id },
      data: { status: 'PREVIEWED', previewTotal: centsToDollars(previewTotalCents) },
      include: { lines: true },
    });
  }

  async approve(tenantId: string, legalEntityId: string, loadBatchId: string, approvedBy: string, correlationId: string, businessDate: string) {
    const load = await this.prisma.priceTapeLoad.findFirst({ where: { tenantId, legalEntityId, loadBatchId }, include: { lines: true } });
    if (!load) throw new NotFoundError(`Price tape load ${loadBatchId} not found.`);
    if (load.status === 'APPROVED') return { load, idempotent: true }; // idempotent re-approve — no second journal
    if (load.status !== 'PREVIEWED') throw new ConflictError(`Price tape ${loadBatchId} must be PREVIEWED before approval (current status: ${load.status}).`);

    const previewTotalCents = toCents(load.previewTotal);
    const linesTotalCents = load.lines.reduce((sum, l) => sum + toCents(l.deltaValue), 0);
    if (previewTotalCents !== linesTotalCents) {
      throw new ConflictError('Preview total no longer matches line totals — reload/re-preview required before approval (preview-equals-post AC).');
    }

    const roles = EVENT_FAMILY_ROLES[EVENT_FAMILY.PRICE_TAPE_REVALUATION];
    const accounts = await this.mappings.resolveAll(tenantId, legalEntityId, EVENT_FAMILY.PRICE_TAPE_REVALUATION, roles);

    // The posting-engine's baseAmountPath requires a strictly positive
    // resolved amount (NON_POSITIVE_AMOUNT guard) — a downward revaluation
    // (newValue < oldValue) yields a negative previewTotalCents, so the
    // envelope carries an always-positive absApprovedTotal plus an explicit
    // direction discriminator the rule pack's two conditional rules match
    // on (DR/CR flip between UP and DOWN), rather than a signed amount.
    const direction: 'UP' | 'DOWN' = previewTotalCents < 0 ? 'DOWN' : 'UP';
    const absApprovedTotal = centsToDollars(Math.abs(previewTotalCents));

    const eventId = crypto.randomUUID();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId, eventType: 'parts.pricetape.approved.v1', eventSchemaVersion: '1.0',
      occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
      sourceSystem: 'parts-accounting-service', sourceEntityType: 'PRICE_TAPE_LOAD', sourceEntityId: loadBatchId,
      correlationId, causationId: null, businessDate,
      payload: {
        loadBatchId, approvedTotal: centsToDollars(previewTotalCents), absApprovedTotal, direction,
        accounts, lineCount: load.lines.length,
      },
      metadata: null,
    };
    const result = await this.postingClient.submit(envelope);

    const updated = await this.prisma.priceTapeLoad.update({
      where: { id: load.id },
      data: {
        status: 'APPROVED', approvedTotal: centsToDollars(previewTotalCents), approvedBy, approvedAt: new Date(),
        sourceEventId: eventId, journalEntryId: result.journalEntryId ?? null,
      },
      include: { lines: true },
    });

    await this.prisma.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId, docType: 'PRICE_TAPE_LOAD', docId: load.id, action: 'APPROVED', before: { status: 'PREVIEWED' } as any, after: updated as any, actor: approvedBy, correlationId },
    });

    return { load: updated, idempotent: false, postingStatus: result.status };
  }

  async get(tenantId: string, legalEntityId: string, loadBatchId: string) {
    const load = await this.prisma.priceTapeLoad.findFirst({ where: { tenantId, legalEntityId, loadBatchId }, include: { lines: true } });
    if (!load) throw new NotFoundError(`Price tape load ${loadBatchId} not found.`);
    return load;
  }

  async list(tenantId: string, legalEntityId: string) {
    return this.prisma.priceTapeLoad.findMany({ where: { tenantId, legalEntityId }, orderBy: { createdAt: 'desc' }, include: { lines: false } });
  }
}
