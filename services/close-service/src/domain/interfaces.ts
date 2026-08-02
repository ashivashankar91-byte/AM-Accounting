export interface ICloseRepository {
  findState(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number): Promise<any>;
  upsertState(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number, state: string, previousState: string, transitionBy: string, reason: string | undefined, version: number): Promise<any>;
  getExceptionOverriderIds(tenantId: string, legalEntityId: string, periodYear: number, periodMonth: number): Promise<string[]>;
}

export interface IReconciliationRepository {
  findAll(tenantId: string, params: any): Promise<any[]>;
  create(tenantId: string, data: any): Promise<any>;
  signOff(tenantId: string, id: string, data: any): Promise<any>;
}

export interface IScrubRepository {
  createRun(tenantId: string, data: any): Promise<any>;
  findRuns(tenantId: string, params: any): Promise<any[]>;
  findFindings(tenantId: string, scrubRunId: string): Promise<any[]>;
  disposeFinding(tenantId: string, id: string, data: any): Promise<any>;
  completeRun(tenantId: string, id: string, findingsCount: number): Promise<any>;
  createFindings(tenantId: string, scrubRunId: string, findings: any[]): Promise<void>;
}

export interface IYearEndRepository {
  createPreview(tenantId: string, data: any): Promise<any>;
  findById(tenantId: string, id: string): Promise<any>;
  approve(tenantId: string, id: string, approvedBy: string): Promise<any>;
  post(tenantId: string, id: string, postedBy: string, journalId: string): Promise<any>;
}

export interface IKpiRepository {
  listFormulas(tenantId: string): Promise<any[]>;
  createFormula(tenantId: string, data: any): Promise<any>;
  saveResult(tenantId: string, data: any): Promise<any>;
  findFormula(tenantId: string, formulaCode: string): Promise<any>;
}

export interface ISnapshotRepository {
  create(tenantId: string, data: any): Promise<any>;
  findById(tenantId: string, id: string): Promise<any>;
  primarySign(tenantId: string, id: string, data: any): Promise<any>;
  secondarySign(tenantId: string, id: string, data: any): Promise<any>;
  verify(tenantId: string, id: string): Promise<any>;
}

export interface IArchiveRepository {
  create(tenantId: string, data: any): Promise<any>;
  findAll(tenantId: string): Promise<any[]>;
  findById(tenantId: string, id: string): Promise<any>;
  softDelete(tenantId: string, id: string): Promise<any>;
  createRetentionSchedule(tenantId: string, data: any): Promise<any>;
}

export interface ICurrencyRepository {
  getConfig(tenantId: string, legalEntityId: string): Promise<any>;
  upsertConfig(tenantId: string, legalEntityId: string, data: any): Promise<any>;
  addRate(tenantId: string, data: any): Promise<any>;
  listRates(tenantId: string, params: any): Promise<any[]>;
  createTranslationRun(tenantId: string, data: any): Promise<any>;
  findTranslationRun(tenantId: string, id: string): Promise<any>;
  approveTranslationRun(tenantId: string, id: string, approvedBy: string): Promise<any>;
  postTranslationRun(tenantId: string, id: string, postedBy: string, journalId: string): Promise<any>;
}
