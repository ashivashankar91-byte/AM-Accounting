/**
 * S032 — Recurring Journal Templates. Covers BR032-1 (balanced + shape-valid
 * at save), BR032-3/4 (generation via the certified S214 draft path,
 * idempotent per template+period — AC032-1/2), BR032-5/BLK-22 (auto-reverse
 * draft created at the original's post time, dated the following period —
 * AC032-3), BR032-6/BLK-24 (period-end-date convention + absolute period-
 * control refusal — AC032-4), and the AC032-5 partial-batch result panel.
 *
 * Mirrors post.test.ts's integration style: a real DraftService + real
 * PostingService wired to one in-memory fake Prisma, so generate()/post()/
 * handlePosted() are exercised end-to-end exactly as the route layer chains
 * them, not mocked apart.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { DraftService } from '../src/application/draft-service';
import { PostingService } from '../src/application/posting-service';
import {
  RecurringTemplateService,
  TemplateLineValidationError,
  TemplateUnbalancedError,
  DuplicateTemplateCodeError,
  RtSourceNotBootstrappedError,
  PeriodNotEligibleError,
  TemplatePeriodNotFoundError,
} from '../src/application/recurring-template-service';

const TENANT = 'tenant-kunes';
const OTHER_TENANT = 'tenant-other';
const ENTITY = 'e1';

const ACCOUNTS = [
  { id: 'a-rent-exp', tenantId: TENANT, entityId: ENTITY, accountNumber: '61000', type: 'EXPENSE', normalBalance: 'DR', postable: true, status: 'ACTIVE', balance: 0 },
  { id: 'a-prepaid', tenantId: TENANT, entityId: ENTITY, accountNumber: '14000', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE', balance: 0 },
  { id: 'a-inactive', tenantId: TENANT, entityId: ENTITY, accountNumber: '99999', type: 'EXPENSE', normalBalance: 'DR', postable: true, status: 'INACTIVE', balance: 0 },
];

const SOURCES: Record<string, any> = {
  RT: { code: 'RT', sourceClass: 'MANUAL', status: 'ACTIVE' },
};

const P1 = { id: 'p1', tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, periodNumber: 1, code: '2026-01', status: 'OPEN', adjustmentsOnly: false, endDate: new Date('2026-01-31'), hasPostings: false };
const P2 = { id: 'p2', tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, periodNumber: 2, code: '2026-02', status: 'OPEN', adjustmentsOnly: false, endDate: new Date('2026-02-28'), hasPostings: false };
const P_FUTURE = { id: 'p3', tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, periodNumber: 3, code: '2026-03', status: 'FUTURE', adjustmentsOnly: false, endDate: new Date('2026-03-31'), hasPostings: false };
const P_CLOSED = { id: 'p4', tenantId: TENANT, entityId: ENTITY, fiscalYear: 2026, periodNumber: 4, code: '2026-04', status: 'SOFT_CLOSED', adjustmentsOnly: false, endDate: new Date('2026-04-30'), hasPostings: false };

function makePrisma() {
  const templates: any[] = [];
  const templateLines: any[] = [];
  const generations: any[] = [];
  const drafts: any[] = [];
  const revisions: any[] = [];
  const entries: any[] = [];
  const lines: any[] = [];
  const snaps: any[] = [];
  const outbox: any[] = [];
  const audits: any[] = [];
  const accounts = ACCOUNTS.map((a) => ({ ...a }));
  const periods = [{ ...P1 }, { ...P2 }, { ...P_FUTURE }, { ...P_CLOSED }];

  const applyIncrement = (current: number, patch: any) =>
    patch && typeof patch === 'object' && 'increment' in patch ? current + patch.increment : patch;

  const prisma: any = {
    _templates: templates,
    _templateLines: templateLines,
    _generations: generations,
    _drafts: drafts,
    _entries: entries,
    _outbox: outbox,
    _audits: audits,

    recurringJournalTemplate: {
      create: async ({ data }: any) => (templates.push({ ...data }), { ...data }),
      // update/findFirst/findMany are assigned below (need `withLines`/live-row increment handling).
      update: async () => { throw new Error('not wired yet'); },
      findUnique: async ({ where }: any) => {
        if (where.tenantId_entityId_code) {
          const { tenantId, entityId, code } = where.tenantId_entityId_code;
          return templates.find((t) => t.tenantId === tenantId && t.entityId === entityId && t.code === code) ?? null;
        }
        return templates.find((t) => t.id === where.id) ?? null;
      },
      findFirst: async () => { throw new Error('not wired yet'); },
      findMany: async () => { throw new Error('not wired yet'); },
    },
    recurringJournalTemplateLine: {
      createMany: async ({ data }: any) => (templateLines.push(...data), { count: data.length }),
      deleteMany: async ({ where }: any) => {
        const before = templateLines.length;
        for (let i = templateLines.length - 1; i >= 0; i--) {
          if (templateLines[i].templateId === where.templateId) templateLines.splice(i, 1);
        }
        return { count: before - templateLines.length };
      },
    },
    recurringTemplateGeneration: {
      create: async ({ data }: any) => (generations.push({ ...data }), { ...data }),
      update: async ({ where, data }: any) => {
        const g = generations.find((x) => x.id === where.id);
        Object.assign(g, data);
        return { ...g };
      },
      findUnique: async ({ where }: any) => {
        if (where.tenantId_templateId_periodId) {
          const { tenantId, templateId, periodId } = where.tenantId_templateId_periodId;
          return generations.find((g) => g.tenantId === tenantId && g.templateId === templateId && g.periodId === periodId) ?? null;
        }
        if (where.tenantId_draftId) {
          const { tenantId, draftId } = where.tenantId_draftId;
          return generations.find((g) => g.tenantId === tenantId && g.draftId === draftId) ?? null;
        }
        return null;
      },
    },
    manualJeDraft: {
      create: async ({ data }: any) => (drafts.push({ ...data }), { ...data }),
      update: async ({ where, data }: any) => {
        const d = drafts.find((x) => x.id === where.id);
        Object.assign(d, data);
        return { ...d };
      },
      findFirst: async ({ where }: any) => {
        const d = drafts.find((x) => x.id === where.id && x.tenantId === where.tenantId);
        return d ? { ...d } : null;
      },
      findMany: async ({ where }: any) => drafts.filter((x) => x.tenantId === where.tenantId).map((x) => ({ ...x })),
    },
    manualJeDraftRevision: { create: async ({ data }: any) => (revisions.push({ ...data }), { ...data }) },
    attachment: { create: async ({ data }: any) => data, findMany: async () => [] },
    journalEntry: {
      findUnique: async ({ where }: any) => {
        if (where.tenantId_idempotencyKey) {
          const { tenantId, idempotencyKey } = where.tenantId_idempotencyKey;
          return entries.find((e) => e.tenantId === tenantId && e.idempotencyKey === idempotencyKey) ?? null;
        }
        return entries.find((e) => e.id === where.id) ?? null;
      },
      create: async ({ data }: any) => (entries.push(data), data),
    },
    journalLine: { create: async ({ data }: any) => (lines.push(data), data) },
    balanceSnapshot: { create: async ({ data }: any) => (snaps.push(data), data) },
    glAccount: {
      findFirst: async ({ where }: any) =>
        accounts.find((a) => a.id === where.id && a.tenantId === where.tenantId && a.entityId === where.entityId) ?? null,
      findMany: async ({ where }: any) =>
        accounts.filter((a) => a.tenantId === where.tenantId && a.entityId === where.entityId && where.id.in.includes(a.id)),
      update: async ({ where, data }: any) => {
        const a = accounts.find((x) => x.id === where.id);
        if (data.balance !== undefined) a.balance = applyIncrement(a.balance, data.balance);
        if (data.hasPostings !== undefined) a.hasPostings = data.hasPostings;
        if (data.version !== undefined) a.version = applyIncrement(a.version ?? 1, data.version);
        return a;
      },
    },
    fiscalPeriod: {
      findUnique: async ({ where }: any) => periods.find((p) => p.id === where.id) ?? null,
      findMany: async ({ where }: any) => periods.filter((p) => p.tenantId === where.tenantId && p.entityId === where.entityId),
      update: async ({ where, data }: any) => {
        const p = periods.find((x) => x.id === where.id);
        if (p) Object.assign(p, data);
        return p;
      },
    },
    journalSource: { findUnique: async ({ where }: any) => SOURCES[where.tenantId_code?.code] ?? null },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    $executeRawUnsafe: async () => undefined,
    $transaction: async (fn: any) => fn(prisma),
  };

  function withLines(t: any) {
    return { ...t, lines: templateLines.filter((l) => l.templateId === t.id).sort((a, b) => a.lineIndex - b.lineIndex) };
  }

  // recurringJournalTemplate.update needs the live row for `version: {increment:1}` — patch properly.
  prisma.recurringJournalTemplate.update = async ({ where, data }: any) => {
    const t = templates.find((x) => x.id === where.id);
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as any)) {
        t[k] = (t[k] ?? 0) + (v as any).increment;
      } else {
        t[k] = v;
      }
    }
    return { ...t };
  };
  prisma.recurringJournalTemplate.findMany = async ({ where }: any) =>
    templates
      .filter((t) => t.tenantId === where.tenantId)
      .filter((t) => (where.entityId ? t.entityId === where.entityId : true))
      .filter((t) => (where.active !== undefined ? t.active === where.active : true))
      .filter((t) => (where.id?.in ? where.id.in.includes(t.id) : true))
      .map(withLines);
  prisma.recurringJournalTemplate.findFirst = async ({ where }: any) => {
    const t = templates.find((x) => x.id === where.id && x.tenantId === where.tenantId);
    return t ? withLines(t) : null;
  };

  return prisma;
}

function fakeFiscal() {
  return {
    resolve: async (_t: string, _e: string, date: string) => {
      const match = [P1, P2, P_FUTURE, P_CLOSED].find((p) => p.endDate.toISOString().slice(0, 10) === date);
      if (!match) throw new Error('no period for date');
      return match;
    },
  };
}

function fakeSequence() {
  let n = 0;
  return {
    allocate: async ({ periodCode }: any) => {
      n += 1;
      return { journalNumber: `RT-${periodCode}-${String(n).padStart(6, '0')}`, seq: n, sourceCode: 'RT', entityId: ENTITY, periodCode };
    },
    logGap: async () => undefined,
  };
}

function setup() {
  container.reset();
  const prisma = makePrisma();
  const events = { publish: async () => undefined };
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.registerInstance('FiscalCalendarService', fakeFiscal() as any);
  container.registerInstance('SequenceService', fakeSequence() as any);
  // S011 — DraftService/PostingService now depend on AnalysisCodeService;
  // unused by these S032 tests (no line ever carries an analysisTags array
  // here), registered only so the DI graph resolves.
  container.registerInstance('AnalysisCodeService', {
    loadValidationContext: async () => ({ types: new Map(), values: new Map() }),
  } as any);
  container.register('PostingService', { useClass: PostingService });
  container.registerInstance('ConfigService', { resolve: async () => ({ value: 'direct' }) } as any);
  container.register('DraftService', { useClass: DraftService });
  container.register('RecurringTemplateService', { useClass: RecurringTemplateService });
  return {
    svc: container.resolve<RecurringTemplateService>('RecurringTemplateService'),
    draft: container.resolve<DraftService>('DraftService'),
    prisma,
  };
}

const actor = { tenantId: TENANT, userId: 'alice' };
const draftActor = { tenantId: TENANT, userId: 'alice', canViewAll: true };

const balancedLines = [
  { accountId: 'a-rent-exp', accountNumber: '61000', storeId: '01', deptCode: 'ADM', dr: 1500, cr: 0, memo: 'Rent expense' },
  { accountId: 'a-prepaid', accountNumber: '14000', storeId: '01', dr: 0, cr: 1500, memo: 'Prepaid rent draw-down' },
];

async function mkTemplate(svc: RecurringTemplateService, overrides: any = {}) {
  return svc.create(
    TENANT,
    { entityId: ENTITY, code: overrides.code ?? 'RENT-01', name: overrides.name ?? 'Monthly Rent', lines: overrides.lines ?? balancedLines, autoReverse: overrides.autoReverse ?? false },
    actor,
  );
}

describe('RecurringTemplateService.create — BR032-1', () => {
  it('creates a balanced template with the dedicated RT source (BLK-20)', async () => {
    const { svc, prisma } = setup();
    const t = await mkTemplate(svc);
    expect(t.sourceCode).toBe('RT');
    expect(t.active).toBe(true);
    expect(t.version).toBe(1);
    expect(prisma._templates).toHaveLength(1);
    expect(prisma._templateLines).toHaveLength(2);
  });

  it('422s an unbalanced template (never saved)', async () => {
    const { svc, prisma } = setup();
    await expect(
      mkTemplate(svc, { lines: [
        { accountId: 'a-rent-exp', accountNumber: '61000', storeId: '01', dr: 1500, cr: 0 },
        { accountId: 'a-prepaid', accountNumber: '14000', storeId: '01', dr: 0, cr: 1000 },
      ] }),
    ).rejects.toBeInstanceOf(TemplateUnbalancedError);
    expect(prisma._templates).toHaveLength(0);
  });

  it('422s a template with fewer than 2 lines', async () => {
    const { svc } = setup();
    await expect(
      mkTemplate(svc, { lines: [{ accountId: 'a-rent-exp', accountNumber: '61000', storeId: '01', dr: 100 }] }),
    ).rejects.toBeInstanceOf(TemplateLineValidationError);
  });

  it('409s a duplicate code within the same entity', async () => {
    const { svc } = setup();
    await mkTemplate(svc);
    await expect(mkTemplate(svc)).rejects.toBeInstanceOf(DuplicateTemplateCodeError);
  });

  it('503s when the RT source has not been bootstrapped for the tenant', async () => {
    const { svc, prisma } = setup();
    prisma.journalSource.findUnique = async () => null;
    await expect(mkTemplate(svc)).rejects.toBeInstanceOf(RtSourceNotBootstrappedError);
  });
});

describe('RecurringTemplateService.generate — BR032-3/4/6 (AC032-1/2/4)', () => {
  it('AC032-1: generates one DRAFT via the S214 path, linked to the template, totals equal the template', async () => {
    const { svc, prisma } = setup();
    const t = await mkTemplate(svc);

    const result = await svc.generate(TENANT, { entityId: ENTITY, periodId: 'p1' }, actor);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].draftId).toBeTruthy();
    expect(result.results[0].idempotent).toBe(false);

    const draft = prisma._drafts.find((d: any) => d.id === result.results[0].draftId);
    expect(draft.generatedFromTemplateId).toBe(t.id);
    expect(draft.generationBatchId).toBe(result.batchId);
    expect(draft.sourceCode).toBe('RT');
    expect(draft.entryDate.toISOString().slice(0, 10)).toBe('2026-01-31'); // BLK-24: period END date
    const totalDr = draft.lines.reduce((s: number, l: any) => s + Number(l.dr ?? 0), 0);
    const totalCr = draft.lines.reduce((s: number, l: any) => s + Number(l.cr ?? 0), 0);
    expect(totalDr).toBe(1500);
    expect(totalCr).toBe(1500);

    expect(prisma._generations).toHaveLength(1);
    expect(prisma._generations[0].templateVersion).toBe(t.version);
  });

  it('AC032-2: generating twice for the same template+period is idempotent — no duplicate draft', async () => {
    const { svc, prisma } = setup();
    await mkTemplate(svc);

    const first = await svc.generate(TENANT, { entityId: ENTITY, periodId: 'p1' }, actor);
    const second = await svc.generate(TENANT, { entityId: ENTITY, periodId: 'p1' }, actor);

    expect(second.results[0].idempotent).toBe(true);
    expect(second.results[0].draftId).toBe(first.results[0].draftId);
    expect(prisma._drafts).toHaveLength(1);
    expect(prisma._generations).toHaveLength(1);
  });

  it('AC032-4: refuses generation into a FUTURE period (not yet open)', async () => {
    const { svc } = setup();
    await mkTemplate(svc);
    await expect(svc.generate(TENANT, { entityId: ENTITY, periodId: 'p3' }, actor)).rejects.toBeInstanceOf(PeriodNotEligibleError);
  });

  it('AC032-4: refuses generation into a SOFT_CLOSED period, whole call, no drafts created', async () => {
    const { svc, prisma } = setup();
    await mkTemplate(svc);
    await expect(svc.generate(TENANT, { entityId: ENTITY, periodId: 'p4' }, actor)).rejects.toBeInstanceOf(PeriodNotEligibleError);
    expect(prisma._drafts).toHaveLength(0);
  });

  it('AC032-5: an inactive account on one template errors that template by name; the other still succeeds', async () => {
    const { svc, prisma } = setup();
    await mkTemplate(svc, { code: 'GOOD-01' });
    await mkTemplate(svc, {
      code: 'BAD-01',
      lines: [
        { accountId: 'a-inactive', accountNumber: '99999', storeId: '01', dr: 200, cr: 0 },
        { accountId: 'a-prepaid', accountNumber: '14000', storeId: '01', dr: 0, cr: 200 },
      ],
    });

    const result = await svc.generate(TENANT, { entityId: ENTITY, periodId: 'p1' }, actor);

    expect(result.results).toHaveLength(2);
    const good = result.results.find((r) => r.templateCode === 'GOOD-01')!;
    const bad = result.results.find((r) => r.templateCode === 'BAD-01')!;
    expect(good.draftId).toBeTruthy();
    expect(good.error).toBeUndefined();
    expect(bad.draftId).toBeUndefined();
    expect(bad.error?.code).toBe('INACTIVE_ACCOUNT');
    expect(prisma._drafts).toHaveLength(1); // only the good one
  });

  it('tenant isolation: a foreign tenant cannot generate against another tenant\'s period', async () => {
    const { svc } = setup();
    await mkTemplate(svc);
    // The fiscal period row belongs to TENANT; a foreign tenant's call 404s
    // rather than ever reaching (and leaking) TENANT's templates.
    await expect(
      svc.generate(OTHER_TENANT, { entityId: ENTITY, periodId: 'p1' }, { tenantId: OTHER_TENANT, userId: 'x' }),
    ).rejects.toBeInstanceOf(TemplatePeriodNotFoundError);
  });
});

describe('RecurringTemplateService.handlePosted — BR032-5/BLK-22 (AC032-3)', () => {
  it('creates a reversal DRAFT dated the following period when the autoReverse original posts', async () => {
    const { svc, draft, prisma } = setup();
    await mkTemplate(svc, { autoReverse: true });

    const gen = await svc.generate(TENANT, { entityId: ENTITY, periodId: 'p1' }, actor);
    const draftId = gen.results[0].draftId!;

    const posted = await draft.postDraft(draftId, draftActor);
    expect(posted.status).toBe('POSTED_LINKED');

    const outcome: any = await svc.handlePosted(TENANT, draftId, posted.journalId, posted.journalNumber, actor);
    expect(outcome.reversalDraftId).toBeTruthy();

    const reversalDraft = prisma._drafts.find((d: any) => d.id === outcome.reversalDraftId);
    expect(reversalDraft.entryDate.toISOString().slice(0, 10)).toBe('2026-02-28'); // following period's end date
    expect(reversalDraft.reversalOfJournalId).toBe(posted.journalId);
    expect(reversalDraft.sourceCode).toBe('RT');

    // Mirrored (DR<->CR swapped) vs the original template lines.
    const totalDr = reversalDraft.lines.reduce((s: number, l: any) => s + Number(l.dr ?? 0), 0);
    const totalCr = reversalDraft.lines.reduce((s: number, l: any) => s + Number(l.cr ?? 0), 0);
    expect(totalDr).toBe(1500); // was cr on the original prepaid line
    expect(totalCr).toBe(1500);

    // Posting the reversal remains a manual human action — handlePosted never posts it.
    expect(reversalDraft.status).toBe('DRAFT');

    // Idempotent: calling handlePosted again is a no-op (same reversal draft, not a second one).
    const again: any = await svc.handlePosted(TENANT, draftId, posted.journalId, posted.journalNumber, actor);
    expect(again.reversalDraftId).toBe(outcome.reversalDraftId);
    expect(again.alreadyExisted).toBe(true);
    expect(prisma._drafts.filter((d: any) => d.reversalOfJournalId === posted.journalId)).toHaveLength(1);
  });

  it('is a no-op for an ordinary (non-template) draft', async () => {
    const { draft, svc } = setup();
    const d = await draft.create({ tenantId: TENANT, preparer: 'alice', entityId: ENTITY, entryDate: '2026-01-31', sourceCode: 'RT', lines: balancedLines });
    await draft.validate(d.id, draftActor);
    const posted = await draft.postDraft(d.id, draftActor);
    const outcome = await svc.handlePosted(TENANT, d.id, posted.journalId, posted.journalNumber, actor);
    expect(outcome).toBeNull();
  });

  it('is a no-op when the template is not autoReverse', async () => {
    const { svc, draft } = setup();
    await mkTemplate(svc, { autoReverse: false });
    const gen = await svc.generate(TENANT, { entityId: ENTITY, periodId: 'p1' }, actor);
    const posted = await draft.postDraft(gen.results[0].draftId!, draftActor);
    const outcome = await svc.handlePosted(TENANT, gen.results[0].draftId!, posted.journalId, posted.journalNumber, actor);
    expect(outcome).toBeNull();
  });
});
