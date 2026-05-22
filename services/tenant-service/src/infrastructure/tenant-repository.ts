import { injectable, inject } from 'tsyringe';
import { ITenantRepository, Tenant, TenantStatus, DMSType } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/tenant-client';
import type { Tenant as PrismaTenant } from '.prisma/tenant-client';

@injectable()
export class PrismaTenantRepository implements ITenantRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async findAll(): Promise<Tenant[]> {
    const rows = await this.prisma.tenant.findMany({
      where: { status: { not: 'DELETED' } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(this.toDomain);
  }

  async findById(id: string): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const rows = await this.prisma.tenant.findMany({ where: { status: { not: 'DELETED' } } });
    const match = rows.find((r) => r.name.toLowerCase().replace(/\s+/g, '-') === slug);
    return match ? this.toDomain(match) : null;
  }

  async create(data: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tenant> {
    // Omit domain-only fields (slug, oems) not present in the Prisma schema
    const { slug: _s, oems: _o, ...prismaData } = data;
    const row = await this.prisma.tenant.create({ data: prismaData });
    return this.toDomain(row);
  }

  async update(id: string, data: Partial<Tenant>): Promise<Tenant> {
    const { slug: _s, oems: _o, id: _id, createdAt: _ca, updatedAt: _ua, ...prismaData } = data;
    const row = await this.prisma.tenant.update({ where: { id }, data: prismaData });
    return this.toDomain(row);
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.tenant.update({
      where: { id },
      data: { status: TenantStatus.DELETED },
    });
  }

  private toDomain(row: PrismaTenant): Tenant {
    return {
      id: row.id,
      name: row.name,
      slug: row.name.toLowerCase().replace(/\s+/g, '-'),
      dmsType: row.dmsType as DMSType,
      dmsApiKey: row.dmsApiKey,
      schemaName: row.schemaName,
      status: row.status as TenantStatus,
      rooftopCount: row.rooftopCount,
      oems: [],
      webhookUrl: row.webhookUrl,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
