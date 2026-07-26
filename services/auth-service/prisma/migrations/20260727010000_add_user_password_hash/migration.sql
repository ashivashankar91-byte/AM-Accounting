-- FINAL-R0 Foundation Completion: S205 login/session capability.
-- Prior to this migration, no user-authenticable credential existed anywhere
-- in the schema — S205 only supported invite/deactivate/unlock/reset, none of
-- which ever let a real user establish a real session (MODULE_STATE.json
-- carry-forward: "no real login/session-issuance endpoint exists"). This adds
-- a nullable password hash column so an INVITED/reset user can set a password
-- (via the existing one-time resetToken flow) and subsequently log in with
-- email + password to receive a real JWT-backed Session row.
ALTER TABLE "user" ADD COLUMN "password_hash" TEXT;
