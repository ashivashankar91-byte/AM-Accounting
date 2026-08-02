// Gap-closure — Due-Bill / We-Owe items. The Fable epic package lists
// "due bills and we-owe items" as a mandatory schedule-effect area (schedule
// 91, GL DUE_BILL_PAYABLE 19226) that had no ceremony at all before this
// pass. A due-bill records a dealer obligation not yet fulfilled at
// delivery (an accessory, a repair, a missing key, etc.) against the deal —
// posts a real journal through the ce12.deal-accounting.due-bill rule pack
// (DR DEAL_RECEIVABLE_CLEARING / CR DUE_BILL_PAYABLE, controlNumberPath =
// dealNumber, feeding schedule 91's real ScheduleOpenItem), and can later be
// marked fulfilled (a local status flip — the real relief/write-off of the
// schedule-service open item is an operator action against schedule-service
// directly, exactly like every other CE-12 schedule-linked item in this
// service; this service's own row exists for lineage/audit, matching
// DealOpenItem's documented convention elsewhere in this codebase).

import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import { buildEnvelope } from '../domain/event-envelope';
import { IPostingEngineClient } from '../infrastructure/posting-engine-client';
import { IPostingRecoveryClient } from '../infrastructure/posting-recovery-client';
import { classifyCoaFailureReason } from '../infrastructure/posting-failure-taxonomy';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditReference } from '../infrastructure/audit';
import { DealNotFoundError, OpenItemNotFoundError, AlreadyRelievedError } from './errors';

export const DUE_BILL_RECORDED_EVENT = 'deal.due-bill-recorded.v1';

export interface RecordDueBillInput {
  tenantId: string;
  dealNumber: string;
  itemDescription: string;
  amount: string;
  reason: string;
  idempotencyKey: string;
  actor: string;
}

export interface ListDueBillsFilter {
  dealNumber?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

@injectable()
export class DueBillService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IPostingEngineClient') private readonly postingEngine: IPostingEngineClient,
    @inject('IPostingRecoveryClient') private readonly postingRecovery: IPostingRecoveryClient,
  ) {}

  async recordDueBill(input: RecordDueBillInput) {
    const deal = await this.prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId: input.tenantId, dealNumber: input.dealNumber } } });
    if (!deal) throw new DealNotFoundError(input.dealNumber);

    const existing = await this.prisma.dueBill.findUnique({ where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;

    const eventId = `${input.dealNumber}:due-bill:${input.idempotencyKey}`;
    const envelope = buildEnvelope({
      eventId, tenantId: input.tenantId, legalEntityId: deal.legalEntityId, eventType: DUE_BILL_RECORDED_EVENT, occurredAt: new Date().toISOString(),
      sourceEntityType: 'DEAL', sourceEntityId: input.dealNumber, correlationId: `due-bill:${input.dealNumber}:${input.idempotencyKey}`,
      businessDate: new Date().toISOString().slice(0, 10),
      payload: { dealNumber: input.dealNumber, itemDescription: input.itemDescription, amount: input.amount },
    });
    const result = await this.postingEngine.submitEvent(envelope);
    if (result.status === 'REJECTED' || result.status === 'FAILED') {
      try {
        await this.postingRecovery.fileDeadLetter(envelope, {
          failureCategory: classifyCoaFailureReason(result.failureReason), failureCode: `DUE_BILL_${result.status}`,
          failureStage: 'MAPPING', failureMessage: result.failureReason ?? 'unknown', occurredAt: new Date().toISOString(),
        }, { legalEntityId: deal.legalEntityId, storeId: deal.storeId, sourceTransactionId: input.dealNumber });
      } catch { /* best-effort */ }
    }

    const dueBill = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, input.tenantId);
      const r = await tx.dueBill.create({
        data: {
          id: randomUUID(), tenantId: input.tenantId, dealId: deal.id, itemDescription: input.itemDescription,
          amount: input.amount, reason: input.reason, status: 'OPEN',
          eventId, coaStatus: result.status, journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          idempotencyKey: input.idempotencyKey, createdBy: input.actor,
        },
      });
      await appendAuditReference(tx, {
        tenantId: input.tenantId, docType: 'DUE_BILL', docId: r.id, action: 'RECORDED',
        after: { dealNumber: input.dealNumber, itemDescription: input.itemDescription, amount: input.amount, coaStatus: result.status, journalNumber: result.journalNumber ?? null },
        actor: input.actor,
      });
      return r;
    });

    return dueBill;
  }

  async fulfill(tenantId: string, id: string, actor: string) {
    const dueBill = await this.prisma.dueBill.findFirst({ where: { id, tenantId } });
    if (!dueBill) throw new OpenItemNotFoundError('DUE_BILL', id);
    if (dueBill.status === 'FULFILLED') throw new AlreadyRelievedError(`Due-bill "${id}" is already fulfilled.`);

    const updated = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const r = await tx.dueBill.update({ where: { id }, data: { status: 'FULFILLED', fulfilledAt: new Date(), fulfilledBy: actor } });
      await appendAuditReference(tx, { tenantId, docType: 'DUE_BILL', docId: id, action: 'FULFILLED', after: { fulfilledBy: actor }, actor });
      return r;
    });
    return updated;
  }

  async getById(tenantId: string, id: string) {
    const dueBill = await this.prisma.dueBill.findFirst({ where: { id, tenantId } });
    if (!dueBill) throw new OpenItemNotFoundError('DUE_BILL', id);
    return dueBill;
  }

  async list(tenantId: string, filter: ListDueBillsFilter) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
    const where: any = { tenantId };
    if (filter.status) where.status = filter.status;
    if (filter.dealNumber) {
      const deal = await this.prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber: filter.dealNumber } } });
      where.dealId = deal?.id ?? '__no-match__';
    }
    const [items, total] = await Promise.all([
      this.prisma.dueBill.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.dueBill.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
}
