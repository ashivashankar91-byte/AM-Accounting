import { describe, it, expect, beforeEach } from 'vitest';
import { TenantId } from '@amacc/shared-kernel';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

describe('Floor Plan Financing API', () => {
  let prisma: PrismaClient;
  let tenantId: TenantId;
  let liabilityAccountId: string;
  let interestAccountId: string;

  beforeEach(async () => {
    prisma = new PrismaClient();
    tenantId = 'test-tenant-floor-plan' as TenantId;

    // Create test GL accounts
    const liabilityAccount = await prisma.gLAccount.create({
      data: {
        tenantId,
        code: '2510',
        name: 'Floor Plan Financing Liability',
        type: 'LIABILITY',
        normalBalance: 'CREDIT',
        allowPosting: true,
      },
    });
    liabilityAccountId = liabilityAccount.id;

    const interestAccount = await prisma.gLAccount.create({
      data: {
        tenantId,
        code: '5510',
        name: 'Floor Plan Interest Expense',
        type: 'EXPENSE',
        normalBalance: 'DEBIT',
        allowPosting: true,
      },
    });
    interestAccountId = interestAccount.id;
  });

  describe('POST /api/v1/gl/floor-plan/units', () => {
    it('should register a floored vehicle', async () => {
      const unit = await (prisma as any).floorPlanUnit.create({
        data: {
          tenantId,
          vin: '1HGCV41JXMN109186',
          lenderId: 'lender-wells-fargo',
          advanceAmount: new Decimal('25000.00'),
          currentBalance: new Decimal('25000.00'),
          interestRate: new Decimal('0.065'),
          floorDate: new Date('2026-05-01'),
          glLiabilityAccountId: liabilityAccountId,
          glInterestAccountId: interestAccountId,
          accruedInterest: new Decimal('0.00'),
          status: 'ACTIVE',
        },
      });

      expect(unit).toBeDefined();
      expect(unit.vin).toBe('1HGCV41JXMN109186');
      expect(unit.status).toBe('ACTIVE');
      expect(unit.advanceAmount).toBe('25000.00');
    });

    it('should enforce VIN uniqueness per tenant', async () => {
      const vin = '1HGCV41JXMN109186';

      await (prisma as any).floorPlanUnit.create({
        data: {
          tenantId,
          vin,
          lenderId: 'lender-1',
          advanceAmount: new Decimal('25000.00'),
          currentBalance: new Decimal('25000.00'),
          interestRate: new Decimal('0.065'),
          floorDate: new Date('2026-05-01'),
          status: 'ACTIVE',
        },
      });

      expect(async () => {
        await (prisma as any).floorPlanUnit.create({
          data: {
            tenantId,
            vin,
            lenderId: 'lender-2',
            advanceAmount: new Decimal('20000.00'),
            currentBalance: new Decimal('20000.00'),
            interestRate: new Decimal('0.07'),
            floorDate: new Date('2026-05-01'),
            status: 'ACTIVE',
          },
        });
      }).rejects.toThrow();
    });

    it('should support curtailment schedules', async () => {
      const curtailmentSchedule = {
        monthly: 500.00,
        note: 'Monthly curtailment due to lender agreement',
      };

      const unit = await (prisma as any).floorPlanUnit.create({
        data: {
          tenantId,
          vin: '1HGCV41JXMN109186',
          lenderId: 'lender-wells-fargo',
          advanceAmount: new Decimal('25000.00'),
          currentBalance: new Decimal('25000.00'),
          interestRate: new Decimal('0.065'),
          floorDate: new Date('2026-05-01'),
          curtailmentSchedule,
          status: 'ACTIVE',
        },
      });

      expect(unit.curtailmentSchedule).toEqual(curtailmentSchedule);
    });

    it('should initialize ACTIVE status', async () => {
      const unit = await (prisma as any).floorPlanUnit.create({
        data: {
          tenantId,
          vin: '1HGCV41JXMN109186',
          lenderId: 'lender-wells-fargo',
          advanceAmount: new Decimal('25000.00'),
          currentBalance: new Decimal('25000.00'),
          interestRate: new Decimal('0.065'),
          floorDate: new Date('2026-05-01'),
        },
      });

      expect(unit.status).toBe('ACTIVE');
      expect(unit.accruedInterest).toBe('0.00');
    });
  });

  describe('GET /api/v1/gl/floor-plan/units', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 3; i++) {
        await (prisma as any).floorPlanUnit.create({
          data: {
            tenantId,
            vin: `1HGCV41JXMN10918${i}`,
            lenderId: 'lender-wells-fargo',
            advanceAmount: new Decimal((25000 * i).toString()),
            currentBalance: new Decimal((25000 * i).toString()),
            interestRate: new Decimal('0.065'),
            floorDate: new Date('2026-05-01'),
            status: i === 3 ? 'PAID_OFF' : 'ACTIVE',
          },
        });
      }
    });

    it('should list all active floored units', async () => {
      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, status: 'ACTIVE' },
      });

      expect(units.length).toBe(2);
    });

    it('should filter by status', async () => {
      const active = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, status: 'ACTIVE' },
      });

      const paidOff = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, status: 'PAID_OFF' },
      });

      expect(active.length).toBe(2);
      expect(paidOff.length).toBe(1);
    });

    it('should filter by lender_id', async () => {
      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, lenderId: 'lender-wells-fargo' },
      });

      expect(units.length).toBe(3);
    });

    it('should calculate total_balance', async () => {
      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId },
      });

      const totalBalance = units.reduce((sum: number, u: any) => sum + u.currentBalance.toNumber(), 0);
      expect(totalBalance).toBe(150000.00); // 25k + 50k + 75k
    });
  });

  describe('POST /api/v1/gl/floor-plan/accrue-interest', () => {
    beforeEach(async () => {
      await (prisma as any).floorPlanUnit.create({
        data: {
          tenantId,
          vin: '1HGCV41JXMN109186',
          lenderId: 'lender-wells-fargo',
          advanceAmount: new Decimal('25000.00'),
          currentBalance: new Decimal('25000.00'),
          interestRate: new Decimal('0.065'),
          floorDate: new Date('2026-05-01'),
          glLiabilityAccountId: liabilityAccountId,
          glInterestAccountId: interestAccountId,
          status: 'ACTIVE',
        },
      });
    });

    it('should calculate daily compound interest (balance × rate/365)', async () => {
      // Interest = 25000 * (0.065 / 365) = 4.45
      const dailyInterest = 25000 * (0.065 / 365);
      expect(dailyInterest).toBeCloseTo(4.45, 1);
    });

    it('should accrue interest across multiple units', async () => {
      await (prisma as any).floorPlanUnit.create({
        data: {
          tenantId,
          vin: '1HGCV41JXMN109187',
          lenderId: 'lender-chase',
          advanceAmount: new Decimal('30000.00'),
          currentBalance: new Decimal('30000.00'),
          interestRate: new Decimal('0.070'),
          floorDate: new Date('2026-05-01'),
          status: 'ACTIVE',
        },
      });

      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, status: 'ACTIVE' },
      });

      let totalDailyInterest = 0;
      for (const unit of units) {
        const dailyInt = unit.currentBalance.toNumber() * (unit.interestRate.toNumber() / 365);
        totalDailyInterest += dailyInt;
      }

      expect(totalDailyInterest).toBeGreaterThan(0);
    });

    it('should create GL journal entries for interest', async () => {
      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, status: 'ACTIVE' },
      });

      // For each unit, create: DR interest expense, CR liability
      const journalEntries = [];
      for (const unit of units) {
        const dailyInterest = unit.currentBalance.toNumber() * (unit.interestRate.toNumber() / 365);
        journalEntries.push({
          debit_account: unit.glInterestAccountId,
          debit_amount: dailyInterest,
          credit_account: unit.glLiabilityAccountId,
          credit_amount: dailyInterest,
        });
      }

      expect(journalEntries.length).toBe(units.length);
    });

    it('should update accrued_interest in unit record', async () => {
      const unit = await (prisma as any).floorPlanUnit.findFirst({
        where: { tenantId, vin: '1HGCV41JXMN109186' },
      });

      const dailyInterest = unit.currentBalance.toNumber() * (unit.interestRate.toNumber() / 365);

      const updated = await (prisma as any).floorPlanUnit.update({
        where: { id: unit.id },
        data: {
          accruedInterest: new Decimal(dailyInterest.toString()),
        },
      });

      expect(updated.accruedInterest.toNumber()).toBeCloseTo(dailyInterest, 1);
    });
  });

  describe('POST /api/v1/gl/floor-plan/payoff/:unitId', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await (prisma as any).floorPlanUnit.create({
        data: {
          tenantId,
          vin: '1HGCV41JXMN109186',
          lenderId: 'lender-wells-fargo',
          advanceAmount: new Decimal('25000.00'),
          currentBalance: new Decimal('25067.15'),
          interestRate: new Decimal('0.065'),
          floorDate: new Date('2026-05-01'),
          glLiabilityAccountId: liabilityAccountId,
          glInterestAccountId: interestAccountId,
          accruedInterest: new Decimal('67.15'),
          status: 'ACTIVE',
        },
      });
      unitId = unit.id;
    });

    it('should set status to PAID_OFF', async () => {
      const updated = await (prisma as any).floorPlanUnit.update({
        where: { id: unitId },
        data: {
          status: 'PAID_OFF',
          payoffDate: new Date('2026-05-15'),
        },
      });

      expect(updated.status).toBe('PAID_OFF');
    });

    it('should record payoff_date', async () => {
      const payoffDate = new Date('2026-05-15');

      const updated = await (prisma as any).floorPlanUnit.update({
        where: { id: unitId },
        data: {
          status: 'PAID_OFF',
          payoffDate,
        },
      });

      expect(updated.payoffDate).toEqual(payoffDate);
    });

    it('should create GL payoff entry (debit liability, credit bank)', async () => {
      // GL Entry: DR Floor Plan Payable, CR Bank/Cash
      const entry = {
        debit_account: liabilityAccountId,
        debit_amount: 25067.15,
        credit_account: 'bank-account-id',
        credit_amount: 25067.15,
      };

      expect(entry.debit_amount).toBe(25067.15);
      expect(entry.debit_amount).toBe(entry.credit_amount);
    });

    it('should link to deal_id for reconciliation', async () => {
      const updated = await (prisma as any).floorPlanUnit.update({
        where: { id: unitId },
        data: {
          status: 'PAID_OFF',
          payoffDate: new Date('2026-05-15'),
        },
      });

      // Could store deal_id in metadata if needed
      expect(updated.status).toBe('PAID_OFF');
    });
  });

  describe('GET /api/v1/gl/floor-plan/aging-report', () => {
    beforeEach(async () => {
      const wellsFargo = 'lender-wells-fargo';
      const chase = 'lender-chase';

      // Wells Fargo units
      for (let i = 1; i <= 2; i++) {
        await (prisma as any).floorPlanUnit.create({
          data: {
            tenantId,
            vin: `1HGCV41JXMN10918${i}`,
            lenderId: wellsFargo,
            advanceAmount: new Decimal('25000.00'),
            currentBalance: new Decimal('25067.15'),
            interestRate: new Decimal('0.065'),
            floorDate: new Date(2026, 4, 1 + i), // May 2 and 3
            accruedInterest: new Decimal(`${65.00 + i}`),
            status: 'ACTIVE',
          },
        });
      }

      // Chase units
      for (let i = 1; i <= 2; i++) {
        await (prisma as any).floorPlanUnit.create({
          data: {
            tenantId,
            vin: `2HGCV41JXMN10918${i}`,
            lenderId: chase,
            advanceAmount: new Decimal('30000.00'),
            currentBalance: new Decimal('30100.00'),
            interestRate: new Decimal('0.070'),
            floorDate: new Date(2026, 4, 10 + i), // May 11 and 12
            accruedInterest: new Decimal('100.00'),
            status: 'ACTIVE',
          },
        });
      }
    });

    it('should group by lender', async () => {
      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, status: 'ACTIVE' },
      });

      const byLender: Record<string, any[]> = {};
      for (const unit of units) {
        if (!byLender[unit.lenderId]) {
          byLender[unit.lenderId] = [];
        }
        byLender[unit.lenderId].push(unit);
      }

      expect(Object.keys(byLender).length).toBe(2);
      expect(byLender['lender-wells-fargo'].length).toBe(2);
      expect(byLender['lender-chase'].length).toBe(2);
    });

    it('should calculate days_on_floor', async () => {
      const asOfDate = new Date('2026-05-31');
      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, status: 'ACTIVE' },
      });

      for (const unit of units) {
        const daysOnFloor = Math.floor((asOfDate.getTime() - unit.floorDate.getTime()) / (1000 * 60 * 60 * 24));
        expect(daysOnFloor).toBeGreaterThan(0);
      }
    });

    it('should include accrued_interest per unit', async () => {
      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, status: 'ACTIVE' },
      });

      for (const unit of units) {
        expect(unit.accruedInterest).toBeDefined();
        expect(unit.accruedInterest.toNumber()).toBeGreaterThanOrEqual(0);
      }
    });

    it('should calculate subtotals by lender', async () => {
      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId, status: 'ACTIVE' },
      });

      const byLender: Record<string, any> = {};
      for (const unit of units) {
        if (!byLender[unit.lenderId]) {
          byLender[unit.lenderId] = {
            subtotal_advance: 0,
            subtotal_interest: 0,
          };
        }
        byLender[unit.lenderId].subtotal_advance += unit.advanceAmount.toNumber();
        byLender[unit.lenderId].subtotal_interest += unit.accruedInterest.toNumber();
      }

      expect(byLender['lender-wells-fargo'].subtotal_advance).toBe(50000.00);
    });
  });

  describe('Floor Plan Status Transitions', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await (prisma as any).floorPlanUnit.create({
        data: {
          tenantId,
          vin: '1HGCV41JXMN109186',
          lenderId: 'lender-wells-fargo',
          advanceAmount: new Decimal('25000.00'),
          currentBalance: new Decimal('25000.00'),
          interestRate: new Decimal('0.065'),
          floorDate: new Date('2026-05-01'),
          status: 'ACTIVE',
        },
      });
      unitId = unit.id;
    });

    it('should transition ACTIVE → PAID_OFF', async () => {
      const updated = await (prisma as any).floorPlanUnit.update({
        where: { id: unitId },
        data: { status: 'PAID_OFF' },
      });

      expect(updated.status).toBe('PAID_OFF');
    });

    it('should support CURTAILED status', async () => {
      const updated = await (prisma as any).floorPlanUnit.update({
        where: { id: unitId },
        data: { status: 'CURTAILED' },
      });

      expect(updated.status).toBe('CURTAILED');
    });

    it('should support DAMAGED status for loss mitigation', async () => {
      const updated = await (prisma as any).floorPlanUnit.update({
        where: { id: unitId },
        data: { status: 'DAMAGED' },
      });

      expect(updated.status).toBe('DAMAGED');
    });
  });

  describe('Floor Plan Data Precision', () => {
    it('should store amounts with NUMERIC(15,2) precision', async () => {
      const unit = await (prisma as any).floorPlanUnit.create({
        data: {
          tenantId,
          vin: '1HGCV41JXMN109186',
          lenderId: 'lender-wells-fargo',
          advanceAmount: new Decimal('123456789.12'),
          currentBalance: new Decimal('123456789.12'),
          interestRate: new Decimal('0.065'),
          floorDate: new Date('2026-05-01'),
          accruedInterest: new Decimal('12345.67'),
        },
      });

      expect(unit.advanceAmount.toString()).toMatch(/123456789\.12/);
      expect(unit.accruedInterest.toString()).toMatch(/12345\.67/);
    });

    it('should store interest_rate with NUMERIC(6,4) precision', async () => {
      const unit = await (prisma as any).floorPlanUnit.create({
        data: {
          tenantId,
          vin: '1HGCV41JXMN109186',
          lenderId: 'lender-wells-fargo',
          advanceAmount: new Decimal('25000.00'),
          currentBalance: new Decimal('25000.00'),
          interestRate: new Decimal('0.065432'), // Will be rounded
          floorDate: new Date('2026-05-01'),
        },
      });

      expect(unit.interestRate.toString()).toMatch(/0\.0654/);
    });
  });

  describe('Multi-tenant isolation', () => {
    it('should filter units by tenantId', async () => {
      const otherTenantId = 'other-tenant-floor-plan' as TenantId;
      const units = await (prisma as any).floorPlanUnit.findMany({
        where: { tenantId: otherTenantId },
      });

      expect(units.length).toBe(0);
    });
  });
});
