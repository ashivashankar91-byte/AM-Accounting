#!/usr/bin/env node
/**
 * build-services.js
 *
 * Runs `npm run build` for every services/* workspace that defines a
 * "build" script, so `npm run build:all` actually builds the full backend
 * fleet instead of referencing a script that never existed. Skips
 * workspaces with no package.json or no "build" script (e.g. services with
 * no compiled output) rather than failing the whole run on them.
 *
 * Usage:
 *   node scripts/build-services.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SERVICES_DIR = path.join(REPO_ROOT, 'services');

const serviceDirs = fs
  .readdirSync(SERVICES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const results = [];

for (const name of serviceDirs) {
  const dir = path.join(SERVICES_DIR, name);
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.scripts || !pkg.scripts.build) continue;

  console.log(`==> [${name}] npm run build`);
  const result = spawnSync('npm', ['run', 'build'], { cwd: dir, stdio: 'inherit' });
  results.push({ name, status: result.status ?? 1 });
}

const failed = results.filter((r) => r.status !== 0);

console.log('\n==> Service build summary');
for (const r of results) {
  console.log(`  ${r.status === 0 ? 'OK  ' : 'FAIL'} ${r.name}`);
}

if (failed.length > 0) {
  console.error(`\n==> ${failed.length} service(s) failed to build: ${failed.map((f) => f.name).join(', ')}`);
  process.exit(1);
}

console.log(`\n==> All ${results.length} services built successfully.`);
