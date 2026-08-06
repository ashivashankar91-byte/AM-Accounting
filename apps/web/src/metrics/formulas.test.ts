import { describe, it, expect } from 'vitest';
import {
  calcAbsorptionRate,
  calcFrontGrossPUR,
  calcFAndIPVR,
  calcTotalGrossPerUnit,
  calcExpenseToGross,
  calcGrossToNet,
  calcPersonnelToGross,
  calcEffectiveLaborRate,
  calcHoursPerRO,
  calcDaysSupply,
  calcPartsObsolescencePercent,
  calcFloorplanTrustPosition,
  calcContractsInTransitAging,
  calcScheduleVariance,
} from './formulas';

describe('calcAbsorptionRate', () => {
  it('computes fixed-ops gross / total overhead, excluding F&I by default', () => {
    const result = calcAbsorptionRate({
      serviceGross: 50_000,
      partsGross: 20_000,
      bodyShopGross: 10_000,
      fAndIGross: 30_000,
      totalOverheadExpense: 100_000,
      includeFAndIGross: false,
      overheadBasis: 'TOTAL',
    });
    expect(result).toBeCloseTo(0.8); // (50k+20k+10k)/100k
  });

  it('includes F&I gross when configured', () => {
    const result = calcAbsorptionRate({
      serviceGross: 50_000,
      partsGross: 20_000,
      bodyShopGross: 10_000,
      fAndIGross: 30_000,
      totalOverheadExpense: 100_000,
      includeFAndIGross: true,
      overheadBasis: 'TOTAL',
    });
    expect(result).toBeCloseTo(1.1);
  });

  it('uses adjusted overhead basis when configured and provided', () => {
    const result = calcAbsorptionRate({
      serviceGross: 50_000,
      partsGross: 0,
      bodyShopGross: 0,
      fAndIGross: 0,
      totalOverheadExpense: 100_000,
      adjustedOverheadExpense: 50_000,
      includeFAndIGross: false,
      overheadBasis: 'ADJUSTED',
    });
    expect(result).toBeCloseTo(1);
  });

  it('returns null on zero overhead rather than dividing by zero', () => {
    const result = calcAbsorptionRate({
      serviceGross: 50_000,
      partsGross: 0,
      bodyShopGross: 0,
      fAndIGross: 0,
      totalOverheadExpense: 0,
      includeFAndIGross: false,
      overheadBasis: 'TOTAL',
    });
    expect(result).toBeNull();
  });

  it('returns null (not 0) when overhead is missing/NaN rather than actually zero', () => {
    const result = calcAbsorptionRate({
      serviceGross: 50_000,
      partsGross: 0,
      bodyShopGross: 0,
      fAndIGross: 0,
      totalOverheadExpense: NaN,
      includeFAndIGross: false,
      overheadBasis: 'TOTAL',
    });
    expect(result).toBeNull();
  });

  it('handles a negative fixed-ops gross (loss month) without throwing', () => {
    const result = calcAbsorptionRate({
      serviceGross: -10_000,
      partsGross: 0,
      bodyShopGross: 0,
      fAndIGross: 0,
      totalOverheadExpense: 100_000,
      includeFAndIGross: false,
      overheadBasis: 'TOTAL',
    });
    expect(result).toBeCloseTo(-0.1);
  });
});

describe('calcFrontGrossPUR', () => {
  it('divides vehicle department gross by retail units', () => {
    expect(calcFrontGrossPUR(200_000, 100)).toBeCloseTo(2_000);
  });
  it('returns null with zero retail units', () => {
    expect(calcFrontGrossPUR(200_000, 0)).toBeNull();
  });
  it('handles a negative gross (loss month) without throwing', () => {
    expect(calcFrontGrossPUR(-5_000, 10)).toBeCloseTo(-500);
  });
});

describe('calcFAndIPVR', () => {
  it('divides total F&I gross by total retail units', () => {
    expect(calcFAndIPVR(150_000, 100)).toBeCloseTo(1_500);
  });
  it('returns null with zero units, never 0 or NaN', () => {
    expect(calcFAndIPVR(150_000, 0)).toBeNull();
  });
  it('handles a negative F&I gross (chargebacks exceeding new production) without throwing', () => {
    expect(calcFAndIPVR(-2_000, 100)).toBeCloseTo(-20);
  });
  it('returns null (not 0) when gross is missing/undefined', () => {
    expect(calcFAndIPVR(undefined as any, 100)).toBeNull();
  });
});

describe('calcTotalGrossPerUnit', () => {
  it('sums front + F&I gross over units', () => {
    expect(calcTotalGrossPerUnit(200_000, 150_000, 100)).toBeCloseTo(3_500);
  });
  it('returns null with zero units', () => {
    expect(calcTotalGrossPerUnit(200_000, 150_000, 0)).toBeNull();
  });
  it('handles a net-negative combined gross (heavy discounting month) without throwing', () => {
    expect(calcTotalGrossPerUnit(-50_000, 10_000, 100)).toBeCloseTo(-400);
  });
});

describe('calcExpenseToGross', () => {
  it('divides expense by gross', () => {
    expect(calcExpenseToGross(80_000, 100_000)).toBeCloseTo(0.8);
  });
  it('returns null on zero gross', () => {
    expect(calcExpenseToGross(80_000, 0)).toBeNull();
  });
  it('handles negative gross (loss) without throwing', () => {
    expect(calcExpenseToGross(80_000, -10_000)).toBeCloseTo(-8);
  });
  it('returns null (not 0) when gross is null, distinct from a genuine zero-gross month', () => {
    expect(calcExpenseToGross(80_000, null as any)).toBeNull();
  });
});

describe('calcGrossToNet', () => {
  it('divides net by gross', () => {
    expect(calcGrossToNet(20_000, 100_000)).toBeCloseTo(0.2);
  });
  it('returns null on zero gross', () => {
    expect(calcGrossToNet(20_000, 0)).toBeNull();
  });
  it('handles a negative net (net loss month) without throwing', () => {
    expect(calcGrossToNet(-15_000, 100_000)).toBeCloseTo(-0.15);
  });
  it('handles negative gross and negative net together (loss on loss)', () => {
    expect(calcGrossToNet(-5_000, -50_000)).toBeCloseTo(0.1);
  });
  it('returns null (not 0) when net is null rather than genuinely zero', () => {
    expect(calcGrossToNet(null as any, 100_000)).toBeNull();
  });
});

describe('calcPersonnelToGross', () => {
  it('divides personnel expense by gross', () => {
    expect(calcPersonnelToGross(40_000, 100_000)).toBeCloseTo(0.4);
  });
  it('returns null on zero gross', () => {
    expect(calcPersonnelToGross(40_000, 0)).toBeNull();
  });
  it('handles a negative gross (loss month) without throwing', () => {
    expect(calcPersonnelToGross(40_000, -100_000)).toBeCloseTo(-0.4);
  });
});

describe('calcEffectiveLaborRate', () => {
  it('divides labor sales by labor hours', () => {
    expect(calcEffectiveLaborRate(10_000, 100)).toBeCloseTo(100);
  });
  it('returns null on zero hours', () => {
    expect(calcEffectiveLaborRate(10_000, 0)).toBeNull();
  });
  it('returns null (not 0) when hours are missing/NaN, distinct from zero hours', () => {
    expect(calcEffectiveLaborRate(10_000, NaN)).toBeNull();
  });
});

describe('calcHoursPerRO', () => {
  it('divides flagged hours by closed RO count', () => {
    expect(calcHoursPerRO(500, 250)).toBeCloseTo(2);
  });
  it('returns null on zero closed ROs', () => {
    expect(calcHoursPerRO(500, 0)).toBeNull();
  });
});

describe('calcDaysSupply', () => {
  it('divides inventory units by daily sales rate', () => {
    // 30 units sold over 30 days = 1/day; 60 units on hand = 60 days supply
    expect(calcDaysSupply(60, 30, 30)).toBeCloseTo(60);
  });
  it('returns null when trailing units sold is zero (no sales rate)', () => {
    expect(calcDaysSupply(60, 0, 30)).toBeNull();
  });
  it('returns null when trailingDays itself is zero', () => {
    expect(calcDaysSupply(60, 30, 0)).toBeNull();
  });
  it('returns null (not 0) when current inventory units is missing/NaN', () => {
    expect(calcDaysSupply(NaN, 30, 30)).toBeNull();
  });
});

describe('calcPartsObsolescencePercent', () => {
  it('divides no-sale-bucket value by total inventory value', () => {
    expect(calcPartsObsolescencePercent(10_000, 100_000)).toBeCloseTo(0.1);
  });
  it('returns null on zero total inventory value', () => {
    expect(calcPartsObsolescencePercent(10_000, 0)).toBeNull();
  });
  it('returns null (not 0) when total inventory value is missing/undefined', () => {
    expect(calcPartsObsolescencePercent(10_000, undefined as any)).toBeNull();
  });
});

describe('calcFloorplanTrustPosition', () => {
  const asOf = new Date('2026-07-31T00:00:00Z');

  it('flags units delivered/contracted but not paid off as out of trust', () => {
    const result = calcFloorplanTrustPosition(
      [
        { vin: 'VIN1', currentBalance: 30_000, deliveredOrContractDate: '2026-07-20', payoffDate: null },
        { vin: 'VIN2', currentBalance: 25_000, deliveredOrContractDate: null, payoffDate: null }, // still in stock, not out of trust
        { vin: 'VIN3', currentBalance: 40_000, deliveredOrContractDate: '2026-07-01', payoffDate: '2026-07-15' }, // paid off
      ],
      asOf,
    );
    expect(result.unitsOutOfTrust).toHaveLength(1);
    expect(result.totalExposure).toBe(30_000);
    expect(result.oldestAgeDays).toBe(11);
  });

  it('returns zero exposure and null oldest age with no out-of-trust units', () => {
    const result = calcFloorplanTrustPosition([], asOf);
    expect(result.totalExposure).toBe(0);
    expect(result.oldestAgeDays).toBeNull();
  });

  it('excludes a unit paid off on the same day as delivery (payoffDate present, not null)', () => {
    const result = calcFloorplanTrustPosition(
      [{ vin: 'VIN4', currentBalance: 10_000, deliveredOrContractDate: '2026-07-31', payoffDate: '2026-07-31' }],
      asOf,
    );
    expect(result.unitsOutOfTrust).toHaveLength(0);
  });
});

describe('calcContractsInTransitAging', () => {
  const asOf = new Date('2026-07-31T00:00:00Z');

  it('buckets unfunded contracts by age and excludes funded ones', () => {
    const result = calcContractsInTransitAging(
      [
        { dealId: 'D1', contractDate: '2026-07-29', fundedDate: null, unfundedAmount: 20_000 }, // 2 days
        { dealId: 'D2', contractDate: '2026-07-20', fundedDate: null, unfundedAmount: 30_000 }, // 11 days
        { dealId: 'D3', contractDate: '2026-07-10', fundedDate: '2026-07-12', unfundedAmount: 15_000 }, // funded, excluded
      ],
      [3, 5, 10, 20],
      asOf,
    );
    expect(result.unfundedCount).toBe(2);
    expect(result.unfundedTotal).toBe(50_000);
    expect(result.oldestAgeDays).toBe(11);
    expect(result.byBucket['0-3'].count).toBe(1); // D1 at 2 days
    expect(result.byBucket['10-20'].count).toBe(1); // D2 at 11 days
  });

  it('returns zero counts/amounts with no contracts', () => {
    const result = calcContractsInTransitAging([], [3, 5, 10, 20], asOf);
    expect(result.unfundedCount).toBe(0);
    expect(result.unfundedTotal).toBe(0);
    expect(result.oldestAgeDays).toBeNull();
  });

  it('places an item exactly on the lower boundary of a bucket into that bucket, not the one below', () => {
    // Bucket edges from [3, 5, 10, 20]: 0-3 / 3-5 / 5-10 / 10-20 / 20+
    // (upper bound exclusive) — an item at exactly age 3 belongs in "3-5".
    const result = calcContractsInTransitAging(
      [{ dealId: 'D-exact-3', contractDate: '2026-07-28', fundedDate: null, unfundedAmount: 1_000 }], // exactly 3 days
      [3, 5, 10, 20],
      asOf,
    );
    expect(result.byBucket['0-3'].count).toBe(0);
    expect(result.byBucket['3-5'].count).toBe(1);
  });

  it('places an item exactly on the first configured boundary (3) correctly, and one just under it in the youngest bucket', () => {
    const result = calcContractsInTransitAging(
      [
        { dealId: 'D-under', contractDate: '2026-07-29', fundedDate: null, unfundedAmount: 1_000 }, // 2 days — under 3
        { dealId: 'D-at3', contractDate: '2026-07-28', fundedDate: null, unfundedAmount: 1_000 }, // exactly 3 days
      ],
      [3, 5, 10, 20],
      asOf,
    );
    expect(result.byBucket['0-3'].count).toBe(1);
    expect(result.byBucket['3-5'].count).toBe(1);
  });

  it('places an item exactly on the last configured boundary (20) into the open-ended "20+" bucket', () => {
    const result = calcContractsInTransitAging(
      [{ dealId: 'D-at20', contractDate: '2026-07-11', fundedDate: null, unfundedAmount: 5_000 }], // exactly 20 days
      [3, 5, 10, 20],
      asOf,
    );
    expect(result.byBucket['10-20'].count).toBe(0);
    expect(result.byBucket['20+'].count).toBe(1);
  });

  it('places an item at age 0 (contracted today) into the youngest bucket, not omitted', () => {
    const result = calcContractsInTransitAging(
      [{ dealId: 'D-today', contractDate: '2026-07-31', fundedDate: null, unfundedAmount: 5_000 }], // 0 days
      [3, 5, 10, 20],
      asOf,
    );
    expect(result.byBucket['0-3'].count).toBe(1);
    expect(result.unfundedCount).toBe(1);
  });

  it('every configured boundary produces a bucket that sums back to the total unfunded count/amount', () => {
    const contracts = [
      { dealId: 'A', contractDate: '2026-07-31', fundedDate: null, unfundedAmount: 1_000 }, // 0
      { dealId: 'B', contractDate: '2026-07-28', fundedDate: null, unfundedAmount: 2_000 }, // 3
      { dealId: 'C', contractDate: '2026-07-26', fundedDate: null, unfundedAmount: 3_000 }, // 5
      { dealId: 'D', contractDate: '2026-07-21', fundedDate: null, unfundedAmount: 4_000 }, // 10
      { dealId: 'E', contractDate: '2026-07-11', fundedDate: null, unfundedAmount: 5_000 }, // 20
      { dealId: 'F', contractDate: '2026-06-01', fundedDate: null, unfundedAmount: 6_000 }, // 60
    ];
    const result = calcContractsInTransitAging(contracts, [3, 5, 10, 20], asOf);
    const bucketTotalCount = Object.values(result.byBucket).reduce((s, b) => s + b.count, 0);
    const bucketTotalAmount = Object.values(result.byBucket).reduce((s, b) => s + b.amount, 0);
    expect(bucketTotalCount).toBe(result.unfundedCount);
    expect(bucketTotalAmount).toBe(result.unfundedTotal);
    expect(result.byBucket['20+'].count).toBe(2); // E (20) and F (60)
  });
});

describe('calcScheduleVariance', () => {
  it('returns the signed difference between schedule detail sum and GL control balance', () => {
    expect(calcScheduleVariance(10_500, 10_000)).toBe(500);
    expect(calcScheduleVariance(9_800, 10_000)).toBe(-200);
  });
  it('returns exactly zero when in balance (the only non-exception case)', () => {
    expect(calcScheduleVariance(10_000, 10_000)).toBe(0);
  });
});
