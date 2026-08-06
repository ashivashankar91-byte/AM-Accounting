/**
 * S215 — Validate Manual JE. Proves the single-rule-source guarantee (BR215-1):
 * DraftService.validate() runs the SAME PostingService.resolveContext + evaluate()
 * the S013 post path uses. The parity suite (BR215-2) asserts a validate-pass can
 * never post-fail and a validate-reject always post-rejects. Also covers the 503
 * engine-unavailable path (never a silent pass) and the 409 terminal-state guard.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import { DraftService, DraftValidationBlockedError, DraftEngineUnavailableError } from '../src/application/draft-service';
import { PostingService, PostingViolationError, PostingInputError, AnalysisTagViolationError } from '../src/application/posting-service';

const TENANT = 'tenant-kunes';
const ENTITY = 'e1';

const ACCOUNTS = [
  { id: 'a-cash', tenantId: TENANT, entityId: ENTITY, accountNumber: '10000', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE', balance: 0 },
  { id: 'a-rev', tenantId: TENANT, entityId: ENTITY, accountNumber: '49000', type: 'REVENUE', normalBalance: 'CR', postable: true, status: 'ACTIVE', balance: 0 },
  { id: 'a-nonpost', tenantId: TENANT, entityId: ENTITY, accountNumber: '10100', type: 'ASSET', normalBalance: 'DR', postable: false, status: 'ACTIVE', balance: 0 },
];

const SOURCES: Record<string, any> = {
  GJ: { code: 'GJ', sourceClass: 'MANUAL', status: 'ACTIVE' },
  MISC: { code: 'MISC', sourceClass: 'MANUAL', status: 'INACTIVE' },
};

function makePrisma(opts: { breakEngine?: boolean } = {}) {
  const drafts: any[] = [];
  const revisions: any[] = [];
  const entries: any[] = [];
  const lines: any[] = [];
  const tags: any[] = [];
  const snaps: any[] = [];
  const outbox: any[] = [];
  const audits: any[] = [];
  const accounts = ACCOUNTS.map((a) => ({ ...a }));
  const periods: any[] = [{ id: 'p1', hasPostings: false }];
  const applyIncrement = (current: number, patch: any) =>
    patch && typeof patch === 'object' && 'increment' in patch ? current + patch.increment : patch;

  const prisma: any = {
    _drafts: drafts,
    _revisions: revisions,
    _entries: entries,
    _lines: lines,
    _tags: tags,
    _outbox: outbox,
    _audits: audits,
    _accounts: accounts,
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
    journalLineAnalysisTag: {
      createMany: async ({ data }: any) => {
        tags.push(...(data as any[]));
        return { count: data.length };
      },
    },
    balanceSnapshot: { create: async ({ data }: any) => (snaps.push(data), data) },
    glAccount: {
      findMany: async ({ where }: any) => {
        if (opts.breakEngine) throw new Error('db connection lost'); // engine-unavailable
        return accounts.filter((a) => a.tenantId === where.tenantId && a.entityId === where.entityId && where.id.in.includes(a.id));
      },
      update: async ({ where, data }: any) => {
        const a = accounts.find((x) => x.id === where.id);
        if (data.balance !== undefined) a.balance = applyIncrement(a.balance, data.balance);
        if (data.hasPostings !== undefined) a.hasPostings = data.hasPostings;
        if (data.version !== undefined) a.version = applyIncrement(a.version ?? 1, data.version);
        return a;
      },
    },
    fiscalPeriod: { update: async ({ where, data }: any) => { const p = periods.find((x) => x.id === where.id); if (p) Object.assign(p, data); return p; } },
    journalSource: {
      findUnique: async ({ where }: any) => SOURCES[where.tenantId_code?.code] ?? null,
    },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    $executeRawUnsafe: async () => undefined,
    $transaction: async (fn: any) => fn(prisma),
  };
  return prisma;
}

function fakeFiscal() {
  return {
    resolve: async (_t: string, _e: string, date: string) => {
      if (date === '2026-01-15') return { id: 'p1', code: '2026-01', status: 'OPEN', adjustmentsOnly: false };
      if (date === '2026-03-15') return { id: 'p3', code: '2026-03', status: 'FUTURE', adjustmentsOnly: false };
      throw new Error('no period for date');
    },
  };
}

function fakeSequence() {
  let n = 0;
  return {
    allocate: async () => (n += 1, { journalNumber: `GJ-2026-01-${String(n).padStart(6, '0')}`, seq: n, sourceCode: 'GJ', entityId: ENTITY, periodCode: '2026-01' }),
    logGap: async () => undefined,
  };
}

function fakeAnalysisCodes(opts: { types?: { id: string; isActive: boolean }[]; values?: { id: string; typeId: string; isActive: boolean }[] } = {}) {
  return {
    loadValidationContext: async (_tenantId: string) => ({
      types: new Map((opts.types ?? []).map((t) => [t.id, t])),
      values: new Map((opts.values ?? []).map((v) => [v.id, v])),
    }),
  };
}

function setup(opts: { breakEngine?: boolean; analysisTypes?: { id: string; isActive: boolean }[]; analysisValues?: { id: string; typeId: string; isActive: boolean }[] } = {}) {
  container.reset();
  const prisma = makePrisma(opts);
  const events = { publish: async () => undefined };
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.registerInstance('FiscalCalendarService', fakeFiscal() as any);
  container.registerInstance('SequenceService', fakeSequence() as any);
  container.registerInstance('AnalysisCodeService', fakeAnalysisCodes({ types: opts.analysisTypes, values: opts.analysisValues }) as any);
  container.register('PostingService', { useClass: PostingService });
  container.registerInstance('ConfigService', { resolve: async () => ({ value: 'direct' }) } as any); // unused here (post lives in post.test.ts)
  container.register('DraftService', { useClass: DraftService });
  return {
    draft: container.resolve<DraftService>('DraftService'),
    posting: container.resolve<PostingService>('PostingService'),
    prisma,
  };
}

const actor = { tenantId: TENANT, userId: 'alice', canViewAll: false };

const balanced = [
  { accountId: 'a-cash', storeId: '01', dr: 100 },
  { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
];

async function mkDraft(svc: DraftService, payload: any) {
  const d = await svc.create({ tenantId: TENANT, preparer: 'alice', entityId: ENTITY, sourceCode: 'GJ', entryDate: '2026-01-15', ...payload });
  return d.id as string;
}

describe('DraftService.validate — acceptance criteria', () => {
  it('unbalanced draft: pass=false with running delta and per-line BR references', async () => {
    const { draft } = setup();
    const id = await mkDraft(draft, { lines: [
      { accountId: 'a-cash', storeId: '01', dr: 100 },
      { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 90 },
    ] });
    const r = await draft.validate(id, actor);
    expect(r.pass).toBe(false);
    expect(r.errors.some((e) => e.rule.startsWith('BR013'))).toBe(true);
    expect(r.deltaDr).toBe(100);
    expect(r.deltaCr).toBe(90);
  });

  it('closed/future-period date: pass=false with a period error (BR013-2)', async () => {
    const { draft } = setup();
    const id = await mkDraft(draft, { entryDate: '2026-03-15', lines: balanced });
    const r = await draft.validate(id, actor);
    expect(r.pass).toBe(false);
    expect(r.errors.some((e) => e.rule === 'BR013-2')).toBe(true);
  });

  it('non-postable account: pass=false with BR013-4', async () => {
    const { draft } = setup();
    const id = await mkDraft(draft, { lines: [
      { accountId: 'a-nonpost', storeId: '01', dr: 100 },
      { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
    ] });
    const r = await draft.validate(id, actor);
    expect(r.pass).toBe(false);
    expect(r.errors.some((e) => e.rule === 'BR013-4')).toBe(true);
  });

  it('all-clear draft: pass=true and status advances to VALIDATED (ready to post)', async () => {
    const { draft, prisma } = setup();
    const id = await mkDraft(draft, { lines: balanced });
    const r = await draft.validate(id, actor);
    expect(r.pass).toBe(true);
    expect(r.errors).toHaveLength(0);
    const row = prisma._drafts.find((d: any) => d.id === id);
    expect(row.status).toBe('VALIDATED');
    expect(row.validatedAt).toBeInstanceOf(Date);
    expect(prisma._audits.some((a: any) => a.action === 'DRAFT_VALIDATED')).toBe(true);
  });

  it('engine unavailability blocks with 503 — never a silent pass', async () => {
    const { draft } = setup({ breakEngine: true });
    const id = await mkDraft(draft, { lines: balanced });
    await expect(draft.validate(id, actor)).rejects.toBeInstanceOf(DraftEngineUnavailableError);
  });

  it('validating a terminal draft (POSTED_LINKED) → 409', async () => {
    const { draft, prisma } = setup();
    const id = await mkDraft(draft, { lines: balanced });
    prisma._drafts.find((d: any) => d.id === id).status = 'POSTED_LINKED';
    await expect(draft.validate(id, actor)).rejects.toBeInstanceOf(DraftValidationBlockedError);
  });
});

describe('DraftService.validate — edit resets validation (revalidated on edit)', () => {
  it('editing a VALIDATED draft returns it to DRAFT and clears the validation result', async () => {
    const { draft, prisma } = setup();
    const id = await mkDraft(draft, { lines: balanced });
    await draft.validate(id, actor);
    expect(prisma._drafts.find((d: any) => d.id === id).status).toBe('VALIDATED');
    await draft.update(id, { memo: 'tweaked' }, actor);
    const row = prisma._drafts.find((d: any) => d.id === id);
    expect(row.status).toBe('DRAFT');
    expect(row.validationResult).toBeNull();
    expect(row.validatedAt).toBeNull();
  });
});

/**
 * BR215-2 parity suite — for each scenario, validate() and post() MUST agree.
 * A validate-pass ⇒ post succeeds; a validate-reject ⇒ post rejects.
 */
describe('BR215-2 validate<->post parity', () => {
  const scenarios: { name: string; lines: any[]; date?: string; source?: string }[] = [
    { name: 'balanced-valid', lines: balanced },
    { name: 'unbalanced', lines: [
      { accountId: 'a-cash', storeId: '01', dr: 100 },
      { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 90 },
    ] },
    { name: 'future-period', date: '2026-03-15', lines: balanced },
    { name: 'non-postable-account', lines: [
      { accountId: 'a-nonpost', storeId: '01', dr: 100 },
      { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
    ] },
    { name: 'inactive-source', source: 'MISC', lines: balanced },
    { name: 'missing-dept-on-pnl', lines: [
      { accountId: 'a-cash', storeId: '01', dr: 100 },
      { accountId: 'a-rev', storeId: '01', cr: 100 },
    ] },
  ];

  for (const sc of scenarios) {
    it(`parity: ${sc.name}`, async () => {
      // validate path
      const v = setup();
      const id = await mkDraft(v.draft, { entryDate: sc.date ?? '2026-01-15', sourceCode: sc.source ?? 'GJ', lines: sc.lines });
      const validation = await v.draft.validate(id, actor);

      // post path (fresh fixture so side-effects don't interfere)
      const p = setup();
      let postSucceeded = false;
      let postRejected = false;
      try {
        await p.posting.post({
          tenantId: TENANT,
          entityId: ENTITY,
          date: sc.date ?? '2026-01-15',
          sourceCode: sc.source ?? 'GJ',
          idempotencyKey: `parity-${sc.name}`,
          postedBy: 'alice',
          lines: sc.lines,
        });
        postSucceeded = true;
      } catch (err) {
        // Both business violations (422) and input errors (400) are "rejected".
        if (err instanceof PostingViolationError || err instanceof PostingInputError) postRejected = true;
        else throw err;
      }

      // The safety guarantee: validate.pass iff post succeeds.
      expect(validation.pass).toBe(postSucceeded);
      expect(validation.pass).toBe(!postRejected);
    });
  }
});

/**
 * P1-F1 — Validate must evaluate analysis tags with the SAME evaluator Post
 * uses (validateLineTags), so a draft that passes Validate never later fails
 * Post solely because of unchanged analysis-tag data. Fixes the defect where
 * Validate ignored analysisTags entirely and only Post enforced BR011-1/2/4.
 */
describe('P1-F1 — Validate/Post analysis-tag consistency', () => {
  const analysisFixtures = {
    analysisTypes: [{ id: 'type-store', isActive: true }],
    analysisValues: [
      { id: 'value-01', typeId: 'type-store', isActive: true },
      { id: 'value-inactive', typeId: 'type-store', isActive: false },
    ],
  };

  const linesWithTag = (tags: { typeId: string; valueId: string }[]) => [
    { accountId: 'a-cash', storeId: '01', dr: 100, analysisTags: tags },
    { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
  ];

  it('1. valid tags pass Validate and Post', async () => {
    const { draft, posting } = setup(analysisFixtures);
    const lines = linesWithTag([{ typeId: 'type-store', valueId: 'value-01' }]);
    const id = await mkDraft(draft, { lines });
    const r = await draft.validate(id, actor);
    expect(r.pass).toBe(true);
    expect(r.errors).toHaveLength(0);

    // Fresh posting-only fixture to avoid idempotency collisions across scenarios.
    const p2 = setup(analysisFixtures);
    const posted = await p2.posting.post({
      tenantId: TENANT,
      entityId: ENTITY,
      date: '2026-01-15',
      sourceCode: 'GJ',
      idempotencyKey: 'p1-f1-valid-tags',
      postedBy: 'alice',
      lines,
    });
    expect(posted.status).toBe('POSTED');
  });

  it('2. inactive tag fails Validate', async () => {
    const { draft } = setup(analysisFixtures);
    const lines = linesWithTag([{ typeId: 'type-store', valueId: 'value-inactive' }]);
    const id = await mkDraft(draft, { lines });
    const r = await draft.validate(id, actor);
    expect(r.pass).toBe(false);
    expect(r.errors.some((e) => e.rule === 'INACTIVE_VALUE')).toBe(true);
  });

  it('3. unknown tag fails Validate', async () => {
    const { draft } = setup(analysisFixtures);
    const lines = linesWithTag([{ typeId: 'type-store', valueId: 'value-does-not-exist' }]);
    const id = await mkDraft(draft, { lines });
    const r = await draft.validate(id, actor);
    expect(r.pass).toBe(false);
    expect(r.errors.some((e) => e.rule === 'UNKNOWN_VALUE')).toBe(true);
  });

  it('4. more than three tags fails Validate (BLK-13 default cap)', async () => {
    const fourValues = [
      { id: 'v1', typeId: 'type-store', isActive: true },
      { id: 'v2', typeId: 'type-store', isActive: true },
      { id: 'v3', typeId: 'type-store', isActive: true },
      { id: 'v4', typeId: 'type-store', isActive: true },
    ];
    const { draft } = setup({ analysisTypes: [{ id: 'type-store', isActive: true }], analysisValues: fourValues });
    // Distinct fake types so DUPLICATE_TYPE_ON_LINE doesn't mask the cap check.
    const lines = [
      {
        accountId: 'a-cash',
        storeId: '01',
        dr: 100,
        analysisTags: [
          { typeId: 'type-store', valueId: 'v1' },
          { typeId: 'type-store', valueId: 'v2' },
          { typeId: 'type-store', valueId: 'v3' },
          { typeId: 'type-store', valueId: 'v4' },
        ],
      },
      { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
    ];
    const id = await mkDraft(draft, { lines });
    const r = await draft.validate(id, actor);
    expect(r.pass).toBe(false);
    expect(r.errors.some((e) => e.rule === 'TAG_CAP_EXCEEDED')).toBe(true);
  });

  it('5. an unchanged draft that passes Validate also passes the tag portion of Post', async () => {
    const { draft } = setup(analysisFixtures);
    const lines = linesWithTag([{ typeId: 'type-store', valueId: 'value-01' }]);
    const id = await mkDraft(draft, { lines });
    const validation = await draft.validate(id, actor);
    expect(validation.pass).toBe(true);

    // Post the SAME (unchanged) draft against the SAME fixture state — must not
    // throw AnalysisTagViolationError, proving Validate/Post tag-rule parity.
    const posted = await draft.postDraft(id, actor);
    expect(posted.status).toBe('POSTED_LINKED');
  });

  it('bonus: an inactive tag rejected at Validate is also rejected at Post (defense in depth)', async () => {
    const { draft } = setup(analysisFixtures);
    const lines = linesWithTag([{ typeId: 'type-store', valueId: 'value-inactive' }]);
    const id = await mkDraft(draft, { lines });
    const validation = await draft.validate(id, actor);
    expect(validation.pass).toBe(false);

    await expect(draft.postDraft(id, actor)).rejects.toThrow();
  });

  it('bonus: posting directly (bypassing Validate) with an invalid tag still throws AnalysisTagViolationError (backend authoritative)', async () => {
    const { posting } = setup(analysisFixtures);
    const lines = linesWithTag([{ typeId: 'type-store', valueId: 'value-inactive' }]);
    await expect(
      posting.post({
        tenantId: TENANT,
        entityId: ENTITY,
        date: '2026-01-15',
        sourceCode: 'GJ',
        idempotencyKey: 'p1-f1-bypass-validate',
        postedBy: 'alice',
        lines,
      }),
    ).rejects.toBeInstanceOf(AnalysisTagViolationError);
  });
});
