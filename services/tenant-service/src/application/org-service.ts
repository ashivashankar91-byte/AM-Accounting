import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient, Prisma } from '.prisma/tenant-client';
import crypto from 'crypto';

// ── S202: Dealer Group Hierarchy View & Maintenance ─────────────────────────
// Tree shape: GROUP (synthetic, one per tenant) -> ENTITY (LegalEntity) ->
// STORE (Store) -> FRANCHISE (Franchise). GROUP is synthesized at query time
// (not persisted) — the packet explicitly prohibits reusing group-service's
// flat DealerGroup/DealerGroupTenant model as the hierarchy (it spans
// multiple tenants; this tree is tenant-scoped, per contract field #18).
// Only STORE and FRANCHISE are re-parentable (BR202-2): the base FK
// (Store.entityId, Franchise.storeId) is set once at creation and is
// immutable elsewhere in the codebase, so a re-parent is recorded as an
// effective-dated override row (OrgReparentEvent) rather than a base-row
// mutation. "Current parent" is always a resolved projection: the latest
// override with effective_from <= asOf, else the base FK.

export type OrgNodeType = 'GROUP' | 'ENTITY' | 'STORE' | 'FRANCHISE';

export interface OrgNode {
  type: OrgNodeType;
  id: string;
  code: string;
  name: string;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  children: OrgNode[];
}

export interface OrgTreeRow {
  type: OrgNodeType;
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  status: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface ReparentDTO {
  tenantId: string;
  nodeType: 'STORE' | 'FRANCHISE';
  nodeId: string;
  newParentId: string;
  effectiveFrom: string; // ISO date (YYYY-MM-DD)
  actor?: string;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class OrgNodeNotFoundError extends Error {
  constructor(nodeType: string, id: string) {
    super(`${nodeType} not found: ${id}`);
    this.name = 'OrgNodeNotFoundError';
  }
}

export class OrgValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OrgValidationError';
  }
}

@injectable()
export class OrgService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly _eventPublisher: IEventPublisher,
  ) {}

  // ── getTree ──────────────────────────────────────────────────────────────
  async getTree(tenantId: string, asOf?: string): Promise<OrgNode> {
    const asOfDate = asOf ? this._parseDate(asOf, 'asOf') : new Date();

    const [entities, stores, franchises, overrides] = await Promise.all([
      this.prisma.legalEntity.findMany({ where: { tenantId } }),
      this.prisma.store.findMany({ where: { tenantId } }),
      this.prisma.franchise.findMany({ where: { tenantId } }),
      this.prisma.orgReparentEvent.findMany({
        where: { tenantId, effectiveFrom: { lte: asOfDate } },
        orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    // Resolve the latest applicable override per (nodeType, nodeId) as of asOf.
    const resolvedParent = new Map<string, string>(); // `${nodeType}:${nodeId}` -> parentId
    for (const o of overrides) {
      resolvedParent.set(`${o.nodeType}:${o.nodeId}`, o.newParentId);
    }

    const groupId = `GROUP:${tenantId}`;
    const root: OrgNode = {
      type: 'GROUP', id: groupId, code: tenantId, name: 'Organization',
      status: 'ACTIVE', effectiveFrom: null, effectiveTo: null, children: [],
    };

    const nodesById = new Map<string, OrgNode>();
    nodesById.set(groupId, root);

    for (const e of entities) {
      nodesById.set(e.id, {
        type: 'ENTITY', id: e.id, code: e.entityCode, name: e.legalName,
        status: e.status, effectiveFrom: this._toIsoDate(e.effectiveDate), effectiveTo: null,
        children: [],
      });
    }
    for (const s of stores) {
      nodesById.set(s.id, {
        type: 'STORE', id: s.id, code: s.storeCode, name: s.storeName,
        status: s.status, effectiveFrom: null, effectiveTo: null, children: [],
      });
    }
    for (const f of franchises) {
      nodesById.set(f.id, {
        type: 'FRANCHISE', id: f.id, code: f.dealerCode, name: `${f.oemCode} (${f.dealerCode})`,
        status: f.effectiveTo ? 'INACTIVE' : 'ACTIVE',
        effectiveFrom: this._toIsoDate(f.effectiveFrom),
        effectiveTo: f.effectiveTo ? this._toIsoDate(f.effectiveTo) : null,
        children: [],
      });
    }

    // Attach in parent-known order: entities under GROUP, stores under
    // (resolved) entity, franchises under (resolved) store.
    for (const e of entities) {
      root.children.push(nodesById.get(e.id)!);
    }
    for (const s of stores) {
      const parentId = resolvedParent.get(`STORE:${s.id}`) ?? s.entityId;
      const parent = nodesById.get(parentId);
      if (parent) parent.children.push(nodesById.get(s.id)!);
    }
    for (const f of franchises) {
      const parentId = resolvedParent.get(`FRANCHISE:${f.id}`) ?? f.storeId;
      const parent = nodesById.get(parentId);
      if (parent) parent.children.push(nodesById.get(f.id)!);
    }

    return root;
  }

  // ── toCsvRows: BR202-3 export must match the screen exactly ─────────────
  async toCsvRows(tree: OrgNode): Promise<OrgTreeRow[]> {
    const rows: OrgTreeRow[] = [];
    const walk = (node: OrgNode, parentId: string | null) => {
      rows.push({
        type: node.type, id: node.id, parentId, code: node.code, name: node.name,
        status: node.status, effectiveFrom: node.effectiveFrom, effectiveTo: node.effectiveTo,
      });
      for (const child of node.children) walk(child, node.id);
    };
    walk(tree, null);
    return rows;
  }

  // ── reparent (BR202-1 / BR202-2) ─────────────────────────────────────────
  async reparent(dto: ReparentDTO): Promise<{ nodeType: string; nodeId: string; oldParentId: string; newParentId: string; effectiveFrom: string }> {
    const { tenantId, nodeType, nodeId, newParentId, actor } = dto;
    const effectiveFrom = this._parseDate(dto.effectiveFrom, 'effectiveFrom');

    if (nodeType === 'STORE') {
      const store = await this.prisma.store.findFirst({ where: { id: nodeId, tenantId } });
      if (!store) throw new OrgNodeNotFoundError('Store', nodeId);
      const newParent = await this.prisma.legalEntity.findFirst({ where: { id: newParentId, tenantId } });
      if (!newParent) {
        throw new OrgValidationError('PARENT_NOT_FOUND', `LegalEntity not found for new parent: ${newParentId}`);
      }
    } else if (nodeType === 'FRANCHISE') {
      const franchise = await this.prisma.franchise.findFirst({ where: { id: nodeId, tenantId } });
      if (!franchise) throw new OrgNodeNotFoundError('Franchise', nodeId);
      const newParent = await this.prisma.store.findFirst({ where: { id: newParentId, tenantId } });
      if (!newParent) {
        throw new OrgValidationError('PARENT_NOT_FOUND', `Store not found for new parent: ${newParentId}`);
      }
    } else {
      throw new OrgValidationError('INVALID_NODE_TYPE', `nodeType must be STORE or FRANCHISE, got ${nodeType}`);
    }

    // BR202-1: single-parent tree, cycles impossible. Defensive check: walk
    // the current resolved ancestor chain of newParentId and reject if
    // nodeId appears in it (a self-parent or an ancestor-becomes-descendant
    // attempt), even though the fixed GROUP->ENTITY->STORE->FRANCHISE typing
    // already makes a true cycle structurally unreachable today.
    if (newParentId === nodeId) {
      throw new OrgValidationError('BR202-1', 'A node cannot be re-parented to itself (cycle)');
    }
    const ancestorIds = await this._resolveAncestorChain(tenantId, nodeType, newParentId);
    if (ancestorIds.has(nodeId)) {
      throw new OrgValidationError('BR202-1', 'Re-parent rejected: would create a cycle in the org tree');
    }

    const oldParentId = await this._resolveCurrentParent(tenantId, nodeType, nodeId);

    const override = await this.prisma.$transaction(async (tx) => {
      const o = await tx.orgReparentEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId, nodeType, nodeId,
          oldParentId, newParentId, effectiveFrom, actor: actor ?? 'system',
        },
      });
      await this._audit(
        tenantId, 'OrgNode', nodeId, 'REPARENT',
        { parentId: oldParentId }, { parentId: newParentId, effectiveFrom: dto.effectiveFrom },
        actor, tx,
      );
      return o;
    });

    await this._writeOutbox(tenantId, 'org.node.reparented', nodeId, {
      eventId: crypto.randomUUID(), nodeId, oldParentId, newParentId,
      effectiveFrom: dto.effectiveFrom, actor: actor ?? 'system',
      ts: new Date().toISOString(), schemaV: 1,
    });

    return {
      nodeType, nodeId, oldParentId, newParentId,
      effectiveFrom: this._toIsoDate(override.effectiveFrom),
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async _resolveCurrentParent(tenantId: string, nodeType: string, nodeId: string): Promise<string> {
    const latest = await this.prisma.orgReparentEvent.findFirst({
      where: { tenantId, nodeType, nodeId, effectiveFrom: { lte: new Date() } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    if (latest) return latest.newParentId;

    if (nodeType === 'STORE') {
      const store = await this.prisma.store.findFirst({ where: { id: nodeId, tenantId } });
      return store!.entityId;
    }
    const franchise = await this.prisma.franchise.findFirst({ where: { id: nodeId, tenantId } });
    return franchise!.storeId;
  }

  /** Walks up from `startId` to the GROUP root, resolving each ancestor's
   * *current* parent, and returns the full set of ancestor ids visited
   * (used by the BR202-1 cycle guard). `startNodeType` is the type of the
   * node being re-parented — its new parent chain is walked from the
   * opposite direction (ENTITY/STORE upward), so we infer each ancestor's
   * own type from its level. */
  private async _resolveAncestorChain(tenantId: string, startNodeType: 'STORE' | 'FRANCHISE', startId: string): Promise<Set<string>> {
    const visited = new Set<string>();
    let currentId: string | null = startId;
    // STORE's parent is an ENTITY (parent: GROUP, no further chain to walk).
    // FRANCHISE's parent is a STORE, whose parent is an ENTITY.
    let currentType: 'ENTITY' | 'STORE' = startNodeType === 'STORE' ? 'ENTITY' : 'STORE';

    while (currentId) {
      visited.add(currentId);
      if (currentType === 'ENTITY') break; // ENTITY's parent is the synthetic GROUP root; chain ends.
      // currentType === 'STORE': resolve its current parent (an ENTITY), then stop.
      const parentId = await this._resolveCurrentParent(tenantId, 'STORE', currentId);
      visited.add(parentId);
      break;
    }
    return visited;
  }

  private _parseDate(value: string, field: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new OrgValidationError('INVALID_DATE', `${field} must be an ISO date (YYYY-MM-DD)`);
    }
    const d = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) {
      throw new OrgValidationError('INVALID_DATE', `${field} is not a valid date`);
    }
    return d;
  }

  private _toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private async _audit(
    tenantId: string, docType: string, docId: string, action: string,
    before: unknown, after: unknown, actor?: string,
    tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        id: crypto.randomUUID(), tenantId, docType, docId, action,
        before: (before ?? undefined) as any, after: (after ?? undefined) as any,
        actor: actor ?? 'system',
      },
    });
  }

  private async _writeOutbox(
    tenantId: string,
    eventType: string,
    aggregateId: string,
    payload: Prisma.InputJsonValue,
  ) {
    try {
      await this.prisma.tenantOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId, eventType, aggregateId, payload },
      });
    } catch {
      // Non-fatal: outbox write failure must not fail the business operation.
    }
  }
}

// ── CSV export helper (BR202-3) ───────────────────────────────────────────
export function orgTreeToCsv(rows: OrgTreeRow[]): string {
  const header = ['type', 'id', 'parentId', 'code', 'name', 'status', 'effectiveFrom', 'effectiveTo'];
  const esc = (v: string | null): string => {
    const s = v ?? '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([r.type, r.id, r.parentId, r.code, r.name, r.status, r.effectiveFrom, r.effectiveTo].map(esc).join(','));
  }
  return lines.join('\n');
}
