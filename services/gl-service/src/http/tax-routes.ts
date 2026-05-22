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

const TaxJurisdictionConfigSchema = z.object({
  jurisdiction_code: z.string().min(1).max(50),
  jurisdiction_name: z.string().min(1).max(500),
  jurisdiction_level: z.enum(['STATE', 'COUNTY', 'CITY', 'DISTRICT']),
  tax_rate: z.number().gt(0).lt(1),
  gl_payable_account_id: z.string().uuid(),
  gl_receivable_account_id: z.string().uuid(),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_active: z.boolean().default(true).optional(),
});

const TaxAccrueSchema = z.object({
  deal_id: z.string().min(1),
  deal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jurisdictions: z.array(
    z.object({
      jurisdiction_code: z.string().min(1),
      taxable_amount: z.number().gt(0),
    }),
  ).min(1),
  tax_exempt_reason: z.string().optional().nullable(),
});

const TaxLiabilityReportSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  jurisdiction_code: z.string().optional(),
});

export async function taxRoutes(app: FastifyInstance, prisma: PrismaClient) {
  // POST /api/v1/gl/tax/configure — Create or update tax jurisdiction
  app.post<{ Body: z.infer<typeof TaxJurisdictionConfigSchema> }>(
    '/tax/configure',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const body = TaxJurisdictionConfigSchema.parse(request.body);

      // Validate GL accounts exist
      const payableAccount = await prisma.gLAccount.findFirst({
        where: { id: body.gl_payable_account_id, tenantId },
      });
      if (!payableAccount) {
        return reply.status(400).send({
          error: 'GL_ACCOUNT_NOT_FOUND',
          message: `Payable GL account ${body.gl_payable_account_id} not found`,
        });
      }

      const receivableAccount = await prisma.gLAccount.findFirst({
        where: { id: body.gl_receivable_account_id, tenantId },
      });
      if (!receivableAccount) {
        return reply.status(400).send({
          error: 'GL_ACCOUNT_NOT_FOUND',
          message: `Receivable GL account ${body.gl_receivable_account_id} not found`,
        });
      }

      try {
        const jurisdiction = await (prisma as any).taxJurisdiction.create({
          data: {
            tenantId,
            jurisdictionCode: body.jurisdiction_code,
            jurisdictionName: body.jurisdiction_name,
            jurisdictionLevel: body.jurisdiction_level,
            taxRate: new Decimal(body.tax_rate.toString()),
            glPayableAccountId: body.gl_payable_account_id,
            glReceivableAccountId: body.gl_receivable_account_id,
            effectiveDate: new Date(body.effective_date),
            isActive: body.is_active ?? true,
          },
        });

        return reply.status(201).send({
          id: jurisdiction.id,
          tenant_id: jurisdiction.tenantId,
          jurisdiction_code: jurisdiction.jurisdictionCode,
          jurisdiction_name: jurisdiction.jurisdictionName,
          jurisdiction_level: jurisdiction.jurisdictionLevel,
          tax_rate: Number(jurisdiction.taxRate),
          gl_payable_account_id: jurisdiction.glPayableAccountId,
          gl_receivable_account_id: jurisdiction.glReceivableAccountId,
          is_active: jurisdiction.isActive,
          effective_date: jurisdiction.effectiveDate.toISOString().substring(0, 10),
          created_at: jurisdiction.createdAt.toISOString(),
        });
      } catch (e: any) {
        if (e.code === 'P2002') {
          return reply.status(409).send({
            error: 'DUPLICATE_JURISDICTION',
            message: `Jurisdiction ${body.jurisdiction_code} already exists for this tenant/date`,
          });
        }
        throw e;
      }
    },
  );

  // GET /api/v1/gl/tax/rates — List tax jurisdictions
  const TaxRatesQuerySchema = z.object({
    jurisdiction_code: z.string().optional(),
    is_active: z.string().optional(),
    effective_date: z.string().optional(),
  });
  app.get<{ Querystring: z.infer<typeof TaxRatesQuerySchema> }>(
    '/tax/rates',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { jurisdiction_code, is_active, effective_date } = request.query as any;

      const where: any = { tenantId };

      if (jurisdiction_code) where.jurisdictionCode = jurisdiction_code;
      if (is_active !== undefined) where.isActive = is_active === 'true';
      if (effective_date) where.effectiveDate = { lte: new Date(effective_date) };

      const jurisdictions = await (prisma as any).taxJurisdiction.findMany({
        where,
        orderBy: { jurisdictionCode: 'asc' },
      });

      return reply.send({
        jurisdictions: jurisdictions.map((j: any) => ({
          id: j.id,
          jurisdiction_code: j.jurisdictionCode,
          jurisdiction_name: j.jurisdictionName,
          jurisdiction_level: j.jurisdictionLevel,
          tax_rate: Number(j.taxRate),
          gl_payable_account_id: j.glPayableAccountId,
          gl_receivable_account_id: j.glReceivableAccountId,
          is_active: j.isActive,
          effective_date: j.effectiveDate.toISOString().substring(0, 10),
        })),
        count: jurisdictions.length,
      });
    },
  );

  // POST /api/v1/gl/tax/accrue — Accrue tax for a deal
  app.post<{ Body: z.infer<typeof TaxAccrueSchema> }>(
    '/tax/accrue',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const body = TaxAccrueSchema.parse(request.body);
      const userId = (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'tax-accrual-api';

      const journalEntries: any[] = [];
      const totalTaxAccrued: number[] = [];

      // Process each jurisdiction
      for (const jurisd of body.jurisdictions) {
        // Check for tax exemption
        const exemption = await (prisma as any).taxExemption.findFirst({
          where: {
            tenantId,
            jurisdictionCode: jurisd.jurisdiction_code,
            isActive: true,
            expirationDate: { gt: new Date() },
          },
        });

        if (exemption) {
          // Skip accrual for tax-exempt customer
          continue;
        }

        // Get jurisdiction rate
        const jurisdiction = await (prisma as any).taxJurisdiction.findFirst({
          where: {
            tenantId,
            jurisdictionCode: jurisd.jurisdiction_code,
            effectiveDate: { lte: new Date(body.deal_date) },
            isActive: true,
          },
          orderBy: { effectiveDate: 'desc' },
        });

        if (!jurisdiction) {
          return reply.status(400).send({
            error: 'JURISDICTION_NOT_FOUND',
            message: `No active jurisdiction configured for ${jurisd.jurisdiction_code} on ${body.deal_date}`,
          });
        }

        // Calculate tax = taxableAmount * taxRate
        const taxAmount = new Decimal(jurisd.taxable_amount.toString())
          .times(jurisdiction.taxRate)
          .toDP(2);

        // Create tax accrual entry
        const accrualEntry = await (prisma as any).taxAccrualEntry.create({
          data: {
            tenantId,
            dealId: body.deal_id,
            jurisdictionCode: jurisd.jurisdiction_code,
            taxableAmount: new Decimal(jurisd.taxable_amount.toString()),
            taxRate: jurisdiction.taxRate,
            taxAmount,
            accrualDate: new Date(body.deal_date),
          },
        });

        // Create GL journal entry: DR Tax Receivable, CR Tax Payable
        const glEntry = await (prisma as any).journalEntry.create({
          data: {
            tenantId,
            entryDate: new Date(body.deal_date),
            description: `Sales tax accrual for deal ${body.deal_id} — ${jurisd.jurisdiction_code}`,
            source: 'TAX_ACCRUAL',
            sourceRef: body.deal_id,
            status: 'DRAFT',
            createdByUserId: userId,
            lines: {
              create: [
                {
                  glAccountId: jurisdiction.glReceivableAccountId,
                  debit: Number(taxAmount),
                  credit: 0,
                  memo: `Tax receivable — ${jurisd.jurisdiction_code}`,
                },
                {
                  glAccountId: jurisdiction.glPayableAccountId,
                  debit: 0,
                  credit: Number(taxAmount),
                  memo: `Tax payable — ${jurisd.jurisdiction_code}`,
                },
              ],
            },
          },
        });

        // Update accrual entry with journal entry ID
        await (prisma as any).taxAccrualEntry.update({
          where: { id: accrualEntry.id },
          data: { journalEntryId: glEntry.id },
        });

        journalEntries.push({
          entry_id: glEntry.id,
          jurisdiction: jurisd.jurisdiction_code,
          tax_amount: Number(taxAmount),
          debit_account: 'Tax Receivable',
          credit_account: `Sales Tax Payable - ${jurisdiction.jurisdictionName}`,
          entry_date: body.deal_date,
        });

        totalTaxAccrued.push(Number(taxAmount));
      }

      return reply.status(200).send({
        status: 'SUCCESS',
        journal_entries_created: journalEntries,
        total_tax_accrued: totalTaxAccrued.reduce((a, b) => a + b, 0),
      });
    },
  );

  // GET /api/v1/gl/tax/liability-report — Generate tax liability report for period
  app.get<{ Querystring: z.infer<typeof TaxLiabilityReportSchema> }>(
    '/tax/liability-report',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { period, jurisdiction_code } = request.query as any;

      if (!period || !period.match(/^\d{4}-\d{2}$/)) {
        return reply.status(400).send({
          error: 'INVALID_PERIOD',
          message: 'period must be in YYYY-MM format',
        });
      }

      const [year, month] = period.split('-').map(Number);
      const periodStart = new Date(year, month - 1, 1);
      const periodEnd = new Date(year, month, 0);

      // Get all accrual entries for the period
      const where: any = {
        tenantId,
        accrualDate: {
          gte: periodStart,
          lte: periodEnd,
        },
      };

      if (jurisdiction_code) where.jurisdictionCode = jurisdiction_code;

      const accruals = await (prisma as any).taxAccrualEntry.findMany({
        where,
        include: { journalEntry: true },
      });

      // Group by jurisdiction
      const byJurisdiction: Record<string, any> = {};

      for (const accrual of accruals) {
        if (!byJurisdiction[accrual.jurisdictionCode]) {
          const jurisdiction = await (prisma as any).taxJurisdiction.findFirst({
            where: {
              tenantId,
              jurisdictionCode: accrual.jurisdictionCode,
            },
          });

          byJurisdiction[accrual.jurisdictionCode] = {
            jurisdiction_code: accrual.jurisdictionCode,
            jurisdiction_name: jurisdiction?.jurisdictionName,
            tax_rate: Number(jurisdiction?.taxRate),
            month_accruals: 0,
            prior_unpaid: 0,
            total_due: 0,
            tax_payable_account: jurisdiction?.glPayableAccountId,
            tax_payable_balance: 0,
          };
        }

        const amount = Number(accrual.taxAmount);
        byJurisdiction[accrual.jurisdictionCode].month_accruals += amount;
        byJurisdiction[accrual.jurisdictionCode].total_due += amount;
        byJurisdiction[accrual.jurisdictionCode].tax_payable_balance += amount;
      }

      const jurisdictionArray = Object.values(byJurisdiction);
      const grandTotal = jurisdictionArray.reduce((sum: number, j: any) => sum + j.total_due, 0);

      return reply.send({
        period,
        tenant_id: tenantId,
        jurisdictions: jurisdictionArray,
        grand_total: grandTotal,
        generated_at: new Date().toISOString(),
      });
    },
  );
}
