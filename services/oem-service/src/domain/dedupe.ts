import { createHash } from 'crypto';

/**
 * S098 dedupe key: make + kind + natural document key (statement id/date/
 * dealer code) — deliberately NOT a hash of raw bytes, so a byte-identical
 * re-delivery dedupes silently while ANY content change on the same natural
 * document raises a diff alert instead of being treated as a brand-new,
 * unrelated document.
 */
export function computeDocumentIdentity(tenantId: string, make: string, kind: string, naturalKey: string): string {
  const raw = `${tenantId}::${make.toUpperCase()}::${kind}::${naturalKey.trim().toUpperCase()}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 64);
}

/** Byte-identical-redelivery check — the actual dedupe comparison. */
export function computeContentHash(rawContent: string): string {
  return createHash('sha256').update(rawContent).digest('hex');
}
