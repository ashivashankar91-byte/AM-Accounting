// CE-12 gap-close — read-only client onto schedule-service's real S026
// open-item ledger. Used exclusively by TieOutService to source the S080
// tie-out's authoritative "sum of open floorplan liability" figure from
// schedule-service's ScheduleOpenItem table (see that model's doc comment
// and services/coa-service/src/application/posting-service.ts's
// scheduleCode-gated JOURNAL_ENTRY_POSTED bridge for how those rows get
// created/relieved). Mirrors the createServiceToken/fetch pattern used by
// HttpPostingEngineClient/HttpPostingRecoveryClient exactly.
export interface ScheduleOpenItem {
  id: string;
  scheduleNumber: string;
  controlNumber: string;
  itemNumber: string;
  glAccountNumber: string;
  originalAmount: string;
  appliedAmount: string;
  remainingBalance: string;
  /** OPEN | PARTIAL | CLOSED (schedule-service's own open-item vocabulary —
   * distinct from FloorplanLiabilityItem's OPEN/PARTIALLY_RELIEVED/RELIEVED). */
  status: string;
  transactionDate: string;
  journalEntryId: string;
}

export interface ListOpenItemsFilters {
  controlNumber?: string;
  status?: string;
}

export interface ScheduleServiceClient {
  listOpenItems(tenantId: string, scheduleNumber: string, filters?: ListOpenItemsFilters): Promise<ScheduleOpenItem[]>;
}

export class HttpScheduleServiceClient implements ScheduleServiceClient {
  private readonly baseUrl: string;

  constructor(
    private readonly jwtSecret: string = (() => {
      const secret = process.env['AMACC_JWT_SECRET'];
      if (!secret) throw new Error('AMACC_JWT_SECRET environment variable is required but not set');
      return secret;
    })(),
    baseUrl = process.env['SCHEDULE_SERVICE_URL'] ?? 'http://schedule-service:3018',
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async token(): Promise<string> {
    const { createServiceToken } = await import('@amacc/shared-kernel');
    return createServiceToken('floorplan-service', this.jwtSecret);
  }

  async listOpenItems(tenantId: string, scheduleNumber: string, filters: ListOpenItemsFilters = {}): Promise<ScheduleOpenItem[]> {
    const serviceToken = await this.token();
    const qs = new URLSearchParams();
    if (filters.controlNumber) qs.set('controlNumber', filters.controlNumber);
    if (filters.status) qs.set('status', filters.status);
    const query = qs.toString();
    const res = await fetch(`${this.baseUrl}/api/v1/schedules/${encodeURIComponent(scheduleNumber)}/open-items${query ? `?${query}` : ''}`, {
      method: 'GET',
      headers: { 'x-tenant-id': tenantId, Authorization: `Bearer ${serviceToken}` },
    });
    const parsed: any = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`schedule-service open-items returned ${res.status}: ${parsed?.error ?? '(no message)'}`);
    }
    return (parsed ?? []) as ScheduleOpenItem[];
  }
}

/** Deterministic in-memory test double. */
export class InMemoryScheduleServiceClient implements ScheduleServiceClient {
  constructor(private items: ScheduleOpenItem[] = []) {}

  setItems(items: ScheduleOpenItem[]) {
    this.items = items;
  }

  async listOpenItems(_tenantId: string, scheduleNumber: string, filters: ListOpenItemsFilters = {}): Promise<ScheduleOpenItem[]> {
    return this.items.filter(
      (i) =>
        i.scheduleNumber === scheduleNumber &&
        (!filters.controlNumber || i.controlNumber === filters.controlNumber) &&
        (!filters.status || i.status === filters.status),
    );
  }
}
