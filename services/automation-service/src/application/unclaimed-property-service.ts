import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { isAutomationIdentity } from '../domain/sod';
import { IAutomationEventPublisher, IAparAdapter } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';
import { AutomationItemService } from './automation-item-service';

const CAPABILITY = 'S127_UNCLAIMED_PROPERTY';

/**
 * CE-17 S127 — unclaimed property.
 *
 * Escheatment is a statutory obligation with a fixed sequence: identify a
 * dormant item, attempt due diligence, wait the jurisdiction's period, then
 * remit. This service enforces the sequence rather than the amounts — it
 * refuses to prepare a remittance for an item that has not been through due
 * diligence, because remitting a customer's money to the state without having
 * tried to find them is the failure this story exists to prevent.
 */
@injectable()
export class UnclaimedPropertyService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IAparAdapter') private readonly apar: IAparAdapter,
    private readonly capabilities: AutomationCapabilityService,
    private readonly items: AutomationItemService,
  ) {}

  async list(tenantId: string, legalEntityId: string, state?: string) {
    const items = await this.prisma.unclaimedPropertyItem.findMany({
      where: { tenantId, legalEntityId, ...(state ? { state } : {}) },
      orderBy: { dormancyDate: 'asc' }, take: 300,
    });
    const { signal } = await this.apar.getOpenApItems(tenantId, legalEntityId);
    return { items, total: items.length, upstreamSignal: signal };
  }

  async get(tenantId: string, id: string) {
    const item = await this.prisma.unclaimedPropertyItem.findFirst({ where: { tenantId, id } });
    if (!item) throw new NotConfiguredError(`Unclaimed property item ${id} does not exist for this tenant.`);
    return item;
  }

  /**
   * Identifies candidates. Dormancy is measured against the jurisdiction's
   * period, which the caller supplies — this service does not carry a table of
   * state escheat rules and will not pretend to.
   */
  async identifyCandidates(input: {
    tenantId: string; legalEntityId: string; holderState: string;
    dormancyMonths: number;
    candidates?: { sourceQueue: string; sourceItemId: string; propertyType: string; amount: string | number; lastActivityDate: string }[];
    actor: string;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);
    if (!input.holderState) {
      throw new AutomationError('A holder jurisdiction is required; dormancy periods are jurisdiction-specific.', {
        statusCode: 422, code: 'JURISDICTION_REQUIRED',
      });
    }
    if (!Number.isFinite(input.dormancyMonths) || input.dormancyMonths <= 0) {
      throw new AutomationError('A positive dormancy period in months is required.', {
        statusCode: 422, code: 'DORMANCY_PERIOD_NOT_CONFIGURED',
      });
    }

    const supplied = input.candidates ?? [];
    let sourceSignal = null as any;
    let rows = supplied;
    if (rows.length === 0) {
      const { signal, items } = await this.apar.getOpenApItems(input.tenantId, input.legalEntityId);
      sourceSignal = signal;
      rows = (items as any[]).map((i) => ({
        sourceQueue: 'AP', sourceItemId: String(i.id), propertyType: 'VENDOR_CREDIT',
        amount: String(i.amount ?? '0'), lastActivityDate: i.lastActivityDate ?? new Date().toISOString(),
      }));
    }

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - input.dormancyMonths);

    const created = [];
    for (const row of rows) {
      const lastActivity = new Date(row.lastActivityDate);
      if (lastActivity > cutoff) continue;

      const existing = await this.prisma.unclaimedPropertyItem.findFirst({
        where: { tenantId: input.tenantId, sourceItemId: row.sourceItemId, state: { not: 'CLOSED' } },
      });
      if (existing) continue;

      created.push(await this.prisma.unclaimedPropertyItem.create({
        data: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId,
          sourceQueue: row.sourceQueue, sourceItemId: row.sourceItemId,
          holderState: input.holderState, propertyType: row.propertyType,
          amount: String(row.amount), dormancyDate: lastActivity,
          state: 'CANDIDATE',
        },
      }));
    }

    await this.events.publish(input.tenantId, input.legalEntityId, 'automation.unclaimed_property.candidates_identified', {
      holderState: input.holderState, dormancyMonths: input.dormancyMonths,
      candidateCount: created.length, evaluated: rows.length,
    });
    return { items: created, total: created.length, evaluated: rows.length, upstreamSignal: sourceSignal };
  }

  /**
   * Records a due-diligence attempt. Every attempt is appended, never
   * replaced: the history of what was tried is the defence if the holder is
   * ever audited.
   */
  async recordDueDiligence(input: { tenantId: string; id: string; actor: string; method: string; contactRef: string; outcome: string; noticeRef?: string | null }) {
    const item = await this.get(input.tenantId, input.id);
    if (item.state === 'REMITTED' || item.state === 'CLOSED') {
      throw new AutomationError(`A ${item.state.toLowerCase()} item cannot receive further due diligence.`, {
        statusCode: 409, code: 'ITEM_CLOSED',
      });
    }
    const refs = [...((item.dueDiligenceRefs as any[]) ?? []), {
      method: input.method, contactRef: input.contactRef, outcome: input.outcome,
      noticeRef: input.noticeRef ?? null, actor: input.actor, at: new Date().toISOString(),
    }];

    const updated = await this.prisma.unclaimedPropertyItem.update({
      where: { id: item.id },
      data: {
        dueDiligenceRefs: refs as any,
        noticeAttempts: item.noticeAttempts + 1,
        state: input.outcome === 'OWNER_RESPONDED' ? 'CLOSED' : 'NOTICE_SENT',
      },
    });
    await this.events.publish(input.tenantId, item.id, 'automation.unclaimed_property.due_diligence_recorded', {
      method: input.method, outcome: input.outcome, attemptNumber: item.noticeAttempts + 1,
    });
    return updated;
  }

  /**
   * Prepares a remittance. Refused unless due diligence was actually
   * attempted — this is the story's central guarantee and it is checked on the
   * record, not on the caller's word.
   */
  async prepareRemittance(input: {
    tenantId: string; id: string; approver: string;
    escheatLiabilityAccountCode: string; sourceAccountCode: string;
  }) {
    const item = await this.get(input.tenantId, input.id);
    if (item.state === 'REMITTED') return item;
    if (isAutomationIdentity(input.approver)) {
      throw new AutomationError('An escheat remittance must be approved by a person.', { statusCode: 403, code: 'SOD_VIOLATION' });
    }
    const attempts = ((item.dueDiligenceRefs as any[]) ?? []).length;
    if (attempts === 0) {
      throw new AutomationError(
        'No due-diligence attempt has been recorded for this item. Property cannot be remitted to the state before the owner has been sought.',
        { statusCode: 422, code: 'DUE_DILIGENCE_REQUIRED' },
      );
    }

    const amount = item.amount.toString();
    const { item: automationItem } = await this.items.create({
      tenantId: input.tenantId,
      legalEntityId: item.legalEntityId,
      capabilityCode: CAPABILITY,
      subjectRef: item.id,
      action: 'PREPARE_REMITTANCE',
      sourceEvidenceRefs: [item.sourceItemId],
      recommendationEvidence: {
        holderState: item.holderState, propertyType: item.propertyType,
        dormancyDate: item.dormancyDate.toISOString().slice(0, 10),
        dueDiligenceAttempts: attempts, dueDiligenceRefs: item.dueDiligenceRefs,
        statutorySupported: true,
        postingLines: [
          { accountCode: input.sourceAccountCode, debit: amount, credit: '0.00', memo: `Escheat ${item.holderState} ${item.propertyType}` },
          { accountCode: input.escheatLiabilityAccountCode, debit: '0.00', credit: amount, memo: `Escheat liability ${item.holderState}` },
        ],
      },
      proposedAmount: amount,
    });
    const approved = await this.items.approve(input.tenantId, automationItem.id, input.approver, 'Escheat remittance approved');

    const exportRef = `automation/escheat/${item.legalEntityId}/${item.holderState}/${item.id}.json`;
    const updated = await this.prisma.unclaimedPropertyItem.update({
      where: { id: item.id },
      data: { state: 'REMITTANCE_READY', remittanceExportRef: exportRef, postingItemId: approved.id },
    });
    await this.events.publish(input.tenantId, item.id, 'automation.unclaimed_property.remittance_prepared', {
      approver: input.approver, itemId: approved.id, amount, holderState: item.holderState,
    });
    return updated;
  }
}
