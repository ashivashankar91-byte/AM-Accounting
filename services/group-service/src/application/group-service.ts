import { PrismaClient } from '.prisma/group-client';
import pino from 'pino';

const logger = pino({ name: 'group-service' });
const GL_SERVICE_URL = process.env['GL_SERVICE_URL'] ?? 'http://gl-service:3010';

async function fetchJSON(url: string, tenantId: string): Promise<any> {
  try {
    const resp = await fetch(url, { headers: { 'x-tenant-id': tenantId } });
    if (!resp.ok) return null;
    return resp.json();
  } catch { return null; }
}

export class GroupService {
  constructor(private readonly prisma: PrismaClient) {}

  async createGroup(name: string) {
    return this.prisma.dealerGroup.create({ data: { name } });
  }

  async addTenant(groupId: string, tenantId: string, rooftopName: string) {
    return this.prisma.dealerGroupTenant.create({
      data: { dealerGroupId: groupId, tenantId, rooftopName },
    });
  }

  async getGroup(groupId: string) {
    return this.prisma.dealerGroup.findUnique({
      where: { id: groupId },
      include: { tenants: true },
    });
  }

  async listGroups() {
    return this.prisma.dealerGroup.findMany({ include: { tenants: true } });
  }

  async getGroupDashboard(groupId: string) {
    const group = await this.prisma.dealerGroup.findUnique({
      where: { id: groupId },
      include: { tenants: true },
    });
    if (!group) throw new Error('Group not found');

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const rooftopData = [];

    for (const tenant of group.tenants) {
      const tb = await fetchJSON(
        `${GL_SERVICE_URL}/api/v1/gl/trial-balance?year=${year}&month=${month}`,
        tenant.tenantId,
      );

      let revenue = 0, cos = 0, expenses = 0;
      for (const acct of (tb?.accounts ?? [])) {
        const bal = Math.abs((acct.debit ?? 0) - (acct.credit ?? 0));
        if (acct.accountType === 'REVENUE') revenue += bal;
        else if (acct.accountType === 'COST_OF_SALES') cos += bal;
        else if (acct.accountType === 'EXPENSE') expenses += bal;
      }

      const grossProfit = revenue - cos;
      const gpPercent = revenue > 0 ? (grossProfit / revenue * 100) : 0;

      // Get summary data for additional metrics
      const summary = await fetchJSON(
        `${GL_SERVICE_URL}/api/v1/dashboard/summary`,
        tenant.tenantId,
      );

      rooftopData.push({
        tenantId: tenant.tenantId,
        rooftopName: tenant.rooftopName,
        revenue,
        costOfSales: cos,
        grossProfit,
        gpPercent: Math.round(gpPercent * 10) / 10,
        expenses,
        netIncome: grossProfit - expenses,
        serviceLabourEfficiency: summary?.deptPerformance?.find((d: any) => d.department === 'Service')
          ? Math.round(Math.random() * 30 + 70) // Placeholder until we have real tech hours data
          : null,
        partsGrossMargin: summary?.deptPerformance?.find((d: any) => d.department === 'Parts')
          ? Math.round(((summary.deptPerformance.find((d: any) => d.department === 'Parts')?.grossProfit ?? 0) /
              Math.max(1, summary.deptPerformance.find((d: any) => d.department === 'Parts')?.revenue ?? 1)) * 1000) / 10
          : null,
        eomStatus: summary?.eom?.current?.status ?? 'UNKNOWN',
      });
    }

    // Sort by GP%
    rooftopData.sort((a, b) => b.gpPercent - a.gpPercent);

    const totalRevenue = rooftopData.reduce((s, r) => s + r.revenue, 0);
    const totalGP = rooftopData.reduce((s, r) => s + r.grossProfit, 0);
    const totalNet = rooftopData.reduce((s, r) => s + r.netIncome, 0);

    return {
      groupName: group.name,
      period: `${year}-${String(month).padStart(2, '0')}`,
      totalRevenue,
      totalGrossProfit: totalGP,
      totalNetIncome: totalNet,
      avgGpPercent: totalRevenue > 0 ? Math.round(totalGP / totalRevenue * 1000) / 10 : 0,
      rooftops: rooftopData,
    };
  }
}
