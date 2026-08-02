/**
 * S020 — Condition evaluator, deterministic rule selection, and balanced
 * journal-blueprint generation unit tests. Pure, no I/O.
 */
import { describe, it, expect } from 'vitest';
import { evaluateCondition, UnknownConditionOperatorError } from '../src/domain/posting-engine/conditions';
import { selectRule, generateBlueprint, verifyBlueprint, hashBlueprint, resolveMemoTemplate, BlueprintResolutionError } from '../src/domain/posting-engine/blueprint';
import { assertEnvelopeShape, hashEnvelope } from '../src/domain/posting-engine/event-envelope';
import { RuleDefinition, RulePackDefinition } from '../src/domain/posting-engine/dsl';
import { certificationEnvelope, conflictingEnvelope, validRulePack } from './support/posting-engine-fixtures';

const TENANT = 'tenant-a';
const ENTITY = 'entity-1';

function envelope(amount = 250) {
  return assertEnvelopeShape(certificationEnvelope({ tenantId: TENANT, entityId: ENTITY, eventId: 'evt-1', amount }));
}

describe('S020 condition operators', () => {
  const env = envelope(500);

  it('equals / notEquals', () => {
    expect(evaluateCondition({ equals: { path: 'payload.amount', value: 500 } }, env)).toBe(true);
    expect(evaluateCondition({ notEquals: { path: 'payload.amount', value: 500 } }, env)).toBe(false);
  });

  it('greaterThan / greaterThanOrEqual / lessThan / lessThanOrEqual', () => {
    expect(evaluateCondition({ greaterThan: { path: 'payload.amount', value: 100 } }, env)).toBe(true);
    expect(evaluateCondition({ greaterThanOrEqual: { path: 'payload.amount', value: 500 } }, env)).toBe(true);
    expect(evaluateCondition({ lessThan: { path: 'payload.amount', value: 100 } }, env)).toBe(false);
    expect(evaluateCondition({ lessThanOrEqual: { path: 'payload.amount', value: 500 } }, env)).toBe(true);
  });

  it('in / notIn', () => {
    expect(evaluateCondition({ in: { path: 'sourceEntityType', values: ['CERT_FIXTURE', 'OTHER'] } }, env)).toBe(true);
    expect(evaluateCondition({ notIn: { path: 'sourceEntityType', values: ['OTHER'] } }, env)).toBe(true);
  });

  it('exists / isNull / isNotNull', () => {
    expect(evaluateCondition({ exists: { path: 'payload.amount' } }, env)).toBe(true);
    expect(evaluateCondition({ exists: { path: 'payload.doesNotExist' } }, env)).toBe(false);
    expect(evaluateCondition({ isNull: { path: 'causationId' } }, env)).toBe(true);
    expect(evaluateCondition({ isNotNull: { path: 'eventId' } }, env)).toBe(true);
  });

  it('and / or / not compose', () => {
    expect(evaluateCondition({ and: [{ exists: { path: 'payload.amount' } }, { equals: { path: 'payload.amount', value: 500 } }] }, env)).toBe(true);
    expect(evaluateCondition({ or: [{ equals: { path: 'payload.amount', value: 1 } }, { equals: { path: 'payload.amount', value: 500 } }] }, env)).toBe(true);
    expect(evaluateCondition({ not: { equals: { path: 'payload.amount', value: 1 } } }, env)).toBe(true);
  });

  it('an unknown operator throws', () => {
    expect(() => evaluateCondition({ bogus: {} } as any, env)).toThrow(UnknownConditionOperatorError);
  });
});

describe('S020 selectRule — deterministic priority, first match wins', () => {
  const env = envelope(500);

  it('an unconditional rule matches', () => {
    const pack = validRulePack({ tenantId: TENANT, entityId: ENTITY, drAccountNumber: '10000', crAccountNumber: '10100', journalSourceCode: 'CERT' }) as unknown as RulePackDefinition;
    const match = selectRule(pack, env);
    expect(match?.rule.ruleId).toBe('unconditional-cert-rule');
  });

  it('rules evaluate in ascending priority order and the first match wins, regardless of array order', () => {
    const low: RuleDefinition = { ruleId: 'low-priority', priority: 10, description: 'low', condition: null, blueprint: { postingGroups: [] } };
    const high: RuleDefinition = { ruleId: 'high-priority', priority: 1, description: 'high', condition: null, blueprint: { postingGroups: [] } };
    const pack: RulePackDefinition = {
      dslVersion: 1, packKey: 'p', semver: '1.0.0', eventType: 'x', supportedEventSchemaVersions: ['1.0'],
      tenantScope: TENANT, entityId: ENTITY, effectiveFrom: '2020-01-01T00:00:00.000Z', journalSourceCode: 'CERT',
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [low, high], // deliberately out of priority order in the array
    };
    expect(selectRule(pack, env)?.rule.ruleId).toBe('high-priority');
  });

  it('a rule with a false condition is skipped in favor of the next matching rule', () => {
    const never: RuleDefinition = { ruleId: 'never', priority: 1, description: 'never matches', condition: { equals: { path: 'payload.amount', value: -1 } }, blueprint: { postingGroups: [] } };
    const always: RuleDefinition = { ruleId: 'always', priority: 2, description: 'always matches', condition: null, blueprint: { postingGroups: [] } };
    const pack: RulePackDefinition = {
      dslVersion: 1, packKey: 'p', semver: '1.0.0', eventType: 'x', supportedEventSchemaVersions: ['1.0'],
      tenantScope: TENANT, entityId: ENTITY, effectiveFrom: '2020-01-01T00:00:00.000Z', journalSourceCode: 'CERT',
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [never, always],
    };
    expect(selectRule(pack, env)?.rule.ruleId).toBe('always');
  });

  it('returns null when no rule matches', () => {
    const never: RuleDefinition = { ruleId: 'never', priority: 1, description: 'never', condition: { equals: { path: 'payload.amount', value: -1 } }, blueprint: { postingGroups: [] } };
    const pack: RulePackDefinition = {
      dslVersion: 1, packKey: 'p', semver: '1.0.0', eventType: 'x', supportedEventSchemaVersions: ['1.0'],
      tenantScope: TENANT, entityId: ENTITY, effectiveFrom: '2020-01-01T00:00:00.000Z', journalSourceCode: 'CERT',
      matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules: [never],
    };
    expect(selectRule(pack, env)).toBeNull();
  });
});

describe('S020 generateBlueprint — decimal-money, deterministic rounding, stable line order', () => {
  it('a required source value missing (baseAmountPath resolves to nothing) fails clearly', () => {
    const rule: RuleDefinition = {
      ruleId: 'r1', priority: 1, description: 'd', condition: null,
      blueprint: { postingGroups: [{ groupId: 'g1', baseAmountPath: 'payload.doesNotExist', debitAllocations: [{ accountNumber: '10000', storeId: 's1', bp: 10000 }], creditAllocations: [{ accountNumber: '10100', storeId: 's1', bp: 10000 }] }] },
    };
    expect(() => generateBlueprint(rule, envelope(500))).toThrow(BlueprintResolutionError);
  });

  it('produces a balanced two-line blueprint for a single 10000bp/10000bp group', () => {
    const rule: RuleDefinition = {
      ruleId: 'r1', priority: 1, description: 'd', condition: null,
      blueprint: {
        memoTemplate: 'Cert for {{sourceEntityId}}',
        postingGroups: [{ groupId: 'g1', baseAmountPath: 'payload.amount', debitAllocations: [{ accountNumber: '10000', storeId: 's1', bp: 10000 }], creditAllocations: [{ accountNumber: '10100', storeId: 's1', bp: 10000 }] }],
      },
    };
    const env = envelope(123.45);
    const lines = generateBlueprint(rule, env);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountNumber: '10000', dr: 123.45, cr: 0 });
    expect(lines[1]).toMatchObject({ accountNumber: '10100', dr: 0, cr: 123.45 });
    expect(verifyBlueprint(lines)).toHaveLength(0);
  });

  it('rounding is deterministic: an odd amount split across multiple allocations totals exactly, with the last allocation absorbing the remainder', () => {
    const rule: RuleDefinition = {
      ruleId: 'r1', priority: 1, description: 'd', condition: null,
      blueprint: {
        postingGroups: [{
          groupId: 'g1', baseAmountPath: 'payload.amount',
          debitAllocations: [
            { accountNumber: '10000', storeId: 's1', bp: 3334 },
            { accountNumber: '10000', storeId: 's1', bp: 3333 },
            { accountNumber: '10000', storeId: 's1', bp: 3333 },
          ],
          creditAllocations: [{ accountNumber: '10100', storeId: 's1', bp: 10000 }],
        }],
      },
    };
    const lines = generateBlueprint(rule, envelope(100));
    const totalDr = lines.slice(0, 3).reduce((s, l) => s + l.dr, 0);
    expect(Math.round(totalDr * 100) / 100).toBe(100);
    expect(verifyBlueprint(lines)).toHaveLength(0);
    // Re-running with the same inputs produces byte-identical results (determinism).
    const lines2 = generateBlueprint(rule, envelope(100));
    expect(lines2).toEqual(lines);
  });

  it('memo template placeholders resolve against the event envelope', () => {
    const env = envelope(10);
    expect(resolveMemoTemplate('Posting for {{sourceEntityId}} / {{eventId}}', env)).toBe(`Posting for ${env.sourceEntityId} / ${env.eventId}`);
    expect(resolveMemoTemplate(null, env)).toBeNull();
  });

  it('blueprint hash is stable for identical inputs and changes when a line changes', () => {
    const rule: RuleDefinition = {
      ruleId: 'r1', priority: 1, description: 'd', condition: null,
      blueprint: { postingGroups: [{ groupId: 'g1', baseAmountPath: 'payload.amount', debitAllocations: [{ accountNumber: '10000', storeId: 's1', bp: 10000 }], creditAllocations: [{ accountNumber: '10100', storeId: 's1', bp: 10000 }] }] },
    };
    const lines = generateBlueprint(rule, envelope(100));
    const h1 = hashBlueprint(rule.ruleId, lines);
    const h2 = hashBlueprint(rule.ruleId, lines);
    expect(h1).toBe(h2);
    const linesChanged = generateBlueprint(rule, envelope(200));
    expect(hashBlueprint(rule.ruleId, linesChanged)).not.toBe(h1);
  });
});

describe('S020 verifyBlueprint — defensive re-verification', () => {
  it('a balanced blueprint passes', () => {
    expect(verifyBlueprint([{ accountNumber: '10000', storeId: 's1', dr: 100, cr: 0 }, { accountNumber: '10100', storeId: 's1', dr: 0, cr: 100 }])).toHaveLength(0);
  });

  it('an empty blueprint fails', () => {
    expect(verifyBlueprint([])[0].code).toBe('EMPTY_BLUEPRINT');
  });

  it('a runtime-unbalanced blueprint (tampered totals) fails defensively', () => {
    const violations = verifyBlueprint([{ accountNumber: '10000', storeId: 's1', dr: 100, cr: 0 }, { accountNumber: '10100', storeId: 's1', dr: 0, cr: 90 }]);
    expect(violations.some((v) => v.code === 'UNBALANCED_BLUEPRINT')).toBe(true);
  });

  it('a line with both debit and credit set fails', () => {
    const violations = verifyBlueprint([{ accountNumber: '10000', storeId: 's1', dr: 100, cr: 100 }]);
    expect(violations.some((v) => v.code === 'LINE_BOTH_SIDES')).toBe(true);
  });

  it('a zero-value line fails', () => {
    const violations = verifyBlueprint([{ accountNumber: '10000', storeId: 's1', dr: 0, cr: 0 }, { accountNumber: '10100', storeId: 's1', dr: 0, cr: 0 }]);
    expect(violations.some((v) => v.code === 'ZERO_VALUE_LINE')).toBe(true);
  });

  it('a blueprint with no debit line fails', () => {
    const violations = verifyBlueprint([{ accountNumber: '10100', storeId: 's1', dr: 0, cr: 100 }, { accountNumber: '10100', storeId: 's1', dr: 0, cr: 5 }]);
    expect(violations.some((v) => v.code === 'NO_DEBIT_LINE')).toBe(true);
  });
});

describe('S020 canonical event envelope hashing — idempotency identity', () => {
  it('the same logical event hashes identically across re-delivery (publishedAt differs)', () => {
    const e1 = assertEnvelopeShape(certificationEnvelope({ tenantId: TENANT, eventId: 'evt-1', amount: 100 }));
    const e2 = { ...e1, publishedAt: '2099-01-01T00:00:00.000Z' };
    expect(hashEnvelope(e1)).toBe(hashEnvelope(e2 as any));
  });

  it('a changed payload under the same eventId hashes differently (identity-conflict detection)', () => {
    const e1 = certificationEnvelope({ tenantId: TENANT, eventId: 'evt-1', amount: 100 });
    const e2 = conflictingEnvelope(e1, 999);
    expect(hashEnvelope(assertEnvelopeShape(e1))).not.toBe(hashEnvelope(assertEnvelopeShape(e2)));
  });
});
