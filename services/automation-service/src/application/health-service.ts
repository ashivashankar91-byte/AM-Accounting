import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { CAPABILITIES } from '../domain/capabilities';
import { NotConfiguredError } from '../domain/errors';

/**
 * CE-17 — automation health.
 *
 * Health is reported from what happened, not from what was intended. Accuracy
 * is measured against the recorded baseline, and where no baseline was
 * captured the figure is null rather than a flattering default — an
 * unmeasurable capability is reported as unmeasured.
 */
@injectable()
export class AutomationHealthService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async metrics(tenantId: string, legalEntityId: string, capabilityCode?: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await this.prisma.automationHealthMetric.findMany({
      where: {
        tenantId, legalEntityId,
        ...(capabilityCode ? { capabilityCode } : {}),
        periodDate: { gte: since },
      },
      orderBy: [{ capabilityCode: 'asc' }, { periodDate: 'asc' }],
    });

    const capabilities = await this.prisma.automationCapability.findMany({
      where: { tenantId, legalEntityId, ...(capabilityCode ? { capabilityCode } : {}) },
    });
    const byCode = new Map(capabilities.map((c) => [c.capabilityCode, c]));

    const grouped = new Map<string, any>();
    for (const row of rows) {
      const bucket = grouped.get(row.capabilityCode) ?? {
        capabilityCode: row.capabilityCode,
        totalItems: 0, accepted: 0, rejected: 0, executed: 0, failedClosed: 0,
        driftFlagged: false, series: [] as any[],
      };
      bucket.totalItems += row.totalItems;
      bucket.accepted += row.accepted;
      bucket.rejected += row.rejected;
      bucket.executed += row.executed;
      bucket.failedClosed += row.failedClosed;
      bucket.driftFlagged = bucket.driftFlagged || row.driftFlagged;
      bucket.series.push({
        periodDate: row.periodDate.toISOString().slice(0, 10),
        totalItems: row.totalItems, accepted: row.accepted, rejected: row.rejected,
        executed: row.executed, failedClosed: row.failedClosed,
        accuracyVsBaseline: row.accuracyVsBaseline?.toString() ?? null,
      });
      grouped.set(row.capabilityCode, bucket);
    }

    const definitions = capabilityCode
      ? CAPABILITIES.filter((d) => d.code === capabilityCode)
      : CAPABILITIES;

    const items = definitions.map((def) => {
      const bucket = grouped.get(def.code);
      const capability = byCode.get(def.code);
      const decided = (bucket?.accepted ?? 0) + (bucket?.rejected ?? 0);
      return {
        capabilityCode: def.code,
        storyId: def.storyId,
        title: def.label,
        configured: Boolean(capability),
        currentAuthority: capability?.currentAuthority ?? 'NOT_CONFIGURED',
        baselineMeasuredAt: capability?.baselineMeasuredAt?.toISOString() ?? null,
        measurable: Boolean(capability?.baselineEvidenceRef),
        totalItems: bucket?.totalItems ?? 0,
        accepted: bucket?.accepted ?? 0,
        rejected: bucket?.rejected ?? 0,
        executed: bucket?.executed ?? 0,
        failedClosed: bucket?.failedClosed ?? 0,
        acceptanceRate: decided > 0 ? (bucket.accepted / decided).toFixed(4) : null,
        driftFlagged: bucket?.driftFlagged ?? false,
        circuitBreakerCount: capability?.circuitBreakerCount ?? 0,
        suspended: capability?.currentAuthority === 'SUSPENDED',
        series: bucket?.series ?? [],
      };
    });

    return { items, total: items.length, windowDays: days };
  }

  async versions(tenantId: string, capabilityCode?: string) {
    const items = await this.prisma.ruleModelVersion.findMany({
      where: { tenantId, ...(capabilityCode ? { capabilityCode } : {}) },
      orderBy: [{ capabilityCode: 'asc' }, { deployedAt: 'desc' }],
      take: 300,
    });
    return { items, total: items.length };
  }

  async version(tenantId: string, id: string) {
    const version = await this.prisma.ruleModelVersion.findFirst({ where: { tenantId, id } });
    if (!version) throw new NotConfiguredError(`Rule/model version ${id} does not exist for this tenant.`);
    return version;
  }

  async recordVersion(input: {
    tenantId: string; capabilityCode: string; versionTag: string; versionType: 'RULE' | 'MODEL';
    description?: string | null; artifactRef?: string | null;
    trainingWindowStart?: string | null; trainingWindowEnd?: string | null;
    deployedBy: string; metadata?: Record<string, unknown>;
  }) {
    return this.prisma.ruleModelVersion.upsert({
      where: {
        tenantId_capabilityCode_versionTag: {
          tenantId: input.tenantId, capabilityCode: input.capabilityCode, versionTag: input.versionTag,
        },
      },
      create: {
        tenantId: input.tenantId, capabilityCode: input.capabilityCode, versionTag: input.versionTag,
        versionType: input.versionType, description: input.description ?? null,
        trainingWindowStart: input.trainingWindowStart ? new Date(input.trainingWindowStart) : null,
        trainingWindowEnd: input.trainingWindowEnd ? new Date(input.trainingWindowEnd) : null,
        deployedAt: new Date(), deployedBy: input.deployedBy,
        artifactRef: input.artifactRef ?? null, metadata: (input.metadata ?? {}) as any,
      },
      update: {
        description: input.description ?? null,
        artifactRef: input.artifactRef ?? null,
        metadata: (input.metadata ?? {}) as any,
      },
    });
  }

  /**
   * A tenant-wide roll-up for the command centre. Deliberately counts states
   * rather than summing amounts: the command centre answers "what is waiting
   * for me", and a queue depth is honest in a way a headline total is not.
   */
  async overview(tenantId: string, legalEntityId: string) {
    const [capabilities, stateCounts] = await Promise.all([
      this.prisma.automationCapability.findMany({ where: { tenantId, legalEntityId } }),
      this.prisma.automationItem.groupBy({
        by: ['state'],
        where: { tenantId, legalEntityId },
        _count: { _all: true },
      }),
    ]);

    const byState: Record<string, number> = {};
    for (const row of stateCounts as any[]) byState[row.state] = row._count._all;

    const configured = new Map(capabilities.map((c) => [c.capabilityCode, c]));
    return {
      capabilityCount: CAPABILITIES.length,
      configuredCount: capabilities.length,
      observeOnlyCount: capabilities.filter((c) => c.currentAuthority === 'OBSERVE_ONLY').length,
      suspendedCount: capabilities.filter((c) => c.currentAuthority === 'SUSPENDED').length,
      autoCount: capabilities.filter((c) => c.currentAuthority === 'AUTO_EXECUTE_WITHIN_POLICY').length,
      itemsByState: byState,
      approvalQueueDepth: byState['APPROVAL_REQUIRED'] ?? 0,
      failedClosedCount: byState['FAILED_CLOSED'] ?? 0,
      capabilities: CAPABILITIES.map((def) => ({
        capabilityCode: def.code,
        storyId: def.storyId,
        title: def.label,
        ceiling: def.ceiling,
        currentAuthority: configured.get(def.code)?.currentAuthority ?? 'NOT_CONFIGURED',
        configured: configured.has(def.code),
      })),
    };
  }
}
