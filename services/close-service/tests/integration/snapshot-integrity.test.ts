import { describe, it, expect, vi } from 'vitest';
import { SnapshotService } from '../../src/application/snapshot-service';
import { computeRenderedHash } from '../../src/domain/snapshot-ceremony';

describe('snapshot-integrity (integration)', () => {
  it('capture computes renderedHash', async () => {
    const mockRepo = { create: vi.fn().mockImplementation((_t, data) => Promise.resolve(data)) };
    const svc = new SnapshotService(mockRepo as any);
    const data = { legalEntityId: 'le1', periodYear: 2026, periodMonth: 1, statementType: 'BS' };
    const result = await svc.capture('t1', data);
    expect(result.renderedHash).toBe(computeRenderedHash(JSON.stringify(data)));
  });
});
