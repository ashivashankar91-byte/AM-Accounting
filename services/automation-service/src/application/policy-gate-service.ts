import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { requireCapabilityDefinition } from '../domain/capabilities';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { assertPolicySoD, isAutomationIdentity } from '../domain/sod';
import { PolicyGateConfig } from '../domain/policy-gate-evaluator';
import { IAutomationEventPublisher } from '../domain/interfaces';

/**
 * CE-17 — Policy gates.
 *
 * A policy version is authored by one identity and activated by another, and
 * only an activated version is ever consulted. Saving a policy therefore never
 * loosens anything on its own — which is the point.
 */
@injectable()
export class PolicyGateService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
  ) {}

  async list(tenantId: string, legalEntityId: string, capabilityCode?: string) {
    return this.prisma.policyGate.findMany({
      where: { tenantId, legalEntityId, ...(capabilityCode ? { capabilityCode } : {}) },
      orderBy: [{ capabilityCode: 'asc' }, { effectiveDate: 'desc' }],
    });
  }

  /**
   * Authors a policy version. Refused when it would grant an irreversible or
   * ceilinged capability an automation envelope it may never have — the
   * ceiling is enforced here, not merely at grant time, so a policy cannot
   * quietly prepare the ground for one.
   */
  async save(input: {
    tenantId: string; legalEntityId: string; capabilityCode: string;
    monetaryLimit?: string | number | null;
    confidenceMin?: string | number | null;
    allowedExceptionCategories?: string[];
    highRiskCategories?: string[];
    circuitBreakerThreshold?: number;
    policyVersion: string;
    effectiveDate: string;
    authoredBy: string;
    /** Declared intent to run this capability without approval. */
    intendedAuthority?: string;
  }) {
    const def = requireCapabilityDefinition(input.capabilityCode);
    if (isAutomationIdentity(input.authoredBy)) {
      throw new AutomationError('Automation identities may not author policy versions.', {
        statusCode: 403, code: 'SOD_VIOLATION',
      });
    }
    if (input.intendedAuthority === 'AUTO_EXECUTE_WITHIN_POLICY' && def.ceiling !== 'AUTO_EXECUTE_WITHIN_POLICY') {
      const why = def.irreversible
        ? 'its effects are irreversible and cannot be undone by a compensating entry'
        : def.statutoryAdjacent ? 'it carries statutory-adjacent judgement'
          : 'its declared ceiling forbids unattended execution';
      throw new AutomationError(
        `${def.label} (${def.storyId}) may not be configured for AUTO_EXECUTE_WITHIN_POLICY because ${why}. Its ceiling is ${def.ceiling}.`,
        { statusCode: 422, code: 'AUTHORITY_CEILING_EXCEEDED', details: { capabilityCode: def.code, ceiling: def.ceiling } },
      );
    }
    if (input.confidenceMin !== undefined && input.confidenceMin !== null) {
      const c = Number(input.confidenceMin);
      if (!Number.isFinite(c) || c < 0 || c > 1) {
        throw new AutomationError('confidenceMin must be a fraction between 0 and 1.', { statusCode: 400, code: 'INVALID_CONFIDENCE' });
      }
    }

    const existing = await this.prisma.policyGate.findFirst({
      where: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId,
        capabilityCode: input.capabilityCode, policyVersion: input.policyVersion,
      },
    });
    if (existing?.activatedBy) {
      throw new AutomationError(
        `Policy version ${input.policyVersion} is already activated and is immutable. Author a new version instead.`,
        { statusCode: 409, code: 'POLICY_VERSION_IMMUTABLE' },
      );
    }

    const data = {
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      capabilityCode: input.capabilityCode,
      monetaryLimit: input.monetaryLimit === undefined || input.monetaryLimit === null ? null : String(input.monetaryLimit),
      confidenceMin: input.confidenceMin === undefined || input.confidenceMin === null ? null : String(input.confidenceMin),
      allowedExceptionCategories: (input.allowedExceptionCategories ?? []) as any,
      highRiskCategories: (input.highRiskCategories ?? []) as any,
      circuitBreakerThreshold: input.circuitBreakerThreshold ?? 5,
      policyVersion: input.policyVersion,
      authoredBy: input.authoredBy,
      effectiveDate: new Date(input.effectiveDate),
    };

    const row = existing
      ? await this.prisma.policyGate.update({ where: { id: existing.id }, data })
      : await this.prisma.policyGate.create({ data });

    await this.events.publish(input.tenantId, row.id, 'automation.policy.authored', {
      capabilityCode: input.capabilityCode, policyVersion: input.policyVersion, authoredBy: input.authoredBy,
    });
    return row;
  }

  async activate(input: { tenantId: string; id: string; activatedBy: string }) {
    const row = await this.prisma.policyGate.findFirst({ where: { tenantId: input.tenantId, id: input.id } });
    if (!row) throw new NotConfiguredError(`Policy gate ${input.id} does not exist for this tenant.`);
    if (row.activatedBy) {
      throw new AutomationError('That policy version is already activated.', { statusCode: 409, code: 'POLICY_ALREADY_ACTIVE' });
    }
    assertPolicySoD(row.authoredBy, input.activatedBy, row.capabilityCode);

    const updated = await this.prisma.policyGate.update({
      where: { id: row.id },
      data: { activatedBy: input.activatedBy },
    });
    await this.events.publish(input.tenantId, row.id, 'automation.policy.activated', {
      capabilityCode: row.capabilityCode, policyVersion: row.policyVersion,
      authoredBy: row.authoredBy, activatedBy: input.activatedBy,
    });
    return updated;
  }

  /**
   * The effective gate for an action: the newest activated version whose
   * effective date has arrived. An unactivated draft is never consulted, and
   * an entity with no activated version gets null — which the evaluator
   * treats as a refusal, not a free pass.
   */
  async effectiveGate(tenantId: string, legalEntityId: string, capabilityCode: string, asOf = new Date()): Promise<PolicyGateConfig | null> {
    const row = await this.prisma.policyGate.findFirst({
      where: {
        tenantId, legalEntityId, capabilityCode,
        NOT: { activatedBy: null },
        effectiveDate: { lte: asOf },
      },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
    if (!row) return null;
    return {
      monetaryLimit: row.monetaryLimit === null ? null : row.monetaryLimit.toString(),
      confidenceMin: row.confidenceMin === null ? null : row.confidenceMin.toString(),
      allowedExceptionCategories: (row.allowedExceptionCategories as string[]) ?? [],
      highRiskCategories: (row.highRiskCategories as string[]) ?? [],
      circuitBreakerThreshold: row.circuitBreakerThreshold,
      policyVersion: row.policyVersion,
    };
  }
}
