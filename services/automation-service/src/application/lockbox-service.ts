import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { sha256 } from '../domain/idempotency';
import { matchAll, MatchCandidate, MatchSubject } from '../domain/matching-engine';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { IAutomationEventPublisher, IAparAdapter } from '../domain/interfaces';
import { AutomationCapabilityService } from './capability-service';

const CAPABILITY = 'S058_LOCKBOX_MATCHING';
const MATCH_VERSION = 'ce17.lockbox.v1';

/**
 * CE-17 S058 — Lockbox AI remittance matching.
 *
 * Ingestion is idempotent on the file's content hash: the same lockbox file
 * delivered twice produces one set of lines, not two sets of cash. Matching
 * runs deterministic rules first and only scores what is left, and a scored
 * suggestion is always a suggestion — the residual queue is where judgement
 * lives, and judgement is human.
 */
@injectable()
export class LockboxService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
    @inject('IAparAdapter') private readonly apar: IAparAdapter,
    private readonly capabilities: AutomationCapabilityService,
  ) {}

  async listFiles(tenantId: string, legalEntityId: string) {
    return this.prisma.lockboxFile.findMany({
      where: { tenantId, legalEntityId }, orderBy: { depositDate: 'desc' }, take: 200,
    });
  }

  async getFile(tenantId: string, id: string) {
    const file = await this.prisma.lockboxFile.findFirst({ where: { tenantId, id } });
    if (!file) throw new NotConfiguredError(`Lockbox file ${id} does not exist for this tenant.`);
    return file;
  }

  async listLines(tenantId: string, fileId: string) {
    await this.getFile(tenantId, fileId);
    const lines = await this.prisma.lockboxLine.findMany({
      where: { tenantId, fileId }, orderBy: { lineRef: 'asc' },
    });
    const { signal } = await this.apar.getOpenArItems(tenantId, '');
    return { items: lines, total: lines.length, upstreamSignal: signal };
  }

  /**
   * Ingests a lockbox file and matches its lines in one pass.
   *
   * The AR candidate set comes from CE-09, whose contract is not yet
   * reconciled. When it returns nothing, every line lands in EXCEPTION with
   * the upstream reason attached — deliberately not "UNMATCHED", because the
   * lines were never actually compared against anything.
   */
  async ingest(input: {
    tenantId: string; legalEntityId: string; fileRef: string; sourceBank?: string | null;
    depositDate: string;
    lines: { lineRef: string; amount: string | number; applyNumber?: string | null; remittanceRef?: string | null; partyRef?: string | null }[];
    actor: string;
  }) {
    await this.capabilities.requireConfigured(input.tenantId, input.legalEntityId, CAPABILITY);

    const canonical = JSON.stringify({
      fileRef: input.fileRef,
      depositDate: input.depositDate,
      lines: [...input.lines].sort((a, b) => a.lineRef.localeCompare(b.lineRef)),
    });
    const fileHash = sha256(canonical);

    const existing = await this.prisma.lockboxFile.findFirst({ where: { tenantId: input.tenantId, fileHash } });
    if (existing) {
      const lines = await this.prisma.lockboxLine.findMany({ where: { tenantId: input.tenantId, fileId: existing.id } });
      return { file: existing, lines, deduplicated: true, upstreamSignal: null };
    }

    const file = await this.prisma.lockboxFile.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        fileRef: input.fileRef,
        fileHash,
        sourceBank: input.sourceBank ?? null,
        depositDate: new Date(input.depositDate),
        state: 'INGESTED',
      },
    });

    const { signal, items } = await this.apar.getOpenArItems(input.tenantId, input.legalEntityId);
    const candidates: MatchCandidate[] = items.map((i: any) => ({
      id: String(i.id), amount: String(i.amount ?? '0'),
      reference: i.reference ?? null, documentNumber: i.documentNumber ?? null, partyRef: i.customerRef ?? null,
    }));
    const subjects: MatchSubject[] = input.lines.map((l) => ({
      id: l.lineRef, amount: String(l.amount),
      applyNumber: l.applyNumber ?? null, remittanceRef: l.remittanceRef ?? null, partyRef: l.partyRef ?? null,
    }));

    const upstreamUnavailable = signal.status !== 'AVAILABLE';
    const outcomes = upstreamUnavailable ? [] : matchAll(subjects, candidates);
    const byRef = new Map(outcomes.map((o) => [o.subjectId, o]));

    await this.prisma.lockboxLine.createMany({
      data: input.lines.map((l) => {
        const outcome = byRef.get(l.lineRef);
        return {
          tenantId: input.tenantId,
          fileId: file.id,
          lineRef: l.lineRef,
          amount: String(l.amount),
          applyNumber: l.applyNumber ?? null,
          remittanceRef: l.remittanceRef ?? null,
          matchType: outcome?.matchType ?? null,
          matchScore: outcome?.score ?? null,
          matchedArItemId: outcome?.candidateId ?? null,
          matchVersion: MATCH_VERSION,
          // Only an exact deterministic match is presented as accepted work.
          state: upstreamUnavailable ? 'EXCEPTION'
            : outcome?.matchType === 'EXACT_KEY' ? 'SUGGESTED'
              : outcome?.matchType === 'SCORED' ? 'SUGGESTED'
                : 'EXCEPTION',
        };
      }),
    });

    await this.prisma.lockboxFile.updateMany({
      where: { tenantId: input.tenantId, id: file.id },
      data: { state: upstreamUnavailable ? 'INGESTED' : 'MATCHED', processedAt: new Date() },
    });

    const lines = await this.prisma.lockboxLine.findMany({ where: { tenantId: input.tenantId, fileId: file.id } });
    await this.events.publish(input.tenantId, file.id, 'automation.lockbox.ingested', {
      fileRef: input.fileRef, fileHash, lineCount: lines.length,
      exactMatches: outcomes.filter((o) => o.matchType === 'EXACT_KEY').length,
      scoredSuggestions: outcomes.filter((o) => o.matchType === 'SCORED').length,
      upstreamStatus: signal.status,
    });

    return { file, lines, deduplicated: false, upstreamSignal: upstreamUnavailable ? signal : null };
  }

  /**
   * A human dispositions a suggested line. A scored suggestion can never be
   * accepted without this step, whatever the score said.
   */
  async reviewLine(input: { tenantId: string; id: string; decision: 'ACCEPTED' | 'REJECTED' | 'EXCEPTION'; actor: string; reason?: string }) {
    const line = await this.prisma.lockboxLine.findFirst({ where: { tenantId: input.tenantId, id: input.id } });
    if (!line) throw new NotConfiguredError(`Lockbox line ${input.id} does not exist for this tenant.`);
    if (!['ACCEPTED', 'REJECTED', 'EXCEPTION'].includes(input.decision)) {
      throw new AutomationError('decision must be ACCEPTED, REJECTED or EXCEPTION.', { statusCode: 400, code: 'INVALID_DECISION' });
    }
    if (input.decision === 'ACCEPTED' && !line.matchedArItemId) {
      throw new AutomationError(
        'This line has no matched AR item; there is nothing to accept. Disposition it as an exception instead.',
        { statusCode: 422, code: 'NO_MATCH_TO_ACCEPT' },
      );
    }
    const updated = await this.prisma.lockboxLine.update({
      where: { id: line.id },
      data: {
        state: input.decision, reviewedBy: input.actor, reviewedAt: new Date(),
        ...(input.decision === 'REJECTED' ? { matchedArItemId: null, matchType: 'UNMATCHED' } : {}),
      },
    });
    await this.events.publish(input.tenantId, line.id, 'automation.lockbox.line_reviewed', {
      decision: input.decision, actor: input.actor, reason: input.reason ?? null, matchType: line.matchType,
    });
    return updated;
  }
}
