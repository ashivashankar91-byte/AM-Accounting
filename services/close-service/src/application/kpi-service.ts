import { inject, injectable } from 'tsyringe';
import { IKpiRepository } from '../domain/interfaces';

@injectable()
export class KpiService {
  constructor(@inject('IKpiRepository') private readonly repo: IKpiRepository) {}

  async listFormulas(tenantId: string) { return this.repo.listFormulas(tenantId); }
  async createFormula(tenantId: string, data: any) { return this.repo.createFormula(tenantId, data); }
  async computeKpi(tenantId: string, data: any) { return this.repo.saveResult(tenantId, data); }
}
