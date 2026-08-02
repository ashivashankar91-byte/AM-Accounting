// SAFE_CONFIGURATION — S081 SOT grace-period threshold, S082 default
// interest allocation basis. Tenant-editable, never a code default that
// silently governs financial outcomes without an audit trail.
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import { appendAuditReference } from '../infrastructure/audit';
import { FloorplanValidationError } from '../domain/errors';

export const ALLOCATION_BASES = ['PER_UNIT_EQUAL', 'PER_UNIT_BALANCE_WEIGHTED'] as const;
export type AllocationBasis = (typeof ALLOCATION_BASES)[number];

@injectable()
export class TenantConfigService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async get(tenantId: string) {
    const existing = await this.prisma.floorplanTenantConfig.findUnique({ where: { tenantId } });
    if (existing) return existing;
    // Truthful default, not silently materialized as a DB row until an
    // operator actually saves a change — returned as a shape-compatible
    // in-memory default so GET always succeeds even on a fresh tenant.
    return { tenantId, sotGracePeriodDays: 3, defaultAllocationBasis: 'PER_UNIT_EQUAL', updatedBy: null, updatedAt: null };
  }

  async update(tenantId: string, input: { sotGracePeriodDays?: number; defaultAllocationBasis?: AllocationBasis }, actor: string) {
    if (input.sotGracePeriodDays !== undefined && (!Number.isInteger(input.sotGracePeriodDays) || input.sotGracePeriodDays < 0)) {
      throw new FloorplanValidationError('sotGracePeriodDays must be a non-negative integer.');
    }
    if (input.defaultAllocationBasis !== undefined && !ALLOCATION_BASES.includes(input.defaultAllocationBasis)) {
      throw new FloorplanValidationError(`Invalid defaultAllocationBasis: ${input.defaultAllocationBasis}`);
    }
    const before = await this.prisma.floorplanTenantConfig.findUnique({ where: { tenantId } });
    const updated = await this.prisma.floorplanTenantConfig.upsert({
      where: { tenantId },
      create: {
        id: randomUUID(),
        tenantId,
        sotGracePeriodDays: input.sotGracePeriodDays ?? 3,
        defaultAllocationBasis: input.defaultAllocationBasis ?? 'PER_UNIT_EQUAL',
        updatedBy: actor,
      },
      update: {
        ...(input.sotGracePeriodDays !== undefined ? { sotGracePeriodDays: input.sotGracePeriodDays } : {}),
        ...(input.defaultAllocationBasis !== undefined ? { defaultAllocationBasis: input.defaultAllocationBasis } : {}),
        updatedBy: actor,
      },
    });
    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'FLOORPLAN_TENANT_CONFIG',
      entityId: updated.id,
      eventType: 'floorplan.tenant_config.updated',
      actor,
      before: before ?? null,
      after: updated,
    });
    return updated;
  }
}
