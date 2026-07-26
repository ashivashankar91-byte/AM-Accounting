// S210 — Chart of Accounts domain logic (pure, no I/O).

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type NormalBalance = 'DR' | 'CR';
export type AccountStatus = 'ACTIVE' | 'INACTIVE';

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
];

export const NORMAL_BALANCES: readonly NormalBalance[] = ['DR', 'CR'];

const ACCOUNT_NUMBER_RE = /^\d{5}$/;

/** BR210-3 — normal balance defaulted by type. */
export function defaultNormalBalance(type: AccountType): NormalBalance {
  switch (type) {
    case 'ASSET':
    case 'EXPENSE':
      return 'DR';
    case 'LIABILITY':
    case 'EQUITY':
    case 'REVENUE':
      return 'CR';
  }
}

/** A contra account carries the opposite normal balance to its type default. */
export function isContra(type: AccountType, normalBalance: NormalBalance): boolean {
  return normalBalance !== defaultNormalBalance(type);
}

export function isValidAccountNumber(n: string): boolean {
  // UQ-14 may extend the format; today the canonical baseline is 5 digits.
  return ACCOUNT_NUMBER_RE.test(n);
}

export function isValidType(t: string): t is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(t);
}

export function isValidNormalBalance(b: string): b is NormalBalance {
  return (NORMAL_BALANCES as readonly string[]).includes(b);
}

export function isValidName(name: string): boolean {
  return name.length >= 1 && name.length <= 120;
}
