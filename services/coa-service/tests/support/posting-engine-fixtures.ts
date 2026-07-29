// S019/S020 — Certification-only fixtures for the Posting Engine slice.
//
// These fixtures (event type, rule packs, fixture accounts) exist SOLELY for
// automated tests / local development / certification environments. They
// are not, and must never be presented as, a real accounting mapping — see
// CLAUDE.md's "K. CERTIFICATION FIXTURES" boundary.

export const CERT_EVENT_TYPE = 'accounting.posting-engine.certification.v1';
export const CERT_SCHEMA_VERSION = '1.0';
export const UNMATCHED_EVENT_TYPE = 'accounting.posting-engine.unmatched-fixture.v1';

export interface RulePackFixtureOptions {
  tenantId: string;
  entityId: string;
  drAccountNumber: string;
  crAccountNumber: string;
  journalSourceCode: string;
  storeId?: string;
  packKey?: string;
  semver?: string;
  effectiveFrom?: string;
}

/** Valid rule pack: one unconditional rule, one posting group, 10000bp each side -> exactly two journal lines. */
export function validRulePack(opts: RulePackFixtureOptions) {
  const storeId = opts.storeId ?? 'CERT-STORE-1';
  return {
    dslVersion: 1,
    packKey: opts.packKey ?? 'certification-pack',
    semver: opts.semver ?? '1.0.0',
    eventType: CERT_EVENT_TYPE,
    supportedEventSchemaVersions: [CERT_SCHEMA_VERSION],
    tenantScope: opts.tenantId,
    entityId: opts.entityId,
    effectiveFrom: opts.effectiveFrom ?? '2020-01-01T00:00:00.000Z',
    effectiveTo: null,
    journalSourceCode: opts.journalSourceCode,
    matchStrategy: 'FIRST_MATCH',
    noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
    rules: [
      {
        ruleId: 'unconditional-cert-rule',
        priority: 1,
        description: 'Certification unconditional rule — one debit, one credit, no conditions.',
        condition: null,
        blueprint: {
          memoTemplate: 'Certification posting for {{sourceEntityId}}',
          postingGroups: [
            {
              groupId: 'grp-1',
              baseAmountPath: 'payload.amount',
              debitAllocations: [{ accountNumber: opts.drAccountNumber, storeId, bp: 10000 }],
              creditAllocations: [{ accountNumber: opts.crAccountNumber, storeId, bp: 10000 }],
            },
          ],
        },
      },
    ],
  };
}

/** Invalid rule pack: intentionally unbalanced debit-side allocation (9000bp, not 10000). Activation must be blocked. */
export function unbalancedRulePack(opts: RulePackFixtureOptions) {
  const pack = validRulePack({ ...opts, packKey: opts.packKey ?? 'certification-pack-unbalanced' });
  (pack.rules[0].blueprint.postingGroups[0].debitAllocations[0] as any).bp = 9000;
  return pack;
}

export interface CertificationEventOptions {
  tenantId: string;
  eventId: string;
  amount: number;
  sourceEntityId?: string;
  correlationId?: string;
  occurredAt?: string;
  businessDate?: string;
}

export function certificationEnvelope(opts: CertificationEventOptions) {
  return {
    eventId: opts.eventId,
    tenantId: opts.tenantId,
    eventType: CERT_EVENT_TYPE,
    eventSchemaVersion: CERT_SCHEMA_VERSION,
    occurredAt: opts.occurredAt ?? '2026-06-15T10:00:00.000Z',
    publishedAt: opts.occurredAt ?? '2026-06-15T10:00:01.000Z',
    sourceSystem: 'certification-harness',
    sourceEntityType: 'CERT_FIXTURE',
    sourceEntityId: opts.sourceEntityId ?? `fixture-${opts.eventId}`,
    correlationId: opts.correlationId ?? `corr-${opts.eventId}`,
    causationId: null,
    businessDate: opts.businessDate ?? '2026-06-15',
    payload: { amount: opts.amount },
    metadata: {},
  };
}

/** Same eventId, changed payload — must be rejected as EVENT_IDENTITY_CONFLICT. */
export function conflictingEnvelope(base: ReturnType<typeof certificationEnvelope>, newAmount: number) {
  return { ...base, payload: { amount: newAmount } };
}

/** An event type no fixture rule pack covers — must resolve to NO_RULE_MATCH. */
export function unmatchedEnvelope(opts: CertificationEventOptions) {
  return { ...certificationEnvelope(opts), eventType: UNMATCHED_EVENT_TYPE };
}
