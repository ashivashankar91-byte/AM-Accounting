/**
 * Initialises all service tables in the shared DB.
 * Uses CREATE TABLE IF NOT EXISTS to be idempotent.
 * Run: node init-db.mjs
 */
import pg from 'pg';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';

function genSql(relSchema) {
  const abs = join(__dir, relSchema);
  const cwd = join(__dir, dirname(relSchema));
  return execSync(
    `npx prisma migrate diff --from-empty --to-schema-datamodel "${abs}" --script`,
    { cwd, env: { ...process.env, DATABASE_URL: DB_URL } },
  ).toString();
}

console.log('Generating schema SQL for each service…');
const glSql   = genSql('services/gl-service/prisma/schema.prisma');
const schedSql = genSql('services/schedule-service/prisma/schema.prisma');
console.log(`GL: ${glSql.length} chars, Schedule: ${schedSql.length} chars`);

// Statements are separated by double newlines after the semicolon
function extractStatements(sql) {
  // Prisma emits: `-- Comment\nSTATEMENT;\n\n`
  // Split on `;\n` (end of each statement)
  const parts = sql.split(/;\r?\n/);
  return parts
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => {
      // Remove leading comment lines
      const lines = s.split('\n').filter(l => !l.trim().startsWith('--'));
      return lines.join('\n').trim();
    })
    .filter(s => s.length > 0);
}

const glStmts   = extractStatements(glSql);
const schedStmts = extractStatements(schedSql);
console.log(`GL statements: ${glStmts.length}, Schedule statements: ${schedStmts.length}`);

// Deduplicate by first 100 chars, prioritise GL (it goes first)
const seen = new Set();
const allStmts = [];
for (const stmt of [...glStmts, ...schedStmts]) {
  const key = stmt.slice(0, 100).replace(/\s+/g, ' ');
  if (seen.has(key)) continue;
  seen.add(key);
  allStmts.push(stmt);
}
console.log(`Total unique statements: ${allStmts.length}`);

// Make CREATE TABLE statements idempotent
const idempotentStmts = allStmts.map(s =>
  s.replace(/^CREATE TABLE "/, 'CREATE TABLE IF NOT EXISTS "')
   .replace(/^CREATE UNIQUE INDEX /, 'CREATE UNIQUE INDEX IF NOT EXISTS ')
   .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS ')
);

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();
console.log('\nApplying statements…');

let ok = 0, skipped = 0, failed = 0;
for (const stmt of idempotentStmts) {
  try {
    await client.query(stmt);
    ok++;
  } catch (err) {
    const msg = err.message ?? String(err);
    if (msg.includes('already exists') || msg.includes('duplicate')) {
      skipped++;
    } else {
      const preview = stmt.slice(0, 100).replace(/\s+/g, ' ');
      console.error(`FAILED: ${preview}`);
      console.error(`  → ${msg}`);
      failed++;
    }
  }
}

const tables = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
);
const cols = await client.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='gl_accounts'
   ORDER BY ordinal_position`,
);
console.log(`\nTables: ${tables.rows.map(r => r.table_name).join(', ')}`);
console.log(`gl_accounts columns: ${cols.rows.map(r => r.column_name).join(', ')}`);
console.log(`\nResult: ${ok} applied, ${skipped} skipped, ${failed} failed`);
await client.end();
if (failed > 0) process.exit(1);
