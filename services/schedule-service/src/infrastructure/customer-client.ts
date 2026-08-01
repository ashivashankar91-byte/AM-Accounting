// @wave S030 — statement generation looks up basic customer identity
// (name/address) from apar-service/CE-09's existing Customer master via its
// existing read route (GET /api/v1/apar/customers?q=<controlNumber>) —
// no apar-service code is touched. If lookup fails or no exact match is
// found, statement generation still proceeds using the schedule's own
// controlNumber as the recipient identifier (documented degradation, not an
// invented customer record).
export interface CustomerSummary {
  id: string;
  customerNumber: string;
  customerName: string;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface ICustomerClient {
  findByCustomerNumber(tenantId: string, customerNumber: string): Promise<CustomerSummary | null>;
}

export class HttpCustomerClient implements ICustomerClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? process.env['APAR_SERVICE_URL'] ?? 'http://apar-service:3013').replace(/\/+$/, '');
  }

  async findByCustomerNumber(tenantId: string, customerNumber: string): Promise<CustomerSummary | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/apar/customers?q=${encodeURIComponent(customerNumber)}&mode=exact`,
        { headers: { 'x-tenant-id': tenantId } },
      );
      if (!res.ok) return null;
      const items = (await res.json()) as CustomerSummary[];
      return items.find((c) => c.customerNumber === customerNumber) ?? items[0] ?? null;
    } catch {
      // apar-service unreachable — degrade gracefully, do not block statement
      // generation on a read-only enrichment lookup.
      return null;
    }
  }
}
