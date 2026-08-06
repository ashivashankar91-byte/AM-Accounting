import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { isAutomationIdentity } from '../domain/sod';
import { IAutomationEventPublisher, IOemAdapter } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';
import { AutomationItemService } from './automation-item-service';

const CAPABILITY = 'S103B_INCENTIVE_ACCRUAL';
const RULE_VERSION = 'ce17.incentive.v1';

/**
 * CE-17 S103B — probability-weighted incentive accruals.
 *
 * The weighting method comes from configuration, never from this code choosing
 * what looks reasonable. Each period/program pair may hold exactly one live
 * recommendation: the double-accrual guard is a uniqueness check performed
 * before the number is written, not a reconciliation performed afterwards.
 */
@injectable()
export class IncentiveAccrualService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IOemAdapter') private readonly oem: IOemAdapter,
    private readonly capabilities: AutomationCapabilityService,
    private readonly items: AutomationItemService,
  ) {}

  async list(tenantId: string, legalEntityId: string, periodYear?: number, periodMonth?: number) {
    const items = await this.prisma.incentiveAccrualRecommendation.findMany({
      where: {
        tenantId, legalEntityId,
        ...(periodYear ? { periodYear } : {}),
        ...(periodMonth ? { periodMonth } : {}),
      },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }], take: 200,
    });
    const { signal } = await this.oem.getIncentivePrograms(tenantId, legalEntityId);
    return { items, total: items.length, upstreamSignal: signal };
  }

  async get(tenantId: string, id: string) {
    const rec = await this.prisma.incentiveAccrualRecommendation.findFirst({ where: { tenantId, id } });
    if (!rec) throw new NotConfiguredError(`Incentive accrual recommendation ${id} does not exist for this tenant.`);
    return rec;
  }

  /**
   * Computes a probability-weighted accrual.
   *
   * amount = Σ over tiers of (tier payout × tier probability), where the
   * probabilities are supplied by the configured weighting method. Every tier
   * and every probability is stored so the number can be re-derived by hand.
   */
  async recommend(input: {
    tenantId: string; legalEntityId: string; programRef: string;
    periodYear: number; periodMonth: number;
    attainmentPace: string | number;
    weightingMethod: string;
    tiers: { tierCode: string; threshold: string | number; payout: string | number; probability: string | number }[];
    actor: string;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);
    if (!input.weightingMethod) {
      throw new AutomationError(
        'A weighting method must be configured before an accrual can be recommended.',
        { statusCode: 422, code: 'WEIGHTING_METHOD_NOT_CONFIGURED' },
      );
    }
    if (!input.tiers || input.tiers.length === 0) {
      throw new AutomationError(
        'The program has no tier structure; there is nothing to weight.',
        { statusCode: 422, code: 'MODEL_OR_RULE_UNAVAILABLE' },
      );
    }

    // Double-accrual guard: one live recommendation per program per period.
    const existing = await this.prisma.incentiveAccrualRecommendation.findFirst({
      where: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId, programRef: input.programRef,
        periodYear: input.periodYear, periodMonth: input.periodMonth,
        state: { in: ['RECOMMENDATION_READY', 'APPROVED'] },
      },
    });
    if (existing) {
      throw new AutomationError(
        `An accrual recommendation already exists for ${input.programRef} in ${input.periodYear}-${String(input.periodMonth).padStart(2, '0')}. Reject or reverse it before recommending another.`,
        { statusCode: 409, code: 'DOUBLE_ACCRUAL_REFUSED', details: { existingId: existing.id, existingState: existing.state } },
      );
    }

    let weighted = 0;
    let probabilityTotal = 0;
    for (const tier of input.tiers) {
      const p = Number(tier.probability);
      if (!Number.isFinite(p) || p < 0 || p > 1) {
        throw new AutomationError(`Tier ${tier.tierCode} has an invalid probability; probabilities must be between 0 and 1.`, {
          statusCode: 400, code: 'INVALID_TIER_PROBABILITY',
        });
      }
      probabilityTotal += p;
      weighted += Number(tier.payout) * p;
    }
    if (probabilityTotal > 1.0000001) {
      throw new AutomationError(
        `Tier probabilities sum to ${probabilityTotal.toFixed(4)}, which exceeds certainty. The accrual would overstate the program.`,
        { statusCode: 422, code: 'PROBABILITY_MASS_EXCEEDED' },
      );
    }
    const amount = weighted.toFixed(2);

    const rec = await this.prisma.incentiveAccrualRecommendation.create({
      data: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId,
        programRef: input.programRef, periodYear: input.periodYear, periodMonth: input.periodMonth,
        attainmentPace: Number(input.attainmentPace).toFixed(4),
        weightingMethod: input.weightingMethod,
        tierData: input.tiers as any,
        weightingInputs: {
          probabilityTotal: probabilityTotal.toFixed(6),
          weightedPayout: amount,
          derivation: 'sum(tier.payout * tier.probability)',
        } as any,
        recommendedAmount: amount,
        ruleVersion: RULE_VERSION,
        state: 'RECOMMENDATION_READY',
        isDoubleAccrualGuarded: true,
      },
    });

    await this.events.publish(input.tenantId, rec.id, 'automation.incentive.recommended', {
      programRef: input.programRef, periodYear: input.periodYear, periodMonth: input.periodMonth,
      recommendedAmount: amount, weightingMethod: input.weightingMethod, posted: false,
    });
    return rec;
  }

  async approve(input: { tenantId: string; id: string; approver: string; accrualAccountCode: string; offsetAccountCode: string }) {
    const rec = await this.get(input.tenantId, input.id);
    if (rec.state === 'APPROVED') return rec;
    if (isAutomationIdentity(input.approver)) {
      throw new AutomationError('An incentive accrual must be approved by a person.', { statusCode: 403, code: 'SOD_VIOLATION' });
    }

    const amount = rec.recommendedAmount.toString();
    const { item } = await this.items.create({
      tenantId: input.tenantId,
      legalEntityId: rec.legalEntityId,
      capabilityCode: CAPABILITY,
      subjectRef: rec.id,
      action: 'POST_ACCRUAL',
      sourceEvidenceRefs: [rec.programRef],
      recommendationEvidence: {
        programRef: rec.programRef, periodYear: rec.periodYear, periodMonth: rec.periodMonth,
        weightingMethod: rec.weightingMethod, tierData: rec.tierData, weightingInputs: rec.weightingInputs,
        attainmentPace: rec.attainmentPace.toString(), statutorySupported: true,
        postingLines: [
          { accountCode: input.offsetAccountCode, debit: amount, credit: '0.00', memo: `Incentive accrual ${rec.programRef} ${rec.periodYear}-${String(rec.periodMonth).padStart(2, '0')}` },
          { accountCode: input.accrualAccountCode, debit: '0.00', credit: amount, memo: `Incentive accrual ${rec.programRef}` },
        ],
      },
      ruleVersion: rec.ruleVersion,
      proposedAmount: amount,
      periodYear: rec.periodYear,
      periodMonth: rec.periodMonth,
    });
    const approved = await this.items.approve(input.tenantId, item.id, input.approver, 'Incentive accrual approved');

    const updated = await this.prisma.incentiveAccrualRecommendation.update({
      where: { id: rec.id },
      data: { state: 'APPROVED', approvedBy: input.approver, approvedAt: new Date(), postingItemId: approved.id },
    });
    await this.events.publish(input.tenantId, rec.id, 'automation.incentive.approved', {
      approver: input.approver, itemId: approved.id, amount,
    });
    return updated;
  }

  async reject(input: { tenantId: string; id: string; actor: string; reason: string }) {
    const rec = await this.get(input.tenantId, input.id);
    const updated = await this.prisma.incentiveAccrualRecommendation.update({
      where: { id: rec.id },
      data: {
        state: 'REJECTED',
        weightingInputs: { ...(rec.weightingInputs as any), rejectionReason: input.reason, rejectedBy: input.actor } as any,
      },
    });
    await this.events.publish(input.tenantId, rec.id, 'automation.incentive.rejected', { actor: input.actor, reason: input.reason });
    return updated;
  }
}
