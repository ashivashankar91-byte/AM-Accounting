import { PrismaClient } from '.prisma/fs-client';
import type { MappingTemplate } from '../seed/oem-templates/types';

export interface CreateMappingDto {
  oemProfileId: string;
  oemLineNumber: string;
  oemLineLabel: string;
  oemSection: string;
  glAccountCodes?: string[];
  calculationType?: string;
  formula?: string;
  displayOrder: number;
  isSubtotal?: boolean;
  isTotal?: boolean;
}

export interface UpdateMappingDto {
  oemLineLabel?: string;
  oemSection?: string;
  glAccountCodes?: string[];
  calculationType?: string;
  formula?: string;
  displayOrder?: number;
  isSubtotal?: boolean;
  isTotal?: boolean;
}

export class MappingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(tenantId: string, dto: CreateMappingDto) {
    return this.prisma.oEMAccountMapping.create({
      data: {
        tenantId,
        oemProfileId: dto.oemProfileId,
        oemLineNumber: dto.oemLineNumber,
        oemLineLabel: dto.oemLineLabel,
        oemSection: dto.oemSection,
        glAccountCodes: dto.glAccountCodes ?? [],
        calculationType: dto.calculationType ?? 'SUM',
        formula: dto.formula,
        displayOrder: dto.displayOrder,
        isSubtotal: dto.isSubtotal ?? false,
        isTotal: dto.isTotal ?? false,
      },
    });
  }

  async findAll(tenantId: string, oemProfileId: string) {
    return this.prisma.oEMAccountMapping.findMany({
      where: { tenantId, oemProfileId },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findById(id: string) {
    return this.prisma.oEMAccountMapping.findUnique({ where: { id } });
  }

  async update(id: string, dto: UpdateMappingDto) {
    return this.prisma.oEMAccountMapping.update({ where: { id }, data: dto });
  }

  async delete(id: string) {
    return this.prisma.oEMAccountMapping.delete({ where: { id } });
  }

  /**
   * Import a full OEM template atomically — deletes existing mappings and inserts fresh.
   * Returns count of lines imported.
   */
  async importTemplate(tenantId: string, oemProfileId: string, template: MappingTemplate): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.oEMAccountMapping.deleteMany({ where: { tenantId, oemProfileId } });
      await tx.oEMAccountMapping.createMany({
        data: template.lines.map((line) => ({
          tenantId,
          oemProfileId,
          oemLineNumber: line.lineNumber,
          oemLineLabel: line.label,
          oemSection: line.section,
          glAccountCodes: line.glAccountCodes,
          calculationType: line.calculationType ?? 'SUM',
          formula: line.formula ?? null,
          displayOrder: line.displayOrder,
          isSubtotal: line.isSubtotal ?? false,
          isTotal: line.isTotal ?? false,
        })),
      });
      return template.lines.length;
    });
  }
}
