import { injectable } from 'tsyringe';
import { createServiceToken } from '@amacc/shared-kernel';
import { ModuleSignal } from '../domain/readiness-aggregator';

// Service-to-service URLs — configured by docker-compose / k8s env vars.
// Each upstream service exposes GET /{prefix}/period-readiness (CE-15 reconciliation).
const UPSTREAM_URLS: Record<string, string> = {
  'CE09_AP_AR_CASH':    process.env['APAR_SERVICE_URL']             ?? 'http://apar-service:3013',
  // CE-09 bank-recon readiness lives in cash-service (separate from AP/AR).
  // apar-service period-readiness explicitly states it covers AP/AR only;
  // unreconciled bank-feed items (BankFeedLine.status='UNMATCHED') must be
  // checked here to prevent period close with outstanding bank variances.
  'CE09_BANK_RECON':    process.env['CASH_SERVICE_URL']             ?? 'http://cash-service:3014',
  'CE11_FIXED_OPS':     process.env['FIXEDOPS_SERVICE_URL']         ?? 'http://fixedops-service:3060',
  'CE12_VEHICLE_DEAL':  process.env['DEAL_ACCOUNTING_SERVICE_URL']  ?? 'http://deal-accounting-service:3092',
  'CE13_PAYROLL':       process.env['PAYROLL_SERVICE_URL']          ?? 'http://payroll-service:3012',
  'CE14_OEM':           process.env['OEM_SERVICE_URL']              ?? 'http://oem-service:3052',
};

const UPSTREAM_PATHS: Record<string, string> = {
  'CE09_AP_AR_CASH':    '/api/v1/apar/period-readiness',
  'CE09_BANK_RECON':    '/api/v1/cash/period-readiness',
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
    // ACC-S003 (Elimination Entity Configuration) is complete and R1-shipped.
    // Intercompany elimination *posting* (S004B, S005, S006, S012, S031–S033)
    // is deferred post-R1; S034/S035 are explicitly R5. This hard-coded
    // ELIMINATIONS_PENDING is the correct PACKAGE_AUTHORIZED_DEFERRED signal
    // until a CE-06 elimination-posting service exposes a real period-readiness
    // endpoint. Do not remove this without a real upstream contract.
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

