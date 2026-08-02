import { describe, it, expect, vi } from 'vitest';
import { YearEndService } from '../../src/application/year-end-service';

describe('year-end-roll (integration)', () => {
  const makeRepo = () => ({
    createPreview: vi.fn().mockResolvedValue({ id: 'yer1', status: 'PENDING', idempotencyKey: 'year-end:t1:le1:2025' }),
    findById: vi.fn().mockResolvedValue({ id: 'yer1', status: 'APPROVED' }),
    approve: vi.fn().mockResolvedValue({ id: 'yer1', status: 'APPROVED' }),
    post: vi.fn().mockResolvedValue({ id: 'yer1', status: 'POSTED', idempotencyKey: 'year-end:t1:le1:2025' }),
  });
  const makeEvents = () => ({ publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() });

  it('creates preview with idempotency key', async () => {
    const repo = makeRepo();
    const svc = new YearEndService(repo as any, makeEvents() as any);
    const result = await svc.preview('t1', 'le1', 2025, 'user1');
    expect(result.idempotencyKey).toBe('year-end:t1:le1:2025');
  });

  it('approves year-end run', async () => {
    const repo = makeRepo();
    const svc = new YearEndService(repo as any, makeEvents() as any);
    const result = await svc.approve('t1', 'yer1', 'approver1');
    expect(result.status).toBe('APPROVED');
  });

  it('posts year-end run and publishes canonical event', async () => {
    const repo = makeRepo();
    const events = makeEvents();
    const svc = new YearEndService(repo as any, events as any);
    const result = await svc.post('t1', 'yer1', 'poster1');
    expect(result.status).toBe('POSTED');
    // Verify canonical governed-posting event was published
    expect(events.publish).toHaveBeenCalledOnce();
    const published = events.publish.mock.calls[0][0];
    expect(published.type).toBe('CE15_YEAR_END_RETAINED_EARNINGS_INITIATED');
    expect(published.tenantId).toBe('t1');
    expect(published.correlationId).toBe('yer1');
  });
});
