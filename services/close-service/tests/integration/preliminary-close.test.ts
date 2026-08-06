import { describe, it, expect, vi } from 'vitest';
import { ClosePeriodService } from '../../src/application/close-service';
import { CloseState } from '../../src/domain/close-state-machine';

describe('preliminary-close (integration)', () => {
  it('transitions READY -> PRELIMINARY_CLOSED', async () => {
    const mockRepo = {
      findState: vi.fn().mockResolvedValue({ state: CloseState.READY, version: 1 }),
      upsertState: vi.fn().mockResolvedValue({ state: CloseState.PRELIMINARY_CLOSED }),
      getExceptionOverriderIds: vi.fn().mockResolvedValue([]),
    };
    const svc = new ClosePeriodService(mockRepo as any);
    const result = await svc.transition('t1', 'le1', 2026, 1, CloseState.PRELIMINARY_CLOSED, 'user1');
    expect(result.state).toBe(CloseState.PRELIMINARY_CLOSED);
  });
});
