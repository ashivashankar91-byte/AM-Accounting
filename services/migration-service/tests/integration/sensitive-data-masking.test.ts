/**
 * Sensitive legacy values must survive transformation — they are part of a
 * record's identity for reconciliation — but must never be rendered to an
 * operator who lacks `migration.sensitive.view`.
 */
import { describe, it, expect } from 'vitest';
import { makeServices, setupSource, decideAndFreeze, mappableFields, TENANT, LE, OPERATOR } from '../helpers/service-harness';

const SENSITIVE_ROWS = [
  { accountCode: '1200', accountName: 'AR — Smith', debit: '500.00', credit: '0.00', ssn: '123-45-6789', bankAccountNumber: '9876543210', driverLicense: 'D1234567' },
  { accountCode: '3000', accountName: 'Equity', debit: '0.00', credit: '500.00', ssn: '987-65-4321', bankAccountNumber: '1122334455', driverLicense: 'X7654321' },
];

async function stagedWithSecrets(s: ReturnType<typeof makeServices>) {
  const setup = await setupSource(s, SENSITIVE_ROWS, { mappingFields: mappableFields(SENSITIVE_ROWS) });
  await decideAndFreeze(s, TENANT, setup.mappingSet.id);
  const run = await s.runService.create({
    tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
  });
  const staged = await s.stagingService.stage({
    tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
    mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
  });
  return { ...setup, run, staged };
}

describe('source row preview', () => {
  it('masks an SSN for an operator without migration.sensitive.view', async () => {
    const s = makeServices();
    const { snapshot } = await stagedWithSecrets(s);
    const files = (await s.sourceService.listFiles(TENANT, snapshot.id)) as any[];
    const { items } = await s.sourceService.listRows(TENANT, files[0].id, 10, 0, false);
    expect((items as any[])[0].rawData.ssn).toBe('*******6789');
  });

  it('masks bank account and driver-licence numbers too', async () => {
    const s = makeServices();
    const { snapshot } = await stagedWithSecrets(s);
    const files = (await s.sourceService.listFiles(TENANT, snapshot.id)) as any[];
    const { items } = await s.sourceService.listRows(TENANT, files[0].id, 10, 0, false);
    const row = (items as any[])[0].rawData;
    expect(row.bankAccountNumber).toBe('******3210');
    expect(row.driverLicense).toBe('****4567');
  });

  it('leaves non-sensitive fields readable so the row remains reviewable', async () => {
    const s = makeServices();
    const { snapshot } = await stagedWithSecrets(s);
    const files = (await s.sourceService.listFiles(TENANT, snapshot.id)) as any[];
    const { items } = await s.sourceService.listRows(TENANT, files[0].id, 10, 0, false);
    const row = (items as any[])[0].rawData;
    expect(row.accountCode).toBe('1200');
    expect(row.debit).toBe('500.00');
  });

  it('reveals the value to an operator who does hold the permission', async () => {
    const s = makeServices();
    const { snapshot } = await stagedWithSecrets(s);
    const files = (await s.sourceService.listFiles(TENANT, snapshot.id)) as any[];
    const { items } = await s.sourceService.listRows(TENANT, files[0].id, 10, 0, true);
    expect((items as any[])[0].rawData.ssn).toBe('123-45-6789');
  });

  it('retains the last four characters so a human can still recognise the record', async () => {
    const s = makeServices();
    const { snapshot } = await stagedWithSecrets(s);
    const files = (await s.sourceService.listFiles(TENANT, snapshot.id)) as any[];
    const { items } = await s.sourceService.listRows(TENANT, files[0].id, 10, 0, false);
    expect(String((items as any[])[0].rawData.ssn)).toMatch(/6789$/);
  });
});

describe('staged row listing', () => {
  it('masks sensitive staged values', async () => {
    const s = makeServices();
    const { staged } = await stagedWithSecrets(s);
    const { items } = await s.stagingService.listRows(TENANT, staged.datasetId, 10, 0, false);
    expect((items as any[])[0].stagedData.ssn).toBe('*******6789');
  });

  it('does not mutate what is stored — the underlying value survives for reconciliation', async () => {
    const s = makeServices();
    const { staged } = await stagedWithSecrets(s);
    const { items } = await s.stagingService.listRows(TENANT, staged.datasetId, 10, 0, true);
    expect((items as any[])[0].stagedData.ssn).toBe('123-45-6789');
  });

  it('reports the same total either way — masking hides values, not records', async () => {
    const s = makeServices();
    const { staged } = await stagedWithSecrets(s);
    const masked = await s.stagingService.listRows(TENANT, staged.datasetId, 10, 0, false);
    const clear = await s.stagingService.listRows(TENANT, staged.datasetId, 10, 0, true);
    expect(masked.total).toBe(clear.total);
  });
});

describe('transformation preview', () => {
  it('masks sensitive values in the preview payload', async () => {
    const s = makeServices();
    const setup = await setupSource(s, SENSITIVE_ROWS, { mappingFields: mappableFields(SENSITIVE_ROWS) });
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const preview = await s.stagingService.preview({
      tenantId: TENANT, snapshotId: setup.snapshot.id, mappingSetId: setup.mappingSet.id,
      limit: 10, allowSensitive: false,
    });
    expect((preview.rows as any[])[0].stagedData.ssn).toBe('*******6789');
  });

  it('reveals them to a privileged previewer', async () => {
    const s = makeServices();
    const setup = await setupSource(s, SENSITIVE_ROWS, { mappingFields: mappableFields(SENSITIVE_ROWS) });
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const preview = await s.stagingService.preview({
      tenantId: TENANT, snapshotId: setup.snapshot.id, mappingSetId: setup.mappingSet.id,
      limit: 10, allowSensitive: true,
    });
    expect((preview.rows as any[])[0].stagedData.ssn).toBe('123-45-6789');
  });
});

describe('exception queue', () => {
  it('masks the offending value when the field itself is sensitive', async () => {
    const s = makeServices();
    const setup = await setupSource(s, SENSITIVE_ROWS, { mappingFields: ['accountCode', 'accountName', 'debit', 'credit', 'driverLicense', 'bankAccountNumber'] });
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });

    const masked = await s.exceptionService.list(TENANT, run.runId, undefined, false);
    const ssnException = (masked.items as any[]).find((e) => e.sourceField === 'ssn');
    expect(ssnException).toBeTruthy();
    expect(ssnException.sourceValue).toMatch(/^\*+\d{4}$/);

    const clear = await s.exceptionService.list(TENANT, run.runId, undefined, true);
    expect((clear.items as any[]).find((e) => e.sourceField === 'ssn').sourceValue).toBe('123-45-6789');
  });

  it('still reports how many exceptions are blocking regardless of masking', async () => {
    const s = makeServices();
    const setup = await setupSource(s, SENSITIVE_ROWS, { mappingFields: ['accountCode', 'accountName', 'debit', 'credit', 'driverLicense', 'bankAccountNumber'] });
    await decideAndFreeze(s, TENANT, setup.mappingSet.id);
    const run = await s.runService.create({
      tenantId: TENANT, legalEntityId: LE, mode: 'REHEARSAL', transformationVersion: 'ce16.v1', actor: OPERATOR,
    });
    await s.stagingService.stage({
      tenantId: TENANT, legalEntityId: LE, runId: run.runId, snapshotId: setup.snapshot.id,
      mappingSetId: setup.mappingSet.id, datasetType: 'TB', actor: OPERATOR,
    });
    const masked = await s.exceptionService.list(TENANT, run.runId, undefined, false);
    const clear = await s.exceptionService.list(TENANT, run.runId, undefined, true);
    expect(masked.blockingPending).toBe(clear.blockingPending);
    expect(masked.blockingPending).toBeGreaterThan(0);
  });
});

describe('lineage evidence', () => {
  it('masks sensitive keys nested inside lineage evidence', async () => {
    const s = makeServices();
    const { run } = await stagedWithSecrets(s);
    const clear = (await s.promotionService.listLineage(TENANT, run.runId, undefined, true)) as any[];
    expect(clear.length).toBeGreaterThan(0);

    // Plant a sensitive value in evidence the way an upstream adapter might.
    s.h.lineage.entries[0]!.evidence = { ...clear[0].evidence, bankAccountNumber: '5555666677778888' };

    const masked = (await s.promotionService.listLineage(TENANT, run.runId, undefined, false)) as any[];
    expect(masked[0].evidence.bankAccountNumber).toBe('************8888');
    expect(masked[0].evidence.datasetType).toBe('TB');
  });
});
