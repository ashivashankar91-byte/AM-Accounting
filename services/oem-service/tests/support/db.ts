/**
 * CE-14 application-service tests run against the REAL isolated
 * certification database (amacc_ce14_cert — see the epic's certification
 * report for how it was created/migrated), not an in-memory fake — this
 * service's logic is DB-transaction-heavy (idempotency, conservation,
 * completion gates) and is exercised more genuinely against real Postgres.
 * Every test scopes its rows to a fresh randomUUID-suffixed tenantId and
 * cleans up in an afterEach, so tests are independent and repeatable.
 */
import { PrismaClient } from '.prisma/oem-client';
import { createTenantRlsMiddleware } from '@amacc/shared-kernel';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://amacc_app:amacc_app_dev@localhost:5432/amacc_ce14_cert';

export function makeTestPrisma(): PrismaClient {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  // Same RLS wiring src/index.ts applies in production — without this, every
  // query runs with no app.current_tenant_id set and RLS denies everything
  // (deny-by-default), same as against the real amacc_app runtime role.
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  return prisma;
}

export async function cleanupTenant(prisma: any, tenantId: string) {
  await prisma.oemIdempotencyRecord.deleteMany({ where: { tenantId } });
  await prisma.oemCoopAccrualPreview.deleteMany({ where: { tenantId } });
  await prisma.oemCoopClaimLine.deleteMany({ where: { tenantId } });
  await prisma.oemCoopClaim.deleteMany({ where: { tenantId } });
  await prisma.oemCoopProgram.deleteMany({ where: { tenantId } });
  await prisma.oemWarrantyReserveDraw.deleteMany({ where: { tenantId } });
  await prisma.oemWarrantyReservePreview.deleteMany({ where: { tenantId } });
  await prisma.oemWarrantyReserveConfig.deleteMany({ where: { tenantId } });
  await prisma.oemWarrantyDisputeEvidence.deleteMany({ where: { tenantId } });
  await prisma.oemWarrantyChargebackLine.deleteMany({ where: { tenantId } });
  await prisma.oemWarrantyChargebackNotice.deleteMany({ where: { tenantId } });
  await prisma.oemStatementExport.deleteMany({ where: { tenantId } });
  await prisma.oemStatementRender.deleteMany({ where: { tenantId } });
  await prisma.oemStatementAccountMapping.deleteMany({ where: { tenantId } });
  await prisma.oemStatementProfile.deleteMany({ where: { tenantId } });
  await prisma.oemIncentiveTrueUp.deleteMany({ where: { tenantId } });
  await prisma.oemIncentiveAccrual.deleteMany({ where: { tenantId } });
  await prisma.oemIncentiveProgram.deleteMany({ where: { tenantId } });
  await prisma.oemMatchSessionRow.deleteMany({ where: { tenantId } });
  await prisma.oemMatchSession.deleteMany({ where: { tenantId } });
  await prisma.oemDiffAlert.deleteMany({ where: { tenantId } });
  await prisma.oemStagedDocumentRow.deleteMany({ where: { tenantId } });
  await prisma.oemStagedDocument.deleteMany({ where: { tenantId } });
  await prisma.oemDealerCode.deleteMany({ where: { tenantId } });
  await prisma.oemIntegrationProfile.deleteMany({ where: { tenantId } });
  await prisma.auditOutboxEvent.deleteMany({ where: { tenantId } });
}
