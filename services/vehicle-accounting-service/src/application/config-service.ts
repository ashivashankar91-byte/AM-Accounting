// SAFE_CONFIGURATION registries — S074 pack policy, S075 demo depreciation
// basis, S076 LCNRV write-down refusal threshold. All entered by an
// authorized configurator, never invented/estimated by this service's own
// logic (CE-12 package: "no rule invents accounting").
import { randomUUID } from 'crypto';
import { inject, injectable } from 'tsyringe';
import { PrismaClient, Prisma } from '.prisma/vehicle-accounting-client';
import { VehicleAccountingInputError } from './errors';
import { auditOutboxEvent } from '../infrastructure/audit';

@injectable()
export class VehicleAccountingConfigService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async upsertPackPolicy(tenantId: string, actor: string, input: { entityId: string; packRole: 'PACK_INCOME' | 'HOLDBACK_CLEARING'; packBasis: 'FLAT' | 'PERCENT_OF_INVOICE'; packAmount?: string; packPercentBp?: number }) {
    if (!input.entityId?.trim()) throw new VehicleAccountingInputError('entityId is required.');
    if (input.packBasis === 'FLAT' && !input.packAmount) throw new VehicleAccountingInputError('packAmount is required when packBasis is FLAT.');
    if (input.packBasis === 'PERCENT_OF_INVOICE' && !input.packPercentBp) throw new VehicleAccountingInputError('packPercentBp is required when packBasis is PERCENT_OF_INVOICE.');

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.vehiclePackPolicyConfig.upsert({
        where: { tenantId_entityId: { tenantId, entityId: input.entityId } },
        create: {
          id: randomUUID(), tenantId, entityId: input.entityId, packRole: input.packRole, packBasis: input.packBasis,
          packAmount: input.packAmount ? new Prisma.Decimal(input.packAmount) : null, packPercentBp: input.packPercentBp ?? null, updatedBy: actor,
        },
        update: { packRole: input.packRole, packBasis: input.packBasis, packAmount: input.packAmount ? new Prisma.Decimal(input.packAmount) : null, packPercentBp: input.packPercentBp ?? null, updatedBy: actor },
      });
      await auditOutboxEvent(tx as any, { tenantId, docType: 'VEHICLE_PACK_POLICY_CONFIG', docId: row.id, actor, action: 'CONFIG_UPSERTED', after: row });
      return row;
    });
  }

  async getPackPolicy(tenantId: string, entityId: string) {
    return this.prisma.vehiclePackPolicyConfig.findUnique({ where: { tenantId_entityId: { tenantId, entityId } } });
  }

  async upsertDemoDepreciationBasis(tenantId: string, actor: string, input: { entityId: string; percentPerPeriodBp: number; periodLengthDays?: number }) {
    if (!input.entityId?.trim()) throw new VehicleAccountingInputError('entityId is required.');
    if (!Number.isInteger(input.percentPerPeriodBp) || input.percentPerPeriodBp <= 0) throw new VehicleAccountingInputError('percentPerPeriodBp must be a positive integer (basis points).');

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.demoDepreciationBasisConfig.upsert({
        where: { tenantId_entityId: { tenantId, entityId: input.entityId } },
        create: { id: randomUUID(), tenantId, entityId: input.entityId, percentPerPeriodBp: input.percentPerPeriodBp, periodLengthDays: input.periodLengthDays ?? 30, updatedBy: actor },
        update: { percentPerPeriodBp: input.percentPerPeriodBp, periodLengthDays: input.periodLengthDays ?? 30, updatedBy: actor },
      });
      await auditOutboxEvent(tx as any, { tenantId, docType: 'DEMO_DEPRECIATION_BASIS_CONFIG', docId: row.id, actor, action: 'CONFIG_UPSERTED', after: row });
      return row;
    });
  }

  async getDemoDepreciationBasis(tenantId: string, entityId: string) {
    return this.prisma.demoDepreciationBasisConfig.findUnique({ where: { tenantId_entityId: { tenantId, entityId } } });
  }

  async upsertLcnrvThreshold(tenantId: string, actor: string, input: { entityId: string; maxWriteDownAmount: string }) {
    if (!input.entityId?.trim()) throw new VehicleAccountingInputError('entityId is required.');
    if (!input.maxWriteDownAmount) throw new VehicleAccountingInputError('maxWriteDownAmount is required.');

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.lcnrvThresholdConfig.upsert({
        where: { tenantId_entityId: { tenantId, entityId: input.entityId } },
        create: { id: randomUUID(), tenantId, entityId: input.entityId, maxWriteDownAmount: new Prisma.Decimal(input.maxWriteDownAmount), updatedBy: actor },
        update: { maxWriteDownAmount: new Prisma.Decimal(input.maxWriteDownAmount), updatedBy: actor },
      });
      await auditOutboxEvent(tx as any, { tenantId, docType: 'LCNRV_THRESHOLD_CONFIG', docId: row.id, actor, action: 'CONFIG_UPSERTED', after: row });
      return row;
    });
  }

  async getLcnrvThreshold(tenantId: string, entityId: string) {
    return this.prisma.lcnrvThresholdConfig.findUnique({ where: { tenantId_entityId: { tenantId, entityId } } });
  }
}
