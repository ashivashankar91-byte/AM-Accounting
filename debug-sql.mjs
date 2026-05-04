import { execSync } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';

const abs = join(__dir, 'services/gl-service/prisma/schema.prisma');
const out = execSync(
  `npx prisma migrate diff --from-empty --to-schema-datamodel "${abs}" --script`,
  { cwd: join(__dir, 'services/gl-service'), env: { ...process.env, DATABASE_URL: DB_URL } },
).toString();

console.log('SQL length:', out.length);
console.log('First 500 chars:');
console.log(JSON.stringify(out.slice(0, 500)));
console.log('\nSemicolon positions (first 10):');
let count = 0;
for (let i = 0; i < out.length && count < 10; i++) {
  if (out[i] === ';') { console.log(`  pos ${i}: ...${JSON.stringify(out.slice(i-5, i+10))}...`); count++; }
}
