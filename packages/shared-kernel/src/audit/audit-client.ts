/**
 * Thin HTTP client for the real S007 audit-service (POST /api/v1/audit/log).
 * Used by AuditOutboxDrainer to forward each service's local audit_outbox
 * rows to the one central, append-only audit store.
 */
export interface AuditLogEntry {
  tenantId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string;
  actorName: string;
  action: string;
  previousState?: unknown;
  newState?: unknown;
  occurredAt?: string;
  sourceEventId?: string;
}

export interface AuditClient {
  log(entry: AuditLogEntry): Promise<{ id: string; idempotent: boolean }>;
}

export interface AuditClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export class HttpAuditClient implements AuditClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: AuditClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env['AUDIT_SERVICE_URL'] ?? 'http://audit-service:3031').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 3000;
  }

  async log(entry: AuditLogEntry): Promise<{ id: string; idempotent: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/audit/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': entry.tenantId },
        body: JSON.stringify(entry),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(`audit-service /log returned ${res.status}: ${body.message ?? res.statusText}`);
      }
      const body = (await res.json()) as { id: string; idempotent?: boolean };
      return { id: body.id, idempotent: Boolean(body.idempotent) };
    } finally {
      clearTimeout(timeout);
    }
  }
}
