/**
 * Thin HTTP client for the real S007 audit-service (POST /api/v1/audit/log).
 * Used by AuditOutboxDrainer to forward each service's local audit_outbox
 * rows to the one central, append-only audit store.
 */
import { createServiceToken } from '../middleware/auth';

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
  serviceId?: string;
  jwtSecret?: string;
}

export class HttpAuditClient implements AuditClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly serviceId: string;
  private readonly jwtSecret: string | undefined;

  constructor(options: AuditClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env['AUDIT_SERVICE_URL'] ?? 'http://audit-service:3031').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.serviceId = options.serviceId ?? process.env['SERVICE_NAME'] ?? 'internal-service';
    // FINAL-R0 defect fix: closing the NODE_ENV dev-auth-bypass (Priority 0)
    // exposed a second, pre-existing gap -- this internal drainer client sent
    // NO Authorization header at all, so it could only ever reach
    // audit-service's authMiddleware-gated POST /log by accident, via the
    // very bypass we just closed. In fail-closed (production/AUTH_BYPASS_
    // ENABLED=false) mode the drainer could never deliver a single audit
    // record. Sign a short-lived internal service token with the same shared
    // JWT secret every other cross-service call already uses.
    this.jwtSecret = options.jwtSecret ?? process.env['JWT_SECRET'] ?? process.env['AMACC_JWT_SECRET'];
  }

  async log(entry: AuditLogEntry): Promise<{ id: string; idempotent: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-tenant-id': entry.tenantId };
      if (this.jwtSecret) {
        headers['authorization'] = `Bearer ${createServiceToken(this.serviceId, this.jwtSecret)}`;
      }
      const res = await fetch(`${this.baseUrl}/api/v1/audit/log`, {
        method: 'POST',
        headers,
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
