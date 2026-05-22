-- BUILD-014: GL Account Subtotal Groups for Financial Statement Grouping
ALTER TABLE gl_accounts ADD COLUMN subtotal_group_1 CHAR(1) DEFAULT ' ';
ALTER TABLE gl_accounts ADD COLUMN subtotal_group_2 CHAR(1) DEFAULT ' ';
ALTER TABLE gl_accounts ADD COLUMN subtotal_group_3 CHAR(1) DEFAULT ' ';

-- BUILD-015: GL Account Control Number and Print Code Requirements
ALTER TABLE gl_accounts ADD COLUMN req_control_number CHAR(1) DEFAULT ' ';
-- ' ' = not required
-- 'A' = apply-to code required
-- 'D' = driver license number required (no lookup)
-- 'L' = lookup name required
-- 'S' = stock number required
-- '6' = last 6 VIN digits required

ALTER TABLE gl_accounts ADD COLUMN print_code CHAR(1) DEFAULT 'D';
-- 'D' = Detailed (print to financial statements)
-- 'S' = Summary only

CREATE INDEX idx_gl_accounts_control_number ON gl_accounts(tenant_id, req_control_number);
CREATE INDEX idx_gl_accounts_print_code ON gl_accounts(tenant_id, print_code);
