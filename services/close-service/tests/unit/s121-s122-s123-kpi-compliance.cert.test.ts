// S121 — Fixed Ops KPI Pack, S122 — Variable Ops KPI Pack, S123 — Compliance Reporting Pack
// Tests the kpi-engine pure evaluator and compliance-service-ce15 report generation
import { describe, it, expect } from 'vitest';
import { Decimal } from '@prisma/client/runtime/library';
import { evaluateFormula } from '../../src/domain/kpi-engine';
import { ComplianceServiceCe15 } from '../../src/application/compliance-service-ce15';

describe('S121/S122 — KPI Engine (Fixed Ops & Variable Ops formulas)', () => {
  const balances: Record<string, Decimal> = {
    '5100': new Decimal('120000'),
    '5200': new Decimal('80000'),
    '5300': new Decimal('40000'),
  };

  it('AC1 — ADD op: sums all account operands correctly', () => {
    const result = evaluateFormula(
      { op: 'ADD', operands: [{ type: 'account', code: '5100' }, { type: 'account', code: '5200' }] },
      balances, {},
    );
    expect(result.toString()).toBe('200000');
  });

  it('AC2 — SUBTRACT op: subtracts subsequent operands from the first', () => {
    const result = evaluateFormula(
      { op: 'SUBTRACT', operands: [{ type: 'account', code: '5100' }, { type: 'account', code: '5200' }] },
      balances, {},
    );
    expect(result.toString()).toBe('40000');
  });

  it('AC3 — RATIO op: computes A/B×100 as a percentage', () => {
    const result = evaluateFormula(
      { op: 'RATIO', operands: [{ type: 'account', code: '5200' }, { type: 'account', code: '5100' }] },
      balances, {},
    );
    expect(result.toNumber()).toBeCloseTo(66.666, 2);
  });

  it('AC4 — RATIO with zero denominator returns 0, does not throw (fail-safe)', () => {
    const result = evaluateFormula(
      { op: 'RATIO', operands: [{ type: 'account', code: '5100' }, { type: 'constant', value: 0 }] },
      balances, {},
    );
    expect(result.toString()).toBe('0');
  });

  it('AC5 — formula cross-reference: a formula operand resolves from the already-computed map', () => {
    const resolved: Record<string, Decimal> = { 'gross_profit': new Decimal('50000') };
    const result = evaluateFormula(
      { op: 'RATIO', operands: [{ type: 'formula', ref: 'gross_profit' }, { type: 'account', code: '5100' }] },
      balances, resolved,
    );
    expect(result.toNumber()).toBeCloseTo(41.666, 2);
  });

  it('AC6 — unknown account code defaults to 0 (missing balance is not an error)', () => {
    const result = evaluateFormula(
      { op: 'ADD', operands: [{ type: 'account', code: 'NONEXISTENT' }] },
      balances, {},
    );
    expect(result.toString()).toBe('0');
  });
});

describe('S123 — Compliance Reporting Pack', () => {
  it('AC1 — generate returns a compliance report stamped with tenantId, legalEntityId, period and actor', async () => {
    const svc = new ComplianceServiceCe15();
    const report = await svc.generate('tenant-A', 'le-001', 2026, 3, 'controller-1');
    expect(report.tenantId).toBe('tenant-A');
    expect(report.legalEntityId).toBe('le-001');
    expect(report.periodYear).toBe(2026);
    expect(report.periodMonth).toBe(3);
    expect(report.generatedBy).toBe('controller-1');
    expect(report.status).toBe('GENERATED');
    expect(report.id).toMatch(/^compliance-/);
  });

  it('AC2 — cross-tenant isolation: reports are stamped with the correct tenant', async () => {
    const svc = new ComplianceServiceCe15();
    const r1 = await svc.generate('tenant-A', 'le-001', 2026, 3, 'ctrl');
    const r2 = await svc.generate('tenant-B', 'le-002', 2026, 3, 'ctrl');
    expect(r1.tenantId).toBe('tenant-A');
    expect(r2.tenantId).toBe('tenant-B');
    expect(r1.legalEntityId).toBe('le-001');
    expect(r2.legalEntityId).toBe('le-002');
  });
});
