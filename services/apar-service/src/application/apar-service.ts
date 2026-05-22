import { inject, injectable } from 'tsyringe';
import {
  IAREntryRepository,
  IAPEntryRepository,
  IEventPublisher,
  AREntry,
  APEntry,
  TenantId,
} from '@amacc/shared-kernel';
import { createEvent } from '@amacc/shared-kernel';

@injectable()
export class APARService {
  constructor(
    @inject('IAREntryRepository') private readonly arRepo: IAREntryRepository,
    @inject('IAPEntryRepository') private readonly apRepo: IAPEntryRepository,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async createAREntry(data: Omit<AREntry, 'id'>, tenantId: TenantId): Promise<AREntry> {
    return this.arRepo.create(data, tenantId);
  }

  async getAREntries(tenantId: TenantId): Promise<AREntry[]> {
    return this.arRepo.findAll(tenantId);
  }

  async createAPEntry(data: Omit<APEntry, 'id'>, tenantId: TenantId): Promise<APEntry> {
    return this.apRepo.create(data, tenantId);
  }

  async getAPEntries(tenantId: TenantId): Promise<APEntry[]> {
    return this.apRepo.findAll(tenantId);
  }

  async importOEMRemittance(tenantId: TenantId, entries: Omit<AREntry, 'id'>[]): Promise<AREntry[]> {
    const created: AREntry[] = [];
    for (const entry of entries) {
      created.push(await this.arRepo.create(entry, tenantId));
    }

    await this.eventPublisher.publish(
      createEvent('OEM_REMITTANCE_IMPORTED', tenantId, {
        count: created.length,
        totalAmount: created.reduce((s, e) => s + e.amount, 0),
      }),
    );

    return created;
  }
}
