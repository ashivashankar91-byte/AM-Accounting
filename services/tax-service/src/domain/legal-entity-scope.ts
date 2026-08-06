import { CrossEntityAccessDeniedError } from './errors';

/**
 * Application-layer legal-entity scoping. RLS policies stay tenant_id-keyed
 * only (see the RLS migration) — this helper is the enforcement point for
 * the additional legalEntityId filter every tenant+entity scoped query
 * must apply, and the throw point for the cross-entity-denial live-db test.
 */
export function assertLegalEntityMatch(entityLabel: string, id: string, expectedLegalEntityId: string, actualLegalEntityId: string): void {
  if (expectedLegalEntityId !== actualLegalEntityId) {
    throw new CrossEntityAccessDeniedError(entityLabel, id);
  }
}
