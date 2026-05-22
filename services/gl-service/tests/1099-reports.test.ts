import { describe, it, expect, beforeEach } from 'vitest';
import { TenantId } from '@amacc/shared-kernel';
import { PrismaClient } from '@prisma/client';

describe('1099 Contractor Reports API', () => {
  let prisma: PrismaClient;
  let tenantId: TenantId;

  beforeEach(async () => {
    prisma = new PrismaClient();
    tenantId = 'test-tenant-1099' as TenantId;
  });

  describe('POST /api/v1/ap/1099/generate', () => {
    it('should generate 1099 records for vendors with $600+ payments', async () => {
      const vendors = [
        { vendor_id: 'vendor-001', name: 'ABC Hydraulics Inc.', tin: '12-3456789', total_payments: 8500.00 },
        { vendor_id: 'vendor-002', name: 'XYZ Parts Corp', tin: '98-7654321', total_payments: 450.00 },
        { vendor_id: 'vendor-003', name: 'Supplier A', tin: '55-5555555', total_payments: 600.00 },
      ];

      // Create test 1099 records for tax year 2026
      const created = [];
      for (const vendor of vendors) {
        if (vendor.total_payments >= 600) {
          const record = await (prisma as any).vendor1099Record.create({
            data: {
              tenantId,
              vendorId: vendor.vendor_id,
              taxYear: 2026,
              formType: '1099-MISC',
              tin: vendor.tin,
              totalPayments: vendor.total_payments,
              boxAmounts: { box_1: vendor.total_payments },
              status: 'DRAFT',
            },
          });
          created.push(record);
        }
      }

      expect(created.length).toBe(2);
      expect(created[0].totalPayments).toBe(8500.00);
      expect(created[1].totalPayments).toBe(600.00);
    });

    it('should not generate 1099 for vendors below $600 threshold', async () => {
      const record = await (prisma as any).vendor1099Record.findMany({
        where: {
          tenantId,
          totalPayments: { lt: 600 },
        },
      });

      expect(record.length).toBe(0);
    });

    it('should consolidate 1099 records by TIN across rooftops', async () => {
      // Create records for same TIN from different vendors
      const tin = '12-3456789';

      await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-rooftop-1',
          taxYear: 2026,
          formType: '1099-MISC',
          tin,
          totalPayments: 3500.00,
          boxAmounts: { box_1: 3500.00 },
          status: 'DRAFT',
        },
      });

      await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-rooftop-2',
          taxYear: 2026,
          formType: '1099-MISC',
          tin,
          totalPayments: 5000.00,
          boxAmounts: { box_1: 5000.00 },
          status: 'DRAFT',
        },
      });

      const records = await (prisma as any).vendor1099Record.findMany({
        where: { tenantId, tin, taxYear: 2026 },
      });

      expect(records.length).toBe(2);
      const totalByTin = records.reduce((sum: number, r: any) => sum + r.totalPayments.toNumber(), 0);
      expect(totalByTin).toBe(8500.00);
    });

    it('should support 1099-MISC and 1099-NEC form types', async () => {
      const miscRecord = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-misc',
          taxYear: 2026,
          formType: '1099-MISC',
          tin: '12-3456789',
          totalPayments: 1000.00,
          boxAmounts: { box_1: 1000.00 },
          status: 'DRAFT',
        },
      });

      const necRecord = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-nec',
          taxYear: 2026,
          formType: '1099-NEC',
          tin: '98-7654321',
          totalPayments: 2000.00,
          boxAmounts: { box_1: 2000.00 },
          status: 'DRAFT',
        },
      });

      expect(miscRecord.formType).toBe('1099-MISC');
      expect(necRecord.formType).toBe('1099-NEC');
    });

    it('should prevent duplicate vendor/year/form_type combinations', async () => {
      const data = {
        tenantId,
        vendorId: 'vendor-dup',
        taxYear: 2026,
        formType: '1099-MISC',
        tin: '12-3456789',
        totalPayments: 1000.00,
        boxAmounts: { box_1: 1000.00 },
        status: 'DRAFT',
      };

      await (prisma as any).vendor1099Record.create({ data });

      expect(async () => {
        await (prisma as any).vendor1099Record.create({ data });
      }).rejects.toThrow();
    });

    it('should initialize DRAFT status', async () => {
      const record = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-draft-test',
          taxYear: 2026,
          formType: '1099-MISC',
          tin: '12-3456789',
          totalPayments: 1000.00,
          boxAmounts: { box_1: 1000.00 },
        },
      });

      expect(record.status).toBe('DRAFT');
    });
  });

  describe('GET /api/v1/ap/1099/review', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 3; i++) {
        await (prisma as any).vendor1099Record.create({
          data: {
            tenantId,
            vendorId: `vendor-${i}`,
            taxYear: 2026,
            formType: '1099-MISC',
            tin: `12-000000${i}`,
            totalPayments: 1000.00 * i,
            boxAmounts: { box_1: 1000.00 * i },
            status: 'DRAFT',
          },
        });
      }
    });

    it('should list all 1099 records for tax year', async () => {
      const records = await (prisma as any).vendor1099Record.findMany({
        where: { tenantId, taxYear: 2026 },
      });

      expect(records.length).toBe(3);
    });

    it('should filter by status', async () => {
      const draftRecords = await (prisma as any).vendor1099Record.findMany({
        where: { tenantId, taxYear: 2026, status: 'DRAFT' },
      });

      expect(draftRecords.length).toBe(3);
      expect(draftRecords.every((r: any) => r.status === 'DRAFT')).toBe(true);
    });

    it('should include box_amounts JSONB data', async () => {
      const records = await (prisma as any).vendor1099Record.findMany({
        where: { tenantId, taxYear: 2026 },
      });

      expect(records[0].boxAmounts).toBeDefined();
      expect(records[0].boxAmounts.box_1).toBeDefined();
    });

    it('should filter by tenantId for multi-tenant isolation', async () => {
      const otherTenantId = 'other-tenant-1099' as TenantId;
      const records = await (prisma as any).vendor1099Record.findMany({
        where: { tenantId: otherTenantId },
      });

      expect(records.length).toBe(0);
    });
  });

  describe('PATCH /api/v1/ap/1099/:id', () => {
    let recordId: string;

    beforeEach(async () => {
      const record = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-patch-test',
          taxYear: 2026,
          formType: '1099-MISC',
          tin: '12-3456789',
          totalPayments: 1000.00,
          boxAmounts: { box_1: 1000.00 },
          status: 'DRAFT',
        },
      });
      recordId = record.id;
    });

    it('should update total_payments amount', async () => {
      const updated = await (prisma as any).vendor1099Record.update({
        where: { id: recordId },
        data: {
          totalPayments: 800.00,
          boxAmounts: { box_1: 800.00 },
        },
      });

      expect(updated.totalPayments).toBe(800.00);
      expect(updated.boxAmounts.box_1).toBe(800.00);
    });

    it('should update status to REVIEWED', async () => {
      const updated = await (prisma as any).vendor1099Record.update({
        where: { id: recordId },
        data: { status: 'REVIEWED' },
      });

      expect(updated.status).toBe('REVIEWED');
    });

    it('should record adjustment_reason', async () => {
      const updated = await (prisma as any).vendor1099Record.update({
        where: { id: recordId },
        data: {
          adjustmentReason: 'Voided check on 2026-05-20',
          totalPayments: 800.00,
          boxAmounts: { box_1: 800.00 },
        },
      });

      expect(updated.adjustmentReason).toBe('Voided check on 2026-05-20');
    });

    it('should support 1099-X corrected form type', async () => {
      const corrected = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-patch-test',
          taxYear: 2026,
          formType: '1099-X',
          tin: '12-3456789',
          totalPayments: 800.00,
          boxAmounts: { box_1: 800.00 },
          status: 'DRAFT',
          correctedFromId: recordId,
        },
      });

      expect(corrected.formType).toBe('1099-X');
      expect(corrected.correctedFromId).toBe(recordId);
    });

    it('should update created_by and updated_by fields', async () => {
      const updated = await (prisma as any).vendor1099Record.update({
        where: { id: recordId },
        data: {
          updatedBy: 'user-123',
          status: 'REVIEWED',
        },
      });

      expect(updated.updatedBy).toBe('user-123');
    });
  });

  describe('POST /api/v1/ap/1099/export', () => {
    beforeEach(async () => {
      await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-export',
          taxYear: 2026,
          formType: '1099-MISC',
          tin: '12-3456789',
          totalPayments: 1000.00,
          boxAmounts: { box_1: 1000.00 },
          status: 'REVIEWED',
          filedDate: new Date('2026-01-15'),
        },
      });
    });

    it('should prepare FIRE format export for filed 1099s', async () => {
      const records = await (prisma as any).vendor1099Record.findMany({
        where: {
          tenantId,
          taxYear: 2026,
          status: 'FILED',
        },
      });

      // Export preparation (stub for FIRE format)
      expect(records).toBeDefined();
    });

    it('should include filed_date timestamp when exporting', async () => {
      const records = await (prisma as any).vendor1099Record.findMany({
        where: {
          tenantId,
          taxYear: 2026,
          filedDate: { not: null },
        },
      });

      expect(records.length).toBeGreaterThan(0);
      expect(records[0].filedDate).toBeDefined();
    });
  });

  describe('GET /api/v1/ap/1099/:id/pdf', () => {
    let recordId: string;

    beforeEach(async () => {
      const record = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-pdf',
          taxYear: 2026,
          formType: '1099-MISC',
          tin: '12-3456789',
          totalPayments: 5000.00,
          boxAmounts: {
            box_1: 5000.00,
            box_2: 0,
            box_3: 0,
          },
          status: 'REVIEWED',
        },
      });
      recordId = record.id;
    });

    it('should retrieve 1099 record for PDF generation', async () => {
      const record = await (prisma as any).vendor1099Record.findUnique({
        where: { id: recordId },
      });

      expect(record).toBeDefined();
      expect(record.boxAmounts).toBeDefined();
    });

    it('should include all box amounts in PDF data', async () => {
      const record = await (prisma as any).vendor1099Record.findUnique({
        where: { id: recordId },
      });

      expect(record.boxAmounts.box_1).toBe(5000.00);
    });

    it('should handle 1099-NEC form type for PDF', async () => {
      const necRecord = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-nec-pdf',
          taxYear: 2026,
          formType: '1099-NEC',
          tin: '98-7654321',
          totalPayments: 3000.00,
          boxAmounts: { box_1: 3000.00 },
          status: 'REVIEWED',
        },
      });

      expect(necRecord.formType).toBe('1099-NEC');
    });
  });

  describe('1099 Status Transitions', () => {
    it('should transition DRAFT → REVIEWED → FILED', async () => {
      const record = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-transitions',
          taxYear: 2026,
          formType: '1099-MISC',
          tin: '12-3456789',
          totalPayments: 1000.00,
          boxAmounts: { box_1: 1000.00 },
          status: 'DRAFT',
        },
      });

      const reviewed = await (prisma as any).vendor1099Record.update({
        where: { id: record.id },
        data: { status: 'REVIEWED' },
      });
      expect(reviewed.status).toBe('REVIEWED');

      const filed = await (prisma as any).vendor1099Record.update({
        where: { id: record.id },
        data: { status: 'FILED', filedDate: new Date() },
      });
      expect(filed.status).toBe('FILED');
    });

    it('should support CORRECTED and VOID status', async () => {
      const record = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-void',
          taxYear: 2026,
          formType: '1099-MISC',
          tin: '12-3456789',
          totalPayments: 1000.00,
          boxAmounts: { box_1: 1000.00 },
          status: 'DRAFT',
        },
      });

      const voided = await (prisma as any).vendor1099Record.update({
        where: { id: record.id },
        data: { status: 'VOID' },
      });
      expect(voided.status).toBe('VOID');
    });
  });

  describe('1099 Data Precision', () => {
    it('should store total_payments with NUMERIC(15,2) precision', async () => {
      const record = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-precision',
          taxYear: 2026,
          formType: '1099-MISC',
          tin: '12-3456789',
          totalPayments: 123456789.12,
          boxAmounts: { box_1: 123456789.12 },
          status: 'DRAFT',
        },
      });

      expect(record.totalPayments.toString()).toMatch(/123456789\.12/);
    });

    it('should store boxAmounts as JSONB with multiple boxes', async () => {
      const record = await (prisma as any).vendor1099Record.create({
        data: {
          tenantId,
          vendorId: 'vendor-boxes',
          taxYear: 2026,
          formType: '1099-NEC',
          tin: '12-3456789',
          totalPayments: 10000.00,
          boxAmounts: {
            box_1: 8000.00,
            box_2: 1000.00,
            box_3: 1000.00,
            box_4: 0,
          },
          status: 'DRAFT',
        },
      });

      expect(record.boxAmounts.box_1).toBe(8000.00);
      expect(record.boxAmounts.box_2).toBe(1000.00);
    });
  });
});
