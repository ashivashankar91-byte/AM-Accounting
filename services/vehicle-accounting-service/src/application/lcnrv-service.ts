// S076 — Used LCNRV Write-downs.
import { randomUUID } from 'crypto';
import { inject, injectable } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/vehicle-accounting-client';
import { buildEnvelope } from '../domain/event-envelope';
import { computeWriteDown, assertWithinThreshold, WriteDownThresholdExceededError, requirePositiveWriteDownCents } from '../domain/lcnrv';
import { toCents, centsToDollarString } from '../domain/money';
import { PostingOrchestrator } from './posting-orchestrator';
import { UnitNotFoundError, VehicleAccountingInputError, ConfigNotFoundError } from './errors';
import { auditOutboxEvent } from '../infrastructure/audit';
import { withP2002Retry } from '../infrastructure/db-retry';

export const EVENT_TYPES = { LCNRV_WRITEDOWN: 'vehicle.lcnrv-writedown.v1' } as const;

function nowIso() { return new Date().toISOString(); }
function today() { return new Date().toISOString().slice(0, 10); }

@injectable()
export class LcnrvService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject(PostingOrchestrator) private readonly posting: PostingOrchestrator,
  ) {}

  async addMarketEvidence(tenantId: string, actor: string, input: { stockNumber: string; marketValue: string; source: string; reference?: string; note?: string }) {
    const unit = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } } });
    if (!unit) throw new UnitNotFoundError(input.stockNumber);
    if (!input.source?.trim()) throw new VehicleAccountingInputError('source is required for entered market evidence.');
    const marketValueCents = requirePositiveWriteDownCents('marketValue', input.marketValue);

    return this.prisma.$transaction(async (tx) => {
      const evidence = await tx.lcnrvMarketEvidence.create({
        data: {
          id: randomUUID(), tenantId, unitId: unit.id,
          marketValue: new Prisma.Decimal(centsToDollarString(marketValueCents)),
          source: input.source, reference: input.reference ?? null, note: input.note ?? null, enteredBy: actor,
        },
      });
      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'VEHICLE_UNIT', docId: unit.id, actor,
        action: 'LCNRV_EVIDENCE_ENTERED', after: { evidenceId: evidence.id, marketValue: centsToDollarString(marketValueCents), source: input.source },
      });
      return evidence;
    });
  }

  /** Aging/valuation worklist: book value vs latest entered market evidence per unit (read-only; no invented figures). */
  async worklist(tenantId: string, filters: { entityId?: string; status?: string }) {
    const units = await this.prisma.vehicleUnit.findMany({
      where: { tenantId, ...(filters.entityId ? { entityId: filters.entityId } : {}), status: filters.status ?? 'USED' },
      include: { lcnrvEvidence: { orderBy: { enteredAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });
    return units.map((u) => {
      const evidence = u.lcnrvEvidence[0] ?? null;
      const bookValueCents = toCents(u.bookValue.toString());
      const marketValueCents = evidence ? toCents(evidence.marketValue.toString()) : null;
      return {
        unitId: u.id, stockNumber: u.stockNumber, vin: u.vin, status: u.status,
        bookValue: centsToDollarString(bookValueCents),
        latestEvidence: evidence,
        potentialWriteDown: marketValueCents !== null ? centsToDollarString(Math.max(0, bookValueCents - marketValueCents)) : null,
      };
    });
  }

  async writeDown(tenantId: string, actor: string, input: { stockNumber: string; evidenceId: string; reason: string; eventId: string; idempotencyKey?: string }) {
    const idempotencyKey = input.idempotencyKey ?? input.eventId;
    const existingByKey = await this.prisma.lcnrvWriteDown.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
    if (existingByKey) return { idempotent: true, writeDown: existingByKey };

    if (!input.reason?.trim()) throw new VehicleAccountingInputError('reason is required for a write-down ceremony.');
    const unit = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: input.stockNumber } } });
    if (!unit) throw new UnitNotFoundError(input.stockNumber);
    const evidence = await this.prisma.lcnrvMarketEvidence.findFirst({ where: { id: input.evidenceId, tenantId, unitId: unit.id } });
    if (!evidence) throw new VehicleAccountingInputError(`Market evidence "${input.evidenceId}" not found for unit ${input.stockNumber}.`);

    const bookValueCents = toCents(unit.bookValue.toString());
    const marketValueCents = toCents(evidence.marketValue.toString());
    const computation = computeWriteDown(bookValueCents, marketValueCents);

    if (computation.writeDownCents === 0) {
      return { idempotent: false, status: 'NOT_NEEDED' as const, message: 'Entered market value is at or above book value — no write-down is needed.' };
    }

    const config = await this.prisma.lcnrvThresholdConfig.findUnique({ where: { tenantId_entityId: { tenantId, entityId: unit.entityId } } });
    if (!config) throw new ConfigNotFoundError(`No LCNRV write-down threshold configured for entity ${unit.entityId}. An authorized user must configure LcnrvThresholdConfig before a write-down can be evaluated.`);

    try {
      assertWithinThreshold(computation.writeDownCents, toCents(config.maxWriteDownAmount.toString()));
    } catch (err) {
      if (err instanceof WriteDownThresholdExceededError) {
        const refused = await withP2002Retry(() => this.prisma.$transaction(async (tx) => {
          // upsert, not create+catch(P2002) — see vehicle-unit-service.ts's
          // stockIn() header comment (Prisma interactive transactions abort
          // entirely on any query error; verified against a live Postgres
          // instance).
          const writeDown = await tx.lcnrvWriteDown.upsert({
            where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
            create: {
              id: randomUUID(), tenantId, unitId: unit.id, evidenceId: evidence.id,
              bookValueBefore: new Prisma.Decimal(centsToDollarString(bookValueCents)),
              marketValue: new Prisma.Decimal(centsToDollarString(marketValueCents)),
              writeDownAmount: new Prisma.Decimal(centsToDollarString(computation.writeDownCents)),
              reason: input.reason, status: 'REFUSED', refusalReason: err.message,
              actor, idempotencyKey,
            },
            update: {},
          });
          await auditOutboxEvent(tx as any, {
            tenantId, docType: 'VEHICLE_UNIT', docId: unit.id, actor,
            action: 'LCNRV_WRITE_DOWN_REFUSED',
            after: { writeDownAmount: centsToDollarString(computation.writeDownCents), threshold: config.maxWriteDownAmount.toString(), evidenceId: evidence.id },
          });
          return writeDown;
        }));
        return { idempotent: false, status: 'REFUSED' as const, writeDown: refused };
      }
      throw err;
    }

    const correlationId = input.idempotencyKey ?? input.eventId;
    const envelope = buildEnvelope({
      eventId: input.eventId,
      tenantId,
      legalEntityId: unit.entityId,
      eventType: EVENT_TYPES.LCNRV_WRITEDOWN,
      occurredAt: nowIso(),
      businessDate: today(),
      sourceEntityType: 'VEHICLE_UNIT',
      sourceEntityId: input.stockNumber,
      correlationId,
      payload: { stockNumber: input.stockNumber, writeDownAmount: centsToDollarString(computation.writeDownCents) },
    });

    const result = await this.posting.submitAndRecord(envelope, { legalEntityId: unit.entityId, storeId: unit.storeId, sourceTransactionId: input.stockNumber });
    const posted = result.status === 'POSTED';

    const created = await withP2002Retry(() => this.prisma.$transaction(async (tx) => {
      // Concurrency guard — see vehicle-unit-service.ts's addCostComponent()
      // for the full rationale: bookValue/cumulativeWriteDown changes are
      // additive and must apply AT MOST ONCE across every retry of a
      // racing duplicate ceremony submission (verified live).
      const alreadyApplied = await tx.lcnrvWriteDown.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
      if (alreadyApplied) return alreadyApplied;

      if (posted) {
        await tx.vehicleUnit.update({
          where: { id: unit.id },
          data: {
            bookValue: { decrement: new Prisma.Decimal(centsToDollarString(computation.writeDownCents)) },
            cumulativeWriteDown: { increment: new Prisma.Decimal(centsToDollarString(computation.writeDownCents)) },
          },
        });
      }
      const writeDown = await tx.lcnrvWriteDown.create({
        data: {
          id: randomUUID(), tenantId, unitId: unit.id, evidenceId: evidence.id,
          bookValueBefore: new Prisma.Decimal(centsToDollarString(bookValueCents)),
          marketValue: new Prisma.Decimal(centsToDollarString(marketValueCents)),
          writeDownAmount: new Prisma.Decimal(centsToDollarString(computation.writeDownCents)),
          reason: input.reason, status: posted ? 'POSTED' : 'REFUSED',
          refusalReason: posted ? null : (result.failureReason ?? 'Posting did not succeed'),
          eventId: input.eventId, postingExecutionId: result.executionId,
          journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          failureReason: result.failureReason ?? null, actor, idempotencyKey,
        },
      });
      await auditOutboxEvent(tx as any, {
        tenantId, docType: 'VEHICLE_UNIT', docId: unit.id, actor,
        action: posted ? 'LCNRV_WRITE_DOWN_POSTED' : 'LCNRV_WRITE_DOWN_POSTING_FAILED',
        after: { writeDownAmount: centsToDollarString(computation.writeDownCents), evidenceId: evidence.id, status: result.status },
      });
      return writeDown;
    }));

    return { idempotent: false, status: posted ? ('POSTED' as const) : ('POSTING_FAILED' as const), writeDown: created, postingResult: result };
  }

  async listWriteDowns(tenantId: string, filters: { stockNumber?: string }) {
    let unitId: string | undefined;
    if (filters.stockNumber) {
      const unit = await this.prisma.vehicleUnit.findUnique({ where: { tenantId_stockNumber: { tenantId, stockNumber: filters.stockNumber } } });
      unitId = unit?.id;
      if (!unitId) return [];
    }
    return this.prisma.lcnrvWriteDown.findMany({ where: { tenantId, ...(unitId ? { unitId } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
  }
}
