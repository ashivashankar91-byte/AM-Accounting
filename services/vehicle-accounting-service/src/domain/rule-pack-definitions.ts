// S024 (CE-12 scope) — pure builder for this service's eight `ce12.*`
// posting-engine rule-pack definitions. No I/O, no CLI parsing — imported
// by both scripts/seed-ce12-rule-packs.ts (the REST-authoring CLI) and this
// service's unit tests (structural assertions: bp sums to 10000, packKey
// prefix, eventType pattern, dslVersion, etc.), so the exact JSON shape
// shipped to coa-service is verifiable without a live coa-service.
//
// TWO SEPARATE, EXPLICITLY-LABELED MODES (never conflated) — see
// scripts/seed-ce12-rule-packs.ts's header comment for the full rationale:
//   - blank/pending (default): every allocation's accountNumber is the
//     literal sentinel ACCOUNT_MAPPING_VALUES_PENDING.
//   - test-fixture: every allocation's accountNumber is a real "CE-12 TEST
//     FIXTURE" GL account number, deptCode set on P&L-typed roles.
export const ACCOUNT_MAPPING_VALUES_PENDING = 'ACCOUNT_MAPPING_VALUES_PENDING';
export const JOURNAL_SOURCE_CODE = 'CE12';
const DEFAULT_DEPT_CODE = '100';
const EFFECTIVE_FROM = '2020-01-01T00:00:00.000Z';

export type VehicleAccountingGlRole =
  | 'VEHICLE_INVENTORY' | 'VEHICLE_INVENTORY_DEMO'
  | 'AP_FACTORY_AUCTION_CLEARING' | 'TRADE_ALLOWANCE_CLEARING' | 'DEALER_TRADE_STOCKIN_CLEARING'
  | 'PACK_INCOME_CLEARING' | 'HOLDBACK_CLEARING' | 'RECON_CLEARING'
  | 'DEMO_DEPRECIATION_EXPENSE' | 'LCNRV_WRITEDOWN_EXPENSE'
  | 'DEALER_TRADE_RECEIVABLE' | 'DEALER_TRADE_PAYABLE'
  | 'GAIN_ON_DEALER_TRADE' | 'LOSS_ON_DEALER_TRADE';

export interface RoleFixture {
  accountNumber: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'REVENUE' | 'EXPENSE';
  plType: boolean;
}

export const ROLE_FIXTURES: Record<VehicleAccountingGlRole, RoleFixture> = {
  VEHICLE_INVENTORY:             { accountNumber: '19001', name: 'CE-12 TEST FIXTURE — Vehicle Inventory (do not use in production)', type: 'ASSET', plType: false },
  VEHICLE_INVENTORY_DEMO:        { accountNumber: '19002', name: 'CE-12 TEST FIXTURE — Demo Vehicle Inventory (do not use in production)', type: 'ASSET', plType: false },
  AP_FACTORY_AUCTION_CLEARING:   { accountNumber: '19003', name: 'CE-12 TEST FIXTURE — Factory/Auction AP Clearing (do not use in production)', type: 'LIABILITY', plType: false },
  TRADE_ALLOWANCE_CLEARING:      { accountNumber: '19004', name: 'CE-12 TEST FIXTURE — Trade Allowance Clearing (do not use in production)', type: 'LIABILITY', plType: false },
  DEALER_TRADE_STOCKIN_CLEARING: { accountNumber: '19005', name: 'CE-12 TEST FIXTURE — Dealer Trade Stock-In Clearing (do not use in production)', type: 'LIABILITY', plType: false },
  PACK_INCOME_CLEARING:          { accountNumber: '19006', name: 'CE-12 TEST FIXTURE — Pack Income (do not use in production)', type: 'REVENUE', plType: true },
  HOLDBACK_CLEARING:             { accountNumber: '19007', name: 'CE-12 TEST FIXTURE — Holdback Clearing (do not use in production)', type: 'LIABILITY', plType: false },
  RECON_CLEARING:                { accountNumber: '19008', name: 'CE-12 TEST FIXTURE — Reconditioning RO Clearing (do not use in production)', type: 'LIABILITY', plType: false },
  DEMO_DEPRECIATION_EXPENSE:     { accountNumber: '19009', name: 'CE-12 TEST FIXTURE — Demo Depreciation Expense (do not use in production)', type: 'EXPENSE', plType: true },
  LCNRV_WRITEDOWN_EXPENSE:       { accountNumber: '19010', name: 'CE-12 TEST FIXTURE — LCNRV Write-down Expense (do not use in production)', type: 'EXPENSE', plType: true },
  DEALER_TRADE_RECEIVABLE:       { accountNumber: '19011', name: 'CE-12 TEST FIXTURE — Dealer Trade Receivable (do not use in production)', type: 'ASSET', plType: false },
  DEALER_TRADE_PAYABLE:          { accountNumber: '19012', name: 'CE-12 TEST FIXTURE — Dealer Trade Payable (do not use in production)', type: 'LIABILITY', plType: false },
  GAIN_ON_DEALER_TRADE:          { accountNumber: '19013', name: 'CE-12 TEST FIXTURE — Gain on Dealer Trade (do not use in production)', type: 'REVENUE', plType: true },
  LOSS_ON_DEALER_TRADE:          { accountNumber: '19014', name: 'CE-12 TEST FIXTURE — Loss on Dealer Trade (do not use in production)', type: 'EXPENSE', plType: true },
};

// ── Real schedule-service linkage (CE-12 gap-close) ─────────────────────────
// This service's ASSIGNED 2-digit schedule-service scheduleNumbers — tenant-
// scoped so no coordination is needed with the sibling CE-12 services
// (floorplan-service, deal-accounting-service, fni-reserve-service) doing
// the equivalent work concurrently. Consumed by both
// scripts/seed-ce12-rule-packs.ts (--test-tenant fixture provisioning: it
// creates these 3 real schedule-service Schedule rows and PATCHes
// GlAccount.scheduleCode onto the corresponding fixture GL account) and
// infrastructure/schedule-client.ts's real open-item inquiry/relief methods
// (the authoritative tie-out balance for these 3 roles).
export const SCHEDULE_NUMBERS = {
  VEHICLE_UNIT_INVENTORY: '80',
  DEALER_TRADE_RECEIVABLE: '81',
  DEALER_TRADE_PAYABLE: '82',
} as const;

export interface ScheduleLink {
  scheduleNumber: string;
  title: string;
}

/** Only the 3 roles this epic assigns a real schedule to (S074 unit
 * inventory, S077 outbound/inbound dealer-trade clearing). Every other
 * VehicleAccountingGlRole has no schedule-service linkage. */
export const SCHEDULE_LINKS: Partial<Record<VehicleAccountingGlRole, ScheduleLink>> = {
  VEHICLE_INVENTORY: { scheduleNumber: SCHEDULE_NUMBERS.VEHICLE_UNIT_INVENTORY, title: 'Vehicle Unit Inventory' },
  DEALER_TRADE_RECEIVABLE: { scheduleNumber: SCHEDULE_NUMBERS.DEALER_TRADE_RECEIVABLE, title: 'Dealer-Trade Receivable' },
  DEALER_TRADE_PAYABLE: { scheduleNumber: SCHEDULE_NUMBERS.DEALER_TRADE_PAYABLE, title: 'Dealer-Trade Payable' },
};

export interface BuildPacksOptions {
  tenantId: string;
  entityId: string;
  storeId: string;
  testFixtureMode: boolean;
}

export function buildRulePacks(opts: BuildPacksOptions): Array<Record<string, unknown>> {
  const { tenantId, entityId, storeId, testFixtureMode } = opts;

  function accountFor(role: VehicleAccountingGlRole): string {
    return testFixtureMode ? ROLE_FIXTURES[role].accountNumber : ACCOUNT_MAPPING_VALUES_PENDING;
  }
  function deptCodeFor(role: VehicleAccountingGlRole): string | undefined {
    return testFixtureMode && ROLE_FIXTURES[role].plType ? DEFAULT_DEPT_CODE : undefined;
  }
  function alloc(role: VehicleAccountingGlRole, bp: number, extra?: { controlNumberPath?: string; applyNumberPath?: string }) {
    return {
      accountNumber: accountFor(role),
      storeId,
      ...(deptCodeFor(role) ? { deptCode: deptCodeFor(role) } : {}),
      bp,
      ...(extra?.controlNumberPath ? { controlNumberPath: extra.controlNumberPath } : {}),
      ...(extra?.applyNumberPath ? { applyNumberPath: extra.applyNumberPath } : {}),
    };
  }
  function group(groupId: string, baseAmountPath: string, debit: unknown[], credit: unknown[]) {
    return { groupId, baseAmountPath, debitAllocations: debit, creditAllocations: credit };
  }
  function pack(packKey: string, eventType: string, rules: unknown[]) {
    return {
      dslVersion: 1,
      packKey,
      semver: '1.0.0',
      eventType,
      supportedEventSchemaVersions: ['1'],
      tenantScope: tenantId,
      entityId,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      journalSourceCode: JOURNAL_SOURCE_CODE,
      matchStrategy: 'FIRST_MATCH',
      noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
      rules,
    };
  }

  const vehicleStocked = pack('ce12.vehicle-stocked', 'vehicle.stocked.v1', [
    {
      ruleId: 'trade-in', priority: 10, description: 'Stock-in credited to trade-allowance clearing (acquisitionType=TRADE_IN)',
      condition: { equals: { path: 'payload.acquisitionType', value: 'TRADE_IN' } },
      blueprint: { memoTemplate: 'Stock-in {{payload.stockNumber}} (trade-in)', postingGroups: [
        group('invoice', 'payload.invoiceCost', [alloc('VEHICLE_INVENTORY', 10_000, { controlNumberPath: 'payload.stockNumber' })], [alloc('TRADE_ALLOWANCE_CLEARING', 10_000)]),
      ] },
    },
    {
      ruleId: 'dealer-trade-in', priority: 20, description: 'Stock-in credited to dealer-trade stock-in clearing (acquisitionType=DEALER_TRADE_IN)',
      condition: { equals: { path: 'payload.acquisitionType', value: 'DEALER_TRADE_IN' } },
      blueprint: { memoTemplate: 'Stock-in {{payload.stockNumber}} (dealer trade-in)', postingGroups: [
        group('invoice', 'payload.invoiceCost', [alloc('VEHICLE_INVENTORY', 10_000, { controlNumberPath: 'payload.stockNumber' })], [alloc('DEALER_TRADE_STOCKIN_CLEARING', 10_000)]),
      ] },
    },
    {
      ruleId: 'purchase-or-factory', priority: 40, description: 'Stock-in credited to factory/auction AP clearing (PURCHASE / FACTORY_RECEIPT, and default)',
      condition: null,
      blueprint: { memoTemplate: 'Stock-in {{payload.stockNumber}}', postingGroups: [
        group('invoice', 'payload.invoiceCost', [alloc('VEHICLE_INVENTORY', 10_000, { controlNumberPath: 'payload.stockNumber' })], [alloc('AP_FACTORY_AUCTION_CLEARING', 10_000)]),
      ] },
    },
  ]);

  const vehicleCostComponentAdded = pack('ce12.vehicle-cost-component-added', 'vehicle.cost-component-added.v1', [
    {
      ruleId: 'transport', priority: 10, description: 'Transport cost added to unit basis',
      condition: { equals: { path: 'payload.componentType', value: 'TRANSPORT' } },
      blueprint: { memoTemplate: 'Transport cost — {{payload.stockNumber}}', postingGroups: [
        group('transport', 'payload.amount', [alloc('VEHICLE_INVENTORY', 10_000, { controlNumberPath: 'payload.stockNumber' })], [alloc('AP_FACTORY_AUCTION_CLEARING', 10_000)]),
      ] },
    },
    {
      ruleId: 'pack-income', priority: 20, description: 'Pack cost added to unit basis, pack role = PACK_INCOME',
      condition: { equals: { path: 'payload.packRole', value: 'PACK_INCOME' } },
      blueprint: { memoTemplate: 'Pack cost — {{payload.stockNumber}}', postingGroups: [
        group('pack', 'payload.amount', [alloc('VEHICLE_INVENTORY', 10_000, { controlNumberPath: 'payload.stockNumber' })], [alloc('PACK_INCOME_CLEARING', 10_000)]),
      ] },
    },
    {
      ruleId: 'pack-holdback', priority: 30, description: 'Pack cost added to unit basis, pack role = HOLDBACK_CLEARING',
      condition: { equals: { path: 'payload.packRole', value: 'HOLDBACK_CLEARING' } },
      blueprint: { memoTemplate: 'Pack cost — {{payload.stockNumber}}', postingGroups: [
        group('pack', 'payload.amount', [alloc('VEHICLE_INVENTORY', 10_000, { controlNumberPath: 'payload.stockNumber' })], [alloc('HOLDBACK_CLEARING', 10_000)]),
      ] },
    },
    {
      ruleId: 'equipment', priority: 40, description: 'Added equipment cost added to unit basis',
      condition: { equals: { path: 'payload.componentType', value: 'EQUIPMENT' } },
      blueprint: { memoTemplate: 'Equipment cost — {{payload.stockNumber}}', postingGroups: [
        group('equipment', 'payload.amount', [alloc('VEHICLE_INVENTORY', 10_000, { controlNumberPath: 'payload.stockNumber' })], [alloc('AP_FACTORY_AUCTION_CLEARING', 10_000)]),
      ] },
    },
  ]);

  const vehicleReconCostAdded = pack('ce12.vehicle-recon-cost-added', 'vehicle.recon-cost-added.v1', [
    {
      ruleId: 'recon-cost', priority: 10, description: 'Reconditioning RO cost added to unit basis (CE-11 boundary)',
      condition: null,
      blueprint: { memoTemplate: 'Recon RO {{payload.roNumber}} — {{payload.stockNumber}}', postingGroups: [
        group('recon', 'payload.amount', [alloc('VEHICLE_INVENTORY', 10_000, { controlNumberPath: 'payload.stockNumber' })], [alloc('RECON_CLEARING', 10_000)]),
      ] },
    },
  ]);

  const vehicleDemoReclassed = pack('ce12.vehicle-demo-reclassed', 'vehicle.demo-reclassed.v1', [
    {
      ruleId: 'reclass-new-to-demo', priority: 10, description: 'Reclass NEW -> DEMO: move full unit value between inventory sub-accounts',
      condition: null,
      blueprint: { memoTemplate: 'Demo reclass — {{payload.stockNumber}}', postingGroups: [
        group('reclass', 'payload.unitValue', [alloc('VEHICLE_INVENTORY_DEMO', 10_000, { controlNumberPath: 'payload.stockNumber' })], [alloc('VEHICLE_INVENTORY', 10_000, { applyNumberPath: 'payload.stockNumber' })]),
      ] },
    },
  ]);

  const vehicleDemoValueAdjusted = pack('ce12.vehicle-demo-value-adjusted', 'vehicle.demo-value-adjusted.v1', [
    {
      ruleId: 'demo-depreciation', priority: 10, description: 'Approved periodic demo value adjustment (preview-approve; never auto-posts)',
      condition: null,
      blueprint: { memoTemplate: 'Demo value adjustment — {{payload.stockNumber}}', postingGroups: [
        group('adjustment', 'payload.adjustmentAmount', [alloc('DEMO_DEPRECIATION_EXPENSE', 10_000)], [alloc('VEHICLE_INVENTORY_DEMO', 10_000, { applyNumberPath: 'payload.stockNumber' })]),
      ] },
    },
  ]);

  const vehicleLcnrvWritedown = pack('ce12.vehicle-lcnrv-writedown', 'vehicle.lcnrv-writedown.v1', [
    {
      ruleId: 'lcnrv-writedown', priority: 10, description: 'LCNRV write-down (one-way; reviewed amount exactly)',
      condition: null,
      blueprint: { memoTemplate: 'LCNRV write-down — {{payload.stockNumber}}', postingGroups: [
        group('writedown', 'payload.writeDownAmount', [alloc('LCNRV_WRITEDOWN_EXPENSE', 10_000)], [alloc('VEHICLE_INVENTORY', 10_000, { applyNumberPath: 'payload.stockNumber' })]),
      ] },
    },
  ]);

  const vehicleDealerTradeOutbound = pack('ce12.vehicle-dealer-trade-outbound', 'vehicle.dealer-trade-outbound.v1', [
    {
      ruleId: 'outbound-gain', priority: 10, description: 'Outbound trade above book value: receivable = book + gain',
      condition: { equals: { path: 'payload.tradeOutcome', value: 'GAIN' } },
      blueprint: { memoTemplate: 'Dealer trade outbound {{payload.tradeNumber}} — {{payload.stockNumber}}', postingGroups: [
        group('cost-recovery', 'payload.bookValue', [alloc('DEALER_TRADE_RECEIVABLE', 10_000, { controlNumberPath: 'payload.tradeNumber' })], [alloc('VEHICLE_INVENTORY', 10_000, { applyNumberPath: 'payload.stockNumber' })]),
        group('gain', 'payload.gainLossAmount', [alloc('DEALER_TRADE_RECEIVABLE', 10_000, { controlNumberPath: 'payload.tradeNumber' })], [alloc('GAIN_ON_DEALER_TRADE', 10_000)]),
      ] },
    },
    {
      ruleId: 'outbound-loss', priority: 20, description: 'Outbound trade below book value: receivable = book - loss',
      condition: { equals: { path: 'payload.tradeOutcome', value: 'LOSS' } },
      blueprint: { memoTemplate: 'Dealer trade outbound {{payload.tradeNumber}} — {{payload.stockNumber}}', postingGroups: [
        group('cost-recovery', 'payload.bookValue', [alloc('DEALER_TRADE_RECEIVABLE', 10_000, { controlNumberPath: 'payload.tradeNumber' })], [alloc('VEHICLE_INVENTORY', 10_000, { applyNumberPath: 'payload.stockNumber' })]),
        group('loss', 'payload.gainLossAmount', [alloc('LOSS_ON_DEALER_TRADE', 10_000)], [alloc('DEALER_TRADE_RECEIVABLE', 10_000, { controlNumberPath: 'payload.tradeNumber' })]),
      ] },
    },
    {
      ruleId: 'outbound-even', priority: 30, description: 'Outbound trade exactly at book value: no gain/loss leg',
      condition: null,
      blueprint: { memoTemplate: 'Dealer trade outbound {{payload.tradeNumber}} — {{payload.stockNumber}}', postingGroups: [
        group('cost-recovery', 'payload.bookValue', [alloc('DEALER_TRADE_RECEIVABLE', 10_000, { controlNumberPath: 'payload.tradeNumber' })], [alloc('VEHICLE_INVENTORY', 10_000, { applyNumberPath: 'payload.stockNumber' })]),
      ] },
    },
  ]);

  const vehicleDealerTradeInbound = pack('ce12.vehicle-dealer-trade-inbound', 'vehicle.dealer-trade-inbound.v1', [
    {
      ruleId: 'inbound', priority: 10, description: 'Inbound trade unit born at ACV',
      condition: null,
      blueprint: { memoTemplate: 'Dealer trade inbound {{payload.tradeNumber}} — {{payload.stockNumber}}', postingGroups: [
        group('acv', 'payload.acv', [alloc('VEHICLE_INVENTORY', 10_000, { controlNumberPath: 'payload.stockNumber' })], [alloc('DEALER_TRADE_PAYABLE', 10_000, { controlNumberPath: 'payload.tradeNumber' })]),
      ] },
    },
  ]);

  const vehicleDealerTradeSettled = pack('ce12.vehicle-dealer-trade-settled', 'vehicle.dealer-trade-settled.v1', [
    {
      ruleId: 'settle', priority: 10, description: 'Settlement nets receivable/payable per trade doc (cash difference is a CE-09 concept, not posted here)',
      condition: null,
      blueprint: { memoTemplate: 'Dealer trade settlement {{payload.tradeNumber}}', postingGroups: [
        group('net', 'payload.nettedAmount', [alloc('DEALER_TRADE_PAYABLE', 10_000, { applyNumberPath: 'payload.tradeNumber' })], [alloc('DEALER_TRADE_RECEIVABLE', 10_000, { applyNumberPath: 'payload.tradeNumber' })]),
      ] },
    },
  ]);

  return [
    vehicleStocked,
    vehicleCostComponentAdded,
    vehicleReconCostAdded,
    vehicleDemoReclassed,
    vehicleDemoValueAdjusted,
    vehicleLcnrvWritedown,
    vehicleDealerTradeOutbound,
    vehicleDealerTradeInbound,
    vehicleDealerTradeSettled,
  ];
}
