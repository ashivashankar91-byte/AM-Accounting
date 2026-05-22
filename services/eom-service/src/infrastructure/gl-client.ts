/**
 * @module gl-client
 * HTTP implementation of IGLClient — wraps all gl-service calls needed by eom-service.
 * @trace-cobol yrend.cbl and purge.cbl use direct ISAM reads on GL-FILE;
 *   TypeScript crosses the service boundary via HTTP.
 */

import type { TenantId } from '@amacc/shared-kernel';
import type {
  IGLClient,
  PLAccountBalance,
  YearEndConfig,
  YearEndPostResult,
} from '../application/eom-service';

export class HttpGLClient implements IGLClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010').replace(/\/$/, '');
  }

  private headers(tenantId: TenantId): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-tenant-id': tenantId,
      // Internal service-to-service token — not a user JWT
      Authorization: `Bearer ${process.env['AMACC_INTERNAL_TOKEN'] ?? 'amacc-internal-dev'}`,
    };
  }

  async getUnpostedBatchCount(tenantId: TenantId, periodEnd: string): Promise<number> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/gl/journal-entries?status=DRAFT&periodEnd=${encodeURIComponent(periodEnd)}&limit=1`,
      { headers: this.headers(tenantId) },
    );
    if (!res.ok) throw new Error(`gl-service getUnpostedBatchCount: HTTP ${res.status}`);
    const body = (await res.json()) as { total?: number; entries?: unknown[] };
    return body.total ?? (body.entries?.length ?? 0);
  }

  async getPLAccountBalances(tenantId: TenantId): Promise<PLAccountBalance[]> {
    const res = await fetch(`${this.baseUrl}/api/v1/gl/accounts?type=REVENUE,EXPENSE,COST_OF_SALES`, {
      headers: this.headers(tenantId),
    });
    if (!res.ok) throw new Error(`gl-service getPLAccountBalances: HTTP ${res.status}`);
    const accounts = (await res.json()) as Array<{
      id: string;
      code: string;
      name: string;
      type: string;
      openingBalance?: number;
    }>;
    return accounts.map((a) => ({
      accountId: a.id,
      accountCode: a.code,
      name: a.name,
      glType: a.type as any,
      openingBalance: a.openingBalance ?? 0,
    }));
  }

  async getYearEndConfig(tenantId: TenantId): Promise<YearEndConfig> {
    const res = await fetch(`${this.baseUrl}/api/v1/gl/admin/year-end-config`, {
      headers: this.headers(tenantId),
    });
    if (!res.ok) throw new Error(`gl-service getYearEndConfig: HTTP ${res.status}`);
    return res.json() as Promise<YearEndConfig>;
  }

  async hasLockedGLAccounts(tenantId: TenantId): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/api/v1/gl/accounts?locked=true&limit=1`, {
      headers: this.headers(tenantId),
    });
    if (!res.ok) throw new Error(`gl-service hasLockedGLAccounts: HTTP ${res.status}`);
    const body = (await res.json()) as { total?: number; accounts?: unknown[] };
    const count = body.total ?? (body.accounts?.length ?? 0);
    return count > 0;
  }

  async isJournalSourceReservedForYearEnd(tenantId: TenantId, source: string): Promise<boolean> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/gl/admin/journal-sources/${encodeURIComponent(source)}`,
      { headers: this.headers(tenantId) },
    );
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`gl-service isJournalSourceReservedForYearEnd: HTTP ${res.status}`);
    const body = (await res.json()) as { reservedForYearEnd?: boolean };
    return body.reservedForYearEnd === true;
  }

  async validateRetainedEarningsAccount(
    tenantId: TenantId,
    accountId: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/gl/accounts/${encodeURIComponent(accountId)}`, {
      headers: this.headers(tenantId),
    });
    if (res.status === 404) return { valid: false, reason: 'Account not found' };
    if (!res.ok) throw new Error(`gl-service validateRetainedEarningsAccount: HTTP ${res.status}`);
    const account = (await res.json()) as { type?: string; allowPosting?: boolean; isActive?: boolean };
    if (!account.isActive) return { valid: false, reason: 'Account is inactive' };
    if (!account.allowPosting) return { valid: false, reason: 'Account does not allow posting' };
    if (account.type !== 'LIABILITY' && account.type !== 'ASSET') {
      return { valid: false, reason: `Retained earnings account must be LIABILITY or ASSET, got ${account.type}` };
    }
    return { valid: true };
  }

  /**
   * Validate that a journal source is registered and reserved for year-end use.
   * Returns valid=true if the source exists and isYearEndReserved=true.
   * Fails open (valid=true) if gl-service is unavailable for backward compat.
   * @cobol-origin joursec.cbl — year-end reserved source guard
   */
  async validateYearEndSource(tenantId: TenantId, sourceCode: string): Promise<{ valid: boolean; message?: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/gl/admin/journal-sources`, {
      headers: this.headers(tenantId),
    });
    if (!res.ok) return { valid: true }; // fail open for backward compat
    const sources = await res.json() as Array<{ sourceCode: string; isYearEndReserved: boolean }>;
    const source = sources.find(s => s.sourceCode === sourceCode);
    if (!source) return { valid: false, message: `Source ${sourceCode} not found` };
    if (!source.isYearEndReserved) return { valid: false, message: `Source ${sourceCode} is not reserved for year-end` };
    return { valid: true };
  }

  async postYearEndBatch(
    tenantId: TenantId,
    entries: Array<{ accountId: string; amount: number }>,
    journalSource: string,
    periodDate: string,
    referenceNumber: string,
    initiatedBy: string,
  ): Promise<YearEndPostResult> {
    const res = await fetch(`${this.baseUrl}/api/v1/gl/admin/year-end-batch`, {
      method: 'POST',
      headers: this.headers(tenantId),
      body: JSON.stringify({ entries, journalSource, periodDate, referenceNumber, initiatedBy }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`gl-service postYearEndBatch: HTTP ${res.status} — ${body}`);
    }
    return res.json() as Promise<YearEndPostResult>;
  }

  /**
   * Fetch the fiscal year / system config for a tenant from gl-service.
   * Returns sensible defaults when the config row does not yet exist.
   * @cobol-origin acsys.fd — ACSYS-FISCAL-YEAR-BEGIN, ACSYS-CUTOFF-DATE, ACSYS-LAST-CLOSE-DATE
   */
  async getSystemConfig(tenantId: TenantId): Promise<{
    fiscalYearStartMonth: number;
    lastCloseDate: string | null;
    cutoffDate: string | null;
  }> {
    const res = await fetch(`${this.baseUrl}/api/v1/gl/admin/system-config`, {
      headers: this.headers(tenantId),
    });
    if (!res.ok) throw new Error(`Failed to fetch system config: ${res.status}`);
    return res.json() as Promise<{
      fiscalYearStartMonth: number;
      lastCloseDate: string | null;
      cutoffDate: string | null;
    }>;
  }

  /**
   * Advance the last_close_date after a successful month-end close.
   * Called by eom-service after ACCT_300 completes.
   * @cobol-origin acsys.fd — ACSYS-LAST-CLOSE-DATE write
   */
  async advanceLastCloseDate(tenantId: TenantId, newCloseDate: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/gl/admin/system-config`, {
      method: 'PUT',
      headers: this.headers(tenantId),
      body: JSON.stringify({ lastCloseDate: newCloseDate }),
    });
    if (!res.ok) throw new Error(`Failed to advance last close date: ${res.status}`);
  }
}
