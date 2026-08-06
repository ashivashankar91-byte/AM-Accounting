import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

/**
 * S124 DoD: tax-service must have ZERO direct GL writes — it only produces
 * tax/fee results that travel INSIDE a consuming transaction's envelope
 * (owned by CE-07/CE-09/CE-11). This is a static, grep-based proof: no
 * source file under src/ may reference gl-service (a fetch call, an axios
 * call, a URL literal, or an import) anywhere.
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

describe('zero direct GL writes (S124 DoD)', () => {
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

  it('contains no journal-entry posting endpoint reference anywhere in src/', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (/journal-entr(y|ies)/i.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('contains no outbound HTTP call to a posting endpoint (fetch/axios to /api/v1/gl or /journal)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (/\/api\/v1\/gl\b/.test(content) || /\/journal-entries?\b/i.test(content)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
