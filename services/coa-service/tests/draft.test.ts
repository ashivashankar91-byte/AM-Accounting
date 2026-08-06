/**
 * S214 — Draft Manual JE tests. In-memory fake Prisma + fake IEventPublisher via
 * tsyringe. Covers BR214-1 (save ANY state without validation), reload fidelity,
 * BR214-2 visibility matrix, BR214-3 edit-history retention, BR214-4 attachment
 * admission, and every §9 4xx/409 path with a named test.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import {
  DraftService,
  DraftNotFoundError,
  DraftForbiddenError,
  DraftNotEditableError,
  AttachmentRejectedError,
} from '../src/application/draft-service';

const TENANT = 'tenant-kunes';

function makePrisma() {
  const drafts: any[] = [];
  const revisions: any[] = [];
  const attachments: any[] = [];
  const outbox: any[] = [];
  const audits: any[] = [];

  const prisma: any = {
    _drafts: drafts,
    _revisions: revisions,
    _attachments: attachments,
    _outbox: outbox,
    _audits: audits,
    manualJeDraft: {
      create: async ({ data }: any) => (drafts.push({ ...data }), { ...data }),
      update: async ({ where, data }: any) => {
        const d = drafts.find((x) => x.id === where.id);
        if (!d) throw new Error('not found');
        Object.assign(d, data);
        return { ...d };
      },
      findFirst: async ({ where }: any) => {
        const d = drafts.find((x) => x.id === where.id && x.tenantId === where.tenantId);
        return d ? { ...d } : null;
      },
      findMany: async ({ where }: any) =>
        drafts
          .filter((x) => x.tenantId === where.tenantId)
          .filter((x) => (where.preparer ? x.preparer === where.preparer : true))
          .map((x) => ({ ...x })),
    },
    manualJeDraftRevision: {
      create: async ({ data }: any) => (revisions.push({ ...data }), { ...data }),
    },
    attachment: {
      create: async ({ data }: any) => (attachments.push({ ...data }), { ...data }),
      findMany: async ({ where }: any) =>
        attachments.filter((a) => a.tenantId === where.tenantId && a.draftId === where.draftId).map((a) => ({ ...a })),
    },
    coaOutboxEvent: { create: async ({ data }: any) => (outbox.push(data), data) },
    auditOutboxEvent: { create: async ({ data }: any) => (audits.push(data), data) },
    $executeRawUnsafe: async () => undefined,
    $transaction: async (fn: any) => fn(prisma),
  };
  return prisma;
}

function setup() {
  container.reset();
  const prisma = makePrisma();
  const events = { published: [] as any[], publish: async (e: any) => void (events.published as any[]).push(e) };
  container.registerInstance('PrismaClient', prisma as any);
  container.registerInstance('IEventPublisher', events as any);
  container.registerInstance('PostingService', {} as any); // unused by these tests (validate lives in validate.test.ts)
  container.registerInstance('ConfigService', { resolve: async () => ({ value: 'direct' }) } as any); // unused here (post lives in post.test.ts)
  container.registerInstance('AnalysisCodeService', {
    loadValidationContext: async () => ({ types: new Map(), values: new Map() }),
  } as any); // unused by these tests (tag-evaluator parity is covered in validate.test.ts)
  container.register('DraftService', { useClass: DraftService });
  return { svc: container.resolve<DraftService>('DraftService'), prisma, events };
}

const alice = { tenantId: TENANT, userId: 'alice', canViewAll: false };
const bob = { tenantId: TENANT, userId: 'bob', canViewAll: false };
const admin = { tenantId: TENANT, userId: 'admin', canViewAll: true };

describe('DraftService.create — BR214-1 save any state', () => {
  it('saves a completely empty draft (no date, no source, no lines) without validation', async () => {
    const { svc, prisma } = setup();
    const d = await svc.create({ tenantId: TENANT, preparer: 'alice' });
    expect(d.status).toBe('DRAFT');
    expect(d.version).toBe(1);
    expect(prisma._drafts).toHaveLength(1);
    expect(prisma._revisions).toHaveLength(1);
    expect(prisma._outbox[0].eventType).toBe('acct.je.draft.created');
    expect(prisma._audits[0].action).toBe('DRAFT_CREATED');
  });

  it('saves a half-finished draft (one lopsided line, unbalanced) — posting rules do NOT apply', async () => {
    const { svc } = setup();
    const d = await svc.create({
      tenantId: TENANT,
      preparer: 'alice',
      entryDate: '2026-01-15',
      sourceCode: 'GJ',
      lines: [{ accountId: 'a-cash', storeId: '01', dr: 100 }], // only a debit, no balancing credit
    });
    expect(d.status).toBe('DRAFT');
  });
});

describe('DraftService.get — BR214-1 reload fidelity', () => {
  it('reloads a draft with faithful lines and attachments', async () => {
    const { svc } = setup();
    const created = await svc.create({
      tenantId: TENANT,
      preparer: 'alice',
      entryDate: '2026-01-15',
      sourceCode: 'GJ',
      memo: 'rent accrual',
      lines: [
        { accountId: 'a-cash', storeId: '01', dr: 250.55 },
        { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 250.55 },
      ],
    });
    const reloaded = await svc.get(created.id, alice);
    expect(reloaded.memo).toBe('rent accrual');
    expect(reloaded.lines).toHaveLength(2);
    expect(reloaded.lines[0].dr).toBe(250.55);
    expect(reloaded.lines[1].deptCode).toBe('SVC');
    expect(reloaded.attachments).toEqual([]);
  });

  // S011 — a draft's per-line analysisTags are opaque JSON at draft time
  // (BR214-1: save in ANY state, no registry validation until post); this
  // only proves faithful save/reload roundtrip, not tag validity.
  it('reloads a draft carrying line-level analysisTags exactly as saved (S011)', async () => {
    const { svc } = setup();
    const created = await svc.create({
      tenantId: TENANT,
      preparer: 'alice',
      entryDate: '2026-01-15',
      sourceCode: 'GJ',
      lines: [
        { accountId: 'a-cash', storeId: '01', dr: 100, analysisTags: [{ typeId: 't-project', valueId: 'v-alpha' }] },
        { accountId: 'a-rev', storeId: '01', deptCode: 'SVC', cr: 100 },
      ],
    });
    const reloaded = await svc.get(created.id, alice);
    expect(reloaded.lines[0].analysisTags).toEqual([{ typeId: 't-project', valueId: 'v-alpha' }]);
    expect(reloaded.lines[1].analysisTags).toBeNull();
  });
});

describe('DraftService.update — BR214-3 edit history retained', () => {
  it('increments version and appends a revision snapshot on each edit', async () => {
    const { svc, prisma } = setup();
    const created = await svc.create({ tenantId: TENANT, preparer: 'alice', memo: 'v1' });
    await svc.update(created.id, { memo: 'v2' }, alice);
    const after = await svc.update(created.id, { memo: 'v3' }, alice);
    expect(after.version).toBe(3);
    expect(prisma._revisions).toHaveLength(3);
    expect(prisma._revisions.map((r: any) => r.version)).toEqual([1, 2, 3]);
    expect(prisma._outbox.filter((e: any) => e.eventType === 'acct.je.draft.updated')).toHaveLength(2);
  });

  it('rejects editing a non-DRAFT draft with 409 (DraftNotEditableError)', async () => {
    const { svc, prisma } = setup();
    const created = await svc.create({ tenantId: TENANT, preparer: 'alice' });
    prisma._drafts[0].status = 'POSTED_LINKED';
    await expect(svc.update(created.id, { memo: 'x' }, alice)).rejects.toBeInstanceOf(DraftNotEditableError);
  });
});

describe('DraftService — BR214-2 visibility matrix', () => {
  it("another preparer cannot see a draft without view_all (403)", async () => {
    const { svc } = setup();
    const created = await svc.create({ tenantId: TENANT, preparer: 'alice' });
    await expect(svc.get(created.id, bob)).rejects.toBeInstanceOf(DraftForbiddenError);
  });

  it('a view_all caller can see another preparer\'s draft', async () => {
    const { svc } = setup();
    const created = await svc.create({ tenantId: TENANT, preparer: 'alice' });
    const seen = await svc.get(created.id, admin);
    expect(seen.id).toBe(created.id);
  });

  it('list is scoped to the preparer unless view_all', async () => {
    const { svc } = setup();
    await svc.create({ tenantId: TENANT, preparer: 'alice' });
    await svc.create({ tenantId: TENANT, preparer: 'bob' });
    expect(await svc.list(alice)).toHaveLength(1);
    expect(await svc.list(admin)).toHaveLength(2);
  });

  it('a missing draft returns 404 (DraftNotFoundError)', async () => {
    const { svc } = setup();
    await expect(svc.get('does-not-exist', alice)).rejects.toBeInstanceOf(DraftNotFoundError);
  });
});

describe('DraftService.addAttachment — BR214-4 admission', () => {
  it('binds a valid PDF attachment', async () => {
    const { svc, prisma } = setup();
    const created = await svc.create({ tenantId: TENANT, preparer: 'alice' });
    const att = await svc.addAttachment(created.id, { fileName: 'backup.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }, alice);
    expect(att.fileName).toBe('backup.pdf');
    expect(att.sizeBytes).toBe(1024);
    expect(prisma._attachments).toHaveLength(1);
  });

  it('rejects a disallowed MIME type (422)', async () => {
    const { svc } = setup();
    const created = await svc.create({ tenantId: TENANT, preparer: 'alice' });
    await expect(
      svc.addAttachment(created.id, { fileName: 'evil.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 }, alice),
    ).rejects.toBeInstanceOf(AttachmentRejectedError);
  });

  it('rejects an oversize attachment > 25MB (422)', async () => {
    const { svc } = setup();
    const created = await svc.create({ tenantId: TENANT, preparer: 'alice' });
    await expect(
      svc.addAttachment(created.id, { fileName: 'huge.pdf', mimeType: 'application/pdf', sizeBytes: 26214401 }, alice),
    ).rejects.toBeInstanceOf(AttachmentRejectedError);
  });
});
