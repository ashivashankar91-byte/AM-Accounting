import { injectable, inject } from 'tsyringe';
import crypto from 'crypto';
import { withSerializableRetry } from '../lib/serializable-retry';
import { centsToDollars, toCents } from '../domain/money';
import { EVENT_FAMILY } from '../domain/account-mapping-roles';
import { NotFoundError } from '../domain/errors';
import { AccountMappingService } from './account-mapping-service';
import { PostingEventProducer, SourceEventEnvelope } from '../infrastructure/posting-client';
import { appendAuditEvent } from '../infrastructure/audit';

export interface CreateSubletPoInput {
  tenantId: string; legalEntityId: string; storeId: string;
  roNumber: string; poNumber: string; vendorId: string; estimatedCost: number | string;
  actor: string;
}

export interface InvoiceMatchInput {
  tenantId: string; poNumber: string; invoiceId: string; invoiceAmount: number | string;
  sourceEventId: string; correlationId: string; actor: string;
}

/** S062 — Sublet PO lifecycle: accrual at RO close if not yet invoiced;
 * invoice relief never double-costs. */
@injectable()
export class SubletService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('PostingEventProducer') private readonly postingClient: PostingEventProducer,
    @inject(AccountMappingService) private readonly mappingService: AccountMappingService,
  ) {}

  async createPo(input: CreateSubletPoInput) {
    const row = await this.prisma.subletPurchaseOrder.create({
      data: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId, storeId: input.storeId,
        roNumber: input.roNumber, poNumber: input.poNumber, vendorId: input.vendorId,
        estimatedCost: input.estimatedCost, status: 'OPEN',
      },
    });
    await appendAuditEvent(this.prisma, {
      tenantId: input.tenantId, docType: 'SUBLET_PO', docId: row.id, action: 'CREATED', actor: input.actor, after: row,
    });
    return row;
  }

  /** Called from RO-close orchestration when a RO with an OPEN sublet PO
   * closes and the vendor invoice has not yet arrived — accrues the cost. */
  async accrueAtClose(tenantId: string, legalEntityId: string, roNumber: string, sourceEventId: string, correlationId: string, actor: string) {
    const pos = await this.prisma.subletPurchaseOrder.findMany({ where: { tenantId, roNumber, status: 'OPEN' } });
    const results = [];
    for (const po of pos) {
      await this.mappingService.assertFamilyResolved(tenantId, legalEntityId, EVENT_FAMILY.SUBLET_ACCRUAL as any);

      const eventId = crypto.randomUUID();
      const now = new Date().toISOString();
      const envelope: SourceEventEnvelope = {
        eventId, tenantId, eventType: 'fixedops.sublet.accrued.v1', eventSchemaVersion: '1',
        occurredAt: now, publishedAt: now, sourceSystem: 'fixedops-service',
        sourceEntityType: 'SUBLET_PURCHASE_ORDER', sourceEntityId: po.poNumber,
        correlationId, businessDate: now.slice(0, 10),
        payload: { poNumber: po.poNumber, roNumber, estimatedCost: String(po.estimatedCost) },
        metadata: { eventFamily: EVENT_FAMILY.SUBLET_ACCRUAL },
      };
      const result = await this.postingClient.submit(envelope);
      const row = await withSerializableRetry(this.prisma, async (tx) => {
        const updated = await tx.subletPurchaseOrder.update({
          where: { id: po.id },
          data: {
            status: result.status === 'POSTED' ? 'ACCRUED' : 'OPEN',
            accrualSourceEventId: sourceEventId,
            accrualJournalEntryId: result.journalEntryId ?? null,
            accrualAmount: result.status === 'POSTED' ? po.estimatedCost : null,
          },
        });
        await appendAuditEvent(tx, {
          tenantId, docType: 'SUBLET_PO', docId: po.id, action: 'ACCRUED', actor, after: updated, correlationId,
        });
        return updated;
      });
      results.push(row);
    }
    return results;
  }

  async matchInvoice(input: InvoiceMatchInput) {
    const po = await this.prisma.subletPurchaseOrder.findFirst({ where: { tenantId: input.tenantId, poNumber: input.poNumber } });
    if (!po) throw new NotFoundError('SubletPurchaseOrder', input.poNumber);

    const existing = await this.prisma.subletInvoiceMatch.findFirst({
      where: { tenantId: input.tenantId, subletPoId: po.id, invoiceId: input.invoiceId },
    });
    if (existing) return { idempotent: true, ...existing };

    const invoiceCents = toCents(input.invoiceAmount);
    const isPreCloseInvoice = po.status === 'OPEN';
    const accrualCents = toCents(po.accrualAmount ?? 0);
    const varianceCents = isPreCloseInvoice ? 0 : invoiceCents - accrualCents;

    await this.mappingService.assertFamilyResolved(input.tenantId, po.legalEntityId, EVENT_FAMILY.SUBLET_RELIEF as any);

    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const envelope: SourceEventEnvelope = {
      eventId, tenantId: input.tenantId, eventType: 'fixedops.sublet.invoice-matched.v1', eventSchemaVersion: '1',
      occurredAt: now, publishedAt: now, sourceSystem: 'fixedops-service',
      sourceEntityType: 'SUBLET_PURCHASE_ORDER', sourceEntityId: po.poNumber,
      correlationId: input.correlationId, businessDate: now.slice(0, 10),
      payload: {
        poNumber: po.poNumber, invoiceId: input.invoiceId, invoiceAmount: String(input.invoiceAmount),
        isPreCloseInvoice, varianceAmount: String(centsToDollars(varianceCents)),
        accrualAmount: String(centsToDollars(accrualCents)),
      },
      metadata: { eventFamily: EVENT_FAMILY.SUBLET_RELIEF },
    };
    const result = await this.postingClient.submit(envelope);

    return withSerializableRetry(this.prisma, async (tx) => {
      const match = await tx.subletInvoiceMatch.create({
        data: {
          tenantId: input.tenantId, subletPo: { connect: { id: po.id } }, invoiceId: input.invoiceId,
          invoiceAmount: input.invoiceAmount, varianceAmount: centsToDollars(varianceCents),
          sourceEventId: input.sourceEventId,
          reliefJournalEntryId: result.journalEntryId ?? null,
          status: result.status === 'POSTED' ? 'POSTED' : 'EXCEPTION',
        },
      });
      await tx.subletPurchaseOrder.update({
        where: { id: po.id },
        data: { status: isPreCloseInvoice ? 'INVOICE_MATCHED_PRE_CLOSE' : 'CLOSED' },
      });
      await appendAuditEvent(tx, {
        tenantId: input.tenantId, docType: 'SUBLET_INVOICE_MATCH', docId: match.id, action: 'MATCHED',
        actor: input.actor, after: match, correlationId: input.correlationId,
      });
      return { idempotent: false, ...match };
    });
  }
}
