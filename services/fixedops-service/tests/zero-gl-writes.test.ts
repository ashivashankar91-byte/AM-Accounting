import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

/**
 * CE-11 DoD: fixedops-service must have ZERO direct GL writes — every
 * journal is produced by submitting a canonical envelope to coa-service's
 * real posting-engine (POST /api/v1/coa/posting-engine/events), the one
 * legitimate door. This is a static, grep-based proof adapted from
 * services/tax-service/tests/zero-gl-writes.test.ts: no source file may
 * reference gl-service or write a Prisma journalEntry directly, but
 * references to coa-service/posting-engine ARE expected and allowed.
 */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full));
    else if (/\.(ts|tsx|js)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('zero direct GL writes (CE-11 DoD)', () => {
  const srcDir = join(__dirname, '..', 'src');
  const files = listFiles(srcDir);

  it('scans at least the expected source files (sanity check the scan itself works)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('contains no reference to gl-service anywhere in src/', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (/gl-service/i.test(readFileSync(file, 'utf8'))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('contains no direct Prisma journalEntry write anywhere in src/', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (/\.journalEntry\.(create|update|upsert|delete)/i.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('posts exclusively through coa-service\'s posting-engine door', () => {
    const posting = readFileSync(join(srcDir, 'infrastructure', 'posting-client.ts'), 'utf8');
    expect(posting).toContain('/api/v1/coa/posting-engine/events');
  });
});
