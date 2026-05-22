import { PrismaClient } from '.prisma/fs-client';

export interface CreateFormatCodeDto {
  mfgCode: string;
  formatName: string;
  description?: string;
  isActive?: boolean;
}

export interface UpdateFormatCodeDto {
  formatName?: string;
  description?: string;
  isActive?: boolean;
}

export class FormatCodeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, dto: CreateFormatCodeDto) {
    return this.prisma.formatCode.create({
      data: {
        tenantId,
        mfgCode: dto.mfgCode,
        formatName: dto.formatName,
        description: dto.description,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.formatCode.findUnique({ where: { id } });
  }

  async findByMfgCode(tenantId: string, mfgCode: string) {
    return this.prisma.formatCode.findUnique({
      where: { tenantId_mfgCode: { tenantId, mfgCode } },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.formatCode.findMany({
      where: { tenantId },
      orderBy: { mfgCode: 'asc' },
    });
  }

  async update(id: string, dto: UpdateFormatCodeDto) {
    return this.prisma.formatCode.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string) {
    return this.prisma.formatCode.delete({ where: { id } });
  }
}
