import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/recon-client';
import {
  isValidRuleType, isValidConfidenceTier, ruleMatchesPair, decideAutoMatchAction,
  MatchRuleInputError, MatchRuleNotFoundError, SuggestionNotFoundError, SuggestionNotPendingError,
  type MatchRuleLike,
} from '../domain/auto-match-rules';
import { ReconSessionService } from './recon-session-service';
import { canMatch, ReconSessionNotOpenError } from '../domain/recon-session';

export interface CreateMatchRuleDTO {
  tenantId: string;
  entityId?: string | null;
  bankAccountCode?: string | null;
  ruleType: string;
  tier: string;
  config: Record<string, unknown>;
  priority?: number;
  actor: string;
}

/**
 * S054B — Rule-Based Bank Auto-Match. Runs tenant-configured rules
 * (priority order) against a session's unmatched statement lines and
 * outstanding book items. Every auto-clear is produced through
 * ReconSessionService.matchLine with the firing rule's id stamped on both
 * cleared rows (100% rule-attributed). Ambiguous or SUGGESTED-tier
 * candidates are recorded as recon_match_suggestion rows and NEVER
 * auto-cleared; a suggestion is only realized as a match via an explicit
 * confirm action. Because matching only ever operates on one session's
 * own lines/items (a single bank account + statement period), rules can
 * never clear across different accounts or entities, regardless of how
 * broadly a rule is scoped in configuration.
 */
@injectable()
export class AutoMatchService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('ReconSessionService') private readonly sessionService: ReconSessionService,
  ) {}

  async createRule(dto: CreateMatchRuleDTO) {
    if (!isValidRuleType(dto.ruleType)) throw new MatchRuleInputError('ruleType must be one of AMOUNT_DATE_WINDOW, REFERENCE_CONTAINS, CHECK_NUMBER, BATCH_TOTAL');
    if (!isValidConfidenceTier(dto.tier)) throw new MatchRuleInputError('tier must be EXACT or SUGGESTED');

    return (this.prisma as any).reconMatchRule.create({
      data: {
        id: crypto.randomUUID(), tenantId: dto.tenantId, entityId: dto.entityId ?? null, bankAccountCode: dto.bankAccountCode ?? null,
        ruleType: dto.ruleType, tier: dto.tier, config: dto.config as any, priority: dto.priority ?? 100,
        active: true, createdBy: dto.actor,
      },
    });
  }

  async listRules(tenantId: string) {
    return (this.prisma as any).reconMatchRule.findMany({ where: { tenantId, active: true }, orderBy: { priority: 'asc' } });
  }

  async getRule(tenantId: string, ruleId: string) {
    const rule = await (this.prisma as any).reconMatchRule.findFirst({ where: { id: ruleId, tenantId } });
    if (!rule) throw new MatchRuleNotFoundError();
    return rule;
  }

  /**
   * Evaluates every active rule (scoped to this session's entity/bank
   * account, or globally scoped) against every unmatched statement line,
   * in priority order. The first rule to produce a decision for a line
   * wins for that line (no double-processing once a line is claimed by an
   * auto-clear or already has a pending suggestion from this run).
   */
  async runAutoMatch(tenantId: string, sessionId: string, actor: string) {
    const session = await this.sessionService.getSession(tenantId, sessionId);
    if (!canMatch(session.status)) throw new ReconSessionNotOpenError();

    const allRules: MatchRuleLike[] = await (this.prisma as any).reconMatchRule.findMany({
      where: { tenantId, active: true },
      orderBy: { priority: 'asc' },
    });
    const scopedRules = allRules.filter((r: any) =>
      (r.entityId == null || r.entityId === session.entityId) &&
      (r.bankAccountCode == null || r.bankAccountCode === session.bankAccountCode),
    );

    const lines = await (this.prisma as any).reconStatementLine.findMany({ where: { sessionId, tenantId, status: 'UNMATCHED' } });
    const claimedLineIds = new Set<string>();
    const claimedItemIds = new Set<string>();

    let autoCleared = 0;
    let suggested = 0;

    for (const line of lines) {
      if (claimedLineIds.has(line.id)) continue;
      const outstandingItems = (await (this.prisma as any).reconBookItem.findMany({ where: { sessionId, tenantId, status: 'OUTSTANDING' } }))
        .filter((i: any) => !claimedItemIds.has(i.id));

      for (const rule of scopedRules) {
        const candidates = outstandingItems.filter((item: any) => ruleMatchesPair(rule as any, line as any, item as any));
        const decision = decideAutoMatchAction(rule as any, candidates as any);

        if (decision.action === 'NONE') continue;

        if (decision.action === 'AUTO_CLEAR') {
          await this.sessionService.matchLine({
            tenantId, sessionId, statementLineId: line.id, bookItemId: decision.item.id, actor, ruleId: rule.id,
          });
          claimedLineIds.add(line.id);
          claimedItemIds.add(decision.item.id);
          autoCleared += 1;
          break;
        }

        // SUGGEST — record a candidate suggestion per matched item, idempotently (never duplicate the same triple).
        for (const item of decision.items) {
          try {
            await (this.prisma as any).reconMatchSuggestion.create({
              data: {
                id: crypto.randomUUID(), sessionId, tenantId, statementLineId: line.id, bookItemId: item.id,
                ruleId: rule.id, tier: rule.tier, status: 'PENDING',
              },
            });
            suggested += 1;
          } catch (err: any) {
            if (err?.code !== 'P2002') throw err; // already suggested by a prior run — idempotent no-op
          }
        }
        claimedLineIds.add(line.id); // this line already produced a decision (a suggestion) this run — don't also let a lower-priority rule claim it
        break;
      }
    }

    return { autoCleared, suggested, linesEvaluated: lines.length };
  }

  async listSuggestions(tenantId: string, sessionId: string) {
    return (this.prisma as any).reconMatchSuggestion.findMany({ where: { sessionId, tenantId }, orderBy: { createdAt: 'asc' } });
  }

  private async getSuggestion(tenantId: string, sessionId: string, suggestionId: string) {
    const suggestion = await (this.prisma as any).reconMatchSuggestion.findFirst({ where: { id: suggestionId, sessionId, tenantId } });
    if (!suggestion) throw new SuggestionNotFoundError();
    return suggestion;
  }

  /** Confirms a suggestion — performs the actual clearing (matchLine), stamping the rule that produced the suggestion. */
  async confirmSuggestion(tenantId: string, sessionId: string, suggestionId: string, actor: string) {
    const suggestion = await this.getSuggestion(tenantId, sessionId, suggestionId);
    if (suggestion.status !== 'PENDING') throw new SuggestionNotPendingError();

    const result = await this.sessionService.matchLine({
      tenantId, sessionId, statementLineId: suggestion.statementLineId, bookItemId: suggestion.bookItemId, actor, ruleId: suggestion.ruleId,
    });
    await (this.prisma as any).reconMatchSuggestion.update({
      where: { id: suggestion.id },
      data: { status: 'CONFIRMED', resolvedBy: actor, resolvedAt: new Date() },
    });
    return result;
  }

  /** Rejects a suggestion — the statement line and book item are left untouched (still UNMATCHED/OUTSTANDING). */
  async rejectSuggestion(tenantId: string, sessionId: string, suggestionId: string, actor: string) {
    const suggestion = await this.getSuggestion(tenantId, sessionId, suggestionId);
    if (suggestion.status !== 'PENDING') throw new SuggestionNotPendingError();

    return (this.prisma as any).reconMatchSuggestion.update({
      where: { id: suggestion.id },
      data: { status: 'REJECTED', resolvedBy: actor, resolvedAt: new Date() },
    });
  }
}
