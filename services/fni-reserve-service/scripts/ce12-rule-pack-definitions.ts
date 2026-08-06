// CE-12 (Workstream R / S024 responsibility for this service's event
// families) — the 10 rule-pack DSL v1 definitions this service owns. Pure
// data + types, no I/O — imported by both seed-ce12-rule-packs.ts (which
// performs the actual coa-service HTTP calls) and this service's own unit
// tests (structural well-formedness proofs), so the two can never drift.
//
// Every event family is decomposed into its OWN single-posting-group rule
// pack rather than one multi-group pack per S091/S092/S093 story. Reason:
// coa-service's DSL rejects (BlueprintResolutionError -> REJECTED) any
// posting group whose baseAmountPath resolves to a non-positive amount —
// and several of this service's derived legs are legitimately $0 for a
// given event (e.g. a chargeback fully absorbed by the remaining reserve
// balance has $0 excess-to-expense; a cancellation at 0% pro-rata has $0 on
// every leg). A static multi-group rule pack cannot conditionally omit a
// zero-amount group, so each leg that can independently be zero gets its
// own event type, submitted by the application layer ONLY when that leg's
// amount is > 0. This is documented here once, not per-file.
//
// Every accountNumber below is the literal ACCOUNT_MAPPING_VALUES_PENDING
// sentinel (never a realistic-looking default) — see seed-ce12-rule-packs.ts
// for the separate, explicitly-labeled --test-tenant/--test-entity fixture
// path that substitutes real fixture GL accounts for testing/demo only.

export const ACCOUNT_MAPPING_VALUES_PENDING = 'ACCOUNT_MAPPING_VALUES_PENDING' as const;
/** Same sentinel convention as ACCOUNT_MAPPING_VALUES_PENDING, for the
 * storeId dimension (DSL v1 requires a non-empty storeId on every
 * allocation even before mapping is complete). */
export const STORE_MAPPING_PENDING = 'STORE_MAPPING_PENDING' as const;
export const DEPT_MAPPING_PENDING = 'DEPT_MAPPING_PENDING';

export interface RulePackAllocation {
  accountNumber: string;
  storeId: string;
  deptCode?: string | null;
  bp: number;
  controlNumberPath?: string | null;
  applyNumberPath?: string | null;
}

export interface RulePackDefinitionLite {
  dslVersion: 1;
  packKey: string;
  semver: string;
  eventType: string;
  supportedEventSchemaVersions: string[];
  tenantScope: string;
  entityId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  journalSourceCode: string;
  matchStrategy: 'FIRST_MATCH';
  noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION';
  rules: Array<{
    ruleId: string;
    priority: number;
    description: string;
    condition?: null;
    blueprint: {
      memoTemplate?: string | null;
      postingGroups: Array<{
        groupId: string;
        baseAmountPath: string;
        debitAllocations: RulePackAllocation[];
        creditAllocations: RulePackAllocation[];
      }>;
    };
  }>;
}

/** One-posting-group rule pack factory — every family below is this shape. */
function single(params: {
  packKey: string;
  eventType: string;
  description: string;
  memoTemplate: string;
  baseAmountPath: string;
  debitRole: string;
  debitAllocation: Omit<RulePackAllocation, 'accountNumber' | 'storeId'>;
  creditRole: string;
  creditAllocation: Omit<RulePackAllocation, 'accountNumber' | 'storeId'>;
  tenantScope: string;
  entityId: string;
  effectiveFrom: string;
}): RulePackDefinitionLite {
  return {
    dslVersion: 1,
    packKey: params.packKey,
    semver: '1.0.0',
    eventType: params.eventType,
    supportedEventSchemaVersions: ['v1'],
    tenantScope: params.tenantScope,
    entityId: params.entityId,
    effectiveFrom: params.effectiveFrom,
    effectiveTo: null,
    journalSourceCode: 'FNI',
    matchStrategy: 'FIRST_MATCH',
    noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
    rules: [
      {
        ruleId: `${params.packKey}.rule-1`,
        priority: 1,
        description: params.description,
        condition: null,
        blueprint: {
          memoTemplate: params.memoTemplate,
          postingGroups: [
            {
              groupId: 'g1',
              baseAmountPath: params.baseAmountPath,
              debitAllocations: [
                {
                  accountNumber: ACCOUNT_MAPPING_VALUES_PENDING,
                  storeId: STORE_MAPPING_PENDING,
                  ...params.debitAllocation,
                },
              ],
              creditAllocations: [
                {
                  accountNumber: ACCOUNT_MAPPING_VALUES_PENDING,
                  storeId: STORE_MAPPING_PENDING,
                  ...params.creditAllocation,
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

export interface RulePackFamilyOptions {
  tenantScope: string;
  entityId: string;
  effectiveFrom: string;
}

/** Build the full CE-12 fni-reserve-service rule-pack family for one tenant/entity. */
export function buildCe12FniReserveRulePacks(opts: RulePackFamilyOptions): RulePackDefinitionLite[] {
  return [
    // ── S091(a) — lender remittance relieves the reserve receivable ────────
    single({
      packKey: 'ce12.fni-reserve.remittance-relief',
      eventType: 'fni.reserve-remittance-relief.v1',
      description: 'S091(a): lender remittance relieves the reserve receivable item (applyNumber=dealNumber) originated by deal-accounting-service\'s S084 journal.',
      memoTemplate: 'Reserve remittance — deal {{payload.dealNumber}} ({{payload.lenderProgramCode}})',
      baseAmountPath: 'payload.reliefAmount',
      debitRole: 'Reserve remittance clearing (CE-09 cash-in-transit — PENDING_UPSTREAM_TECHNICAL_RECONCILIATION)',
      debitAllocation: { bp: 10_000 },
      creditRole: 'Reserve receivable (relieved via applyNumber=dealNumber, schedule 93, owned by deal-accounting-service)',
      // controlNumberPath required alongside applyNumberPath — see comment
      // on shortpay-writeoff below (same coa-service scheduleBridgeEvent
      // gating reason).
      creditAllocation: { bp: 10_000, controlNumberPath: 'payload.dealNumber', applyNumberPath: 'payload.dealNumber' },
      ...opts,
    }),
    // ── S091(b) — flat-% chargeback reserve accrual ────────────────────────
    // CE-12 gap-closure: this is schedule-service schedule 95 (Chargeback
    // Reserve Liability) — this service's OWN new item, originated HERE.
    // The schedule-linkage controlNumberPath MUST be payload.dealNumber
    // (<=10 chars, matching schedule-service's ScheduleDetail.controlNumber
    // VarChar(10)/itemNumber convention), NOT the composite CBR:{lender}:
    // {deal} value — that composite remains this service's own INTERNAL
    // ChargebackReserveAccrual/ChargebackDraw.controlNumber DB column
    // (grouping/tie-out key), unrelated to the GL-line/schedule-service key.
    single({
      packKey: 'ce12.fni-reserve.chargeback-accrual',
      eventType: 'fni.chargeback-reserve-accrual.v1',
      description: 'S091(b): flat CONFIGURED percentage of reserve income accrues to the chargeback-reserve liability (this service\'s own new subsidiary item — schedule-service schedule 95, controlNumber=dealNumber).',
      memoTemplate: 'Chargeback reserve accrual — deal {{payload.dealNumber}} ({{payload.lenderProgramCode}})',
      baseAmountPath: 'payload.accrualAmount',
      debitRole: 'Reserve income contra (chargeback reserve accrual)',
      debitAllocation: { bp: 10_000, deptCode: DEPT_MAPPING_PENDING },
      creditRole: 'Chargeback reserve liability (originated here — schedule 95, controlNumber=dealNumber)',
      creditAllocation: { bp: 10_000, controlNumberPath: 'payload.dealNumber' },
      ...opts,
    }),
    // ── S091(a) short-pay disposition: write off to expense ────────────────
    single({
      packKey: 'ce12.fni-reserve.shortpay-writeoff',
      eventType: 'fni.reserve-shortpay-writeoff.v1',
      description: 'S091(a): explicit short-pay disposition ceremony — write off the unremitted reserve-receivable shortfall to expense.',
      memoTemplate: 'Reserve short-pay write-off — deal {{payload.dealNumber}} ({{payload.lenderProgramCode}})',
      baseAmountPath: 'payload.shortPayAmount',
      debitRole: 'Reserve short-pay write-off expense',
      debitAllocation: { bp: 10_000, deptCode: DEPT_MAPPING_PENDING },
      creditRole: 'Reserve receivable (relieved via applyNumber=dealNumber, schedule 93, owned by deal-accounting-service)',
      // Relief leg — controlNumberPath is REQUIRED (in addition to
      // applyNumberPath) for coa-service to even emit the schedule-service
      // bridge event at all (posting-service.ts gates on line.controlNumber
      // being set, independent of applyNumber) — both must resolve to the
      // SAME value the originating item was opened under (dealNumber).
      creditAllocation: { bp: 10_000, controlNumberPath: 'payload.dealNumber', applyNumberPath: 'payload.dealNumber' },
      ...opts,
    }),
    // ── S091(c)/S093 shared — chargeback draws the reserve liability ───────
    single({
      packKey: 'ce12.fni-reserve.chargeback-draw-from-reserve',
      eventType: 'fni.chargeback-draw-from-reserve.v1',
      description: 'S091(c)/S093 shared: an actual chargeback draws the chargeback-reserve liability down (schedule 95, relieved via applyNumber=dealNumber, the same key the accrual leg originated it under) up to the remaining balance.',
      memoTemplate: 'Chargeback draw from reserve — deal {{payload.dealNumber}} ({{payload.lenderProgramCode}})',
      baseAmountPath: 'payload.drawFromReserveAmount',
      debitRole: 'Chargeback reserve liability (drawn — schedule 95, relieved via applyNumber=dealNumber)',
      debitAllocation: { bp: 10_000, controlNumberPath: 'payload.dealNumber', applyNumberPath: 'payload.dealNumber' },
      creditRole: 'Chargeback payable clearing (CE-09 disbursement rail — PENDING_UPSTREAM_TECHNICAL_RECONCILIATION)',
      creditAllocation: { bp: 10_000 },
      ...opts,
    }),
    single({
      packKey: 'ce12.fni-reserve.chargeback-draw-excess-expense',
      eventType: 'fni.chargeback-draw-excess-expense.v1',
      description: 'S091(c)/S093 shared: the portion of an actual chargeback exceeding the remaining reserve balance posts to expense.',
      memoTemplate: 'Chargeback excess to expense — deal {{payload.dealNumber}} ({{payload.lenderProgramCode}})',
      baseAmountPath: 'payload.excessToExpenseAmount',
      debitRole: 'Chargeback excess-over-reserve expense',
      debitAllocation: { bp: 10_000, deptCode: DEPT_MAPPING_PENDING },
      creditRole: 'Chargeback payable clearing (CE-09 disbursement rail — PENDING_UPSTREAM_TECHNICAL_RECONCILIATION)',
      creditAllocation: { bp: 10_000 },
      ...opts,
    }),
    // ── S092 — product remittance run relieves the remit-liability item ────
    single({
      packKey: 'ce12.fni-reserve.product-remit-relief',
      eventType: 'fni.product-remit-relief.v1',
      description: 'S092: one relieved line item within a remittance run — relieves the product remit-liability item (applyNumber=dealNumber:productCode) originated by deal-accounting-service\'s S084 journal.',
      memoTemplate: 'Product remit run — deal {{payload.dealNumber}} product {{payload.productCode}} ({{payload.providerCode}})',
      baseAmountPath: 'payload.amount',
      debitRole: 'Product remit liability (relieved via applyNumber=dealNumber:productCode, schedule 94, owned by deal-accounting-service)',
      // controlNumberPath required alongside applyNumberPath (coa-service's
      // scheduleBridgeEvent only fires when line.controlNumber is set) — see
      // the identical reasoning documented on shortpay-writeoff above.
      debitAllocation: { bp: 10_000, controlNumberPath: 'payload.applyControlNumber', applyNumberPath: 'payload.applyControlNumber' },
      creditRole: 'Provider remittance payment clearing (CE-09 payment rail — PENDING_UPSTREAM_TECHNICAL_RECONCILIATION)',
      creditAllocation: { bp: 10_000 },
      ...opts,
    }),
    // ── S093 — cancellation three legs (each its own event, submitted only when > 0) ──
    single({
      packKey: 'ce12.fni-reserve.cancellation-income-reversal',
      eventType: 'fni.cancellation-income-reversal.v1',
      description: 'S093 leg 1/3: income-reversal portion of a product cancellation — reverses a pro-rata share of the originally-recognized F&I product income.',
      memoTemplate: 'Cancellation income reversal — deal {{payload.dealNumber}} product {{payload.productCode}}',
      baseAmountPath: 'payload.incomeReversalAmount',
      debitRole: 'F&I product income (reversed)',
      debitAllocation: { bp: 10_000, deptCode: DEPT_MAPPING_PENDING },
      creditRole: 'Cancellation clearing',
      creditAllocation: { bp: 10_000 },
      ...opts,
    }),
    single({
      packKey: 'ce12.fni-reserve.cancellation-remit-adjustment',
      eventType: 'fni.cancellation-remit-adjustment.v1',
      description: 'S093 leg 2/3: remit-liability adjustment portion of a product cancellation — reduces what is owed the provider (applyNumber=dealNumber:productCode).',
      memoTemplate: 'Cancellation remit adjustment — deal {{payload.dealNumber}} product {{payload.productCode}}',
      baseAmountPath: 'payload.remitAdjustmentAmount',
      debitRole: 'Product remit liability (adjusted down via applyNumber=dealNumber:productCode, schedule 94, owned by deal-accounting-service)',
      debitAllocation: { bp: 10_000, controlNumberPath: 'payload.applyControlNumber', applyNumberPath: 'payload.applyControlNumber' },
      creditRole: 'Cancellation clearing',
      creditAllocation: { bp: 10_000 },
      ...opts,
    }),
    single({
      packKey: 'ce12.fni-reserve.cancellation-refund-payable',
      eventType: 'fni.cancellation-refund-payable.v1',
      description: 'S093 leg 3/3: customer/lender refund-payable portion of a product cancellation (this service\'s own new item — controlNumber convention {dealNumber}:{productCode}:CANCEL).',
      memoTemplate: 'Cancellation refund payable — deal {{payload.dealNumber}} product {{payload.productCode}}',
      baseAmountPath: 'payload.refundPayableAmount',
      debitRole: 'Cancellation clearing',
      debitAllocation: { bp: 10_000 },
      creditRole: 'Customer/lender refund payable (originated here — CE-09 disbursement rail PENDING_UPSTREAM_TECHNICAL_RECONCILIATION)',
      creditAllocation: { bp: 10_000, controlNumberPath: 'payload.controlNumber' },
      ...opts,
    }),
    // ── S094 — deferred-income liability ORIGINATION ────────────────────────
    // CE-12 gap-closure: schedule-service schedule 96 (Deferred Income
    // Liability) — this service's OWN new item, originated here at
    // deferral-booking registration time (POST /deferral-bookings). The
    // debit leg is a clearing account standing in for the real
    // upstream cash/receivable side deal-accounting-service's own S084
    // journal books in production (CE-09, PENDING_UPSTREAM_TECHNICAL_
    // RECONCILIATION) — never invented, always explicitly marked pending.
    single({
      packKey: 'ce12.fni-reserve.deferral-booking-origination',
      eventType: 'fni.deferral-booking-origination.v1',
      description: 'S094: registering a dealer-obligor deferred F&I product income booking originates the deferred-income liability item (this service\'s own new item — schedule 96, controlNumber=dealNumber-productCode, <=10 chars).',
      memoTemplate: 'Deferral booking origination — deal {{payload.dealNumber}} product {{payload.productCode}}',
      baseAmountPath: 'payload.originalAmount',
      debitRole: 'Deferred booking origination clearing (CE-09 upstream cash/receivable rail — PENDING_UPSTREAM_TECHNICAL_RECONCILIATION)',
      debitAllocation: { bp: 10_000 },
      creditRole: 'Deferred F&I product income liability (originated here — schedule 96, controlNumber=dealNumber-productCode)',
      creditAllocation: { bp: 10_000, controlNumberPath: 'payload.scheduleControlNumber' },
      ...opts,
    }),
    // ── S094 — deferred-income recognition run (relieves schedule 96) ──────
    single({
      packKey: 'ce12.fni-reserve.deferral-recognition',
      eventType: 'fni.deferral-recognition.v1',
      description: 'S094: one recognition-run line posting — relieves the deferred-income liability item (schedule 96, applyNumber=dealNumber-productCode, originated by ce12.fni-reserve.deferral-booking-origination above) and recognizes the earned income.',
      memoTemplate: 'Deferral recognition — deal {{payload.dealNumber}} product {{payload.productCode}}',
      baseAmountPath: 'payload.earnedAmount',
      debitRole: 'Deferred F&I product income liability (relieved via applyNumber=dealNumber-productCode, schedule 96)',
      debitAllocation: { bp: 10_000, controlNumberPath: 'payload.scheduleControlNumber', applyNumberPath: 'payload.scheduleControlNumber' },
      creditRole: 'F&I product income (recognized)',
      creditAllocation: { bp: 10_000, deptCode: DEPT_MAPPING_PENDING },
      ...opts,
    }),
  ];
}
