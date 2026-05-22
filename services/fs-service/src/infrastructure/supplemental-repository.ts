import { PrismaClient } from '.prisma/fs-client';

export interface UpsertSupplementalDto {
  tenantId: string;
  oemCode: string;
  periodYear: number;
  periodMonth: number;
  fieldName: string;
  fieldValue: string;
  fieldType?: string;
}

export class SupplementalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(tenantId: string, oemCode: string, periodYear: number, periodMonth: number) {
    return this.prisma.fSSupplementalData.findMany({
      where: { tenantId, oemCode, periodYear, periodMonth },
      orderBy: { fieldName: 'asc' },
    });
  }

  async upsert(dto: UpsertSupplementalDto) {
    return this.prisma.fSSupplementalData.upsert({
      where: {
        tenantId_oemCode_periodYear_periodMonth_fieldName: {
          tenantId: dto.tenantId,
          oemCode: dto.oemCode,
          periodYear: dto.periodYear,
          periodMonth: dto.periodMonth,
          fieldName: dto.fieldName,
        },
      },
      create: {
        tenantId: dto.tenantId,
        oemCode: dto.oemCode,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
        fieldName: dto.fieldName,
        fieldValue: dto.fieldValue,
        fieldType: dto.fieldType ?? 'STRING',
      },
      update: {
        fieldValue: dto.fieldValue,
        fieldType: dto.fieldType ?? 'STRING',
      },
    });
  }
}
