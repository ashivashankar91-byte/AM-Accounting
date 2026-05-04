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
}

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async log(dto: CreateAuditLogDTO): Promise<{ id: string }> {
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
      },
    });
    logger.info({ auditId: record.id, eventType: dto.eventType }, 'Audit log created');
    return { id: record.id };
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
