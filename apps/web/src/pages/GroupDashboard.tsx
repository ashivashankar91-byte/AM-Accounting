import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { esgApi } from '../api/client';

const tenantId = () => localStorage.getItem('tenantId') ?? 'tenant-kunes';

async function fetchGroups() {
  const resp = await fetch('/api/v1/groups', { headers: { 'x-tenant-id': tenantId() } });
  return resp.json();
}

async function fetchGroupDashboard(groupId: string) {
  const resp = await fetch(`/api/v1/groups/${groupId}/dashboard`, { headers: { 'x-tenant-id': tenantId() } });
  return resp.json();
}

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`;
const fmtDollars = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 0 })}`;

export default function GroupDashboard() {
  const { data: groups } = useQuery({ queryKey: ['dealer-groups'], queryFn: fetchGroups, retry: false });
  const groupId = (groups ?? [])[0]?.id;
  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['group-dashboard', groupId],
    queryFn: () => fetchGroupDashboard(groupId),
    enabled: !!groupId,
    retry: false,
  });
  const { data: esgReport } = useQuery({ queryKey: ['esg-report'], queryFn: () => esgApi.getReport(), retry: false });

  if (isLoading) return <div className="p-6 text-gray-500">Loading group dashboard...</div>;

  if (!dashboard) {
    return (
      <div className="p-6">
        <div><h1 className="text-2xl font-bold mb-1">Group Dashboard</h1><p className="text-sm text-gray-500 mb-4">Multi-location group performance overview. Source: Group Service, GL Service.</p></div>
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">No dealer group configured. Create a group to see cross-rooftop benchmarks.</p>
        </div>
      </div>
    );
  }

  const rooftops = dashboard.rooftops ?? [];
  const chartData = rooftops.map((r: any) => ({
    name: r.rooftopName,
    revenue: r.revenue / 100,
    grossProfit: r.grossProfit / 100,
    netIncome: r.netIncome / 100,
  }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{dashboard.groupName} — Group Dashboard</h2>
        <p className="text-sm text-gray-500">Period: {dashboard.period}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-[10px] text-gray-400 uppercase">Total Revenue</div>
          <div className="text-xl font-bold">{fmt(dashboard.totalRevenue)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-[10px] text-gray-400 uppercase">Gross Profit</div>
          <div className="text-xl font-bold text-green-700">{fmt(dashboard.totalGrossProfit)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-[10px] text-gray-400 uppercase">Net Income</div>
          <div className="text-xl font-bold">{fmt(dashboard.totalNetIncome)}</div>
        </div>
        <div className="bg-amacc-700 text-white rounded-lg shadow p-4">
          <div className="text-[10px] uppercase text-blue-200">Avg GP %</div>
          <div className="text-xl font-bold">{dashboard.avgGpPercent}%</div>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-sm text-gray-700 mb-3">Revenue vs Gross Profit by Rooftop</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="revenue" fill="#1e40af" name="Revenue" radius={[4, 4, 0, 0]} />
            <Bar dataKey="grossProfit" fill="#22c55e" name="Gross Profit" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Rooftop Table */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-sm text-gray-700 mb-3">Rooftop Comparison</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Rank</th>
              <th className="pb-2">Rooftop</th>
              <th className="pb-2 text-right">Revenue</th>
              <th className="pb-2 text-right">Gross Profit</th>
              <th className="pb-2 text-right">GP %</th>
              <th className="pb-2 text-right">Net Income</th>
              <th className="pb-2 text-right">Service Efficiency</th>
              <th className="pb-2 text-right">Parts Margin</th>
              <th className="pb-2">EOM Status</th>
            </tr>
          </thead>
          <tbody>
            {rooftops.map((r: any, i: number) => (
              <tr key={r.tenantId} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 font-bold text-gray-400">{i + 1}</td>
                <td className="py-2 font-medium">{r.rooftopName}</td>
                <td className="py-2 text-right font-mono">{fmt(r.revenue)}</td>
                <td className="py-2 text-right font-mono text-green-700">{fmt(r.grossProfit)}</td>
                <td className="py-2 text-right font-bold">{r.gpPercent}%</td>
                <td className="py-2 text-right font-mono">{fmt(r.netIncome)}</td>
                <td className="py-2 text-right">{r.serviceLabourEfficiency ? `${r.serviceLabourEfficiency}%` : '—'}</td>
                <td className="py-2 text-right">{r.partsGrossMargin ? `${r.partsGrossMargin}%` : '—'}</td>
                <td className="py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    r.eomStatus === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                    r.eomStatus === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{r.eomStatus}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ESG / Sustainability Widget (Gap 12) */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-sm text-gray-700 mb-3">🌱 ESG / Sustainability</h3>
        {esgReport ? (
          <div className="grid grid-cols-5 gap-3">
            <div className="bg-green-50 rounded p-3 text-center">
              <div className="text-xs text-green-600">Sustainability Score</div>
              <div className="text-2xl font-bold text-green-700">{esgReport.sustainabilityScore ?? '—'}</div>
            </div>
            <div className="bg-blue-50 rounded p-3 text-center">
              <div className="text-xs text-blue-600">EV Revenue %</div>
              <div className="text-2xl font-bold text-blue-700">{esgReport.evRevenuePct ?? '—'}%</div>
            </div>
            <div className="bg-gray-50 rounded p-3 text-center">
              <div className="text-xs text-gray-600">ICE Revenue %</div>
              <div className="text-2xl font-bold">{esgReport.iceRevenuePct ?? '—'}%</div>
            </div>
            <div className="bg-amber-50 rounded p-3 text-center">
              <div className="text-xs text-amber-600">Carbon (Tons)</div>
              <div className="text-2xl font-bold text-amber-700">{esgReport.totalCarbonTons ?? '—'}</div>
            </div>
            <div className="bg-purple-50 rounded p-3 text-center">
              <div className="text-xs text-purple-600">Energy (kWh)</div>
              <div className="text-2xl font-bold text-purple-700">{esgReport.energyKwh?.toLocaleString() ?? '—'}</div>
            </div>
          </div>
        ) : <div className="text-xs text-gray-400">Loading ESG data...</div>}
      </div>
    </div>
  );
}
