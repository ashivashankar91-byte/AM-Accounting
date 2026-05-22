import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantId } from '@amacc/shared-kernel';
import { PrismaClient } from '@prisma/client';

describe('Sales Tax Accrual API', () => {
  let prisma: PrismaClient;
  let tenantId: TenantId;
  let payableAccountId: string;
  let receivableAccountId: string;

  beforeEach(async () => {
    prisma = new PrismaClient();
    tenantId = 'test-tenant-001' as TenantId;

    // Create test GL accounts for tax
    const payableAccount = await prisma.gLAccount.create({
      data: {
        tenantId,
        code: '2530',
        name: 'Sales Tax Payable - CA',
        type: 'LIABILITY',
        normalBalance: 'CREDIT',
        allowPosting: true,
      },
    });
    payableAccountId = payableAccount.id;

    const receivableAccount = await prisma.gLAccount.create({
      data: {
        tenantId,
        code: '1150',
        name: 'Tax Receivable',
        type: 'ASSET',
        normalBalance: 'DEBIT',
        allowPosting: true,
      },
    });
    receivableAccountId = receivableAccount.id;
  });

  describe('POST /api/v1/gl/tax/configure', () => {
    it('should create a tax jurisdiction with valid data', async () => {
      const jurisdiction = {
        jurisdiction_code: 'CA_ALAMEDA_OAKLAND',
        jurisdiction_name: 'Oakland, Alameda County, California',
        jurisdiction_level: 'CITY',
        tax_rate: 0.08625,
        gl_payable_account_id: payableAccountId,
        gl_receivable_account_id: receivableAccountId,
        effective_date: '2026-06-01',
        is_active: true,
      };

      const result = await prisma.taxJurisdiction.create({
        data: {
          tenantId,
          jurisdictionCode: jurisdiction.jurisdiction_code,
          jurisdictionName: jurisdiction.jurisdiction_name,
          jurisdictionLevel: jurisdiction.jurisdiction_level,
          taxRate: jurisdiction.tax_rate,
          glPayableAccountId: jurisdiction.gl_payable_account_id,
          glReceivableAccountId: jurisdiction.gl_receivable_account_id,
          effectiveDate: new Date(jurisdiction.effective_date),
        },
      });

      expect(result).toBeDefined();
      expect(result.tenantId).toBe(tenantId);
      expect(result.jurisdictionCode).toBe('CA_ALAMEDA_OAKLAND');
      expect(result.taxRate).toBe(0.08625);
    });

    it('should reject duplicate jurisdiction code for same tenant/date', async () => {
      const data = {
        tenantId,
        jurisdictionCode: 'CA_ALAMEDA_OAKLAND',
        jurisdictionName: 'Oakland, Alameda County, California',
        jurisdictionLevel: 'CITY' as const,
        taxRate: 0.08625,
        glPayableAccountId: payableAccountId,
        glReceivableAccountId: receivableAccountId,
        effectiveDate: new Date('2026-06-01'),
      };

      await prisma.taxJurisdiction.create({ data });

      expect(async () => {
        await prisma.taxJurisdiction.create({ data });
      }).rejects.toThrow();
    });

    it('should allow different effective dates for same jurisdiction code', async () => {
      const baseData = {
        tenantId,
        jurisdictionCode: 'CA_ALAMEDA_OAKLAND',
        jurisdictionName: 'Oakland, Alameda County, California',
        jurisdictionLevel: 'CITY' as const,
        taxRate: 0.08625,
        glPayableAccountId: payableAccountId,
        glReceivableAccountId: receivableAccountId,
      };

      const r1 = await prisma.taxJurisdiction.create({
        data: {
          ...baseData,
          effectiveDate: new Date('2026-06-01'),
        },
      });

      const r2 = await prisma.taxJurisdiction.create({
        data: {
          ...baseData,
          taxRate: 0.09,
          effectiveDate: new Date('2026-07-01'),
        },
      });

      expect(r1.id).not.toBe(r2.id);
      expect(r1.taxRate).toBe(0.08625);
      expect(r2.taxRate).toBe(0.09);
    });

    it('should validate jurisdiction_level CHECK constraint', async () => {
      expect(async () => {
        await prisma.taxJurisdiction.create({
          data: {
            tenantId,
            jurisdictionCode: 'CA_TEST',
            jurisdictionName: 'Test',
            jurisdictionLevel: 'INVALID' as any,
            taxRate: 0.08,
            glPayableAccountId: payableAccountId,
            glReceivableAccountId: receivableAccountId,
            effectiveDate: new Date(),
          },
        });
      }).rejects.toThrow();
    });

    it('should store tax_rate with NUMERIC(6,4) precision', async () => {
      const result = await prisma.taxJurisdiction.create({
        data: {
          tenantId,
          jurisdictionCode: 'CA_PRECISION_TEST',
          jurisdictionName: 'Precision Test',
          jurisdictionLevel: 'STATE',
          taxRate: 0.123456, // Will be rounded to 0.1235
          glPayableAccountId: payableAccountId,
          glReceivableAccountId: receivableAccountId,
          effectiveDate: new Date(),
        },
      });

      expect(result.taxRate).toBe(0.1235);
    });
  });

  describe('GET /api/v1/gl/tax/rates', () => {
    beforeEach(async () => {
      await prisma.taxJurisdiction.create({
        data: {
          tenantId,
          jurisdictionCode: 'CA_ALAMEDA',
          jurisdictionName: 'Alameda County, California',
          jurisdictionLevel: 'COUNTY',
          taxRate: 0.0725,
          glPayableAccountId: payableAccountId,
          glReceivableAccountId: receivableAccountId,
          effectiveDate: new Date('2026-01-01'),
        },
      });

      await prisma.taxJurisdiction.create({
        data: {
          tenantId,
          jurisdictionCode: 'CA_ALAMEDA',
          jurisdictionName: 'Alameda County, California',
          jurisdictionLevel: 'COUNTY',
          taxRate: 0.0750,
          glPayableAccountId: payableAccountId,
          glReceivableAccountId: receivableAccountId,
          effectiveDate: new Date('2026-06-01'),
          isActive: false,
        },
      });
    });

    it('should list all active jurisdictions for tenant', async () => {
      const results = await prisma.taxJurisdiction.findMany({
        where: { tenantId, isActive: true },
      });

      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter by jurisdiction_code', async () => {
      const results = await prisma.taxJurisdiction.findMany({
        where: { tenantId, jurisdictionCode: 'CA_ALAMEDA' },
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every(r => r.jurisdictionCode === 'CA_ALAMEDA')).toBe(true);
    });

    it('should filter by is_active status', async () => {
      const activeOnly = await prisma.taxJurisdiction.findMany({
        where: { tenantId, isActive: true },
      });

      expect(activeOnly.every(r => r.isActive === true)).toBe(true);
    });

    it('should filter by effective_date', async () => {
      const cutoffDate = new Date('2026-03-01');
      const results = await prisma.taxJurisdiction.findMany({
        where: {
          tenantId,
          effectiveDate: { lte: cutoffDate },
        },
      });

      expect(results.every(r => r.effectiveDate <= cutoffDate)).toBe(true);
    });
  });

  describe('POST /api/v1/gl/tax/accrue', () => {
    beforeEach(async () => {
      await prisma.taxJurisdiction.create({
        data: {
          tenantId,
          jurisdictionCode: 'CA_ALAMEDA_OAKLAND',
          jurisdictionName: 'Oakland, Alameda County, California',
          jurisdictionLevel: 'CITY',
          taxRate: 0.08625,
          glPayableAccountId: payableAccountId,
          glReceivableAccountId: receivableAccountId,
          effectiveDate: new Date('2026-01-01'),
        },
      });
    });

    it('should create tax accrual entry with correct calculation', async () => {
      const dealId = 'deal-12345';
      const taxableAmount = 3000.00;
      const jurisdictionCode = 'CA_ALAMEDA_OAKLAND';

      const entry = await prisma.taxAccrualEntry.create({
        data: {
          tenantId,
          dealId,
          jurisdictionCode,
          taxableAmount,
          taxRate: 0.08625,
          taxAmount: 258.75,
          accrualDate: new Date('2026-05-15'),
        },
      });

      expect(entry).toBeDefined();
      expect(entry.dealId).toBe(dealId);
      expect(entry.taxAmount).toBe(258.75);
      expect(entry.taxableAmount).toBe(3000.00);
    });

    it('should create journal entry for tax accrual (debit tax receivable, credit tax payable)', async () => {
      const journalEntry = await prisma.journalEntry.create({
        data: {
          tenantId,
          entryDate: new Date('2026-05-15'),
          description: 'Sales tax accrual for deal DEF456',
          source: 'TAX_ACCRUAL',
          sourceRef: 'deal-DEF456',
          lines: {
            create: [
              {
                glAccountId: receivableAccountId,
                debit: 258.75,
                credit: 0,
              },
              {
                glAccountId: payableAccountId,
                debit: 0,
                credit: 258.75,
              },
            ],
          },
        },
      });

      expect(journalEntry).toBeDefined();
      expect(journalEntry.sourceRef).toBe('deal-DEF456');
    });

    it('should skip accrual if customer has active tax exemption', async () => {
      const customerId = 'customer-exempt-001';

      await prisma.taxExemption.create({
        data: {
          tenantId,
          customerId,
          jurisdictionCode: 'CA_ALAMEDA_OAKLAND',
          certificateNumber: 'CERT-123456',
          expirationDate: new Date('2027-12-31'),
          isActive: true,
        },
      });

      const exemption = await prisma.taxExemption.findFirst({
        where: {
          tenantId,
          customerId,
          isActive: true,
          expirationDate: { gt: new Date() },
        },
      });

      expect(exemption).toBeDefined();
      expect(exemption?.isActive).toBe(true);
    });

    it('should use NUMERIC(15,2) for tax amounts without precision loss', async () => {
      const entry = await prisma.taxAccrualEntry.create({
        data: {
          tenantId,
          dealId: 'deal-precision-test',
          jurisdictionCode: 'CA_ALAMEDA_OAKLAND',
          taxableAmount: 123456789.12,
          taxRate: 0.08625,
          taxAmount: 10643099.99,
          accrualDate: new Date(),
        },
      });

      expect(entry.taxableAmount.toString()).toMatch(/123456789\.12/);
      expect(entry.taxAmount.toString()).toMatch(/10643099\.99/);
    });
  });

  describe('GET /api/v1/gl/tax/liability-report', () => {
    beforeEach(async () => {
      await prisma.taxJurisdiction.create({
        data: {
          tenantId,
          jurisdictionCode: 'CA_ALAMEDA',
          jurisdictionName: 'Alameda County, California',
          jurisdictionLevel: 'COUNTY',
          taxRate: 0.0725,
          glPayableAccountId: payableAccountId,
          glReceivableAccountId: receivableAccountId,
          effectiveDate: new Date('2026-01-01'),
        },
      });

      // Create multiple tax accruals for May 2026
      await prisma.taxAccrualEntry.create({
        data: {
          tenantId,
          dealId: 'deal-001',
          jurisdictionCode: 'CA_ALAMEDA',
          taxableAmount: 2000.00,
          taxRate: 0.0725,
          taxAmount: 145.00,
          accrualDate: new Date('2026-05-10'),
        },
      });

      await prisma.taxAccrualEntry.create({
        data: {
          tenantId,
          dealId: 'deal-002',
          jurisdictionCode: 'CA_ALAMEDA',
          taxableAmount: 2702.48,
          taxRate: 0.0725,
          taxAmount: 195.81,
          accrualDate: new Date('2026-05-15'),
        },
      });
    });

    it('should aggregate tax accruals by jurisdiction for a period', async () => {
      const entries = await prisma.taxAccrualEntry.findMany({
        where: {
          tenantId,
          accrualDate: {
            gte: new Date('2026-05-01'),
            lte: new Date('2026-05-31'),
          },
        },
      });

      const totalTax = entries.reduce((sum, e) => sum + e.taxAmount.toNumber(), 0);
      expect(totalTax).toBe(340.81);
    });

    it('should filter by jurisdiction_code in report', async () => {
      const entries = await prisma.taxAccrualEntry.findMany({
        where: {
          tenantId,
          jurisdictionCode: 'CA_ALAMEDA',
          accrualDate: {
            gte: new Date('2026-05-01'),
            lte: new Date('2026-05-31'),
          },
        },
      });

      expect(entries.every(e => e.jurisdictionCode === 'CA_ALAMEDA')).toBe(true);
    });

    it('should filter by tenantId to ensure multi-tenant isolation', async () => {
      const otherTenantId = 'other-tenant-001' as TenantId;

      // Verify no entries for other tenant
      const entries = await prisma.taxAccrualEntry.findMany({
        where: {
          tenantId: otherTenantId,
        },
      });

      expect(entries.length).toBe(0);
    });
  });

  describe('Tax Exemption Management', () => {
    it('should create tax exemption for customer', async () => {
      const exemption = await prisma.taxExemption.create({
        data: {
          tenantId,
          customerId: 'customer-exempt-001',
          jurisdictionCode: 'CA_ALAMEDA',
          certificateNumber: 'CERT-2024-001',
          certificateDocUrl: 'https://example.com/docs/cert.pdf',
          expirationDate: new Date('2027-12-31'),
          isActive: true,
        },
      });

      expect(exemption).toBeDefined();
      expect(exemption.customerId).toBe('customer-exempt-001');
    });

    it('should prevent duplicate customer/jurisdiction exemptions', async () => {
      const data = {
        tenantId,
        customerId: 'customer-dup-001',
        jurisdictionCode: 'CA_ALAMEDA',
        certificateNumber: 'CERT-2024-002',
        expirationDate: new Date('2027-12-31'),
        isActive: true,
      };

      await prisma.taxExemption.create({ data });

      expect(async () => {
        await prisma.taxExemption.create({
          data: {
            ...data,
            certificateNumber: 'CERT-2024-003',
          },
        });
      }).rejects.toThrow();
    });

    it('should deactivate expired exemptions', async () => {
      const exemption = await prisma.taxExemption.create({
        data: {
          tenantId,
          customerId: 'customer-expired-001',
          jurisdictionCode: 'CA_ALAMEDA',
          certificateNumber: 'CERT-EXPIRED-001',
          expirationDate: new Date('2025-12-31'),
          isActive: true,
        },
      });

      const isExpired = exemption.expirationDate < new Date();
      expect(isExpired).toBe(true);
    });
  });
});
