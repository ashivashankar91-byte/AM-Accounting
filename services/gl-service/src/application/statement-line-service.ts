import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'crypto';
import type { PrismaClient } from '.prisma/gl-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';

/**
 * S009 — Statement Metadata & COA Governance (gl-service ownership, per
 * docs/accounting-modernization/S009_DECISION_MEMO.md).
 *
 * Two distinct concerns, both effective-dated per BLK-09 (Option 2, fully
 * effective-dated / prospective, approved by Product 2026-07-28):
 *
 *  1. StatementLine catalog — the BS/IS presentation taxonomy itself
 *     (e.g. "Cost of Sales", "Operating Expenses"). Rarely changes; not
 *     itself effective-dated (only the account->line mapping is).
 *  2. GLAccountStatementLineHistory — the effective-dated mapping from a
 *     GL account to a statement line. Every mapping change requires an
 *     effective period, reason, and authenticated actor. Ranges are
 *     immutable once superseded (append-only) and the database enforces
 *     non-overlap via the `excl_gaslh_no_overlap` EXCLUDE constraint
 *     (see prisma/migrations/20260728010007_s009_statement_lines_gl_svc).
 *
 * Historical reports must resolve the mapping that was effective for the
 * requested period (see resolveEffectiveStatementLine below) — NOT
 * whatever mapping happens to be current "today". Initial/bootstrap
 * mappings may only be backdated through this same governed path, with
 * `isBootstrap: true` and an explicit audit trail (never a raw INSERT).
 */

export interface StatementLineInput {
  code: string;
  name: string;
  statement: 'BS' | 'IS';
  section: string;
  sortOrder?: number;
}

export interface SetAccountStatementMetadataInput {
  glAccountId: string;
  statementLineId: string | null;
  effectiveFrom: string; // YYYY-MM-DD
  reason: string;
  actor: string;
  isBootstrap?: boolean;
}

/** Thrown when a proposed effective-dated mapping would overlap an existing one for the same account. */
export class StatementMetadataOverlapError extends Error {
  readonly statusCode = 409;
  readonly code = 'STATEMENT_METADATA_EFFECTIVE_RANGE_OVERLAP';

  constructor(public readonly glAccountId: string, public readonly effectiveFrom: string) {
    super(
      `A statement-line mapping already exists for GL account ${glAccountId} covering ${effectiveFrom} ` +
        `-- effective-dated mapping history must be non-overlapping (BLK-09).`,
    );
  }
}

export class StatementLineNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'STATEMENT_LINE_NOT_FOUND';
  constructor(public readonly id: string) {
    super(`Statement line ${id} not found`);
  }
}

@injectable()
export class StatementLineService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async listStatementLines(tenantId: string) {
    return this.prisma.statementLine.findMany({
      where: { tenantId },
      orderBy: [{ statement: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async createStatementLine(tenantId: string, input: StatementLineInput, actor: string) {
    const created = await this.prisma.$transaction(async (tx) => {
      // R0 Batch C fix pattern (see rls-middleware.ts): an interactive
      // $transaction callback is pinned to its own dedicated connection,
      // separate from the one the $use middleware's SET ran on -- without
      // this, every RLS-protected read/write inside `tx` silently sees an
      // unset app.current_tenant_id and is filtered/blocked.
      await setTenantContextOnConnection(tx, tenantId);
      const line = await tx.statementLine.create({
        data: {
          tenantId,
          code: input.code,
          name: input.name,
          statement: input.statement,
          section: input.section,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'GL_STATEMENT_LINE_CREATED',
          tenantId,
          payload: { statementLineId: line.id, code: line.code, statement: line.statement, section: line.section, actor },
          correlationId: randomUUID(),
        },
      });
      return line;
    });
    return created;
  }

  async updateStatementLine(
    tenantId: string,
    id: string,
    input: Partial<Pick<StatementLineInput, 'name' | 'section' | 'sortOrder'>> & { isActive?: boolean },
    actor: string,
  ) {
    const existing = await this.prisma.statementLine.findFirst({ where: { id, tenantId } });
    if (!existing) throw new StatementLineNotFoundError(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      // See createStatementLine above: required on every interactive
      // $transaction callback for RLS to apply on its dedicated connection.
      await setTenantContextOnConnection(tx, tenantId);
      const line = await tx.statementLine.update({
        where: { id },
        data: {
          name: input.name ?? undefined,
          section: input.section ?? undefined,
          sortOrder: input.sortOrder ?? undefined,
          isActive: input.isActive ?? undefined,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: 'GL_STATEMENT_LINE_UPDATED',
          tenantId,
          payload: { statementLineId: id, changes: input, actor },
          correlationId: randomUUID(),
        },
      });
      return line;
    });
    return updated;
  }

  /**
   * BR009-1/BR009-5: create a new effective-dated statement-line mapping
   * for a GL account. Closes any currently-open mapping for that account
   * at `effectiveFrom` (append-only — the prior row's effectiveTo is set,
   * never deleted or mutated in place beyond that terminal date) and
   * inserts the new mapping row. The database's EXCLUDE constraint is the
   * ultimate authority on non-overlap; this method also pre-checks so a
   * clear 409 is returned instead of a raw constraint-violation 500.
   */
  async setAccountStatementMetadata(tenantId: string, input: SetAccountStatementMetadataInput) {
    const effectiveFrom = new Date(input.effectiveFrom);

    return this.prisma.$transaction(async (tx) => {
      // See createStatementLine above: required on every interactive
      // $transaction callback for RLS to apply on its dedicated connection.
      // Without this, the overlap pre-check's findFirst() below would
      // silently see zero rows (never detecting a real overlap) and the
      // later tx.gLAccount.update() would fail RLS with a false "record not
      // found" -- exactly the Final-R0 Batch C failure mode this project
      // already fixed elsewhere in gl-service (gl-service.ts, journal-
      // repository.ts, serializable-retry.ts).
      await setTenantContextOnConnection(tx, tenantId);
      // Close the currently-open range for this account, if any, at the new effective date.
      const openRange = await tx.gLAccountStatementLineHistory.findFirst({
        where: { tenantId, glAccountId: input.glAccountId, effectiveTo: null },
      });

      if (openRange) {
        if (openRange.effectiveFrom >= effectiveFrom) {
          throw new StatementMetadataOverlapError(input.glAccountId, input.effectiveFrom);
        }
        await tx.gLAccountStatementLineHistory.update({
          where: { id: openRange.id },
          data: { effectiveTo: effectiveFrom },
        });
      }

      const history = await tx.gLAccountStatementLineHistory.create({
        data: {
          tenantId,
          glAccountId: input.glAccountId,
          statementLineId: input.statementLineId,
          effectiveFrom,
          reason: input.reason,
          actor: input.actor,
          isBootstrap: input.isBootstrap ?? false,
        },
      });

      // Denormalized "current" pointer on GLAccount for fast lookups —
      // the history table remains the immutable source of truth.
      await tx.gLAccount.update({
        where: { id: input.glAccountId },
        data: { statementLineId: input.statementLineId },
      });

      await tx.outboxEvent.create({
        data: {
          eventType: 'GL_ACCOUNT_STATEMENT_METADATA_CHANGED',
          tenantId,
          payload: {
            glAccountId: input.glAccountId,
            statementLineId: input.statementLineId,
            effectiveFrom: input.effectiveFrom,
            reason: input.reason,
            actor: input.actor,
            isBootstrap: input.isBootstrap ?? false,
          },
          correlationId: randomUUID(),
        },
      });

      return history;
    });
  }

  async setAccountStatementMetadataBulk(tenantId: string, inputs: SetAccountStatementMetadataInput[]) {
    const results = [];
    for (const input of inputs) {
      results.push(await this.setAccountStatementMetadata(tenantId, input));
    }
    return results;
  }

  /**
   * BR009-3: resolve the mapping effective for a given account as of a
   * specific date — the same lookup a historical report must use (never
   * "whatever is current today").
   */
  async resolveEffectiveStatementLine(tenantId: string, glAccountId: string, asOf: string) {
    const asOfDate = new Date(asOf);
    return this.prisma.gLAccountStatementLineHistory.findFirst({
      where: {
        tenantId,
        glAccountId,
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOfDate } }],
      },
      include: { statementLine: true },
    });
  }
}
