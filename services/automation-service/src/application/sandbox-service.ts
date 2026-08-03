import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/automation-service-client';
import { runSandboxSimulation, assertNoWriteSurface, SANDBOX_PROTECTED_SURFACES } from '../domain/sandbox-engine';
import { NotConfiguredError, AutomationError } from '../domain/errors';
import { IAutomationEventPublisher } from '../domain/interfaces';

/**
 * CE-17 S022 — Rule Simulation Sandbox.
 *
 * The sandbox has no posting client and no item service. That is not an
 * oversight to be corrected later; it is the story's guarantee expressed as a
 * dependency graph. There is nothing here that could post even if somebody
 * asked it to, and every completed run carries a proof of that fact.
 */
@injectable()
export class SandboxService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IAutomationEventPublisher') private readonly events: IAutomationEventPublisher,
  ) {}

  async list(tenantId: string, legalEntityId: string) {
    return this.prisma.simulationSandbox.findMany({
      where: { tenantId, legalEntityId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async get(tenantId: string, id: string) {
    const sandbox = await this.prisma.simulationSandbox.findFirst({ where: { tenantId, id } });
    if (!sandbox) throw new NotConfiguredError(`Sandbox run ${id} does not exist for this tenant.`);
    const result = await this.prisma.sandboxResult.findFirst({ where: { tenantId, sandboxId: id } });
    return { sandbox, result };
  }

  /**
   * Runs a scenario. Input is frozen into input_spec before evaluation so a
   * rerun of the same sandbox produces byte-identical output — a diff that
   * changes between runs would be worthless as evidence.
   */
  async run(input: {
    tenantId: string; legalEntityId: string; name: string; description?: string;
    scenarioType: string; rulePackVersion?: string | null;
    rows?: Record<string, unknown>[];
    rules?: { ruleCode: string; matchField: string; matchValue: string; debitAccount: string; creditAccount: string }[];
    actual?: any[];
    createdBy: string;
  }) {
    const VALID = ['HISTORICAL_REPLAY', 'SYNTHETIC', 'DRAFT_PACK_PREVIEW'];
    if (!VALID.includes(input.scenarioType)) {
      throw new AutomationError(`scenarioType must be one of ${VALID.join(', ')}.`, { statusCode: 400, code: 'INVALID_SCENARIO_TYPE' });
    }

    const rows = input.rows ?? [];
    const rules = input.rules ?? [];
    const inputSpec = { rows, rules, actual: input.actual ?? [], scenarioType: input.scenarioType };

    const sandbox = await this.prisma.simulationSandbox.create({
      data: {
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        name: input.name,
        description: input.description ?? null,
        scenarioType: input.scenarioType,
        inputSpec: inputSpec as any,
        rulePackVersion: input.rulePackVersion ?? null,
        state: 'RUNNING',
        createdBy: input.createdBy,
      },
    });

    try {
      // Defence in depth: refuse to evaluate anything that carries a write
      // surface, rather than trusting the evaluator to decline to use it.
      assertNoWriteSurface(input.rules, sandbox.id);

      const output = runSandboxSimulation({
        sandboxId: sandbox.id,
        scenarioType: input.scenarioType,
        rulePackVersion: input.rulePackVersion ?? null,
        rows,
        rules,
        actual: input.actual as any,
      });

      const result = await this.prisma.sandboxResult.create({
        data: {
          tenantId: input.tenantId,
          sandboxId: sandbox.id,
          proposedJournals: output.proposedJournals as any,
          diffVsActual: output.diffVsActual as any,
          ruleHits: output.ruleHits as any,
          exportableBaseline: input.scenarioType === 'HISTORICAL_REPLAY',
        },
      });

      await this.prisma.simulationSandbox.updateMany({
        where: { tenantId: input.tenantId, id: sandbox.id },
        data: {
          state: 'COMPLETED',
          resultRef: result.id,
          diffReportRef: result.id,
          mutationProof: output.mutationProof as any,
        },
      });

      await this.events.publish(input.tenantId, sandbox.id, 'automation.sandbox.completed', {
        sandboxId: sandbox.id, scenarioType: input.scenarioType,
        proposedJournalCount: output.proposedJournals.length,
        postingsAttempted: 0, rowsMutated: 0,
      });

      return this.get(input.tenantId, sandbox.id);
    } catch (err: any) {
      await this.prisma.simulationSandbox.updateMany({
        where: { tenantId: input.tenantId, id: sandbox.id },
        data: {
          state: 'FAILED',
          mutationProof: {
            postingsAttempted: 0, rowsMutated: 0,
            protectedSurfaces: SANDBOX_PROTECTED_SURFACES,
            statement: `Run failed before producing output: ${String(err?.message ?? err)}. Nothing was posted and nothing was mutated.`,
          } as any,
        },
      });
      throw err;
    }
  }

  async diff(tenantId: string, id: string) {
    const { sandbox, result } = await this.get(tenantId, id);
    if (!result) {
      return {
        sandboxId: id, state: sandbox.state, available: false,
        detail: sandbox.state === 'FAILED'
          ? 'The run failed before producing a diff.'
          : 'The run has not produced a diff yet.',
      };
    }
    return {
      sandboxId: id,
      state: sandbox.state,
      available: true,
      rulePackVersion: sandbox.rulePackVersion,
      diffVsActual: result.diffVsActual,
      ruleHits: result.ruleHits,
      proposedJournals: result.proposedJournals,
      mutationProof: sandbox.mutationProof,
      exportableBaseline: result.exportableBaseline,
    };
  }
}
