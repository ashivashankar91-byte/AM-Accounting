import { PrismaClient } from '.prisma/fs-client';

export interface CreateFSTemplateDto {
  mfgCode: string;
  year: number;
  parameters: Record<string, any>;
}

export class FSTemplateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, dto: CreateFSTemplateDto) {
    return this.prisma.fSTemplate.create({
      data: {
        tenantId,
        mfgCode: dto.mfgCode,
        year: dto.year,
        parameters: dto.parameters,
      },
    });
  }

  async findByMfgCodeAndYear(tenantId: string, mfgCode: string, year: number) {
    return this.prisma.fSTemplate.findUnique({
      where: { tenantId_mfgCode_year: { tenantId, mfgCode, year } },
    });
  }

  async findAll(tenantId: string, mfgCode: string) {
    return this.prisma.fSTemplate.findMany({
      where: { tenantId, mfgCode },
      orderBy: { year: 'desc' },
    });
  }

  async upsert(tenantId: string, dto: CreateFSTemplateDto) {
    return this.prisma.fSTemplate.upsert({
      where: { tenantId_mfgCode_year: { tenantId, mfgCode: dto.mfgCode, year: dto.year } },
      create: { tenantId, ...dto },
      update: { parameters: dto.parameters },
    });
  }

  async delete(tenantId: string, mfgCode: string, year: number) {
    return this.prisma.fSTemplate.deleteMany({
      where: { tenantId, mfgCode, year },
    });
  }
}
