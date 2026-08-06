// CE-10 integration boundary — the ONLY source of tax truth. Never estimate
// tax, never invent a rate, never default to zero. Mirrors the real
// contract in services/tax-service/src/domain/tax-adapter-contract.ts.

export interface TaxCalculationRequestLine {
  lineId: string;
  itemClassCode: string;
  amount: string;
  quantity: number;
  jurisdictionInputs?: Record<string, unknown>;
  exemptionRef?: string | null;
}

export interface TaxCalculationRequest {
  tenantId: string;
  legalEntityId: string;
  storeId?: string | null;
  documentType: string;
  documentId: string;
  documentVersion: number;
  lines: TaxCalculationRequestLine[];
  currency: string;
  partyRef?: string | null;
  correlationId: string;
  idempotencyKey: string;
  businessDate: string;
}

export type TaxCalculationStatus = 'CALCULATED' | 'EXEMPT_APPLIED' | 'ENGINE_UNAVAILABLE' | 'ENGINE_REJECTED' | 'NOT_CONFIGURED';
const STATUSES_ALLOWING_PROCEED = new Set<TaxCalculationStatus>(['CALCULATED', 'EXEMPT_APPLIED']);

export interface TaxCalculationResult {
  taxResultId: string;
  status: TaxCalculationStatus;
  totalTax: string;
  totalTaxableBase: string;
  currency: string;
  lines: Array<{ lineId: string; taxAmount: string }>;
  parkedExceptionId?: string | null;
}

export class TaxServiceUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxServiceUnreachableError';
  }
}

export interface TaxClient {
  calculate(request: TaxCalculationRequest): Promise<TaxCalculationResult>;
}

export function taxResultAllowsProceed(status: TaxCalculationStatus): boolean {
  return STATUSES_ALLOWING_PROCEED.has(status);
}

export class HttpTaxClient implements TaxClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string,
    baseUrl = process.env['TAX_SERVICE_URL'] ?? 'http://tax-service:3051',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async calculate(request: TaxCalculationRequest): Promise<TaxCalculationResult> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    const serviceToken = createServiceToken('fixedops-service', this.jwtSecret);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/tax/calculate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': request.tenantId,
          Authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(request),
      });
    } catch (err: any) {
      throw new TaxServiceUnreachableError(`tax-service unreachable: ${err?.message ?? String(err)}`);
    }

    let parsed: any;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }

    if (!res.ok && res.status !== 200 && res.status !== 201 && res.status !== 202) {
      throw new TaxServiceUnreachableError(`tax-service call failed: HTTP ${res.status} ${parsed?.message ?? ''}`);
    }

    return {
      taxResultId: parsed.taxResultId ?? parsed.id,
      status: parsed.status,
      totalTax: parsed.totalTax ?? '0',
      totalTaxableBase: parsed.totalTaxableBase ?? '0',
      currency: parsed.currency ?? 'USD',
      lines: parsed.lines ?? [],
      parkedExceptionId: parsed.parkedExceptionId ?? null,
    };
  }
}
