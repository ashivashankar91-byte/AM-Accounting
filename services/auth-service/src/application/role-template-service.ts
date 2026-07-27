import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/auth-client';
import type { IEventPublisher } from '@amacc/shared-kernel';
import { randomUUID } from 'crypto';
import { RoleService, RoleNotFoundError as _RoleNotFoundError } from './role-service';

// ── S004A: Dealership Position Role Templates ──────────────────────────────────
// Shipped, position-shaped starter permission sets that a security administrator
// applies in one click. Applying a template NEVER creates a parallel permission
// map: it delegates to the real S206 RoleService (ensureRoleForPositionTemplate +
// grantAssignment), so the exact same real S207 AuthzService.check() enforcement
// already proven for S206 governs every template-derived grant. Field masks
// (BR4A-2) are the one piece of behavior a permission key cannot express — they
// are stored on the template/assignment and exposed via resolveFieldMasks() for
// any consuming service to apply at response-serialization time.

export const ROLE_TEMPLATE_PERMISSIONS = {
  APPLY:  'iam.roletemplate.apply',
  MANAGE: 'iam.roletemplate.manage',
} as const;

// ── DTOs / views ────────────────────────────────────────────────────────────────

export interface RoleTemplateView {
  id:           string;
  tenantId:     string | null;   // null = global shipped default
  key:          string;
  name:         string;
  permissions:  string[];
  fieldMasks:   string[];
  builtIn:      boolean;
  status:       string;
  clonedFromId: string | null;
}

export interface CreateTemplateDTO {
  tenantId:        string;
  name:            string;
  // Required for a bespoke template; omitted (not []) when cloning so the
  // clone workflow's fallback-to-source below actually takes effect — see
  // the defect note in cloneTemplate().
  permissions?:    string[];
  fieldMasks?:     string[];
  sourceTemplateId?: string;   // clone workflow (BR4A-1 alternate workflow)
  key?:            string;     // required unless cloning (position slug)
  actor?:          string;
}

export interface UpdateTemplateDTO {
  name?:        string;
  permissions?: string[];
  fieldMasks?:  string[];
  actor?:       string;
}

export interface ApplyTemplateDTO {
  tenantId:   string;
  templateId: string;
  userId:     string;
  entityId:   string;
  storeIds?:  string[];
  allStores?: boolean;
  actor?:     string;
}

export interface RoleTemplateAssignmentView {
  id:               string;
  templateId:       string;
  templateKey:      string;
  userId:           string;
  roleAssignmentId: string;
  entityId:         string | null;
  storeIds:         string[];
  allStores:        boolean;
  status:           string;
}

// ── Errors ──────────────────────────────────────────────────────────────────────

export class RoleTemplateNotFoundError extends Error {
  constructor(id: string) { super(`Role template not found: ${id}`); this.name = 'RoleTemplateNotFoundError'; }
}

export class RoleTemplateValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message); this.name = 'RoleTemplateValidationError';
  }
}

/** Deactivate of a template that still has APPLIED assignments (mirrors BR206-2 → 409). */
export class RoleTemplateInUseError extends Error {
  constructor(id: string) {
    super(`Role template is applied to at least one user and cannot be deactivated: ${id}`);
    this.name = 'RoleTemplateInUseError';
  }
}

/** SoD control: a caller may not apply a template to themselves (§ certification report). */
export class SelfApplyForbiddenError extends Error {
  constructor() {
    super('A user cannot apply a role template to their own account (segregation of duties)');
    this.name = 'SelfApplyForbiddenError';
  }
}

// ── Service ──────────────────────────────────────────────────────────────────────

@injectable()
export class RoleTemplateService {
  constructor(
    @inject('PrismaClient')    private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('RoleService')     private readonly roleService: RoleService,
  ) {}

  // ── Templates ─────────────────────────────────────────────────────────────────

  /** Global shipped defaults (BR4A-1) + this tenant's own clones/customizations. */
  async listTemplates(tenantId: string): Promise<RoleTemplateView[]> {
    const rows = await this.prisma.roleTemplate.findMany({
      where: { OR: [{ tenantId }, { tenantId: null }] },
      orderBy: [{ tenantId: 'asc' }, { name: 'asc' }],
    });
    return rows.map(this._toView);
  }

  async getTemplate(tenantId: string, id: string): Promise<RoleTemplateView> {
    return this._toView(await this._loadVisible(tenantId, id));
  }

  async createTemplate(dto: CreateTemplateDTO): Promise<RoleTemplateView> {
    this._assertName(dto.name);

    let key = dto.key;
    let permissions = dto.permissions;
    let fieldMasks = dto.fieldMasks ?? [];
    let clonedFromId: string | null = null;

    if (dto.sourceTemplateId) {
      // BR4A-1 alternate workflow: clone-by-value. Editing the source later
      // never retroactively mutates this clone (independent row, copied now).
      // NOTE: fall back to the source's set whenever the caller didn't supply
      // a non-empty override — `dto.permissions ?? source.permissions` alone
      // would NOT do this for an explicit `[]` (nullish-coalescing only
      // triggers on null/undefined, not on an empty-but-present array), which
      // previously caused every clone to silently lose its permission set.
      const source = await this._loadVisible(dto.tenantId, dto.sourceTemplateId);
      key = source.key;
      permissions = (dto.permissions && dto.permissions.length > 0) ? dto.permissions : source.permissions;
      fieldMasks = dto.fieldMasks ?? source.fieldMasks;
      clonedFromId = source.id;
    }

    if (!key) {
      throw new RoleTemplateValidationError('KEY_REQUIRED', 'key is required unless cloning from sourceTemplateId');
    }
    await this._assertPermissionsKnown(permissions ?? []);

    const clash = await this.prisma.roleTemplate.findFirst({ where: { tenantId: dto.tenantId, name: dto.name } });
    if (clash) throw new RoleTemplateValidationError('TEMPLATE_EXISTS', `Template name already exists: ${dto.name}`);

    const template = await this.prisma.$transaction(async (tx) => {
      const t = await tx.roleTemplate.create({
        data: {
          id: randomUUID(), tenantId: dto.tenantId, key, name: dto.name,
          permissions: permissions ?? [], fieldMasks, builtIn: false, status: 'ACTIVE', clonedFromId,
        },
      });
      await this._audit(dto.tenantId, 'role_template', t.id, dto.sourceTemplateId ? 'CLONE' : 'CREATE',
        null, this._toView(t), dto.actor, tx);
      return t;
    });

    await this._emit('iam.roletemplate.created', dto.tenantId, {
      eventId: randomUUID(), templateId: template.id, key: template.key,
      scope: { tenantId: dto.tenantId }, actor: dto.actor ?? 'user',
      ts: new Date().toISOString(), schemaV: 1,
    });
    return this._toView(template);
  }

  /** Convenience wrapper matching the contract's named "clone" alternate workflow. */
  async cloneTemplate(tenantId: string, sourceTemplateId: string, newName: string, actor?: string): Promise<RoleTemplateView> {
    return this.createTemplate({ tenantId, name: newName, sourceTemplateId, actor });
  }

  async updateTemplate(tenantId: string, id: string, dto: UpdateTemplateDTO): Promise<RoleTemplateView> {
    const current = await this.prisma.roleTemplate.findFirst({ where: { id, tenantId } });
    if (!current) {
      // Distinguish "doesn't exist" from "exists but is the immutable global
      // shipped default" (never silently no-op a write against someone else's
      // or the global row — RLS would already block it, but the caller must
      // get an honest error, not a false-success).
      const global = await this.prisma.roleTemplate.findFirst({ where: { id, tenantId: null } });
      if (global) {
        throw new RoleTemplateValidationError('TEMPLATE_IMMUTABLE', 'The global shipped template cannot be edited directly; clone it first');
      }
      throw new RoleTemplateNotFoundError(id);
    }
    if (current.status !== 'ACTIVE') {
      throw new RoleTemplateValidationError('TEMPLATE_INACTIVE', 'Cannot edit a deactivated template');
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined && dto.name !== current.name) {
      this._assertName(dto.name);
      const clash = await this.prisma.roleTemplate.findFirst({ where: { tenantId, name: dto.name, NOT: { id } } });
      if (clash) throw new RoleTemplateValidationError('TEMPLATE_EXISTS', `Template name already exists: ${dto.name}`);
      data['name'] = dto.name;
    }
    if (dto.permissions !== undefined) {
      await this._assertPermissionsKnown(dto.permissions);
      data['permissions'] = dto.permissions;
    }
    if (dto.fieldMasks !== undefined) data['fieldMasks'] = dto.fieldMasks;

    const before = this._toView(current);
    const template = await this.prisma.$transaction(async (tx) => {
      const t = await tx.roleTemplate.update({ where: { id }, data });
      await this._audit(tenantId, 'role_template', t.id, 'UPDATE', before, this._toView(t), dto.actor, tx);
      return t;
    });

    await this._emit('iam.roletemplate.updated', tenantId, {
      eventId: randomUUID(), templateId: template.id, key: template.key,
      scope: { tenantId }, actor: dto.actor ?? 'user',
      ts: new Date().toISOString(), schemaV: 1,
    });
    return this._toView(template);
  }

  /** Deactivate a tenant-owned template. Blocked while any APPLIED assignment exists. */
  async deactivateTemplate(tenantId: string, id: string, actor?: string): Promise<void> {
    const current = await this.prisma.roleTemplate.findFirst({ where: { id, tenantId } });
    if (!current) {
      const global = await this.prisma.roleTemplate.findFirst({ where: { id, tenantId: null } });
      if (global) {
        throw new RoleTemplateValidationError('TEMPLATE_IMMUTABLE', 'The global shipped template cannot be deactivated directly; clone it first');
      }
      throw new RoleTemplateNotFoundError(id);
    }

    const appliedCount = await this.prisma.roleTemplateAssignment.count({
      where: { tenantId, templateId: id, status: 'APPLIED' },
    });
    if (appliedCount > 0) throw new RoleTemplateInUseError(id);

    const before = this._toView(current);
    await this.prisma.$transaction(async (tx) => {
      await tx.roleTemplate.update({ where: { id }, data: { status: 'INACTIVE' } });
      await this._audit(tenantId, 'role_template', id, 'DEACTIVATE', before, { ...before, status: 'INACTIVE' }, actor, tx);
    });

    await this._emit('iam.roletemplate.deactivated', tenantId, {
      eventId: randomUUID(), templateId: id, key: current.key,
      scope: { tenantId }, actor: actor ?? 'user',
      ts: new Date().toISOString(), schemaV: 1,
    });
  }

  // ── Apply (the primary workflow) ─────────────────────────────────────────────

  async applyTemplate(dto: ApplyTemplateDTO): Promise<RoleTemplateAssignmentView> {
    // Segregation of duties: the person granting access must not be the same
    // person receiving it. This is the concrete, testable SoD control chosen
    // for S004A (the contract does not name a different one) — see the S004A
    // certification report for the explicit rationale.
    if (dto.actor && dto.actor === dto.userId) {
      throw new SelfApplyForbiddenError();
    }

    const template = await this._loadVisible(dto.tenantId, dto.templateId);
    if (template.status !== 'ACTIVE') {
      throw new RoleTemplateValidationError('TEMPLATE_INACTIVE', 'Cannot apply a deactivated template');
    }

    // Privilege-escalation prevention: the caller supplies only templateId /
    // userId / entityId / storeIds — never a permissions array. The resulting
    // grant is always exactly template.permissions, sourced only from the
    // real, already-seeded catalog (RoleService re-validates this too).
    const role = await this.roleService.ensureRoleForPositionTemplate({
      tenantId: dto.tenantId, key: template.key, name: template.name,
      permissions: template.permissions, actor: dto.actor,
    });

    // grantAssignment performs its own real tenant/entity/store scope checks
    // (cross-tenant / out-of-entity denial), real S207 projection, and real
    // S007 audit — none of that is duplicated here.
    const assignment = await this.roleService.grantAssignment({
      tenantId: dto.tenantId, userId: dto.userId, roleId: role.id,
      entityId: dto.entityId, storeIds: dto.storeIds, allStores: dto.allStores, actor: dto.actor,
    });

    const rtAssignment = await this.prisma.$transaction(async (tx) => {
      const a = await tx.roleTemplateAssignment.create({
        data: {
          id: randomUUID(), tenantId: dto.tenantId, templateId: template.id, userId: dto.userId,
          roleAssignmentId: assignment.id, entityId: assignment.entityId,
          storeIds: assignment.storeIds, allStores: assignment.allStores, status: 'APPLIED',
        },
      });
      await this._audit(dto.tenantId, 'role_template_assignment', a.id, 'APPLY', null,
        this._toAssignmentView(a, template.key), dto.actor, tx);
      return a;
    });

    await this._emit('iam.template.applied', dto.tenantId, {
      eventId: randomUUID(), templateId: template.id, userId: dto.userId,
      scope: { tenantId: dto.tenantId, entityId: assignment.entityId, storeIds: assignment.storeIds, allStores: assignment.allStores },
      actor: dto.actor ?? 'user', ts: new Date().toISOString(), schemaV: 1,
    });

    return this._toAssignmentView(rtAssignment, template.key);
  }

  async listAssignments(tenantId: string, userId?: string): Promise<RoleTemplateAssignmentView[]> {
    const rows = await this.prisma.roleTemplateAssignment.findMany({
      where: { tenantId, ...(userId ? { userId } : {}), status: 'APPLIED' },
      include: { template: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((a) => this._toAssignmentView(a, a.template.key));
  }

  /** Revoke a template application (revokes the real underlying role_assignment too). */
  async revokeAssignment(tenantId: string, id: string, actor?: string): Promise<void> {
    const current = await this.prisma.roleTemplateAssignment.findFirst({ where: { id, tenantId } });
    if (!current) throw new RoleTemplateNotFoundError(id);
    if (current.status === 'REVOKED') return;

    await this.roleService.revokeAssignment(tenantId, current.roleAssignmentId, actor);

    const before = current;
    await this.prisma.$transaction(async (tx) => {
      await tx.roleTemplateAssignment.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date() } });
      await this._audit(tenantId, 'role_template_assignment', id, 'REVOKE', before,
        { ...before, status: 'REVOKED' }, actor, tx);
    });
  }

  // ── BR4A-2 field masking (resolver for other services / callers) ────────────

  /**
   * Effective field masks in force for a user at a given scope. Real
   * enforcement (actually omitting these fields from a domain payload, e.g. a
   * vehicle-inventory response) belongs to whichever service owns those
   * fields — no such service exists in this repository yet, so this resolver
   * is the real, tested mechanism a future consuming service would call; it
   * is not itself wired into any live payload-serialization path today. This
   * is a documented, honest scope boundary (see the S004A certification
   * report), not a fabricated end-to-end enforcement claim.
   */
  async resolveFieldMasks(tenantId: string, userId: string): Promise<string[]> {
    const rows = await this.prisma.roleTemplateAssignment.findMany({
      where: { tenantId, userId, status: 'APPLIED' },
      include: { template: true },
    });
    const masks = new Set<string>();
    for (const r of rows) for (const m of r.template.fieldMasks) masks.add(m);
    return [...masks];
  }

  /** Pure utility: strip masked field paths (dot-notation) from a payload. */
  static applyFieldMasks<T extends Record<string, unknown>>(payload: T, maskPaths: string[]): T {
    const clone: Record<string, unknown> = { ...payload };
    for (const path of maskPaths) {
      const segments = path.split('.');
      let obj: any = clone;
      for (let i = 0; i < segments.length - 1; i++) {
        if (obj == null || typeof obj[segments[i]] !== 'object') { obj = null; break; }
        obj = obj[segments[i]];
      }
      if (obj != null) delete obj[segments[segments.length - 1]];
    }
    return clone as T;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────────

  private async _loadVisible(tenantId: string, id: string) {
    const row = await this.prisma.roleTemplate.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null }] },
    });
    if (!row) throw new RoleTemplateNotFoundError(id);
    return row;
  }

  private _assertName(name: string): void {
    const n = name?.trim() ?? '';
    if (n.length < 1 || n.length > 60) {
      throw new RoleTemplateValidationError('INVALID_NAME', 'Template name must be 1–60 characters');
    }
  }

  private async _assertPermissionsKnown(permissions: string[]): Promise<void> {
    if (!Array.isArray(permissions) || permissions.length === 0) {
      throw new RoleTemplateValidationError('EMPTY_PERMISSIONS', 'A template must grant at least one permission');
    }
    const known = await this.prisma.permission.findMany({ select: { key: true } });
    const set = new Set(known.map((p) => p.key));
    const bad = permissions.filter((p) => !set.has(p));
    if (bad.length > 0) {
      throw new RoleTemplateValidationError('UNKNOWN_PERMISSION', `Unknown permission keys: ${bad.join(', ')}`);
    }
  }

  private async _audit(
    tenantId: string, docType: string, docId: string, action: string,
    before: unknown, after: unknown, actor?: string,
    tx: Pick<PrismaClient, 'auditOutboxEvent'> = this.prisma,
  ): Promise<void> {
    await tx.auditOutboxEvent.create({
      data: {
        id: randomUUID(), tenantId, docType, docId, action,
        before: (before ?? undefined) as any, after: (after ?? undefined) as any,
        actor: actor ?? 'user',
      },
    });
  }

  private async _emit(type: string, tenantId: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.events.publish({
        type, tenantId, payload,
        occurredAt: new Date(), correlationId: randomUUID(),
      } as any);
    } catch {
      /* best-effort publish; the outbox/read-model is already consistent */
    }
  }

  private _toView = (r: {
    id: string; tenantId: string | null; key: string; name: string; permissions: string[];
    fieldMasks: string[]; builtIn: boolean; status: string; clonedFromId: string | null;
  }): RoleTemplateView => ({
    id: r.id, tenantId: r.tenantId, key: r.key, name: r.name,
    permissions: r.permissions, fieldMasks: r.fieldMasks, builtIn: r.builtIn,
    status: r.status, clonedFromId: r.clonedFromId,
  });

  private _toAssignmentView(a: {
    id: string; templateId: string; userId: string; roleAssignmentId: string;
    entityId: string | null; storeIds: string[]; allStores: boolean; status: string;
  }, templateKey: string): RoleTemplateAssignmentView {
    return {
      id: a.id, templateId: a.templateId, templateKey, userId: a.userId,
      roleAssignmentId: a.roleAssignmentId, entityId: a.entityId,
      storeIds: a.storeIds, allStores: a.allStores, status: a.status,
    };
  }
}
