import { injectable, inject } from 'tsyringe';
import crypto from 'crypto';
import { withSerializableRetry } from '../lib/serializable-retry';
import { centsToDollars, toCents } from '../domain/money';
import { EVENT_FAMILY } from '../domain/account-mapping-roles';
import { ageInDays, bandFor } from '../domain/aging';
import { FixedOpsValidationError, NotFoundError } from '../domain/errors';
import { AccountMappingService } from './account-mapping-service';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { appendAuditEvent } from '../infrastructure/audit';

export interface SubmitClaimInput { tenantId: string; claimNumber: string; actor: string; correlationId: string; }
export interface RemitClaimInput {
  tenantId: string; claimNumber: string; remittedAmount: number | string; sourceReceiptId: string;
  sourceEventId: string; correlationId: string; actor: string;
}
export interface DispositionInput {
  tenantId: string; claimNumber: string;
  type: 'WRITE_DOWN' | 'TRANSFER_TO_CUSTOMER_RESPONSIBILITY' | 'DENIAL' | 'ADJUSTMENT';
  amount: number | string; reason: string;
  sourceEventId: string; correlationId: string; actor: string;
}

/** S065 — Warranty claim receivable lifecycle. Every disposition is
 * explicit, audited, journaled — never silent. */
@injectable()
export class WarrantyClaimService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject(AccountMappingService) private readonly mappingService: AccountMappingService,
  ) {}

  private async getClaim(tenantId: string, claimNumber: string) {
    const claim = await this.prisma.warrantyClaimItem.findFirst({ where: { tenantId, claimNumber } });
    if (!claim) throw new NotFoundError('WarrantyClaimItem', claimNumber);
    return claim;
  }

  async submit(input: SubmitClaimInput) {
    const claim = await this.getClaim(input.tenantId, input.claimNumber);
    if (claim.status !== 'BORN') return { idempotent: true, ...claim };
    const updated = await this.prisma.warrantyClaimItem.update({
      where: { id: claim.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    await appendAuditEvent(this.prisma, {
      tenantId: input.tenantId, docType: 'WARRANTY_CLAIM_ITEM', docId: claim.id, action: 'SUBMITTED',
      actor: input.actor, before: claim, after: updated, correlationId: input.correlationId,
    });
    return { idempotent: false, ...updated };
  }

  async remit(input: RemitClaimInput) {
    const claim = await this.getClaim(input.tenantId, input.claimNumber);
    const existing = await this.prisma.warrantyClaimRemittance.findFirst({
      where: { tenantId: input.tenantId, claimId: claim.id, sourceEventId: input.sourceEventId },
    });
    if (existing) return { idempotent: true, ...existing };

    const remittedCents = toCents(input.remittedAmount);
    const remainingCents = toCents(claim.remainingAmount);
    if (remittedCents > remainingCents) {
      throw new FixedOpsValidationError('REMITTANCE_EXCEEDS_REMAINING', `Remittance ${input.remittedAmount} exceeds remaining claim balance ${claim.remainingAmount}`);
    }

    return withSerializableRetry(this.prisma, async (tx) => {
      const remittance = await tx.warrantyClaimRemittance.create({
        data: {
          tenantId: input.tenantId, claimId: claim.id, remittedAmount: input.remittedAmount,
          sourceReceiptId: input.sourceReceiptId, sourceEventId: input.sourceEventId,
        },
      });
      const newRemainingCents = remainingCents - remittedCents;
      const updated = await tx.warrantyClaimItem.update({
        where: { id: claim.id },
        data: {
          remainingAmount: centsToDollars(newRemainingCents),
          status: newRemainingCents === 0 ? 'CLOSED' : 'PARTIALLY_REMITTED',
        },
      });
      await appendAuditEvent(tx, {
        tenantId: input.tenantId, docType: 'WARRANTY_CLAIM_REMITTANCE', docId: remittance.id, action: 'REMITTED',
        actor: input.actor, after: { remittance, claim: updated }, correlationId: input.correlationId,
      });
      return { idempotent: false, ...remittance };
    });
  }

  /** Short-pay disposition / denial — explicit, audited clerk action, never
   * silent. Conserves to the cent: remainingAmount decreases by exactly the
   * dispositioned amount for WRITE_DOWN/TRANSFER; DENIAL zeroes the balance. */
  async disposition(input: DispositionInput) {
    const claim = await this.getClaim(input.tenantId, input.claimNumber);
    const existing = await this.prisma.warrantyClaimDisposition.findFirst({
      where: { tenantId: input.tenantId, claimId: claim.id, sourceEventId: input.sourceEventId },
    });
    if (existing) return { idempotent: true, ...existing };

    await this.mappingService.assertFamilyResolved(input.tenantId, claim.legalEntityId, EVENT_FAMILY.WARRANTY_CLAIM_DISPOSITION as any);

    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, eventType: 'fixedops.warrantyclaim.dispositioned.v1', eventSchemaVersion: '1',
      occurredAt: now, publishedAt: now, sourceSystem: 'fixedops-service',
      sourceEntityType: 'WARRANTY_CLAIM_ITEM', sourceEntityId: input.claimNumber,
      correlationId: input.correlationId, businessDate: now.slice(0, 10),
      payload: { claimNumber: input.claimNumber, type: input.type, amount: String(input.amount), reason: input.reason },
      metadata: { eventFamily: EVENT_FAMILY.WARRANTY_CLAIM_DISPOSITION },
    };
    const result = await this.postingClient.submit(envelope);

    return withSerializableRetry(this.prisma, async (tx) => {
      const disposition = await tx.warrantyClaimDisposition.create({
        data: {
          tenantId: input.tenantId, claimId: claim.id, type: input.type, amount: input.amount,
          reason: input.reason, actor: input.actor, sourceEventId: input.sourceEventId,
          journalEntryId: result.journalEntryId ?? null,
        },
      });
      if (result.status === 'POSTED') {
        const dispositionCents = toCents(input.amount);
        const remainingCents = toCents(claim.remainingAmount);
        const newRemainingCents = input.type === 'DENIAL' ? 0 : Math.max(0, remainingCents - dispositionCents);
        await tx.warrantyClaimItem.update({
          where: { id: claim.id },
          data: {
            remainingAmount: centsToDollars(newRemainingCents),
            status: input.type === 'DENIAL' ? 'DENIED' : 'SHORT_PAY_DISPOSITIONED',
          },
        });
      }
      await appendAuditEvent(tx, {
        tenantId: input.tenantId, docType: 'WARRANTY_CLAIM_DISPOSITION', docId: disposition.id, action: input.type,
        actor: input.actor, after: disposition, reason: input.reason, correlationId: input.correlationId,
      });
      return { idempotent: false, ...disposition };
    });
  }

  /** Aging report — Σ must equal warranty receivable GL balance (per journal
   * linkage on birthJournalEntryId); day-bucket aging per domain/aging.ts. */
  async aging(tenantId: string, storeId?: string) {
    const claims = await this.prisma.warrantyClaimItem.findMany({
      where: { tenantId, ...(storeId ? { storeId } : {}), status: { notIn: ['CLOSED', 'DENIED'] } },
    });
    const now = new Date();
    const rows = claims.map((c: any) => {
      const since = c.submittedAt ?? c.createdAt;
      const days = ageInDays(new Date(since), now);
      return { ...c, ageDays: days, factoryAgeBand: bandFor(days) };
    });
    const totalRemaining = rows.reduce((acc: number, r: any) => acc + toCents(r.remainingAmount), 0);
    return { rows, totalRemainingCents: totalRemaining, totalRemaining: centsToDollars(totalRemaining) };
  }

  async list(tenantId: string, filters: { storeId?: string; status?: string } = {}) {
    return this.prisma.warrantyClaimItem.findMany({
      where: { tenantId, ...(filters.storeId ? { storeId: filters.storeId } : {}), ...(filters.status ? { status: filters.status } : {}) },
      include: { remittances: true, dispositions: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
