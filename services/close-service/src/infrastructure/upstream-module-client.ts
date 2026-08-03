import { injectable } from 'tsyringe';
import { createServiceToken } from '@amacc/shared-kernel';
import { ModuleSignal } from '../domain/readiness-aggregator';

// Service-to-service URLs — configured by docker-compose / k8s env vars.
// Each upstream service exposes GET /{prefix}/period-readiness (CE-15 reconciliation).
const UPSTREAM_URLS: Record<string, string> = {
  'CE09_AP_AR_CASH':    process.env['APAR_SERVICE_URL']             ?? 'http://apar-service:3013',
  'CE11_FIXED_OPS':     process.env['FIXEDOPS_SERVICE_URL']         ?? 'http://fixedops-service:3060',
  'CE12_VEHICLE_DEAL':  process.env['DEAL_ACCOUNTING_SERVICE_URL']  ?? 'http://deal-accounting-service:3092',
  'CE13_PAYROLL':       process.env['PAYROLL_SERVICE_URL']          ?? 'http://payroll-service:3012',
  'CE14_OEM':           process.env['OEM_SERVICE_URL']              ?? 'http://oem-service:3052',
};

const UPSTREAM_PATHS: Record<string, string> = {
  'CE09_AP_AR_CASH':    '/api/v1/apar/period-readiness',
  'CE11_FIXED_OPS':     '/api/v1/fixedops/period-readiness',
  'CE12_VEHICLE_DEAL':  '/api/v1/deal-accounting/period-readiness',
  'CE13_PAYROLL':       '/api/v1/payroll/period-readiness',
  'CE14_OEM':           '/api/v1/oem/period-readiness',
};

@injectable()
export class UpstreamModuleClient {
  async getSignal(
    moduleCode: string,
    tenantId: string,
    legalEntityId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<ModuleSignal> {
    if (moduleCode === 'CE06_ELIMINATIONS') return 'ELIMINATIONS_PENDING';

    const baseUrl = UPSTREAM_URLS[moduleCode];
    const path    = UPSTREAM_PATHS[moduleCode];
    if (!baseUrl || !path) return 'NOT_CONFIGURED';

    const jwtSecret = process.env['AMACC_JWT_SECRET'];
    if (!jwtSecret) {
      console.warn(`[UpstreamModuleClient] AMACC_JWT_SECRET not set — cannot call ${moduleCode}, returning PUTR`);
      return 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION';
    }

    const serviceToken = createServiceToken('close-service', jwtSecret);
    const qs = new URLSearchParams({
      legalEntityId,
      periodYear:  String(periodYear),
      periodMonth: String(periodMonth),
    });
    const url = `${baseUrl}${path}?${qs.toString()}`;

    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization':  `Bearer ${serviceToken}`,
          'x-tenant-id':    tenantId,
          'Content-Type':   'application/json',
        },
        signal: AbortSignal.timeout(5_000),
      });

      if (!resp.ok) {
        console.warn(`[UpstreamModuleClient] ${moduleCode} period-readiness returned HTTP ${resp.status} — returning PUTR`);
        return 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION';
      }

      const body = await resp.json() as { signal: string };
      if (body.signal === 'READY')     return 'READY';
      if (body.signal === 'NOT_READY') return 'NOT_READY';
      return 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION';
    } catch (err) {
      console.warn(`[UpstreamModuleClient] ${moduleCode} period-readiness unreachable (${(err as Error).message}) — returning PUTR`);
      return 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION';
    }
  }

  async getAllSignals(
    tenantId: string,
    legalEntityId: string,
    periodYear: number,
    periodMonth: number,
  ) {
    const modules = [...Object.keys(UPSTREAM_URLS), 'CE06_ELIMINATIONS'];
    return Promise.all(
      modules.map(async (code) => ({
        moduleCode: code,
        signal: await this.getSignal(code, tenantId, legalEntityId, periodYear, periodMonth),
      })),
    );
  }
}

