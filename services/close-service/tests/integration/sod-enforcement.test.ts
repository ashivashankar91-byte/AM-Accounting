import { describe, it, expect, vi } from 'vitest';
import { ClosePeriodService } from '../../src/application/close-service';
import { CloseState, SoDViolationError } from '../../src/domain/close-state-machine';

describe('sod-enforcement (integration)', () => {
  it('prevents actor who overrode exceptions from final closing', async () => {
    const mockRepo = {
      findState: vi.fn().mockResolvedValue({ state: CloseState.PRELIMINARY_CLOSED, version: 1 }),
      upsertState: vi.fn(),
      getExceptionOverriderIds: vi.fn().mockResolvedValue(['overrider-user']),
    };
    const svc = new ClosePeriodService(mockRepo as any);
    await expect(svc.transition('t1', 'le1', 2026, 1, CloseState.FINAL_CLOSED, 'overrider-user')).rejects.toThrow(SoDViolationError);
  });

  it('allows different user to final close', async () => {
    const mockRepo = {
      findState: vi.fn().mockResolvedValue({ state: CloseState.PRELIMINARY_CLOSED, version: 1 }),
      upsertState: vi.fn().mockResolvedValue({ state: CloseState.FINAL_CLOSED }),
      getExceptionOverriderIds: vi.fn().mockResolvedValue(['overrider-user']),
    };
    const svc = new ClosePeriodService(mockRepo as any);
    const result = await svc.transition('t1', 'le1', 2026, 1, CloseState.FINAL_CLOSED, 'different-user');
    expect(result.state).toBe(CloseState.FINAL_CLOSED);
  });
});
