import { injectable, inject } from 'tsyringe';
import crypto from 'crypto';
import { withSerializableRetry } from '../lib/serializable-retry';
import { centsToDollars, toCents } from '../domain/money';
import {
  RoCloseRequest, assertRoCloseConserves, payTypeMixLabel, groupByPayType,
  sumSaleCents, sumCostCents, sumTaxCents,
} from '../domain/ro-distribution';
import { EVENT_FAMILY } from '../domain/account-mapping-roles';
import { AccountMappingPendingError, TaxResultUnavailableError } from '../domain/errors';
import { AccountMappingService } from './account-mapping-service';
import { ExceptionService } from './exception-service';
import { WipModeService } from './wip-mode-service';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { TaxClient, taxResultAllowsProceed } from '../infrastructure/tax-client';
import { appendAuditEvent } from '../infrastructure/audit';

export interface RoCloseInput extends RoCloseRequest {
  sourceEventId: string;
  correlationId: string;
  actor: string;
}

export interface RoCloseOutcome {
  idempotent: boolean;
  submissionId: string;
  status: string;
  closeVersion: number;
  journalEntryId?: string | null;
  journalNumber?: string | null;
  failureReason?: string | null;
}

const FAMILY_BY_PAY_TYPE: Record<'C' | 'W' | 'I', string> = {
  C: EVENT_FAMILY.RO_CLOSE_CUSTOMER,
  W: EVENT_FAMILY.RO_CLOSE_WARRANTY,
  I: EVENT_FAMILY.RO_CLOSE_INTERNAL,
};

@injectable()
export class RoCloseService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject('TaxClient') private readonly taxClient: TaxClient,
    @inject(AccountMappingService) private readonly mappingService: AccountMappingService,
    @inject(ExceptionService) private readonly exceptionService: ExceptionService,
    @inject(WipModeService) private readonly wipModeService: WipModeService,
  ) {}

  private async findOrCreateRo(tenantId: string, legalEntityId: string, storeId: string, roNumber: string) {
    let ro = await this.prisma.repairOrder.findFirst({ where: { tenantId, storeId, roNumber } });
    if (!ro) {
      ro = await this.prisma.repairOrder.create({
        data: { tenantId, legalEntityId, storeId, roNumber, status: 'OPEN', currentCloseVersion: 0 },
      });
    }
    return ro;
  }

  async closeRo(input: RoCloseInput): Promise<RoCloseOutcome> {
    assertRoCloseConserves(input);

    const ro = await this.findOrCreateRo(input.tenantId, input.legalEntityId, input.storeId, input.roNumber);

    // Idempotency: same logical close attempt (caller-supplied sourceEventId)
    // for this RO returns the original result — never re-posts.
    const existing = await this.prisma.roCloseSubmission.findFirst({
      where: { tenantId: input.tenantId, roNumber: input.roNumber, sourceEventId: input.sourceEventId },
      include: { lines: true },
    });
    if (existing) {
      return {
        idempotent: true,
        submissionId: existing.id,
        status: existing.status,
        closeVersion: existing.closeVersion,
        journalEntryId: existing.journalEntryId,
        journalNumber: existing.journalNumber,
        failureReason: existing.failureReason,
      };
    }

    const closeVersion = ro.currentCloseVersion + 1;
    const grouped = groupByPayType(input.lines);
    const payTypesPresent = (['C', 'W', 'I'] as const).filter((pt) => grouped[pt].length > 0);

    // ── Tax (C-type only) — never estimate, never proceed on non-proceed status ──
    let taxResultId: string | null = null;
    let taxAmountCents = 0;
    if (grouped.C.length > 0) {
      const taxRequest = {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        storeId: input.storeId,
        documentType: 'REPAIR_ORDER',
        documentId: input.roNumber,
        documentVersion: closeVersion,
        lines: grouped.C.map((l) => ({
          lineId: l.lineId,
          itemClassCode: l.category,
          amount: String(l.saleAmount),
          quantity: 1,
        })),
        currency: 'USD',
        correlationId: input.correlationId,
        idempotencyKey: `${input.roNumber}:${closeVersion}`,
        businessDate: input.businessDate,
      };
      const taxResult = await this.taxClient.calculate(taxRequest);
      if (!taxResultAllowsProceed(taxResult.status)) {
        const exception = await this.exceptionService.raise({
          tenantId: input.tenantId,
          legalEntityId: input.legalEntityId,
          storeId: input.storeId,
          sourceEventId: input.sourceEventId,
          correlationId: input.correlationId,
          eventFamily: EVENT_FAMILY.RO_CLOSE_CUSTOMER,
          roNumber: input.roNumber,
          reasonCode: 'TAX_RESULT_UNAVAILABLE',
          detail: `tax-service returned status=${taxResult.status}`,
        });
        const submission = await this.prisma.roCloseSubmission.create({
          data: {
            tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId,
            repairOrderId: ro.id, roNumber: input.roNumber, closeVersion,
            sourceEventId: input.sourceEventId, correlationId: input.correlationId,
            businessDate: new Date(input.businessDate),
            payTypeMix: payTypeMixLabel(input.lines),
            totalSaleAmount: input.totalSaleAmount,
            totalCostAmount: centsToDollars(sumCostCents(input.lines)),
            totalTaxAmount: 0,
            status: 'BLOCKED_TAX_UNAVAILABLE',
            failureReason: `Tax result unavailable (exception ${exception.id})`,
            actor: input.actor,
          },
        });
        throw new TaxResultUnavailableError(taxResult.parkedExceptionId ?? null,
          `RO ${input.roNumber} close blocked: customer-pay tax result unavailable (submission ${submission.id}, exception ${exception.id})`);
      }
      taxResultId = taxResult.taxResultId;
      taxAmountCents = toCents(taxResult.totalTax);
    }

    // ── Account mapping — ALL families resolved before ANY posting attempt ──
    // (all-or-nothing: never a partial post across pay types).
    try {
      for (const pt of payTypesPresent) {
        await this.mappingService.assertFamilyResolved(input.tenantId, input.legalEntityId, FAMILY_BY_PAY_TYPE[pt] as any);
      }
    } catch (err) {
      if (err instanceof AccountMappingPendingError) {
        const exception = await this.exceptionService.raise({
          tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId,
          sourceEventId: input.sourceEventId, correlationId: input.correlationId,
          eventFamily: FAMILY_BY_PAY_TYPE[payTypesPresent[0]!],
          roNumber: input.roNumber, reasonCode: 'ACCOUNTING_MAPPING_UNRESOLVED', detail: err.message,
        });
        await this.prisma.roCloseSubmission.create({
          data: {
            tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId,
            repairOrderId: ro.id, roNumber: input.roNumber, closeVersion,
            sourceEventId: input.sourceEventId, correlationId: input.correlationId,
            businessDate: new Date(input.businessDate),
            payTypeMix: payTypeMixLabel(input.lines),
            totalSaleAmount: input.totalSaleAmount,
            totalCostAmount: centsToDollars(sumCostCents(input.lines)),
            totalTaxAmount: centsToDollars(taxAmountCents),
            status: 'REJECTED_MAPPING',
            failureReason: `${err.message} (exception ${exception.id})`,
            actor: input.actor,
          },
        });
      }
      throw err;
    }

    // ── WIP mode (S061) — informs which absorption path is active; branching
    // is expressed to the rule pack via payload.wipMode, not decided here. ──
    const wipMode = await this.wipModeService.activeMode(input.tenantId, input.legalEntityId, input.storeId, new Date(input.businessDate));

    // ── Build ONE canonical envelope for the ENTIRE mixed-pay distribution —
    // exactly one journal per RO close (S059 AC), never one per pay segment. ──
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const envelope: SourceEventEnvelope = {
      eventId,
      tenantId: input.tenantId,
      eventType: 'fixedops.ro.closed.v1',
      eventSchemaVersion: '1',
      occurredAt: now,
      publishedAt: now,
      sourceSystem: 'fixedops-service',
      sourceEntityType: 'REPAIR_ORDER',
      sourceEntityId: input.roNumber,
      correlationId: input.correlationId,
      businessDate: input.businessDate,
      payload: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        storeId: input.storeId,
        roNumber: input.roNumber,
        closeVersion,
        payTypeMix: payTypeMixLabel(input.lines),
        wipMode,
        taxResultId,
        lines: input.lines.map((l) => ({
          lineId: l.lineId, payType: l.payType, category: l.category,
          opcode: l.opcode ?? null, techId: l.techId ?? null, partNumber: l.partNumber ?? null,
          saleAmount: String(l.saleAmount), costAmount: String(l.costAmount ?? 0),
          taxAmount: l.payType === 'C' ? String(centsToDollars(toCents(l.saleAmount) === 0 ? 0 : Math.round((toCents(l.saleAmount) / Math.max(1, sumSaleCents(groupByPayType(input.lines).C))) * taxAmountCents))) : '0',
        })),
        totals: {
          saleAmount: String(input.totalSaleAmount),
          costAmount: String(centsToDollars(sumCostCents(input.lines))),
          taxAmount: String(centsToDollars(taxAmountCents)),
          // Per-pay-type subtotals — the v1 posting-engine DSL resolves one
          // fixed decimal path per posting group (no array/line iteration
          // support; see coa-service's blueprint.ts resolveBaseAmountCents),
          // so a rule pack routing customer/warranty/internal amounts to
          // different GL roles needs these as well-known fixed paths rather
          // than iterating `lines[]` itself. Always present (zero-filled for
          // absent pay types) so a rule pack can reference them unconditionally.
          byPayType: {
            C: { saleAmount: String(centsToDollars(sumSaleCents(grouped.C))), costAmount: String(centsToDollars(sumCostCents(grouped.C))), taxAmount: String(centsToDollars(taxAmountCents)) },
            W: { saleAmount: String(centsToDollars(sumSaleCents(grouped.W))), costAmount: String(centsToDollars(sumCostCents(grouped.W))), taxAmount: '0' },
            I: { saleAmount: String(centsToDollars(sumSaleCents(grouped.I))), costAmount: String(centsToDollars(sumCostCents(grouped.I))), taxAmount: '0' },
          },
        },
      },
      metadata: { sourceEventId: input.sourceEventId },
    };

    const result = await this.postingClient.submit(envelope);

    return withSerializableRetry(this.prisma, async (tx) => {
      const status = result.status === 'POSTED' ? 'POSTED' : 'EXCEPTION';
      const submission = await tx.roCloseSubmission.create({
        data: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId,
          repairOrderId: ro.id, roNumber: input.roNumber, closeVersion,
          sourceEventId: input.sourceEventId, correlationId: input.correlationId,
          businessDate: new Date(input.businessDate),
          payTypeMix: payTypeMixLabel(input.lines),
          totalSaleAmount: input.totalSaleAmount,
          totalCostAmount: centsToDollars(sumCostCents(input.lines)),
          totalTaxAmount: centsToDollars(taxAmountCents),
          status,
          journalEntryId: result.journalEntryId ?? null,
          journalNumber: result.journalNumber ?? null,
          rulePackVersionId: result.rulePackVersionId ?? null,
          failureReason: result.failureReason ?? null,
          actor: input.actor,
        },
      });

      for (const line of input.lines) {
        const taxCentsForLine = line.payType === 'C' && sumSaleCents(groupByPayType(input.lines).C) > 0
          ? Math.round((toCents(line.saleAmount) / sumSaleCents(groupByPayType(input.lines).C)) * taxAmountCents)
          : 0;
        await tx.roDistributionLine.create({
          data: {
            tenantId: input.tenantId, roCloseSubmissionId: submission.id, lineId: line.lineId,
            payType: line.payType, category: line.category, opcode: line.opcode ?? null,
            techId: line.techId ?? null, partNumber: line.partNumber ?? null,
            saleAmount: line.saleAmount, costAmount: line.costAmount ?? 0,
            taxResultId: line.payType === 'C' ? taxResultId : null,
            taxAmount: centsToDollars(taxCentsForLine),
          },
        });
      }

      if (status === 'POSTED') {
        await tx.repairOrder.update({
          where: { id: ro.id },
          data: { status: 'CLOSED', currentCloseVersion: closeVersion, wipMode, closedAt: new Date() },
        });

        if (grouped.W.length > 0) {
          const claimNumber = `${input.roNumber}-CLAIM-${closeVersion}`;
          const claimSale = centsToDollars(sumSaleCents(grouped.W));
          await tx.warrantyClaimItem.upsert({
            where: { tenantId_claimNumber: { tenantId: input.tenantId, claimNumber } },
            create: {
              tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId,
              roNumber: input.roNumber, claimNumber, saleAmount: claimSale, remainingAmount: claimSale,
              status: 'BORN', birthSourceEventId: input.sourceEventId,
              birthJournalEntryId: result.journalEntryId!,
              // PENDING_CE07_TECHNICAL_RECONCILIATION — see schema header: this
              // row is the governed schedule-effect projection until
              // coa-service's outbox event carries scheduleNumber/applyNumber.
              scheduleProjectionPending: true,
            },
            update: {},
          });
        }
      } else {
        const exception = await this.exceptionService.raise({
          tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId,
          sourceEventId: input.sourceEventId, correlationId: input.correlationId,
          eventFamily: FAMILY_BY_PAY_TYPE[payTypesPresent[0]!],
          roNumber: input.roNumber,
          reasonCode: result.status === 'NO_RULE_MATCH' ? 'RULE_NOT_FOUND' : 'DOWNSTREAM_PERMANENT',
          detail: result.failureReason ?? `posting-engine returned ${result.status}`,
        }, tx);
        void exception;
      }

      await appendAuditEvent(tx, {
        tenantId: input.tenantId, docType: 'RO_CLOSE_SUBMISSION', docId: submission.id,
        action: status === 'POSTED' ? 'POSTED' : 'EXCEPTION', actor: input.actor,
        after: submission, correlationId: input.correlationId,
        reason: `RO ${input.roNumber} close v${closeVersion} (${payTypeMixLabel(input.lines)})`,
      });

      return {
        idempotent: false,
        submissionId: submission.id,
        status: submission.status,
        closeVersion,
        journalEntryId: submission.journalEntryId,
        journalNumber: submission.journalNumber,
        failureReason: submission.failureReason,
      };
    });
  }

  async getByRoNumber(tenantId: string, storeId: string, roNumber: string) {
    return this.prisma.repairOrder.findFirst({
      where: { tenantId, storeId, roNumber },
      include: { closeSubmissions: { include: { lines: true }, orderBy: { closeVersion: 'desc' } }, reversals: true },
    });
  }

  async listPostings(tenantId: string, filters: { storeId?: string; status?: string; payType?: string }) {
    const submissions = await this.prisma.roCloseSubmission.findMany({
      where: { tenantId, ...(filters.storeId ? { storeId: filters.storeId } : {}), ...(filters.status ? { status: filters.status } : {}) },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!filters.payType) return submissions;
    return submissions.filter((s: any) => s.lines.some((l: any) => l.payType === filters.payType));
  }
}
