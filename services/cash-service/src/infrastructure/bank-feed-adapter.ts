// S053 — Bank feed adapter interface. No real feed processor is wired in
// this package; the adapter reports its state truthfully
// (BANK_FEED_NOT_CONFIGURED) rather than faking automatic ingestion. Manual
// import/match is always available regardless of adapter state — see
// application/bank-feed-service.ts.

export type BankFeedAdapterState = 'BANK_FEED_NOT_CONFIGURED' | 'CONFIGURED';

export interface BankFeedAdapter {
  getState(): BankFeedAdapterState;
  /** Returns [] when not configured — never fabricated feed lines. */
  fetchNewLines(bankAccountCode: string): Promise<Array<{
    externalId: string;
    amount: string;
    valueDate: string;
    description?: string;
  }>>;
}

/** Default adapter until a real bank-feed integration is wired. */
export class UnconfiguredBankFeedAdapter implements BankFeedAdapter {
  getState(): BankFeedAdapterState {
    return 'BANK_FEED_NOT_CONFIGURED';
  }
  async fetchNewLines(): Promise<Array<{ externalId: string; amount: string; valueDate: string; description?: string }>> {
    return [];
  }
}
