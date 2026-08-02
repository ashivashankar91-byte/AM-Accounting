export interface RetentionPolicy {
  recordClass: string;
  retentionDays: number;
}

export function computeHoldUntil(createdAt: Date, retentionDays: number): Date {
  const holdUntil = new Date(createdAt);
  holdUntil.setDate(holdUntil.getDate() + retentionDays);
  return holdUntil;
}

export function isEligibleForDeletion(holdUntil: Date, now: Date = new Date()): boolean {
  return now >= holdUntil;
}

export function findApplicablePolicy(recordClass: string, policies: RetentionPolicy[]): RetentionPolicy | undefined {
  return policies.find(p => p.recordClass === recordClass);
}
