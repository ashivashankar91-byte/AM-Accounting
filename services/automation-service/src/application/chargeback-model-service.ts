import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { NotConfiguredError, AutomationError, AuthorityCeilingError } from '../domain/errors';
import { assertAdoptionSoD } from '../domain/sod';
import { IAutomationEventPublisher, IVehicleDealAdapter } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';

const CAPABILITY = 'S091B_CHARGEBACK_MODEL';

/**
 * CE-17 S091B — experience-rated chargeback model.
 *
 * The ceiling here is RECOMMEND and it is structural, not configured: this
 * service has no posting client and no item-execution path. A model output is
 * a proposal about a *rate*, and a rate only becomes real when a human adopts
 * it into the S091 configuration through the adoption ceremony below.
 */
@injectable()
export class ChargebackModelService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IVehicleDealAdapter') private readonly deals: IVehicleDealAdapter,
    private readonly capabilities: AutomationCapabilityService,
  ) {}

  async list(tenantId: string, legalEntityId: string, state?: string) {
    const items = await this.prisma.chargebackModelOutput.findMany({
      where: { tenantId, legalEntityId, ...(state ? { state } : {}) },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    const { signal } = await this.deals.getDealCohorts(tenantId, legalEntityId, new Date(0), new Date());
    return { items, total: items.length, upstreamSignal: signal };
  }

  async get(tenantId: string, id: string) {
    const output = await this.prisma.chargebackModelOutput.findFirst({ where: { tenantId, id } });
    if (!output) throw new NotConfiguredError(`Chargeback model output ${id} does not exist for this tenant.`);
    return output;
  }

  /**
   * Produces a recommendation from cohort experience.
   *
   * The recommended rate is the observed chargeback ratio over the training
   * window; the flat-rate comparison is carried alongside so the reader can
   * see what changing would cost them. Fit diagnostics are stored because a
   * rate without its diagnostics is an assertion, not evidence.
   */
  async runModel(input: {
    tenantId: string; legalEntityId: string; modelVersion: string;
    trainingWindowStart: string; trainingWindowEnd: string;
    cohorts?: { cohortKey: string; originatedCount: number; originatedAmount: string | number; chargedBackCount: number; chargedBackAmount: string | number }[];
    flatRateComparison?: string | number | null;
    actor: string;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);

    const start = new Date(input.trainingWindowStart);
    const end = new Date(input.trainingWindowEnd);
    if (!(start < end)) {
      throw new AutomationError('trainingWindowStart must precede trainingWindowEnd.', { statusCode: 400, code: 'INVALID_TRAINING_WINDOW' });
    }

    const { signal, cohorts: upstreamCohorts } = await this.deals.getDealCohorts(input.tenantId, input.legalEntityId, start, end);
    const cohorts = (input.cohorts && input.cohorts.length > 0) ? input.cohorts : (upstreamCohorts as any[]);

    if (!cohorts || cohorts.length === 0) {
      throw new AutomationError(
        signal.status === 'AVAILABLE'
          ? 'There is no cohort experience in the training window. A rate cannot be recommended from an empty sample.'
          : `Deal cohort data is unavailable: ${signal.detail}`,
        { statusCode: 422, code: 'MODEL_OR_RULE_UNAVAILABLE', details: { upstreamSignal: signal } },
      );
    }

    let originatedAmount = 0; let chargedBackAmount = 0;
    let originatedCount = 0; let chargedBackCount = 0;
    for (const c of cohorts) {
      originatedAmount += Number(c.originatedAmount ?? 0);
      chargedBackAmount += Number(c.chargedBackAmount ?? 0);
      originatedCount += Number(c.originatedCount ?? 0);
      chargedBackCount += Number(c.chargedBackCount ?? 0);
    }
    if (originatedAmount <= 0) {
      throw new AutomationError('Originated amount in the training window is zero; a rate would be undefined.', {
        statusCode: 422, code: 'MODEL_OR_RULE_UNAVAILABLE',
      });
    }

    const rate = chargedBackAmount / originatedAmount;
    const recommendedRate = rate.toFixed(6);

    // A thin sample is reported as drift rather than presented as a finding.
    const driftFlagged = originatedCount < 30 || cohorts.length < 2;

    const output = await this.prisma.chargebackModelOutput.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        modelVersion: input.modelVersion,
        trainingWindowStart: start,
        trainingWindowEnd: end,
        cohortData: cohorts as any,
        fitDiagnostics: {
          originatedCount, chargedBackCount,
          originatedAmount: originatedAmount.toFixed(2), chargedBackAmount: chargedBackAmount.toFixed(2),
          cohortCount: cohorts.length,
          sampleAdequate: !driftFlagged,
          upstreamStatus: signal.status,
        } as any,
        recommendedRate,
        flatRateComparison: input.flatRateComparison == null ? null : Number(input.flatRateComparison).toFixed(6),
        state: 'RECOMMENDATION_READY',
        driftFlagged,
      },
    });

    await this.prisma.ruleModelVersion.upsert({
      where: { tenantId_capabilityCode_versionTag: { tenantId: input.tenantId, capabilityCode: CAPABILITY, versionTag: input.modelVersion } },
      create: {
        tenantId: input.tenantId, capabilityCode: CAPABILITY, versionTag: input.modelVersion,
        versionType: 'MODEL', description: 'Experience-rated chargeback model',
        trainingWindowStart: start, trainingWindowEnd: end,
        deployedAt: new Date(), deployedBy: input.actor,
        metadata: { cohortCount: cohorts.length } as any,
      },
      update: {},
    });

    await this.events.publish(input.tenantId, output.id, 'automation.chargeback.model_recommended', {
      modelVersion: input.modelVersion, recommendedRate, driftFlagged, adopted: false,
    });
    return output;
  }

  /**
   * The adoption ceremony. Adoption is a deliberate human act by somebody
   * other than whoever ran the model, and it records exactly which S091
   * configuration version the rate entered. Without that link the rate would
   * be a number with no consequence and no audit trail.
   */
  async adopt(input: { tenantId: string; id: string; adoptedBy: string; s091ConfigVersion: string; acknowledgeDrift?: boolean }) {
    const output = await this.get(input.tenantId, input.id);
    if (output.state === 'ADOPTED') return output;
    if (output.state === 'SUPERSEDED') {
      throw new AutomationError('This model output has been superseded and cannot be adopted.', { statusCode: 409, code: 'OUTPUT_SUPERSEDED' });
    }
    if (!input.s091ConfigVersion) {
      throw new AutomationError(
        'Adoption requires the S091 configuration version the rate is being adopted into.',
        { statusCode: 422, code: 'ADOPTION_TARGET_REQUIRED' },
      );
    }
    if (output.driftFlagged && !input.acknowledgeDrift) {
      throw new AutomationError(
        'This model output is drift-flagged. Adoption requires an explicit acknowledgement of the drift finding.',
        { statusCode: 409, code: 'DRIFT_ACKNOWLEDGEMENT_REQUIRED', details: { fitDiagnostics: output.fitDiagnostics } },
      );
    }

    const capability = await this.capabilities.requireConfigured(input.tenantId, output.legalEntityId, CAPABILITY);
    if (capability.currentAuthority === 'AUTO_EXECUTE_WITHIN_POLICY') {
      throw new AuthorityCeilingError(
        'The experience-rated chargeback model is capped at RECOMMEND. It can never execute automatically; a human must adopt the rate.',
        { capabilityCode: CAPABILITY, requested: 'AUTO_EXECUTE_WITHIN_POLICY', ceiling: 'RECOMMEND' },
      );
    }
    assertAdoptionSoD(null, input.adoptedBy, output.modelVersion);

    const updated = await this.prisma.chargebackModelOutput.update({
      where: { id: output.id },
      data: { state: 'ADOPTED', adoptedBy: input.adoptedBy, adoptedAt: new Date(), s091ConfigVersion: input.s091ConfigVersion },
    });
    await this.prisma.chargebackModelOutput.updateMany({
      where: { tenantId: input.tenantId, legalEntityId: output.legalEntityId, state: 'ADOPTED', id: { not: output.id } },
      data: { state: 'SUPERSEDED' },
    });
    await this.prisma.ruleModelVersion.updateMany({
      where: { tenantId: input.tenantId, capabilityCode: CAPABILITY, versionTag: output.modelVersion },
      data: { adoptedBy: input.adoptedBy, adoptedAt: new Date() },
    });

    await this.events.publish(input.tenantId, output.id, 'automation.chargeback.model_adopted', {
      modelVersion: output.modelVersion, adoptedBy: input.adoptedBy,
      s091ConfigVersion: input.s091ConfigVersion, recommendedRate: output.recommendedRate.toString(),
      driftAcknowledged: Boolean(input.acknowledgeDrift),
    });
    return updated;
  }
}
