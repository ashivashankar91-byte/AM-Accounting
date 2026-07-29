# S008 Integrated-Runtime — Migration Replay Report

Against the isolated `amacc-r1int-s008-cert` Postgres (empty at start — `\dt` returned no relations), ran `npx prisma migrate deploy` (never `db push`, never `migrate diff`) as the `amacc` superuser (the `amacc_app` runtime role is DML-only by design — DDL/migrate deploy must run as the schema-owning superuser, confirmed by `infra/postgres/init/01-create-app-role.sql`'s own comments), in the order: auth-service → tenant-service → coa-service → gl-service → audit-service.

| Service | Migrations applied | Last migration | Result |
|---|---|---|---|
| auth-service | 17 | `20260728050000_extend_authz_catalog_s008_period_close` | zero errors |
| tenant-service | 9 | `20260727000002_add_org_reparent_events` | zero errors |
| coa-service | 20 | `20260728010000_s008_period_close_control` | zero errors |
| gl-service | 33 | `20260728010006_drop_legacy_trial_balance_unique_gl_svc` | zero errors |
| audit-service | 7 | `20260727100000_add_chain_verified_from` | zero errors |

**86/86 total migrations applied, 0 errors.** Verified via `SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL` = 86.

## S008 database-object verification (against this isolated instance)

| Check | Result |
|---|---|
| `amacc_period_ledger_writer` role exists | ✅ |
| Role is NOLOGIN-equivalent (`rolcanlogin=f`), non-superuser (`rolsuper=f`), no BYPASSRLS (`rolbypassrls=f`) | ✅ |
| `fiscal_period_transition` RLS enabled + forced | ✅ (`relrowsecurity=t`, `relforcerowsecurity=t`) |
| `adjusting_entry_attestation` RLS enabled + forced | ✅ (same) |
| 5 S008 RLS policies present | ✅ (`tenant_isolation_select` ×2, `ledger_writer_insert` ×2, `ledger_writer_update` ×1) |
| `record_period_transition` / `record_adjusting_attestation` are `SECURITY DEFINER` | ✅ (`prosecdef=t` both) |
| `trg_enforce_period_transition`, `trg_enforce_period_postable`, `trg_enforce_journal_adjusting_immutable` exist and enabled | ✅ (`tgenabled='O'` all three) |
| All S008 columns present (`closed_by`/`closed_at`/`locked_by`/`locked_at` on `fiscal_period`; `is_adjusting`/`adjusting_reason`/`adjusting_correction_ref` on `journal_entry` and `manual_je_draft`) | ✅ |
| All 6 S008 permission keys present (`fiscal.period.soft_close`/`hard_close`/`reopen`/`reopen_hard_closed`/`lock`, `fiscal.je.mark_adjusting`) | ✅ |
| Role grants match the certified matrix (ADMIN+CONTROLLER: soft_close/hard_close/reopen; ADMIN-only: reopen_hard_closed/lock; ADMIN+CONTROLLER+ACCOUNTANT: mark_adjusting) | ✅ (verified via direct `role_permission` query) |

Exact queries and raw output preserved in this session's transcript; summarized here for the permanent record.
