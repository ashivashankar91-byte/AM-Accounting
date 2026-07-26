import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { container } from 'tsyringe';
import {
  DraftService,
  DraftForbiddenError,
  DraftReverseOnlyError,
  DraftVoidReasonRequiredError,
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
          .filter((x) => (where.status?.not ? x.status !== where.status.not : true))
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
  container.registerInstance('PostingService', {} as any);
  container.registerInstance('ConfigService', { resolve: async () => ({ value: 'direct' }) } as any);
  container.register('DraftService', { useClass: DraftService });
  return { svc: container.resolve<DraftService>('DraftService'), prisma, events };
}

const alice = { tenantId: TENANT, userId: 'alice', canViewAll: false, canVoidOwn: true, canVoidAny: false };
const bob = { tenantId: TENANT, userId: 'bob', canViewAll: false, canVoidOwn: true, canVoidAny: false };
const admin = { tenantId: TENANT, userId: 'admin', canViewAll: true, canVoidOwn: true, canVoidAny: true };
const controllerNoAny = { tenantId: TENANT, userId: 'controller', canViewAll: true, canVoidOwn: true, canVoidAny: false };

async function mkDraft(svc: DraftService, preparer: string, extra: any = {}) {
  return svc.create({ tenantId: TENANT, preparer, entryDate: '2026-01-15', sourceCode: 'GJ', lines: [], ...extra });
}

describe('DraftService.voidDraft — S219 acceptance criteria', () => {
  it('BR219-1: voids a draft via soft-delete status transition and writes event + audit', async () => {
    const { svc, prisma, events } = setup();
    const created = await mkDraft(svc, 'alice');

    const res = await svc.voidDraft(created.id, {}, alice);

    expect(res.status).toBe('VOIDED');
    expect(res.idempotent).toBe(false);
    const row = prisma._drafts.find((d: any) => d.id === created.id);
    expect(row.status).toBe('VOIDED');
    expect(row.voidedAt).toBeTruthy();
    expect(prisma._outbox.some((e: any) => e.eventType === 'je.draft.voided' && e.aggregateId === created.id)).toBe(true);
    expect(prisma._audits.some((a: any) => a.action === 'DRAFT_VOIDED' && a.docId === created.id)).toBe(true);
    expect(events.published.some((e: any) => e.type === 'je.draft.voided')).toBe(true);
  });

  it('Given already voided draft Then idempotent 200-equivalent outcome', async () => {
    const { svc } = setup();
    const created = await mkDraft(svc, 'alice');
    await svc.voidDraft(created.id, {}, alice);

    const res = await svc.voidDraft(created.id, {}, alice);
    expect(res).toEqual({ draftId: created.id, status: 'VOIDED', idempotent: true });
  });

  it('BR219-2: posted draft void attempt is 409 reverse only', async () => {
    const { svc, prisma } = setup();
    const created = await mkDraft(svc, 'alice');
    prisma._drafts.find((d: any) => d.id === created.id).status = 'POSTED_LINKED';

    await expect(svc.voidDraft(created.id, {}, alice)).rejects.toBeInstanceOf(DraftReverseOnlyError);
  });

  it('BR219-3: admin-style void of another preparer requires reason', async () => {
    const { svc } = setup();
    const created = await mkDraft(svc, 'alice');

    await expect(svc.voidDraft(created.id, { reason: '   ' }, admin)).rejects.toBeInstanceOf(DraftVoidReasonRequiredError);
  });

  it('BR219-3: admin-style void of another preparer succeeds with reason', async () => {
    const { svc, prisma } = setup();
    const created = await mkDraft(svc, 'alice');

    const res = await svc.voidDraft(created.id, { reason: 'duplicate scratch draft' }, admin);
    expect(res.status).toBe('VOIDED');
    const row = prisma._drafts.find((d: any) => d.id === created.id);
    expect(row.voidReason).toBe('duplicate scratch draft');
  });

  it('caller without .any cannot void another preparer draft (403)', async () => {
    const { svc } = setup();
    const created = await mkDraft(svc, 'alice');

    await expect(svc.voidDraft(created.id, { reason: 'x' }, controllerNoAny)).rejects.toBeInstanceOf(DraftForbiddenError);
  });

  it('own-draft void requires je.draft.void', async () => {
    const { svc } = setup();
    const created = await mkDraft(svc, 'alice');
    const noOwn = { ...alice, canVoidOwn: false };

    await expect(svc.voidDraft(created.id, {}, noOwn)).rejects.toBeInstanceOf(DraftForbiddenError);
  });

  it('worklist excludes VOIDED drafts', async () => {
    const { svc } = setup();
    const mine = await mkDraft(svc, 'alice', { memo: 'mine' });
    const yours = await mkDraft(svc, 'bob', { memo: 'yours' });

    await svc.voidDraft(mine.id, {}, alice);

    const mineList = await svc.list(alice);
    expect(mineList).toHaveLength(0);

    const adminList = await svc.list(admin);
    expect(adminList.map((d: any) => d.id)).toEqual([yours.id]);
  });

  it('tenant scoping: cannot void draft from another tenant', async () => {
    const { svc } = setup();
    const created = await mkDraft(svc, 'alice');

    await expect(svc.voidDraft(created.id, {}, { ...alice, tenantId: 'tenant-other' })).rejects.toMatchObject({ status: 404 });
  });

  it('own-draft void does not require a reason', async () => {
    const { svc, prisma } = setup();
    const created = await mkDraft(svc, 'alice');
    await svc.voidDraft(created.id, { reason: null }, alice);

    const row = prisma._drafts.find((d: any) => d.id === created.id);
    expect(row.voidReason).toBeNull();
  });
});
