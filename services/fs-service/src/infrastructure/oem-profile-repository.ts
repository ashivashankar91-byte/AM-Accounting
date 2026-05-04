import { PrismaClient } from '.prisma/fs-client';

export interface CreateOEMProfileDto {
  oemCode: string;
  oemName: string;
  dealerCode: string;
  reportFormat?: string;
  submissionMethod?: string;
  submissionUrl?: string;
}

export interface UpdateOEMProfileDto {
  oemName?: string;
  dealerCode?: string;
  reportFormat?: string;
  submissionMethod?: string;
  submissionUrl?: string;
  isActive?: boolean;
}

export class OEMProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, dto: CreateOEMProfileDto) {
    return this.prisma.oEMProfile.create({
      data: {
        tenantId,
        oemCode: dto.oemCode,
        oemName: dto.oemName,
        dealerCode: dto.dealerCode,
        reportFormat: dto.reportFormat ?? 'STANDARD',
        submissionMethod: dto.submissionMethod ?? 'API',
        submissionUrl: dto.submissionUrl,
      },
    });
  }

  async findByOemCode(tenantId: string, oemCode: string) {
    return this.prisma.oEMProfile.findUnique({
      where: { tenantId_oemCode: { tenantId, oemCode } },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.oEMProfile.findMany({
      where: { tenantId, isActive: true },
      orderBy: { oemCode: 'asc' },
    });
  }

  async update(tenantId: string, oemCode: string, dto: UpdateOEMProfileDto) {
    return this.prisma.oEMProfile.update({
      where: { tenantId_oemCode: { tenantId, oemCode } },
      data: dto,
    });
  }
}
