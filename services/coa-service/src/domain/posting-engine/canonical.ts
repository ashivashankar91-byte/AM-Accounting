// S019 — Canonical serialization + stable content hashing for a parsed rule
// pack definition. Pure, no I/O.

import crypto from 'crypto';
import { RulePackDefinition } from './dsl';
import { canonicalStringify, deepFreeze } from './strict-json';

/** Stable sha256 content hash of a rule pack definition — same logical pack always hashes identically. */
export function hashRulePack(pack: RulePackDefinition): string {
  return crypto.createHash('sha256').update(canonicalStringify(pack)).digest('hex');
}

/** Freeze the parsed definition into an immutable internal AST (BR S019-4). */
export function freezeRulePack(pack: RulePackDefinition): Readonly<RulePackDefinition> {
  return deepFreeze(pack);
}
