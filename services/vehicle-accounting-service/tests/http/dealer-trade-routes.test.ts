// CE-12 gap-close — HTTP-level (Fastify .inject()) test proving
// GET /dealer-trades/:tradeNumber returns the new schedule-service-sourced
// scheduleTieOut (receivable/payable), not something independently
// recomputed from this service's own dealerTrade rows. Same pattern as
// tests/http/unit-routes.test.ts — see its header comment.
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import * as crypto from 'crypto';
import { dealerTradeRoutes } from '../../src/http/dealer-trade-routes';
import { DealerTradeService } from '../../src/application/dealer-trade-service';
import { VEHICLE_ACCOUNTING_PERMISSIONS as PERM } from '../../src/http/security';

const JWT_SECRET = 'vehicle-accounting-test-secret';

function b64u(s: string): string {
  return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function tokenFor(role: string, tenantId = 'tenant-a'): string {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ sub: role, tenantId, role, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function authed(role: string, tenantId = 'tenant-a') {
  return { 'x-tenant-id': tenantId, authorization: `Bearer ${tokenFor(role, tenantId)}` };
}

const ROLE_GRANTS: Record<string, ReadonlySet<string>> = {
  VIEWER: new Set([PERM.DEALER_TRADE_VIEW]),
  NO_PERMS: new Set([]),
};

function createFakeAuthzClient() {
  return {
    async check(req: any) {
      const grants = ROLE_GRANTS[req.userId];
      if (grants?.has(req.permissionKey)) return { allow: true, matchedRole: req.userId };
      return { allow: false, reason: 'NO_MATCHING_ROLE' };
    },
  };
}

const TRADE_WITH_SCHEDULE_TIE_OUT = {
  outbound: { id: 'trade-1', tradeNumber: 'TRD-001', direction: 'OUTBOUND', agreedValue: '9500.00', status: 'OPEN' },
  inbound: null,
  settlement: null,
  scheduleTieOut: {
    receivable: { scheduleNumber: '81', controlNumber: 'TRD-001', remainingBalanceCents: 950_000, openItemCount: 1 },
    payable: null,
  },
};

describe('dealer-trade-routes — GET /dealer-trades/:tradeNumber schedule tie-out (CE-12 gap-close)', () => {
  let app: FastifyInstance;
  const originalJwtSecret = process.env['AMACC_JWT_SECRET'];

  beforeAll(async () => {
    process.env['AMACC_JWT_SECRET'] = JWT_SECRET;
    container.registerInstance('AuthzClient', createFakeAuthzClient() as any);
    container.registerInstance(DealerTradeService, {
      getTrade: vi.fn(async () => TRADE_WITH_SCHEDULE_TIE_OUT),
    } as any);

    app = Fastify();
    await app.register(dealerTradeRoutes, { prefix: '/api/v1/vehicle-accounting' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env['AMACC_JWT_SECRET'] = originalJwtSecret;
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vehicle-accounting/dealer-trades/TRD-001', headers: { 'x-tenant-id': 'tenant-a' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a caller missing vehicle_accounting.dealer_trade.view with 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vehicle-accounting/dealer-trades/TRD-001', headers: authed('NO_PERMS') });
    expect(res.statusCode).toBe(403);
  });

  it('returns the real schedule-service-sourced receivable/payable tie-out balances', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/vehicle-accounting/dealer-trades/TRD-001', headers: authed('VIEWER') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scheduleTieOut).toEqual({
      receivable: { scheduleNumber: '81', controlNumber: 'TRD-001', remainingBalanceCents: 950_000, openItemCount: 1 },
      payable: null,
    });
  });
});
