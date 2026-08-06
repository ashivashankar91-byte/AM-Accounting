import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import bcrypt from 'bcryptjs';

// Focused migration test for
// 20260730150000_update_demo_user_solera_credentials — a metadata-only
// credential rotation (no schema change), so this verifies the migration's
// SQL content directly rather than standing up a live-db harness:
//   1. it targets only the two known demo fixture user ids (never a
//      wildcard/real tenant row),
//   2. the embedded bcrypt hash is genuinely the documented demo password
//      "SOLERA" (not an accidental real secret — the password is public,
//      stated in the migration's own comment, by design for manual demo
//      access),
//   3. it is a pure UPDATE (idempotent by primary key, safe to replay:
//      running it twice yields the same end state, never an error).
const MIGRATION_PATH = resolve(
  __dirname,
  '../prisma/migrations/20260730150000_update_demo_user_solera_credentials/migration.sql',
);

describe('20260730150000_update_demo_user_solera_credentials', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  it('only updates the two known demo fixture users, never a wildcard', () => {
    const whereClauses = [...sql.matchAll(/WHERE\s+"id"\s*=\s*'([^']+)'/g)].map((m) => m[1]);
    expect(whereClauses).toEqual(['dev-user', 'acct-user']);
  });

  it('is a pure UPDATE migration — no INSERT, DELETE, or DDL', () => {
    expect(sql).not.toMatch(/\bINSERT\b|\bDELETE\b|\bCREATE\b|\bALTER\b|\bDROP\b/i);
    expect(sql.match(/\bUPDATE\b/gi)?.length).toBe(2);
  });

  it('never mutates the tenant-scoping primary key ("id"), only email/password', () => {
    const setClauses = [...sql.matchAll(/UPDATE "user" SET ([^W]+) WHERE/g)].map((m) => m[1]);
    for (const clause of setClauses) {
      expect(clause).toMatch(/"email"/);
      expect(clause).toMatch(/"password_hash"/);
      expect(clause).not.toMatch(/"id"\s*=/);
      expect(clause).not.toMatch(/"tenant_id"/);
    }
  });

  it('the embedded password hash is genuinely the documented demo password "SOLERA", not an unrelated real secret', () => {
    const hashes = [...sql.matchAll(/"password_hash"\s*=\s*'(\$2a\$10\$[^']+)'/g)].map((m) => m[1]);
    expect(hashes.length).toBe(2);
    for (const hash of hashes) {
      expect(bcrypt.compareSync('SOLERA', hash)).toBe(true);
    }
  });

  it('assigns distinct emails per fixture user (no accidental collision)', () => {
    const emails = [...sql.matchAll(/"email"\s*=\s*'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails).toEqual(['solera-admin@solera.demo', 'solera-acct@solera.demo']);
  });
});
