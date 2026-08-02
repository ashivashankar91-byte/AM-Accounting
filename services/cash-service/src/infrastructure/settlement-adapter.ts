// S055 — Settlement file ingestion adapter. No real card processor is
// wired in this package (manual import is always available regardless —
// see application/settlement-service.ts). Mirrors the truthful-adapter-
// state pattern of infrastructure/bank-feed-adapter.ts.

export type SettlementAdapterState = 'SETTLEMENT_FEED_NOT_CONFIGURED' | 'CONFIGURED';

export interface SettlementAdapter {
  getState(): SettlementAdapterState;
}

export class UnconfiguredSettlementAdapter implements SettlementAdapter {
  getState(): SettlementAdapterState {
    return 'SETTLEMENT_FEED_NOT_CONFIGURED';
  }
}
