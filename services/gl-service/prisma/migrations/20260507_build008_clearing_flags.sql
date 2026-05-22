-- BUILD-008: Cash Clearing Flags and Bank Reconciliation Support
-- @cobol-origin GL-CASH-CLEAR, GL-DEPOSIT-CLEAR, HI-CLEAR-CODE

ALTER TABLE gl_accounts
  ADD COLUMN is_cash_clearing BOOLEAN DEFAULT false,
  ADD COLUMN is_deposit_clearing BOOLEAN DEFAULT false;

ALTER TABLE history_transactions
  ADD COLUMN clear_code CHAR(1) DEFAULT ' ';

CREATE INDEX idx_history_transactions_clear
  ON history_transactions(tenant_id, gl_account_id, clear_code)
  WHERE clear_code = ' ';
