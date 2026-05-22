-- FIX-013: Add sort_key column to gl_accounts for display ordering
-- @cobol-origin GLBYID-SORTNO (20 chars) — display ordering key for Chart of Accounts
-- @trace-improvement Allows COA ordering by sort_key instead of only by code

ALTER TABLE gl_accounts ADD COLUMN sort_key VARCHAR(20) DEFAULT NULL;

-- Index for efficient ordering by sort_key
CREATE INDEX idx_gl_accounts_sort ON gl_accounts(tenant_id, sort_key);
