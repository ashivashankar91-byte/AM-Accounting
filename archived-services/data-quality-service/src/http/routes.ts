import { FastifyPluginAsync } from 'fastify';

interface QualityIssue {
  type: string;
  count: number;
  affectedModule: string;
  suggestion: string;
}

function mockReport(tenantId: string, period: string) {
  return {
    id: 'mock-dq-report',
    tenantId,
    period,
    overallScore: 85,
    journalLineScore: 82,
    payrollLineScore: 90,
    dealProductScore: 83,
    issues: [
      {
        type: 'MISSING_DEPARTMENT_CODE',
        count: 12,
        affectedModule: 'SERVICE_RO',
        suggestion: 'Service RO ingest not sending departmentCode on labor lines',
      },
      {
        type: 'MISSING_TECHNICIAN_ID',
        count: 7,
        affectedModule: 'SERVICE_RO',
        suggestion: 'Technician ID missing on flat-rate labor lines — check DMS mapping',
      },
      {
        type: 'ORPHANED_DEAL_PRODUCT',
        count: 3,
        affectedModule: 'F_AND_I',
        suggestion: '3 deal product lines reference non-existent deal numbers',
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export function qualityRoutes(prisma: any): FastifyPluginAsync {
  return async (app) => {
    app.get('/report', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const query = request.query as { period?: string };
      const now = new Date();
      const period = query.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Try real data first
      const existing = await prisma.dataQualityReport.findFirst({
        where: { tenantId, period },
        orderBy: { generatedAt: 'desc' },
      }).catch(() => null);

      if (existing) return existing;
      return mockReport(tenantId, period);
    });

    app.get('/history', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const reports = await prisma.dataQualityReport.findMany({
        where: { tenantId },
        orderBy: { generatedAt: 'desc' },
        take: 12,
      }).catch(() => []);

      if (reports.length === 0) {
        // Mock 6 months of history
        const months = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          months.push({ ...mockReport(tenantId, p), overallScore: 75 + i * 2 + Math.round(Math.random() * 5) });
        }
        return months;
      }
      return reports;
    });

    app.get('/issues', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const query = request.query as { period?: string };
      const now = new Date();
      const period = query.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const report = await prisma.dataQualityReport.findFirst({
        where: { tenantId, period },
        orderBy: { generatedAt: 'desc' },
      }).catch(() => null);

      return (report?.issues as QualityIssue[]) ?? mockReport(tenantId, period).issues;
    });
  };
}
