import { describe, it, expect } from 'vitest';
import {
  validateOpenDrawer, canIssueReceipt, canVoidDirect, canSubmitBlindClose,
  canApproveVariance, canReconcile, isReconciled,
} from '../src/domain/cash-drawer';

describe('validateOpenDrawer', () => {
  const valid = { storeId: 's1', storeCode: 'S01', terminalCode: 'T1', cashierId: 'u1', businessDate: '2026-07-29', openingFloat: 100 };

  it('passes with all required fields', () => {
    expect(validateOpenDrawer(valid)).toEqual([]);
  });

  it('rejects a missing storeId', () => {
    const v = validateOpenDrawer({ ...valid, storeId: null });
    expect(v.some((x) => x.field === 'storeId')).toBe(true);
  });

  it('rejects a missing terminalCode', () => {
    const v = validateOpenDrawer({ ...valid, terminalCode: null });
    expect(v.some((x) => x.field === 'terminalCode')).toBe(true);
  });

  it('rejects a malformed businessDate', () => {
    const v = validateOpenDrawer({ ...valid, businessDate: '07/29/2026' });
    expect(v.some((x) => x.field === 'businessDate')).toBe(true);
  });

  it('rejects a negative opening float', () => {
    const v = validateOpenDrawer({ ...valid, openingFloat: -5 });
    expect(v.some((x) => x.field === 'openingFloat')).toBe(true);
  });

  it('allows a zero opening float', () => {
    expect(validateOpenDrawer({ ...valid, openingFloat: 0 })).toEqual([]);
  });
});

describe('drawer state-transition guards', () => {
  it('canIssueReceipt only true for OPEN', () => {
    expect(canIssueReceipt('OPEN')).toBe(true);
    expect(canIssueReceipt('BLIND_COUNT_SUBMITTED')).toBe(false);
    expect(canIssueReceipt('VARIANCE_REVIEW_REQUIRED')).toBe(false);
    expect(canIssueReceipt('RECONCILED')).toBe(false);
  });

  it('canVoidDirect only true for OPEN (rejected after blind-count submission)', () => {
    expect(canVoidDirect('OPEN')).toBe(true);
    expect(canVoidDirect('BLIND_COUNT_SUBMITTED')).toBe(false);
    expect(canVoidDirect('VARIANCE_REVIEW_REQUIRED')).toBe(false);
    expect(canVoidDirect('RECONCILED')).toBe(false);
  });

  it('canSubmitBlindClose only true for OPEN', () => {
    expect(canSubmitBlindClose('OPEN')).toBe(true);
    expect(canSubmitBlindClose('BLIND_COUNT_SUBMITTED')).toBe(false);
  });

  it('canApproveVariance only true for VARIANCE_REVIEW_REQUIRED', () => {
    expect(canApproveVariance('VARIANCE_REVIEW_REQUIRED')).toBe(true);
    expect(canApproveVariance('OPEN')).toBe(false);
    expect(canApproveVariance('BLIND_COUNT_SUBMITTED')).toBe(false);
  });

  it('canReconcile only true for BLIND_COUNT_SUBMITTED (blocks before blind close and while variance pending)', () => {
    expect(canReconcile('BLIND_COUNT_SUBMITTED')).toBe(true);
    expect(canReconcile('OPEN')).toBe(false);
    expect(canReconcile('VARIANCE_REVIEW_REQUIRED')).toBe(false);
    expect(canReconcile('RECONCILED')).toBe(false);
  });

  it('isReconciled only true for RECONCILED (permanently read-only)', () => {
    expect(isReconciled('RECONCILED')).toBe(true);
    expect(isReconciled('BLIND_COUNT_SUBMITTED')).toBe(false);
  });
});
