import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/migration-service-client';
import { ICutoverRepository, IArchiveRepository, IRunbookRepository } from '../domain/interfaces';

@injectable()
export class PrismaCutoverRepository implements ICutoverRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async upsert(input: Record<string, unknown>) {
    const tenantId = input['tenantId'] as string;
    const runId = input['runId'] as string;
    const existing = await this.find(tenantId, runId);
    if (existing) {
      await this.prisma.cutoverCeremony.update({ where: { id: existing.id }, data: input as any });
      return this.find(tenantId, runId);
    }
    return this.prisma.cutoverCeremony.create({ data: input as any });
  }

  find(tenantId: string, runId: string) {
    return this.prisma.cutoverCeremony.findFirst({ where: { tenantId, runId } });
  }

  async update(tenantId: string, runId: string, patch: Record<string, unknown>) {
    await this.prisma.cutoverCeremony.updateMany({ where: { tenantId, runId }, data: patch as any });
    return this.find(tenantId, runId);
  }

  async claim(tenantId: string, runId: string, fromState: string, toState: string, patch: Record<string, unknown> = {}) {
    const result = await this.prisma.cutoverCeremony.updateMany({
      where: { tenantId, runId, state: fromState },
      data: { ...patch, state: toState } as any,
    });
    return result.count === 1;
  }
}

@injectable()
export class PrismaArchiveRepository implements IArchiveRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  create(input: {
    tenantId: string; legalEntityId: string; periodYear: number; periodMonth: number; statementType: string;
    sourceSystem: string; filename: string; fileSize: number; checksumSha256: string; importedBy: string;
    wormClass: string; retentionUntil: Date | null; metadata?: Record<string, unknown>;
  }) {
    return this.prisma.archiveStatement.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        statementType: input.statementType,
        sourceSystem: input.sourceSystem,
        filename: input.filename,
        fileSize: input.fileSize,
        checksumSha256: input.checksumSha256,
        importedBy: input.importedBy,
        wormClass: input.wormClass,
        retentionUntil: input.retentionUntil,
        metadata: (input.metadata ?? {}) as any,
      },
    });
  }

  findByChecksum(tenantId: string, checksum: string) {
    return this.prisma.archiveStatement.findFirst({ where: { tenantId, checksumSha256: checksum } });
  }

  list(tenantId: string, filters: {
    legalEntityId?: string; periodYear?: number; periodMonth?: number; statementType?: string; search?: string;
  }) {
    return this.prisma.archiveStatement.findMany({
      where: {
        tenantId,
        ...(filters.legalEntityId ? { legalEntityId: filters.legalEntityId } : {}),
        ...(filters.periodYear ? { periodYear: filters.periodYear } : {}),
        ...(filters.periodMonth ? { periodMonth: filters.periodMonth } : {}),
        ...(filters.statementType ? { statementType: filters.statementType } : {}),
        ...(filters.search ? { filename: { contains: filters.search, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { statementType: 'asc' }],
    });
  }

  /**
   * Archived artifacts are immutable. The only mutation permitted is the
   * access counter, which is itself audit evidence of who looked at what.
   */
  async recordAccess(tenantId: string, id: string) {
    await this.prisma.archiveStatement.updateMany({
      where: { tenantId, id },
      data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
    });
    return this.prisma.archiveStatement.findFirst({ where: { tenantId, id } });
  }
}

@injectable()
export class PrismaRunbookRepository implements IRunbookRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  listTemplates(tenantId: string) {
    return this.prisma.runbookTemplate.findMany({ where: { tenantId }, orderBy: [{ name: 'asc' }, { version: 'desc' }] });
  }

  createTemplate(input: { tenantId: string; name: string; version: number; steps: unknown; createdBy: string }) {
    return this.prisma.runbookTemplate.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        version: input.version,
        steps: input.steps as any,
        createdBy: input.createdBy,
      },
    });
  }

  findTemplate(tenantId: string, id: string) {
    return this.prisma.runbookTemplate.findFirst({ where: { tenantId, id } });
  }

  listInstances(tenantId: string, runId?: string) {
    return this.prisma.runbookInstance.findMany({
      where: { tenantId, ...(runId ? { runId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  createInstance(input: {
    tenantId: string; legalEntityId: string; templateId: string; runId: string; steps: unknown; createdBy: string;
  }) {
    return this.prisma.runbookInstance.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        templateId: input.templateId,
        runId: input.runId,
        steps: input.steps as any,
        createdBy: input.createdBy,
      },
    });
  }

  findInstance(tenantId: string, id: string) {
    return this.prisma.runbookInstance.findFirst({ where: { tenantId, id } });
  }

  async updateInstance(tenantId: string, id: string, patch: Record<string, unknown>) {
    await this.prisma.runbookInstance.updateMany({ where: { tenantId, id }, data: patch as any });
    return this.findInstance(tenantId, id);
  }
}
