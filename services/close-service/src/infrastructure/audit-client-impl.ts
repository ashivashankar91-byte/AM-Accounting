import { injectable } from 'tsyringe';

@injectable()
export class HttpAuditClientImpl {
  private readonly baseUrl: string;
  constructor() { this.baseUrl = process.env['AUDIT_SERVICE_URL'] ?? 'http://audit-service:3053'; }

  async logAction(tenantId: string, action: string, actor: string, payload: any): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/api/v1/audit/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
        body: JSON.stringify({ action, actor, payload }),
      });
    } catch { /* non-blocking */ }
  }
}
