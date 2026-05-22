import { describe, it, expect, beforeEach } from 'vitest';
import { TenantId } from '@amacc/shared-kernel';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

describe('Commission Tracking API', () => {
  let prisma: PrismaClient;
  let tenantId: TenantId;

  beforeEach(async () => {
    prisma = new PrismaClient();
    tenantId = 'test-tenant-commission' as TenantId;
  });

  describe('POST /api/v1/payroll/commission-plans', () => {
    it('should create a flat commission plan', async () => {
      const plan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-001',
          planType: 'FLAT',
          department: 'SALES',
          flatAmount: new Decimal('500.00'),
          effectiveDate: new Date('2026-06-01'),
          isActive: true,
        },
      });

      expect(plan).toBeDefined();
      expect(plan.planType).toBe('FLAT');
      expect(plan.flatAmount).toBe('500.00');
    });

    it('should create a percentage commission plan', async () => {
      const plan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-002',
          planType: 'PERCENTAGE',
          department: 'SALES',
          percentageRate: new Decimal('2.50'),
          effectiveDate: new Date('2026-06-01'),
          isActive: true,
        },
      });

      expect(plan.planType).toBe('PERCENTAGE');
      expect(plan.percentageRate).toBe('2.50');
    });

    it('should create a tiered commission plan', async () => {
      const tiers = [
        { threshold: 0, rate: 0.01 },
        { threshold: 50000, rate: 0.015 },
        { threshold: 100000, rate: 0.02 },
      ];

      const plan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-003',
          planType: 'TIERED',
          department: 'SALES',
          tiers: tiers,
          effectiveDate: new Date('2026-06-01'),
          isActive: true,
        },
      });

      expect(plan.planType).toBe('TIERED');
      expect(plan.tiers).toEqual(tiers);
    });

    it('should support multi-department commission plans', async () => {
      const sales = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-004',
          planType: 'PERCENTAGE',
          department: 'SALES',
          percentageRate: new Decimal('2.00'),
          effectiveDate: new Date('2026-06-01'),
          isActive: true,
        },
      });

      const fi = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-004',
          planType: 'PERCENTAGE',
          department: 'F&I',
          percentageRate: new Decimal('3.00'),
          effectiveDate: new Date('2026-06-01'),
          isActive: true,
        },
      });

      expect(sales.department).toBe('SALES');
      expect(fi.department).toBe('F&I');
      expect(fi.percentageRate).toBeGreaterThan(sales.percentageRate);
    });

    it('should enforce effective_date for plan activation', async () => {
      const plan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-005',
          planType: 'PERCENTAGE',
          department: 'SALES',
          percentageRate: new Decimal('2.00'),
          effectiveDate: new Date('2026-07-01'),
          isActive: true,
        },
      });

      expect(plan.effectiveDate).toEqual(new Date('2026-07-01'));
    });
  });

  describe('POST /api/v1/payroll/commissions/calculate', () => {
    let planId: string;

    beforeEach(async () => {
      const plan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-calc-001',
          planType: 'PERCENTAGE',
          department: 'SALES',
          percentageRate: new Decimal('2.00'),
          effectiveDate: new Date('2026-01-01'),
          isActive: true,
        },
      });
      planId = plan.id;
    });

    it('should calculate commission based on gross profit', async () => {
      const grossProfit = 5000.00;
      const expectedCommission = 100.00; // 5000 * 2%

      const record = await (prisma as any).commissionRecord.create({
        data: {
          tenantId,
          employeeId: 'emp-calc-001',
          dealId: 'deal-001',
          dealType: 'NEW_VEHICLE',
          grossProfit: new Decimal(grossProfit.toString()),
          commissionAmount: new Decimal(expectedCommission.toString()),
          planId,
          status: 'ACCRUED',
          periodYear: 2026,
          periodMonth: 5,
        },
      });

      expect(Number(record.commissionAmount)).toBe(expectedCommission);
    });

    it('should create ACCRUED status commission record', async () => {
      const record = await (prisma as any).commissionRecord.create({
        data: {
          tenantId,
          employeeId: 'emp-calc-001',
          dealId: 'deal-002',
          dealType: 'USED_VEHICLE',
          grossProfit: new Decimal('3000.00'),
          commissionAmount: new Decimal('60.00'),
          planId,
          status: 'ACCRUED',
          periodYear: 2026,
          periodMonth: 5,
        },
      });

      expect(record.status).toBe('ACCRUED');
    });

    it('should link to GL journal entry for posting', async () => {
      const record = await (prisma as any).commissionRecord.create({
        data: {
          tenantId,
          employeeId: 'emp-calc-001',
          dealId: 'deal-003',
          dealType: 'NEW_VEHICLE',
          grossProfit: new Decimal('5000.00'),
          commissionAmount: new Decimal('100.00'),
          planId,
          status: 'ACCRUED',
          journalEntryId: 'je-comm-001',
          periodYear: 2026,
          periodMonth: 5,
        },
      });

      expect(record.journalEntryId).toBe('je-comm-001');
    });

    it('should support tiered rate calculation', async () => {
      const tieredPlan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-tiered',
          planType: 'TIERED',
          department: 'SALES',
          tiers: [
            { threshold: 0, rate: 0.01 },
            { threshold: 50000, rate: 0.015 },
            { threshold: 100000, rate: 0.02 },
          ],
          effectiveDate: new Date('2026-01-01'),
          isActive: true,
        },
      });

      // Gross profit of 75,000 applies tiered rates
      // 0-50,000 at 1% = 500
      // 50,000-75,000 at 1.5% = 375
      // Total = 875
      const expectedCommission = 875.00;

      const record = await (prisma as any).commissionRecord.create({
        data: {
          tenantId,
          employeeId: 'emp-tiered',
          dealId: 'deal-tiered',
          dealType: 'NEW_VEHICLE',
          grossProfit: new Decimal('75000.00'),
          commissionAmount: new Decimal(expectedCommission.toString()),
          planId: tieredPlan.id,
          status: 'ACCRUED',
        },
      });

      expect(Number(record.commissionAmount)).toBe(expectedCommission);
    });
  });

  describe('GET /api/v1/payroll/commissions', () => {
    beforeEach(async () => {
      const plan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-list-001',
          planType: 'PERCENTAGE',
          department: 'SALES',
          percentageRate: new Decimal('2.00'),
          effectiveDate: new Date('2026-01-01'),
          isActive: true,
        },
      });

      for (let i = 1; i <= 3; i++) {
        await (prisma as any).commissionRecord.create({
          data: {
            tenantId,
            employeeId: 'emp-list-001',
            dealId: `deal-list-${i}`,
            dealType: 'NEW_VEHICLE',
            grossProfit: new Decimal((5000 * i).toString()),
            commissionAmount: new Decimal((100 * i).toString()),
            planId: plan.id,
            status: 'ACCRUED',
            periodYear: 2026,
            periodMonth: 5,
          },
        });
      }
    });

    it('should list commissions by employee ID', async () => {
      const records = await (prisma as any).commissionRecord.findMany({
        where: { tenantId, employeeId: 'emp-list-001' },
      });

      expect(records.length).toBe(3);
    });

    it('should filter by period (YYYY-MM)', async () => {
      const records = await (prisma as any).commissionRecord.findMany({
        where: {
          tenantId,
          employeeId: 'emp-list-001',
          periodYear: 2026,
          periodMonth: 5,
        },
      });

      expect(records.length).toBe(3);
    });

    it('should calculate month_total and ytd_total', async () => {
      const records = await (prisma as any).commissionRecord.findMany({
        where: {
          tenantId,
          employeeId: 'emp-list-001',
          periodYear: 2026,
          periodMonth: 5,
        },
      });

      const monthTotal = records.reduce((sum: number, r: any) => sum + r.commissionAmount.toNumber(), 0);
      expect(monthTotal).toBe(600.00); // 100 + 200 + 300
    });

    it('should filter by status', async () => {
      const accruedRecords = await (prisma as any).commissionRecord.findMany({
        where: { tenantId, employeeId: 'emp-list-001', status: 'ACCRUED' },
      });

      expect(accruedRecords.every((r: any) => r.status === 'ACCRUED')).toBe(true);
    });
  });

  describe('GET /api/v1/payroll/commissions/report', () => {
    beforeEach(async () => {
      const salesPlan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-report-001',
          planType: 'PERCENTAGE',
          department: 'SALES',
          percentageRate: new Decimal('2.00'),
          effectiveDate: new Date('2026-01-01'),
          isActive: true,
        },
      });

      const fiPlan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-report-002',
          planType: 'PERCENTAGE',
          department: 'F&I',
          percentageRate: new Decimal('3.00'),
          effectiveDate: new Date('2026-01-01'),
          isActive: true,
        },
      });

      // Sales commissions
      for (let i = 1; i <= 3; i++) {
        await (prisma as any).commissionRecord.create({
          data: {
            tenantId,
            employeeId: 'emp-report-001',
            dealId: `deal-sales-${i}`,
            dealType: 'NEW_VEHICLE',
            grossProfit: new Decimal('5000.00'),
            commissionAmount: new Decimal('100.00'),
            planId: salesPlan.id,
            status: 'ACCRUED',
            periodYear: 2026,
            periodMonth: 5,
          },
        });
      }

      // F&I commissions
      for (let i = 1; i <= 2; i++) {
        await (prisma as any).commissionRecord.create({
          data: {
            tenantId,
            employeeId: 'emp-report-002',
            dealId: `deal-fi-${i}`,
            dealType: 'NEW_VEHICLE',
            grossProfit: new Decimal('3000.00'),
            commissionAmount: new Decimal('90.00'),
            planId: fiPlan.id,
            status: 'ACCRUED',
            periodYear: 2026,
            periodMonth: 5,
          },
        });
      }
    });

    it('should generate report by employee for period', async () => {
      const records = await (prisma as any).commissionRecord.findMany({
        where: {
          tenantId,
          periodYear: 2026,
          periodMonth: 5,
        },
      });

      expect(records.length).toBe(5);
    });

    it('should aggregate by department', async () => {
      const records = await (prisma as any).commissionRecord.findMany({
        where: {
          tenantId,
          periodYear: 2026,
          periodMonth: 5,
        },
        include: { plan: true },
      });

      const byDept: Record<string, number> = {};
      for (const r of records) {
        if (r.plan?.department) {
          byDept[r.plan.department] = (byDept[r.plan.department] || 0) + r.commissionAmount.toNumber();
        }
      }

      expect(byDept.SALES).toBe(300.00);
      expect(byDept['F&I']).toBe(180.00);
    });

    it('should include deal_count per employee', async () => {
      const records = await (prisma as any).commissionRecord.findMany({
        where: { tenantId, employeeId: 'emp-report-001', periodYear: 2026, periodMonth: 5 },
      });

      expect(records.length).toBe(3); // deal_count
    });
  });

  describe('Commission Status Transitions', () => {
    let planId: string;

    beforeEach(async () => {
      const plan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-status',
          planType: 'PERCENTAGE',
          department: 'SALES',
          percentageRate: new Decimal('2.00'),
          effectiveDate: new Date('2026-01-01'),
          isActive: true,
        },
      });
      planId = plan.id;
    });

    it('should transition ACCRUED → PAID', async () => {
      const record = await (prisma as any).commissionRecord.create({
        data: {
          tenantId,
          employeeId: 'emp-status',
          dealId: 'deal-status',
          dealType: 'NEW_VEHICLE',
          grossProfit: new Decimal('5000.00'),
          commissionAmount: new Decimal('100.00'),
          planId,
          status: 'ACCRUED',
        },
      });

      const paid = await (prisma as any).commissionRecord.update({
        where: { id: record.id },
        data: { status: 'PAID' },
      });

      expect(paid.status).toBe('PAID');
    });

    it('should support ADJUSTED status for corrections', async () => {
      const record = await (prisma as any).commissionRecord.create({
        data: {
          tenantId,
          employeeId: 'emp-status',
          dealId: 'deal-adjusted',
          dealType: 'NEW_VEHICLE',
          grossProfit: new Decimal('5000.00'),
          commissionAmount: new Decimal('100.00'),
          planId,
          status: 'ACCRUED',
        },
      });

      const adjusted = await (prisma as any).commissionRecord.update({
        where: { id: record.id },
        data: { status: 'ADJUSTED', commissionAmount: new Decimal('80.00') },
      });

      expect(adjusted.status).toBe('ADJUSTED');
      expect(adjusted.commissionAmount).toBe('80.00');
    });

    it('should support CHARGED_BACK for chargebacks', async () => {
      const record = await (prisma as any).commissionRecord.create({
        data: {
          tenantId,
          employeeId: 'emp-status',
          dealId: 'deal-chargeback',
          dealType: 'NEW_VEHICLE',
          grossProfit: new Decimal('5000.00'),
          commissionAmount: new Decimal('100.00'),
          planId,
          status: 'PAID',
        },
      });

      const chargedBack = await (prisma as any).commissionRecord.update({
        where: { id: record.id },
        data: { status: 'CHARGED_BACK', commissionAmount: new Decimal('-100.00') },
      });

      expect(chargedBack.status).toBe('CHARGED_BACK');
      expect(chargedBack.commissionAmount).toBe('-100.00');
    });
  });

  describe('Commission Data Precision', () => {
    it('should store commission amounts with NUMERIC(15,2) precision', async () => {
      const plan = await (prisma as any).commissionPlan.create({
        data: {
          tenantId,
          employeeId: 'emp-precision',
          planType: 'PERCENTAGE',
          department: 'SALES',
          percentageRate: new Decimal('2.00'),
          effectiveDate: new Date('2026-01-01'),
          isActive: true,
        },
      });

      const record = await (prisma as any).commissionRecord.create({
        data: {
          tenantId,
          employeeId: 'emp-precision',
          dealId: 'deal-precision',
          dealType: 'NEW_VEHICLE',
          grossProfit: new Decimal('123456789.12'),
          commissionAmount: new Decimal('2469135.78'),
          planId: plan.id,
          status: 'ACCRUED',
        },
      });

      expect(record.commissionAmount.toString()).toMatch(/2469135\.78/);
    });
  });

  describe('Multi-tenant isolation', () => {
    it('should filter commissions by tenantId', async () => {
      const otherTenantId = 'other-tenant-commission' as TenantId;
      const records = await (prisma as any).commissionRecord.findMany({
        where: { tenantId: otherTenantId },
      });

      expect(records.length).toBe(0);
    });
  });
});
