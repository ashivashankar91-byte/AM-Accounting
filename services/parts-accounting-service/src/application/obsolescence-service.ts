import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { PrismaClient } from '.prisma/parts-accounting-client';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { PartsAccountMappingService } from './account-mapping-service';
import { toCents, centsToDollars } from '../lib/money';
import { NotFoundError, ConflictError, RefusedError } from '../domain/errors';
import { EVENT_FAMILY, EVENT_FAMILY_ROLES } from '../domain/event-families';

export interface AgingLine { partNumber: string; ageBand: string; qty: number; baseValue: number; }

/**
 * S068 — Obsolescence Provision & Scrap. Aging-based provision preview
 * (band % is [SAFE_CONFIGURATION]) → explicit approval posts exactly the
 * preview. Scrap: distinct permission, threshold refusal, allowance never
 * goes net-debit.
 */
@injectable()
export class ObsolescenceService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject(PartsAccountMappingService) private readonly mappings: PartsAccountMappingService,
  ) {}

  /** Caller supplies each line's base inventory value so the % band applies to real dollars, never an invented default. */
  async preview(tenantId: string, legalEntityId: string, asOfDate: string, bandConfig: Record<string, number>, lines: AgingLine[]) {
    let totalCents = 0;
    const computed = lines.map((l) => {
      const pct = bandConfig[l.ageBand] ?? 0;
      const provisionCents = Math.round(toCents(l.baseValue) * (pct / 100));
      totalCents += provisionCents;
      return { partNumber: l.partNumber, ageBand: l.ageBand, qty: l.qty, provisionAmount: centsToDollars(provisionCents) };
    });
    return this.prisma.obsolescenceProvisionRun.create({
      data: {
        tenantId, legalEntityId, asOfDate: new Date(asOfDate), bandConfig: bandConfig as any,
        previewTotal: centsToDollars(totalCents), status: 'PREVIEWED',
        lines: { create: computed },
      },
      include: { lines: true },
    });
  }

  async approve(tenantId: string, legalEntityId: string, runId: string, approvedBy: string, correlationId: string, businessDate: string) {
    const run = await this.prisma.obsolescenceProvisionRun.findFirst({ where: { tenantId, legalEntityId, id: runId }, include: { lines: true } });
    if (!run) throw new NotFoundError(`Obsolescence provision run ${runId} not found.`);
    if (run.status === 'APPROVED') return { run, idempotent: true };
    if (run.status !== 'PREVIEWED') throw new ConflictError(`Run ${runId} must be PREVIEWED before approval.`);

    const roles = EVENT_FAMILY_ROLES[EVENT_FAMILY.OBSOLESCENCE_PROVISION];
    const accounts = await this.mappings.resolveAll(tenantId, legalEntityId, EVENT_FAMILY.OBSOLESCENCE_PROVISION, roles);

    const eventId = crypto.randomUUID();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId, eventType: 'parts.obsolescence.provision-approved.v1', eventSchemaVersion: '1.0',
      occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
      sourceSystem: 'parts-accounting-service', sourceEntityType: 'OBSOLESCENCE_PROVISION_RUN', sourceEntityId: runId,
      correlationId, causationId: null, businessDate,
      payload: { runId, provisionTotal: run.previewTotal, accounts, lineCount: run.lines.length },
      metadata: null,
    };
    const result = await this.postingClient.submit(envelope);

    const updated = await this.prisma.obsolescenceProvisionRun.update({
      where: { id: run.id },
      data: { status: 'APPROVED', approvedBy, approvedAt: new Date(), sourceEventId: eventId, journalEntryId: result.journalEntryId ?? null },
      include: { lines: true },
    });
    await this.prisma.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId, docType: 'OBSOLESCENCE_PROVISION_RUN', docId: run.id, action: 'APPROVED', before: { status: 'PREVIEWED' } as any, after: updated as any, actor: approvedBy, correlationId },
    });
    return { run: updated, idempotent: false, postingStatus: result.status };
  }

  async scrap(input: {
    tenantId: string; legalEntityId: string; storeId: string; partNumber: string; qty: number; value: number;
    reason: string; actor: string; hasScrapPermission: boolean; thresholdAmount: number; allowanceBalance: number;
    correlationId: string; businessDate: string;
  }) {
    if (!input.hasScrapPermission) {
      const refused = await this.prisma.scrapDisposal.create({
        data: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId, partNumber: input.partNumber,
          qty: input.qty, value: input.value, reason: input.reason, actor: input.actor,
          thresholdAmount: input.thresholdAmount, thresholdExceeded: input.value > input.thresholdAmount,
          status: 'REFUSED_PERMISSION',
        },
      });
      throw new RefusedError('REFUSED_PERMISSION', `Actor ${input.actor} lacks the distinct scrap-execution permission (parts.scrap.execute). Recorded as ${refused.id}.`);
    }
    if (input.value > input.thresholdAmount) {
      const refused = await this.prisma.scrapDisposal.create({
        data: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId, partNumber: input.partNumber,
          qty: input.qty, value: input.value, reason: input.reason, actor: input.actor,
          thresholdAmount: input.thresholdAmount, thresholdExceeded: true, status: 'REFUSED_THRESHOLD',
        },
      });
      throw new RefusedError('REFUSED_THRESHOLD', `Scrap value ${input.value} exceeds threshold ${input.thresholdAmount} — requires elevated approval path. Recorded as ${refused.id}.`);
    }
    // Guard: allowance account must never go net-debit.
    if (toCents(input.allowanceBalance) - toCents(input.value) < 0) {
      const refused = await this.prisma.scrapDisposal.create({
        data: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId, partNumber: input.partNumber,
          qty: input.qty, value: input.value, reason: input.reason, actor: input.actor,
          thresholdAmount: input.thresholdAmount, thresholdExceeded: false, status: 'REFUSED_THRESHOLD',
        },
      });
      throw new RefusedError('REFUSED_ALLOWANCE_GUARD', `Scrap of ${input.value} would drive the obsolescence allowance negative (balance ${input.allowanceBalance}). Recorded as ${refused.id}.`);
    }

    const roles = EVENT_FAMILY_ROLES[EVENT_FAMILY.SCRAP_DISPOSAL];
    const accounts = await this.mappings.resolveAll(input.tenantId, input.legalEntityId, EVENT_FAMILY.SCRAP_DISPOSAL, roles);

    const eventId = crypto.randomUUID();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, eventType: 'parts.scrap.disposed.v1', eventSchemaVersion: '1.0',
      occurredAt: new Date().toISOString(), publishedAt: new Date().toISOString(),
      sourceSystem: 'parts-accounting-service', sourceEntityType: 'SCRAP_DISPOSAL', sourceEntityId: `${input.partNumber}-${eventId}`,
      correlationId: input.correlationId, causationId: null, businessDate: input.businessDate,
      payload: { partNumber: input.partNumber, qty: input.qty, value: input.value, reason: input.reason, accounts },
      metadata: null,
    };
    const result = await this.postingClient.submit(envelope);

    const disposal = await this.prisma.scrapDisposal.create({
      data: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId, partNumber: input.partNumber,
        qty: input.qty, value: input.value, reason: input.reason, actor: input.actor,
        thresholdAmount: input.thresholdAmount, thresholdExceeded: false,
        status: result.status === 'POSTED' ? 'POSTED' : 'REFUSED_THRESHOLD',
        sourceEventId: eventId, journalEntryId: result.journalEntryId ?? null,
      },
    });
    await this.prisma.auditOutboxEvent.create({
      data: { id: crypto.randomUUID(), tenantId: input.tenantId, docType: 'SCRAP_DISPOSAL', docId: disposal.id, action: 'POSTED', before: null as any, after: disposal as any, actor: input.actor, correlationId: input.correlationId },
    });
    return { disposal, postingStatus: result.status };
  }

  async listRuns(tenantId: string, legalEntityId: string) {
    return this.prisma.obsolescenceProvisionRun.findMany({ where: { tenantId, legalEntityId }, orderBy: { createdAt: 'desc' }, include: { lines: true } });
  }
  async listScrap(tenantId: string, legalEntityId: string) {
    return this.prisma.scrapDisposal.findMany({ where: { tenantId, legalEntityId }, orderBy: { createdAt: 'desc' } });
  }
}
