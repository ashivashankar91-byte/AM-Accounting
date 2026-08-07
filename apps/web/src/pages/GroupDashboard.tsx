import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  LineChart, Line, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis,
} from 'recharts';
import { esgApi, groupsApi } from '../api/client';

const D = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const D1 = (v: number) => `$${(v / 1000).toFixed(0)}K`;
const Pct = (v: number) => `${v.toFixed(1)}%`;

const COLORS = ['#1d4ed8','#16a34a','#dc2626','#d97706','#7c3aed','#0891b2'];

const Kpi = ({ label, value, sub, color = 'text-gray-900' }: { label: string; value: string; sub?: string; color?: string }) => (
  <div className="bg-white rounded-lg shadow-sm border p-4">
    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</div>
    <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
    {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
  </div>
);

export default function GroupDashboard() {
  const { data: groups } = useQuery({ queryKey: ['dealer-groups'], queryFn: groupsApi.list, retry: false });
  const groupId = (groups ?? [])[0]?.id;
  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['group-dashboard', groupId],
    queryFn: () => groupsApi.getDashboard(groupId),
    enabled: !!groupId,
    retry: false,
  });
  const { data: esgReport } = useQuery({ queryKey: ['esg-report'], queryFn: () => esgApi.getReport(), retry: false });

  if (isLoading) return <div className="p-6 text-gray-500">Loading group dashboard…</div>;

  if (!dashboard) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-1">Group Dashboard</h1>
        <p className="text-sm text-gray-500 mb-4">Multi-location group performance overview.</p>
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">No dealer group configured. Create a group to see cross-rooftop benchmarks.</p>
        </div>
      </div>
    );
  }

  const rooftops: any[] = dashboard.rooftops ?? [];
  const totalRev = dashboard.totalRevenue ?? 0;
  const totalGP = dashboard.totalGrossProfit ?? 0;
  const totalNet = dashboard.totalNetIncome ?? 0;
  const totalExp = totalGP - totalNet;
  const gpPct = totalRev > 0 ? (totalGP / totalRev) * 100 : 0;
  const netPct = totalRev > 0 ? (totalNet / totalRev) * 100 : 0;
  const expPct = totalGP > 0 ? (totalExp / totalGP) * 100 : 0;

  // Per-rooftop bar chart data
  const barData = rooftops.map((r: any) => ({
    name: r.rooftopName.replace(/Kunes /i, ''),
    Revenue: r.revenue,
    'Gross Profit': r.grossProfit,
    Expenses: r.expenses,
    'Net Income': r.netIncome,
  }));

  // GP% ranking
  const gpRankData = [...rooftops].sort((a, b) => b.gpPercent - a.gpPercent).map((r: any) => ({
    name: r.rooftopName.replace(/Kunes /i, ''),
    'GP%': r.gpPercent,
    'Net%': totalRev > 0 ? Math.round((r.netIncome / Math.max(r.revenue, 1)) * 1000) / 10 : 0,
  }));

  // Contribution pie: each rooftop's share of group revenue
  const pieData = rooftops.map((r: any) => ({ name: r.rooftopName.replace(/Kunes /i, ''), value: r.revenue }));

  // Radar — operational health score per rooftop (derived)
  const radarData = rooftops.map((r: any) => {
    const revScore = totalRev > 0 ? Math.round((r.revenue / (totalRev / rooftops.length)) * 50) : 0;
    const gpScore = Math.min(100, Math.round(r.gpPercent * 2));
    const netScore = r.netIncome > 0 ? Math.min(100, Math.round((r.netIncome / Math.max(r.revenue, 1)) * 1000)) : 0;
    const svcScore = r.serviceLabourEfficiency ?? 70;
    const partsScore = r.partsGrossMargin ?? 30;
    return { rooftop: r.rooftopName.replace(/Kunes /i, ''), Revenue: revScore, GP: gpScore, Net: netScore, Service: svcScore, Parts: partsScore };
  });
  const radarKeys = rooftops.map((r: any) => r.rooftopName.replace(/Kunes /i, ''));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{dashboard.groupName} — CFO Dashboard</h1>
          <p className="text-sm text-gray-500">Period: {dashboard.period} · {rooftops.length} Rooftops · Live GL Data</p>
        </div>
        <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-3 py-1 font-medium">
          {dashboard.period}
        </span>
      </div>

      {/* Tier-1 KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Group Revenue" value={D(totalRev)} sub={`${rooftops.length} rooftops combined`} color="text-blue-700" />
        <Kpi label="Gross Profit" value={D(totalGP)} sub={`GP%: ${Pct(gpPct)}`} color="text-green-700" />
        <Kpi label="Net Income" value={D(totalNet)} sub={`Net Margin: ${Pct(netPct)}`} color={totalNet >= 0 ? 'text-green-700' : 'text-red-600'} />
        <Kpi label="Total Expenses" value={D(totalExp)} sub={`${Pct(expPct)} of gross profit`} color="text-orange-600" />
      </div>

      {/* Tier-2 Efficiency KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Avg GP %" value={`${dashboard.avgGpPercent}%`} sub="Group blended" />
        <Kpi label="Revenue / Rooftop" value={D(Math.round(totalRev / Math.max(rooftops.length, 1)))} sub="Average" />
        <Kpi label="Best GP%" value={`${Math.max(...rooftops.map((r: any) => r.gpPercent), 0).toFixed(1)}%`} sub={rooftops.sort((a: any, b: any) => b.gpPercent - a.gpPercent)[0]?.rooftopName?.replace(/Kunes /i, '') ?? '—'} color="text-green-700" />
        <Kpi label="EOM Completed" value={`${rooftops.filter((r: any) => r.eomStatus === 'COMPLETED').length} / ${rooftops.length}`} sub="Rooftops closed" />
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Revenue vs GP vs Expenses Bar */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">P&amp;L by Rooftop</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}K`} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: any) => D(v)} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="Revenue" fill="#1d4ed8" radius={[2,2,0,0]} />
              <Bar dataKey="Gross Profit" fill="#16a34a" radius={[2,2,0,0]} />
              <Bar dataKey="Net Income" fill="#7c3aed" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* GP% Ranking */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Gross Profit % Ranking</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={gpRankData} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis type="number" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={70} />
              <Tooltip formatter={(v: any) => `${v}%`} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="GP%" fill="#16a34a" radius={[0,2,2,0]} />
              <Bar dataKey="Net%" fill="#7c3aed" radius={[0,2,2,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Revenue Mix + Radar */}
      <div className="grid grid-cols-2 gap-4">
        {/* Revenue contribution pie */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Revenue Contribution by Rooftop</h3>
          <div className="flex items-center gap-6">
            <ResponsiveContainer width={200} height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ percent }: any) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {pieData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => D(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {pieData.map((p: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-gray-600">{p.name}</span>
                  <span className="font-mono font-semibold text-gray-800 ml-auto">{D1(p.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Operational Health Radar */}
        <div className="bg-white rounded-lg shadow-sm border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Operational Health Score by Rooftop</h3>
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="rooftop" tick={{ fontSize: 9 }} />
              {radarKeys.map((key: string, i: number) => (
                <Radar key={key} name={key} dataKey={key} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.15} />
              ))}
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </RadarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-gray-400 mt-2">Score 0–100 per dimension (Revenue index, GP%, Net%, Service efficiency, Parts margin)</p>
        </div>
      </div>

      {/* Detailed Rooftop Table */}
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Rooftop Performance Matrix</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 border-b bg-gray-50 uppercase tracking-wide">
              <th className="pb-2 px-2">#</th>
              <th className="pb-2 px-2">Rooftop</th>
              <th className="pb-2 px-2 text-right">Revenue</th>
              <th className="pb-2 px-2 text-right">COS</th>
              <th className="pb-2 px-2 text-right">Gross Profit</th>
              <th className="pb-2 px-2 text-right">GP%</th>
              <th className="pb-2 px-2 text-right">Expenses</th>
              <th className="pb-2 px-2 text-right">Net Income</th>
              <th className="pb-2 px-2 text-right">Net%</th>
              <th className="pb-2 px-2 text-right">Svc Eff.</th>
              <th className="pb-2 px-2 text-right">Parts Margin</th>
              <th className="pb-2 px-2">EOM</th>
            </tr>
          </thead>
          <tbody>
            {rooftops.map((r: any, i: number) => {
              const netPctR = r.revenue > 0 ? (r.netIncome / r.revenue) * 100 : 0;
              return (
                <tr key={r.tenantId} className="border-b border-gray-50 hover:bg-blue-50 transition-colors">
                  <td className="py-2 px-2 font-bold text-gray-300">{i + 1}</td>
                  <td className="py-2 px-2 font-medium text-gray-800">{r.rooftopName}</td>
                  <td className="py-2 px-2 text-right font-mono">{D(r.revenue)}</td>
                  <td className="py-2 px-2 text-right font-mono text-gray-500">{D(r.costOfSales)}</td>
                  <td className="py-2 px-2 text-right font-mono font-semibold text-green-700">{D(r.grossProfit)}</td>
                  <td className="py-2 px-2 text-right font-bold text-green-700">{Pct(r.gpPercent)}</td>
                  <td className="py-2 px-2 text-right font-mono text-orange-600">{D(r.expenses)}</td>
                  <td className={`py-2 px-2 text-right font-mono font-semibold ${r.netIncome >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{D(r.netIncome)}</td>
                  <td className={`py-2 px-2 text-right font-bold ${netPctR >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{Pct(netPctR)}</td>
                  <td className="py-2 px-2 text-right">{r.serviceLabourEfficiency ? `${r.serviceLabourEfficiency}%` : '—'}</td>
                  <td className="py-2 px-2 text-right">{r.partsGrossMargin ? `${r.partsGrossMargin}%` : '—'}</td>
                  <td className="py-2 px-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      r.eomStatus === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                      r.eomStatus === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-500'
                    }`}>{r.eomStatus}</span>
                  </td>
                </tr>
              );
            })}
            {/* Group Totals Row */}
            <tr className="font-bold bg-gray-50 text-gray-800 border-t-2">
              <td className="py-2 px-2 text-gray-400">∑</td>
              <td className="py-2 px-2">GROUP TOTAL</td>
              <td className="py-2 px-2 text-right font-mono text-blue-700">{D(totalRev)}</td>
              <td className="py-2 px-2 text-right font-mono text-gray-500">{D(totalRev - totalGP)}</td>
              <td className="py-2 px-2 text-right font-mono text-green-700">{D(totalGP)}</td>
              <td className="py-2 px-2 text-right text-green-700">{Pct(gpPct)}</td>
              <td className="py-2 px-2 text-right font-mono text-orange-600">{D(totalExp)}</td>
              <td className={`py-2 px-2 text-right font-mono ${totalNet >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{D(totalNet)}</td>
              <td className={`py-2 px-2 text-right ${netPct >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{Pct(netPct)}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* ESG */}
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">🌱 ESG &amp; Sustainability</h3>
        {esgReport ? (
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: 'Sustainability Score', value: esgReport.sustainabilityScore ?? '—', color: 'text-green-700', bg: 'bg-green-50' },
              { label: 'EV Revenue %', value: `${esgReport.evRevenuePct ?? '—'}%`, color: 'text-blue-700', bg: 'bg-blue-50' },
              { label: 'ICE Revenue %', value: `${esgReport.iceRevenuePct ?? '—'}%`, color: 'text-gray-700', bg: 'bg-gray-50' },
              { label: 'Carbon (Tons)', value: esgReport.totalCarbonTons ?? '—', color: 'text-amber-700', bg: 'bg-amber-50' },
              { label: 'Energy (kWh)', value: esgReport.energyKwh?.toLocaleString() ?? '—', color: 'text-purple-700', bg: 'bg-purple-50' },
            ].map((m, i) => (
              <div key={i} className={`${m.bg} rounded p-3 text-center`}>
                <div className="text-[10px] text-gray-500 mb-1">{m.label}</div>
                <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
              </div>
            ))}
          </div>
        ) : <div className="text-xs text-gray-400">ESG data unavailable</div>}
      </div>
    </div>
  );
}

