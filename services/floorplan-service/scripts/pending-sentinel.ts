// Mirrors services/coa-service/src/domain/posting-engine/dsl.ts's
// ACCOUNT_MAPPING_VALUES_PENDING literal exactly. Duplicated here (rather
// than imported cross-service) because floorplan-service does not depend on
// coa-service's source tree — only on its HTTP API.
export const ACCOUNT_MAPPING_VALUES_PENDING = 'ACCOUNT_MAPPING_VALUES_PENDING' as const;
