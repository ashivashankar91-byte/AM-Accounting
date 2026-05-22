import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TenantId, asTenantId } from '@amacc/shared-kernel';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

function getTenantId(request: any): TenantId {
  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  if (!tenantId || tenantId.trim() === '') {
    const err: any = new Error('Missing required header: x-tenant-id');
    err.statusCode = 400;
    throw err;
  }
  return asTenantId(tenantId);
}

const Generate1099Schema = z.object({
  tax_year: z.number().int().min(2000).max(2100),
  form_types: z.array(z.enum(['1099-MISC', '1099-NEC'])).min(1),
  minimum_threshold: z.number().gt(0).default(600),
});

const Update1099Schema = z.object({
  total_payments: z.number().optional(),
  box_amounts: z.record(z.number()).optional(),
  adjustment_reason: z.string().optional(),
  status: z.enum(['DRAFT', 'REVIEWED', 'FILED', 'CORRECTED', 'VOID']).optional(),
});

const Export1099Schema = z.object({
  tax_year: z.number().int(),
  form_status: z.enum(['FILED']).default('FILED'),
  export_format: z.enum(['FIRE']).default('FIRE'),
});

const Review1099Schema = z.object({
  taxYear: z.coerce.number().int(),
  status: z.string().optional(),
});

export async function report1099Routes(app: FastifyInstance, prisma: PrismaClient) {
  // POST /api/v1/ap/1099/generate — Generate 1099s for tax year
  app.post<{ Body: z.infer<typeof Generate1099Schema> }>(
    '/1099/generate',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const body = Generate1099Schema.parse(request.body);
      const userId = (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? '1099-api';

      // TODO: In production, query AP check history to find vendors with payments >= threshold
      // For now, return success stub
      const generatedVendors: any[] = [];

      // Find existing vendors that meet threshold
      const existingRecords = await (prisma as any).vendor1099Record.findMany({
        where: {
          tenantId,
          taxYear: body.tax_year,
          totalPayments: { gte: new Decimal(body.minimum_threshold.toString()) },
        },
        distinct: ['vendorId'],
      });

      for (const record of existingRecords) {
        generatedVendors.push({
          vendor_id: record.vendorId,
          vendor_name: `Vendor ${record.vendorId}`,
          tin: record.tin,
          form_type: record.formType,
          total_payments: Number(record.totalPayments),
          status: record.status,
          id: record.id,
        });
      }

      return reply.status(200).send({
        status: 'SUCCESS',
        tax_year: body.tax_year,
        forms_generated: generatedVendors.length,
        vendors: generatedVendors,
        total_1099_amount: generatedVendors.reduce((sum: number, v: any) => sum + v.total_payments, 0),
      });
    },
  );

  // GET /api/v1/ap/1099/review — List 1099 records for review
  app.get<{ Querystring: z.infer<typeof Review1099Schema> }>(
    '/1099/review',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { taxYear, status } = request.query as any;

      if (!taxYear) {
        return reply.status(400).send({
          error: 'MISSING_TAX_YEAR',
          message: 'taxYear query parameter is required',
        });
      }

      const where: any = { tenantId, taxYear: parseInt(taxYear) };
      if (status) where.status = status;

      const forms = await (prisma as any).vendor1099Record.findMany({
        where,
        orderBy: { vendorId: 'asc' },
      });

      return reply.send({
        tax_year: parseInt(taxYear),
        forms: forms.map((f: any) => ({
          id: f.id,
          vendor_id: f.vendorId,
          tin: f.tin,
          form_type: f.formType,
          total_payments: Number(f.totalPayments),
          box_amounts: f.boxAmounts,
          status: f.status,
          created_at: f.createdAt.toISOString(),
        })),
        count: forms.length,
      });
    },
  );

  // PATCH /api/v1/ap/1099/:id — Update 1099 record
  app.patch<{ Params: { id: string }; Body: z.infer<typeof Update1099Schema> }>(
    '/1099/:id',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { id } = request.params;
      const body = Update1099Schema.parse(request.body);
      const userId = (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? '1099-api';

      // Verify record belongs to tenant
      const existing = await (prisma as any).vendor1099Record.findFirst({
        where: { id, tenantId },
      });
      if (!existing) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `1099 record ${id} not found`,
        });
      }

      const updateData: any = {
        updatedBy: userId,
      };

      if (body.total_payments !== undefined) {
        updateData.totalPayments = new Decimal(body.total_payments.toString());
      }
      if (body.box_amounts !== undefined) {
        updateData.boxAmounts = body.box_amounts;
      }
      if (body.adjustment_reason !== undefined) {
        updateData.adjustmentReason = body.adjustment_reason;
      }
      if (body.status !== undefined) {
        updateData.status = body.status;
      }

      const updated = await (prisma as any).vendor1099Record.update({
        where: { id },
        data: updateData,
      });

      return reply.send({
        id: updated.id,
        total_payments: Number(updated.totalPayments),
        box_amounts: updated.boxAmounts,
        status: updated.status,
        updated_at: updated.updatedAt.toISOString(),
      });
    },
  );

  // POST /api/v1/ap/1099/export — Export 1099s to FIRE format
  app.post<{ Body: z.infer<typeof Export1099Schema> }>(
    '/1099/export',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const body = Export1099Schema.parse(request.body);

      const records = await (prisma as any).vendor1099Record.findMany({
        where: {
          tenantId,
          taxYear: body.tax_year,
          status: body.form_status,
        },
      });

      if (records.length === 0) {
        return reply.status(400).send({
          error: 'NO_RECORDS_TO_EXPORT',
          message: `No ${body.form_status} 1099 records found for year ${body.tax_year}`,
        });
      }

      // Generate FIRE format stub
      let fireContent = 'FIRE Format Export Stub\n';
      fireContent += `Tax Year: ${body.tax_year}\n`;
      fireContent += `Record Count: ${records.length}\n\n`;

      for (const record of records) {
        fireContent += `Vendor: ${record.vendorId}\n`;
        fireContent += `TIN: ${record.tin}\n`;
        fireContent += `Form Type: ${record.formType}\n`;
        fireContent += `Total Payments: ${Number(record.totalPayments)}\n`;
        fireContent += `---\n`;
      }

      return reply.header('Content-Type', 'text/plain').header('Content-Disposition', `attachment; filename="1099-FIRE-${body.tax_year}.txt"`).send(fireContent);
    },
  );

  // GET /api/v1/ap/1099/:id/pdf — Download 1099 as PDF (returns JSON structure for renderer)
  app.get<{ Params: { id: string } }>(
    '/1099/:id/pdf',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { id } = request.params;

      const record = await (prisma as any).vendor1099Record.findFirst({
        where: { id, tenantId },
      });

      if (!record) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `1099 record ${id} not found`,
        });
      }

      // Return JSON structure for PDF renderer
      return reply.send({
        form_type: record.formType,
        tax_year: record.taxYear,
        vendor_id: record.vendorId,
        tin: record.tin,
        total_payments: Number(record.totalPayments),
        box_1: record.boxAmounts.box_1 || 0,
        box_2: record.boxAmounts.box_2 || 0,
        box_3: record.boxAmounts.box_3 || 0,
        box_4: record.boxAmounts.box_4 || 0,
        box_5a: record.boxAmounts.box_5a || 0,
        box_5b: record.boxAmounts.box_5b || 0,
        box_6: record.boxAmounts.box_6 || 0,
        box_7: record.boxAmounts.box_7 || 0,
        box_8: record.boxAmounts.box_8 || 0,
        box_9: record.boxAmounts.box_9 || 0,
        status: record.status,
        created_at: record.createdAt.toISOString(),
      });
    },
  );
}
