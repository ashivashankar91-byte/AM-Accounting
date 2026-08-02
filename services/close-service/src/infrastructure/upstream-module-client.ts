import { injectable } from 'tsyringe';
import { ModuleSignal } from '../domain/readiness-aggregator';

const CE06_MODULE = 'CE-06';
const UPSTREAM_MODULES = ['CE-09', 'CE-11', 'CE-12', 'CE-13', 'CE-14'];

@injectable()
export class UpstreamModuleClient {
  async getSignal(moduleCode: string, _tenantId: string, _legalEntityId: string, _periodYear: number, _periodMonth: number): Promise<ModuleSignal> {
    if (moduleCode === CE06_MODULE) return 'ELIMINATIONS_PENDING';
    if (UPSTREAM_MODULES.includes(moduleCode)) return 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION';
    return 'NOT_CONFIGURED';
  }

  async getAllSignals(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number) {
    const modules = [...UPSTREAM_MODULES, CE06_MODULE];
    return Promise.all(modules.map(async code => ({
      moduleCode: code,
      signal: await this.getSignal(code, tenantId, legalEntityId, periodYear, periodMonth),
    })));
  }
}
