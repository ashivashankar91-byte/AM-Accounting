import { injectable } from 'tsyringe';

@injectable()
export class TaxPackService {
  async generate(tenantId: string, legalEntityId: string, fiscalYear: number, generatedBy: string) {
    return { id: `tax-pack-${Date.now()}`, tenantId, legalEntityId, fiscalYear, generatedBy, generatedAt: new Date().toISOString(), status: 'GENERATED' };
  }
}
