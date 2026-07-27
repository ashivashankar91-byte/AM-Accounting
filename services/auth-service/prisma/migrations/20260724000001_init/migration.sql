-- FINAL-R0 Foundation Completion: real bug found only by booting a clean
-- database from an empty migration history (`prisma migrate deploy` on a
-- fresh Postgres instance). The very first tables (`api_keys`,
-- `refresh_tokens`) were apparently created in every prior dev environment
-- via an un-tracked `prisma db push`, never captured as a migration — every
-- later migration (starting at 20260724000002) assumed they already existed.
-- `20260726000003_add_rls_policies` fails on a clean deploy with
-- `relation "api_keys" does not exist`. This baseline migration restores the
-- missing first step so `prisma migrate deploy` succeeds end-to-end on a
-- brand-new database, matching the `ApiKey`/`RefreshToken` models already in
-- schema.prisma (unchanged by this migration).

CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY['read','write']::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE INDEX "refresh_tokens_tenant_id_idx" ON "refresh_tokens"("tenant_id");
