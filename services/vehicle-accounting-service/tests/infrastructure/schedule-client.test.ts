// CE-12 gap-close — fake-fetch unit tests for ScheduleServiceClient's real
// open-item inquiry/relief methods (mirrors posting-recovery-client.test.ts's
// fake-fetch pattern). These prove the HTTP call shape and response
// parsing/summing logic in isolation, fast and without a live schedule-
// service. The genuinely real, end-to-end proof (real coa-service + real
// schedule-service over HTTP) lives in tests/live-db/schedule-linkage-live.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScheduleServiceClient } from '../../src/infrastructure/schedule-client';

const originalFetch = global.fetch;
const originalSecret = process.env['AMACC_JWT_SECRET'];

describe('ScheduleServiceClient', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    process.env['AMACC_JWT_SECRET'] = originalSecret;
  });

  it('getOpenItemsBalance sums remainingBalance across non-CLOSED items only, in cents', async () => {
    process.env['AMACC_JWT_SECRET'] = 'test-secret';
    let capturedUrl = '';
    let capturedHeaders: any = null;
    global.fetch = vi.fn(async (url: any, init: any) => {
      capturedUrl = String(url);
      capturedHeaders = init.headers;
      return new Response(
        JSON.stringify([
          { id: 'oi-1', status: 'OPEN', itemNumber: 'STK-1001', remainingBalance: '9500.00' },
          { id: 'oi-2', status: 'PARTIALLY_APPLIED', itemNumber: 'STK-1001', remainingBalance: '25.50' },
          { id: 'oi-3', status: 'CLOSED', itemNumber: 'STK-1001', remainingBalance: '0.00' },
        ]),
        { status: 200 },
      );
    }) as any;

    const client = new ScheduleServiceClient('http://schedule-service:3018');
    const balance = await client.getOpenItemsBalance('tenant-kunes', '80', 'STK-1001');

    expect(capturedUrl).toBe('http://schedule-service:3018/api/v1/schedules/80/open-items?controlNumber=STK-1001');
    expect(capturedHeaders['x-tenant-id']).toBe('tenant-kunes');
    expect(capturedHeaders['Authorization']).toMatch(/^Bearer /);
    expect(balance).toEqual({
      remainingBalanceCents: 950_000 + 2_550,
      openItemCount: 2,
      items: expect.arrayContaining([expect.objectContaining({ id: 'oi-1' }), expect.objectContaining({ id: 'oi-2' })]),
    });
  });

  it('getOpenItemsBalance returns null (never a fabricated 0) when schedule-service returns non-OK', async () => {
    process.env['AMACC_JWT_SECRET'] = 'test-secret';
    global.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as any;
    const client = new ScheduleServiceClient('http://schedule-service:3018');
    const balance = await client.getOpenItemsBalance('tenant-kunes', '80', 'STK-9999');
    expect(balance).toBeNull();
  });

  it('getOpenItemsBalance returns null when schedule-service is unreachable', async () => {
    process.env['AMACC_JWT_SECRET'] = 'test-secret';
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as any;
    const client = new ScheduleServiceClient('http://schedule-service:3018');
    const balance = await client.getOpenItemsBalance('tenant-kunes', '80', 'STK-9999');
    expect(balance).toBeNull();
  });

  it('relieveOpenItem applies against the oldest OPEN/PARTIALLY_APPLIED item found for scheduleNumber+controlNumber', async () => {
    process.env['AMACC_JWT_SECRET'] = 'test-secret';
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (String(url).includes('/open-items?')) {
        return new Response(JSON.stringify([{ id: 'oi-1', status: 'OPEN', itemNumber: 'TRD-001', remainingBalance: '8000.00' }]), { status: 200 });
      }
      if (String(url).endsWith('/open-items/oi-1/apply')) {
        const body = JSON.parse(init.body);
        expect(body.amount).toBe('8000.00');
        expect(body.idempotencyKey).toBe('idem-1');
        return new Response(JSON.stringify({ id: 'app-1' }), { status: 201 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    const client = new ScheduleServiceClient('http://schedule-service:3018');
    const result = await client.relieveOpenItem('tenant-kunes', '81', 'TRD-001', '8000.00', 'idem-1', 'Dealer trade settlement TRD-001');

    expect(result).toEqual({ outcome: 'RELIEVED', applicationId: 'app-1' });
    expect(calls[0]).toContain('/api/v1/schedules/81/open-items?controlNumber=TRD-001');
    expect(calls[1]).toBe('POST http://schedule-service:3018/api/v1/schedules/81/open-items/oi-1/apply');
  });

  it('relieveOpenItem degrades to NOT_FOUND (never throws) when no matching open item exists', async () => {
    process.env['AMACC_JWT_SECRET'] = 'test-secret';
    global.fetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })) as any;
    const client = new ScheduleServiceClient('http://schedule-service:3018');
    const result = await client.relieveOpenItem('tenant-kunes', '82', 'TRD-002', '5000.00', 'idem-2', 'note');
    expect(result.outcome).toBe('NOT_FOUND');
  });

  it('createSchedule POSTs the schedule DTO and returns the created schedule', async () => {
    process.env['AMACC_JWT_SECRET'] = 'test-secret';
    let capturedBody: any = null;
    global.fetch = vi.fn(async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: 'sched-1', scheduleNumber: '80', glAccountNumbers: ['19001'] }), { status: 201 });
    }) as any;

    const client = new ScheduleServiceClient('http://schedule-service:3018');
    const schedule = await client.createSchedule('tenant-kunes', {
      scheduleNumber: '80', title: 'Vehicle Unit Inventory', scheduleType: 1, glAccountNumbers: ['19001'], eomPurgeType: 1, reportSequence: 'C',
    });

    expect(schedule).toEqual({ id: 'sched-1', scheduleNumber: '80', glAccountNumbers: ['19001'] });
    expect(capturedBody).toEqual({ scheduleNumber: '80', title: 'Vehicle Unit Inventory', scheduleType: 1, glAccountNumbers: ['19001'], eomPurgeType: 1, reportSequence: 'C' });
  });
});
