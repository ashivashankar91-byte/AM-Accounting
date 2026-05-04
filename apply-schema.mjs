// Applies all service schema CREATE TABLE IF NOT EXISTS statements to the shared DB.
// Run: node apply-schema.mjs
import pg from 'pg';
import { readFileSync } from 'fs';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';
const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
console.log('Connected to Postgres');

const sql = readFileSync('./combined-init.sql', 'utf-8');

// Split on statement boundaries (semicolons), skip blanks
const statements = sql
  .split(/;\s*\n/)
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

let ok = 0, skipped = 0, failed = 0;

for (const stmt of statements) {
  const preview = stmt.slice(0, 80).replace(/\s+/g, ' ');
  try {
    await client.query(stmt);
    ok++;
  } catch (err) {
    const msg = err.message ?? String(err);
    if (msg.includes('already exists')) {
      skipped++;
    } else {
      console.error(`FAILED: ${preview}`);
      console.error(`  Error: ${msg}`);
      failed++;
    }
  }
}

console.log(`\nDone: ${ok} applied, ${skipped} already-existed, ${failed} failed`);
await client.end();

if (failed > 0) process.exit(1);
