// CE-07 / S023 — governed, tenant-configurable rule-pack TEST FIXTURES for
// the approved AP/AR/Cash event types (docs/accounting-modernization/
// S023_ACCOUNTING_RULE_MATRIX.md).
//
// *** TEST-TENANT FIXTURES ONLY — NEVER A PRODUCTION DEFAULT ***
// Every account number below is a fixture GL account created by the calling
// test in its own ephemeral tenant (see fixtureOpts()-style callers). D-S023-12
// is APPROVED_IN_PRINCIPLE / ACCOUNT_MAPPING_VALUES_PENDING — no account
// number here may ever be treated as, seeded as, or fall back to a
// production tenant's configured mapping. Missing a required tenant mapping
// in production must reject deterministically (this engine already does:
// see PostingEngineService.submitEvent's account-resolution rejection path,
// INVALID_ACCOUNT taxonomy code).
//
// One rule pack per approved event type/business transaction from the Rule
// Matrix. Where the Matrix lists two rows sharing one event type
// (cash.receipt.applied: applied vs. unapplied), both are modeled as
// separate rules within the SAME pack, selected by condition — never a
// second selection mechanism.

// NOTE ON WIRE FORMAT: the pre-existing S019/S020 rule-pack validator
// requires eventType to match "a.b.c.vN" (INVALID_EVENT_TYPE otherwise) —
// a pre-existing engine constraint (docs/accounting-modernization's
// approved event names are the conceptual/business identity: ap.invoice.
// accepted, cash.receipt.applied, etc.; the ".v1" suffix here is purely
// the engine's own schema-versioning wire convention, respected as-is per
// D-S023-22's narrow-scope authorization — not a new invented rule).
export const S023_EVENT_TYPES = {
  AP_INVOICE_ACCEPTED: 'ap.invoice.accepted.v1',
  AP_PAYMENT_POSTED: 'ap.payment.posted.v1',
  CASH_RECEIPT_APPLIED: 'cash.receipt.applied.v1',
  CASH_DEPOSIT_POSTED: 'cash.deposit.posted.v1',
  AR_INVOICE_POSTED_REQUEST: 'ar.invoice.posted-request.v1', // DEFINED_NOT_YET_EXERCISED — no producer exists (S048)
} as const;

export interface TestTenantAccounts {
  tenantId: string;
  entityId: string;
  journalSourceCode: string;
  storeId?: string;
  /** Fixture-only GL account numbers — see file header. Never invented per-tenant production values. */
  apExpenseAccount: string;
  apControlAccount: string;
  apTaxAccount: string;
  bankCashAccount: string;
  undepositedFundsAccount: string;
  arControlAccount: string;
  unappliedCashAccount: string;
  revenueAccount: string;
  outputTaxAccount: string;
}

function baseFields(opts: TestTenantAccounts, packKey: string, eventType: string, effectiveFrom = '2020-01-01T00:00:00.000Z') {
  return {
    dslVersion: 1,
    packKey,
    semver: '1.0.0',
    eventType,
    supportedEventSchemaVersions: ['1.0'],
    tenantScope: opts.tenantId,
    entityId: opts.entityId,
    effectiveFrom,
    effectiveTo: null,
    journalSourceCode: opts.journalSourceCode,
    matchStrategy: 'FIRST_MATCH' as const,
    noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION' as const,
  };
}

/** D-S023-02: vendor invoice liability — the single authoritative event; carries any tax lines within the same journal (D-S023-06 amendment). Test-tenant fixture. */
export function apInvoiceLiabilityPack(opts: TestTenantAccounts) {
  const storeId = opts.storeId ?? 'CERT-STORE-1';
  return {
    ...baseFields(opts, 's023-ap-invoice-liability', S023_EVENT_TYPES.AP_INVOICE_ACCEPTED),
    rules: [{
      ruleId: 'ap-invoice-liability-and-tax',
      priority: 1,
      description: 'AP invoice liability recognition, including tax lines within the same journal (test-tenant fixture — D-S023-02/06).',
      condition: null,
      blueprint: {
        memoTemplate: 'AP invoice liability — {{sourceEntityId}}',
        postingGroups: [{
          groupId: 'liability',
          baseAmountPath: 'payload.amount',
          debitAllocations: [{ accountNumber: opts.apExpenseAccount, storeId, deptCode: 'FIXTURE-DEPT', bp: 10000 }],
          creditAllocations: [{ accountNumber: opts.apControlAccount, storeId, bp: 10000 }],
        }],
      },
    }],
  };
}

/** D-S023-03: manual vendor payment — relieves the AP control account. Test-tenant fixture. */
export function apPaymentPack(opts: TestTenantAccounts) {
  const storeId = opts.storeId ?? 'CERT-STORE-1';
  return {
    ...baseFields(opts, 's023-ap-payment', S023_EVENT_TYPES.AP_PAYMENT_POSTED),
    rules: [{
      ruleId: 'ap-payment-relief',
      priority: 1,
      description: 'Manual vendor payment — AP control relief against bank/cash (test-tenant fixture — D-S023-02).',
      condition: null,
      blueprint: {
        memoTemplate: 'AP payment — {{sourceEntityId}}',
        postingGroups: [{
          groupId: 'payment',
          baseAmountPath: 'payload.amount',
          debitAllocations: [{ accountNumber: opts.apControlAccount, storeId, bp: 10000 }],
          creditAllocations: [{ accountNumber: opts.bankCashAccount, storeId, bp: 10000 }],
        }],
      },
    }],
  };
}

/** D-S023-04: cash receipt — applied (default rule) vs. unapplied/customer-credit (payload.unapplied === true). Both rules live in ONE pack, selected by condition — never a second selection mechanism. Test-tenant fixture. */
export function cashReceiptPack(opts: TestTenantAccounts) {
  const storeId = opts.storeId ?? 'CERT-STORE-1';
  return {
    ...baseFields(opts, 's023-cash-receipt', S023_EVENT_TYPES.CASH_RECEIPT_APPLIED),
    rules: [
      {
        ruleId: 'cash-receipt-unapplied',
        priority: 1,
        description: 'Unapplied cash — retained as governed customer credit, never relieves an AR item (test-tenant fixture — D-S023-04).',
        condition: { equals: { path: 'payload.unapplied', value: true } },
        blueprint: {
          memoTemplate: 'Unapplied cash receipt — {{sourceEntityId}}',
          postingGroups: [{
            groupId: 'unapplied',
            baseAmountPath: 'payload.amount',
            debitAllocations: [{ accountNumber: opts.undepositedFundsAccount, storeId, bp: 10000 }],
            creditAllocations: [{ accountNumber: opts.unappliedCashAccount, storeId, bp: 10000 }],
          }],
        },
      },
      {
        ruleId: 'cash-receipt-applied',
        priority: 2,
        description: 'Applied cash receipt — relieves the AR control account (test-tenant fixture — D-S023-04).',
        condition: null,
        blueprint: {
          memoTemplate: 'Cash receipt applied — {{sourceEntityId}}',
          postingGroups: [{
            groupId: 'applied',
            baseAmountPath: 'payload.amount',
            debitAllocations: [{ accountNumber: opts.undepositedFundsAccount, storeId, bp: 10000 }],
            creditAllocations: [{ accountNumber: opts.arControlAccount, storeId, bp: 10000 }],
          }],
        },
      },
    ],
  };
}

/** D-S023-04: cash deposit — settles undeposited funds against the bank account. Never creates an AP/AR open item (D-S023-16). Test-tenant fixture. */
export function cashDepositPack(opts: TestTenantAccounts) {
  const storeId = opts.storeId ?? 'CERT-STORE-1';
  return {
    ...baseFields(opts, 's023-cash-deposit', S023_EVENT_TYPES.CASH_DEPOSIT_POSTED),
    rules: [{
      ruleId: 'cash-deposit-settlement',
      priority: 1,
      description: 'Cash deposit — bank account debited, undeposited funds relieved. No AP/AR open item (test-tenant fixture — D-S023-04).',
      condition: null,
      blueprint: {
        memoTemplate: 'Cash deposit — {{sourceEntityId}}',
        postingGroups: [{
          groupId: 'deposit',
          baseAmountPath: 'payload.amount',
          debitAllocations: [{ accountNumber: opts.bankCashAccount, storeId, bp: 10000 }],
          creditAllocations: [{ accountNumber: opts.undepositedFundsAccount, storeId, bp: 10000 }],
        }],
      },
    }],
  };
}

/**
 * D-S023-03: future AR invoice/charge — DEFINED_NOT_YET_EXERCISED. S048 has
 * no producer anywhere in this repository; this pack content proves the
 * configuration model is ready, but is intentionally never activated against
 * live traffic (no test submits a real event against it — there is no real
 * event to submit). Test-tenant fixture.
 */
export function arInvoicePack(opts: TestTenantAccounts) {
  const storeId = opts.storeId ?? 'CERT-STORE-1';
  return {
    ...baseFields(opts, 's023-ar-invoice-defined-not-yet-exercised', S023_EVENT_TYPES.AR_INVOICE_POSTED_REQUEST),
    rules: [{
      ruleId: 'ar-invoice-charge',
      priority: 1,
      description: 'DEFINED_NOT_YET_EXERCISED — customer invoice/charge posting; no S048 producer exists yet (test-tenant fixture — D-S023-03).',
      condition: null,
      blueprint: {
        memoTemplate: 'Customer invoice/charge — {{sourceEntityId}}',
        postingGroups: [{
          groupId: 'ar-charge',
          baseAmountPath: 'payload.amount',
          debitAllocations: [{ accountNumber: opts.arControlAccount, storeId, bp: 10000 }],
          creditAllocations: [{ accountNumber: opts.revenueAccount, storeId, deptCode: 'FIXTURE-DEPT', bp: 9000 }, { accountNumber: opts.outputTaxAccount, storeId, bp: 1000 }],
        }],
      },
    }],
  };
}
