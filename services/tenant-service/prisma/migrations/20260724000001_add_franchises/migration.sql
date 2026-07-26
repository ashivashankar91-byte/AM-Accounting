-- ACC-S204: Franchise Maintenance
-- Additive only. No destructive DDL.
--
-- oem_ref  : platform-controlled OEM list (BR204-1). dealer_code_pattern drives BR204-2.
-- franchises: brand-per-store org dimension (BR204-1). Effective-dated (BR204-3, buy/sell).
--
-- A store may hold a given OEM only once concurrently: the partial unique index below
-- allows re-adding an OEM after a sell (effective_to set) while blocking a duplicate
-- ACTIVE (effective_to IS NULL) franchise for the same store  → 409 duplicate-oem-per-store.

-- ── OEM reference (platform-controlled) ───────────────────────────────────────
CREATE TABLE "oem_ref" (
    "oem_code"            TEXT        NOT NULL,
    "display_name"        TEXT        NOT NULL,
    -- Regex the dealer_code must satisfy for this OEM (BR204-2).
    "dealer_code_pattern" TEXT        NOT NULL,
    -- Human hint surfaced to the UI / validation errors.
    "dealer_code_hint"    TEXT        NOT NULL,
    "active"              BOOLEAN     NOT NULL DEFAULT true,
    "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "oem_ref_pkey" PRIMARY KEY ("oem_code")
);

-- Launch OEM set. FORD 5-digit and GM 6-digit BAC are packet-confirmed.
-- TOYOTA/STELLANTIS/HONDA/NISSAN patterns are R0 baselines — ACCOUNTING_SME_VALIDATION_PENDING;
-- stored as data so they are correctable without a schema change.
INSERT INTO "oem_ref" ("oem_code", "display_name", "dealer_code_pattern", "dealer_code_hint") VALUES
    ('FORD',       'Ford',                '^[0-9]{5}$', '5-digit dealer code'),
    ('GM',         'General Motors',      '^[0-9]{6}$', '6-digit BAC'),
    ('TOYOTA',     'Toyota',              '^[0-9]{5}$', '5-digit dealer code (SME validation pending)'),
    ('STELLANTIS', 'Stellantis',          '^[0-9]{5}$', '5-digit dealer code (SME validation pending)'),
    ('HONDA',      'Honda',               '^[0-9]{6}$', '6-digit dealer number (SME validation pending)'),
    ('NISSAN',     'Nissan',              '^[0-9]{6}$', '6-digit dealer code (SME validation pending)');

-- ── Franchise (brand per store) ───────────────────────────────────────────────
CREATE TABLE "franchises" (
    "id"             TEXT        NOT NULL,
    "tenant_id"      TEXT        NOT NULL,
    "store_id"       TEXT        NOT NULL,
    "oem_code"       TEXT        NOT NULL,
    "dealer_code"    TEXT        NOT NULL,
    "effective_from" DATE        NOT NULL,
    "effective_to"   DATE,
    "version"        INTEGER     NOT NULL DEFAULT 1,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "franchises_pkey" PRIMARY KEY ("id")
);

-- BR204-1 duplicate-oem-per-store (409): one ACTIVE franchise per (store, oem).
-- Partial index permits historical (sold) rows to coexist with a new active grant.
CREATE UNIQUE INDEX "franchises_store_oem_active_key"
    ON "franchises"("store_id", "oem_code")
    WHERE "effective_to" IS NULL;

-- Tenant-scoped lookup indexes.
CREATE INDEX "franchises_tenant_id_idx"          ON "franchises"("tenant_id");
CREATE INDEX "franchises_tenant_id_store_id_idx" ON "franchises"("tenant_id", "store_id");
CREATE INDEX "franchises_oem_code_idx"           ON "franchises"("oem_code");
