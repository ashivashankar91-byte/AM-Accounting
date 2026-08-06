import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { IAutomationEventPublisher, IFixedOpsAdapter } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';
import { AutomationItemService } from './automation-item-service';
import { isAutomationIdentity } from '../domain/sod';

const CAPABILITY = 'S073_LIFO_OVERLAY';

/**
 * CE-17 S073 — LIFO overlay.
 *
 * The election, the pool and the index are all *entered* evidence. This
 * service computes a reserve from what somebody supplied and can never derive
 * an index of its own — a derived index would be an unsupported tax position
 * wearing a computed number's clothes.
 *
 * Ceiling is EXECUTE_WITH_APPROVAL: a LIFO reserve is never posted unattended.
 */
@injectable()
export class LifoService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IFixedOpsAdapter') private readonly fixedOps: IFixedOpsAdapter,
    private readonly capabilities: AutomationCapabilityService,
    private readonly items: AutomationItemService,
  ) {}

  async listPools(tenantId: string, legalEntityId: string) {
    const pools = await this.prisma.lifoPoolDefinition.findMany({
      where: { tenantId, legalEntityId },
      include: { layers: { orderBy: [{ layerYear: 'asc' }, { layerMonth: 'asc' }] } },
      orderBy: { poolCode: 'asc' },
    });
    const { signal } = await this.fixedOps.getPartsMovements(tenantId, legalEntityId, 0, 0);
    return { items: pools, total: pools.length, upstreamSignal: signal };
  }

  async createPool(input: {
    tenantId: string; legalEntityId: string; poolCode: string; poolName: string;
    methodElection: string; indexSource: string; effectiveDate: string;
    electedBy: string; electionEvidence?: string | null;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);
    const VALID = ['LIFO_DOLLAR_VALUE', 'LIFO_UNIT'];
    if (!VALID.includes(input.methodElection)) {
      throw new AutomationError(`methodElection must be one of ${VALID.join(', ')}.`, { statusCode: 400, code: 'INVALID_METHOD_ELECTION' });
    }
    if (!input.electionEvidence) {
      throw new AutomationError(
        'A LIFO election requires an evidence reference for the election itself; an unsourced election is not a position this system will hold.',
        { statusCode: 422, code: 'ELECTION_EVIDENCE_REQUIRED' },
      );
    }
    if (isAutomationIdentity(input.electedBy)) {
      throw new AutomationError('A LIFO method election must be made by a person, not an automation identity.', {
        statusCode: 403, code: 'SOD_VIOLATION',
      });
    }

    const pool = await this.prisma.lifoPoolDefinition.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        poolCode: input.poolCode,
        poolName: input.poolName,
        methodElection: input.methodElection,
        indexSource: input.indexSource,
        effectiveDate: new Date(input.effectiveDate),
        electedBy: input.electedBy,
        electionEvidence: input.electionEvidence,
      },
    });
    await this.events.publish(input.tenantId, pool.id, 'automation.lifo.pool_elected', {
      poolCode: input.poolCode, methodElection: input.methodElection, electedBy: input.electedBy,
    });
    return pool;
  }

  /**
   * Computes a layer's reserve as a preview. Nothing is posted here and the
   * layer is written unapproved: the number exists so a human can look at it.
   *
   * reserve = baseCost × (indexValue − 1), rounded to cents. The index is
   * taken verbatim from what was entered, with its evidence reference.
   */
  async computeLayers(input: {
    tenantId: string; poolId: string;
    layers: { layerYear: number; layerMonth: number; baseQuantity: string | number; baseCost: string | number; indexValue: string | number; indexEvidenceRef?: string | null }[];
    actor: string;
  }) {
    const pool = await this.prisma.lifoPoolDefinition.findFirst({ where: { tenantId: input.tenantId, id: input.poolId } });
    if (!pool) throw new NotConfiguredError(`LIFO pool ${input.poolId} does not exist for this tenant.`);

    const previews = [];
    for (const layer of input.layers) {
      if (!layer.indexEvidenceRef) {
        throw new AutomationError(
          `Layer ${layer.layerYear}-${String(layer.layerMonth).padStart(2, '0')} has no index evidence reference. The index is entered evidence, never derived.`,
          { statusCode: 422, code: 'INDEX_EVIDENCE_REQUIRED' },
        );
      }
      const index = Number(layer.indexValue);
      if (!Number.isFinite(index) || index <= 0) {
        throw new AutomationError('indexValue must be a positive number.', { statusCode: 400, code: 'INVALID_INDEX_VALUE' });
      }
      const baseCost = Number(layer.baseCost);
      const reserve = (baseCost * (index - 1)).toFixed(2);

      const existing = await this.prisma.lifoLayer.findFirst({
        where: {
          tenantId: input.tenantId, poolId: pool.id,
          layerYear: layer.layerYear, layerMonth: layer.layerMonth,
        },
      });
      // An approved layer is settled evidence: a later preview does not quietly
      // move a number somebody has already signed for.
      if (existing?.approved) {
        throw new AutomationError(
          `Layer ${layer.layerYear}-${String(layer.layerMonth).padStart(2, '0')} is already approved and cannot be recomputed. Reverse its posting first.`,
          { statusCode: 409, code: 'LAYER_ALREADY_APPROVED' },
        );
      }

      const saved = await this.prisma.lifoLayer.upsert({
        where: {
          tenantId_poolId_layerYear_layerMonth: {
            tenantId: input.tenantId, poolId: pool.id, layerYear: layer.layerYear, layerMonth: layer.layerMonth,
          },
        },
        create: {
          tenantId: input.tenantId, poolId: pool.id,
          layerYear: layer.layerYear, layerMonth: layer.layerMonth,
          baseQuantity: String(layer.baseQuantity), baseCost: String(layer.baseCost),
          indexValue: String(layer.indexValue), indexEvidenceRef: layer.indexEvidenceRef,
          reserveAmount: reserve,
        },
        update: {
          baseQuantity: String(layer.baseQuantity), baseCost: String(layer.baseCost),
          indexValue: String(layer.indexValue), indexEvidenceRef: layer.indexEvidenceRef,
          reserveAmount: reserve,
        },
      });
      previews.push(saved);
    }

    await this.events.publish(input.tenantId, pool.id, 'automation.lifo.layers_previewed', {
      poolCode: pool.poolCode, layerCount: previews.length, actor: input.actor, posted: false,
    });
    return { poolId: pool.id, poolCode: pool.poolCode, layers: previews, posted: false };
  }

  /**
   * Approves a layer and hands the reserve entry to the governed item path.
   * The approval is recorded on the layer, but the money still travels through
   * CE-07 like every other financial effect in this epic.
   */
  async approveLayer(input: { tenantId: string; id: string; approver: string; reserveAccountCode: string; offsetAccountCode: string }) {
    const layer = await this.prisma.lifoLayer.findFirst({ where: { tenantId: input.tenantId, id: input.id } });
    if (!layer) throw new NotConfiguredError(`LIFO layer ${input.id} does not exist for this tenant.`);
    if (isAutomationIdentity(input.approver)) {
      throw new AutomationError('A LIFO reserve must be approved by a person.', { statusCode: 403, code: 'SOD_VIOLATION' });
    }
    if (layer.approved) return layer;

    const pool = await this.prisma.lifoPoolDefinition.findFirst({ where: { tenantId: input.tenantId, id: layer.poolId } });
    if (!pool) throw new NotConfiguredError('The layer\'s pool no longer exists.');

    const amount = layer.reserveAmount.toString();
    const { item } = await this.items.create({
      tenantId: input.tenantId,
      legalEntityId: pool.legalEntityId,
      capabilityCode: CAPABILITY,
      subjectRef: layer.id,
      action: 'POST_RESERVE',
      sourceEvidenceRefs: [layer.indexEvidenceRef, pool.electionEvidence].filter(Boolean),
      recommendationEvidence: {
        poolCode: pool.poolCode, methodElection: pool.methodElection, indexSource: pool.indexSource,
        indexValue: layer.indexValue.toString(), baseCost: layer.baseCost.toString(),
        periodYear: layer.layerYear, periodMonth: layer.layerMonth,
        statutorySupported: true,
        postingLines: [
          { accountCode: input.offsetAccountCode, debit: amount, credit: '0.00', memo: `LIFO reserve ${pool.poolCode} ${layer.layerYear}-${String(layer.layerMonth).padStart(2, '0')}` },
          { accountCode: input.reserveAccountCode, debit: '0.00', credit: amount, memo: `LIFO reserve ${pool.poolCode}` },
        ],
      },
      proposedAmount: amount,
    });

    const approvedItem = await this.items.approve(input.tenantId, item.id, input.approver, 'LIFO layer approved');
    const updated = await this.prisma.lifoLayer.update({
      where: { id: layer.id },
      data: { approved: true, approvedBy: input.approver, approvedAt: new Date(), postingItemId: approvedItem.id },
    });

    await this.events.publish(input.tenantId, layer.id, 'automation.lifo.layer_approved', {
      poolCode: pool.poolCode, approver: input.approver, itemId: approvedItem.id, amount,
    });
    return updated;
  }
}
