import { createHash } from 'crypto';
import { PrismaClient } from '.prisma/eom-client';

export function computeEOMLockKey(tenantId: string, periodYear: number, periodMonth: number): bigint {
  const hash = createHash('md5')
    .update(`eom:${tenantId}:${periodYear}:${periodMonth}`)
    .digest();
  return hash.readBigInt64BE(0);
}

export async function withEOMLock<T>(
  prisma: PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  tenantId: string,
  periodYear: number,
  periodMonth: number,
  fn: () => Promise<T>,
): Promise<T> {
  const lockKey = computeEOMLockKey(tenantId, periodYear, periodMonth);
  await (prisma as any).$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;
  return fn();
}
