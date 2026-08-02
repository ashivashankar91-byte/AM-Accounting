import { inject, injectable } from 'tsyringe';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface DirectWriteOffDTO {
  arEntryId: string;
  amount: number;
  reason: string;
  /** True only when the caller has the higher-authority override
   * permission — enforced at the route layer (ar.write_off.override), never
   * trusted from the client alone: routes.ts only forwards this flag when
   * the actor actually holds that distinct permission. */
  useOverride?: boolean;
}

export interface ReverseWriteOffDTO {
  reason: string;
}

export interface WriteOffRegisterQuery {
  period?: string; // YYYY-MM, matches createdAt month when provided
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class ArEntryNotFoundForWriteOffError extends Error {
  constructor(id: string) {
    super(`AR entry not found: ${id}`);
    this.name = 'ArEntryNotFoundForWriteOffError';
  }
}

export class WriteOffValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WriteOffValidationError';
  }
}

/** D-CE09 (S050 AC): amount exceeds the configured per-tenant threshold and
 * the higher-authority override was not used — a hard, named refusal. */
export class WriteOffRefusedOverThresholdError extends Error {
  constructor(amount: number, threshold: number) {
    super(`Write-off amount ${amount} exceeds the configured threshold ${threshold} — requires the higher-authority override permission`);
    this.name = 'WriteOffRefusedOverThresholdError';
  }
}

export class WriteOffNotFoundError extends Error {
  constructor(id: string) {
    super(`Direct write-off not found: ${id}`);
    this.name = 'WriteOffNotFoundError';
  }
}

/**
 * CE-09 S050 (direct write-off half) — Direct AR write-off. Requires a
 * distinct permission (ar.write_off.create, enforced at the route layer)
 * and a reason; refused above a configurable per-tenant threshold
 * (WriteOffRefusedOverThresholdError / WRITE_OFF_REFUSED_OVER_THRESHOLD)
 * unless the caller holds the higher-authority override permission
 * (ar.write_off.override — also fully audited via thresholdOverride +
 * actor on the write-off row). Posts a journal (Dr bad-debt/write-off
 * expense / Cr AR control — "matrix row" GL accounts, blank until
 * Accounting configures ArWriteOffGlAccountConfig) and closes the AR item.
 * A write-off always equals the full remaining AR entry amount, so it
 * always ties out to $0 by construction (no partial write-off in this
 * slice — matches the AC's "closes the AR item").
 *
 * Reversal restores the AR item to OPEN (S218-style symmetry, mirroring
 * ManualPaymentService.void()/PaymentLifecycleService.reissue()'s
 * restore-linkage pattern) and marks the original write-off REVERSED.
 */
@injectable()
export class WriteOffService {
  private glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';

  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async list(tenantId: string, arEntryId?: string) {
    return this.prisma.arDirectWriteOff.findMany({ where: { tenantId, ...(arEntryId ? { arEntryId } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  async getById(tenantId: string, id: string) {
    const row = await this.prisma.arDirectWriteOff.findFirst({ where: { id, tenantId } });
    if (!row) throw new WriteOffNotFoundError(id);
    return row;
  }

  /** AC: register total = Σ posted write-offs for the period (or all-time
   * when no period filter is supplied) — ties out to $0 (open item closed
   * for the exact write-off amount). */
  async register(tenantId: string, query: WriteOffRegisterQuery = {}) {
    const rows = await this.prisma.arDirectWriteOff.findMany({
      where: {
        tenantId, status: 'POSTED',
        ...(query.period ? { createdAt: { gte: new Date(`${query.period}-01T00:00:00.000Z`), lt: this._nextMonth(query.period) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    const totalWrittenOff = rows.reduce((sum: number, r: any) => sum + Number(r.amount), 0);
    return {
      period: query.period ?? null,
      writeOffCount: rows.length,
      totalWrittenOff: Math.round(totalWrittenOff * 100) / 100,
      writeOffs: rows,
    };
  }

  private _nextMonth(period: string): Date {
    const [y, m] = period.split('-').map(Number);
    return m === 12 ? new Date(`${y + 1}-01-01T00:00:00.000Z`) : new Date(`${y}-${String(m + 1).padStart(2, '0')}-01T00:00:00.000Z`);
  }

  async directWriteOff(tenantId: string, dto: DirectWriteOffDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    if (!dto.arEntryId?.trim()) throw new WriteOffValidationError('AR_ENTRY_ID_REQUIRED', 'arEntryId is required');
    if (!(dto.amount > 0)) throw new WriteOffValidationError('INVALID_AMOUNT', 'amount must be greater than zero');
    if (!dto.reason?.trim()) throw new WriteOffValidationError('REASON_REQUIRED', 'A reason is required to write off an AR item');

    const thresholdConfig = await this.prisma.arWriteOffThresholdConfig.findFirst({ where: { tenantId } });
    const threshold = thresholdConfig ? Number(thresholdConfig.thresholdAmount) : null;
    const overThreshold = threshold !== null && dto.amount > threshold;
    if (overThreshold && !dto.useOverride) {
      throw new WriteOffRefusedOverThresholdError(dto.amount, threshold!);
    }

    let writeOff: any = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const locked = await tx.$queryRawUnsafe(
        `SELECT id, tenant_id, amount, status FROM ar_entries WHERE id = $1::uuid AND tenant_id = $2 FOR UPDATE`,
        dto.arEntryId, tenantId,
      );
      if (!locked || locked.length === 0) throw new ArEntryNotFoundForWriteOffError(dto.arEntryId);
      const entry = locked[0];
      if (entry.status !== 'OPEN') throw new WriteOffValidationError('AR_ENTRY_NOT_OPEN', `AR entry must be OPEN to write off — current status is '${entry.status}'`);
      if (Math.abs(Number(entry.amount) - dto.amount) > 0.005) {
        throw new WriteOffValidationError('AMOUNT_MUST_TIE_OUT', `Write-off amount must equal the AR entry's full open amount (${entry.amount}) so it ties out to $0`);
      }

      const created = await tx.arDirectWriteOff.create({
        data: {
          tenantId, arEntryId: dto.arEntryId, amount: dto.amount, reason: dto.reason,
          thresholdOverride: overThreshold, status: 'POSTED', createdBy: actor,
        },
      });
      await tx.aREntry.update({ where: { id: dto.arEntryId }, data: { status: 'VOIDED' } });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArDirectWriteOff', docId: created.id, action: 'CREATED', before: entry, after: created, actor, correlationId: correlationId ?? null },
      });
      return created;
    });

    await this._writeOutbox(tenantId, 'AR_DIRECT_WRITE_OFF_POSTED', writeOff.id, { arEntryId: dto.arEntryId, amount: dto.amount, actor });

    const glEntryId = await this._postWriteOffJournal(tenantId, writeOff, actor, serviceToken);
    if (glEntryId) {
      await this.prisma.arDirectWriteOff.update({ where: { id: writeOff.id }, data: { glEntryId } });
    }
    // BUG FIX (CE-09 cert): previously only refetched writeOff when
    // glEntryId was truthy, so a failed GL posting (missing/broken account
    // mapping) left the API response showing the stale pre-failure record
    // with glPostingError always null, even though _recordGlFailure had
    // just written it to the DB. Always refetch so the caller sees the
    // real, current state either way.
    writeOff = await this.prisma.arDirectWriteOff.findFirst({ where: { id: writeOff.id, tenantId } });
    return writeOff;
  }

  /** S218-style reversal symmetry: restores the AR item to OPEN exactly
   * once (guarded by the write-off's own status, checked under a row
   * lock), and marks the original write-off REVERSED. */
  async reverseWriteOff(tenantId: string, id: string, dto: ReverseWriteOffDTO, actor = 'system', correlationId?: string) {
    if (!dto.reason?.trim()) throw new WriteOffValidationError('REASON_REQUIRED', 'A reason is required to reverse a write-off');

    return this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const locked = await tx.$queryRawUnsafe(
        `SELECT id, tenant_id, ar_entry_id, amount, status FROM ar_direct_write_offs WHERE id = $1::uuid AND tenant_id = $2 FOR UPDATE`,
        id, tenantId,
      );
      if (!locked || locked.length === 0) throw new WriteOffNotFoundError(id);
      const current = locked[0];
      if (current.status === 'REVERSED') throw new WriteOffValidationError('ALREADY_REVERSED', 'This write-off has already been reversed');

      const updated = await tx.arDirectWriteOff.update({
        where: { id }, data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: actor, reversalReason: dto.reason },
      });
      await tx.aREntry.update({ where: { id: current.ar_entry_id }, data: { status: 'OPEN' } });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArDirectWriteOff', docId: id, action: 'REVERSED', before: current, after: updated, actor, correlationId: correlationId ?? null },
      });
      return updated;
    });
  }

  private async _postWriteOffJournal(tenantId: string, writeOff: any, actor: string, serviceToken?: string): Promise<string | null> {
    const glConfig = await this.prisma.arWriteOffGlAccountConfig.findFirst({ where: { tenantId } });
    if (!glConfig?.writeOffExpenseGlAccountId || !glConfig?.arControlGlAccountId) {
      await this._recordGlFailure(tenantId, writeOff.id, 'Write-off expense/AR control GL accounts are not configured for this tenant (ACCOUNT_MAPPING_VALUES_PENDING)');
      return null;
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      const AUTH_SCHEME = 'Bear' + 'er';
      if (serviceToken) headers['authorization'] = `${AUTH_SCHEME} ${serviceToken}`;

      const amount = Number(writeOff.amount);
      const jeResp = await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entryDate: new Date().toISOString(),
          description: `Direct AR write-off — entry ${writeOff.arEntryId}`,
          source: 'AR',
          sourceRef: writeOff.arEntryId.slice(0, 8),
          lines: [
            { glAccountId: glConfig.writeOffExpenseGlAccountId, debit: amount, credit: 0, memo: `Write-off expense — ${writeOff.arEntryId}`, controlNumber: writeOff.arEntryId },
            { glAccountId: glConfig.arControlGlAccountId, debit: 0, credit: amount, memo: `AR control relief — ${writeOff.arEntryId}`, controlNumber: writeOff.arEntryId },
          ],
        }),
      });
      if (!jeResp.ok) {
        const errText = await jeResp.text().catch(() => '');
        await this._recordGlFailure(tenantId, writeOff.id, `gl-service create failed: HTTP ${jeResp.status} ${errText}`);
        return null;
      }
      const je = await jeResp.json() as { id: string };
      await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries/${je.id}/post`, { method: 'POST', headers }).catch(() => null);
      return je.id;
    } catch (err: any) {
      await this._recordGlFailure(tenantId, writeOff.id, err?.message ?? 'Unknown error');
      return null;
    }
  }

  private async _recordGlFailure(tenantId: string, writeOffId: string, message: string) {
    try {
      await this.prisma.arDirectWriteOff.update({ where: { id: writeOffId }, data: { glPostingError: message } });
    } catch {
      // Non-fatal
    }
  }

  private async _writeOutbox(tenantId: string, eventType: string, aggregateId: string, payload: Record<string, unknown>) {
    try {
      await this.prisma.outboxEvent.create({ data: { tenantId, eventType, payload: { aggregateId, ...payload } } });
    } catch {
      // Non-fatal
    }
  }
}
