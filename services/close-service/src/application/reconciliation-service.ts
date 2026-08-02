import { inject, injectable } from 'tsyringe';
import { IReconciliationRepository } from '../domain/interfaces';

@injectable()
export class ReconciliationService {
  constructor(@inject('IReconciliationRepository') private readonly repo: IReconciliationRepository) {}

  async listRegister(tenantId: string, params: any) { return this.repo.findAll(tenantId, params); }
  async createRegister(tenantId: string, data: any) { return this.repo.create(tenantId, data); }
  async signOff(tenantId: string, id: string, data: any) { return this.repo.signOff(tenantId, id, data); }
}
