import { PrismaClient } from '.prisma/fs-client';

export interface CreateFSSetupDto {
  mfgCode: string;
  year: number;
  calendarOrFiscal: 'CALENDAR' | 'FISCAL';
  statementOption?: string;
  transmissionGroup?: string;
}

export class FSSetupRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, dto: CreateFSSetupDto) {
    return this.prisma.fSSetup.create({
      data: {
        tenantId,
        mfgCode: dto.mfgCode,
        year: dto.year,
        calendarOrFiscal: dto.calendarOrFiscal,
        statementOption: dto.statementOption,
        transmissionGroup: dto.transmissionGroup,
      },
    });
  }

  async findByMfgCodeAndYear(tenantId: string, mfgCode: string, year: number) {
    return this.prisma.fSSetup.findUnique({
      where: { tenantId_mfgCode_year: { tenantId, mfgCode, year } },
    });
  }

  async findAll(tenantId: string, mfgCode?: string) {
    return this.prisma.fSSetup.findMany({
      where: { tenantId, ...(mfgCode && { mfgCode }) },
      orderBy: [{ mfgCode: 'asc' }, { year: 'desc' }],
    });
  }

  async update(tenantId: string, mfgCode: string, year: number, dto: Partial<CreateFSSetupDto>) {
    return this.prisma.fSSetup.update({
      where: { tenantId_mfgCode_year: { tenantId, mfgCode, year } },
      data: {
        calendarOrFiscal: dto.calendarOrFiscal,
        statementOption: dto.statementOption,
        transmissionGroup: dto.transmissionGroup,
      },
    });
  }

  async delete(tenantId: string, mfgCode: string, year: number) {
    return this.prisma.fSSetup.deleteMany({
      where: { tenantId, mfgCode, year },
    });
  }
}
