import { describe, it, expect } from 'vitest';
import { buildRulePacks, ROLE_FIXTURES, ACCOUNT_MAPPING_VALUES_PENDING } from '../../src/domain/rule-pack-definitions';

const EVENT_TYPE_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)*\.v[0-9]+$/;
const CE12_PACK_KEY_PREFIX = 'ce12.';
const BP_TOTAL = 10_000;

function bpSum(allocations: Array<{ bp: number }>): number {
  return allocations.reduce((s, a) => s + a.bp, 0);
}

describe('rule-pack-definitions (blank/pending mode)', () => {
  const packs = buildRulePacks({ tenantId: 'tenant-1', entityId: 'entity-1', storeId: 'store-1', testFixtureMode: false });

  it('defines exactly the 9 event-family rule packs this service owns', () => {
    expect(packs).toHaveLength(9);
  });

  it('every packKey starts with the mandatory ce12. prefix', () => {
    for (const p of packs) {
      expect((p as any).packKey.startsWith(CE12_PACK_KEY_PREFIX), (p as any).packKey).toBe(true);
    }
  });

  it('every packKey is unique', () => {
    const keys = packs.map((p) => (p as any).packKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every eventType matches coa-service\'s canonical pattern', () => {
    for (const p of packs) {
      expect(EVENT_TYPE_PATTERN.test((p as any).eventType), (p as any).eventType).toBe(true);
    }
  });

  it('every version is dslVersion 1, FIRST_MATCH, NO_RULE_MATCH_EXCEPTION, tenant/entity-scoped', () => {
    for (const p of packs as any[]) {
      expect(p.dslVersion).toBe(1);
      expect(p.matchStrategy).toBe('FIRST_MATCH');
      expect(p.noMatchBehavior).toBe('NO_RULE_MATCH_EXCEPTION');
      expect(p.tenantScope).toBe('tenant-1');
      expect(p.entityId).toBe('entity-1');
      expect(Array.isArray(p.supportedEventSchemaVersions)).toBe(true);
      expect(p.supportedEventSchemaVersions.length).toBeGreaterThan(0);
    }
  });

  it('blank mode: every allocation uses the ACCOUNT_MAPPING_VALUES_PENDING sentinel, never a real-looking account number', () => {
    for (const p of packs as any[]) {
      for (const rule of p.rules) {
        for (const group of rule.blueprint.postingGroups) {
          for (const alloc of [...group.debitAllocations, ...group.creditAllocations]) {
            expect(alloc.accountNumber).toBe(ACCOUNT_MAPPING_VALUES_PENDING);
          }
        }
      }
    }
  });

  it('blank mode: no allocation carries a deptCode (sentinel rows are exempt, per coa-service validator.ts)', () => {
    for (const p of packs as any[]) {
      for (const rule of p.rules) {
        for (const group of rule.blueprint.postingGroups) {
          for (const alloc of [...group.debitAllocations, ...group.creditAllocations]) {
            expect(alloc.deptCode).toBeUndefined();
          }
        }
      }
    }
  });

  it('every posting group\'s debit and credit basis points each sum to exactly 10000', () => {
    for (const p of packs as any[]) {
      for (const rule of p.rules) {
        for (const group of rule.blueprint.postingGroups) {
          expect(bpSum(group.debitAllocations), `${p.packKey}/${rule.ruleId}/${group.groupId} debit`).toBe(BP_TOTAL);
          expect(bpSum(group.creditAllocations), `${p.packKey}/${rule.ruleId}/${group.groupId} credit`).toBe(BP_TOTAL);
        }
      }
    }
  });

  it('every rule has a unique priority within its pack, and every ruleId is unique within its pack', () => {
    for (const p of packs as any[]) {
      const priorities = p.rules.map((r: any) => r.priority);
      const ruleIds = p.rules.map((r: any) => r.ruleId);
      expect(new Set(priorities).size, p.packKey).toBe(priorities.length);
      expect(new Set(ruleIds).size, p.packKey).toBe(ruleIds.length);
    }
  });

  it('at least one rule per pack is unconditional (condition: null) as a deterministic fallback/default — except ce12.vehicle-cost-component-added, whose 4 rules are a closed, mutually-exclusive enumeration over componentType/packRole with no residual case (any other value falls through to NO_RULE_MATCH_EXCEPTION by design, never a fabricated default posting)', () => {
    for (const p of packs as any[]) {
      if (p.packKey === 'ce12.vehicle-cost-component-added') continue;
      expect(p.rules.some((r: any) => r.condition === null), p.packKey).toBe(true);
    }
  });

  it('the vehicle-stocked pack varies the credit role by acquisitionType (trade-in / dealer-trade-in / default)', () => {
    const stocked = (packs as any[]).find((p) => p.packKey === 'ce12.vehicle-stocked');
    const conditions = stocked.rules.map((r: any) => r.condition);
    expect(conditions).toContainEqual({ equals: { path: 'payload.acquisitionType', value: 'TRADE_IN' } });
    expect(conditions).toContainEqual({ equals: { path: 'payload.acquisitionType', value: 'DEALER_TRADE_IN' } });
  });

  it('the stock-in debit allocation opens a controlNumberPath keyed by stockNumber (S074: unit-level item, applyNumber=stock#)', () => {
    const stocked = (packs as any[]).find((p) => p.packKey === 'ce12.vehicle-stocked');
    for (const rule of stocked.rules) {
      const debit = rule.blueprint.postingGroups[0].debitAllocations[0];
      expect(debit.controlNumberPath).toBe('payload.stockNumber');
    }
  });

  it('dealer-trade-outbound has exactly 3 mutually exclusive rules keyed by tradeOutcome (EVEN/GAIN/LOSS), never inventing gain/loss math', () => {
    const outbound = (packs as any[]).find((p) => p.packKey === 'ce12.vehicle-dealer-trade-outbound');
    expect(outbound.rules).toHaveLength(3);
    const outcomes = outbound.rules.map((r: any) => r.condition?.equals?.value ?? 'EVEN_DEFAULT');
    expect(outcomes.sort()).toEqual(['EVEN_DEFAULT', 'GAIN', 'LOSS'].sort());
  });

  it('dealer-trade-settled applies against (never opens) both sides via applyNumberPath keyed by tradeNumber', () => {
    const settled = (packs as any[]).find((p) => p.packKey === 'ce12.vehicle-dealer-trade-settled');
    const group = settled.rules[0].blueprint.postingGroups[0];
    expect(group.debitAllocations[0].applyNumberPath).toBe('payload.tradeNumber');
    expect(group.creditAllocations[0].applyNumberPath).toBe('payload.tradeNumber');
    expect(group.debitAllocations[0].controlNumberPath).toBeUndefined();
    expect(group.creditAllocations[0].controlNumberPath).toBeUndefined();
  });
});

describe('rule-pack-definitions (test-fixture mode)', () => {
  const packs = buildRulePacks({ tenantId: 'tenant-1', entityId: 'entity-1', storeId: 'store-1', testFixtureMode: true });

  it('every allocation resolves to a real (non-sentinel) fixture account number', () => {
    const validNumbers = new Set(Object.values(ROLE_FIXTURES).map((r) => r.accountNumber));
    for (const p of packs as any[]) {
      for (const rule of p.rules) {
        for (const group of rule.blueprint.postingGroups) {
          for (const alloc of [...group.debitAllocations, ...group.creditAllocations]) {
            expect(alloc.accountNumber).not.toBe(ACCOUNT_MAPPING_VALUES_PENDING);
            expect(validNumbers.has(alloc.accountNumber), alloc.accountNumber).toBe(true);
          }
        }
      }
    }
  });

  it('every fixture account number is <=5 chars (gl_account.account_number is VARCHAR(5))', () => {
    for (const fixture of Object.values(ROLE_FIXTURES)) {
      expect(fixture.accountNumber.length).toBeLessThanOrEqual(5);
    }
  });

  it('every fixture account name is clearly labeled as a non-production test fixture', () => {
    for (const fixture of Object.values(ROLE_FIXTURES)) {
      expect(fixture.name).toMatch(/CE-12 TEST FIXTURE/);
      expect(fixture.name).toMatch(/do not use in production/);
    }
  });

  it('P&L-typed roles (REVENUE/EXPENSE) get a deptCode; non-P&L roles do not (coa-service validator.ts MISSING_DEPT_CODE rule)', () => {
    for (const p of packs as any[]) {
      for (const rule of p.rules) {
        for (const group of rule.blueprint.postingGroups) {
          for (const alloc of [...group.debitAllocations, ...group.creditAllocations]) {
            const fixture = Object.values(ROLE_FIXTURES).find((r) => r.accountNumber === alloc.accountNumber)!;
            if (fixture.plType) expect(alloc.deptCode, `${p.packKey} ${alloc.accountNumber}`).toBeTruthy();
            else expect(alloc.deptCode, `${p.packKey} ${alloc.accountNumber}`).toBeUndefined();
          }
        }
      }
    }
  });

  it('bp sums remain exactly 10000 in test-fixture mode too', () => {
    for (const p of packs as any[]) {
      for (const rule of p.rules) {
        for (const group of rule.blueprint.postingGroups) {
          expect(bpSum(group.debitAllocations)).toBe(BP_TOTAL);
          expect(bpSum(group.creditAllocations)).toBe(BP_TOTAL);
        }
      }
    }
  });
});
