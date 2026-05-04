// @trace-cobol schedsec.cbl — per-user per-schedule security
import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/schedule-client';

export interface ISchedulePermissionRepository {
  canUserAccess(tenantId: string, userId: string, scheduleNumber: string): Promise<boolean>;
  getUserAccessMap(tenantId: string, userId: string): Promise<Record<string, boolean>>;
  replaceUserAccess(tenantId: string, userId: string, permissions: Record<string, boolean>): Promise<void>;
  deleteUserAccess(tenantId: string, userId: string): Promise<void>;
  listUsersWithAccess(tenantId: string): Promise<string[]>;
}

@injectable()
export class PrismaSchedulePermissionRepository implements ISchedulePermissionRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async canUserAccess(tenantId: string, userId: string, scheduleNumber: string): Promise<boolean> {
    const row = await this.prisma.schedulePermission.findUnique({
      where: { tenantId_userId_scheduleNumber: { tenantId, userId, scheduleNumber } },
      select: { canAccess: true },
    });
    // If no row exists, default deny
    return row?.canAccess ?? false;
  }

  async getUserAccessMap(tenantId: string, userId: string): Promise<Record<string, boolean>> {
    const rows = await this.prisma.schedulePermission.findMany({
      where: { tenantId, userId },
      select: { scheduleNumber: true, canAccess: true },
    });
    return Object.fromEntries(rows.map((r) => [r.scheduleNumber, r.canAccess]));
  }

  async replaceUserAccess(
    tenantId: string,
    userId: string,
    permissions: Record<string, boolean>,
  ): Promise<void> {
    // Atomic: delete all existing, write all new in a single transaction
    await this.prisma.$transaction([
      this.prisma.schedulePermission.deleteMany({ where: { tenantId, userId } }),
      ...Object.entries(permissions).map(([scheduleNumber, canAccess]) =>
        this.prisma.schedulePermission.create({
          data: { tenantId, userId, scheduleNumber, canAccess },
        }),
      ),
    ]);
  }

  async deleteUserAccess(tenantId: string, userId: string): Promise<void> {
    await this.prisma.schedulePermission.deleteMany({ where: { tenantId, userId } });
  }

  async listUsersWithAccess(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.schedulePermission.findMany({
      where: { tenantId },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((r) => r.userId);
  }
}
