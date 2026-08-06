import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

/**
 * CE-11 DoD: parts-accounting-service must have ZERO direct/uncontrolled GL
 * writes — every journal is produced by submitting a canonical
 * SourceEventEnvelope to coa-service's real posting-engine
 * (POST /api/v1/coa/posting-engine/events, src/infrastructure/posting-client.ts).
 * References to coa-service / posting-engine/events (the single allowed
 * door) are expected and fine; direct gl-service calls or Prisma
 * journalEntry writes are not.
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

describe('zero direct/uncontrolled GL writes (CE-11 DoD)', () => {
  const srcDir = join(__dirname, '..', 'src');
  const files = listFiles(srcDir);

  it('scans at least the expected source files (sanity check the scan itself works)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('contains no reference to gl-service anywhere in src/', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (/gl-service/i.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('never writes to a Prisma journalEntry/journalLine delegate directly', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (/\.journalEntry\.(create|update|upsert)/.test(content) || /\.journalLine\.(create|update|upsert)/.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('the only outbound posting call is to coa-service posting-engine/events', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      // Any fetch()/URL touching a posting-ish path must be the one allowed door.
      const postingLikeUrls = content.match(/\/api\/v1\/[a-z-]+\/(journal-entr(y|ies)|post)[a-z/-]*/gi) ?? [];
      for (const url of postingLikeUrls) {
        if (!url.includes('posting-engine/events')) offenders.push(`${file}: ${url}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
