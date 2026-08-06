# P01 Build-Pack — Integration Provenance Note

**Date**: 2026-07-29
**Integration step**: R1 Controlled Integration, Step 1B (S008)

## What happened

`docs/accounting-modernization/build-packs/P01/*` and
`docs/accounting-modernization/build-packs/P01/design/P01_GOVERNED_FOUNDATION.html`
did not previously exist on `r1-integration`. They were copied verbatim
(byte-identical, diff-verified) from `r1-s008-period-close-control@6916c2a`
as part of S008's Phase 4 documentation integration.

## Why this matters for later story passes

The P01 build pack is **not S008-exclusive**. Its own source commit
(`bae9cfe`, "docs(P01): repository verification and reconciliation report for
S008/S009/S011/S032/S003") covers five stories, not one. The sibling story
branches (`r1-s003-elimination-configuration`, `r1-s009-statement-metadata`,
`r1-s011-analysis-codes`, `r1-s032-je-templates`,
`r1-s012-coa-change-governance`) each branched from a point that may contain
their own independently-evolved versions of these same P01 files.

**This copy is a snapshot, not authoritative for later integrations.** When
S003, S009, S011, S032, and the corrected S012 are integrated in subsequent
steps, each pass must **diff** its own P01-pack commits against whatever
S008 leaves on `r1-integration` here — not blindly re-apply or overwrite.
Blind overwrite in either direction would silently drop whichever story's
P01 content isn't currently staged.

## Files copied in this step

- `P01_BUSINESS_JOURNEY.md`
- `P01_CLAUDE_CODE_HANDOFF.md`
- `P01_PACK_CHARTER.md`
- `P01_REPOSITORY_VERIFICATION_RECONCILIATION.md`
- `P01_SCREEN_INVENTORY.csv`
- `P01_STORY_BLOCKING_REGISTER.csv`
- `P01_STORY_CONTRACTS.md`
- `P01_STORY_READINESS_MATRIX.csv`
- `P01_TRACEABILITY.csv`
- `design/P01_GOVERNED_FOUNDATION.html`
