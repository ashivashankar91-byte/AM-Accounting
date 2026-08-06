// S065 — factory-age aging bands for warranty claims. Generic day-bucket
// aging (CE-08 S027's factory-age EXCEPTION rules / D-CE08-03 exact band
// values are not yet defined upstream — genuinely absent, not PUTR-deferred
// per the CE-08 audit finding) — this service uses a safe, tenant-visible
// default bucket set that never silently hides age; ratify exact bands at
// certification alongside D-CE08-03.
export const DEFAULT_AGE_BANDS = [
  { label: '0-30', minDays: 0, maxDays: 30 },
  { label: '31-60', minDays: 31, maxDays: 60 },
  { label: '61-90', minDays: 61, maxDays: 90 },
  { label: '91+', minDays: 91, maxDays: Infinity },
] as const;

export function ageInDays(since: Date, asOf: Date): number {
  const ms = asOf.getTime() - since.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function bandFor(ageDays: number): string {
  const band = DEFAULT_AGE_BANDS.find((b) => ageDays >= b.minDays && ageDays <= b.maxDays);
  return band?.label ?? '91+';
}
