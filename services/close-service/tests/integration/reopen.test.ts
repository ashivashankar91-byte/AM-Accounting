import { describe, it, expect, vi } from 'vitest';
import { ClosePeriodService } from '../../src/application/close-service';
import { CloseState } from '../../src/domain/close-state-machine';

describe('reopen (integration)', () => {
  it('transitions FINAL_CLOSED -> REOPEN_PENDING_APPROVAL', async () => {
    const mockRepo = {
      findState: vi.fn().mockResolvedValue({ state: CloseState.FINAL_CLOSED, version: 1 }),
      upsertState: vi.fn().mockResolvedValue({ state: CloseState.REOPEN_PENDING_APPROVAL }),
      getExceptionOverriderIds: vi.fn().mockResolvedValue([]),
    };
    const svc = new ClosePeriodService(mockRepo as any);
    const result = await svc.transition('t1', 'le1', 2026, 1, CloseState.REOPEN_PENDING_APPROVAL, 'user1', 'correction needed');
    expect(result.state).toBe(CloseState.REOPEN_PENDING_APPROVAL);
  });
});
