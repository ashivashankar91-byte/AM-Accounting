import pino from 'pino';

// SERIALIZABLE transaction helper with bounded exponential-backoff retry —
// copied verbatim (Reuse After Refactoring) from
// services/schedule-service/src/lib/serializable-retry.ts, itself copied
// from the coa-service/gl-service pattern — so competing floorplan match/
// curtailment/interest applications against the same liability item
// serialize correctly instead of racing.

const logger = pino({ name: 'floorplan-serializable-retry' });

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 50;

export async function withSerializableRetry<T>(prisma: any, fn: (tx: any) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: 'Serializable' });
    } catch (err: any) {
      const isSerializationFailure = err?.code === 'P2034' || err?.message?.includes('could not serialize access') || err?.meta?.code === '40001';
      if (isSerializationFailure && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn({ attempt, delay, error: err?.message }, 'serialization failure; retrying');
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('serialization retry exhausted after 5 attempts');
}
