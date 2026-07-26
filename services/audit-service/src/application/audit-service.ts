import { PrismaClient, Prisma } from '.prisma/audit-client';
import pino from 'pino';

const logger = pino({ name: 'audit-service' });

export interface CreateAuditLogDTO {
  tenantId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string;
  actorName: string;
  action: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  reason?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  ipAddress?: string;
  sessionId?: string;
  /** Source outbox row id (AuditOutboxDrainer). Enables idempotent retry:
   * a duplicate delivery of the same outbox row is a no-op, not a new row. */
  sourceEventId?: string;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async log(dto: CreateAuditLogDTO): Promise<{ id: string; idempotent: boolean }> {
    try {
      const record = await this.prisma.auditLog.create({
        data: {
          tenantId: dto.tenantId,
          eventType: dto.eventType,
          entityType: dto.entityType,
          entityId: dto.entityId,
          actorType: dto.actorType,
          actorId: dto.actorId,
          actorName: dto.actorName,
          action: dto.action,
          previousState: (dto.previousState as Prisma.InputJsonValue) ?? undefined,
          newState: (dto.newState as Prisma.InputJsonValue) ?? undefined,
          reason: dto.reason,
          confidence: dto.confidence,
          metadata: (dto.metadata as Prisma.InputJsonValue) ?? undefined,
          occurredAt: dto.occurredAt ?? new Date(),
          ipAddress: dto.ipAddress,
          sessionId: dto.sessionId,
          sourceEventId: dto.sourceEventId,
        },
      });
      logger.info({ auditId: record.id, eventType: dto.eventType }, 'Audit log created');
      return { id: record.id, idempotent: false };
    } catch (err: any) {
      // Append-only table (immutable trigger blocks UPDATE/DELETE) — a
      // duplicate sourceEventId can never be "fixed up" by updating the
      // existing row. Retried/duplicate delivery of the same outbox row is
      // therefore idempotent by treating the unique-violation as success.
      if (dto.sourceEventId && err?.code === UNIQUE_CONSTRAINT_VIOLATION) {
        const existing = await this.prisma.auditLog.findUnique({ where: { sourceEventId: dto.sourceEventId } });
        if (existing) {
          logger.info({ auditId: existing.id, sourceEventId: dto.sourceEventId }, 'Audit log delivery already recorded (idempotent)');
          return { id: existing.id, idempotent: true };
        }
      }
      throw err;
    }
  }

  async getByEntity(entityType: string, entityId: string, tenantId?: string) {
    const where: any = { entityType, entityId };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  async getByActor(actorId: string, tenantId?: string) {
    const where: any = { actorId };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  async getByPeriod(from: string, to: string, tenantId?: string) {
    const where: any = {
      occurredAt: {
        gte: new Date(from),
        lte: new Date(to),
      },
    };
    if (tenantId) where.tenantId = tenantId;
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: 500,
    });
  }

  async getByTenant(tenantId: string, limit = 100) {
    return this.prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }
}
