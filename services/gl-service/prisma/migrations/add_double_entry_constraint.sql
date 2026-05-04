-- Enforce debit = credit on every POSTED journal entry
-- Run as a trigger on status change to POSTED
-- This is a database-level safeguard that cannot be bypassed by application code.

CREATE OR REPLACE FUNCTION check_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
  total_debits NUMERIC;
  total_credits NUMERIC;
BEGIN
  IF NEW.status = 'POSTED' AND OLD.status != 'POSTED' THEN
    SELECT
      COALESCE(SUM(debit), 0),
      COALESCE(SUM(credit), 0)
    INTO total_debits, total_credits
    FROM journal_lines
    WHERE journal_entry_id = NEW.id;

    IF ABS(total_debits - total_credits) > 0.01 THEN
      RAISE EXCEPTION
        'Journal entry % cannot be posted: debits (%) do not equal credits (%). Difference: %',
        NEW.id,
        total_debits,
        total_credits,
        ABS(total_debits - total_credits);
    END IF;

    IF total_debits = 0 THEN
      RAISE EXCEPTION
        'Journal entry % cannot be posted: no journal lines found',
        NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_double_entry ON journal_entries;

CREATE TRIGGER enforce_double_entry
BEFORE UPDATE ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION check_journal_balance();
