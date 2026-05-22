import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi, glApi, eomApi, agentApi, cashflowApi } from '../api/client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import PageError from '../components/PageError';
import StatusBadge from '../components/StatusBadge';
import { SkeletonKPI } from '../components/Skeleton';
import AIInsight from '../components/AIInsight';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowRight,
  Bot,
  Zap,
} from 'lucide-react';

const fmt = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtCurrency = (cents: number) => {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`;
  if (Math.abs(dollars) >= 1_000) return `$${Math.round(dollars).toLocaleString('en-US')}`;
  return `$${dollars.toFixed(0)}`;
};

const pct = (a: number, b: number) => (b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`);

const timeAgo = (d: string) => {
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

export default function Dashboard() {
  const { data: summary, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboardApi.getSummary,
    retry: false,
    refetchInterval: 30000,
  });
  const { data: entries } = useQuery({ queryKey: ['gl-entries'], queryFn: () => glApi.getEntries('limit=10'), retry: false });
  const { data: agentLogs } = useQuery({ queryKey: ['agent-logs'], queryFn: agentApi.getLog, retry: false });
  const { data: cashflow } = useQuery({ queryKey: ['cashflow-forecast'], queryFn: cashflowApi.getForecast, retry: false, refetchInterval: 60000 });
  const { data: readiness, isError: readinessErr } = useQuery({ queryKey: ['eom-readiness'], queryFn: eomApi.getReadiness, retry: false, refetchInterval: 60000 });

  const s = summary;
  const pendingCount = s?.pendingApprovals ?? 0;
  const todayPosted = s?.glSummary?.posted ?? 0;
  const todayEntries = s?.glSummary?.todayEntries ?? 0;
  const revenueToday = s?.financials?.totalRevenue ?? 0;

  if (error) return <PageError error={error} serviceName="GL Service (Dashboard)" port={3010} retry={refetch} />;

  return (
    <div className="p-6 space-y-6">

      {/* ── KPI Row ── */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          <SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI />
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <KPICard
            label="Open ROs"
            value={String(todayEntries)}
            trend={todayEntries > 0 ? `${todayEntries} today` : 'None today'}
            trendUp
            icon={<Zap size={18} className="text-brand" />}
            iconBg="bg-brand-light"
            accentColor="border-brand"
          />
          <KPICard
            label="Posted Today"
            value={String(todayPosted)}
            trend={todayPosted > 0 ? `${todayPosted} entries` : 'None yet'}
            trendUp
            icon={<CheckCircle2 size={18} className="text-green-600" />}
            iconBg="bg-green-50"
            accentColor="border-green-500"
          />
          <KPICard
            label="Pending Review"
            value={String(pendingCount)}
            trend={pendingCount > 0 ? 'Requires attention' : 'All clear'}
            trendUp={pendingCount === 0}
            icon={pendingCount > 0 ? <AlertCircle size={18} className="text-amber-500" /> : <Clock size={18} className="text-amber-500" />}
            iconBg="bg-amber-50"
            accentColor={pendingCount > 0 ? 'border-amber-500' : 'border-green-500'}
            badge={pendingCount > 0}
          />
          <KPICard
            label="Revenue MTD"
            value={fmtCurrency(revenueToday)}
            trend={s?.financials?.revenueVsPriorMonth ? `vs prior: ${fmtCurrency(s.financials.revenueVsPriorMonth)}` : undefined}
            trendUp={revenueToday >= (s?.financials?.revenueVsPriorMonth ?? 0)}
            icon={<DollarSign size={18} className="text-brand" />}
            iconBg="bg-brand-light"
            accentColor="border-brand"
          />
        </div>
      )}

      {/* ── Middle Row: Recent Entries + Agent Feed ── */}
      <div className="grid grid-cols-5 gap-4">

        {/* Recent Journal Entries (3/5 width) */}
        <div className="col-span-3 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-900">Recent Journal Entries</span>
              <span className="bg-slate-100 text-slate-500 text-[10px] font-semibold px-2 py-0.5 rounded-full">Polling 30s</span>
            </div>
            <Link to="/gl" className="flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-hover no-underline">
              View All <ArrowRight size={12} />
            </Link>
          </div>
          <table className="w-full">
            <thead>
              <tr>
                {['Date', 'Source', 'Reference', 'Amount', 'Status'].map((h) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider ${h === 'Amount' ? 'text-right' : 'text-left'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                        <Zap size={18} className="text-slate-400" />
                      </div>
                      <div className="text-sm font-semibold text-slate-700">No journal entries yet</div>
                      <div className="text-xs text-slate-400">Post a transaction to see entries here</div>
                      <Link to="/manual-entry" className="mt-1 text-xs font-semibold text-brand no-underline">
                        + New Entry
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                (entries ?? []).slice(0, 10).map((e: any) => {
                  const total = (e.lines ?? []).reduce((a: number, l: any) => a + (l.debit ?? 0), 0);
                  return (
                    <tr key={e.id} className="border-t border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {new Date(e.entryDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                        {e.source}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-brand">
                        {e.sourceRef || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono font-semibold text-right text-slate-900">
                        {fmt(total)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={e.status} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Agent Activity Feed (2/5 width) */}
        <div className="col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
            <span className="text-sm font-semibold text-slate-900">Agent Decisions</span>
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          </div>
          <div className="px-6 py-2 max-h-80 overflow-y-auto divide-y divide-slate-50">
            {(agentLogs ?? []).length === 0 ? (
              (() => {
                const entryFeed = (entries ?? []).slice(0, 8).map((e: any) => ({
                  id: e.id,
                  icon: e.status === 'POSTED' ? 'approved' : e.status === 'PENDING_REVIEW' ? 'flagged' : 'processed',
                  agent:
                    e.source === 'PAYROLL'
                      ? 'Payroll Agent'
                      : e.source === 'SERVICE'
                      ? 'Service Agent'
                      : e.source === 'PARTS'
                      ? 'Parts Agent'
                      : 'GL Agent',
                  action: e.status === 'POSTED' ? 'APPROVED' : e.status === 'PENDING_REVIEW' ? 'FLAGGED' : 'PROCESSED',
                  isApproved: e.status === 'POSTED',
                  detail: `${e.sourceRef || 'Entry'} — ${fmt((e.lines ?? []).reduce((a: number, l: any) => a + (l.debit ?? 0), 0))}`,
                  time: e.entryDate,
                }));
                if (entryFeed.length === 0)
                  return (
                    <div className="flex flex-col items-center gap-2 py-12">
                      <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center">
                        <Bot size={18} className="text-slate-400" />
                      </div>
                      <div className="text-sm font-semibold text-slate-700">Agents standing by</div>
                      <div className="text-xs text-slate-400">Post a transaction to see decisions</div>
                    </div>
                  );
                return (
                  <>
                    {entryFeed.map((f) => (
                      <AgentRow
                        key={f.id}
                        agent={f.agent}
                        action={f.action}
                        detail={f.detail}
                        time={timeAgo(f.time)}
                        approved={f.isApproved}
                      />
                    ))}
                  </>
                );
              })()
            ) : (
              (agentLogs ?? []).slice(0, 15).map((l: any) => (
                <AgentRow
                  key={l.id}
                  agent={l.agentName}
                  action={l.humanRequired ? 'FLAGGED' : 'APPROVED'}
                  detail={l.actionTaken}
                  time={new Date(l.createdAt).toLocaleString()}
                  approved={!l.humanRequired}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom Row: Close Readiness + Cash Position + Quick Actions ── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Close Readiness */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 border-l-4 border-brand">
          <div className="flex items-center gap-3 mb-4">
            {readinessErr ? (
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                <span className="text-lg text-slate-400">—</span>
              </div>
            ) : readiness?.ready ? (
              <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
                <CheckCircle2 size={20} className="text-green-600" />
              </div>
            ) : (readiness?.blockers ?? []).length > 0 ? (
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
                <AlertCircle size={20} className="text-red-600" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center">
                <AlertCircle size={20} className="text-amber-500" />
              </div>
            )}
            <div>
              <div className="text-sm font-bold text-slate-900">March 2026 Close</div>
              <div className="text-xs text-slate-500">{readiness?.daysUntilMonthEnd ?? '—'} days remaining</div>
            </div>
          </div>
          {readinessErr ? (
            <p className="text-xs text-slate-400">EOM service unavailable</p>
          ) : (
            <div className="space-y-1.5">
              {(readiness?.blockers ?? []).map((b: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs text-red-600">
                  <span className="w-1 h-1 rounded-full bg-red-500 flex-shrink-0" />
                  <span>{b.description}</span>
                </div>
              ))}
              {(readiness?.warnings ?? []).map((w: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs text-amber-600">
                  <span className="w-1 h-1 rounded-full bg-amber-500 flex-shrink-0" />
                  <span>{w.description}</span>
                </div>
              ))}
              {readiness?.ready && (
                <div className="text-xs font-semibold text-green-600">No blockers — ready to close</div>
              )}
            </div>
          )}
        </div>

        {/* Cash Position */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 border-l-4 border-green-500">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Cash Position</div>
          <div className="text-3xl font-bold text-slate-900 font-mono tabular-nums mb-1">
            {fmt(s?.cashPosition?.totalCash ?? 0)}
          </div>
          <div className={`text-xs font-semibold mb-4 ${(s?.cashPosition?.totalCash ?? 0) === 0 ? 'text-green-600' : 'text-slate-500'}`}>
            Cash Clearing: {fmt(s?.cashPosition?.totalCash ?? 0)}
            {(s?.cashPosition?.totalCash ?? 0) === 0 ? ' — cleared' : ''}
          </div>
          {cashflow?.weeks?.length ? (
            <div className="flex gap-1 items-end h-12">
              {cashflow.weeks.map((w: any, i: number) => {
                const val = w.net ?? 0;
                const max = Math.max(...cashflow.weeks.map((wk: any) => Math.abs(wk.net ?? 0)), 1);
                const h = Math.max(6, (Math.abs(val) / max) * 44);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className="w-full rounded-sm opacity-70"
                      style={{
                        height: h,
                        background: val >= 0 ? '#059669' : '#DC2626',
                      }}
                    />
                    <span className="text-[9px] text-slate-400">{w.week ?? `W${i + 1}`}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No forecast data</p>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 border-l-4 border-slate-300">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Quick Actions</div>
          <div className="flex flex-col gap-2">
            <QuickAction label="+ New Journal Entry" to="/manual-entry" />
            <QuickAction label="Run EOM Pre-Flight" to="/eom" />
            <QuickAction
              label={pendingCount > 0 ? `Review Pending (${pendingCount})` : 'Review Pending'}
              to="/transactions"
              highlight={pendingCount > 0}
            />
            <QuickAction label="Generate Trial Balance" to="/trial-balance" />
          </div>
        </div>
      </div>

      {/* ── Revenue Trend Chart ── */}
      {(s?.revenueTrend ?? []).length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <div className="text-sm font-bold text-slate-900 mb-4">Revenue vs Expenses — 6 Month Trend</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={(s?.revenueTrend ?? []).map((r: any) => ({
                ...r,
                revenue: r.revenue / 100,
                expenses: r.expenses / 100,
                netIncome: r.netIncome / 100,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} />
              <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#64748B' }} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Line type="monotone" dataKey="revenue" stroke="#1D4ED8" strokeWidth={2} name="Revenue" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="expenses" stroke="#DC2626" strokeWidth={2} name="Expenses" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="netIncome" stroke="#059669" strokeWidth={2} strokeDasharray="5 5" name="Net Income" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Department Performance ── */}
      {(s?.deptPerformance ?? []).length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <span className="text-sm font-bold text-slate-900">Department Performance — MTD</span>
          </div>
          <table className="w-full">
            <thead>
              <tr>
                {['Department', 'Revenue', 'Cost', 'Gross Profit', 'GP %', 'Units'].map((h) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider ${h === 'Department' ? 'text-left' : 'text-right'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(s?.deptPerformance ?? []).map((d: any) => (
                <tr key={d.department} className="border-t border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-semibold text-slate-900">{d.department}</td>
                  <td className="px-4 py-3 text-sm font-mono text-right text-slate-700">{fmt(d.revenue)}</td>
                  <td className="px-4 py-3 text-sm font-mono text-right text-slate-400">{fmt(d.cost)}</td>
                  <td className="px-4 py-3 text-sm font-mono font-bold text-right text-green-600">{fmt(d.grossProfit)}</td>
                  <td className="px-4 py-3 text-sm text-right text-slate-600">{pct(d.grossProfit, d.revenue)}</td>
                  <td className="px-4 py-3 text-sm text-right text-slate-400">{d.units ?? d.roCount ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AIInsight
        pageType="dashboard"
        context="Controller Dashboard"
        data={{ summary: s, recentEntries: entries?.slice(0, 5) }}
      />
    </div>
  );
}

/* ── Sub-components ── */

function KPICard({
  label,
  value,
  trend,
  trendUp,
  icon,
  iconBg,
  accentColor,
  badge,
}: {
  label: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
  icon: React.ReactNode;
  iconBg: string;
  accentColor: string;
  badge?: boolean;
}) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-6 border-l-4 ${accentColor}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</div>
        <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>{icon}</div>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-3xl font-bold text-slate-900 tabular-nums">{value}</span>
        {badge && (
          <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">!</span>
        )}
      </div>
      {trend && (
        <div className="flex items-center gap-1">
          {trendUp ? (
            <TrendingUp size={12} className="text-green-600" />
          ) : (
            <TrendingDown size={12} className="text-red-500" />
          )}
          <span className={`text-xs font-medium ${trendUp ? 'text-green-600' : 'text-red-500'}`}>{trend}</span>
        </div>
      )}
    </div>
  );
}

function AgentRow({
  agent,
  action,
  detail,
  time,
  approved,
}: {
  agent: string;
  action: string;
  detail: string;
  time: string;
  approved: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${approved ? 'bg-green-50' : 'bg-amber-50'}`}>
        <Bot size={13} className={approved ? 'text-green-600' : 'text-amber-500'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-800">{agent}</span>
          <span className={`text-[10px] font-bold ${approved ? 'text-green-600' : 'text-amber-600'}`}>{action}</span>
        </div>
        <div className="text-[11px] text-slate-500 truncate mt-0.5">{detail}</div>
        <div className="text-[10px] text-slate-400 mt-0.5">{time}</div>
      </div>
    </div>
  );
}

function QuickAction({ label, to, highlight }: { label: string; to: string; highlight?: boolean }) {
  return (
    <Link
      to={to}
      className={[
        'block w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-center no-underline transition-colors',
        highlight
          ? 'bg-brand text-white hover:bg-brand-hover'
          : 'bg-slate-50 text-slate-700 hover:bg-slate-100',
      ].join(' ')}
    >
      {label}
    </Link>
  );
}
