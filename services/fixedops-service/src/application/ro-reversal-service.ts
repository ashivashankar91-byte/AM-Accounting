import { injectable, inject } from 'tsyringe';
import crypto from 'crypto';
import { withSerializableRetry } from '../lib/serializable-retry';
import { EVENT_FAMILY } from '../domain/account-mapping-roles';
import { ReversalRefusedError, NotFoundError } from '../domain/errors';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { appendAuditEvent } from '../infrastructure/audit';

export interface ReversalInput {
  tenantId: string;
  legalEntityId: string;
  storeId: string;
  roNumber: string;
  action: 'REOPEN' | 'VOID';
  reason?: string | null;
  actor: string;
  correlationId: string;
  sourceEventId: string;
  customerPaymentApplied?: boolean;
}

export interface ReversalOutcome {
  idempotent: boolean;
  reversalId: string;
  status: 'COMPLETED' | 'REFUSED';
  refusalCode?: string | null;
  reversalJournalEntryId?: string | null;
}

function sumLineField(lines: Array<{ payType: string; saleAmount: unknown; costAmount: unknown; taxAmount: unknown }> | undefined | null, payType: string, field: 'saleAmount' | 'costAmount' | 'taxAmount'): string {
  return (lines ?? [])
    .filter((l) => l.payType === payType)
    .reduce((sum, l) => sum + Number(l[field] ?? 0), 0)
    .toFixed(2);
}

/** S060 — deterministic reopen/void auto-reversal, byte-symmetric, exactly-once. */
@injectable()
export class RoReversalService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
  ) {}

  async reverse(input: ReversalInput): Promise<ReversalOutcome> {
    const ro = await this.prisma.repairOrder.findFirst({ where: { tenantId: input.tenantId, storeId: input.storeId, roNumber: input.roNumber } });
    if (!ro) throw new NotFoundError('RepairOrder', input.roNumber);

    const closeVersionReversed = ro.currentCloseVersion;
    if (closeVersionReversed === 0) {
      throw new NotFoundError('RoCloseSubmission (RO never closed)', input.roNumber);
    }

    const existing = await this.prisma.roReversal.findFirst({
      where: { tenantId: input.tenantId, roNumber: input.roNumber, closeVersionReversed, action: input.action },
    });
    if (existing) {
      return {
        idempotent: true,
        reversalId: existing.id,
        status: existing.status,
        refusalCode: existing.refusalCode,
        reversalJournalEntryId: existing.reversalJournalEntryId,
      };
    }

    const originalSubmission = await this.prisma.roCloseSubmission.findFirst({
      where: { tenantId: input.tenantId, roNumber: input.roNumber, closeVersion: closeVersionReversed },
      include: { lines: true },
    });
    if (!originalSubmission || !originalSubmission.journalEntryId) {
      throw new NotFoundError('Posted RoCloseSubmission', `${input.roNumber} v${closeVersionReversed}`);
    }

    // ── Refusal guards — race on simultaneous reopen+payment resolves to one
    // winner via the same unique-constraint/withSerializableRetry pattern
    // used everywhere else; here we check known-cash-application state.
    // Queried as an explicit two-step lookup (claim -> remittance) rather
    // than a relation-filter (`remittances: { some: {} }`) so behavior is
    // identical against both the real Prisma client and the in-memory fake
    // used by unit tests. ──
    const claimsForRo = await this.prisma.warrantyClaimItem.findMany({
      where: { tenantId: input.tenantId, roNumber: input.roNumber },
    });
    let remittedClaim: any = null;
    for (const claim of claimsForRo) {
      const remittance = await this.prisma.warrantyClaimRemittance.findFirst({
        where: { tenantId: input.tenantId, claimId: claim.id },
      });
      if (remittance) { remittedClaim = claim; break; }
    }
    if (remittedClaim) {
      return withSerializableRetry(this.prisma, async (tx) => {
        const row = await tx.roReversal.create({
          data: {
            tenantId: input.tenantId, repairOrderId: ro.id, roNumber: input.roNumber,
            closeVersionReversed, action: input.action,
            originalJournalEntryId: originalSubmission.journalEntryId,
            sourceEventId: input.sourceEventId, correlationId: input.correlationId,
            status: 'REFUSED', refusalCode: 'CLAIM_CASH_APPLIED',
            reason: 'Warranty claim already has a factory remittance recorded — use claim adjustment (S065) instead.',
            actor: input.actor,
          },
        });
        await appendAuditEvent(tx, {
          tenantId: input.tenantId, docType: 'RO_REVERSAL', docId: row.id, action: 'REFUSED',
          actor: input.actor, after: row, correlationId: input.correlationId, reason: row.reason,
        });
        return { idempotent: false, reversalId: row.id, status: 'REFUSED', refusalCode: 'CLAIM_CASH_APPLIED', reversalJournalEntryId: null };
      });
    }

    if (input.action === 'VOID' && input.customerPaymentApplied) {
      return withSerializableRetry(this.prisma, async (tx) => {
        const row = await tx.roReversal.create({
          data: {
            tenantId: input.tenantId, repairOrderId: ro.id, roNumber: input.roNumber,
            closeVersionReversed, action: input.action,
            originalJournalEntryId: originalSubmission.journalEntryId,
            sourceEventId: input.sourceEventId, correlationId: input.correlationId,
            status: 'REFUSED', refusalCode: 'PAYMENT_APPLIED',
            reason: 'Customer payment already applied — use refund/adjustment path instead of void.',
            actor: input.actor,
          },
        });
        await appendAuditEvent(tx, {
          tenantId: input.tenantId, docType: 'RO_REVERSAL', docId: row.id, action: 'REFUSED',
          actor: input.actor, after: row, correlationId: input.correlationId, reason: row.reason,
        });
        return { idempotent: false, reversalId: row.id, status: 'REFUSED', refusalCode: 'PAYMENT_APPLIED', reversalJournalEntryId: null };
      });
    }

    // ── Build S218-linked reversal envelope — negated amounts, same roles. ──
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const envelope: SourceEventEnvelope = {
      eventId,
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      eventType: 'fixedops.ro.reversed.v1',
      eventSchemaVersion: '1',
      occurredAt: now,
      publishedAt: now,
      sourceSystem: 'fixedops-service',
      sourceEntityType: 'REPAIR_ORDER',
      sourceEntityId: input.roNumber,
      correlationId: input.correlationId,
      causationId: originalSubmission.sourceEventId,
      businessDate: new Date().toISOString().slice(0, 10),
      payload: {
        roNumber: input.roNumber,
        closeVersionReversed,
        action: input.action,
        originalJournalEntryId: originalSubmission.journalEntryId,
        originalSaleAmount: String(originalSubmission.totalSaleAmount),
        payTypeMix: originalSubmission.payTypeMix,
        // Same byte-exact byPayType breakdown as the original close envelope
        // (see ro-close-service.ts) — the v1 posting-engine DSL resolves one
        // fixed decimal path per posting group (no line-array iteration), so
        // a byte-symmetric reversal rule needs these as well-known fixed
        // paths, mirroring the original close's amounts with DR/CR swapped.
        totals: {
          byPayType: {
            C: {
              saleAmount: String(sumLineField(originalSubmission.lines, 'C', 'saleAmount')),
              costAmount: String(sumLineField(originalSubmission.lines, 'C', 'costAmount')),
              taxAmount: String(sumLineField(originalSubmission.lines, 'C', 'taxAmount')),
            },
            W: {
              saleAmount: String(sumLineField(originalSubmission.lines, 'W', 'saleAmount')),
              costAmount: String(sumLineField(originalSubmission.lines, 'W', 'costAmount')),
              taxAmount: '0',
            },
            I: {
              saleAmount: String(sumLineField(originalSubmission.lines, 'I', 'saleAmount')),
              costAmount: String(sumLineField(originalSubmission.lines, 'I', 'costAmount')),
              taxAmount: '0',
            },
          },
        },
      },
      metadata: { eventFamily: EVENT_FAMILY.RO_REVERSAL, reversalOf: originalSubmission.sourceEventId },
    };

    const result = await this.postingClient.submit(envelope);

    return withSerializableRetry(this.prisma, async (tx) => {
      const status = result.status === 'POSTED' ? 'COMPLETED' : 'REFUSED';
      const row = await tx.roReversal.create({
        data: {
          tenantId: input.tenantId, repairOrderId: ro.id, roNumber: input.roNumber,
          closeVersionReversed, action: input.action,
          originalJournalEntryId: originalSubmission.journalEntryId,
          reversalJournalEntryId: result.journalEntryId ?? null,
          sourceEventId: input.sourceEventId, correlationId: input.correlationId,
          status, refusalCode: status === 'REFUSED' ? 'POSTING_FAILED' : null,
          reason: input.reason ?? (status === 'REFUSED' ? result.failureReason : null),
          actor: input.actor,
        },
      });

      if (status === 'COMPLETED') {
        await tx.repairOrder.update({
          where: { id: ro.id },
          data: { status: input.action === 'VOID' ? 'VOIDED' : 'REOPENED' },
        });
      }

      await appendAuditEvent(tx, {
        tenantId: input.tenantId, docType: 'RO_REVERSAL', docId: row.id,
        action: status, actor: input.actor, after: row, correlationId: input.correlationId,
        reason: `RO ${input.roNumber} ${input.action.toLowerCase()} reversing close v${closeVersionReversed}`,
      });

      return { idempotent: false, reversalId: row.id, status, refusalCode: row.refusalCode, reversalJournalEntryId: row.reversalJournalEntryId };
    });
  }
}
