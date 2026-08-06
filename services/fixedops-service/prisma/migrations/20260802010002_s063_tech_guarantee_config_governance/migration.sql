-- CE-11 S063 gap-closure — TechGuaranteeConfig had NO write path anywhere
-- (read-only in tech-time-service.ts), so shortfallHours was always 0 for
-- every absorption ever posted. Additive: nullable created_by column, plus
-- a real natural-key uniqueness constraint (mirrors LaborRateConfig) so the
-- new governed setGuaranteeConfig() ceremony can upsert safely.

-- AlterTable
ALTER TABLE "tech_guarantee_config" ADD COLUMN "created_by" TEXT;

-- Legal entity was already a column but never part of the lookup key —
-- widen the natural key from (tenant, tech, effective_from) to include it,
-- matching every other CE-11 config table's per-legal-entity scoping.
DROP INDEX "tech_guarantee_config_tenant_id_tech_id_effective_from_idx";

-- CreateIndex
CREATE UNIQUE INDEX "tech_guarantee_config_tenant_id_legal_entity_id_tech_id_eff_key" ON "tech_guarantee_config"("tenant_id", "legal_entity_id", "tech_id", "effective_from");
