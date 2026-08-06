import { describe, it, expect, vi } from 'vitest';
import { ClosePeriodService } from '../../src/application/close-service';
import { CloseState } from '../../src/domain/close-state-machine';

describe('final-close (integration)', () => {
  it('transitions PRELIMINARY_CLOSED -> FINAL_CLOSED', async () => {
    const mockRepo = {
      findState: vi.fn().mockResolvedValue({ state: CloseState.PRELIMINARY_CLOSED, version: 1 }),
      upsertState: vi.fn().mockResolvedValue({ state: CloseState.FINAL_CLOSED }),
      getExceptionOverriderIds: vi.fn().mockResolvedValue([]),
    };
    const svc = new ClosePeriodService(mockRepo as any);
    const result = await svc.transition('t1', 'le1', 2026, 1, CloseState.FINAL_CLOSED, 'user1');
    expect(result.state).toBe(CloseState.FINAL_CLOSED);
  });
});
