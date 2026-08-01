# S023 — PERMISSION MATRIX (approved 2026-08-01)

Status: `S023_APPROVED_EXCEPT_ACCOUNT_MAPPING_VALUES`. See `S023_DECISION_REGISTER.md` for the full decision record.

**Reconciliation note:** the Downloads-generated draft of this matrix proposed new permission strings (`rules.pack.view`, `rules.pack.edit_draft`, `rules.pack.activate`, `rules.replay`). Repository evidence (`S023_EXISTING_ARCHITECTURE_MAP.md` §3) confirms the real, already-live permission set uses a different, established naming convention: `posting_engine.<noun>.<verb>` — 6 permissions already exist from S019/S020 (catalog v1.16.0): `posting_engine.rule_pack.{view,edit,validate,activate}`, `posting_engine.execution.view`, `posting_engine.exception.view`. Per D-S023-29's approved instruction ("reuse the existing namespace... extend only for genuinely new capabilities"), this matrix reuses those exact strings below rather than the Downloads draft's proposed names. Next free auth-catalog slot: `1.27.0`.

| Action | Permission | Status | SoD rule |
|---|---|---|---|
| View packs/versions/history | `posting_engine.rule_pack.view` | Existing (reused) | — |
| Create/edit DRAFT pack version | `posting_engine.rule_pack.edit` | Existing (reused) | Author identity recorded per version |
| Validate DRAFT pack version | `posting_engine.rule_pack.validate` | Existing (reused) | — |
| Activate pack version | `posting_engine.rule_pack.activate` | Existing (reused) — activation-refusal logic is new (D-28) | **Identity-based SoD (D-28): creator or material editor of vX cannot activate vX; refusal is named + audited; activation requires a separately authorized user** |
| View executions | `posting_engine.execution.view` | Existing (reused) | — |
| View posting exceptions | `posting_engine.exception.view` | Existing (reused) | — |
| Simulate/dry-run evaluation | *New — exact string TBD at CE-07 Step-0, under the `posting_engine.` namespace* | New (D-33) | Read-adjacent; no posting occurs |
| Replay failed event | `posting-recovery.replay.execute` (S021's own existing permission, ADMIN+CONTROLLER only) | Existing (reused, not a new S023 string) | **Distinct from authoring AND activation rights (D-28); replay requires reason; audited with dual-version trail (D-25)** |
| View DLQ/recovery cases | Per S021's existing permissions | Existing (reused) | — |

## Audit (D-30)

Pack lifecycle events; per-posting pack-version pin; mapping-change diffs (before/after account) reconstructable for every version transition — replaces today's `audit()` helper, which hardcodes `before: null` on every call site. Replay records actor, reason, both pack versions, original failure, and resulting journal.

## Tenant / legal-entity isolation

RLS on all pack/config tables, following the repository's standard tenant-isolation pattern (`tenant_id`, `ENABLE`/`FORCE ROW LEVEL SECURITY`, four policies), with positive and negative tests. Legal entity is a selection dimension (D-07), never a filterable-away axis.
