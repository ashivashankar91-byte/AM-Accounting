import { inject, injectable } from 'tsyringe';
import { IScrubRepository } from '../domain/interfaces';
import { runScrubRules, DEFAULT_RULES } from '../domain/scrub-engine';

@injectable()
export class ScrubService {
  constructor(@inject('IScrubRepository') private readonly repo: IScrubRepository) {}

  async runScrub(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number, runBy: string) {
    const run = await this.repo.createRun(tenantId, { legalEntityId, periodYear, periodMonth, runBy });
    const context = { unpostedJournals: 0, unreconciledAccounts: 0, missingEvidence: 0, staleRates: false, openFindings: 0 };
    const findings = runScrubRules(DEFAULT_RULES, context);
    if (findings.length > 0) await this.repo.createFindings(tenantId, run.id, findings);
    return this.repo.completeRun(tenantId, run.id, findings.length);
  }

  async listRuns(tenantId: string, params: any) { return this.repo.findRuns(tenantId, params); }
  async getFindings(tenantId: string, scrubRunId: string) { return this.repo.findFindings(tenantId, scrubRunId); }
  async disposeFinding(tenantId: string, id: string, data: any) { return this.repo.disposeFinding(tenantId, id, data); }
}
