// CE-09 (S053/S055/S056) — canonical SourceEventEnvelope builder for every
// new matrix-row posting event this package introduces. Mirrors
// coa-service's src/domain/posting-engine/event-envelope.ts field-for-field
// (see docs/accounting-modernization/S023_EVENT_CONTRACT.md) so these
// events are consumable by the same posting engine without a second
// envelope shape. Cash-service's pre-existing CashOutboxEvent table has a
// narrower column set (eventType/aggregateId/payload) — the full envelope
// is carried *inside* payload.envelope so no producer here invents a
// second, incompatible outbox shape while the shared table migration is
// out of this package's scope.
//
// BR: this module never decides GL accounts. Every accountingAmounts[] line
// here is a business fact only; DR/CR account selection is the posting
// engine's job per the approved-but-blank S023 matrix rows.

export interface AccountingAmount {
  amount: string; // decimal string, never a float
  currency: string;
  kind: 'GROSS' | 'NET' | 'TAX' | 'FEE';
}

export interface AccountingReference {
  scheduleNumber?: string | null;
  controlNumber?: string | null;
  applyNumber?: string | null;
  referenceNumber?: string | null;
  itemNumber?: string | null;
}

export interface MatrixRowEnvelope {
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  eventType: string;
  schemaVersion: string;
  sourceSystem: string;
  sourceEntityType: string;
  sourceEntityId: string;
  businessDate: string; // YYYY-MM-DD
  correlationId: string;
  idempotencyIdentity: string;
  accountingAmounts: AccountingAmount[];
  accountingReferences: AccountingReference[];
  storeId?: string | null;
  departmentCode?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function buildMatrixRowEnvelope(input: {
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  eventType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  businessDate: string;
  correlationId: string;
  idempotencyIdentity: string;
  accountingAmounts: AccountingAmount[];
  accountingReferences: AccountingReference[];
  storeId?: string | null;
  departmentCode?: string | null;
  metadata?: Record<string, unknown> | null;
}): MatrixRowEnvelope {
  return {
    eventId: input.eventId,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    eventType: input.eventType,
    schemaVersion: '1.0.0',
    sourceSystem: 'cash-service',
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    businessDate: input.businessDate,
    correlationId: input.correlationId,
    idempotencyIdentity: input.idempotencyIdentity,
    accountingAmounts: input.accountingAmounts,
    accountingReferences: input.accountingReferences,
    storeId: input.storeId ?? null,
    departmentCode: input.departmentCode ?? null,
    metadata: input.metadata ?? null,
  };
}

/**
 * S023 standing rule: every new matrix row is added BLANK (account values
 * ACCOUNT_MAPPING_VALUES_PENDING) and only a labeled TEST-TENANT fixture may
 * exercise it for certification — never a real/production GL account
 * number. This is that fixture, referenced from tests only.
 */
export const ACCOUNT_MAPPING_VALUES_PENDING = 'ACCOUNT_MAPPING_VALUES_PENDING' as const;

export const TEST_TENANT_MATRIX_FIXTURE = {
  tenantId: 'TEST-TENANT-CE09-CERTIFICATION-ONLY',
  note:
    'Certification-only fixture. Debit/credit account values are deliberately ' +
    'ACCOUNT_MAPPING_VALUES_PENDING per the S023 standing rule — engineering ' +
    'must never fill these with a real tenant GL account number.',
  rows: {
    'cash.deposit.posted': { debit: ACCOUNT_MAPPING_VALUES_PENDING, credit: ACCOUNT_MAPPING_VALUES_PENDING },
    'cash.settlement.fee.recognized': { debit: ACCOUNT_MAPPING_VALUES_PENDING, credit: ACCOUNT_MAPPING_VALUES_PENDING },
    'cash.settlement.chargeback.recorded': { debit: ACCOUNT_MAPPING_VALUES_PENDING, credit: ACCOUNT_MAPPING_VALUES_PENDING },
    'cash.sweep.posted': { debit: ACCOUNT_MAPPING_VALUES_PENDING, credit: ACCOUNT_MAPPING_VALUES_PENDING },
    'cash.fpoffset.allocation.posted': { debit: ACCOUNT_MAPPING_VALUES_PENDING, credit: ACCOUNT_MAPPING_VALUES_PENDING },
  },
} as const;
