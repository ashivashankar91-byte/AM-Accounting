import { inject, injectable } from 'tsyringe';
import { IArchiveRepository } from '../domain/interfaces';

@injectable()
export class ArchiveService {
  constructor(@inject('IArchiveRepository') private readonly repo: IArchiveRepository) {}

  async create(tenantId: string, data: any) { return this.repo.create(tenantId, data); }
  async list(tenantId: string) { return this.repo.findAll(tenantId); }
  async get(tenantId: string, id: string) { return this.repo.findById(tenantId, id); }
  async delete(tenantId: string, id: string) { return this.repo.softDelete(tenantId, id); }
  async createRetentionSchedule(tenantId: string, data: any) { return this.repo.createRetentionSchedule(tenantId, data); }
}
