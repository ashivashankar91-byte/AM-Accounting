import { createHash } from 'crypto';

export function computeRenderedHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function verifySnapshotIntegrity(
  stored: { sourceTbHash: string; renderedHash: string },
  current: { sourceTbHash: string; renderedContent: string }
): boolean {
  const currentRenderedHash = computeRenderedHash(current.renderedContent);
  return stored.sourceTbHash === current.sourceTbHash && stored.renderedHash === currentRenderedHash;
}
