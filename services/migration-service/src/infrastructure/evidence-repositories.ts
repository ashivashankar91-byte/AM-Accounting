import { computeExceptionDedupeKey } from '../domain/exception-identity';
import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/migration-service-client';
import {
  IExceptionRepository, IGateRepository, IControlTotalRepository, ILineageRepository,
} from '../domain/interfaces';
import { GateEvaluation } from '../domain/gate-evaluator';
import { ControlTotalSnapshot } from '../domain/control-total-calculator';

@injectable()
export class PrismaExceptionRepository implements IExceptionRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async create(input: {
    tenantId: string; legalEntityId: string; runId: string; exceptionType: string; reason: string;
    sourceRowId?: string | null; stagingRowId?: string | null; sourceField?: string | null;
    sourceValue?: string | null; blocking?: boolean; evidence?: Record<string, unknown>;
  }[]): Promise<number> {
    if (input.length === 0) return 0;
    const result = await this.prisma.exceptionQueueItem.createMany({
      data: input.map((e) => ({
        tenantId: e.tenantId,
        legalEntityId: e.legalEntityId,
        runId: e.runId,
        sourceRowId: e.sourceRowId ?? null,
        stagingRowId: e.stagingRowId ?? null,
        exceptionType: e.exceptionType,
        sourceField: e.sourceField ?? null,
        sourceValue: e.sourceValue ?? null,
        reason: e.reason,
        blocking: e.blocking ?? true,
        evidence: (e.evidence ?? {}) as any,
        dedupeKey: computeExceptionDedupeKey(e),
      })),
      // A replayed extraction rediscovers the same defects; it must not
      // enqueue them again.
      skipDuplicates: true,
    });
    return result.count;
  }

  list(tenantId: string, runId: string, filters: { disposition?: string; exceptionType?: string } = {}) {
    return this.prisma.exceptionQueueItem.findMany({
      where: {
        tenantId,
        runId,
        ...(filters.disposition ? { disposition: filters.disposition } : {}),
        ...(filters.exceptionType ? { exceptionType: filters.exceptionType } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  find(tenantId: string, id: string) {
    return this.prisma.exceptionQueueItem.findFirst({ where: { tenantId, id } });
  }

  async disposition(tenantId: string, id: string, patch: { disposition: string; dispositionedBy: string; dispositionReason: string }) {
    await this.prisma.exceptionQueueItem.updateMany({
      where: { tenantId, id },
      data: {
        disposition: patch.disposition,
        dispositionedBy: patch.dispositionedBy,
        dispositionedAt: new Date(),
        dispositionReason: patch.dispositionReason,
      },
    });
    return this.find(tenantId, id);
  }

  countBlockingPending(tenantId: string, runId: string): Promise<number> {
    return this.prisma.exceptionQueueItem.count({ where: { tenantId, runId, blocking: true, disposition: 'PENDING' } });
  }
}

@injectable()
export class PrismaGateRepository implements IGateRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async record(tenantId: string, runId: string, stagingDatasetId: string | null, evaluations: GateEvaluation[], evaluatedBy: string): Promise<number> {
    if (evaluations.length === 0) return 0;
    const result = await this.prisma.gateResult.createMany({
      data: evaluations.map((e) => ({
        tenantId,
        runId,
        stagingDatasetId,
        gateCode: e.gateCode,
        result: e.result,
        details: e.details as any,
        evaluatedBy,
      })),
    });
    return result.count;
  }

  list(tenantId: string, runId: string) {
    return this.prisma.gateResult.findMany({ where: { tenantId, runId }, orderBy: { evaluatedAt: 'desc' } });
  }
}

@injectable()
export class PrismaControlTotalRepository implements IControlTotalRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  capture(tenantId: string, runId: string, stagingDatasetId: string | null, snapshot: ControlTotalSnapshot) {
    return this.prisma.controlTotal.create({
      data: {
        tenantId,
        runId,
        stagingDatasetId,
        phase: snapshot.phase,
        rowCount: snapshot.rowCount,
        acceptedCount: snapshot.acceptedCount,
        rejectedCount: snapshot.rejectedCount,
        totalDebit: snapshot.totalDebit,
        totalCredit: snapshot.totalCredit,
        openItemTotal: snapshot.openItemTotal,
        scheduleBalance: snapshot.scheduleBalance,
        documentCount: snapshot.documentCount,
        exceptionCount: snapshot.exceptionCount,
        duplicateCount: snapshot.duplicateCount,
      },
    });
  }

  list(tenantId: string, runId: string) {
    return this.prisma.controlTotal.findMany({ where: { tenantId, runId }, orderBy: { capturedAt: 'asc' } });
  }
}

@injectable()
export class PrismaLineageRepository implements ILineageRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async record(entries: {
    tenantId: string; runId: string; sourceSystemRef?: string | null; sourceFileRef?: string | null;
    sourceRowRef?: string | null; stagingRecordId?: string | null; mappingDecisionRef?: string | null;
    transformationVersion?: string | null; targetRecordId?: string | null; targetRecordType?: string | null;
    postingExecutionRef?: string | null; journalRef?: string | null; openItemRef?: string | null;
    reconciliationRef?: string | null; evidence?: Record<string, unknown>;
  }[]): Promise<number> {
    if (entries.length === 0) return 0;
    const result = await this.prisma.migrationLineage.createMany({
      data: entries.map((e) => ({
        tenantId: e.tenantId,
        runId: e.runId,
        sourceSystemRef: e.sourceSystemRef ?? null,
        sourceFileRef: e.sourceFileRef ?? null,
        sourceRowRef: e.sourceRowRef ?? null,
        stagingRecordId: e.stagingRecordId ?? null,
        mappingDecisionRef: e.mappingDecisionRef ?? null,
        transformationVersion: e.transformationVersion ?? null,
        targetRecordId: e.targetRecordId ?? null,
        targetRecordType: e.targetRecordType ?? null,
        postingExecutionRef: e.postingExecutionRef ?? null,
        journalRef: e.journalRef ?? null,
        openItemRef: e.openItemRef ?? null,
        reconciliationRef: e.reconciliationRef ?? null,
        evidence: (e.evidence ?? {}) as any,
      })),
      // A restarted staging pass re-derives the same rows; their lineage is
      // already open and must not be duplicated.
      skipDuplicates: true,
    });
    return result.count;
  }

  async attach(entries: {
    tenantId: string; runId: string; stagingRecordId: string; targetRecordId?: string | null;
    targetRecordType?: string | null; postingExecutionRef?: string | null; journalRef?: string | null;
    openItemRef?: string | null; reconciliationRef?: string | null; evidence?: Record<string, unknown>;
  }[]): Promise<number> {
    let updated = 0;
    for (const entry of entries) {
      const existing = await this.prisma.migrationLineage.findFirst({
        where: { tenantId: entry.tenantId, runId: entry.runId, stagingRecordId: entry.stagingRecordId },
      });
      if (!existing) continue;
      await this.prisma.migrationLineage.update({
        where: { id: existing.id },
        data: {
          targetRecordId: entry.targetRecordId ?? existing.targetRecordId,
          targetRecordType: entry.targetRecordType ?? existing.targetRecordType,
          postingExecutionRef: entry.postingExecutionRef ?? existing.postingExecutionRef,
          journalRef: entry.journalRef ?? existing.journalRef,
          openItemRef: entry.openItemRef ?? existing.openItemRef,
          reconciliationRef: entry.reconciliationRef ?? existing.reconciliationRef,
          evidence: { ...(existing.evidence as Record<string, unknown>), ...(entry.evidence ?? {}) } as any,
        },
      });
      updated += 1;
    }
    return updated;
  }

  list(tenantId: string, runId: string, filters: { sourceRowRef?: string; journalRef?: string } = {}) {
    return this.prisma.migrationLineage.findMany({
      where: {
        tenantId,
        runId,
        ...(filters.sourceRowRef ? { sourceRowRef: filters.sourceRowRef } : {}),
        ...(filters.journalRef ? { journalRef: filters.journalRef } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
