// S079 — Floorplan Lender Feed Adapters: lender profile + truthful adapter
// status. A lender with no adapter wired reports FEED_NOT_CONFIGURED
// forever, never a silently-empty feed list. Manual statement entry
// (feed-service.importManualBatch) is always usable regardless of this
// status — enforced by NEVER gating the manual path on adapterStatus
// anywhere in this service.
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import { appendAuditReference } from '../infrastructure/audit';
import { FloorplanValidationError, FloorplanNotFoundError } from '../domain/errors';

export const ADAPTER_STATUSES = ['CONFIGURED', 'NOT_CONFIGURED'] as const;
export type AdapterStatus = (typeof ADAPTER_STATUSES)[number];

/** FIXTURE_FEED is a deterministic, clearly-labeled fixture adapter — no
 * real lender vendor integration exists in this repo/environment. */
export const ADAPTER_TYPES = ['FIXTURE_FEED', 'NOT_CONFIGURED'] as const;
export type AdapterType = (typeof ADAPTER_TYPES)[number];

@injectable()
export class LenderService {
  constructor(@inject('PrismaClient') private readonly prisma: any) {}

  async listLenders(tenantId: string) {
    return this.prisma.lenderProfile.findMany({ where: { tenantId }, orderBy: { lenderCode: 'asc' } });
  }

  async getLender(tenantId: string, lenderCode: string) {
    const row = await this.prisma.lenderProfile.findUnique({ where: { tenantId_lenderCode: { tenantId, lenderCode } } });
    if (!row) throw new FloorplanNotFoundError(`No lender profile ${lenderCode} for tenant ${tenantId}.`);
    return row;
  }

  /** S079 AC: unconfigured lender ⇒ FEED_NOT_CONFIGURED truthfully
   * surfaced. Returns the profile if one exists (its adapterStatus governs
   * the answer); a lender that has never been registered at all is ALSO
   * truthfully NOT_CONFIGURED — never a 404 masquerading as "nothing to
   * import", since manual entry must still be reachable for it. */
  async feedStatus(tenantId: string, lenderCode: string): Promise<{ lenderCode: string; adapterStatus: AdapterStatus; adapterType: AdapterType; manualEntryAvailable: true }> {
    const row = await this.prisma.lenderProfile.findUnique({ where: { tenantId_lenderCode: { tenantId, lenderCode } } });
    return {
      lenderCode,
      adapterStatus: (row?.adapterStatus as AdapterStatus) ?? 'NOT_CONFIGURED',
      adapterType: (row?.adapterType as AdapterType) ?? 'NOT_CONFIGURED',
      manualEntryAvailable: true,
    };
  }

  async upsertLenderProfile(
    tenantId: string,
    input: { lenderCode: string; lenderName: string; adapterStatus: AdapterStatus; adapterType: AdapterType },
    actor: string,
  ) {
    if (!input.lenderCode?.trim()) throw new FloorplanValidationError('lenderCode is required.');
    if (!input.lenderName?.trim()) throw new FloorplanValidationError('lenderName is required.');
    if (!ADAPTER_STATUSES.includes(input.adapterStatus)) throw new FloorplanValidationError(`Invalid adapterStatus: ${input.adapterStatus}`);
    if (!ADAPTER_TYPES.includes(input.adapterType)) throw new FloorplanValidationError(`Invalid adapterType: ${input.adapterType}`);
    if (input.adapterStatus === 'CONFIGURED' && input.adapterType === 'NOT_CONFIGURED') {
      throw new FloorplanValidationError('adapterStatus CONFIGURED requires a real adapterType (e.g. FIXTURE_FEED).');
    }

    const existing = await this.prisma.lenderProfile.findUnique({ where: { tenantId_lenderCode: { tenantId, lenderCode: input.lenderCode } } });
    const row = await this.prisma.lenderProfile.upsert({
      where: { tenantId_lenderCode: { tenantId, lenderCode: input.lenderCode } },
      create: { id: randomUUID(), tenantId, lenderCode: input.lenderCode, lenderName: input.lenderName, adapterStatus: input.adapterStatus, adapterType: input.adapterType, createdBy: actor },
      update: { lenderName: input.lenderName, adapterStatus: input.adapterStatus, adapterType: input.adapterType },
    });
    await appendAuditReference(this.prisma, {
      tenantId,
      entityType: 'LENDER_PROFILE',
      entityId: row.id,
      eventType: 'floorplan.lender_profile.upserted',
      actor,
      before: existing ?? null,
      after: row,
    });
    return row;
  }
}
