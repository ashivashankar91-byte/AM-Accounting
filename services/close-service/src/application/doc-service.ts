import { injectable } from 'tsyringe';
import { ModuleSignal } from '../domain/readiness-aggregator';

export interface DocSignal {
  moduleCode: string;
  signal: ModuleSignal;
  label: string;
  asOfDate: string;
}

@injectable()
export class DocService {
  async getDoc(_tenantId: string, _legalEntityId: string, asOfDate: string): Promise<DocSignal[]> {
    return [
      { code: 'CE-09', label: 'GL Balances' },
      { code: 'CE-11', label: 'AP Aging' },
      { code: 'CE-12', label: 'AR Aging' },
      { code: 'CE-13', label: 'Inventory' },
      { code: 'CE-14', label: 'Fixed Assets' },
    ].map(m => ({
      moduleCode: m.code,
      signal: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION' as ModuleSignal,
      label: m.label,
      asOfDate,
    }));
  }
}
