import { inject, injectable } from 'tsyringe';
import { ITenantRepository, IEventPublisher, Tenant, TenantStatus, DMSType } from '@amacc/shared-kernel';
import { createEvent } from '@amacc/shared-kernel';

export interface CreateTenantDTO {
  name: string;
  dmsType: string;
  dmsApiKey: string;
  rooftopCount?: number;
  webhookUrl?: string;
}

@injectable()
export class TenantService {
  constructor(
    @inject('ITenantRepository') private readonly tenantRepo: ITenantRepository,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async createTenant(dto: CreateTenantDTO): Promise<Tenant> {
    const schemaName = dto.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');

    const tenant = await this.tenantRepo.create({
      name: dto.name,
      slug: dto.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      dmsType: dto.dmsType as DMSType,
      dmsApiKey: dto.dmsApiKey,
      schemaName,
      status: TenantStatus.PROVISIONING,
      rooftopCount: dto.rooftopCount ?? 1,
      oems: [],
      webhookUrl: dto.webhookUrl ?? null,
    });

    // In production: trigger schema provisioning asynchronously
    await this.tenantRepo.update(tenant.id, { status: TenantStatus.ACTIVE });

    await this.eventPublisher.publish(
      createEvent('TENANT_PROVISIONED', tenant.id, { tenantName: tenant.name }),
    );

    return { ...tenant, status: TenantStatus.ACTIVE };
  }

  async getAllTenants(): Promise<Tenant[]> {
    return this.tenantRepo.findAll();
  }

  async getTenantById(id: string): Promise<Tenant | null> {
    return this.tenantRepo.findById(id);
  }

  async updateTenant(id: string, data: Partial<Tenant>): Promise<Tenant> {
    const updated = await this.tenantRepo.update(id, data);
    await this.eventPublisher.publish(
      createEvent('TENANT_UPDATED', id, { changes: Object.keys(data) }),
    );
    return updated;
  }

  async softDeleteTenant(id: string): Promise<void> {
    await this.tenantRepo.softDelete(id);
  }
}
