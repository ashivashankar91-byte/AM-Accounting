import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import {
  AuthorityLevel, DEFAULT_AUTHORITY, authorityRank, isAuthorityLevel, AUTHORITY_LADDER,
} from '../domain/authority';
import { CAPABILITIES, requireCapabilityDefinition } from '../domain/capabilities';
import {
  AuthorityCeilingError, InvalidAuthorityTransitionError, NotConfiguredError, AutomationError,
} from '../domain/errors';
import { assertGrantSoD, isAutomationIdentity } from '../domain/sod';
import { IAutomationEventPublisher, IMigrationBaselineClient } from '../domain/interfaces';

export interface CapabilityView {
  id: string | null;
  capabilityCode: string;
  storyId: string;
  label: string;
  ceiling: AuthorityLevel;
  currentAuthority: string;
  truthfulState: string;
  irreversible: boolean;
  statutoryAdjacent: boolean;
  zeroMutation: boolean;
  requiresAdoptionCeremony: boolean;
  dualAuthorization: boolean;
  configured: boolean;
  circuitBreakerCount: number;
  circuitBreakerTripped: boolean;
  pendingGrant: { id: string; toAuthority: string; grantedBy: string; grantedAt: Date } | null;
  suspendReason: string | null;
  baselineEvidenceRef: string | null;
  policyVersion: string;
}

/**
 * CE-17 — Capability authority lifecycle.
 *
 * Grant and activation are two separate acts by two separate identities. A
 * grant on its own changes nothing: the capability keeps its old authority
 * until somebody else activates it. That is why a compromised or careless
 * single account cannot promote an automation on its own.
 */
@injectable()
export class AutomationCapabilityService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IMigrationBaselineClient') private readonly baseline: IMigrationBaselineClient,
  ) {}

  /**
   * Every one of the 14 canonical capabilities is always listed. An unrowed
   * capability reports NOT_CONFIGURED rather than vanishing from the grid —
   * "we never set this up" and "this does not exist" are different facts.
   */
  async list(tenantId: string, legalEntityId: string): Promise<CapabilityView[]> {
    const rows = await this.prisma.automationCapability.findMany({
      where: { tenantId, legalEntityId },
      include: { grants: { where: { revoked: false, activatedAt: null }, orderBy: { grantedAt: 'desc' }, take: 1 } },
    });
    const byCode = new Map(rows.map((r) => [r.capabilityCode, r]));
    const gates = await this.prisma.policyGate.findMany({
      where: { tenantId, legalEntityId, NOT: { activatedBy: null } },
      select: { capabilityCode: true, circuitBreakerThreshold: true },
    });
    const thresholdByCode = new Map(gates.map((g) => [g.capabilityCode, g.circuitBreakerThreshold]));

    return CAPABILITIES.map((def) => {
      const row = byCode.get(def.code);
      const threshold = thresholdByCode.get(def.code) ?? 5;
      const pending = row?.grants?.[0] ?? null;
      return {
        id: row?.id ?? null,
        capabilityCode: def.code,
        storyId: def.storyId,
        label: def.label,
        ceiling: def.ceiling,
        currentAuthority: row?.currentAuthority ?? DEFAULT_AUTHORITY,
        truthfulState: !row ? 'NOT_CONFIGURED'
          : row.currentAuthority === 'SUSPENDED' ? 'SUSPENDED'
            : row.currentAuthority === 'OBSERVE_ONLY' ? 'OBSERVATION_ONLY'
              : 'RECOMMENDATION_READY',
        irreversible: def.irreversible,
        statutoryAdjacent: def.statutoryAdjacent,
        zeroMutation: def.zeroMutation,
        requiresAdoptionCeremony: def.requiresAdoptionCeremony,
        dualAuthorization: def.dualAuthorization,
        configured: Boolean(row),
        circuitBreakerCount: row?.circuitBreakerCount ?? 0,
        circuitBreakerTripped: (row?.circuitBreakerCount ?? 0) >= threshold,
        pendingGrant: pending
          ? { id: pending.id, toAuthority: pending.toAuthority, grantedBy: pending.grantedBy, grantedAt: pending.grantedAt }
          : null,
        suspendReason: row?.suspendReason ?? null,
        baselineEvidenceRef: row?.baselineEvidenceRef ?? null,
        policyVersion: row?.policyVersion ?? '1.0',
      };
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.automationCapability.findFirst({
      where: { tenantId, id },
      include: { grants: { orderBy: { grantedAt: 'desc' } } },
    });
    if (!row) throw new NotConfiguredError(`Automation capability ${id} is not configured for this tenant.`);
    return row;
  }

  /**
   * Configuring a capability creates it at OBSERVE_ONLY. There is deliberately
   * no way to create one at a higher authority: the ladder must be climbed.
   */
  async create(input: {
    tenantId: string; legalEntityId: string; capabilityCode: string; actor: string;
    baselineEvidenceRef?: string | null;
  }) {
    const def = requireCapabilityDefinition(input.capabilityCode);
    const existing = await this.prisma.automationCapability.findFirst({
      where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, capabilityCode: input.capabilityCode },
    });
    if (existing) return existing;

    const row = await this.prisma.automationCapability.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        capabilityCode: def.code,
        storyId: def.storyId,
        currentAuthority: DEFAULT_AUTHORITY,
        baselineEvidenceRef: input.baselineEvidenceRef ?? null,
        baselineMeasuredAt: input.baselineEvidenceRef ? new Date() : null,
      },
    });
    await this.events.publish(input.tenantId, row.id, 'automation.capability.configured', {
      capabilityCode: def.code, storyId: def.storyId, authority: DEFAULT_AUTHORITY, actor: input.actor,
    });
    return row;
  }

  /**
   * Records a grant. Refused when the target rung is above the capability's
   * ceiling, when it skips rungs, or when the granting identity is automation.
   * The capability's authority is unchanged until somebody activates it.
   */
  async grant(input: {
    tenantId: string; id: string; toAuthority: string; grantedBy: string;
    evidenceRefs?: unknown[];
  }) {
    const capability = await this.get(input.tenantId, input.id);
    const def = requireCapabilityDefinition(capability.capabilityCode);

    if (!isAuthorityLevel(input.toAuthority) || input.toAuthority === 'SUSPENDED') {
      throw new InvalidAuthorityTransitionError(`${input.toAuthority} is not a grantable authority level.`);
    }
    if (isAutomationIdentity(input.grantedBy)) {
      throw new InvalidAuthorityTransitionError('Automation identities may not grant authority.');
    }
    if (authorityRank(input.toAuthority) > authorityRank(def.ceiling)) {
      const why = def.irreversible
        ? 'its effects are irreversible'
        : def.statutoryAdjacent ? 'it is statutory-adjacent'
          : def.requiresAdoptionCeremony ? 'its output requires a human adoption ceremony'
            : 'its declared ceiling forbids it';
      throw new AuthorityCeilingError(
        `${def.label} (${def.storyId}) may never exceed ${def.ceiling} because ${why}. Requested ${input.toAuthority}.`,
        { capabilityCode: def.code, ceiling: def.ceiling, requested: input.toAuthority },
      );
    }

    const currentRank = authorityRank(capability.currentAuthority);
    const targetRank = authorityRank(input.toAuthority);
    if (capability.currentAuthority !== 'SUSPENDED' && targetRank > currentRank + 1) {
      throw new InvalidAuthorityTransitionError(
        `Authority is climbed one rung at a time: ${capability.currentAuthority} → ${AUTHORITY_LADDER[currentRank + 1]} before ${input.toAuthority}.`,
        { from: capability.currentAuthority, requested: input.toAuthority },
      );
    }

    // Promotion beyond observation needs an accepted conversion baseline.
    if (targetRank > authorityRank('OBSERVE_ONLY')) {
      const hasBaseline = await this.baseline.hasApprovedBaseline(input.tenantId, capability.legalEntityId);
      if (!hasBaseline && !capability.baselineEvidenceRef) {
        throw new InvalidAuthorityTransitionError(
          'Promotion above OBSERVE_ONLY requires baseline evidence: either a reconciled CE-16 migration run or a recorded baseline reference.',
          { capabilityCode: def.code, legalEntityId: capability.legalEntityId },
        );
      }
    }

    const grant = await this.prisma.automationGrant.create({
      data: {
        tenantId: input.tenantId,
        capabilityId: capability.id,
        fromAuthority: capability.currentAuthority,
        toAuthority: input.toAuthority,
        grantedBy: input.grantedBy,
        evidenceRefs: (input.evidenceRefs ?? []) as any,
        policyVersion: capability.policyVersion,
      },
    });
    await this.prisma.automationCapability.updateMany({
      where: { tenantId: input.tenantId, id: capability.id },
      data: { authorityGrantedBy: input.grantedBy, authorityGrantedAt: new Date() },
    });
    await this.events.publish(input.tenantId, capability.id, 'automation.authority.granted', {
      capabilityCode: capability.capabilityCode, from: capability.currentAuthority, to: input.toAuthority, grantedBy: input.grantedBy,
    });
    return { grant, capability: await this.get(input.tenantId, input.id) };
  }

  /** Activates a pending grant. Structurally refused for the granting identity. */
  async activateGrant(input: { tenantId: string; id: string; grantId?: string; activatedBy: string }) {
    const capability = await this.get(input.tenantId, input.id);
    const grant = input.grantId
      ? await this.prisma.automationGrant.findFirst({ where: { tenantId: input.tenantId, id: input.grantId, capabilityId: capability.id } })
      : await this.prisma.automationGrant.findFirst({
        where: { tenantId: input.tenantId, capabilityId: capability.id, revoked: false, activatedAt: null },
        orderBy: { grantedAt: 'desc' },
      });
    if (!grant) throw new NotConfiguredError('There is no pending authority grant to activate for this capability.');
    if (grant.activatedAt) {
      throw new InvalidAuthorityTransitionError('That grant has already been activated.');
    }
    assertGrantSoD(grant.grantedBy, input.activatedBy, capability.capabilityCode);

    await this.prisma.automationGrant.updateMany({
      where: { tenantId: input.tenantId, id: grant.id },
      data: { activatedBy: input.activatedBy, activatedAt: new Date() },
    });
    await this.prisma.automationCapability.updateMany({
      where: { tenantId: input.tenantId, id: capability.id },
      data: {
        currentAuthority: grant.toAuthority,
        authorityActivatedBy: input.activatedBy,
        authorityActivatedAt: new Date(),
        suspendedAt: null, suspendedBy: null, suspendReason: null,
        // The two-person re-grant *is* the review the circuit breaker demands.
        // Leaving the count standing would strand the capability: it would
        // hold authority the gate refuses to honour, and no screen could
        // explain why nothing runs.
        circuitBreakerCount: 0, circuitBreakerSuspendedAt: null,
        version: { increment: 1 },
      },
    });
    await this.events.publish(input.tenantId, capability.id, 'automation.authority.activated', {
      capabilityCode: capability.capabilityCode, to: grant.toAuthority, grantedBy: grant.grantedBy, activatedBy: input.activatedBy,
    });
    return this.get(input.tenantId, input.id);
  }

  /** Suspension is immediate and needs no second signature — stopping is safe. */
  async suspend(input: { tenantId: string; id: string; actor: string; reason: string }) {
    const capability = await this.get(input.tenantId, input.id);
    await this.prisma.automationCapability.updateMany({
      where: { tenantId: input.tenantId, id: capability.id },
      data: {
        currentAuthority: 'SUSPENDED', suspendedBy: input.actor, suspendedAt: new Date(),
        suspendReason: input.reason, version: { increment: 1 },
      },
    });
    await this.prisma.automationItem.updateMany({
      where: {
        tenantId: input.tenantId, capabilityId: capability.id,
        state: { in: ['RECOMMENDATION_READY', 'APPROVAL_REQUIRED', 'EXECUTION_PENDING'] },
      },
      data: { state: 'SUSPENDED' },
    });
    await this.events.publish(input.tenantId, capability.id, 'automation.capability.suspended', {
      capabilityCode: capability.capabilityCode, actor: input.actor, reason: input.reason,
    });
    return this.get(input.tenantId, input.id);
  }

  /**
   * Emergency stop suspends every configured capability for the entity at
   * once. In an incident nobody should have to click fourteen times.
   */
  async emergencyStop(input: { tenantId: string; legalEntityId: string; actor: string; reason: string }) {
    const rows = await this.prisma.automationCapability.findMany({
      where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId },
    });
    const now = new Date();
    await this.prisma.automationCapability.updateMany({
      where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId },
      data: {
        currentAuthority: 'SUSPENDED', suspendedBy: input.actor, suspendedAt: now,
        suspendReason: `EMERGENCY STOP: ${input.reason}`, version: { increment: 1 },
      },
    });
    await this.prisma.automationItem.updateMany({
      where: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId,
        state: { in: ['RECOMMENDATION_READY', 'APPROVAL_REQUIRED', 'EXECUTION_PENDING'] },
      },
      data: { state: 'SUSPENDED' },
    });
    await this.events.publish(input.tenantId, input.legalEntityId, 'automation.emergency_stop', {
      legalEntityId: input.legalEntityId, capabilitiesSuspended: rows.length, actor: input.actor, reason: input.reason,
    });
    return {
      stoppedAt: now.toISOString(),
      capabilitiesSuspended: rows.map((r) => r.capabilityCode),
      actor: input.actor,
      reason: input.reason,
    };
  }

  /**
   * Circuit breaker. Consecutive failures accumulate; reaching the configured
   * threshold suspends the capability outright rather than letting it keep
   * failing in a loop and burning through a queue.
   */
  async recordFailure(tenantId: string, capabilityId: string): Promise<{ tripped: boolean; count: number }> {
    const capability = await this.prisma.automationCapability.findFirst({ where: { tenantId, id: capabilityId } });
    if (!capability) return { tripped: false, count: 0 };

    const gate = await this.prisma.policyGate.findFirst({
      where: { tenantId, legalEntityId: capability.legalEntityId, capabilityCode: capability.capabilityCode, NOT: { activatedBy: null } },
      orderBy: { effectiveDate: 'desc' },
    });
    const threshold = gate?.circuitBreakerThreshold ?? 5;
    const count = capability.circuitBreakerCount + 1;
    const tripped = count >= threshold;

    await this.prisma.automationCapability.updateMany({
      where: { tenantId, id: capabilityId },
      data: {
        circuitBreakerCount: count,
        ...(tripped
          ? {
            currentAuthority: 'SUSPENDED',
            circuitBreakerSuspendedAt: new Date(),
            suspendedBy: 'system:circuit-breaker',
            suspendedAt: new Date(),
            suspendReason: `Circuit breaker: ${count} consecutive failures reached the threshold of ${threshold}.`,
          }
          : {}),
      },
    });
    if (tripped) {
      await this.events.publish(tenantId, capabilityId, 'automation.circuit_breaker.tripped', {
        capabilityCode: capability.capabilityCode, failures: count, threshold,
      });
    }
    return { tripped, count };
  }

  async recordSuccess(tenantId: string, capabilityId: string): Promise<void> {
    await this.prisma.automationCapability.updateMany({
      where: { tenantId, id: capabilityId, circuitBreakerCount: { gt: 0 } },
      data: { circuitBreakerCount: 0 },
    });
  }

  /**
   * Resolves the capability row for an action, creating nothing implicitly.
   * A capability that was never configured refuses rather than springing into
   * existence at the moment somebody tries to use it.
   */
  async requireConfigured(tenantId: string, legalEntityId: string, capabilityCode: string) {
    const row = await this.prisma.automationCapability.findFirst({
      where: { tenantId, legalEntityId, capabilityCode },
    });
    if (!row) {
      throw new NotConfiguredError(
        `${capabilityCode} is not configured for legal entity ${legalEntityId}. Configure it — it will start at OBSERVE_ONLY.`,
        { capabilityCode, legalEntityId },
      );
    }
    return row;
  }

  /** Guards the write paths that require a specific minimum authority. */
  assertAuthorityAtLeast(capability: { capabilityCode: string; currentAuthority: string }, required: AuthorityLevel): void {
    if (capability.currentAuthority === 'SUSPENDED') {
      throw new AutomationError(`${capability.capabilityCode} is SUSPENDED and may not act.`, {
        statusCode: 423, code: 'CAPABILITY_SUSPENDED', truthfulState: 'SUSPENDED',
      });
    }
    if (authorityRank(capability.currentAuthority) < authorityRank(required)) {
      throw new AutomationError(
        `${capability.capabilityCode} holds ${capability.currentAuthority}; this action requires at least ${required}.`,
        { statusCode: 403, code: 'INSUFFICIENT_AUTHORITY', truthfulState: 'OBSERVATION_ONLY' },
      );
    }
  }
}
