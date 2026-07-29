import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import {
  DraftLineInput,
  AttachmentInput,
  admitAttachment,
  normalizeLine,
} from '../domain/draft';
import { PostingService } from './posting-service';
import { ConfigService } from './config-service';
import { AnalysisCodeService } from './analysis-code-service';
import { evaluate, PostingHeaderInput, PostingLineInput } from '../domain/journal-posting';
import { validateLineTags } from '../domain/analysis-code';

// ── Errors ───────────────────────────────────────────────────────────────────

export class DraftInputError extends Error {
  readonly status = 400;
  readonly code = 'DRAFT_INPUT_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'DraftInputError';
  }
}

export class DraftNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'DRAFT_NOT_FOUND';
  constructor(id: string) {
    super(`Draft ${id} not found`);
    this.name = 'DraftNotFoundError';
  }
}

/** BR214-2 — a preparer cannot see/edit another preparer's draft without view_all. */
export class DraftForbiddenError extends Error {
  readonly status = 403;
  readonly code = 'DRAFT_FORBIDDEN';
  constructor() {
    super('Draft belongs to another preparer and you lack je.draft.view_all');
    this.name = 'DraftForbiddenError';
  }
}

/** Only a DRAFT-status draft is editable; VALIDATED/POSTED_LINKED/VOIDED are not. */
export class DraftNotEditableError extends Error {
  readonly status = 409;
  readonly code = 'DRAFT_NOT_EDITABLE';
  constructor(status: string) {
    super(`Draft is ${status}; only DRAFT-status drafts can be edited`);
    this.name = 'DraftNotEditableError';
  }
}

export class AttachmentRejectedError extends Error {
  readonly status = 422;
  readonly code = 'ATTACHMENT_REJECTED';
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'AttachmentRejectedError';
  }
}

/** S215 — a POSTED_LINKED/VOIDED draft cannot be validated (terminal state). */
export class DraftValidationBlockedError extends Error {
  readonly status = 409;
  readonly code = 'DRAFT_VALIDATION_BLOCKED';
  constructor(status: string) {
    super(`Draft is ${status}; only DRAFT/VALIDATED drafts can be validated`);
    this.name = 'DraftValidationBlockedError';
  }
}

/** S215 — the shared rule engine could not resolve reference data (never silent pass). */
export class DraftEngineUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'RULE_ENGINE_UNAVAILABLE';
  constructor() {
    super('The validation engine is temporarily unavailable; validation was not performed.');
    this.name = 'DraftEngineUnavailableError';
  }
}

/**
 * S216 (BR216-2) — the tenant's je.posting_mode is not `direct`. Direct posting is
 * refused with a forward-compatible routing message; approval routing arrives with
 * S031/R1. This gate is tested now so R1 layers on config, not re-architecture.
 */
export class PostingModeGateError extends Error {
  readonly status = 422;
  readonly code = 'POSTING_MODE_GATE';
  constructor(readonly mode: string) {
    super('routing requires S031');
    this.name = 'PostingModeGateError';
  }
}

/**
 * S216 — a post was attempted on a draft that does not pass the SINGLE rule engine.
 * Validation runs first (§3 negative path) and its failures surface in the same
 * S215 shape so the accountant fixes them the same way.
 */
export class DraftPostValidationError extends Error {
  readonly status = 422;
  readonly code = 'POST_VALIDATION_FAILED';
  constructor(readonly validation: ValidationResult) {
    super('Draft failed validation; posting refused.');
    this.name = 'DraftPostValidationError';
  }
}

/** S219 — posted history cannot be deleted; accountants must reverse instead. */
export class DraftReverseOnlyError extends Error {
  readonly status = 409;
  readonly code = 'REVERSE_ONLY';
  constructor() {
    super('reverse only');
    this.name = 'DraftReverseOnlyError';
  }
}

/** S219 BR219-3 — admin-style voiding of another preparer's draft requires a reason. */
export class DraftVoidReasonRequiredError extends Error {
  readonly status = 422;
  readonly code = 'VOID_REASON_REQUIRED';
  constructor() {
    super('reason is required when voiding another preparer\'s draft');
    this.name = 'DraftVoidReasonRequiredError';
  }
}

/** S008 — only a preparer holding fiscal.je.mark_adjusting may set isAdjusting=true. */
export class AdjustingEntryPermissionError extends Error {
  readonly status = 403;
  readonly code = 'ADJUSTING_ENTRY_FORBIDDEN';
  constructor() {
    super('fiscal.je.mark_adjusting is required to mark a draft as an adjusting entry');
    this.name = 'AdjustingEntryPermissionError';
  }
}

/** S008 — a reason and correction reference are mandatory whenever isAdjusting=true. */
export class AdjustingEntryReasonRequiredError extends Error {
  readonly status = 422;
  readonly code = 'ADJUSTING_ENTRY_REASON_REQUIRED';
  constructor() {
    super('adjustingReason and adjustingCorrectionRef are required when isAdjusting=true');
    this.name = 'AdjustingEntryReasonRequiredError';
  }
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface DraftPayload {
  entityId?: string | null;
  entryDate?: string | null; // YYYY-MM-DD, may be absent (BR214-1)
  sourceCode?: string | null;
  memo?: string | null;
  lines?: DraftLineInput[];
  // S008 — per-draft adjusting-entry attribute (not inferred from the
  // period). Setting isAdjusting=true requires actor.canMarkAdjusting and a
  // mandatory reason + correction reference (PO decision).
  isAdjusting?: boolean | null;
  adjustingReason?: string | null;
  adjustingCorrectionRef?: string | null;
}

export interface SaveDraftDTO extends DraftPayload {
  tenantId: string;
  preparer: string;
  canMarkAdjusting?: boolean;
  // S032 — additive, optional linkage set only by RecurringTemplateService's
  // generate()/handlePosted() paths. Undefined for every hand-typed draft;
  // behavior is byte-identical to pre-S032 when omitted.
  generatedFromTemplateId?: string | null;
  generationBatchId?: string | null;
  reversalOfJournalId?: string | null;
}

export interface DraftActor {
  tenantId: string;
  userId: string;
  canViewAll: boolean;
  canVoidOwn?: boolean;
  canVoidAny?: boolean;
  // S008 — resolved from a real fiscal.je.mark_adjusting check at the route
  // layer (draft-routes.ts actorOf()), same pattern as canViewAll/canVoidAny.
  canMarkAdjusting?: boolean;
}

/** S215 validation outcome — same shape §9 mandates; deltas come from the shared engine. */
export interface ValidationResult {
  pass: boolean;
  errors: { lineIndex?: number; rule: string; message: string; field?: string }[];
  deltaDr: number;
  deltaCr: number;
}

/** S216 — the outcome of posting a draft through the S013 door. */
export interface PostDraftResult {
  journalId: string;
  journalNumber: string;
  periodCode: string;
  status: string; // POSTED_LINKED
  idempotent: boolean;
}

export interface VoidDraftResult {
  draftId: string;
  status: string; // VOIDED
  idempotent: boolean;
}

@injectable()
export class DraftService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('PostingService') private readonly posting: PostingService,
    @inject('ConfigService') private readonly config: ConfigService,
    @inject('AnalysisCodeService') private readonly analysisCodes: AnalysisCodeService,
  ) {}

  /** BR214-1 — save a draft in ANY state (no validation on save). */
  async create(dto: SaveDraftDTO): Promise<any> {
    if (!dto.tenantId) throw new DraftInputError('tenantId is required');
    if (!dto.preparer) throw new DraftInputError('preparer is required');
    this.assertAdjustingAllowed(dto, dto.canMarkAdjusting ?? false);

    const id = crypto.randomUUID();
    const lines = (dto.lines ?? []).map(normalizeLine);

    const draft = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, dto.tenantId);
      const created = await tx.manualJeDraft.create({
        data: {
          id,
          tenantId: dto.tenantId,
          entityId: dto.entityId ?? null,
          preparer: dto.preparer,
          status: 'DRAFT',
          entryDate: dto.entryDate ? new Date(dto.entryDate) : null,
          sourceCode: dto.sourceCode ?? null,
          memo: dto.memo ?? null,
          lines: lines as any,
          version: 1,
          isAdjusting: dto.isAdjusting ?? false,
          adjustingReason: dto.adjustingReason ?? null,
          adjustingCorrectionRef: dto.adjustingCorrectionRef ?? null,
          generatedFromTemplateId: dto.generatedFromTemplateId ?? null,
          generationBatchId: dto.generationBatchId ?? null,
          reversalOfJournalId: dto.reversalOfJournalId ?? null,
        },
      });
      if (dto.isAdjusting) {
        await this.writeAttestation(tx, dto.tenantId, id, dto.preparer, dto.adjustingReason!, dto.adjustingCorrectionRef ?? null);
      }
      await tx.manualJeDraftRevision.create({
        data: {
          id: crypto.randomUUID(),
          draftId: id,
          tenantId: dto.tenantId,
          version: 1,
          editor: dto.preparer,
          snapshot: this.snapshot(created) as any,
        },
      });
      await this.writeEvent(tx, dto.tenantId, id, 'acct.je.draft.created', {
        draftId: id,
        preparer: dto.preparer,
      });
      await this.writeAudit(tx, dto.tenantId, id, 'DRAFT_CREATED', null, this.snapshot(created), dto.preparer);
      return created;
    });

    await this.publishBestEffort('acct.je.draft.created', dto.tenantId, id, { draftId: id, preparer: dto.preparer });
    return draft;
  }

  /** BR214-1 — full-fidelity replace of an editable draft; retains history (BR214-3).
   *  An edit to a VALIDATED draft resets it to DRAFT and clears the prior validation
   *  (S215 — "revalidated on edit"). S008: changing isAdjusting/adjustingReason also
   *  falls under this same "any edit resets to DRAFT" rule — no special-casing
   *  needed, since update() already unconditionally resets validation below. */
  async update(id: string, payload: DraftPayload, actor: DraftActor): Promise<any> {
    const existing = await this.load(id, actor);
    if (existing.status !== 'DRAFT' && existing.status !== 'VALIDATED') {
      throw new DraftNotEditableError(existing.status);
    }

    const lines = (payload.lines ?? (existing.lines as DraftLineInput[]) ?? []).map(normalizeLine);
    const nextVersion = existing.version + 1;
    const nextIsAdjusting = payload.isAdjusting !== undefined ? !!payload.isAdjusting : existing.isAdjusting;
    const nextReason = payload.adjustingReason !== undefined ? payload.adjustingReason : existing.adjustingReason;
    const nextCorrectionRef =
      payload.adjustingCorrectionRef !== undefined ? payload.adjustingCorrectionRef : existing.adjustingCorrectionRef;
    this.assertAdjustingAllowed(
      { isAdjusting: nextIsAdjusting, adjustingReason: nextReason, adjustingCorrectionRef: nextCorrectionRef },
      actor.canMarkAdjusting ?? false,
    );

    const updated = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, actor.tenantId);
      const before = this.snapshot(existing);
      const row = await tx.manualJeDraft.update({
        where: { id },
        data: {
          status: 'DRAFT',
          validatedAt: null,
          validationResult: null as any,
          entityId: payload.entityId !== undefined ? payload.entityId : existing.entityId,
          entryDate:
            payload.entryDate !== undefined ? (payload.entryDate ? new Date(payload.entryDate) : null) : existing.entryDate,
          sourceCode: payload.sourceCode !== undefined ? payload.sourceCode : existing.sourceCode,
          memo: payload.memo !== undefined ? payload.memo : existing.memo,
          lines: lines as any,
          version: nextVersion,
          isAdjusting: nextIsAdjusting,
          adjustingReason: nextReason,
          adjustingCorrectionRef: nextCorrectionRef,
        },
      });
      if (nextIsAdjusting) {
        await this.writeAttestation(tx, actor.tenantId, id, actor.userId, nextReason!, nextCorrectionRef ?? null);
      }
      await tx.manualJeDraftRevision.create({
        data: {
          id: crypto.randomUUID(),
          draftId: id,
          tenantId: actor.tenantId,
          version: nextVersion,
          editor: actor.userId,
          snapshot: this.snapshot(row) as any,
        },
      });
      await this.writeEvent(tx, actor.tenantId, id, 'acct.je.draft.updated', {
        draftId: id,
        preparer: existing.preparer,
        editor: actor.userId,
        version: nextVersion,
      });
      await this.writeAudit(tx, actor.tenantId, id, 'DRAFT_UPDATED', before, this.snapshot(row), actor.userId);
      return row;
    });

    await this.publishBestEffort('acct.je.draft.updated', actor.tenantId, id, {
      draftId: id,
      preparer: existing.preparer,
      editor: actor.userId,
      version: nextVersion,
    });
    return updated;
  }

  /** Full-fidelity reload (BR214-1) with attachments; visibility enforced (BR214-2). */
  async get(id: string, actor: DraftActor): Promise<any> {
    const draft = await this.load(id, actor);
    const attachments = await this.prisma.attachment.findMany({
      where: { tenantId: actor.tenantId, draftId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { ...draft, attachments: attachments.map((a: any) => ({ ...a, sizeBytes: Number(a.sizeBytes) })) };
  }

  /** BR214-2 — list scoped to the preparer unless the caller has view_all. */
  async list(actor: DraftActor): Promise<any[]> {
    return this.prisma.manualJeDraft.findMany({
      where: {
        tenantId: actor.tenantId,
        status: { not: 'VOIDED' },
        ...(actor.canViewAll ? {} : { preparer: actor.userId }),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** BR214-4 — bind an attachment to a draft (basic upload; R1 hardening). */
  async addAttachment(id: string, input: AttachmentInput, actor: DraftActor): Promise<any> {
    const draft = await this.load(id, actor);
    if (draft.status === 'VOIDED') throw new DraftNotEditableError(draft.status);

    const rejection = admitAttachment(input);
    if (rejection) throw new AttachmentRejectedError(rejection.field, rejection.diagnostic);

    const attId = crypto.randomUUID();
    const created = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, actor.tenantId);
      const row = await tx.attachment.create({
        data: {
          id: attId,
          tenantId: actor.tenantId,
          draftId: id,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: BigInt(Math.trunc(input.sizeBytes)),
          uploadedBy: actor.userId,
        },
      });
      await this.writeAudit(
        tx,
        actor.tenantId,
        id,
        'DRAFT_ATTACHMENT_ADDED',
        null,
        { attachmentId: attId, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
        actor.userId,
      );
      return row;
    });
    return { ...created, sizeBytes: Number(created.sizeBytes) };
  }

  /**
   * S215 — on-demand validation against the SINGLE S013 rule engine (BR215-1).
   * There is no second engine: this resolves reference data with
   * PostingService.resolveContext and runs the SAME evaluate() the post path uses,
   * so a validate-pass can never post-fail (BR215-2). Reference-data resolution
   * failure raises 503 (never a silent pass). Missing/wrong data flows to the
   * evaluator as ordinary BR013-x violations — identical to posting.
   */
  async validate(id: string, actor: DraftActor): Promise<ValidationResult> {
    const draft = await this.load(id, actor);
    if (draft.status === 'POSTED_LINKED' || draft.status === 'VOIDED') {
      throw new DraftValidationBlockedError(draft.status);
    }

    const header: PostingHeaderInput = {
      entityId: draft.entityId ?? '',
      date: draft.entryDate instanceof Date ? draft.entryDate.toISOString().slice(0, 10) : (draft.entryDate ?? ''),
      sourceCode: draft.sourceCode ?? '',
      memo: draft.memo ?? null,
      idempotencyKey: `validate:${id}`,
      isAdjusting: draft.isAdjusting ?? false,
    };
    const lines: PostingLineInput[] = ((draft.lines as any[]) ?? []).map((l) => ({
      accountId: l.accountId ?? '',
      storeId: l.storeId ?? '',
      deptCode: l.deptCode ?? null,
      controlNumber: l.controlNumber ?? null,
      applyNumber: l.applyNumber ?? null,
      dr: l.dr ?? null,
      cr: l.cr ?? null,
      memo: l.memo ?? null,
      // S011 P1-F1 — carry tags into validation too (see below): they are still
      // NEVER passed to evaluate() (BR011-3 — tags never affect posting math,
      // balancing, or the S013 gate), only to the separate tag evaluator so
      // Validate and Post share the exact same tag rules (BR215-2 parity).
      analysisTags: l.analysisTags ?? null,
    }));

    let evalResult;
    try {
      const ctx = await this.posting.resolveContext(
        { tenantId: actor.tenantId, entityId: header.entityId, date: header.date, sourceCode: header.sourceCode, lines },
        'MANUAL',
      );
      evalResult = evaluate(header, lines, ctx);
    } catch {
      throw new DraftEngineUnavailableError(); // BR215 negative — blocking, never silent pass
    }

    // S011 P1-F1 — evaluate analysis tags with the SAME evaluator (validateLineTags)
    // that PostingService.post uses, so a draft that passes Validate cannot later
    // fail Post on tag data that hasn't changed since (BR215-2 parity extended to
    // BR011-1/BR011-2/BR011-4). Fail-closed: unknown, inactive, mismatched, over-cap
    // or duplicate-type tags are surfaced here, before Post is ever attempted.
    const tagCtx = await this.analysisCodes.loadValidationContext(actor.tenantId);
    const tagViolations = lines.flatMap((line, i) => validateLineTags(line.analysisTags ?? undefined, tagCtx, i));

    const result: ValidationResult = {
      pass: evalResult.pass && tagViolations.length === 0,
      errors: [
        ...evalResult.violations.map((v) => ({
          ...(v.lineIndex !== undefined ? { lineIndex: v.lineIndex } : {}),
          rule: v.rule,
          message: v.diagnostic,
          ...(v.field !== undefined ? { field: v.field } : {}),
        })),
        ...tagViolations.map((v) => ({
          ...(v.lineIndex !== undefined ? { lineIndex: v.lineIndex } : {}),
          rule: v.rule,
          message: v.message,
        })),
      ],
      deltaDr: evalResult.deltaDr,
      deltaCr: evalResult.deltaCr,
    };

    // validationState UNCHECKED->PASS|FAIL: a clean pass advances to VALIDATED; a
    // fail keeps DRAFT so the accountant can keep fixing (demo: fix-live-until-green).
    const nextStatus = result.pass ? 'VALIDATED' : 'DRAFT';
    await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, actor.tenantId);
      const before = this.snapshot(draft);
      const row = await tx.manualJeDraft.update({
        where: { id },
        data: {
          status: nextStatus,
          validatedAt: new Date(),
          validationResult: { ...result, validatedAt: new Date().toISOString() } as any,
        },
      });
      await this.writeAudit(tx, actor.tenantId, id, 'DRAFT_VALIDATED', before, this.snapshot(row), actor.userId);
    });

    return result;
  }

  /**
   * S216 — the deliberate Post action. Moves a draft through the ONE posting door
   * (PostingService.post = the S013 engine) and links the draft to its immutable
   * journal. There is no AI gate and no auto-approve here (prohibited §7): posting
   * is attributed to the authenticated user (BR216-3) and gated only by the
   * je.posting_mode tenant config (BR216-2).
   *
   * Order of operations:
   *  1. Idempotent short-circuit — an already POSTED_LINKED draft returns its journal.
   *  2. Terminal guard — a VOIDED draft cannot post (409).
   *  3. Mode gate (BR216-2) — non-`direct` posting_mode refuses with 'routing requires S031'.
   *  4. Validate-first (§3 negative) — run the SINGLE engine; failures surface as S215.
   *  5. Post atomically (BR216-1) via PostingService.post with draftId back-ref +
   *     postedBy = authenticated user; the post tx also emits acct.je.posted.
   *  6. Link the draft -> journal (status POSTED_LINKED) + DRAFT_POSTED audit.
   */
  async postDraft(id: string, actor: DraftActor): Promise<PostDraftResult> {
    const draft = await this.load(id, actor);

    // (1) Idempotent — already posted: return the existing linkage, do not re-post.
    if (draft.status === 'POSTED_LINKED') {
      return {
        journalId: draft.postedJournalId,
        journalNumber: draft.postedJournalNumber,
        periodCode: '',
        status: 'POSTED_LINKED',
        idempotent: true,
      };
    }
    // (2) A voided draft is terminal — reverse the posted journal instead (S218).
    if (draft.status === 'VOIDED') throw new DraftValidationBlockedError(draft.status);

    // (3) BR216-2 mode gate (forward-compat). Resolved at ENTITY scope where set.
    const mode = await this.config.resolve({
      tenantId: actor.tenantId,
      key: 'je.posting_mode',
      entityId: draft.entityId ?? undefined,
    });
    if ((mode.value ?? 'direct').toLowerCase() !== 'direct') {
      throw new PostingModeGateError(mode.value);
    }

    // (4) Validate-first through the SINGLE engine; a fail blocks posting and is
    //     rendered in the S215 shape. (This also advances status to VALIDATED on pass.)
    const validation = await this.validate(id, actor);
    if (!validation.pass) throw new DraftPostValidationError(validation);

    // Reload post-validate so the header/lines reflect the just-validated draft.
    const fresh = await this.load(id, actor);
    const date =
      fresh.entryDate instanceof Date ? fresh.entryDate.toISOString().slice(0, 10) : (fresh.entryDate ?? '');
    const lines: PostingLineInput[] = ((fresh.lines as any[]) ?? []).map((l) => ({
      accountId: l.accountId ?? '',
      storeId: l.storeId ?? '',
      deptCode: l.deptCode ?? null,
      controlNumber: l.controlNumber ?? null,
      applyNumber: l.applyNumber ?? null,
      dr: l.dr ?? null,
      cr: l.cr ?? null,
      memo: l.memo ?? null,
      // S011 — carries tags saved on the draft (any state, BR214-1) through to
      // the S013 door for fail-closed validation + persistence at post time.
      analysisTags: l.analysisTags ?? null,
    }));

    // (5) BR216-1 — atomic post through the S013 door; idempotent by draft id so a
    //     retry after a link failure returns the same journal (self-healing link).
    const posted = await this.posting.post({
      tenantId: actor.tenantId,
      entityId: fresh.entityId ?? '',
      date,
      sourceCode: fresh.sourceCode ?? '',
      memo: fresh.memo ?? null,
      idempotencyKey: `draft-post:${id}`,
      callerClass: 'MANUAL',
      postedBy: actor.userId, // BR216-3 poster identity = authenticated user
      draftId: id,
      isAdjusting: fresh.isAdjusting ?? false,
      adjustingReason: fresh.adjustingReason ?? null,
      adjustingCorrectionRef: fresh.adjustingCorrectionRef ?? null,
      // S032/BLK-22 — a draft created as an auto-reverse counterpart carries
      // reversalOfJournalId; forwarding it here reuses S218's certified
      // mirrored-linkage semantics on post instead of inventing a second one.
      // Undefined for every ordinary draft (byte-identical prior behavior).
      reversalOf: (fresh as any).reversalOfJournalId ?? null,
      lines,
    });

    // (6) Link the draft to its journal + audit (before/after images §11).
    await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, actor.tenantId);
      const before = this.snapshot(fresh);
      const row = await tx.manualJeDraft.update({
        where: { id },
        data: {
          status: 'POSTED_LINKED',
          postedJournalId: posted.id,
          postedJournalNumber: posted.journalNumber,
        },
      });
      await this.writeAudit(tx, actor.tenantId, id, 'DRAFT_POSTED', before, this.snapshot(row), actor.userId);
    });

    return {
      journalId: posted.id,
      journalNumber: posted.journalNumber,
      periodCode: posted.periodCode,
      status: 'POSTED_LINKED',
      idempotent: posted.idempotent,
    };
  }

  /**
   * S219 — void an unposted draft with a soft-delete transition and full audit trail.
   * - BR219-1: only drafts are voidable; status moves to VOIDED (idempotent).
   * - BR219-2: posted history cannot be voided (409 reverse only).
   * - BR219-3: voiding another preparer's draft requires .any permission + reason.
   */
  async voidDraft(id: string, dto: { reason?: string | null }, actor: DraftActor): Promise<VoidDraftResult> {
    const draft = await this.prisma.manualJeDraft.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!draft) throw new DraftNotFoundError(id);

    const isOwn = draft.preparer === actor.userId;
    if (isOwn) {
      if (!actor.canVoidOwn) throw new DraftForbiddenError();
    } else {
      if (!actor.canVoidAny) throw new DraftForbiddenError();
      const reasonForAny = (dto.reason ?? '').trim();
      if (!reasonForAny) throw new DraftVoidReasonRequiredError();
    }

    if (draft.status === 'VOIDED') {
      return { draftId: id, status: 'VOIDED', idempotent: true };
    }
    if (draft.status === 'POSTED_LINKED') {
      throw new DraftReverseOnlyError();
    }

    const reason = (dto.reason ?? '').trim() || null;

    await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, actor.tenantId);
      const before = this.snapshot(draft);
      const row = await tx.manualJeDraft.update({
        where: { id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidReason: reason,
        },
      });
      await this.writeEvent(tx, actor.tenantId, id, 'je.draft.voided', {
        draftId: id,
        voidedBy: actor.userId,
        reason: reason ?? undefined,
      });
      await this.writeAudit(tx, actor.tenantId, id, 'DRAFT_VOIDED', before, this.snapshot(row), actor.userId);
    });

    await this.publishBestEffort('je.draft.voided', actor.tenantId, id, {
      draftId: id,
      voidedBy: actor.userId,
      reason: reason ?? undefined,
    });

    return { draftId: id, status: 'VOIDED', idempotent: false };
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private async load(id: string, actor: DraftActor): Promise<any> {
    const draft = await this.prisma.manualJeDraft.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!draft) throw new DraftNotFoundError(id);
    if (draft.preparer !== actor.userId && !actor.canViewAll) throw new DraftForbiddenError();
    return draft;
  }

  /**
   * S008 — enforce the adjusting-entry policy (PO decision): only a preparer
   * holding fiscal.je.mark_adjusting may set isAdjusting=true, and a reason +
   * correction reference are mandatory whenever it is set. Called on every
   * create()/update() so a draft can never carry isAdjusting=true without
   * both a real permission check having passed AND the mandatory fields
   * present — closing the gap before AdjustingEntryAttestation is even written.
   */
  private assertAdjustingAllowed(
    payload: { isAdjusting?: boolean | null; adjustingReason?: string | null; adjustingCorrectionRef?: string | null },
    canMarkAdjusting: boolean,
  ): void {
    if (!payload.isAdjusting) return;
    if (!canMarkAdjusting) throw new AdjustingEntryPermissionError();
    if (!payload.adjustingReason?.trim() || !payload.adjustingCorrectionRef?.trim()) {
      throw new AdjustingEntryReasonRequiredError();
    }
  }

  /**
   * S008 — records the same-database attestation the enforce_period_postable()
   * DB trigger verifies at posting time (see
   * 20260728010000_s008_period_close_control). Written via the SECURITY
   * DEFINER record_adjusting_attestation() function — amacc_app itself has no
   * direct INSERT/UPDATE/DELETE on adjusting_entry_attestation (same
   * hardening pattern as fiscal_period_transition). Executed inside the same
   * transaction as the draft save, so a failure here rolls back the draft
   * save too (an isAdjusting=true draft can never be persisted without its
   * attestation, or vice versa).
   */
  private async writeAttestation(
    tx: any,
    tenantId: string,
    draftId: string,
    attestedBy: string,
    reason: string,
    correctionRef: string | null,
  ): Promise<void> {
    await tx.$executeRawUnsafe(
      `SELECT record_adjusting_attestation($1, $2, $3, $4, $5)`,
      tenantId, draftId, attestedBy, reason, correctionRef,
    );
  }

  private snapshot(d: any) {
    return {
      id: d.id,
      entityId: d.entityId ?? null,
      preparer: d.preparer,
      status: d.status,
      entryDate: d.entryDate instanceof Date ? d.entryDate.toISOString().slice(0, 10) : d.entryDate ?? null,
      sourceCode: d.sourceCode ?? null,
      memo: d.memo ?? null,
      lines: d.lines ?? [],
      voidedAt: d.voidedAt instanceof Date ? d.voidedAt.toISOString() : d.voidedAt ?? null,
      voidReason: d.voidReason ?? null,
      version: d.version,
      isAdjusting: d.isAdjusting ?? false,
      adjustingReason: d.adjustingReason ?? null,
      adjustingCorrectionRef: d.adjustingCorrectionRef ?? null,
      generatedFromTemplateId: d.generatedFromTemplateId ?? null,
      generationBatchId: d.generationBatchId ?? null,
      reversalOfJournalId: d.reversalOfJournalId ?? null,
    };
  }

  private async writeEvent(tx: any, tenantId: string, draftId: string, eventType: string, extra: Record<string, unknown>) {
    await tx.coaOutboxEvent.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        eventType,
        aggregateId: draftId,
        payload: { eventId: crypto.randomUUID(), ...extra, ts: new Date().toISOString(), schemaV: 1 } as any,
      },
    });
  }

  private async writeAudit(
    tx: any,
    tenantId: string,
    draftId: string,
    action: string,
    before: unknown,
    after: unknown,
    actor: string,
  ) {
    await tx.auditOutboxEvent.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        docType: 'MANUAL_JE_DRAFT',
        docId: draftId,
        action,
        before: (before ?? null) as any,
        after: (after ?? null) as any,
        actor,
      },
    });
  }

  private async publishBestEffort(type: string, tenantId: string, draftId: string, extra: Record<string, unknown>) {
    try {
      await this.events.publish({
        type,
        tenantId,
        payload: { eventId: crypto.randomUUID(), ...extra, ts: new Date().toISOString(), schemaV: 1 },
        occurredAt: new Date().toISOString(),
        correlationId: draftId,
      } as any);
    } catch {
      /* outbox row already durable */
    }
  }
}
