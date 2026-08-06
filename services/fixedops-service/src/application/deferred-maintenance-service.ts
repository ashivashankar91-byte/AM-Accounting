import { injectable, inject } from 'tsyringe';
import crypto from 'crypto';
import { withSerializableRetry } from '../lib/serializable-retry';
import { centsToDollars, toCents } from '../domain/money';
import { EVENT_FAMILY } from '../domain/account-mapping-roles';
import { FixedOpsValidationError, NotFoundError } from '../domain/errors';
import { AccountMappingService } from './account-mapping-service';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { appendAuditEvent } from '../infrastructure/audit';

export interface SellContractInput {
  tenantId: string; legalEntityId: string; storeId: string; contractNumber: string;
  soldAmount: number | string; expiresAt?: string | null;
  sourceEventId: string; correlationId: string; actor: string;
}

export interface RedeemContractInput {
  tenantId: string; contractNumber: string; roNumber: string; redeemedAmount: number | string;
  sourceEventId: string; correlationId: string; actor: string;
}

/** S064 — Deferred maintenance contracts v1. Redemption-based recognition
 * only. D-CE11-01 interim: expiry NEVER auto-recognizes income. */
@injectable()
export class DeferredMaintenanceService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject(AccountMappingService) private readonly mappingService: AccountMappingService,
  ) {}

  async sell(input: SellContractInput) {
    const existing = await this.prisma.deferredMaintenanceContract.findFirst({
      where: { tenantId: input.tenantId, contractNumber: input.contractNumber },
    });
    if (existing) return { idempotent: true, ...existing };

    await this.mappingService.assertFamilyResolved(input.tenantId, input.legalEntityId, EVENT_FAMILY.DEFERRED_CONTRACT_SALE as any);

    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, legalEntityId: input.legalEntityId, eventType: 'fixedops.deferredcontract.sold.v1', eventSchemaVersion: '1',
      occurredAt: now, publishedAt: now, sourceSystem: 'fixedops-service',
      sourceEntityType: 'DEFERRED_MAINTENANCE_CONTRACT', sourceEntityId: input.contractNumber,
      correlationId: input.correlationId, businessDate: now.slice(0, 10),
      payload: { contractNumber: input.contractNumber, soldAmount: String(input.soldAmount) },
      metadata: { eventFamily: EVENT_FAMILY.DEFERRED_CONTRACT_SALE },
    };
    const result = await this.postingClient.submit(envelope);
    if (result.status !== 'POSTED') {
      throw new FixedOpsValidationError('DEFERRED_CONTRACT_SALE_FAILED', result.failureReason ?? `posting-engine returned ${result.status}`);
    }

    return withSerializableRetry(this.prisma, async (tx) => {
      const row = await tx.deferredMaintenanceContract.create({
        data: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId,
          contractNumber: input.contractNumber, soldAmount: input.soldAmount, deferredBalance: input.soldAmount,
          status: 'ACTIVE', saleSourceEventId: input.sourceEventId, saleJournalEntryId: result.journalEntryId!,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
      });
      await appendAuditEvent(tx, {
        tenantId: input.tenantId, docType: 'DEFERRED_MAINTENANCE_CONTRACT', docId: row.id, action: 'SOLD',
        actor: input.actor, after: row, correlationId: input.correlationId,
      });
      return { idempotent: false, ...row };
    });
  }

  async redeem(input: RedeemContractInput) {
    const contract = await this.prisma.deferredMaintenanceContract.findFirst({
      where: { tenantId: input.tenantId, contractNumber: input.contractNumber },
    });
    if (!contract) throw new NotFoundError('DeferredMaintenanceContract', input.contractNumber);

    const existing = await this.prisma.deferredMaintenanceRedemption.findFirst({
      where: { tenantId: input.tenantId, contractId: contract.id, roNumber: input.roNumber, sourceEventId: input.sourceEventId },
    });
    if (existing) return { idempotent: true, ...existing };

    const redeemedCents = toCents(input.redeemedAmount);
    const balanceCents = toCents(contract.deferredBalance);
    if (redeemedCents > balanceCents) {
      throw new FixedOpsValidationError('REDEMPTION_EXCEEDS_BALANCE', `Redemption ${input.redeemedAmount} exceeds remaining deferred balance ${contract.deferredBalance}`);
    }

    await this.mappingService.assertFamilyResolved(input.tenantId, contract.legalEntityId, EVENT_FAMILY.DEFERRED_CONTRACT_REDEMPTION as any);

    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, legalEntityId: contract.legalEntityId, eventType: 'fixedops.deferredcontract.redeemed.v1', eventSchemaVersion: '1',
      occurredAt: now, publishedAt: now, sourceSystem: 'fixedops-service',
      sourceEntityType: 'DEFERRED_MAINTENANCE_CONTRACT', sourceEntityId: input.contractNumber,
      correlationId: input.correlationId, businessDate: now.slice(0, 10),
      payload: { contractNumber: input.contractNumber, roNumber: input.roNumber, redeemedAmount: String(input.redeemedAmount) },
      metadata: { eventFamily: EVENT_FAMILY.DEFERRED_CONTRACT_REDEMPTION },
    };
    const result = await this.postingClient.submit(envelope);

    return withSerializableRetry(this.prisma, async (tx) => {
      const row = await tx.deferredMaintenanceRedemption.create({
        data: {
          tenantId: input.tenantId, contractId: contract.id, roNumber: input.roNumber,
          redeemedAmount: input.redeemedAmount, sourceEventId: input.sourceEventId,
          journalEntryId: result.journalEntryId ?? null,
          status: result.status === 'POSTED' ? 'POSTED' : 'EXCEPTION',
        },
      });
      if (result.status === 'POSTED') {
        const newBalanceCents = balanceCents - redeemedCents;
        await tx.deferredMaintenanceContract.update({
          where: { id: contract.id },
          data: { deferredBalance: centsToDollars(newBalanceCents), status: newBalanceCents === 0 ? 'FULLY_REDEEMED' : 'ACTIVE' },
        });
      }
      await appendAuditEvent(tx, {
        tenantId: input.tenantId, docType: 'DEFERRED_MAINTENANCE_REDEMPTION', docId: row.id, action: 'REDEEMED',
        actor: input.actor, after: row, correlationId: input.correlationId,
      });
      return { idempotent: false, ...row };
    });
  }

  /** Flags expired-unredeemed contracts — D-CE11-01 interim: NEVER posts a
   * recognition journal. Balances stay deferred until an approved breakage
   * policy exists (genuine open accounting rule, flagged at certification). */
  async flagExpired(tenantId: string, asOf: Date) {
    const candidates = await this.prisma.deferredMaintenanceContract.findMany({
      where: { tenantId, status: 'ACTIVE', expiresAt: { lte: asOf } },
    });
    const flagged = [];
    for (const c of candidates) {
      const updated = await this.prisma.deferredMaintenanceContract.update({
        where: { id: c.id },
        data: { status: 'EXPIRED_UNREDEEMED_BALANCE_DEFERRED' },
      });
      flagged.push(updated);
    }
    return flagged;
  }

  async getByContractNumber(tenantId: string, contractNumber: string) {
    return this.prisma.deferredMaintenanceContract.findFirst({
      where: { tenantId, contractNumber },
      include: { redemptions: true },
    });
  }
}
