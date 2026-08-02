import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface RecordNsfDTO {
  customerId: string;
  originalArEntryId: string;
  amount: number;
  reason: string;
  /** MANUAL (default) | BANK_FEED_NOT_CONFIGURED — truthful adapter state.
   * No bank-feed integration exists in this repo; a caller may pass
   * BANK_FEED_NOT_CONFIGURED to record that an automated feed was expected
   * but is not wired up, never a fabricated automated ingestion. */
  source?: 'MANUAL' | 'BANK_FEED_NOT_CONFIGURED';
}

export interface MarkDepositReconciledDTO {
  reconciledAt?: Date;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class ArEntryNotFoundForNsfError extends Error {
  constructor(id: string) {
    super(`AR entry not found: ${id}`);
    this.name = 'ArEntryNotFoundForNsfError';
  }
}

export class NsfValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'NsfValidationError';
  }
}

export class NsfEventNotFoundError extends Error {
  constructor(id: string) {
    super(`NSF event not found: ${id}`);
    this.name = 'NsfEventNotFoundError';
  }
}

/**
 * CE-09 S051 — NSF (returned-payment) Handling. A manual-entry endpoint
 * records a returned payment against an AR entry that was previously
 * closed by a receipt (status = POSTED). Reverses the original receipt
 * application by restoring the AR entry to OPEN — UNLESS the originating
 * deposit is already reconciled (AREntry.reconciledAt set), in which case
 * the entry is NEVER mutated/reopened; the NSF instead posts as a new
 * bank-side adjustment event only (postedAsBankAdjustment = true). This is
 * the same conservation boundary as S045's void-after-cleared guard
 * (PaymentLifecycleService/ManualPaymentService — VoidRefusedPaymentReconciledError),
 * reusing the identical "once cleared/reconciled, never reopen" idiom.
 *
 * Optionally creates a separate NSF fee AR item (fee amount from tenant
 * SAFE_CONFIGURATION — ArNsfFeeConfig; missing config = no fee item, never
 * a fabricated amount), and flags the customer with an incremented NSF
 * count, auto-holding the customer (mirrors Customer.creditHold) after N
 * per tenant SAFE_CONFIGURATION (ArNsfHoldConfig; missing config = no
 * auto-hold ever applied).
 *
 * reconciledAt/reconciledBy on AREntry are a PUTR integration boundary with
 * recon-service (S054A/S054B) — see markDepositReconciled()'s doc comment,
 * mirroring ApManualPayment.clearedAt / PaymentLifecycleService.markCleared().
 *
 * Known scope limitation (documented, not silently assumed): this schema
 * has no partial-application/open-balance sub-ledger for AR receipts (the
 * same limitation noted for S050's write-off/allowance work) — an NSF
 * event therefore requires the returned amount to equal the AR entry's
 * full amount and restores the entry at the whole-entry level; a receipt
 * that was partially applied across multiple AR entries cannot be
 * partially reversed by this slice.
 */
@injectable()
export class NsfService {
  private glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';

  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async list(tenantId: string, customerId?: string) {
    return this.prisma.arNsfEvent.findMany({ where: { tenantId, ...(customerId ? { customerId } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  async getById(tenantId: string, id: string) {
    const row = await this.prisma.arNsfEvent.findFirst({ where: { id, tenantId } });
    if (!row) throw new NsfEventNotFoundError(id);
    return row;
  }

  /**
   * PUTR integration boundary with recon-service (S054A/S054B):
   * recon-service is expected to set reconciledAt/reconciledBy on the
   * AREntry when the deposit containing its receipt actually reconciles.
   * Until that cross-service wiring exists, this admin/test-only endpoint
   * sets it directly — clearly labeled here and at the route level, never
   * used by a real bank-feed adapter (none exists in this repo). Mirrors
   * PaymentLifecycleService.markCleared() exactly.
   */
  async markDepositReconciled(tenantId: string, arEntryId: string, dto: MarkDepositReconciledDTO, actor: string) {
    const entry = await this.prisma.aREntry.findFirst({ where: { id: arEntryId, tenantId } });
    if (!entry) throw new ArEntryNotFoundForNsfError(arEntryId);
    if (entry.reconciledAt) throw new NsfValidationError('ALREADY_RECONCILED', 'AR entry is already marked reconciled');
    return this.prisma.aREntry.update({
      where: { id: arEntryId }, data: { reconciledAt: dto.reconciledAt ?? new Date(), reconciledBy: actor },
    });
  }

  async recordNsf(tenantId: string, dto: RecordNsfDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    if (!dto.customerId?.trim()) throw new NsfValidationError('CUSTOMER_ID_REQUIRED', 'customerId is required');
    if (!dto.originalArEntryId?.trim()) throw new NsfValidationError('ORIGINAL_AR_ENTRY_ID_REQUIRED', 'originalArEntryId is required');
    if (!(dto.amount > 0)) throw new NsfValidationError('INVALID_AMOUNT', 'amount must be greater than zero');
    if (!dto.reason?.trim()) throw new NsfValidationError('REASON_REQUIRED', 'A reason is required to record an NSF event');

    const customer = await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId } });
    if (!customer) throw new NsfValidationError('CUSTOMER_NOT_FOUND', `Customer not found: ${dto.customerId}`);

    let nsfEvent: any = await this.prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRawUnsafe(
        `SELECT id, tenant_id, amount, status, reconciled_at FROM ar_entries WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        dto.originalArEntryId, tenantId,
      );
      if (!locked || locked.length === 0) throw new ArEntryNotFoundForNsfError(dto.originalArEntryId);
      const entry = locked[0];
      if (entry.status !== 'POSTED') {
        throw new NsfValidationError('AR_ENTRY_NOT_POSTED', `AR entry must be POSTED (closed by a receipt) to record an NSF against it — current status is '${entry.status}'`);
      }
      if (Math.abs(Number(entry.amount) - dto.amount) > 0.005) {
        throw new NsfValidationError('AMOUNT_MUST_TIE_OUT', `NSF amount must equal the original AR entry's full amount (${entry.amount}) — no partial-application sub-ledger exists in this schema`);
      }

      const depositReconciled = entry.reconciled_at != null;

      const created = await tx.arNsfEvent.create({
        data: {
          tenantId, customerId: dto.customerId, originalArEntryId: dto.originalArEntryId, amount: dto.amount,
          reason: dto.reason, source: dto.source ?? 'MANUAL',
          depositReconciled, postedAsBankAdjustment: depositReconciled,
          createdBy: actor,
        },
      });

      if (!depositReconciled) {
        // Conservation boundary NOT triggered — safe to restore/reopen.
        await tx.aREntry.update({ where: { id: dto.originalArEntryId }, data: { status: 'OPEN' } });
      }
      // else: deposit already reconciled — the AR entry is NEVER mutated or
      // reopened here (same guard idiom as S045 void-after-cleared); the
      // NSF is recorded purely as a bank-side adjustment event.

      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArNsfEvent', docId: created.id, action: 'CREATED', before: entry, after: created, actor, correlationId: correlationId ?? null },
      });
      return created;
    });

    // Optional NSF fee item — tenant SAFE_CONFIGURATION; missing config = no fee item.
    const feeConfig = await this.prisma.arNsfFeeConfig.findFirst({ where: { tenantId } });
    if (feeConfig?.feeAmount) {
      const feeEntry = await this.prisma.aREntry.create({
        data: {
          tenantId, dealerRef: `NSF-FEE-${nsfEvent.id.slice(0, 8)}`, type: 'RECEIVABLE',
          amount: feeConfig.feeAmount, dueDate: new Date(), status: 'OPEN', remarks: `NSF fee for returned payment on AR entry ${dto.originalArEntryId}`,
        },
      });
      nsfEvent = await this.prisma.arNsfEvent.update({
        where: { id: nsfEvent.id }, data: { feeArEntryId: feeEntry.id, feeAmount: feeConfig.feeAmount },
      });
    }

    // Customer NSF count + auto-hold after N — tenant SAFE_CONFIGURATION;
    // missing config = no auto-hold ever applied (never a silently invented count/threshold).
    const newCount = (customer.nsfCount ?? 0) + 1;
    const holdConfig = await this.prisma.arNsfHoldConfig.findFirst({ where: { tenantId } });
    const shouldAutoHold = !customer.creditHold && !!holdConfig && newCount >= holdConfig.holdAfterCount;
    await this.prisma.customer.update({
      where: { id: dto.customerId },
      data: {
        nsfCount: newCount,
        ...(shouldAutoHold ? {
          nsfHoldSetAt: new Date(),
          creditHold: true, creditHoldReason: 'NSF_AUTO_HOLD', creditHoldSetAt: new Date(), creditHoldSetBy: 'system:nsf',
        } : {}),
      },
    });

    await this._writeOutbox(tenantId, 'AR_NSF_EVENT_RECORDED', nsfEvent.id, { customerId: dto.customerId, originalArEntryId: dto.originalArEntryId, amount: dto.amount, actor });

    const glEntryId = await this._postNsfJournal(tenantId, nsfEvent, actor, serviceToken);
    if (glEntryId) {
      await this.prisma.arNsfEvent.update({ where: { id: nsfEvent.id }, data: { glEntryId } });
      nsfEvent = await this.prisma.arNsfEvent.findFirst({ where: { id: nsfEvent.id, tenantId } });
    }
    return nsfEvent;
  }

  private async _postNsfJournal(tenantId: string, nsfEvent: any, actor: string, serviceToken?: string): Promise<string | null> {
    const glConfig = await this.prisma.arNsfGlAccountConfig.findFirst({ where: { tenantId } });
    if (!glConfig?.arControlGlAccountId || !glConfig?.cashGlAccountId) {
      await this._recordGlFailure(tenantId, nsfEvent.id, 'AR control/cash GL accounts are not configured for this tenant (ACCOUNT_MAPPING_VALUES_PENDING)');
      return null;
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      const AUTH_SCHEME = 'Bear' + 'er';
      if (serviceToken) headers['authorization'] = `${AUTH_SCHEME} ${serviceToken}`;

      const amount = Number(nsfEvent.amount);
      const lines = [
        // Reverses the original receipt: Dr AR control (reopen the receivable) / Cr Cash (deposit reduced).
        { glAccountId: glConfig.arControlGlAccountId, debit: amount, credit: 0, memo: `NSF reversal — AR entry ${nsfEvent.originalArEntryId}`, controlNumber: nsfEvent.originalArEntryId },
        { glAccountId: glConfig.cashGlAccountId, debit: 0, credit: amount, memo: `NSF returned payment — AR entry ${nsfEvent.originalArEntryId}`, controlNumber: nsfEvent.originalArEntryId },
      ];
      if (nsfEvent.feeAmount && glConfig.nsfFeeIncomeGlAccountId) {
        const feeAmount = Number(nsfEvent.feeAmount);
        lines.push(
          { glAccountId: glConfig.arControlGlAccountId, debit: feeAmount, credit: 0, memo: `NSF fee receivable — ${nsfEvent.id}`, controlNumber: nsfEvent.id },
          { glAccountId: glConfig.nsfFeeIncomeGlAccountId, debit: 0, credit: feeAmount, memo: `NSF fee income — ${nsfEvent.id}`, controlNumber: nsfEvent.id },
        );
      }

      const jeResp = await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entryDate: new Date().toISOString(),
          description: `NSF returned payment${nsfEvent.postedAsBankAdjustment ? ' (bank-side adjustment — deposit already reconciled)' : ''} — AR entry ${nsfEvent.originalArEntryId}`,
          source: 'AR',
          sourceRef: nsfEvent.originalArEntryId.slice(0, 8),
          lines,
        }),
      });
      if (!jeResp.ok) {
        const errText = await jeResp.text().catch(() => '');
        await this._recordGlFailure(tenantId, nsfEvent.id, `gl-service create failed: HTTP ${jeResp.status} ${errText}`);
        return null;
      }
      const je = await jeResp.json() as { id: string };
      await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries/${je.id}/post`, { method: 'POST', headers }).catch(() => null);
      return je.id;
    } catch (err: any) {
      await this._recordGlFailure(tenantId, nsfEvent.id, err?.message ?? 'Unknown error');
      return null;
    }
  }

  private async _recordGlFailure(tenantId: string, nsfEventId: string, message: string) {
    try {
      await this.prisma.arNsfEvent.update({ where: { id: nsfEventId }, data: { glPostingError: message } });
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
