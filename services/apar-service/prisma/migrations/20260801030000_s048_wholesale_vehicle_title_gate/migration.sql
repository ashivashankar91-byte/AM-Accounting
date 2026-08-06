-- CE-09 S048: Wholesale Vehicle AR & Title Gate.
--
-- A wholesale vehicle sale receivable with a server-enforced title-release
-- gate: title cannot be released via the API unless the item is paid in
-- full, unless an explicit, permissioned, reasoned, audited exception is
-- invoked (ar_title_release_exceptions). AREntry (the existing flat legacy
-- cash-entry shape) has no paid/open-balance concept, so this is a new,
-- narrowly-scoped receivable purely for this gate — it does not attempt to
-- become the general AR invoicing engine.

CREATE TABLE IF NOT EXISTS "ar_wholesale_vehicle_items" (
  "id"                       TEXT NOT NULL,
  "tenant_id"                 TEXT NOT NULL,
  "customer_id"               TEXT NOT NULL,
  "vehicle_vin"               TEXT NOT NULL,
  "sale_amount"               DECIMAL(15,2) NOT NULL,
  "amount_paid"               DECIMAL(15,2) NOT NULL DEFAULT 0,
  "status"                    TEXT NOT NULL DEFAULT 'OPEN',
  "title_released"            BOOLEAN NOT NULL DEFAULT false,
  "title_released_at"         TIMESTAMP(3),
  "title_released_by"         TEXT,
  "title_release_exception"   BOOLEAN NOT NULL DEFAULT false,
  "version"                   INTEGER NOT NULL DEFAULT 1,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"                TEXT,
  "updated_at"                TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ar_wholesale_vehicle_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ar_wholesale_vehicle_items_tenant_id_idx" ON "ar_wholesale_vehicle_items"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_wholesale_vehicle_items_tenant_id_customer_id_idx" ON "ar_wholesale_vehicle_items"("tenant_id", "customer_id");
CREATE INDEX IF NOT EXISTS "ar_wholesale_vehicle_items_tenant_id_status_idx" ON "ar_wholesale_vehicle_items"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "ar_title_release_exceptions" (
  "id"                    TEXT NOT NULL,
  "tenant_id"              TEXT NOT NULL,
  "item_id"                TEXT NOT NULL,
  "reason"                 TEXT NOT NULL,
  "authorized_by"          TEXT NOT NULL,
  "outstanding_balance"    DECIMAL(15,2) NOT NULL,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ar_title_release_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ar_title_release_exceptions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "ar_wholesale_vehicle_items"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ar_title_release_exceptions_tenant_id_item_id_idx" ON "ar_title_release_exceptions"("tenant_id", "item_id");
