import { describe, it, expect } from 'vitest';
import { computeOutboundTrade, computeSettlement, DealerTradeValidationError } from '../../src/domain/dealer-trade';

describe('dealer-trade domain', () => {
  describe('computeOutboundTrade', () => {
    it('EVEN when agreedValue equals bookValue', () => {
      const r = computeOutboundTrade(2_000_000, 2_000_000);
      expect(r.outcome).toBe('EVEN');
      expect(r.gainLossCents).toBe(0);
    });
    it('GAIN when agreedValue exceeds bookValue', () => {
      const r = computeOutboundTrade(2_100_000, 2_000_000);
      expect(r.outcome).toBe('GAIN');
      expect(r.gainLossCents).toBe(100_000);
    });
    it('LOSS when agreedValue is below bookValue', () => {
      const r = computeOutboundTrade(1_900_000, 2_000_000);
      expect(r.outcome).toBe('LOSS');
      expect(r.gainLossCents).toBe(100_000);
    });
    it('rejects non-positive agreedValue or bookValue', () => {
      expect(() => computeOutboundTrade(0, 2_000_000)).toThrow(DealerTradeValidationError);
      expect(() => computeOutboundTrade(2_000_000, 0)).toThrow(DealerTradeValidationError);
    });
  });

  describe('computeSettlement', () => {
    it('nets to the smaller of receivable/payable, difference is the cash leg', () => {
      const r = computeSettlement(500_000, 300_000);
      expect(r.nettedCents).toBe(300_000);
      expect(r.cashDifferenceCents).toBe(200_000);
    });
    it('nets fully when both sides are equal, zero cash difference', () => {
      const r = computeSettlement(400_000, 400_000);
      expect(r.nettedCents).toBe(400_000);
      expect(r.cashDifferenceCents).toBe(0);
    });
    it('handles a one-sided trade (only outbound or only inbound exists)', () => {
      const r = computeSettlement(400_000, 0);
      expect(r.nettedCents).toBe(0);
      expect(r.cashDifferenceCents).toBe(400_000);
    });
    it('rejects negative inputs', () => {
      expect(() => computeSettlement(-1, 100)).toThrow(DealerTradeValidationError);
    });
  });
});
