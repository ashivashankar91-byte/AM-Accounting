/**
 * CE-14 GLOBAL RULES (package line 12): "idempotency per envelope". Every
 * mutating ceremony that must not double-apply on retry/race (remittance
 * application, chargeback posting, accrual posting, claim response
 * recording) checks-then-inserts an OemIdempotencyRecord inside the same
 * transaction as the ceremony's writes — the unique constraint on
 * (tenantId, operationType, idempotencyKey) is the actual race guard
 * (see the S021 races-live-PG certification: two concurrent requests with
 * the same key, only one wins).
 */
export class IdempotentReplayError extends Error {
  constructor(public readonly existingResult: unknown) {
    super('Operation already applied with this idempotency key');
    this.name = 'IdempotentReplayError';
  }
}

export async function withIdempotency<T>(
  tx: any,
  tenantId: string,
  operationType: string,
  idempotencyKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = await tx.oemIdempotencyRecord.findUnique({
    where: { tenantId_operationType_idempotencyKey: { tenantId, operationType, idempotencyKey } },
  });
  if (existing) {
    return existing.resultRef as T;
  }
  const result = await fn();
  await tx.oemIdempotencyRecord.create({
    data: { tenantId, operationType, idempotencyKey, resultRef: result as any },
  });
  return result;
}
