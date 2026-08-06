import { createServiceToken } from '@amacc/shared-kernel';

/**
 * S104 — real trial-balance query against gl-service, same call shape as
 * fs-service's existing Stream 4 module (services/fs-service/src/
 * application/fs-service.ts fetchTrialBalance): GET /api/v1/gl/trial-
 * balance?year=&month= with x-tenant-id. This is the "SAME ledger truth as
 * the trial balance" the package requires S104 to render from — genuinely
 * queried, not stubbed, since gl-service is implemented in this worktree
 * (unlike the CE-11/CE-12/CE-09 PUTR boundaries).
 *
 * gl-service's authMiddleware requires a real JWT on every route, including
 * server-to-server calls — signs a short-lived internal service token with
 * the same shared AMACC_JWT_SECRET every other cross-service call in this
 * repo uses (e.g. AuditOutboxDrainer's HttpAuditClient), never a bypass.
 */
export interface GlTrialBalanceAccountRow {
  accountCode: string;
  debit: string;
  credit: string;
}

export interface GlTrialBalanceResponse {
  accounts: GlTrialBalanceAccountRow[];
}

export class GlServiceError extends Error {}

export class GlTrialBalanceClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010').replace(/\/+$/, '');
  }

  async fetchTrialBalance(tenantId: string, year: number, month: number): Promise<GlTrialBalanceResponse> {
    const jwtSecret = process.env['AMACC_JWT_SECRET'];
    const token = jwtSecret ? createServiceToken('oem-service', jwtSecret) : null;
    const res = await fetch(`${this.baseUrl}/api/v1/gl/trial-balance?year=${year}&month=${month}`, {
      headers: {
        'x-tenant-id': tenantId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new GlServiceError(`Trial balance fetch failed for ${year}/${month}: ${res.status}`);
    return res.json() as Promise<GlTrialBalanceResponse>;
  }
}
