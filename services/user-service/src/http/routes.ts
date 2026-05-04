import { FastifyPluginAsync } from 'fastify';
import { DEFAULT_LAYOUTS, PreferenceRole } from '../domain/defaults';

export function userRoutes(prisma: any): FastifyPluginAsync {
  return async (app) => {
    app.get('/preferences', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const userId = (request.headers['x-user-id'] as string) || 'default-user';
      let prefs = await prisma.userPreferences.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
      });
      if (!prefs) {
        prefs = {
          id: '',
          tenantId,
          userId,
          role: 'CONTROLLER',
          dashboardLayout: DEFAULT_LAYOUTS['CONTROLLER'],
          defaultFilters: {},
          notifications: { email: true, push: false, thresholds: { anomalyScore: 70, approvalTimeout: 24 } },
          timezone: 'America/Chicago',
        };
      }
      return prefs;
    });

    app.put('/preferences', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const userId = (request.headers['x-user-id'] as string) || 'default-user';
      const body = request.body as any;
      const prefs = await prisma.userPreferences.upsert({
        where: { tenantId_userId: { tenantId, userId } },
        create: {
          tenantId,
          userId,
          role: body.role ?? 'CONTROLLER',
          dashboardLayout: body.dashboardLayout ?? DEFAULT_LAYOUTS['CONTROLLER'],
          defaultFilters: body.defaultFilters ?? {},
          notifications: body.notifications ?? {},
          timezone: body.timezone ?? 'America/Chicago',
        },
        update: {
          ...(body.role && { role: body.role }),
          ...(body.dashboardLayout && { dashboardLayout: body.dashboardLayout }),
          ...(body.defaultFilters && { defaultFilters: body.defaultFilters }),
          ...(body.notifications && { notifications: body.notifications }),
          ...(body.timezone && { timezone: body.timezone }),
        },
      });
      return prefs;
    });

    app.get('/preferences/defaults/:role', async (request) => {
      const { role } = request.params as { role: string };
      const r = role.toUpperCase() as PreferenceRole;
      const layout = DEFAULT_LAYOUTS[r];
      if (!layout) return { error: 'Unknown role', validRoles: Object.keys(DEFAULT_LAYOUTS) };
      return { role: r, layout };
    });
  };
}
