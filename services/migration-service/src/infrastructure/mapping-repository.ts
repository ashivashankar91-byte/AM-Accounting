import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/migration-service-client';
import { IMappingRepository } from '../domain/interfaces';

@injectable()
export class PrismaMappingRepository implements IMappingRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  createSet(input: { tenantId: string; legalEntityId: string; sourceSystemId: string; version: number; createdBy: string }) {
    return this.prisma.mappingSet.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        sourceSystemId: input.sourceSystemId,
        version: input.version,
        status: 'DRAFT',
        createdBy: input.createdBy,
      },
    });
  }

  findSet(tenantId: string, id: string) {
    return this.prisma.mappingSet.findFirst({ where: { tenantId, id } });
  }

  listSets(tenantId: string, filters: { legalEntityId?: string; sourceSystemId?: string }) {
    return this.prisma.mappingSet.findMany({
      where: {
        tenantId,
        ...(filters.legalEntityId ? { legalEntityId: filters.legalEntityId } : {}),
        ...(filters.sourceSystemId ? { sourceSystemId: filters.sourceSystemId } : {}),
      },
      orderBy: [{ sourceSystemId: 'asc' }, { version: 'desc' }],
    });
  }

  async nextVersion(tenantId: string, legalEntityId: string, sourceSystemId: string): Promise<number> {
    const latest = await this.prisma.mappingSet.findFirst({
      where: { tenantId, legalEntityId, sourceSystemId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  }

  /**
   * Entries are keyed by (mappingSetId, sourceField, sourceValue). A new
   * source value discovered by a later extract is added; an existing decision
   * is only overwritten while the set is still DRAFT (enforced by the
   * application layer, which refuses any write to a FROZEN set).
   */
  async upsertEntries(tenantId: string, mappingSetId: string, entries: {
    sourceField: string; sourceValue: string; targetField?: string | null; targetValue?: string | null;
    classification?: string | null; provenanceNote?: string | null; status?: string; decidedBy?: string | null;
  }[]): Promise<number> {
    let count = 0;
    for (const entry of entries) {
      const status = entry.status ?? (entry.classification ? 'MAPPED' : 'MANUAL_REVIEW_REQUIRED');
      await this.prisma.mappingEntry.upsert({
        where: {
          mappingSetId_sourceField_sourceValue: {
            mappingSetId,
            sourceField: entry.sourceField,
            sourceValue: entry.sourceValue,
          },
        },
        create: {
          tenantId,
          mappingSetId,
          sourceField: entry.sourceField,
          sourceValue: entry.sourceValue,
          targetField: entry.targetField ?? null,
          targetValue: entry.targetValue ?? null,
          classification: entry.classification ?? null,
          provenanceNote: entry.provenanceNote ?? null,
          status,
          decidedBy: entry.decidedBy ?? null,
          decidedAt: entry.classification ? new Date() : null,
        },
        update: {
          targetField: entry.targetField ?? null,
          targetValue: entry.targetValue ?? null,
          classification: entry.classification ?? null,
          provenanceNote: entry.provenanceNote ?? null,
          status,
          decidedBy: entry.decidedBy ?? null,
          decidedAt: entry.classification ? new Date() : null,
        },
      });
      count += 1;
    }
    return count;
  }

  listEntries(tenantId: string, mappingSetId: string) {
    return this.prisma.mappingEntry.findMany({
      where: { tenantId, mappingSetId },
      orderBy: [{ sourceField: 'asc' }, { sourceValue: 'asc' }],
    });
  }

  findEntry(tenantId: string, entryId: string) {
    return this.prisma.mappingEntry.findFirst({ where: { tenantId, id: entryId } });
  }

  async updateEntry(tenantId: string, entryId: string, patch: Record<string, unknown>) {
    await this.prisma.mappingEntry.updateMany({ where: { tenantId, id: entryId }, data: patch as any });
    return this.findEntry(tenantId, entryId);
  }

  async freezeSet(tenantId: string, id: string, frozenBy: string) {
    await this.prisma.mappingSet.updateMany({
      where: { tenantId, id, status: 'DRAFT' },
      data: { status: 'FROZEN', frozenAt: new Date(), frozenBy },
    });
    return this.findSet(tenantId, id);
  }

  async markUsed(tenantId: string, id: string, runId: string) {
    await this.prisma.mappingSet.updateMany({ where: { tenantId, id }, data: { usedByRunId: runId } });
    return this.findSet(tenantId, id);
  }
}
