import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { isAutomationIdentity } from '../domain/sod';
import { IAutomationEventPublisher, IAccountMappingClient } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';

const CAPABILITY = 'S118_GAAP_MEMO';

type ScaffoldSection = {
  sectionCode: string;
  heading: string;
  narrative: string;
  sourceRefs: string[];
  sourced: boolean;
};

/**
 * CE-17 S118 — GAAP bridge memo generator.
 *
 * The ceiling is PREPARE_DRAFT and the reason is simple: a memo is an
 * assertion about the entity's accounting, and this service is not qualified
 * to assert. It assembles a scaffold in which every sentence is anchored to a
 * source reference, marks anything unanchored as an open question rather than
 * writing around it, and hands the result to a human editor.
 */
@injectable()
export class GaapBridgeService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IAccountMappingClient') private readonly mapping: IAccountMappingClient,
    private readonly capabilities: AutomationCapabilityService,
  ) {}

  async list(tenantId: string, legalEntityId: string) {
    const items = await this.prisma.gaapBridgeMemo.findMany({
      where: { tenantId, legalEntityId },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }], take: 100,
    });
    return { items, total: items.length };
  }

  async get(tenantId: string, id: string) {
    const memo = await this.prisma.gaapBridgeMemo.findFirst({ where: { tenantId, id } });
    if (!memo) throw new NotConfiguredError(`GAAP bridge memo ${id} does not exist for this tenant.`);
    return memo;
  }

  /**
   * Builds the draft scaffold.
   *
   * Policy differences are pulled from the stories that actually hold them —
   * LIFO elections from S073, chargeback rate adoptions from S091B — so each
   * paragraph carries the record that produced it. A difference with no
   * underlying record is emitted as an unsourced placeholder that a human must
   * either evidence or delete; it is never phrased as a finding.
   */
  async generateDraft(input: {
    tenantId: string; legalEntityId: string; periodYear: number; periodMonth: number;
    s016SnapshotRef?: string | null; actor: string;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);

    const existing = await this.prisma.gaapBridgeMemo.findFirst({
      where: {
        tenantId: input.tenantId, legalEntityId: input.legalEntityId,
        periodYear: input.periodYear, periodMonth: input.periodMonth,
      },
    });
    if (existing?.state === 'FINALIZED') {
      throw new AutomationError(
        'This period\'s memo has been finalized and cannot be regenerated.',
        { statusCode: 409, code: 'MEMO_FINALIZED' },
      );
    }

    const differences: any[] = [];
    const sections: ScaffoldSection[] = [];

    const pools = await this.prisma.lifoPoolDefinition.findMany({
      where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId },
      include: { layers: { where: { approved: true } } },
    });
    for (const pool of pools) {
      const reserve = pool.layers.reduce((s: number, l: any) => s + Number(l.reserveAmount.toString()), 0);
      differences.push({
        differenceCode: `LIFO:${pool.poolCode}`,
        origin: 'S073',
        description: `Inventory is carried on ${pool.methodElection} for pool ${pool.poolCode}; the LIFO reserve is a book-to-tax difference.`,
        amount: reserve.toFixed(2),
        sourceRefs: [pool.electionEvidence, ...pool.layers.map((l: any) => l.indexEvidenceRef)].filter(Boolean),
        sourced: Boolean(pool.electionEvidence),
      });
    }

    const adopted = await this.prisma.chargebackModelOutput.findMany({
      where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, state: 'ADOPTED' },
    });
    for (const model of adopted) {
      differences.push({
        differenceCode: `CHARGEBACK:${model.modelVersion}`,
        origin: 'S091B',
        description: `The chargeback reserve rate of ${model.recommendedRate.toString()} was adopted into configuration ${model.s091ConfigVersion ?? 'unrecorded'} on ${model.adoptedAt?.toISOString().slice(0, 10) ?? 'an unrecorded date'}.`,
        amount: null,
        sourceRefs: [model.id],
        sourced: Boolean(model.s091ConfigVersion && model.adoptedAt),
      });
    }

    const cessions = await this.prisma.cessionStatement.findMany({
      where: { tenantId: input.tenantId, legalEntityId: input.legalEntityId, state: { in: ['APPROVED', 'POSTED'] } },
    });
    for (const c of cessions) {
      differences.push({
        differenceCode: `CESSION:${c.treatyCode}`,
        origin: 'S096',
        description: `Ceded premium and reserves under treaty ${c.treatyCode} per administrator statement dated ${c.statementDate.toISOString().slice(0, 10)}.`,
        amount: (Number(c.premiumCession.toString()) + Number(c.reserveCession.toString())).toFixed(2),
        sourceRefs: [c.statementEvidenceRef],
        sourced: Boolean(c.statementEvidenceRef),
      });
    }

    sections.push({
      sectionCode: 'SCOPE',
      heading: 'Scope and basis',
      narrative: input.s016SnapshotRef
        ? `This memo bridges the statutory basis to GAAP for ${input.periodYear}-${String(input.periodMonth).padStart(2, '0')}, using trial balance snapshot ${input.s016SnapshotRef}.`
        : 'The trial balance snapshot this memo bridges from has not been supplied. An editor must record it before the memo can be finalized.',
      sourceRefs: input.s016SnapshotRef ? [input.s016SnapshotRef] : [],
      sourced: Boolean(input.s016SnapshotRef),
    });

    for (const d of differences) {
      sections.push({
        sectionCode: d.differenceCode,
        heading: d.differenceCode,
        narrative: d.description,
        sourceRefs: d.sourceRefs,
        sourced: d.sourced && d.sourceRefs.length > 0,
      });
    }

    if (differences.length === 0) {
      sections.push({
        sectionCode: 'NO_DIFFERENCES_FOUND',
        heading: 'Policy differences',
        narrative: 'No recorded policy differences were found for this entity and period. This is a statement about what is recorded in this system, not a conclusion that no differences exist.',
        sourceRefs: [],
        sourced: true,
      });
    }

    const mappingComplete = await this.mapping.isMappingComplete(input.tenantId, input.legalEntityId, CAPABILITY);
    const mappingSignal = {
      complete: mappingComplete,
      detail: mappingComplete === null
        ? 'Account mapping completeness could not be determined; the memo records this rather than assuming it.'
        : mappingComplete ? 'Account mapping is complete for this capability.' : 'Account mapping is incomplete for this capability.',
    };
    const unsourced = sections.filter((s) => !s.sourced).map((s) => s.sectionCode);

    const scaffold = {
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      generatedAt: new Date().toISOString(),
      generatedBy: input.actor,
      sections,
      unsourcedSections: unsourced,
      accountMappingStatus: mappingSignal,
      assertionPolicy: 'Every narrative sentence in this scaffold is anchored to a recorded source. Sections listed in unsourcedSections carry no evidence and must be evidenced or removed by a human editor before finalization.',
    };

    const memo = existing
      ? await this.prisma.gaapBridgeMemo.update({
        where: { id: existing.id },
        data: { scaffold: scaffold as any, policyDifferences: differences as any, s016SnapshotRef: input.s016SnapshotRef ?? null, state: 'DRAFT' },
      })
      : await this.prisma.gaapBridgeMemo.create({
        data: {
          tenantId: input.tenantId, legalEntityId: input.legalEntityId,
          periodYear: input.periodYear, periodMonth: input.periodMonth,
          state: 'DRAFT', scaffold: scaffold as any, policyDifferences: differences as any,
          s016SnapshotRef: input.s016SnapshotRef ?? null,
          editorHistory: [{ actor: input.actor, action: 'GENERATED', at: new Date().toISOString() }] as any,
        },
      });

    await this.events.publish(input.tenantId, memo.id, 'automation.gaap_bridge.drafted', {
      periodYear: input.periodYear, periodMonth: input.periodMonth,
      differenceCount: differences.length, unsourcedSectionCount: unsourced.length,
    });
    return memo;
  }

  async edit(input: { tenantId: string; id: string; actor: string; sections: ScaffoldSection[]; note?: string }) {
    const memo = await this.get(input.tenantId, input.id);
    if (memo.state === 'FINALIZED') {
      throw new AutomationError('A finalized memo cannot be edited.', { statusCode: 409, code: 'MEMO_FINALIZED' });
    }
    const scaffold = memo.scaffold as any;
    const merged = { ...scaffold, sections: input.sections, unsourcedSections: input.sections.filter((s) => !s.sourced || s.sourceRefs.length === 0).map((s) => s.sectionCode) };
    const history = [...((memo.editorHistory as any[]) ?? []), { actor: input.actor, action: 'EDITED', note: input.note ?? null, at: new Date().toISOString() }];

    const updated = await this.prisma.gaapBridgeMemo.update({
      where: { id: memo.id },
      data: { scaffold: merged as any, editorHistory: history as any, state: 'UNDER_REVIEW' },
    });
    await this.events.publish(input.tenantId, memo.id, 'automation.gaap_bridge.edited', { actor: input.actor, note: input.note ?? null });
    return updated;
  }

  /**
   * Finalization is a human's signature on a human-edited document. It is
   * refused while any section remains unsourced — that refusal is the whole
   * point of the story.
   */
  async finalize(input: { tenantId: string; id: string; finalizedBy: string }) {
    const memo = await this.get(input.tenantId, input.id);
    if (memo.state === 'FINALIZED') return memo;
    if (isAutomationIdentity(input.finalizedBy)) {
      throw new AutomationError(
        'A GAAP bridge memo must be finalized by a person. Automation prepares drafts; it does not make accounting assertions.',
        { statusCode: 403, code: 'SOD_VIOLATION' },
      );
    }
    const scaffold = memo.scaffold as any;
    const unsourced: string[] = scaffold?.unsourcedSections ?? [];
    if (unsourced.length > 0) {
      throw new AutomationError(
        `This memo still contains ${unsourced.length} unsourced section(s): ${unsourced.join(', ')}. Every assertion must carry a source before finalization.`,
        { statusCode: 422, code: 'UNSOURCED_ASSERTION', details: { unsourcedSections: unsourced } },
      );
    }

    const history = [...((memo.editorHistory as any[]) ?? []), { actor: input.finalizedBy, action: 'FINALIZED', at: new Date().toISOString() }];
    const updated = await this.prisma.gaapBridgeMemo.update({
      where: { id: memo.id },
      data: { state: 'FINALIZED', finalizedBy: input.finalizedBy, finalizedAt: new Date(), editorHistory: history as any },
    });
    await this.events.publish(input.tenantId, memo.id, 'automation.gaap_bridge.finalized', {
      finalizedBy: input.finalizedBy, periodYear: memo.periodYear, periodMonth: memo.periodMonth,
    });
    return updated;
  }
}
