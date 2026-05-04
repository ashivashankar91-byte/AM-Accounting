import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createEvent, EventType } from '@amacc/shared-kernel';

const GL_SERVICE_URL = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';
const PAYROLL_SERVICE_URL = process.env['PAYROLL_SERVICE_URL'] ?? 'http://payroll-service:3012';
const AUDIT_SERVICE_URL = process.env['AUDIT_SERVICE_URL'] ?? 'http://audit-service:3031';

// ── Idempotency store (in-memory for MVP, should be Redis/DB in production) ──
const processedKeys = new Map<string, { id: string; createdAt: Date }>();

function checkIdempotency(key: string): { id: string } | null {
  const existing = processedKeys.get(key);
  if (existing && Date.now() - existing.createdAt.getTime() < 24 * 60 * 60 * 1000) {
    return { id: existing.id };
  }
  return null;
}

function recordIdempotency(key: string, id: string): void {
  processedKeys.set(key, { id, createdAt: new Date() });
}

async function callGL(path: string, tenantId: string, body: unknown): Promise<any> {
  const resp = await fetch(`${GL_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GL service error (${resp.status}): ${text}`);
  }
  return resp.json();
}

async function callPayroll(path: string, tenantId: string, body: unknown): Promise<any> {
  const resp = await fetch(`${PAYROLL_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Payroll service error (${resp.status}): ${text}`);
  }
  return resp.json();
}

async function callAudit(tenantId: string, eventType: string, entityType: string, entityId: string, action: string) {
  try {
    await fetch(`${AUDIT_SERVICE_URL}/api/v1/audit/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId, eventType, entityType, entityId,
        actorType: 'SYSTEM', actorId: 'connector-service', actorName: 'Connector Service',
        action, occurredAt: new Date().toISOString(),
      }),
    });
  } catch { /* audit is best-effort */ }
}

async function resolveAccountIds(tenantId: string): Promise<Map<string, string>> {
  const resp = await fetch(`${GL_SERVICE_URL}/api/v1/gl/accounts`, {
    headers: { 'x-tenant-id': tenantId },
  });
  if (!resp.ok) throw new Error('Failed to fetch GL accounts');
  const accounts = await resp.json() as any[];
  const map = new Map<string, string>();
  for (const a of accounts) map.set(a.code, a.id);
  return map;
}

// ── Zod Schemas ──────────────────────────────────────────

const LaborLineSchema = z.object({
  lineNumber: z.number().int(),
  laborType: z.string(),
  hours: z.number(),
  rate: z.number(),
  amount: z.number(),
  technicianId: z.string(),
});

const PartsLineSchema = z.object({
  lineNumber: z.number().int().optional(),
  partNumber: z.string(),
  quantity: z.number(),
  cost: z.number(),
  salePrice: z.number(),
  departmentCode: z.string().optional(),
});

const SubletLineSchema = z.object({
  description: z.string(),
  amount: z.number(),
  vendor: z.string(),
});

const ServiceRoSchema = z.object({
  roNumber: z.string().min(1),
  tenantId: z.string().min(1),
  technicianId: z.string().min(1),
  laborLines: z.array(LaborLineSchema).min(1),
  partsLines: z.array(PartsLineSchema).default([]),
  subletLines: z.array(SubletLineSchema).default([]),
  glGroup: z.string().optional(),
  totalLabor: z.number(),
  totalParts: z.number(),
  laborType: z.string().default('CUSTOMER_PAY'),
});

const PartsInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  tenantId: z.string().min(1),
  partLines: z.array(z.object({
    partNumber: z.string(),
    quantity: z.number(),
    cost: z.number(),
    salePrice: z.number(),
    departmentCode: z.string(),
  })).min(1),
});

const PayrollIngestSchema = z.object({
  batchRef: z.string().min(1),
  tenantId: z.string().min(1),
  periodStart: z.string(),
  periodEnd: z.string(),
  lines: z.array(z.object({
    employeeId: z.string(),
    employeeName: z.string(),
    departmentCode: z.string(),
    earningCode: z.string(),
    hours: z.number().nullable().optional(),
    rate: z.number().nullable().optional(),
    amount: z.number(),
    technicianId: z.string().nullable().optional(),
    flatRateHours: z.number().nullable().optional(),
    roNumber: z.string().nullable().optional(),
  })).min(1),
});

const DealIngestSchema = z.object({
  dealNumber: z.string().min(1),
  tenantId: z.string().min(1),
  vin: z.string(),
  customerName: z.string(),
  salePrice: z.number(),
  cost: z.number(),
  dealType: z.enum(['NEW', 'USED', 'WHOLESALE']).default('NEW'),
  products: z.array(z.object({
    productType: z.string(),
    productName: z.string(),
    salePrice: z.number(),
    dealerCost: z.number(),
    grossProfit: z.number(),
    providerName: z.string().optional(),
  })).default([]),
  tradeIn: z.object({
    vin: z.string(),
    allowance: z.number(),
    payoff: z.number(),
  }).optional(),
  financeSources: z.array(z.object({
    name: z.string(),
    amount: z.number(),
  })).default([]),
});

const VehiclePurchaseSchema = z.object({
  vin: z.string().min(1),
  stockNo: z.string(),
  tenantId: z.string().min(1),
  vendor: z.string(),
  cost: z.number(),
  floorplanSource: z.string(),
  departmentCode: z.string(),
});

const VehicleTransferSchema = z.object({
  vin: z.string().min(1),
  fromTenantId: z.string().min(1),
  toTenantId: z.string().min(1),
  bookValue: z.number(),
});

const CashReceiptsSchema = z.object({
  receiptNumber: z.string().min(1),
  tenantId: z.string().min(1),
  lines: z.array(z.object({
    customerId: z.string(),
    amount: z.number(),
    glAccountCode: z.string(),
    paymentMethod: z.string(),
    ref: z.string(),
  })).min(1),
});

const FinanceChargesSchema = z.object({
  tenantId: z.string().min(1),
  accountId: z.string(),
  customerId: z.string(),
  amount: z.number(),
  chargeType: z.string(),
});

const CreditCardSchema = z.object({
  batchNo: z.string().min(1),
  tenantId: z.string().min(1),
  merchant: z.string(),
  lines: z.array(z.object({
    amount: z.number(),
    type: z.string(),
    settlementDate: z.string(),
  })).min(1),
});

const YearEndSchema = z.object({
  tenantId: z.string().min(1),
  closingLines: z.array(z.object({
    glAccountCode: z.string(),
    debit: z.number(),
    credit: z.number(),
    departmentCode: z.string(),
  })).min(1),
});

const AmdbDropmateSchema = z.object({
  tenantId: z.string().min(1),
  transactionLines: z.array(z.object({
    glAccountCode: z.string(),
    debit: z.number(),
    credit: z.number(),
    description: z.string(),
    moduleSource: z.string().default('AMDB_DROPMATE'),
  })).min(1),
});

// ── Routes ───────────────────────────────────────────────

export async function ingestRoutes(app: FastifyInstance) {

  // 1. POST /service-ro
  app.post('/service-ro', async (request, reply) => {
    const data = ServiceRoSchema.parse(request.body);
    const idemKey = `service-ro:${data.roNumber}:${data.tenantId}`;
    const existing = checkIdempotency(idemKey);
    if (existing) return reply.status(200).send({ status: 'DUPLICATE', existingId: existing.id });

    const accountMap = await resolveAccountIds(data.tenantId);
    const lines: any[] = [];

    // Helper: find account by code, with fallbacks for common automotive COA variations
    const findAcct = (code: string, ...fallbacks: string[]): string | undefined => {
      const found = accountMap.get(code);
      if (found) return found;
      for (const fb of fallbacks) {
        const alt = accountMap.get(fb);
        if (alt) return alt;
      }
      return undefined;
    };

    // Labor lines
    for (const labor of data.laborLines) {
      const revenueAcct = findAcct('4100', '4110', '4120');
      if (revenueAcct) {
        lines.push({
          glAccountId: revenueAcct, debit: 0, credit: labor.amount,
          memo: `Labor ${labor.laborType} - ${data.roNumber} - Tech ${labor.technicianId}`,
          technicianId: labor.technicianId, roNumber: data.roNumber, roLineNumber: labor.lineNumber,
          flatRateHours: labor.hours, laborType: labor.laborType, moduleSource: 'SERVICE_EOD',
          departmentCode: 'SERVICE',
        });
      }
      const accrualAcct = findAcct('2020', '2200', '5100', '5110');
      if (accrualAcct) {
        lines.push({
          glAccountId: accrualAcct, debit: labor.hours * labor.rate, credit: 0,
          memo: `Tech pay accrual - ${labor.technicianId} - ${data.roNumber}`,
          technicianId: labor.technicianId, roNumber: data.roNumber, roLineNumber: labor.lineNumber,
          clockHours: labor.hours, laborType: labor.laborType, moduleSource: 'SERVICE_EOD',
          departmentCode: 'SERVICE',
        });
      }
    }

    // Parts lines
    for (const part of data.partsLines) {
      const partsRevAcct = findAcct('4200', '4210');
      if (partsRevAcct) {
        lines.push({
          glAccountId: partsRevAcct, debit: 0, credit: part.salePrice,
          memo: `Parts - ${part.partNumber} x${part.quantity} - ${data.roNumber}`,
          partNumber: part.partNumber, partQuantity: part.quantity, roNumber: data.roNumber,
          moduleSource: 'SERVICE_EOD', departmentCode: part.departmentCode ?? 'PARTS',
          costType: 'PARTS',
        });
      }
      const partsCosAcct = findAcct('5200');
      if (partsCosAcct) {
        lines.push({
          glAccountId: partsCosAcct, debit: part.cost * part.quantity, credit: 0,
          memo: `Parts COS - ${part.partNumber} - ${data.roNumber}`,
          partNumber: part.partNumber, partQuantity: part.quantity, roNumber: data.roNumber,
          moduleSource: 'SERVICE_EOD', departmentCode: part.departmentCode ?? 'PARTS',
          costType: 'PARTS',
        });
      }
    }

    // Cash debit — use posting account 1010 (Cash Operating), not header 1000
    const cashAcct = findAcct('1010', '1000');
    if (cashAcct) {
      lines.push({
        glAccountId: cashAcct, debit: data.totalLabor + data.totalParts, credit: 0,
        memo: `Cash received - RO ${data.roNumber}`, roNumber: data.roNumber,
        moduleSource: 'SERVICE_EOD', departmentCode: 'SERVICE',
      });
    }

    const entry = await callGL('/api/v1/gl/journal-entries', data.tenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: `Service RO ${data.roNumber} - Tech ${data.technicianId}`,
      source: 'CONNECTOR_SERVICE_RO', sourceRef: data.roNumber, lines,
    });

    recordIdempotency(idemKey, entry.id);
    await callAudit(data.tenantId, 'SERVICE_RO_CLOSED', 'ServiceRO', data.roNumber, 'INGESTED');
    return reply.status(201).send({ status: 'CREATED', journalEntryId: entry.id, lineCount: lines.length });
  });

  // 2. POST /parts-invoice
  app.post('/parts-invoice', async (request, reply) => {
    const data = PartsInvoiceSchema.parse(request.body);
    const idemKey = `parts-invoice:${data.invoiceNumber}:${data.tenantId}`;
    const existing = checkIdempotency(idemKey);
    if (existing) return reply.status(200).send({ status: 'DUPLICATE', existingId: existing.id });

    const accountMap = await resolveAccountIds(data.tenantId);
    const lines: any[] = [];
    let totalSale = 0, totalCost = 0;

    for (const part of data.partLines) {
      const lineTotal = part.salePrice * part.quantity;
      const lineCost = part.cost * part.quantity;
      totalSale += lineTotal;
      totalCost += lineCost;

      const revAcct = accountMap.get('4200');
      if (revAcct) lines.push({
        glAccountId: revAcct, debit: 0, credit: lineTotal,
        memo: `Parts sale - ${part.partNumber} x${part.quantity}`,
        partNumber: part.partNumber, partQuantity: part.quantity,
        departmentCode: part.departmentCode, moduleSource: 'PARTS_EOD', costType: 'PARTS',
      });

      const cosAcct = accountMap.get('5200');
      if (cosAcct) lines.push({
        glAccountId: cosAcct, debit: lineCost, credit: 0,
        memo: `Parts COS - ${part.partNumber}`,
        partNumber: part.partNumber, partQuantity: part.quantity,
        departmentCode: part.departmentCode, moduleSource: 'PARTS_EOD', costType: 'PARTS',
      });
    }

    const cashAcct = accountMap.get('1000');
    if (cashAcct) lines.push({
      glAccountId: cashAcct, debit: totalSale, credit: 0,
      memo: `Cash - Parts Invoice ${data.invoiceNumber}`, moduleSource: 'PARTS_EOD',
    });

    const invAcct = accountMap.get('1300');
    if (invAcct) lines.push({
      glAccountId: invAcct, debit: 0, credit: totalCost,
      memo: `Inventory relief - ${data.invoiceNumber}`, moduleSource: 'PARTS_EOD',
    });

    const entry = await callGL('/api/v1/gl/journal-entries', data.tenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: `Parts Invoice ${data.invoiceNumber}`,
      source: 'CONNECTOR_PARTS_INVOICE', sourceRef: data.invoiceNumber, lines,
    });

    recordIdempotency(idemKey, entry.id);
    await callAudit(data.tenantId, 'PARTS_INVOICE_CLOSED', 'PartsInvoice', data.invoiceNumber, 'INGESTED');
    return reply.status(201).send({ status: 'CREATED', journalEntryId: entry.id, lineCount: lines.length });
  });

  // 3. POST /payroll
  app.post('/payroll', async (request, reply) => {
    const data = PayrollIngestSchema.parse(request.body);
    const idemKey = `payroll:${data.batchRef}:${data.tenantId}`;
    const existing = checkIdempotency(idemKey);
    if (existing) return reply.status(200).send({ status: 'DUPLICATE', existingId: existing.id });

    // Create payroll batch with lines via payroll-service
    const batch = await callPayroll('/api/v1/payroll/batches', data.tenantId, {
      batchRef: data.batchRef,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      totalAmount: data.lines.reduce((s, l) => s + l.amount, 0),
      idempotencyKey: `${data.batchRef}-${data.tenantId}`,
    });

    // Create GL journal entry with line-level detail
    const accountMap = await resolveAccountIds(data.tenantId);
    const journalLines: any[] = [];

    for (const line of data.lines) {
      const expenseAcct = accountMap.get('0120') ?? accountMap.get('0110');
      if (expenseAcct) journalLines.push({
        glAccountId: expenseAcct, debit: line.amount, credit: 0,
        memo: `${line.employeeName} - ${line.earningCode}`,
        departmentCode: line.departmentCode, earningCode: line.earningCode,
        technicianId: line.technicianId ?? undefined,
        flatRateHours: line.flatRateHours ?? undefined,
        roNumber: line.roNumber ?? undefined,
        moduleSource: 'PAYROLL_FINALIZE',
      });
    }

    const totalAmount = data.lines.reduce((s, l) => s + l.amount, 0);
    const accrualAcct = accountMap.get('3210');
    if (accrualAcct) journalLines.push({
      glAccountId: accrualAcct, debit: 0, credit: totalAmount,
      memo: `Accrued payroll - ${data.batchRef}`, moduleSource: 'PAYROLL_FINALIZE',
    });

    await callGL('/api/v1/gl/journal-entries', data.tenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: `Payroll - ${data.batchRef}`,
      source: 'CONNECTOR_PAYROLL', sourceRef: data.batchRef, lines: journalLines,
    });

    recordIdempotency(idemKey, batch.id);
    await callAudit(data.tenantId, 'PAYROLL_LINES_SUBMITTED', 'PayrollBatch', data.batchRef, 'INGESTED');
    return reply.status(201).send({ status: 'CREATED', batchId: batch.id, lineCount: data.lines.length });
  });

  // 4. POST /deal
  app.post('/deal', async (request, reply) => {
    const data = DealIngestSchema.parse(request.body);
    const idemKey = `deal:${data.dealNumber}:${data.tenantId}`;
    const existing = checkIdempotency(idemKey);
    if (existing) return reply.status(200).send({ status: 'DUPLICATE', existingId: existing.id });

    const accountMap = await resolveAccountIds(data.tenantId);
    const isNew = data.dealType === 'NEW';
    const revenueAcct = accountMap.get(isNew ? '4000' : '4010');
    const cosAcct = accountMap.get(isNew ? '5000' : '5010');
    const cashAcct = accountMap.get('1000');
    const invAcct = accountMap.get(isNew ? '1200' : '1210');

    const lines: any[] = [];
    if (cashAcct) lines.push({
      glAccountId: cashAcct, debit: data.salePrice, credit: 0,
      memo: `Customer payment - ${data.dealNumber}`,
      dealNumber: data.dealNumber, vehicleVin: data.vin, moduleSource: 'DEAL_POSTING',
      departmentCode: isNew ? 'NEW_VEHICLE' : 'USED_VEHICLE',
    });
    if (revenueAcct) lines.push({
      glAccountId: revenueAcct, debit: 0, credit: data.salePrice,
      memo: `Vehicle sale - ${data.dealNumber}`,
      dealNumber: data.dealNumber, vehicleVin: data.vin, moduleSource: 'DEAL_POSTING',
      departmentCode: isNew ? 'NEW_VEHICLE' : 'USED_VEHICLE',
    });
    if (cosAcct && data.cost > 0) lines.push({
      glAccountId: cosAcct, debit: data.cost, credit: 0,
      memo: `Cost of vehicle - ${data.dealNumber}`,
      dealNumber: data.dealNumber, vehicleVin: data.vin, moduleSource: 'DEAL_POSTING',
      departmentCode: isNew ? 'NEW_VEHICLE' : 'USED_VEHICLE',
    });
    if (invAcct && data.cost > 0) lines.push({
      glAccountId: invAcct, debit: 0, credit: data.cost,
      memo: `Inventory relief - ${data.dealNumber}`,
      dealNumber: data.dealNumber, vehicleVin: data.vin, moduleSource: 'DEAL_POSTING',
      departmentCode: isNew ? 'NEW_VEHICLE' : 'USED_VEHICLE',
    });

    // F&I products
    for (const product of data.products) {
      const fiAcct = accountMap.get('4400');
      if (fiAcct) lines.push({
        glAccountId: fiAcct, debit: 0, credit: product.salePrice,
        memo: `F&I: ${product.productName} - ${data.dealNumber}`,
        dealNumber: data.dealNumber, dealProductCode: product.productType,
        vehicleVin: data.vin, moduleSource: 'DEAL_POSTING', departmentCode: 'FI',
      });
    }

    const entry = await callGL('/api/v1/gl/journal-entries', data.tenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: `Deal ${data.dealNumber} - ${data.customerName}`,
      source: 'CONNECTOR_DEAL', sourceRef: data.dealNumber, lines,
    });

    recordIdempotency(idemKey, entry.id);
    await callAudit(data.tenantId, 'DEAL_PRODUCT_DETAIL_RECEIVED', 'Deal', data.dealNumber, 'INGESTED');
    return reply.status(201).send({ status: 'CREATED', journalEntryId: entry.id, products: data.products.length });
  });

  // 5. POST /vehicle-purchase
  app.post('/vehicle-purchase', async (request, reply) => {
    const data = VehiclePurchaseSchema.parse(request.body);
    const idemKey = `vehicle-purchase:${data.vin}:${data.tenantId}`;
    const existing = checkIdempotency(idemKey);
    if (existing) return reply.status(200).send({ status: 'DUPLICATE', existingId: existing.id });

    const accountMap = await resolveAccountIds(data.tenantId);
    const isNew = data.departmentCode === 'NEW_VEHICLE';
    const invAcct = accountMap.get(isNew ? '1200' : '1210');
    const floorAcct = accountMap.get(isNew ? '2100' : '2110');
    const lines: any[] = [];

    if (invAcct) lines.push({
      glAccountId: invAcct, debit: data.cost, credit: 0,
      memo: `Vehicle inventory - ${data.vin} (${data.stockNo})`,
      vehicleVin: data.vin, departmentCode: data.departmentCode, moduleSource: 'VEHICLE_PURCHASE',
    });
    if (floorAcct) lines.push({
      glAccountId: floorAcct, debit: 0, credit: data.cost,
      memo: `Floor plan - ${data.vin} via ${data.floorplanSource}`,
      vehicleVin: data.vin, departmentCode: data.departmentCode, moduleSource: 'VEHICLE_PURCHASE',
    });

    const entry = await callGL('/api/v1/gl/journal-entries', data.tenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: `Vehicle Purchase - ${data.vin} from ${data.vendor}`,
      source: 'CONNECTOR_VEHICLE_PURCHASE', sourceRef: data.vin, lines,
    });

    recordIdempotency(idemKey, entry.id);
    await callAudit(data.tenantId, 'VEHICLE_PURCHASED', 'Vehicle', data.vin, 'INGESTED');
    return reply.status(201).send({ status: 'CREATED', journalEntryId: entry.id });
  });

  // 6. POST /vehicle-transfer
  app.post('/vehicle-transfer', async (request, reply) => {
    const data = VehicleTransferSchema.parse(request.body);

    // Create debit entry at receiving location
    const toAccountMap = await resolveAccountIds(data.toTenantId);
    const toInvAcct = toAccountMap.get('1210');
    const toIcAcct = toAccountMap.get('2000');
    const toLines: any[] = [];
    if (toInvAcct) toLines.push({
      glAccountId: toInvAcct, debit: data.bookValue, credit: 0,
      memo: `Transfer in - ${data.vin}`, vehicleVin: data.vin, moduleSource: 'VEHICLE_TRANSFER',
    });
    if (toIcAcct) toLines.push({
      glAccountId: toIcAcct, debit: 0, credit: data.bookValue,
      memo: `Intercompany payable - ${data.vin}`, vehicleVin: data.vin, moduleSource: 'VEHICLE_TRANSFER',
    });

    await callGL('/api/v1/gl/journal-entries', data.toTenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: `Vehicle Transfer In - ${data.vin}`,
      source: 'CONNECTOR_VEHICLE_TRANSFER', sourceRef: data.vin, lines: toLines,
    });

    // Create credit entry at sending location
    const fromAccountMap = await resolveAccountIds(data.fromTenantId);
    const fromInvAcct = fromAccountMap.get('1210');
    const fromIcAcct = fromAccountMap.get('1120');
    const fromLines: any[] = [];
    if (fromInvAcct) fromLines.push({
      glAccountId: fromInvAcct, debit: 0, credit: data.bookValue,
      memo: `Transfer out - ${data.vin}`, vehicleVin: data.vin, moduleSource: 'VEHICLE_TRANSFER',
    });
    if (fromIcAcct) fromLines.push({
      glAccountId: fromIcAcct, debit: data.bookValue, credit: 0,
      memo: `Intercompany receivable - ${data.vin}`, vehicleVin: data.vin, moduleSource: 'VEHICLE_TRANSFER',
    });

    await callGL('/api/v1/gl/journal-entries', data.fromTenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: `Vehicle Transfer Out - ${data.vin}`,
      source: 'CONNECTOR_VEHICLE_TRANSFER', sourceRef: data.vin, lines: fromLines,
    });

    await callAudit(data.fromTenantId, 'VEHICLE_TRANSFERRED', 'Vehicle', data.vin, 'TRANSFERRED');
    return reply.status(201).send({ status: 'CREATED', vin: data.vin });
  });

  // 7. POST /cash-receipts
  app.post('/cash-receipts', async (request, reply) => {
    const data = CashReceiptsSchema.parse(request.body);
    const idemKey = `cash-receipt:${data.receiptNumber}:${data.tenantId}`;
    const existing = checkIdempotency(idemKey);
    if (existing) return reply.status(200).send({ status: 'DUPLICATE', existingId: existing.id });

    const accountMap = await resolveAccountIds(data.tenantId);
    const lines: any[] = [];

    for (const line of data.lines) {
      const acctId = accountMap.get(line.glAccountCode);
      if (acctId) lines.push({
        glAccountId: acctId, debit: 0, credit: line.amount,
        memo: `Receipt ${data.receiptNumber} - ${line.paymentMethod} - ${line.ref}`,
        moduleSource: 'CASH_RECEIPTS',
      });
    }

    const totalAmount = data.lines.reduce((s, l) => s + l.amount, 0);
    const cashAcct = accountMap.get('1000');
    if (cashAcct) lines.push({
      glAccountId: cashAcct, debit: totalAmount, credit: 0,
      memo: `Cash received - Receipt ${data.receiptNumber}`, moduleSource: 'CASH_RECEIPTS',
    });

    const entry = await callGL('/api/v1/gl/journal-entries', data.tenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: `Cash Receipt ${data.receiptNumber}`,
      source: 'CONNECTOR_CASH_RECEIPTS', sourceRef: data.receiptNumber, lines,
    });

    recordIdempotency(idemKey, entry.id);
    await callAudit(data.tenantId, 'CASH_RECEIPT_DETAILED', 'CashReceipt', data.receiptNumber, 'INGESTED');
    return reply.status(201).send({ status: 'CREATED', journalEntryId: entry.id });
  });

  // 8. POST /finance-charges
  app.post('/finance-charges', async (request, reply) => {
    const data = FinanceChargesSchema.parse(request.body);

    const accountMap = await resolveAccountIds(data.tenantId);
    const arAcct = accountMap.get('1100');
    const revAcct = accountMap.get('4500');
    const lines: any[] = [];

    if (arAcct) lines.push({
      glAccountId: arAcct, debit: data.amount, credit: 0,
      memo: `Finance charge - ${data.customerId} - ${data.chargeType}`, moduleSource: 'FINANCE_CHARGES',
    });
    if (revAcct) lines.push({
      glAccountId: revAcct, debit: 0, credit: data.amount,
      memo: `Finance charge income - ${data.customerId}`, moduleSource: 'FINANCE_CHARGES',
    });

    const entry = await callGL('/api/v1/gl/journal-entries', data.tenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: `Finance Charge - ${data.customerId} - ${data.chargeType}`,
      source: 'CONNECTOR_FINANCE_CHARGES', sourceRef: `FC-${data.customerId}`, lines,
    });

    await callAudit(data.tenantId, 'FINANCE_CHARGE_POSTED', 'FinanceCharge', data.customerId, 'INGESTED');
    return reply.status(201).send({ status: 'CREATED', journalEntryId: entry.id });
  });

  // 9. POST /credit-card
  app.post('/credit-card', async (request, reply) => {
    const data = CreditCardSchema.parse(request.body);
    const idemKey = `credit-card:${data.batchNo}:${data.tenantId}`;
    const existing = checkIdempotency(idemKey);
    if (existing) return reply.status(200).send({ status: 'DUPLICATE', existingId: existing.id });

    const accountMap = await resolveAccountIds(data.tenantId);
    const lines: any[] = [];
    const totalAmount = data.lines.reduce((s, l) => s + l.amount, 0);

    const cashAcct = accountMap.get('1000');
    if (cashAcct) lines.push({
      glAccountId: cashAcct, debit: totalAmount, credit: 0,
      memo: `CC settlement - ${data.merchant} - Batch ${data.batchNo}`, moduleSource: 'CREDIT_CARD',
    });

    const ccClearAcct = accountMap.get('1050') ?? accountMap.get('1000');
    if (ccClearAcct && ccClearAcct !== cashAcct?.toString()) lines.push({
      glAccountId: ccClearAcct, debit: 0, credit: totalAmount,
      memo: `CC clearing - ${data.batchNo}`, moduleSource: 'CREDIT_CARD',
    });

    const entry = await callGL('/api/v1/gl/journal-entries', data.tenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: `Credit Card Settlement - ${data.merchant} - ${data.batchNo}`,
      source: 'CONNECTOR_CREDIT_CARD', sourceRef: data.batchNo, lines,
    });

    recordIdempotency(idemKey, entry.id);
    await callAudit(data.tenantId, 'CREDIT_CARD_BATCH_SETTLED', 'CreditCardBatch', data.batchNo, 'INGESTED');
    return reply.status(201).send({ status: 'CREATED', journalEntryId: entry.id });
  });

  // 10. POST /year-end
  app.post('/year-end', async (request, reply) => {
    const data = YearEndSchema.parse(request.body);
    const accountMap = await resolveAccountIds(data.tenantId);
    const lines: any[] = [];

    for (const cl of data.closingLines) {
      const acctId = accountMap.get(cl.glAccountCode);
      if (acctId) lines.push({
        glAccountId: acctId, debit: cl.debit, credit: cl.credit,
        memo: `Year-end close - ${cl.glAccountCode}`,
        departmentCode: cl.departmentCode, moduleSource: 'YEAR_END',
      });
    }

    const entry = await callGL('/api/v1/gl/journal-entries', data.tenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: 'Year-End Closing Entry',
      source: 'CONNECTOR_YEAR_END', sourceRef: `YE-${new Date().getFullYear()}`, lines,
    });

    await callAudit(data.tenantId, 'YEAR_END_CLOSE_POSTED', 'YearEndClose', `YE-${new Date().getFullYear()}`, 'INGESTED');
    return reply.status(201).send({ status: 'CREATED', journalEntryId: entry.id });
  });

  // 11. POST /amdb-dropmate
  app.post('/amdb-dropmate', async (request, reply) => {
    const data = AmdbDropmateSchema.parse(request.body);
    const accountMap = await resolveAccountIds(data.tenantId);
    const lines: any[] = [];

    for (const tl of data.transactionLines) {
      const acctId = accountMap.get(tl.glAccountCode);
      if (acctId) lines.push({
        glAccountId: acctId, debit: tl.debit, credit: tl.credit,
        memo: tl.description, moduleSource: tl.moduleSource,
      });
    }

    const entry = await callGL('/api/v1/gl/journal-entries', data.tenantId, {
      entryDate: new Date().toISOString().split('T')[0],
      description: 'AMDB Dropmate Import',
      source: 'CONNECTOR_AMDB_DROPMATE', sourceRef: `AMDB-${Date.now()}`, lines,
    });

    await callAudit(data.tenantId, 'AMDB_DROPMATE_IMPORTED', 'AmdbDropmate', entry.id, 'INGESTED');
    return reply.status(201).send({ status: 'CREATED', journalEntryId: entry.id });
  });
}
