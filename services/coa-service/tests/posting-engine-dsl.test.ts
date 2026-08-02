/**
 * S019 — Posting DSL v1 parser + validator unit tests. Pure, no DB/network —
 * the account-reference check uses a small in-memory fake lookup.
 */
import { describe, it, expect } from 'vitest';
import { parseStrictJson, StrictJsonParseError, canonicalStringify, deepFreeze } from '../src/domain/posting-engine/strict-json';
import { validateRulePackSource, AccountLookup } from '../src/domain/posting-engine/validator';
import { hashRulePack, freezeRulePack } from '../src/domain/posting-engine/canonical';
import { ACCOUNT_MAPPING_VALUES_PENDING } from '../src/domain/posting-engine/dsl';
import { validRulePack, unbalancedRulePack } from './support/posting-engine-fixtures';

const TENANT = 'tenant-a';
const ENTITY = 'entity-1';

const FAKE_ACCOUNTS: Record<string, { accountNumber: string; type: string; postable: boolean; status: string }> = {
  '10000': { accountNumber: '10000', type: 'ASSET', postable: true, status: 'ACTIVE' },
  '10100': { accountNumber: '10100', type: 'ASSET', postable: true, status: 'ACTIVE' },
  '49000': { accountNumber: '49000', type: 'REVENUE', postable: true, status: 'ACTIVE' },
  'NOTPOSTABLE': { accountNumber: 'NOTPOSTABLE', type: 'ASSET', postable: false, status: 'ACTIVE' },
  'INACTIVE1': { accountNumber: 'INACTIVE1', type: 'ASSET', postable: true, status: 'INACTIVE' },
};

const lookup: AccountLookup = async (_entityId, accountNumber) => FAKE_ACCOUNTS[accountNumber] ?? null;

function baseOpts() {
  return { tenantId: TENANT, entityId: ENTITY, drAccountNumber: '10000', crAccountNumber: '10100', journalSourceCode: 'CERT' };
}

describe('S019 strict JSON parser', () => {
  it('parses well-formed JSON', () => {
    expect(parseStrictJson('{"a":1,"b":[1,2,3],"c":null,"d":true}')).toEqual({ a: 1, b: [1, 2, 3], c: null, d: true });
  });

  it('rejects malformed JSON', () => {
    expect(() => parseStrictJson('{"a":1,')).toThrow(StrictJsonParseError);
    expect(() => parseStrictJson('not json at all')).toThrow(StrictJsonParseError);
  });

  it('rejects duplicate object keys (JSON.parse would silently accept this)', () => {
    expect(() => parseStrictJson('{"a":1,"a":2}')).toThrow(/Duplicate object key/);
  });

  it('canonicalStringify is stable regardless of key order', () => {
    const a = canonicalStringify({ z: 1, a: 2, nested: { b: 1, a: 2 } });
    const b = canonicalStringify({ nested: { a: 2, b: 1 }, a: 2, z: 1 });
    expect(a).toBe(b);
  });

  it('deepFreeze prevents mutation of the parsed AST', () => {
    const frozen = deepFreeze({ rules: [{ ruleId: 'r1' }] }) as any;
    expect(() => { frozen.rules[0].ruleId = 'changed'; }).toThrow(TypeError);
  });
});

describe('S019 validateRulePackSource — happy path', () => {
  it('a valid certification rule pack parses and validates cleanly', async () => {
    const pack = validRulePack(baseOpts());
    const result = await validateRulePackSource(JSON.stringify(pack), TENANT, lookup);
    expect(result.valid).toBe(true);
    expect(result.findings.filter((f) => f.severity === 'ERROR')).toHaveLength(0);
    expect(result.pack).toBeTruthy();
  });

  it('canonical content hash is stable for the same logical pack regardless of key order', () => {
    const pack = validRulePack(baseOpts());
    const reordered = JSON.parse(JSON.stringify(pack));
    const h1 = hashRulePack(freezeRulePack(pack as any));
    const h2 = hashRulePack(freezeRulePack(reordered));
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonical content hash changes when content changes', () => {
    const pack = validRulePack(baseOpts());
    const changed = { ...pack, semver: '2.0.0' };
    expect(hashRulePack(freezeRulePack(pack as any))).not.toBe(hashRulePack(freezeRulePack(changed as any)));
  });
});

describe('S019 validateRulePackSource — structural/semantic errors', () => {
  async function expectError(mutate: (p: any) => void, codeOrPattern: string | RegExp) {
    const pack: any = validRulePack(baseOpts());
    mutate(pack);
    const result = await validateRulePackSource(JSON.stringify(pack), TENANT, lookup);
    expect(result.valid).toBe(false);
    const match = result.findings.some((f) => f.severity === 'ERROR' && (typeof codeOrPattern === 'string' ? f.code === codeOrPattern : codeOrPattern.test(f.code)));
    expect(match, `expected a finding matching ${codeOrPattern}, got: ${JSON.stringify(result.findings)}`).toBe(true);
  }

  it('malformed JSON fails with JSON_PARSE_ERROR', async () => {
    const result = await validateRulePackSource('{not valid', TENANT, lookup);
    expect(result.valid).toBe(false);
    expect(result.findings[0].code).toBe('JSON_PARSE_ERROR');
  });

  it('duplicate JSON object keys fail', async () => {
    const result = await validateRulePackSource('{"dslVersion":1,"dslVersion":2}', TENANT, lookup);
    expect(result.valid).toBe(false);
    expect(result.findings[0].code).toBe('JSON_PARSE_ERROR');
  });

  it('unsupported dslVersion fails', () => expectError((p) => { p.dslVersion = 2; }, 'UNSUPPORTED_DSL_VERSION'));

  it('unknown top-level field fails', () => expectError((p) => { p.notARealField = true; }, 'UNKNOWN_FIELD'));

  it('unknown field inside a rule fails', () => expectError((p) => { p.rules[0].notARealField = true; }, 'UNKNOWN_FIELD'));

  it('duplicate rule IDs fail', () => expectError((p) => {
    p.rules.push({ ...p.rules[0], priority: 2 });
  }, 'DUPLICATE_RULE_ID'));

  it('ambiguous priorities fail', () => expectError((p) => {
    p.rules.push({ ...JSON.parse(JSON.stringify(p.rules[0])), ruleId: 'second-rule' });
  }, 'AMBIGUOUS_PRIORITY'));

  it('missing posting groups fails', () => expectError((p) => { p.rules[0].blueprint.postingGroups = []; }, 'MISSING_POSTING_GROUPS'));

  it('missing debit allocation fails', () => expectError((p) => { p.rules[0].blueprint.postingGroups[0].debitAllocations = []; }, 'MISSING_DEBIT_ALLOCATION'));

  it('missing credit allocation fails', () => expectError((p) => { p.rules[0].blueprint.postingGroups[0].creditAllocations = []; }, 'MISSING_CREDIT_ALLOCATION'));

  it('debit allocation basis points not totaling 10000 fails', () => expectError((p) => {
    p.rules[0].blueprint.postingGroups[0].debitAllocations[0].bp = 9000;
  }, 'DEBIT_BP_NOT_10000'));

  it('credit allocation basis points not totaling 10000 fails', () => expectError((p) => {
    p.rules[0].blueprint.postingGroups[0].creditAllocations[0].bp = 5000;
  }, 'CREDIT_BP_NOT_10000'));

  it('zero/negative allocation basis points fail', () => expectError((p) => {
    p.rules[0].blueprint.postingGroups[0].debitAllocations[0].bp = 0;
  }, 'INVALID_ALLOCATION_BP'));

  it('an invalid/unsupported condition operator fails', () => expectError((p) => {
    p.rules[0].condition = { madeUpOperator: { path: 'payload.amount', value: 1 } };
  }, 'UNSUPPORTED_OPERATOR'));

  it('a condition referencing a disallowed event path (root not in the envelope) fails', () => expectError((p) => {
    p.rules[0].condition = { equals: { path: 'notARealEnvelopeRoot.amount', value: 1 } };
  }, 'INVALID_EVENT_PATH'));

  it('a baseAmountPath outside the allowed envelope roots fails', () => expectError((p) => {
    p.rules[0].blueprint.postingGroups[0].baseAmountPath = 'notARealRoot.amount';
  }, 'INVALID_EVENT_PATH'));

  it('invalid effective-date range (effectiveTo before effectiveFrom) fails', () => expectError((p) => {
    p.effectiveFrom = '2026-06-01T00:00:00.000Z';
    p.effectiveTo = '2026-01-01T00:00:00.000Z';
  }, 'INVALID_EFFECTIVE_RANGE'));

  it('tenantScope not matching the authenticated tenant fails', () => expectError((p) => { p.tenantScope = 'someone-else'; }, 'TENANT_SCOPE_MISMATCH'));

  it('an unbalanced fixture rule pack fails validation (debit bp != 10000)', async () => {
    const pack = unbalancedRulePack(baseOpts());
    const result = await validateRulePackSource(JSON.stringify(pack), TENANT, lookup);
    expect(result.valid).toBe(false);
    expect(result.findings.some((f) => f.code === 'DEBIT_BP_NOT_10000')).toBe(true);
  });

  it('a reference to a non-existent account fails', () => expectError((p) => {
    p.rules[0].blueprint.postingGroups[0].debitAllocations[0].accountNumber = 'DOES-NOT-EXIST';
  }, 'ACCOUNT_NOT_FOUND'));

  it('a reference to a non-postable account fails', () => expectError((p) => {
    p.rules[0].blueprint.postingGroups[0].debitAllocations[0].accountNumber = 'NOTPOSTABLE';
  }, 'ACCOUNT_NOT_POSTABLE'));

  it('a reference to an inactive account fails', () => expectError((p) => {
    p.rules[0].blueprint.postingGroups[0].debitAllocations[0].accountNumber = 'INACTIVE1';
  }, 'ACCOUNT_NOT_ACTIVE'));

  it('a P&L (REVENUE/EXPENSE) account allocation missing deptCode fails', () => expectError((p) => {
    p.rules[0].blueprint.postingGroups[0].creditAllocations[0].accountNumber = '49000';
  }, 'MISSING_DEPT_CODE'));
});

describe('CE-12/S024 ACCOUNT_MAPPING_VALUES_PENDING sentinel', () => {
  it('a row authored with the pending-mapping sentinel validates (WARNING, not ERROR) even though the account does not exist', async () => {
    const pack = validRulePack(baseOpts());
    (pack.rules[0].blueprint.postingGroups[0].debitAllocations[0] as any).accountNumber = ACCOUNT_MAPPING_VALUES_PENDING;
    const result = await validateRulePackSource(JSON.stringify(pack), TENANT, lookup);
    expect(result.valid).toBe(true);
    expect(result.findings.some((f) => f.code === 'ACCOUNT_MAPPING_VALUES_PENDING' && f.severity === 'WARNING')).toBe(true);
    expect(result.findings.some((f) => f.severity === 'ERROR')).toBe(false);
  });

  it('a pending-mapping row on a P&L account is not forced to carry a deptCode (account type is unknown until mapped)', async () => {
    const pack = validRulePack(baseOpts());
    (pack.rules[0].blueprint.postingGroups[0].creditAllocations[0] as any).accountNumber = ACCOUNT_MAPPING_VALUES_PENDING;
    const result = await validateRulePackSource(JSON.stringify(pack), TENANT, lookup);
    expect(result.valid).toBe(true);
    expect(result.findings.some((f) => f.code === 'MISSING_DEPT_CODE')).toBe(false);
  });
});
