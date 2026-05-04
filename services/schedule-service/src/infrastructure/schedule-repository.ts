// @trace-cobol sched.fc/fd — SCHED-FILE CRUD operations
import { injectable, inject } from 'tsyringe';
import { PrismaClient } from '.prisma/schedule-client';
import type { Schedule } from '.prisma/schedule-client';
import type { CreateScheduleDto, UpdateScheduleDto } from '../domain/schedule';

export interface IScheduleRepository {
  findAll(tenantId: string): Promise<Schedule[]>;
  findById(tenantId: string, scheduleNumber: string): Promise<Schedule | null>;
  create(tenantId: string, dto: CreateScheduleDto): Promise<Schedule>;
  update(tenantId: string, scheduleNumber: string, dto: UpdateScheduleDto): Promise<Schedule>;
  delete(tenantId: string, scheduleNumber: string): Promise<void>;
}

@injectable()
export class PrismaScheduleRepository implements IScheduleRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findAll(tenantId: string): Promise<Schedule[]> {
    return this.prisma.schedule.findMany({
      where: { tenantId },
      orderBy: { scheduleNumber: 'asc' },
    });
  }

  async findById(tenantId: string, scheduleNumber: string): Promise<Schedule | null> {
    return this.prisma.schedule.findFirst({
      where: { tenantId, scheduleNumber },
    });
  }

  async create(tenantId: string, dto: CreateScheduleDto): Promise<Schedule> {
    return this.prisma.schedule.create({
      data: {
        tenantId,
        scheduleNumber: dto.scheduleNumber,
        title: dto.title,
        reportSequence: dto.reportSequence ?? 'C',
        scheduleType: dto.scheduleType,
        glAccountNumbers: dto.glAccountNumbers,
        eomPurgeType: dto.eomPurgeType,
        controlNameDisplay: dto.controlNameDisplay ?? '',
      },
    });
  }

  async update(tenantId: string, scheduleNumber: string, dto: UpdateScheduleDto): Promise<Schedule> {
    return this.prisma.schedule.update({
      where: { tenantId_scheduleNumber: { tenantId, scheduleNumber } },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.reportSequence !== undefined && { reportSequence: dto.reportSequence }),
        ...(dto.scheduleType !== undefined && { scheduleType: dto.scheduleType }),
        ...(dto.glAccountNumbers !== undefined && { glAccountNumbers: dto.glAccountNumbers }),
        ...(dto.eomPurgeType !== undefined && { eomPurgeType: dto.eomPurgeType }),
        ...(dto.controlNameDisplay !== undefined && { controlNameDisplay: dto.controlNameDisplay }),
      },
    });
  }

  async delete(tenantId: string, scheduleNumber: string): Promise<void> {
    await this.prisma.schedule.delete({
      where: { tenantId_scheduleNumber: { tenantId, scheduleNumber } },
    });
  }
}
