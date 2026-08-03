// fix(integration) Gap 4 — real payroll audit inquiry.
//
// Aggregates EXISTING persisted evidence — never a new, invented audit
// store: OutboxEvent (the real PAYROLL_BATCH_POSTED/PAYROLL_BATCH_REVERSED
// source events already emitted by payroll-service.ts's postBatch/
// voidBatch, carrying batchId/journalEntryId linkage) and
// PayrollSensitiveReadAudit (the CE-13 read-access audit rows already
// written on every sensitive-detail read). payroll.audit.view now has a
// real enforcement point.
import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/payroll-client';
import { TenantId } from '@amacc/shared-kernel';

export interface AuditQueryFilters {
  legalEntityId?: string;
  batchId?: string;
  employeeId?: string;
  action?: string;
  actor?: string;
  fromDate?: string; // ISO date
  toDate?: string; // ISO date
  limit?: number;
}

export interface AuditEntry {
  id: string;
  kind: 'SOURCE_EVENT' | 'SENSITIVE_READ';
  action: string;
  actor: string | null;
  occurredAt: string;
  batchId: string | null;
  employeeId: string | null;
  /** Journal/posting-execution linkage carried by the source event's own payload — never re-derived or guessed. */
  journalEntryId: string | null;
  reversalOfBatchId: string | null;
  /** The full persisted evidence row — before/after state as originally recorded, not reconstructed. */
  evidence: Record<string, unknown>;
}

@injectable()
export class PayrollAuditService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async query(tenantId: TenantId, filters: AuditQueryFilters): Promise<AuditEntry[]> {
    const limit = Math.min(filters.limit ?? 200, 500);

    const outboxWhere: any = {
      tenantId,
      // fix(integration): payroll-service's own outbox log labels the void/
      // reversal event 'PAYROLL_BATCH_VOIDED' (see payroll-service.ts's
      // voidBatch) — a different label than the CE-07 wire eventType
      // ('PAYROLL_BATCH_REVERSED'/'payroll.batch.reversed.v1'). Both are
      // included so the audit trail is never silently incomplete.
      eventType: { in: ['PAYROLL_BATCH_POSTED', 'PAYROLL_BATCH_REVERSED', 'PAYROLL_BATCH_VOIDED'] },
      ...((filters.fromDate || filters.toDate) && {
        createdAt: {
          ...(filters.fromDate && { gte: new Date(filters.fromDate) }),
          ...(filters.toDate && { lte: new Date(filters.toDate) }),
        },
      }),
    };
    const outboxEvents = await (this.prisma as any).outboxEvent.findMany({
      where: outboxWhere,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const sourceEntries: AuditEntry[] = outboxEvents
      .map((e: any) => {
        const payload = (e.payload ?? {}) as Record<string, unknown>;
        return {
          id: e.id,
          kind: 'SOURCE_EVENT' as const,
          action: e.eventType,
          actor: (payload['actor'] as string) ?? null,
          occurredAt: e.createdAt.toISOString(),
          batchId: (payload['batchId'] as string) ?? null,
          employeeId: null,
          journalEntryId: (payload['journalEntryId'] as string) ?? null,
          reversalOfBatchId: (payload['reversalOfBatchId'] as string) ?? null,
          evidence: payload,
        };
      })
      .filter((entry: AuditEntry) => (!filters.batchId || entry.batchId === filters.batchId) && (!filters.action || entry.action === filters.action));

    const readWhere: any = {
      tenantId,
      ...(filters.employeeId && { employeeId: filters.employeeId }),
      ...(filters.legalEntityId && { legalEntityId: filters.legalEntityId }),
      ...(filters.actor && { readByUserId: filters.actor }),
      ...((filters.fromDate || filters.toDate) && {
        readAt: {
          ...(filters.fromDate && { gte: new Date(filters.fromDate) }),
          ...(filters.toDate && { lte: new Date(filters.toDate) }),
        },
      }),
    };
    const reads = await (this.prisma as any).payrollSensitiveReadAudit.findMany({
      where: readWhere,
      orderBy: { readAt: 'desc' },
      take: limit,
    });
    const readEntries: AuditEntry[] = reads.map((r: any) => ({
      id: r.id,
      kind: 'SENSITIVE_READ' as const,
      action: `READ:${r.surface}`,
      actor: r.readByUserId,
      occurredAt: r.readAt.toISOString(),
      batchId: null,
      employeeId: r.employeeId,
      journalEntryId: null,
      reversalOfBatchId: null,
      evidence: r,
    }));

    const filteredByActor = filters.actor ? sourceEntries.filter((e) => e.actor === filters.actor) : sourceEntries;
    const filteredByEmployee = filters.employeeId ? filteredByActor.filter(() => false) : filteredByActor; // source events carry no employeeId directly (batch-level), never guessed

    return [...filteredByEmployee, ...readEntries]
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      .slice(0, limit);
  }
}
