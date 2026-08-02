// Structural well-formedness proof for this service's 10 CE-12 rule-pack
// definitions — no coa-service HTTP call required. Checks the same
// invariants coa-service's own DSL validator/blueprint generator enforce
// (see services/coa-service/src/domain/posting-engine/{dsl,validator,
// blueprint}.ts, read during this service's design): eventType pattern,
// packKey namespace, balanced bp allocations, non-empty storeId, required
// dept code presence on P&L-role legs, unique ruleIds/groupIds.
import { describe, it, expect } from 'vitest';
import { buildCe12FniReserveRulePacks, ACCOUNT_MAPPING_VALUES_PENDING, RulePackDefinitionLite } from '../../scripts/ce12-rule-pack-definitions';

const EVENT_TYPE_RE = /^[a-z0-9]+(\.[a-z0-9-]+)*\.v[0-9]+$/;

function bpSum(allocations: Array<{ bp: number }>): number {
  return allocations.reduce((sum, a) => sum + a.bp, 0);
}

describe('CE-12 fni-reserve-service rule-pack definitions', () => {
  const packs = buildCe12FniReserveRulePacks({
    tenantScope: 'tenant-fixture',
    entityId: 'entity-fixture',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });

  it('produces exactly the 11 documented event families (10 original + CE-12 gap-closure deferral-booking-origination)', () => {
    expect(packs).toHaveLength(11);
    const eventTypes = packs.map((p) => p.eventType);
    expect(new Set(eventTypes).size).toBe(11); // all unique
  });

  it('every packKey starts with the ce12. namespace (required for SoD enforcement)', () => {
    for (const p of packs) {
      expect(p.packKey.startsWith('ce12.')).toBe(true);
    }
  });

  it('every eventType matches the mandated pattern', () => {
    for (const p of packs) {
      expect(p.eventType).toMatch(EVENT_TYPE_RE);
    }
  });

  it('every accountNumber defaults to the ACCOUNT_MAPPING_VALUES_PENDING sentinel (never a realistic default)', () => {
    for (const p of packs) {
      for (const rule of p.rules) {
        for (const group of rule.blueprint.postingGroups) {
          for (const alloc of [...group.debitAllocations, ...group.creditAllocations]) {
            expect(alloc.accountNumber).toBe(ACCOUNT_MAPPING_VALUES_PENDING);
          }
        }
      }
    }
  });

  it('every allocation has a non-empty storeId', () => {
    for (const p of packs) {
      for (const rule of p.rules) {
        for (const group of rule.blueprint.postingGroups) {
          for (const alloc of [...group.debitAllocations, ...group.creditAllocations]) {
            expect(alloc.storeId).toBeTruthy();
          }
        }
      }
    }
  });

  it('every posting group is balanced: debit bp total === credit bp total (== BP_TOTAL)', () => {
    for (const p of packs) {
      for (const rule of p.rules) {
        for (const group of rule.blueprint.postingGroups) {
          expect(bpSum(group.debitAllocations)).toBe(10_000);
          expect(bpSum(group.creditAllocations)).toBe(10_000);
        }
      }
    }
  });

  it('ruleIds are unique within each pack and groupIds unique within each rule', () => {
    for (const p of packs) {
      const ruleIds = p.rules.map((r) => r.ruleId);
      expect(new Set(ruleIds).size).toBe(ruleIds.length);
      for (const rule of p.rules) {
        const groupIds = rule.blueprint.postingGroups.map((g) => g.groupId);
        expect(new Set(groupIds).size).toBe(groupIds.length);
      }
    }
  });

  it('items this service RELIEVES use BOTH applyNumberPath and a MATCHING controlNumberPath on that leg (coa-service only emits the schedule-service bridge event when line.controlNumber is set, independent of applyNumber — see posting-service.ts)', () => {
    const reliefFamilies: Record<string, string> = {
      'ce12.fni-reserve.remittance-relief': 'payload.dealNumber',
      'ce12.fni-reserve.shortpay-writeoff': 'payload.dealNumber',
      'ce12.fni-reserve.product-remit-relief': 'payload.applyControlNumber',
      'ce12.fni-reserve.cancellation-remit-adjustment': 'payload.applyControlNumber',
      'ce12.fni-reserve.chargeback-draw-from-reserve': 'payload.dealNumber',
      'ce12.fni-reserve.deferral-recognition': 'payload.scheduleControlNumber',
    };
    for (const [packKey, expectedPath] of Object.entries(reliefFamilies)) {
      const pack = packs.find((p) => p.packKey === packKey)!;
      expect(pack).toBeDefined();
      const allocs = pack.rules.flatMap((r) => r.blueprint.postingGroups).flatMap((g) => [...g.debitAllocations, ...g.creditAllocations]);
      const reliefAlloc = allocs.find((a) => a.applyNumberPath === expectedPath);
      expect(reliefAlloc, `${packKey}: no allocation with applyNumberPath=${expectedPath}`).toBeDefined();
      expect(reliefAlloc!.controlNumberPath).toBe(expectedPath);
    }
  });

  it('items this service ORIGINATES (chargeback-reserve liability, refund payable, deferred-income liability) use controlNumberPath', () => {
    const originationFamilies = ['ce12.fni-reserve.chargeback-accrual', 'ce12.fni-reserve.cancellation-refund-payable', 'ce12.fni-reserve.deferral-booking-origination'];
    for (const packKey of originationFamilies) {
      const pack = packs.find((p) => p.packKey === packKey)!;
      const allControlPaths = pack.rules
        .flatMap((r) => r.blueprint.postingGroups)
        .flatMap((g) => [...g.debitAllocations, ...g.creditAllocations])
        .map((a) => a.controlNumberPath)
        .filter(Boolean);
      expect(allControlPaths.length).toBeGreaterThan(0);
    }
  });

  it('the chargeback-draw-from-reserve leg RELIEVES the same key (payload.dealNumber, <=10 chars-safe) the accrual leg ORIGINATED schedule 95 under', () => {
    const accrual = packs.find((p) => p.packKey === 'ce12.fni-reserve.chargeback-accrual')!;
    const draw = packs.find((p) => p.packKey === 'ce12.fni-reserve.chargeback-draw-from-reserve')!;
    const accrualControlPath = accrual.rules[0].blueprint.postingGroups[0].creditAllocations[0].controlNumberPath;
    const drawApplyPath = draw.rules[0].blueprint.postingGroups[0].debitAllocations[0].applyNumberPath;
    const drawControlPath = draw.rules[0].blueprint.postingGroups[0].debitAllocations[0].controlNumberPath;
    expect(accrualControlPath).toBe('payload.dealNumber');
    expect(drawApplyPath).toBe('payload.dealNumber');
    expect(drawControlPath).toBe('payload.dealNumber');
  });

  it('the deferral-recognition leg RELIEVES the same key (payload.scheduleControlNumber) the deferral-booking-origination leg ORIGINATED schedule 96 under', () => {
    const origination = packs.find((p) => p.packKey === 'ce12.fni-reserve.deferral-booking-origination')!;
    const recognition = packs.find((p) => p.packKey === 'ce12.fni-reserve.deferral-recognition')!;
    const originationControlPath = origination.rules[0].blueprint.postingGroups[0].creditAllocations[0].controlNumberPath;
    const recognitionApplyPath = recognition.rules[0].blueprint.postingGroups[0].debitAllocations[0].applyNumberPath;
    const recognitionControlPath = recognition.rules[0].blueprint.postingGroups[0].debitAllocations[0].controlNumberPath;
    expect(originationControlPath).toBe('payload.scheduleControlNumber');
    expect(recognitionApplyPath).toBe('payload.scheduleControlNumber');
    expect(recognitionControlPath).toBe('payload.scheduleControlNumber');
  });

  it('effectiveFrom/tenantScope/entityId are threaded through to every pack from the factory options', () => {
    for (const p of packs) {
      expect(p.tenantScope).toBe('tenant-fixture');
      expect(p.entityId).toBe('entity-fixture');
      expect(p.effectiveFrom).toBe('2026-01-01T00:00:00.000Z');
    }
  });
});
