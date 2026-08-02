// CE-07 (single authoritative ledger decision) — shared read-only GL
// account-number resolution, used by both S039 (invoice-approval-service.ts)
// and S043A (manual-payment-service.ts) before submitting a canonical event
// to the posting engine, which resolves accounts by NUMBER, never by
// gl-service's internal glAccountId UUID. Never a GL write — mirrors the
// GET /gl/accounts/:id pattern manual-payment-service.ts's _relieveSchedule
// already established.
export async function resolveGlAccountCode(glServiceUrl: string, tenantId: string, glAccountId: string, serviceToken?: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = { 'x-tenant-id': tenantId };
    if (serviceToken) headers['authorization'] = `Bearer ${serviceToken}`;
    const res = await fetch(`${glServiceUrl}/api/v1/gl/accounts/${glAccountId}`, { headers });
    if (!res.ok) return null;
    const account = await res.json() as { code?: string };
    return account.code ?? null;
  } catch {
    return null;
  }
}
