import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/migration-service-client';
import { IMigrationRunRepository, MigrationRunRecord } from '../domain/interfaces';
import { MigrationState } from '../domain/migration-state-machine';

@injectable()
export class PrismaMigrationRunRepository implements IMigrationRunRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async create(input: {
    tenantId: string;
    legalEntityId: string;
    runId: string;
    mode: string;
    transformationVersion: string;
    sourceSnapshotRef?: string | null;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<MigrationRunRecord> {
    return (await this.prisma.migrationRun.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        runId: input.runId,
        mode: input.mode,
        state: MigrationState.DISCOVERED,
        transformationVersion: input.transformationVersion,
        sourceSnapshotRef: input.sourceSnapshotRef ?? null,
        createdBy: input.createdBy,
        metadata: (input.metadata ?? {}) as any,
      },
    })) as unknown as MigrationRunRecord;
  }

  async findByRunId(tenantId: string, runId: string): Promise<MigrationRunRecord | null> {
    return (await this.prisma.migrationRun.findFirst({ where: { tenantId, runId } })) as unknown as MigrationRunRecord | null;
  }

  async list(tenantId: string, filters: { legalEntityId?: string; state?: string; mode?: string }): Promise<MigrationRunRecord[]> {
    return (await this.prisma.migrationRun.findMany({
      where: {
        tenantId,
        ...(filters.legalEntityId ? { legalEntityId: filters.legalEntityId } : {}),
        ...(filters.state ? { state: filters.state } : {}),
        ...(filters.mode ? { mode: filters.mode } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })) as unknown as MigrationRunRecord[];
  }

  async updateState(tenantId: string, runId: string, state: MigrationState, patch: Record<string, unknown> = {}): Promise<MigrationRunRecord> {
    const result = await this.prisma.migrationRun.updateMany({
      where: { tenantId, runId },
      data: { state, ...(patch as any) },
    });
    if (result.count === 0) {
      const err: any = new Error(`Migration run ${runId} not found for tenant`);
      err.statusCode = 404;
      throw err;
    }
    return (await this.findByRunId(tenantId, runId)) as MigrationRunRecord;
  }

  async patch(tenantId: string, runId: string, patch: Record<string, unknown>): Promise<MigrationRunRecord> {
    await this.prisma.migrationRun.updateMany({ where: { tenantId, runId }, data: patch as any });
    return (await this.findByRunId(tenantId, runId)) as MigrationRunRecord;
  }

  async appendAudit(input: {
    tenantId: string;
    runId: string;
    action: string;
    actor: string;
    fromState?: string | null;
    toState?: string | null;
    reason?: string | null;
    evidence?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.migrationRunAudit.create({
      data: {
        tenantId: input.tenantId,
        runId: input.runId,
        action: input.action,
        actor: input.actor,
        fromState: input.fromState ?? null,
        toState: input.toState ?? null,
        reason: input.reason ?? null,
        evidence: (input.evidence ?? {}) as any,
      },
    });
  }

  async listAudit(tenantId: string, runId: string): Promise<unknown[]> {
    return this.prisma.migrationRunAudit.findMany({ where: { tenantId, runId }, orderBy: { createdAt: 'asc' } });
  }
}
