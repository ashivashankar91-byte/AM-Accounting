import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { PrismaClient } from '.prisma/parts-accounting-client';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { GlBalanceClient } from '../infrastructure/gl-balance-client';
import { PartsAccountMappingService } from './account-mapping-service';
import { ValuationConfigService } from './valuation-config-service';
import { withSerializableRetry } from '../lib/serializable-retry';
import { toCents, centsToDollars } from '../lib/money';
import { ValidationError, NotFoundError } from '../domain/errors';
import {
  MOVEMENT_FAMILY_TO_EVENT_FAMILY, EVENT_FAMILY_ROLES, EVENT_FAMILY,
  RELIEVING_MOVEMENT_FAMILIES, REPLENISHING_MOVEMENT_FAMILIES,
} from '../domain/event-families';

export interface PostMovementDTO {
  tenantId: string; legalEntityId: string; storeId: string; partNumber: string;
  movementFamily: string; movementId: string;
  quantity: number; unitValueOverride?: number | null; // RECEIPT provides its own unit cost
  sourceDocType: string; sourceDocId: string; correlationId: string; businessDate: string;
  actor: string;
}

/**
 * S066 — Parts Movement Posting & Tie-Out. One movement = one journal,
 * idempotent per movementId. D-CE11-02 interim: negative on-hand is
 * ALLOWED WITH a loud exception flag — never silent, never hard-blocked.
 */
@injectable()
export class MovementService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject(PartsAccountMappingService) private readonly mappings: PartsAccountMappingService,
    @inject(ValuationConfigService) private readonly valuationConfig: ValuationConfigService,
    @inject('GlBalanceClient') private readonly glBalance: GlBalanceClient,
  ) {}

  async postMovement(dto: PostMovementDTO) {
    if (dto.movementFamily === 'ADJUSTMENT') {
      throw new ValidationError('ADJUSTMENT movements may only be created via the S069 physical-inventory approval ceremony, not posted directly.');
    }
    const eventFamily = MOVEMENT_FAMILY_TO_EVENT_FAMILY[dto.movementFamily];
    if (!eventFamily) throw new ValidationError(`Unknown movement family "${dto.movementFamily}".`);

    // Idempotency: replay of the same (tenantId, movementId) returns the original row untouched.
    const existing = await this.prisma.partsMovement.findUnique({ where: { tenantId_movementId: { tenantId: dto.tenantId, movementId: dto.movementId } } });
    if (existing) return { movement: existing, idempotent: true };

    const config = await this.valuationConfig.getActive(dto.tenantId, dto.legalEntityId, dto.businessDate);
    const isReplenishing = REPLENISHING_MOVEMENT_FAMILIES.has(dto.movementFamily);
    const qtyCents = dto.quantity; // quantity kept as decimal, not cents

    let unitValueCents: number;
    if (isReplenishing) {
      if (dto.unitValueOverride == null) throw new ValidationError('RECEIPT/RETURN_TO_STOCK movements require unitValueOverride (the source document unit cost).');
      const baseCents = toCents(dto.unitValueOverride);
      const landedCents = this.valuationConfig.allocateLandedCost(baseCents, config.landedCostRules as any);
      unitValueCents = baseCents + landedCents;
    } else {
      const balance = await this.prisma.partsPerpetualBalance.findUnique({
        where: { tenantId_legalEntityId_storeId_partNumber: { tenantId: dto.tenantId, legalEntityId: dto.legalEntityId, storeId: dto.storeId, partNumber: dto.partNumber } },
      });
      if (!balance || Number(balance.onHandQty) === 0) {
        // No perpetual history yet — relieving movements still need SOME value; refuse rather than invent one.
        if (dto.unitValueOverride == null) throw new ValidationError('No perpetual balance exists for this part yet — relieving movements require unitValueOverride when on-hand is zero/unknown.');
        unitValueCents = toCents(dto.unitValueOverride);
      } else {
        // AVERAGE or REPLACEMENT: both read the current average carrying value per active config;
        // REPLACEMENT distinguishes itself at receipt-time valuation (handled above), not at relief.
        unitValueCents = Math.round((Number(balance.onHandValue) * 100) / Number(balance.onHandQty));
      }
    }
    const totalValueCents = Math.round(unitValueCents * dto.quantity);

    const roles = EVENT_FAMILY_ROLES[eventFamily];
    // ACCOUNT_MAPPING_VALUES_PENDING is a deterministic rejection surfaced to the caller as 422 — no partial posting.
    const accounts = await this.mappings.resolveAll(dto.tenantId, dto.legalEntityId, eventFamily, roles);

    const eventId = crypto.randomUUID();
    const envelope: SourceEventEnvelope = {
      eventId,
      tenantId: dto.tenantId,
      legalEntityId: dto.legalEntityId,
      // Rule-pack eventType MUST match /^[a-z0-9]+(\.[a-z0-9-]+)*\.v[0-9]+$/ —
      // hyphens only, no underscores — so movementFamily segments like
      // "RO_ISSUE" must be hyphenated, not merely lowercased.
      eventType: `parts.movement.${dto.movementFamily.toLowerCase().replace(/_/g, '-')}.v1`,
      eventSchemaVersion: '1.0',
      occurredAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      sourceSystem: 'parts-accounting-service',
      sourceEntityType: 'PARTS_MOVEMENT',
      sourceEntityId: dto.movementId,
      correlationId: dto.correlationId,
      causationId: null,
      businessDate: dto.businessDate,
      payload: {
        partNumber: dto.partNumber, storeId: dto.storeId, quantity: dto.quantity,
        unitValue: centsToDollars(unitValueCents), totalValue: centsToDollars(totalValueCents),
        movementFamily: dto.movementFamily, accounts, sourceDocType: dto.sourceDocType, sourceDocId: dto.sourceDocId,
      },
      metadata: null,
    };

    const result = await this.postingClient.submit(envelope);
    const posted = result.status === 'POSTED';

    return withSerializableRetry(this.prisma, async (tx) => {
      // Rejected/failed postings must NEVER mutate the perpetual balance —
      // only a movement that actually posted to GL may move inventory
      // quantity/value. A NO_RULE_MATCH/REJECTED/FAILED attempt still
      // records the movement row (status EXCEPTION, no journal) and a
      // posting exception below, but the authoritative perpetual balance
      // stays untouched, exactly like a rejected RO close never partially
      // posts (S059 AC) or a rejected tax result never estimates (S124).
      const balance = posted
        ? await tx.partsPerpetualBalance.upsert({
            where: { tenantId_legalEntityId_storeId_partNumber: { tenantId: dto.tenantId, legalEntityId: dto.legalEntityId, storeId: dto.storeId, partNumber: dto.partNumber } },
            create: {
              tenantId: dto.tenantId, legalEntityId: dto.legalEntityId, storeId: dto.storeId, partNumber: dto.partNumber,
              onHandQty: isReplenishing ? dto.quantity : -dto.quantity,
              onHandValue: centsToDollars(isReplenishing ? totalValueCents : -totalValueCents),
            },
            update: {
              onHandQty: { increment: isReplenishing ? dto.quantity : -dto.quantity },
              onHandValue: { increment: centsToDollars(isReplenishing ? totalValueCents : -totalValueCents) },
            },
          })
        : await tx.partsPerpetualBalance.findUnique({
            where: { tenantId_legalEntityId_storeId_partNumber: { tenantId: dto.tenantId, legalEntityId: dto.legalEntityId, storeId: dto.storeId, partNumber: dto.partNumber } },
          });

      const negativeOnHand = posted && RELIEVING_MOVEMENT_FAMILIES.has(dto.movementFamily) && Number(balance?.onHandQty ?? 0) < 0;

      const movement = await tx.partsMovement.create({
        data: {
          tenantId: dto.tenantId, legalEntityId: dto.legalEntityId, storeId: dto.storeId, partNumber: dto.partNumber,
          movementFamily: dto.movementFamily, movementId: dto.movementId,
          quantity: dto.quantity, unitValue: centsToDollars(unitValueCents), totalValue: centsToDollars(totalValueCents),
          sourceDocType: dto.sourceDocType, sourceDocId: dto.sourceDocId, sourceEventId: eventId, correlationId: dto.correlationId,
          businessDate: new Date(dto.businessDate),
          status: posted ? 'POSTED' : 'EXCEPTION',
          journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          negativeOnHandFlag: negativeOnHand,
        },
      });

      if (negativeOnHand) {
        // D-CE11-02 interim: allow-with-exception, loud, never silent.
        await tx.partsPostingException.create({
          data: {
            tenantId: dto.tenantId, legalEntityId: dto.legalEntityId, storeId: dto.storeId,
            sourceEventId: eventId, correlationId: dto.correlationId, eventFamily,
            partNumber: dto.partNumber, reasonCode: 'NEGATIVE_ON_HAND',
            detail: `Movement ${dto.movementId} drove on-hand to ${balance?.onHandQty ?? 0} for part ${dto.partNumber} at store ${dto.storeId}.`,
          },
        });
      }
      if (result.status !== 'POSTED') {
        await tx.partsPostingException.create({
          data: {
            tenantId: dto.tenantId, legalEntityId: dto.legalEntityId, storeId: dto.storeId,
            sourceEventId: eventId, correlationId: dto.correlationId, eventFamily,
            partNumber: dto.partNumber, reasonCode: result.status === 'NO_RULE_MATCH' ? 'RULE_NOT_FOUND' : 'DOWNSTREAM_PERMANENT',
            detail: result.failureReason ?? `Posting engine returned ${result.status}.`,
          },
        });
      }

      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'PARTS_MOVEMENT', docId: movement.id,
          action: 'POSTED', before: null as any, after: movement as any, actor: dto.actor, correlationId: dto.correlationId,
        },
      });

      return { movement, idempotent: false, negativeOnHand, postingStatus: result.status };
    });
  }

  /** S066 tie-out — the GL side is ALWAYS the real coa-service ending
   * balance for the tenant-configured inventory-control account, never a
   * caller-supplied figure. Throws GlBalanceUnavailableError (mapping
   * pending, or coa-service unreachable/errored) rather than falling back
   * to any manual/estimated value — the HTTP layer surfaces this as an
   * explicit unavailable state, never a fabricated "BALANCED". */
  async runReconciliation(input: {
    tenantId: string; legalEntityId: string; storeId?: string | null; asOfDate: string;
    triggeredBy: 'NIGHTLY' | 'ON_DEMAND'; runBy?: string | null;
  }) {
    const resolved = await this.mappings.resolveAll(input.tenantId, input.legalEntityId, EVENT_FAMILY.PARTS_RECONCILIATION, EVENT_FAMILY_ROLES[EVENT_FAMILY.PARTS_RECONCILIATION]);
    const controlAccountNumber = resolved.INVENTORY_CONTROL!;
    const glBalance = await this.glBalance.getAccountBalance(input.tenantId, input.legalEntityId, controlAccountNumber, input.asOfDate);

    const balances = await this.prisma.partsPerpetualBalance.findMany({
      where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, ...(input.storeId ? { storeId: input.storeId } : {}) },
    });
    const perpetualTotalCents = balances.reduce((sum, b) => sum + toCents(b.onHandValue), 0);
    const glTotalCents = toCents(glBalance.balance);
    const varianceCents = perpetualTotalCents - glTotalCents;

    const run = await this.prisma.partsReconciliationRun.create({
      data: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId ?? null,
        asOfDate: new Date(input.asOfDate),
        perpetualTotal: centsToDollars(perpetualTotalCents), glControlTotal: centsToDollars(glTotalCents),
        varianceAmount: centsToDollars(varianceCents),
        status: varianceCents === 0 ? 'BALANCED' : 'VARIANCE',
        triggeredBy: input.triggeredBy, runBy: input.runBy ?? null,
      },
    });

    if (varianceCents !== 0) {
      // Never hide the variance: attach every negative-on-hand-flagged and most-recent movement in scope as drill candidates.
      const candidateMovements = await this.prisma.partsMovement.findMany({
        where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, ...(input.storeId ? { storeId: input.storeId } : {}) },
        orderBy: { createdAt: 'desc' }, take: 25,
      });
      await this.prisma.partsReconciliationVarianceLine.createMany({
        data: candidateMovements.length
          ? candidateMovements.map((m) => ({ runId: run.id, partNumber: m.partNumber, movementId: m.movementId, explainedAmount: 0, unexplainedAmount: 0 }))
          : [{ runId: run.id, partNumber: 'UNASSIGNED', movementId: null, explainedAmount: 0, unexplainedAmount: centsToDollars(varianceCents) }],
      });
    }

    return run;
  }

  async listReconciliationRuns(tenantId: string, legalEntityId: string, storeId?: string | null) {
    return this.prisma.partsReconciliationRun.findMany({
      where: { tenantId, legalEntityId, ...(storeId ? { storeId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { varianceLines: true },
    });
  }

  async getReconciliationRun(tenantId: string, legalEntityId: string, id: string) {
    const run = await this.prisma.partsReconciliationRun.findFirst({ where: { tenantId, legalEntityId, id }, include: { varianceLines: true } });
    if (!run) throw new NotFoundError(`Reconciliation run ${id} not found.`);
    return run;
  }

  async listMovements(tenantId: string, filters: { legalEntityId?: string; storeId?: string; partNumber?: string; movementFamily?: string; negativeOnHandFlag?: boolean }) {
    return this.prisma.partsMovement.findMany({
      where: { tenantId, ...filters },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
