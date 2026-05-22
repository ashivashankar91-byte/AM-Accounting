import { FastifyPluginAsync } from 'fastify';

const EPA_EMISSION_FACTOR = 0.000386;

function mockMonthlyCarbon(monthsBack: number): number {
  // Decreasing trend from 45 tons to 38 tons
  return 45 - (monthsBack <= 11 ? (11 - monthsBack) * 0.636 : 0) + (Math.random() - 0.5) * 2;
}

function mockReport(tenantId: string, period: string) {
  const evRevenuePct = 23;
  const iceRevenuePct = 77;
  const energyKwh = 42000;
  const carbonTons = Math.round(energyKwh * EPA_EMISSION_FACTOR * 100) / 100;
  const energyEfficiency = 72;
  const wasteRecyclingPct = 58;
  const sustainabilityScore = Math.round(
    (evRevenuePct * 40 + energyEfficiency * 30 + wasteRecyclingPct * 30) / 100
  );

  return {
    id: 'mock-esg-report',
    tenantId,
    period,
    totalCarbonTons: carbonTons,
    evRevenuePct,
    iceRevenuePct,
    energyKwh,
    sustainabilityScore,
    generatedAt: new Date().toISOString(),
  };
}

export function esgRoutes(prisma: any): FastifyPluginAsync {
  return async (app) => {
    app.post('/metrics', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const body = request.body as any;
      const metric = await prisma.esgMetric.create({
        data: {
          tenantId,
          period: body.period,
          metricType: body.metricType,
          value: body.value,
          unit: body.unit,
          source: body.source ?? 'MANUAL',
        },
      });
      return metric;
    });

    app.get('/report', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const query = request.query as { period?: string };
      const now = new Date();
      const period = query.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const existing = await prisma.esgReport.findFirst({
        where: { tenantId, period },
        orderBy: { generatedAt: 'desc' },
      }).catch(() => null);

      if (existing) return existing;
      return mockReport(tenantId, period);
    });

    app.get('/history', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const query = request.query as { months?: string };
      const monthCount = parseInt(query.months ?? '12', 10);

      const reports = await prisma.esgReport.findMany({
        where: { tenantId },
        orderBy: { generatedAt: 'desc' },
        take: monthCount,
      }).catch(() => []);

      if (reports.length > 0) return reports;

      // Mock 12 months of data
      const now = new Date();
      return Array.from({ length: Math.min(monthCount, 12) }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
        const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const carbonTons = Math.round(mockMonthlyCarbon(11 - i) * 100) / 100;
        return {
          tenantId,
          period: p,
          totalCarbonTons: carbonTons,
          evRevenuePct: 18 + i * 0.5,
          iceRevenuePct: 82 - i * 0.5,
          energyKwh: 48000 - i * 500,
          sustainabilityScore: 55 + i,
          generatedAt: d.toISOString(),
        };
      });
    });
  };
}
