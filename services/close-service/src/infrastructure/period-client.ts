import { injectable } from 'tsyringe';

@injectable()
export class PeriodClient {
  private readonly baseUrl: string;
  constructor() { this.baseUrl = process.env['EOM_SERVICE_URL'] ?? 'http://eom-service:3051'; }

  async getPeriodStatus(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/periods/status?legalEntityId=${legalEntityId}&periodYear=${periodYear}&periodMonth=${periodMonth}`, { headers: { 'x-tenant-id': tenantId } });
      if (!res.ok) return 'UNKNOWN';
      const data = await res.json() as any;
      return data.status ?? 'UNKNOWN';
    } catch { return 'UNKNOWN'; }
  }
}
