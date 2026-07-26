-- S214 — Create & Save Draft Manual JE (additive; no destructive DDL).
-- A draft is a safe scratchpad: it persists in ANY state (BR214-1, no validation
-- on save). Lines are stored as JSONB so a half-finished entry round-trips with
-- full fidelity. Edit history is retained in manual_je_draft_revision (BR214-3).
-- Attachments bind at the draft (BR214-4, basic upload; hardening in R1).

-- ── manual_je_draft ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manual_je_draft (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL,
  entity_id             TEXT,                     -- nullable: a draft may be started before an entity is chosen
  preparer              TEXT NOT NULL,            -- owning user (BR214-2 visibility)
  status                TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT | VALIDATED | POSTED_LINKED | VOIDED
  entry_date            DATE,                     -- nullable: unresolvable date is flagged at validation (S215), not save
  source_code           TEXT,                     -- nullable until chosen; manual-class lookup enforced at validation
  memo                  VARCHAR(500),
  lines                 JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{accountId,accountNumber,storeId,deptCode,controlNumber,applyNumber,dr,cr,memo}]
  version               INTEGER NOT NULL DEFAULT 1,          -- edit counter (BR214-3)
  -- S215 validation result cache (set by the validate path):
  validated_at          TIMESTAMPTZ,
  validation_result     JSONB,
  -- S216 posting linkage (set when the draft posts):
  posted_journal_id     UUID,
  posted_journal_number TEXT,
  -- S219 void:
  voided_at             TIMESTAMPTZ,
  void_reason           VARCHAR(500),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manual_je_draft_tenant_preparer_idx ON manual_je_draft (tenant_id, preparer);
CREATE INDEX IF NOT EXISTS manual_je_draft_tenant_status_idx ON manual_je_draft (tenant_id, status);
CREATE INDEX IF NOT EXISTS manual_je_draft_posted_journal_idx ON manual_je_draft (posted_journal_id);

-- ── manual_je_draft_revision (append-only edit history, BR214-3) ─────────────────
CREATE TABLE IF NOT EXISTS manual_je_draft_revision (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id    UUID NOT NULL REFERENCES manual_je_draft(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,
  version     INTEGER NOT NULL,
  editor      TEXT NOT NULL,
  snapshot    JSONB NOT NULL,   -- full-fidelity draft image at this version
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manual_je_draft_revision_draft_idx ON manual_je_draft_revision (draft_id, version);

-- ── attachment (metadata binding; basic upload, R1 hardening for virus scan) ─────
CREATE TABLE IF NOT EXISTS attachment (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   TEXT NOT NULL,
  draft_id    UUID NOT NULL REFERENCES manual_je_draft(id) ON DELETE CASCADE,
  file_name   VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(120) NOT NULL,
  size_bytes  BIGINT NOT NULL,
  storage_key TEXT,             -- R0: metadata binding; real object store wired in R1
  uploaded_by TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attachment_size_limit CHECK (size_bytes >= 0 AND size_bytes <= 26214400)  -- 25 MB
);
CREATE INDEX IF NOT EXISTS attachment_draft_idx ON attachment (draft_id);

SELECT '---APPLIED---' AS status;
