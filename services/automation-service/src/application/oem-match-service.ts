import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { matchAll, MatchCandidate, MatchSubject } from '../domain/matching-engine';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { assertApproverIsNotAutomation } from '../domain/sod';
import { IAutomationEventPublisher, IOemAdapter } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';

const CAPABILITY = 'S101B_OEM_MATCHER';
const MATCH_VERSION = 'ce17.oem.v1';

/**
 * CE-17 S101B — OEM statement auto-matcher.
 *
 * Deterministic rules run first. Only an exact rule match may be auto-disposed
 * when the capability holds AUTO authority; a scored suggestion always waits
 * for a person. Judgement-class items — short-pays, policy disputes, anything
 * the tenant has marked as requiring interpretation — are never auto-disposed
 * at any authority level, which is why the flag lives on the row rather than
 * in a policy table somebody could relax.
 */
@injectable()
export class OemMatchService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IOemAdapter') private readonly oem: IOemAdapter,
    private readonly capabilities: AutomationCapabilityService,
  ) {}

  async list(tenantId: string, legalEntityId: string, state?: string, sessionId?: string) {
    const items = await this.prisma.oemMatchSuggestion.findMany({
      where: { tenantId, legalEntityId, ...(state ? { state } : {}), ...(sessionId ? { s101aSessionId: sessionId } : {}) },
      orderBy: { createdAt: 'desc' }, take: 300,
    });
    const { signal } = await this.oem.getStatementSession(tenantId, sessionId ?? '');
    return { items, total: items.length, upstreamSignal: signal };
  }

  /**
   * Produces suggestions for an S101A reconciliation session.
   *
   * The automation identity is stamped on every suggestion it creates, and
   * that same identity is refused at disposition time. The refusal is not a
   * configuration; it is the identity comparison itself.
   */
  async suggest(input: {
    tenantId: string; legalEntityId: string; s101aSessionId: string;
    automationIdentity: string;
    statementLines?: { lineRef: string; claimNumber?: string | null; amount: string | number; isJudgmentClass?: boolean }[];
    bookItems?: { id: string; claimNumber?: string | null; amount: string | number }[];
  }) {
    const capability = await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);

    const { signal, session } = await this.oem.getStatementSession(input.tenantId, input.s101aSessionId);
    const statementLines = input.statementLines ?? (session?.lines as any[]) ?? [];
    const bookItems = input.bookItems ?? (session?.bookItems as any[]) ?? [];

    if (statementLines.length === 0) {
      throw new AutomationError(
        signal.status === 'AVAILABLE'
          ? 'The reconciliation session has no statement lines to match.'
          : `OEM statement data is unavailable: ${signal.detail}`,
        { statusCode: 422, code: 'MODEL_OR_RULE_UNAVAILABLE', details: { upstreamSignal: signal } },
      );
    }

    const subjects: MatchSubject[] = statementLines.map((l: any) => ({
      id: String(l.lineRef), amount: String(l.amount), applyNumber: l.claimNumber ?? null, remittanceRef: l.claimNumber ?? null,
    }));
    const candidates: MatchCandidate[] = bookItems.map((b: any) => ({
      id: String(b.id), amount: String(b.amount), documentNumber: b.claimNumber ?? null, reference: b.claimNumber ?? null,
    }));
    const outcomes = matchAll(subjects, candidates);
    const bySubject = new Map(outcomes.map((o) => [o.subjectId, o]));

    const created = [];
    for (const line of statementLines) {
      const outcome = bySubject.get(String((line as any).lineRef));
      const exact = outcome?.matchType === 'EXACT_KEY';
      const judgment = Boolean((line as any).isJudgmentClass);
      const autoDisposable = exact && !judgment && capability.currentAuthority === 'AUTO_EXECUTE_WITHIN_POLICY';

      const suggestion = await this.prisma.oemMatchSuggestion.create({
        data: {
          tenantId: input.tenantId,
          legalEntityId: input.legalEntityId,
          s101aSessionId: input.s101aSessionId,
          claimNumber: (line as any).claimNumber ?? null,
          amount: String((line as any).amount),
          matchType: exact ? 'EXACT_RULE' : 'SCORED_SUGGESTION',
          matchScore: outcome?.score ?? null,
          matchVersion: MATCH_VERSION,
          suggestedDisposition: outcome?.candidateId ?? null,
          automationIdentity: input.automationIdentity,
          isJudgmentClass: judgment,
          state: autoDisposable ? 'ACCEPTED' : 'SUGGESTED',
          ...(autoDisposable ? { disposedBy: input.automationIdentity, disposedAt: new Date() } : {}),
        },
      });
      created.push(suggestion);
    }

    await this.events.publish(input.tenantId, input.s101aSessionId, 'automation.oem.suggestions_created', {
      sessionId: input.s101aSessionId, count: created.length,
      exactRuleMatches: created.filter((c) => c.matchType === 'EXACT_RULE').length,
      autoDisposed: created.filter((c) => c.state === 'ACCEPTED').length,
      judgmentClassHeld: created.filter((c) => c.isJudgmentClass).length,
      authority: capability.currentAuthority,
    });
    return { items: created, total: created.length, upstreamSignal: signal.status === 'AVAILABLE' ? null : signal };
  }

  async dispose(input: { tenantId: string; id: string; decision: 'ACCEPTED' | 'REJECTED' | 'ESCALATED'; actor: string; reason?: string }) {
    const suggestion = await this.prisma.oemMatchSuggestion.findFirst({ where: { tenantId: input.tenantId, id: input.id } });
    if (!suggestion) throw new NotConfiguredError(`OEM match suggestion ${input.id} does not exist for this tenant.`);
    if (!['ACCEPTED', 'REJECTED', 'ESCALATED'].includes(input.decision)) {
      throw new AutomationError('decision must be ACCEPTED, REJECTED or ESCALATED.', { statusCode: 400, code: 'INVALID_DECISION' });
    }
    // The identity that produced the suggestion may not also dispose of it.
    assertApproverIsNotAutomation(input.actor, suggestion.automationIdentity, `${CAPABILITY}:${suggestion.id}`);
    if (suggestion.isJudgmentClass && input.decision === 'ACCEPTED' && !input.reason) {
      throw new AutomationError(
        'A judgement-class item requires a stated reason when accepted.',
        { statusCode: 422, code: 'JUDGMENT_REASON_REQUIRED' },
      );
    }

    const updated = await this.prisma.oemMatchSuggestion.update({
      where: { id: suggestion.id },
      data: { state: input.decision, disposedBy: input.actor, disposedAt: new Date() },
    });
    await this.events.publish(input.tenantId, suggestion.id, 'automation.oem.disposed', {
      decision: input.decision, actor: input.actor, reason: input.reason ?? null,
      matchType: suggestion.matchType, judgmentClass: suggestion.isJudgmentClass,
    });
    return updated;
  }
}
