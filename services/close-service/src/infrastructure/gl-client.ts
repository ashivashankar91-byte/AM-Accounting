import { injectable } from 'tsyringe';

@injectable()
export class GlClient {
  private readonly baseUrl: string;
  constructor() { this.baseUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3001'; }

  async getUnpostedJournalCount(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number): Promise<number> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/journals/unposted-count?legalEntityId=${legalEntityId}&periodYear=${periodYear}&periodMonth=${periodMonth}`, { headers: { 'x-tenant-id': tenantId } });
      if (!res.ok) return 0;
      const data = await res.json() as any;
      return data.count ?? 0;
    } catch { return 0; }
  }
}
