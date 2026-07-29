// S032 — Recurring Journal Templates: registry lifecycle + manual generation.
//
// Hard scope (per pack instruction + PO-ratified BLK-20..24, see CLAUDE.md):
//  - no scheduler: generation is only ever triggered by an explicit generate()
//    call (BLK-21 excluded — no cron/automatic trigger anywhere in this file).
//  - fixed amounts only (BLK-23) — see domain/recurring-template.ts.
//  - the dedicated 'RT' MANUAL source (BLK-20), never GJ/88.
//  - generation creates a DRAFT via the certified S214 path (DraftService) —
//    this class never writes to journal_entry/journal_line directly. It is a
//    *client* of the journal lifecycle, never a second posting path.
//  - BLK-24: generated entries are dated the target period's END date.
//  - BLK-22: an autoReverse template's reversal draft is created when the
//    ORIGINAL generated journal posts (handlePosted, called from the route
//    layer after DraftService.postDraft succeeds — see draft-routes.ts),
//    dated in the following period (end date, same BLK-24 convention).
//    Posting that reversal draft remains a manual human action — this class
//    never calls DraftService.postDraft on it.

import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/coa-client';
import {
  TemplateLineInput,
  isValidTemplateCode,
  isValidTemplateName,
  normalizeTemplateLine,
  validateTemplateLines,
  computeTemplateBalance,
  mirrorTemplateLines,
} from '../domain/recurring-template';
import { eligibility, periodOrder } from '../domain/period-status';
import { DraftService } from './draft-service';

// ── Errors ───────────────────────────────────────────────────────────────────

export class TemplateInputError extends Error {
  readonly status = 400;
  readonly code = 'TEMPLATE_INPUT_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'TemplateInputError';
  }
}

export class TemplateNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'TEMPLATE_NOT_FOUND';
  constructor(id: string) {
    super(`Recurring journal template ${id} not found`);
    this.name = 'TemplateNotFoundError';
  }
}

/** BR032-1 — line-shape violations (missing account/store, bad dr/cr split). */
export class TemplateLineValidationError extends Error {
  readonly status = 422;
  readonly code = 'TEMPLATE_LINE_INVALID';
  constructor(readonly violations: { lineIndex: number; field: string; diagnostic: string }[]) {
    super('Template lines failed validation');
    this.name = 'TemplateLineValidationError';
  }
}

/** BR032-1 — "balanced required at save". */
export class TemplateUnbalancedError extends Error {
  readonly status = 422;
  readonly code = 'TEMPLATE_UNBALANCED';
  constructor(readonly totalDr: number, readonly totalCr: number) {
    super(`Template is not balanced: debits ${totalDr} != credits ${totalCr}`);
    this.name = 'TemplateUnbalancedError';
  }
}

export class DuplicateTemplateCodeError extends Error {
  readonly status = 409;
  readonly code = 'DUPLICATE_TEMPLATE_CODE';
  constructor(code: string) {
    super(`Recurring journal template code "${code}" already exists for this entity`);
    this.name = 'DuplicateTemplateCodeError';
  }
}

/** The dedicated BLK-20 source must be bootstrapped (SourceService.bootstrapReserved) before templates can be created. */
export class RtSourceNotBootstrappedError extends Error {
  readonly status = 503;
  readonly code = 'RT_SOURCE_NOT_BOOTSTRAPPED';
  constructor() {
    super('The RT (Recurring Journal Template) source is not bootstrapped for this tenant');
    this.name = 'RtSourceNotBootstrappedError';
  }
}

export class TemplatePeriodNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'PERIOD_NOT_FOUND';
  constructor(periodId: string) {
    super(`Period ${periodId} not found`);
    this.name = 'TemplatePeriodNotFoundError';
  }
}

/** BR032-6 — generation into a non-postable period is refused absolutely, whole-call (AC032-4). */
export class PeriodNotEligibleError extends Error {
  readonly status = 422;
  readonly code = 'PERIOD_NOT_ELIGIBLE';
  constructor(readonly periodCode: string, readonly periodStatus: string, readonly reason: string) {
    super(`Period ${periodCode} is not eligible for generation: ${reason}`);
    this.name = 'PeriodNotEligibleError';
  }
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface TemplateActor {
  tenantId: string;
  userId: string;
}

export interface SaveTemplateDTO {
  entityId: string;
  code: string;
  name: string;
  description?: string | null;
  autoReverse?: boolean;
  lines: TemplateLineInput[];
}

export interface GenerateDTO {
  entityId: string;
  periodId: string;
  templateIds?: string[] | 'ALL';
}

export interface GenerateResultEntry {
  templateId: string;
  templateCode: string;
  draftId?: string;
  idempotent?: boolean;
  error?: { code: string; message: string; lineIndex?: number; accountId?: string };
}

export interface GenerateResult {
  batchId: string;
  periodCode: string;
  results: GenerateResultEntry[];
}

const RT_SOURCE_CODE = 'RT';

@injectable()
export class RecurringTemplateService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('DraftService') private readonly draftService: DraftService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** BR032-1 — a template must be shape-valid and balanced at save (unlike an S214 draft). */
  async create(tenantId: string, dto: SaveTemplateDTO, actor: TemplateActor) {
    if (!dto.entityId) throw new TemplateInputError('entityId is required');
    const code = typeof dto.code === 'string' ? dto.code.trim().toUpperCase() : dto.code;
    if (!isValidTemplateCode(code)) {
      throw new TemplateInputError('code must be 1-40 uppercase alphanumeric/dash/underscore characters');
    }
    if (!isValidTemplateName(dto.name)) {
      throw new TemplateInputError('name must be 1-120 characters');
    }

    await this.assertRtSourceBootstrapped(tenantId);

    const lines = (dto.lines ?? []).map(normalizeTemplateLine);
    const lineViolations = validateTemplateLines(lines);
    if (lineViolations.length > 0) throw new TemplateLineValidationError(lineViolations);
    const balance = computeTemplateBalance(lines);
    if (!balance.balanced) throw new TemplateUnbalancedError(balance.totalDr, balance.totalCr);

    const existing = await this.prisma.recurringJournalTemplate.findUnique({
      where: { tenantId_entityId_code: { tenantId, entityId: dto.entityId, code } },
    });
    if (existing) throw new DuplicateTemplateCodeError(code);

    const id = crypto.randomUUID();
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.recurringJournalTemplate.create({
        data: {
          id,
          tenantId,
          entityId: dto.entityId,
          code,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          sourceCode: RT_SOURCE_CODE,
          active: true,
          autoReverse: dto.autoReverse === true,
          version: 1,
          actor: actor.userId,
        },
      });
      await tx.recurringJournalTemplateLine.createMany({
        data: lines.map((l, i) => this.lineData(id, tenantId, i, l)),
      });
      await this.audit(tx, tenantId, id, 'CREATE', null, await this.snapshotTx(tx, id), actor.userId);
      return row;
    });

    await this.emit('je.template.created', tenantId, id, actor.userId, { code, name: dto.name });
    return this.get(tenantId, id);
  }

  async list(tenantId: string, entityId?: string, filter?: { active?: boolean }) {
    const templates = await this.prisma.recurringJournalTemplate.findMany({
      where: {
        tenantId,
        ...(entityId ? { entityId } : {}),
        ...(filter?.active !== undefined ? { active: filter.active } : {}),
      },
      orderBy: { code: 'asc' },
      include: { lines: { orderBy: { lineIndex: 'asc' } } },
    });
    return templates.map((t) => this.serialize(t));
  }

  async get(tenantId: string, id: string) {
    const row = await this.load(tenantId, id);
    return this.serialize(row);
  }

  /** BR032-7 — editing bumps version; generations already made never change (stamped with the version at generation time). */
  async update(tenantId: string, id: string, dto: Partial<SaveTemplateDTO>, actor: TemplateActor) {
    const existing = await this.load(tenantId, id);

    const name = dto.name !== undefined ? dto.name : existing.name;
    if (!isValidTemplateName(name)) throw new TemplateInputError('name must be 1-120 characters');

    let lines = (existing.lines as any[]).map((l: any) => ({
      accountId: l.accountId,
      accountNumber: l.accountNumber,
      storeId: l.storeId,
      deptCode: l.deptCode,
      controlNumber: l.controlNumber,
      applyNumber: l.applyNumber,
      dr: Number(l.dr),
      cr: Number(l.cr),
      memo: l.memo,
    })) as TemplateLineInput[];
    if (dto.lines !== undefined) {
      lines = dto.lines.map(normalizeTemplateLine);
      const lineViolations = validateTemplateLines(lines);
      if (lineViolations.length > 0) throw new TemplateLineValidationError(lineViolations);
      const balance = computeTemplateBalance(lines);
      if (!balance.balanced) throw new TemplateUnbalancedError(balance.totalDr, balance.totalCr);
    }

    const before = this.serialize(existing);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.recurringJournalTemplate.update({
        where: { id },
        data: {
          name: name.trim(),
          description: dto.description !== undefined ? dto.description?.trim() || null : existing.description,
          autoReverse: dto.autoReverse !== undefined ? dto.autoReverse : existing.autoReverse,
          version: { increment: 1 },
        },
      });
      if (dto.lines !== undefined) {
        await tx.recurringJournalTemplateLine.deleteMany({ where: { templateId: id } });
        await tx.recurringJournalTemplateLine.createMany({
          data: lines.map((l, i) => this.lineData(id, tenantId, i, l)),
        });
      }
      await this.audit(tx, tenantId, id, 'UPDATE', before, await this.snapshotTx(tx, id), actor.userId);
      return row;
    });

    await this.emit('je.template.updated', tenantId, id, actor.userId, { code: updated.code });
    return this.get(tenantId, id);
  }

  async setActive(tenantId: string, id: string, active: boolean, actor: TemplateActor) {
    const existing = await this.load(tenantId, id);
    if (existing.active === active) return this.serialize(existing);
    const before = this.serialize(existing);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.recurringJournalTemplate.update({ where: { id }, data: { active } });
      await this.audit(tx, tenantId, id, active ? 'ACTIVATE' : 'DEACTIVATE', before, this.serialize({ ...existing, active }), actor.userId);
      return row;
    });
    await this.emit(active ? 'je.template.activated' : 'je.template.deactivated', tenantId, id, actor.userId, { code: updated.code });
    return this.get(tenantId, id);
  }

  // ── Generation (BR032-3/4/6) ─────────────────────────────────────────────

  /**
   * Manual generation ceremony (BLK-21 — the only trigger; no scheduler
   * exists in this codebase). One batchId ties every draft created by this
   * call together. Each template is generated independently — one template's
   * failure never blocks the others (AC032-5 partial-batch result panel).
   */
  async generate(tenantId: string, dto: GenerateDTO, actor: TemplateActor): Promise<GenerateResult> {
    if (!dto.entityId) throw new TemplateInputError('entityId is required');
    if (!dto.periodId) throw new TemplateInputError('periodId is required');

    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: dto.periodId } });
    if (!period || period.tenantId !== tenantId || period.entityId !== dto.entityId) {
      throw new TemplatePeriodNotFoundError(dto.periodId);
    }
    // BR032-6 — the whole call refuses if the target period isn't postable
    // (AC032-4). Reuses the same eligibility rule S013/S215 apply to any
    // draft posting — generation never invents its own period-control logic.
    const e = eligibility(period.status as any);
    if (!e.postable) throw new PeriodNotEligibleError(period.code, period.status, e.reason);

    const templates =
      dto.templateIds === 'ALL' || dto.templateIds === undefined
        ? await this.prisma.recurringJournalTemplate.findMany({
            where: { tenantId, entityId: dto.entityId, active: true },
            include: { lines: { orderBy: { lineIndex: 'asc' } } },
          })
        : await this.prisma.recurringJournalTemplate.findMany({
            where: { tenantId, entityId: dto.entityId, id: { in: dto.templateIds } },
            include: { lines: { orderBy: { lineIndex: 'asc' } } },
          });

    const batchId = crypto.randomUUID();
    const results: GenerateResultEntry[] = [];

    for (const template of templates) {
      try {
        results.push(await this.generateOne(tenantId, template, period, batchId, actor));
      } catch (err: any) {
        results.push({
          templateId: template.id,
          templateCode: template.code,
          error: { code: err?.code ?? 'GENERATION_FAILED', message: err?.message ?? 'Unknown error' },
        });
      }
    }

    await this.audit(this.prisma, tenantId, batchId, 'GENERATE_BATCH', null, {
      batchId,
      periodCode: period.code,
      count: results.length,
      succeeded: results.filter((r) => r.draftId && !r.idempotent).length,
      idempotent: results.filter((r) => r.idempotent).length,
      failed: results.filter((r) => r.error).length,
    }, actor.userId);
    await this.emit('je.template.generated', tenantId, batchId, actor.userId, {
      batchId,
      periodCode: period.code,
      results: results.map((r) => ({ templateId: r.templateId, draftId: r.draftId, error: r.error?.code })),
    });

    return { batchId, periodCode: period.code, results };
  }

  private async generateOne(
    tenantId: string,
    template: any,
    period: any,
    batchId: string,
    actor: TemplateActor,
  ): Promise<GenerateResultEntry> {
    // BR032-4 — idempotent by (template, period): a repeat call returns the
    // original draft, never a duplicate (also DB-enforced by the unique index).
    const existingGen = await this.prisma.recurringTemplateGeneration.findUnique({
      where: { tenantId_templateId_periodId: { tenantId, templateId: template.id, periodId: period.id } },
    });
    if (existingGen) {
      return { templateId: template.id, templateCode: template.code, draftId: existingGen.draftId, idempotent: true };
    }

    if (!template.active) {
      return {
        templateId: template.id,
        templateCode: template.code,
        error: { code: 'TEMPLATE_INACTIVE', message: `Template ${template.code} is inactive` },
      };
    }

    // AC032-5 — a stale/inactive account on one template errors that template
    // by name; the rest of the batch proceeds (thrown here so the caller's
    // per-template try/catch in generate() records it and moves on).
    const lines: any[] = template.lines ?? [];
    for (const line of lines) {
      const account = await this.prisma.glAccount.findFirst({
        where: { id: line.accountId, tenantId, entityId: template.entityId },
      });
      if (!account || account.status !== 'ACTIVE') {
        return {
          templateId: template.id,
          templateCode: template.code,
          error: {
            code: 'INACTIVE_ACCOUNT',
            message: `Account ${line.accountNumber} (line ${line.lineIndex + 1}) is inactive or missing`,
            lineIndex: line.lineIndex,
            accountId: line.accountId,
          },
        };
      }
    }

    // BLK-24 — dated the target period's END date (ratified; SME validation
    // remains an acceptance gate per CLAUDE.md, not a development blocker).
    const entryDate = this.dateOnly(period.endDate);
    const draftLines = lines.map((l) => ({
      accountId: l.accountId,
      accountNumber: l.accountNumber,
      storeId: l.storeId,
      deptCode: l.deptCode,
      controlNumber: l.controlNumber,
      applyNumber: l.applyNumber,
      dr: Number(l.dr),
      cr: Number(l.cr),
      memo: l.memo,
    }));

    const draft = await this.draftService.create({
      tenantId,
      preparer: actor.userId,
      entityId: template.entityId,
      entryDate,
      sourceCode: template.sourceCode,
      memo: `Generated from recurring template ${template.code} — ${template.name} (period ${period.code})`,
      lines: draftLines,
      generatedFromTemplateId: template.id,
      generationBatchId: batchId,
    });

    try {
      await this.prisma.recurringTemplateGeneration.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          templateId: template.id,
          entityId: template.entityId,
          periodId: period.id,
          periodCode: period.code,
          batchId,
          draftId: draft.id,
          templateVersion: template.version,
          generatedBy: actor.userId,
        },
      });
    } catch (err: any) {
      // Concurrent duplicate generate() calls raced — the unique index caught
      // it; return the winner rather than surfacing a spurious failure.
      if (err?.code === 'P2002') {
        const winner = await this.prisma.recurringTemplateGeneration.findUnique({
          where: { tenantId_templateId_periodId: { tenantId, templateId: template.id, periodId: period.id } },
        });
        if (winner) {
          return { templateId: template.id, templateCode: template.code, draftId: winner.draftId, idempotent: true };
        }
      }
      throw err;
    }

    return { templateId: template.id, templateCode: template.code, draftId: draft.id, idempotent: false };
  }

  // ── Auto-reverse (BLK-22) ─────────────────────────────────────────────────

  /**
   * Called by draft-routes.ts right after DraftService.postDraft() succeeds.
   * No-op for any draft not created by generate() (the common case). Errors
   * here never unwind the caller's already-successful post — draft-routes.ts
   * catches and surfaces them alongside the post result (never silent).
   */
  async handlePosted(tenantId: string, draftId: string, journalId: string, journalNumber: string, actor: TemplateActor) {
    const generation = await this.prisma.recurringTemplateGeneration.findUnique({
      where: { tenantId_draftId: { tenantId, draftId } },
    });
    if (!generation) return null;
    if (generation.reversalDraftId) {
      return { reversalDraftId: generation.reversalDraftId, alreadyExisted: true };
    }

    const template = await this.prisma.recurringJournalTemplate.findFirst({
      where: { id: generation.templateId, tenantId },
      include: { lines: { orderBy: { lineIndex: 'asc' } } },
    });
    if (!template || !template.autoReverse) return null;

    const period = await this.prisma.fiscalPeriod.findUnique({ where: { id: generation.periodId } });
    if (!period) return { error: 'ORIGINAL_PERIOD_NOT_FOUND' };

    const nextPeriod = await this.findNextPeriod(tenantId, period.entityId, period.fiscalYear, period.periodNumber);
    if (!nextPeriod) {
      await this.audit(this.prisma, tenantId, generation.id, 'REVERSAL_DRAFT_FAILED', null, {
        reason: 'NO_NEXT_PERIOD',
        afterPeriodCode: period.code,
      }, actor.userId);
      return { error: 'NO_NEXT_PERIOD', message: `No fiscal period follows ${period.code} for this entity yet` };
    }

    const templateLines: TemplateLineInput[] = (template.lines as any[]).map((l) => ({
      accountId: l.accountId,
      accountNumber: l.accountNumber,
      storeId: l.storeId,
      deptCode: l.deptCode,
      controlNumber: l.controlNumber,
      applyNumber: l.applyNumber,
      dr: Number(l.dr),
      cr: Number(l.cr),
      memo: l.memo,
    }));
    const reversedLines = mirrorTemplateLines(templateLines);

    // BLK-22 — dated in the following period; consistent with BLK-24's
    // period-end-date convention (SME validation remains an acceptance gate).
    const entryDate = this.dateOnly(nextPeriod.endDate);
    const reversalDraft = await this.draftService.create({
      tenantId,
      preparer: actor.userId,
      entityId: template.entityId,
      entryDate,
      sourceCode: template.sourceCode,
      memo: `Auto-reversal of recurring template ${template.code} — journal ${journalNumber} (period ${nextPeriod.code})`,
      lines: reversedLines,
      generatedFromTemplateId: template.id,
      generationBatchId: generation.batchId,
      // S218 semantics reused: PostingService.post receives reversalOf when
      // THIS draft is posted (a manual human action) — see draft-service.ts
      // postDraft()'s forwarding of reversalOfJournalId.
      reversalOfJournalId: journalId,
    });

    await this.prisma.recurringTemplateGeneration.update({
      where: { id: generation.id },
      data: { reversalDraftId: reversalDraft.id, reversalPeriodId: nextPeriod.id },
    });
    await this.audit(this.prisma, tenantId, generation.id, 'REVERSAL_DRAFT_CREATED', null, {
      reversalDraftId: reversalDraft.id,
      reversalPeriodCode: nextPeriod.code,
      originalJournalId: journalId,
    }, actor.userId);
    await this.emit('je.template.reversal_draft.created', tenantId, reversalDraft.id, actor.userId, {
      templateId: template.id,
      originalDraftId: draftId,
      originalJournalId: journalId,
      reversalDraftId: reversalDraft.id,
      reversalPeriodCode: nextPeriod.code,
    });

    return { reversalDraftId: reversalDraft.id, reversalPeriodCode: nextPeriod.code, alreadyExisted: false };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async findNextPeriod(tenantId: string, entityId: string, fiscalYear: number, periodNumber: number) {
    const currentKey = periodOrder({ fiscalYear, periodNumber });
    const candidates = await this.prisma.fiscalPeriod.findMany({ where: { tenantId, entityId } });
    const next = candidates
      .filter((p) => periodOrder({ fiscalYear: p.fiscalYear, periodNumber: p.periodNumber }) > currentKey)
      .sort(
        (a, b) =>
          periodOrder({ fiscalYear: a.fiscalYear, periodNumber: a.periodNumber }) -
          periodOrder({ fiscalYear: b.fiscalYear, periodNumber: b.periodNumber }),
      )[0];
    return next ?? null;
  }

  private async assertRtSourceBootstrapped(tenantId: string) {
    const source = await this.prisma.journalSource.findUnique({
      where: { tenantId_code: { tenantId, code: RT_SOURCE_CODE } },
    });
    if (!source || source.status !== 'ACTIVE') throw new RtSourceNotBootstrappedError();
  }

  private async load(tenantId: string, id: string) {
    const row = await this.prisma.recurringJournalTemplate.findFirst({
      where: { id, tenantId },
      include: { lines: { orderBy: { lineIndex: 'asc' } } },
    });
    if (!row) throw new TemplateNotFoundError(id);
    return row;
  }

  private lineData(templateId: string, tenantId: string, lineIndex: number, l: TemplateLineInput) {
    return {
      id: crypto.randomUUID(),
      templateId,
      tenantId,
      lineIndex,
      accountId: l.accountId as string,
      accountNumber: (l.accountNumber ?? '') as string,
      storeId: l.storeId as string,
      deptCode: l.deptCode ?? null,
      controlNumber: l.controlNumber ?? null,
      applyNumber: l.applyNumber ?? null,
      dr: Number(l.dr ?? 0),
      cr: Number(l.cr ?? 0),
      memo: l.memo ?? null,
    };
  }

  private serialize(row: any) {
    return {
      id: row.id,
      entityId: row.entityId,
      code: row.code,
      name: row.name,
      description: row.description ?? null,
      sourceCode: row.sourceCode,
      active: row.active,
      autoReverse: row.autoReverse,
      version: row.version,
      lines: (row.lines ?? []).map((l: any) => ({
        lineIndex: l.lineIndex,
        accountId: l.accountId,
        accountNumber: l.accountNumber,
        storeId: l.storeId,
        deptCode: l.deptCode,
        controlNumber: l.controlNumber,
        applyNumber: l.applyNumber,
        dr: Number(l.dr),
        cr: Number(l.cr),
        memo: l.memo,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async snapshotTx(tx: any, id: string) {
    const row = await tx.recurringJournalTemplate.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineIndex: 'asc' } } },
    });
    return this.serialize(row);
  }

  private dateOnly(d: Date | string): string {
    const iso = d instanceof Date ? d.toISOString() : new Date(d).toISOString();
    return iso.slice(0, 10);
  }

  private async audit(
    tx: Pick<PrismaClient, 'auditOutboxEvent'>,
    tenantId: string,
    docId: string,
    action: string,
    before: unknown,
    after: unknown,
    actor: string,
  ) {
    await tx.auditOutboxEvent.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        docType: 'RECURRING_JOURNAL_TEMPLATE',
        docId,
        action,
        before: (before ?? null) as any,
        after: (after ?? null) as any,
        actor,
      },
    });
  }

  private async emit(type: string, tenantId: string, aggregateId: string, actor: string, extra: Record<string, unknown>) {
    const eventId = crypto.randomUUID();
    const payload = { eventId, ...extra, actor, ts: new Date().toISOString(), schemaV: 1 };
    try {
      await this.prisma.coaOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId, eventType: type, aggregateId, payload: payload as any },
      });
    } catch {
      /* non-fatal */
    }
    try {
      await this.events.publish({ type, tenantId, payload, occurredAt: new Date(), correlationId: eventId } as any);
    } catch {
      /* best-effort */
    }
  }
}
