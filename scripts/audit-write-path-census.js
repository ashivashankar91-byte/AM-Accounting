#!/usr/bin/env node
/**
 * S007 write-path coverage census (Definition of Done: "100% write-path
 * coverage — census in CI"). See
 * docs/accounting-modernization/S007_WRITE_PATH_COVERAGE_CENSUS.md for the
 * full scope, method, and narrative findings this script codifies as a
 * repeatable, CI-runnable check.
 *
 * Heuristic, not a full AST analysis: for each in-scope service's
 * src/application/*.ts file, this walks top-level class methods and, for
 * any method whose body contains a domain-write call (.create(/.update(/
 * .delete(/.upsert( on a model that is NOT itself an outbox/event table),
 * requires the SAME method body to also reference an audit write — either
 * directly (`auditOutboxEvent`) or via a known audit-wrapping helper call
 * (`this.audit(`, `this._audit(`, `this._auditTx(`). Methods explicitly
 * listed in ALLOWLIST are exempted, each with a recorded, human-reviewable
 * reason (matching the deliberate exceptions documented in the census
 * markdown) rather than silently skipped.
 *
 * Run: node scripts/audit-write-path-census.js
 * Exit 0 = every in-scope write site has audit coverage or a documented
 * exemption. Exit 1 = a genuinely uncovered write site was found.
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// §1 of the census markdown: scope is the certified live stack only.
// gl-service and every R1+ service are explicitly out of scope until their
// own onboarding/census happens.
const IN_SCOPE_SERVICES = ['coa-service', 'auth-service', 'tenant-service', 'audit-service'];

// Models that are themselves outbox/event/audit tables, or pure read-model
// projections that are a *consequence* of an audited write elsewhere in the
// same transaction (S207 projection tables) — writing to these is not
// itself a "domain write requiring its own audit trail" finding.
const EXEMPT_MODELS = new Set([
  'auditOutboxEvent', 'auditLog', 'auditChainAnchor',
  'authzOutboxEvent', // iam.authz.denied — itself an audit event, drained to audit-service by AuditOutboxDrainer (auth-service/src/index.ts)
  'coaOutboxEvent', 'tenantOutboxEvent',
  'authzRoleAssignment', // S207 projection write, always made in the same tx as its owning role/assignment write (verified by call-site inspection, not by this heuristic)
]);

// Private helper methods whose write is only ever made as part of a caller
// method's own transaction (already audited at the call site) — this
// script's per-method heuristic cannot see across call boundaries, so these
// are recorded explicitly, with the caller(s) that prove coverage.
const HELPER_ALLOWLIST = [
  { service: 'auth-service', file: 'role-service.ts', method: '_projectAssignment', reason: 'S207 projection write, always invoked inside grantAssignment()/revokeAssignment()\'s own $transaction alongside this._audit(...) — see those methods.' },
];

// Methods with a documented, reasoned exemption — see census §5 finding 3
// (login/logout availability requirement) and helper methods that
// themselves *implement* the audit write (auditing the auditor is
// meaningless).
const ALLOWLIST = [
  { service: 'auth-service', file: 'user-service.ts', method: 'login', reason: 'BR: an audit-store outage must never flip an already-decided auth outcome (existing certified test tests/user-login.test.ts).' },
  { service: 'auth-service', file: 'user-service.ts', method: 'logout', reason: 'Same non-fatal-audit requirement as login.' },
  { service: 'auth-service', file: 'user-service.ts', method: '_recordLoginDenied', reason: 'Same non-fatal-audit requirement as login; also must never leak account existence via audit-failure behavior.' },
  { service: 'audit-service', file: 'audit-service.ts', method: 'log', reason: 'This method IS the AuditPort write itself — auditing the audit write is not a meaningful requirement.' },
];

function isAllowed(service, file, method) {
  return ALLOWLIST.some((a) => a.service === service && a.file === file && a.method === method)
    || HELPER_ALLOWLIST.some((a) => a.service === service && a.file === file && a.method === method);
}

/** Extract `async methodName(...) { ... }` bodies via brace counting (handles
 * nested braces/template literals well enough for this codebase's style —
 * not a full parser). */
function extractMethods(source) {
  const methods = [];
  const methodStart = /(?:private\s+|public\s+|protected\s+)?(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/g;
  let match;
  while ((match = methodStart.exec(source))) {
    const name = match[1];
    if (['constructor', 'if', 'for', 'while', 'switch', 'catch'].includes(name)) continue;
    let depth = 1;
    let i = match.index + match[0].length;
    const bodyStart = i;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    methods.push({ name, body: source.slice(bodyStart, i - 1) });
  }
  return methods;
}

function findWriteCalls(body) {
  const writeCallRe = /\b(?:tx|this\.prisma)\.([a-zA-Z_$][\w$]*)\.(create|update|delete|upsert)\(/g;
  const found = [];
  let m;
  while ((m = writeCallRe.exec(body))) {
    found.push(m[1]);
  }
  return found;
}

function hasAuditReference(body) {
  return /auditOutboxEvent|authzOutboxEvent|\bthis\._?(?:write)?[Aa]udit(?:Tx)?\(/.test(body);
}

function census() {
  const findings = [];
  let sitesChecked = 0;

  for (const service of IN_SCOPE_SERVICES) {
    const appDir = path.join(REPO_ROOT, 'services', service, 'src', 'application');
    if (!fs.existsSync(appDir)) continue;
    for (const file of fs.readdirSync(appDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const source = fs.readFileSync(path.join(appDir, file), 'utf8');
      for (const { name, body } of extractMethods(source)) {
        const writes = findWriteCalls(body).filter((model) => !EXEMPT_MODELS.has(model));
        if (writes.length === 0) continue;
        sitesChecked++;
        if (hasAuditReference(body)) continue;
        if (isAllowed(service, file, name)) continue;
        findings.push({ service, file, method: name, models: writes });
      }
    }
  }

  return { findings, sitesChecked };
}

const { findings, sitesChecked } = census();

console.log(`S007 write-path coverage census: ${sitesChecked} write-bearing method(s) checked across ${IN_SCOPE_SERVICES.join(', ')}.`);
if (findings.length > 0) {
  console.error(`\nFAIL — ${findings.length} write site(s) with no audit coverage and no documented exemption:\n`);
  for (const f of findings) {
    console.error(`  ${f.service}/src/application/${f.file} :: ${f.method}()  writes: ${f.models.join(', ')}`);
  }
  console.error('\nEither couple an auditOutboxEvent write into the same transaction, or add a');
  console.error('reasoned entry to ALLOWLIST in this script AND to the census markdown.');
  process.exit(1);
}
console.log('PASS — every in-scope write site has audit coverage or a documented, reasoned exemption.');
