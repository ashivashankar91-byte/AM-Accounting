import { describe, it, expect, vi } from 'vitest';
import { ClosePeriodService } from '../../src/application/close-service';
import { CloseState } from '../../src/domain/close-state-machine';

const mockRepo = {
  findState: vi.fn(),
  upsertState: vi.fn(),
  getExceptionOverriderIds: vi.fn().mockResolvedValue([]),
};

describe('close-transitions (integration)', () => {
  it('transitions from NOT_READY to READY', async () => {
    mockRepo.findState.mockResolvedValue(null);
    mockRepo.upsertState.mockResolvedValue({ state: CloseState.READY });
    const svc = new ClosePeriodService(mockRepo as any);
    const result = await svc.transition('t1', 'le1', 2026, 1, CloseState.READY, 'user1');
    expect(result.state).toBe(CloseState.READY);
  });

  it('throws on invalid transition', async () => {
    mockRepo.findState.mockResolvedValue({ state: CloseState.FINAL_CLOSED, version: 1 });
    mockRepo.getExceptionOverriderIds.mockResolvedValue([]);
    const svc = new ClosePeriodService(mockRepo as any);
    await expect(svc.transition('t1', 'le1', 2026, 1, CloseState.READY, 'user1')).rejects.toThrow();
  });
});
