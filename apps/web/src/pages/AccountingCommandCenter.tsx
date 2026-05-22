import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { commandCenterApi } from '../api/client';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import HelpButton from '../components/HelpButton';
import SCREEN_HELP from '../data/screenHelp';

// Format currency from raw dollars (command-center endpoints return raw, not cents)
const fmt$ = (v: number) => `$${Math.round(v).toLocaleString()}`;
const fmtK = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` :
  Math.abs(v) >= 1_000 ? `$${(v / 1_000).toFixed(0)}K` : `$${v.toFixed(0)}`;

const COLORS = ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

export default function AccountingCommandCenter() {
  const [centerTab, setCenterTab] = useState<'gl' | 'charts' | 'kpis'>('gl');
  const [ashleyInput, setAshleyInput] = useState('');
  const [ashleyMessages, setAshleyMessages] = useState<{ role: string; text: string }[]>([]);
  const [ashleyLoading, setAshleyLoading] = useState(false);
  const ashleyRef = useRef<HTMLDivElement>(null);

  // ═══ 5 dedicated command-center queries — auto-refresh 15s ═══
  const { data: liveStats, isLoading } = useQuery({
    queryKey: ['cc-live-stats'], queryFn: commandCenterApi.getLiveStats,
    retry: false, refetchInterval: 15000,
  });
  const { data: alertsData } = useQuery({
    queryKey: ['cc-alerts'], queryFn: commandCenterApi.getAlerts,
    retry: false, refetchInterval: 15000,
  });
  const { data: glMonitor } = useQuery({
    queryKey: ['cc-gl-monitor'], queryFn: commandCenterApi.getGLMonitor,
    retry: false, refetchInterval: 15000,
  });
  const { data: kpiTrends } = useQuery({
    queryKey: ['cc-kpi-trends'], queryFn: commandCenterApi.getKpiTrends,
    retry: false, refetchInterval: 30000,
  });
  const { data: charts } = useQuery({
    queryKey: ['cc-charts'], queryFn: commandCenterApi.getCharts,
    retry: false, refetchInterval: 30000,
  });

  // Ashley AI mutation
  const ashleyMutation = useMutation({
    mutationFn: (question: string) => commandCenterApi.askAshley(question),
    onSuccess: (data) => {
      setAshleyMessages(prev => [...prev, { role: 'ashley', text: data.answer }]);
      setAshleyLoading(false);
    },
    onError: () => {
      setAshleyMessages(prev => [...prev, { role: 'ashley', text: 'Sorry, I could not process that question. Please try again.' }]);
      setAshleyLoading(false);
    },
  });

  useEffect(() => {
    if (ashleyRef.current) ashleyRef.current.scrollTop = ashleyRef.current.scrollHeight;
  }, [ashleyMessages]);

  const handleAshley = () => {
    if (!ashleyInput.trim() || ashleyLoading) return;
    setAshleyMessages(prev => [...prev, { role: 'user', text: ashleyInput }]);
    setAshleyLoading(true);
    ashleyMutation.mutate(ashleyInput);
    setAshleyInput('');
  };

  const stats = liveStats?.stats ?? [];
  const alerts = alertsData?.alerts ?? [];
  const accounts = glMonitor?.accounts ?? [];
  const glSummary = glMonitor?.summary;

  if (isLoading) return <div className="p-6 text-gray-500">Loading Command Center...</div>;

  return (
    <div className="p-4 space-y-3 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div><h1 className="text-xl font-bold text-gray-900">Accounting Command Center</h1><p className="text-sm text-gray-500 mt-0.5">Real-time alerts, actionable insights, and Ashley AI assistant. Source: Command Center API.</p></div>
          <p className="text-xs text-gray-500 mt-0.5">
            Live data &middot; Auto-refresh 15s &middot; {liveStats?.timestamp ? new Date(liveStats.timestamp).toLocaleTimeString() : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {alerts.filter((a: any) => a.priority === 'critical').length > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-100 text-red-800 rounded-full text-[10px] font-bold animate-pulse">
              🚨 {alerts.filter((a: any) => a.priority === 'critical').length} Critical
            </span>
          )}
          {glSummary && !glSummary.balanced && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-100 text-red-800 rounded-full text-[10px] font-bold">
              GL Variance: ${Math.abs(glSummary.variance).toLocaleString()}
            </span>
          )}
          {glSummary?.balanced && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-100 text-green-800 rounded-full text-[10px] font-bold">
              ✓ GL Balanced
            </span>
          )}
          <HelpButton help={SCREEN_HELP['command-center'] ?? SCREEN_HELP['dashboard']} />
        </div>
      </div>

      {/* ═══ ZONE 1: Command Strip — 2 rows × 4 KPI Cards ═══ */}
      <div className="grid grid-cols-4 gap-3">
        {stats.map((s: any) => {
          const statusColor = s.status === 'green' ? 'border-green-500' : s.status === 'red' ? 'border-red-500' : s.status === 'amber' ? 'border-amber-500' : 'border-gray-200';
          const textColor = s.status === 'green' ? 'text-green-700' : s.status === 'red' ? 'text-red-700' : s.status === 'amber' ? 'text-amber-700' : 'text-gray-900';
          const displayValue = s.format === 'currency' ? fmtK(s.value) : s.format === 'number' ? String(s.value) : s.value;
          return (
            <div key={s.key} className={`bg-white rounded-xl shadow-sm p-4 border-l-4 ${statusColor}`} style={{ minHeight: 100 }}>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold truncate">{s.label}</p>
              <p className={`text-xl font-bold ${textColor} mt-1 truncate`}>{displayValue}</p>
              <p className="text-[10px] text-gray-500 mt-1 truncate">{s.sub}</p>
            </div>
          );
        })}
      </div>

      {/* ═══ ZONES 2-4: Three-Column Layout ═══ */}
      <div className="grid grid-cols-12 gap-3" style={{ minHeight: 460 }}>

        {/* ═══ ZONE 2: Proactive Intelligence — Computed Alerts ═══ */}
        <div className="col-span-3 flex flex-col">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 px-0.5">
            Accounting Intelligence ({alerts.length})
          </h3>
          <div className="flex-1 overflow-y-auto space-y-1.5" style={{ maxHeight: 440 }}>
            {alerts.length === 0 && (
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xs text-green-700 font-semibold">✓ All Clear</p>
                <p className="text-[10px] text-green-600 mt-0.5">No alerts — all systems normal</p>
              </div>
            )}
            {alerts.map((alert: any) => {
              const bgColor = alert.priority === 'critical' ? 'bg-red-50' : alert.priority === 'review' ? 'bg-amber-50' : 'bg-brand-light';
              const borderColor = alert.priority === 'critical' ? 'border-red-200' : alert.priority === 'review' ? 'border-amber-200' : 'border-brand-border';
              const iconColor = alert.priority === 'critical' ? 'text-red-500' : alert.priority === 'review' ? 'text-amber-500' : 'text-blue-500';
              return (
                <div key={alert.id} className={`${bgColor} rounded-xl border ${borderColor} p-3 cursor-pointer hover:shadow-sm transition-shadow`}>
                  <div className="flex items-start gap-2">
                    <span className={`text-sm ${iconColor} mt-0.5`}>{alert.priority === 'critical' ? '🚨' : alert.priority === 'review' ? '⚠️' : 'ℹ️'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-gray-800 leading-snug">
                        {alert.title}
                      </p>
                      <p className="text-[9px] text-gray-500 leading-relaxed mt-0.5 line-clamp-2">{alert.detail}</p>
                      {alert.agentBadge && (
                        <span className="inline-block text-[8px] bg-purple-100 text-purple-700 font-bold px-1.5 py-0.5 rounded mt-1">
                          ⚡ {alert.agentBadge}
                        </span>
                      )}
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[8px] text-gray-400">{alert.time}</span>
                        <button className={`text-[9px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                          alert.actionType === 'approve'
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-brand-light text-brand hover:bg-blue-200'
                        }`}>
                          {alert.action} →
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══ ZONE 3: Financial Health Center — Tabbed ═══ */}
        <div className="col-span-6 flex flex-col">
          <div className="flex border-b border-gray-200 mb-2">
            {([['gl', 'GL Account Monitor'], ['charts', 'Revenue & Expenses'], ['kpis', 'Dept Performance']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setCenterTab(key)}
                className={`flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors ${
                  centerTab === key ? 'border-blue-600 text-brand' : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ── Tab: GL Account Monitor ── */}
            {centerTab === 'gl' && (
              <div className="bg-white rounded-lg shadow">
                {/* Summary strip */}
                <div className="flex items-center gap-3 px-3 py-2 border-b bg-gray-50 rounded-t-lg">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${glSummary?.balanced ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {glSummary?.balanced ? '✓ Balanced' : `✗ Variance: $${Math.abs(glSummary?.variance ?? 0).toLocaleString()}`}
                  </span>
                  <span className="text-[10px] text-gray-500">{glSummary?.totalAccounts ?? 0} accounts · {glSummary?.activeAccounts ?? 0} active</span>
                  <span className="text-[10px] text-gray-500 ml-auto">
                    Σ Debits: ${Math.round(glSummary?.totalDebits ?? 0).toLocaleString()} · Credits: ${Math.round(glSummary?.totalCredits ?? 0).toLocaleString()}
                  </span>
                </div>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-gray-500 border-b bg-gray-50">
                      <th className="px-2 py-1.5 font-semibold w-6"></th>
                      <th className="px-2 py-1.5 font-semibold">Acct</th>
                      <th className="px-2 py-1.5 font-semibold">Name</th>
                      <th className="px-2 py-1.5 font-semibold">Type</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Debits</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Credits</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Net Balance</th>
                      <th className="px-2 py-1.5 text-right font-semibold"># Posts</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a: any) => {
                      const statusDot = a.status === 'high-activity' ? 'bg-amber-400'
                        : a.status === 'large-balance' ? 'bg-brand-light0'
                        : a.todayPostings > 0 ? 'bg-green-400' : 'bg-gray-300';
                      return (
                        <tr key={a.id} className="border-b border-gray-50 hover:bg-brand-light/30">
                          <td className="px-2 py-1.5"><span className={`inline-block w-2 h-2 rounded-full ${statusDot}`} /></td>
                          <td className="px-2 py-1.5 font-mono text-gray-600">{a.code}</td>
                          <td className="px-2 py-1.5 font-medium text-gray-800">{a.name}</td>
                          <td className="px-2 py-1.5 text-gray-500 text-[9px]">{a.type}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{a.debitTotal > 0 ? fmt$(a.debitTotal) : ''}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{a.creditTotal > 0 ? fmt$(a.creditTotal) : ''}</td>
                          <td className={`px-2 py-1.5 text-right font-mono font-semibold tabular-nums ${a.balance < 0 ? 'text-brand' : 'text-gray-900'}`}>
                            {a.balance < 0 ? `(${fmt$(Math.abs(a.balance))})` : fmt$(a.balance)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-gray-500">
                            {a.postings}
                            {a.todayPostings > 0 && <span className="text-green-600 ml-0.5">(+{a.todayPostings})</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right text-gray-400 text-[9px]">{a.lastPosting ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {accounts.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold text-[11px]">
                        <td colSpan={4} className="px-2 py-1.5 text-gray-700">TOTALS</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt$(glSummary?.totalDebits ?? 0)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt$(glSummary?.totalCredits ?? 0)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">{fmt$(glSummary?.variance ?? 0)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
                {accounts.length === 0 && <p className="p-4 text-gray-400 text-xs text-center">No GL accounts found.</p>}
              </div>
            )}

            {/* ── Tab: Revenue & Expenses Charts ── */}
            {centerTab === 'charts' && (
              <div className="space-y-3">
                {/* Revenue breakdown pie + Expense breakdown pie */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white rounded-lg shadow p-3">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Revenue by Account</h4>
                    {(charts?.revenueByAccount ?? []).length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie data={charts.revenueByAccount.slice(0, 6)} dataKey="value" cx="50%" cy="50%" outerRadius={65}
                            label={({ name, percent }: any) => `${name.substring(0, 12)} ${(percent * 100).toFixed(0)}%`}
                            labelLine={false} style={{ fontSize: 8 }}>
                            {charts.revenueByAccount.slice(0, 6).map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmt$(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <p className="text-xs text-gray-400 text-center py-8">No revenue data</p>}
                  </div>
                  <div className="bg-white rounded-lg shadow p-3">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Expense by Account</h4>
                    {(charts?.expenseByAccount ?? []).length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie data={charts.expenseByAccount.slice(0, 6)} dataKey="value" cx="50%" cy="50%" outerRadius={65}
                            label={({ name, percent }: any) => `${name.substring(0, 12)} ${(percent * 100).toFixed(0)}%`}
                            labelLine={false} style={{ fontSize: 8 }}>
                            {charts.expenseByAccount.slice(0, 6).map((_: any, i: number) => <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmt$(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : <p className="text-xs text-gray-400 text-center py-8">No expense data</p>}
                  </div>
                </div>

                {/* Balance sheet bar + Entry sources */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white rounded-lg shadow p-3">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Balance Sheet</h4>
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={charts?.balanceSheet ?? []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="category" tick={{ fontSize: 9 }} />
                        <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 9 }} />
                        <Tooltip formatter={(v: number) => fmt$(v)} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {(charts?.balanceSheet ?? []).map((_: any, i: number) => <Cell key={i} fill={COLORS[i]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="bg-white rounded-lg shadow p-3">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Entries by Source</h4>
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={charts?.entryBySource ?? []} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 9 }} />
                        <YAxis type="category" dataKey="source" tick={{ fontSize: 8 }} width={80} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 7-day activity trend */}
                {(kpiTrends?.dayHistory ?? []).length > 0 && (
                  <div className="bg-white rounded-lg shadow p-3">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">7-Day Journal Activity</h4>
                    <ResponsiveContainer width="100%" height={120}>
                      <LineChart data={kpiTrends.dayHistory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                        <YAxis tick={{ fontSize: 9 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="entries" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Entries" />
                        <Line type="monotone" dataKey="debits" stroke="#1e40af" strokeWidth={1.5} dot={{ r: 2 }} name="Debits" />
                        <Line type="monotone" dataKey="credits" stroke="#ef4444" strokeWidth={1.5} dot={{ r: 2 }} name="Credits" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Dept Performance ── */}
            {centerTab === 'kpis' && (
              <div className="space-y-3">
                {/* KPI cards */}
                <div className="grid grid-cols-3 gap-2">
                  {(kpiTrends?.kpis ?? []).map((kpi: any) => (
                    <div key={kpi.key} className="bg-white rounded-lg shadow p-3">
                      <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">{kpi.label}</p>
                      <p className="text-lg font-bold text-gray-900 mt-0.5">
                        {kpi.format === 'currency' ? fmt$(kpi.value) : kpi.format === 'percent' ? `${kpi.value.toFixed(1)}%` : kpi.format === 'ratio' ? kpi.value.toFixed(2) : kpi.value}
                      </p>
                      {kpi.target != null && (
                        <p className={`text-[9px] mt-0.5 ${kpi.value >= kpi.target ? 'text-green-600' : 'text-amber-600'}`}>
                          Target: {kpi.format === 'percent' ? `${kpi.target}%` : kpi.target}
                        </p>
                      )}
                      {(kpi.trend ?? []).length > 0 && (
                        <div className="mt-1" style={{ height: 24 }}>
                          <ResponsiveContainer width="100%" height={24}>
                            <LineChart data={kpi.trend.map((v: number, i: number) => ({ v, i }))}>
                              <Line type="monotone" dataKey="v" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Department performance table */}
                {(kpiTrends?.departments ?? []).length > 0 && (
                  <div className="bg-white rounded-lg shadow p-3">
                    <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Department Gross Profit</h4>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          <th className="pb-1.5 font-medium">Department</th>
                          <th className="pb-1.5 text-right font-medium">Revenue</th>
                          <th className="pb-1.5 text-right font-medium">Cost</th>
                          <th className="pb-1.5 text-right font-medium">Gross Profit</th>
                          <th className="pb-1.5 text-right font-medium">GP %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(kpiTrends?.departments ?? []).map((d: any) => (
                          <tr key={d.department} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-1.5 font-medium text-gray-800">{d.department}</td>
                            <td className="py-1.5 text-right tabular-nums">{fmt$(d.revenue)}</td>
                            <td className="py-1.5 text-right tabular-nums text-gray-500">{fmt$(d.cost)}</td>
                            <td className="py-1.5 text-right tabular-nums font-semibold text-green-700">{fmt$(d.grossProfit)}</td>
                            <td className="py-1.5 text-right tabular-nums">{d.gpPct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ═══ ZONE 4: Financial KPIs + Sparklines ═══ */}
        <div className="col-span-3 flex flex-col">
          <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5 px-0.5">
            Financial KPIs
          </h3>
          <div className="flex-1 overflow-y-auto space-y-1.5" style={{ maxHeight: 440 }}>
            {/* KPI cards from kpiTrends */}
            {(kpiTrends?.kpis ?? []).map((kpi: any) => (
              <div key={kpi.key} className="bg-white rounded-lg shadow p-2.5">
                <div className="flex items-baseline justify-between">
                  <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">{kpi.label}</p>
                  {kpi.target != null && (
                    <span className={`text-[8px] font-bold ${kpi.value >= kpi.target ? 'text-green-600' : 'text-red-600'}`}>
                      {kpi.value >= kpi.target ? '▲ On Target' : '▼ Below Target'}
                    </span>
                  )}
                </div>
                <p className="text-lg font-bold text-gray-900">
                  {kpi.format === 'currency' ? fmt$(kpi.value) : kpi.format === 'percent' ? `${kpi.value.toFixed(1)}%` : kpi.format === 'ratio' ? kpi.value.toFixed(2) : kpi.value}
                </p>
                {(kpi.trend ?? []).length > 0 && (
                  <div style={{ height: 28 }}>
                    <ResponsiveContainer width="100%" height={28}>
                      <LineChart data={kpi.trend.map((v: number, i: number) => ({ v, i }))}>
                        <Line type="monotone" dataKey="v" stroke={kpi.value >= (kpi.target ?? kpi.value) ? '#22c55e' : '#ef4444'} strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ))}

            {/* Cash accounts breakdown */}
            {accounts.filter((a: any) => a.name.toLowerCase().includes('cash') || a.name.toLowerCase().includes('check')).length > 0 && (
              <div className="bg-white rounded-lg shadow p-2.5">
                <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Cash Accounts</p>
                {accounts.filter((a: any) => a.name.toLowerCase().includes('cash') || a.name.toLowerCase().includes('check')).map((a: any) => (
                  <div key={a.id} className="flex justify-between py-0.5 text-xs">
                    <span className="text-gray-600">{a.name}</span>
                    <span className="font-medium tabular-nums">{fmt$(a.balance)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Account type breakdown */}
            <div className="bg-white rounded-lg shadow p-2.5">
              <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Balance by Type</p>
              {(() => {
                const byType: Record<string, number> = {};
                for (const a of accounts) {
                  byType[a.type] = (byType[a.type] ?? 0) + a.balance;
                }
                return Object.entries(byType).map(([type, bal]) => (
                  <div key={type} className="flex justify-between py-0.5 text-xs">
                    <span className="text-gray-600">{type}</span>
                    <span className={`font-medium tabular-nums ${bal < 0 ? 'text-brand' : 'text-gray-900'}`}>
                      {bal < 0 ? `(${fmt$(Math.abs(bal))})` : fmt$(bal)}
                    </span>
                  </div>
                ));
              })()}
            </div>

            {/* GL Activity summary */}
            <div className="bg-white rounded-lg shadow p-2.5">
              <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Today's Activity</p>
              <div className="text-xs text-gray-600">
                <p>{accounts.filter((a: any) => a.todayPostings > 0).length} accounts had activity</p>
                <p>{accounts.reduce((s: number, a: any) => s + (a.todayPostings ?? 0), 0)} total postings today</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ ZONE 5: Ashley AI — Backend-Powered Q&A ═══ */}
      <div className="bg-white rounded-lg shadow p-3">
        {ashleyMessages.length > 0 && (
          <div ref={ashleyRef} className="max-h-28 overflow-y-auto mb-2 space-y-1.5">
            {ashleyMessages.map((msg, i) => (
              <div key={i} className={`px-3 py-1.5 rounded-lg text-xs max-w-[85%] ${
                msg.role === 'user'
                  ? 'ml-auto bg-brand-light text-blue-800 text-right'
                  : 'bg-gray-50 text-gray-700 border-l-3 border-l-4 border-purple-400'
              }`}>
                {msg.role === 'ashley' && <span className="block text-[8px] text-purple-600 font-bold mb-0.5">Ashley AI (Live Data)</span>}
                {msg.text}
              </div>
            ))}
            {ashleyLoading && (
              <div className="bg-gray-50 text-gray-400 px-3 py-1.5 rounded-lg text-xs border-l-4 border-purple-300 animate-pulse">
                Ashley is querying live data...
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2 items-center">
          <span className="text-base">🤖</span>
          <input
            value={ashleyInput}
            onChange={e => setAshleyInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAshley()}
            placeholder='Ask Ashley AI... "GL status?" · "Cash position?" · "Revenue breakdown?" · "Unposted entries?"'
            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button onClick={handleAshley} disabled={ashleyLoading}
            className="bg-brand text-white px-3 py-1.5 rounded-lg text-[10px] font-bold hover:bg-brand transition-colors disabled:opacity-50">
            {ashleyLoading ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
