import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, ResponsiveContainer,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell,
} from 'recharts';
import type { LucideIcon } from 'lucide-react';
import {
  TrendingUp, TrendingDown, DollarSign, CreditCard, Clock,
  CheckCircle, AlertTriangle, RefreshCw, ArrowUpRight,
  ArrowDownRight, Activity, Zap, ChevronRight, Shield, Minus,
  BarChart2, AlertCircle, CircleDot,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { dashboardApi, cashflowApi, eomApi } from '../../api/client';
import { Btn, PageHeader } from '../../components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgingBucket  { days: string; amount: number; count: number }
interface AgingData    { total: number; current: AgingBucket; thirty_plus: AgingBucket; sixty_plus: AgingBucket; ninety_plus: AgingBucket }
interface DeptPerf     { department: string; gp_percentage: number; target: number }
interface Anomaly      { description: string; amount: number; account: string; type: string }
interface DashboardData {
  daily_cash: { account_name: string; account_code: string; balance: number }[];
  mtd_pl: { revenue: number; gp: number; ni: number; budget_revenue: number; budget_gp: number; budget_ni: number; prior_year_revenue: number; cogs?: number; opex?: number };
  dept_performance: DeptPerf[];
  ap_aging: AgingData;
  ar_aging: AgingData;
  eom_checklist: { completed: number; total: number; items: { name: string; completed: boolean }[] };
  floor_plan: { total_balance: number; interest_accrual: number; units_count: number };
  pending_txns: { count: number; total: number };
  cash_flow_forecast: { days: number; predicted: number }[];
  anomalies: Anomaly[];
  eom_readiness: string;
  unposted_entries?: number;
  draft_entries?: number;
  gl_balanced?: boolean;
  dso?: number;
  dpo?: number;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

const $k  = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
const $   = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;
const varPct = (actual: number, budget: number) =>
  budget !== 0 ? ((actual - budget) / Math.abs(budget)) * 100 : 0;

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, trend, trendVal, accent, onClick,
}: {
  label: string; value: string; sub?: string;
  trend?: 'up' | 'down' | 'neutral'; trendVal?: string;
  accent?: string; onClick?: () => void;
}) {
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  const trendColor = trend === 'up' ? '#059669' : trend === 'down' ? '#DC2626' : '#94A3B8';
  return (
    <div
      onClick={onClick}
      className="rounded-2xl border shadow-sm p-4 flex flex-col gap-1 cursor-pointer hover:shadow-md transition-all duration-150"
      style={{
        borderColor: `${accent}30`,
        borderTopWidth: 3,
        borderTopColor: accent ?? '#1D4ED8',
        background: `${accent}09`,
      }}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>{label}</p>
      <p className="text-[24px] font-extrabold tracking-tight font-mono leading-tight" style={{ color: '#0F172A' }}>{value}</p>
      {(sub || trendVal) && (
        <div className="flex items-center gap-1 mt-0.5">
          {trendVal && (
            <span className="flex items-center gap-0.5 text-[11px] font-semibold" style={{ color: trendColor }}>
              <TrendIcon size={11} />
              {trendVal}
            </span>
          )}
          {sub && <span className="text-[11px] text-slate-400">{sub}</span>}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, icon: Icon, accent = '#1D4ED8', action, onAction, children }: {
  title: string; icon?: LucideIcon;
  accent?: string; action?: string; onAction?: () => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100" style={{ background: `${accent}08` }}>
        <div className="flex items-center gap-2">
          {Icon && (
            <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${accent}20` }}>
              <Icon size={13} style={{ color: accent }} />
            </div>
          )}
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: accent }}>{title}</span>
        </div>
        {action && (
          <button onClick={onAction} className="flex items-center gap-0.5 text-[11px] font-semibold hover:opacity-70 transition-opacity" style={{ color: accent }}>
            {action} <ChevronRight size={11} />
          </button>
        )}
      </div>
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}

function AgingBar({ label, amount, portion, color }: { label: string; amount: number; portion: number; color: string }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[12px] font-medium" style={{ color }}>{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 font-mono">{portion}%</span>
          <span className="text-[12px] font-mono font-bold" style={{ color }}>{$(amount)}</span>
        </div>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(portion, portion > 0 ? 3 : 0)}%`, background: color }} />
      </div>
    </div>
  );
}

function RatioRow({ label, value, status }: { label: string; value: string; status: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const palette = {
    good:    { dot: '#059669', text: '#059669', bg: '#ECFDF5' },
    warn:    { dot: '#D97706', text: '#D97706', bg: '#FFFBEB' },
    bad:     { dot: '#DC2626', text: '#DC2626', bg: '#FEF2F2' },
    neutral: { dot: '#94A3B8', text: '#475569', bg: 'transparent' },
  }[status];
  return (
    <div className="flex items-center justify-between py-[7px] border-b border-slate-50 last:border-0">
      <span className="text-[11px] text-slate-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-mono font-bold px-1.5 py-0.5 rounded-md" style={{ color: palette.text, background: palette.bg }}>
          {value}
        </span>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: palette.dot }} />
      </div>
    </div>
  );
}

function DeptPerfBar({ dept, gp, target }: { dept: string; gp: number; target: number }) {
  const ok = gp >= target;
  const bar = ok ? '#059669' : '#D97706';
  return (
    <div className="mb-3.5">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[12px] text-slate-600 truncate pr-2">{dept}</span>
        <span className="text-[12px] font-mono font-semibold flex-shrink-0" style={{ color: bar }}>
          {pct(gp)} <span className="text-slate-300 font-normal">/ {pct(target)}</span>
        </span>
      </div>
      <div className="relative h-2 bg-slate-100 rounded-full overflow-visible">
        <div className="h-full rounded-full" style={{ width: `${Math.min(gp, 100)}%`, background: bar }} />
        <div className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-slate-400 rounded-full" style={{ left: `${target}%` }} />
      </div>
    </div>
  );
}

function PLRow({ label, actual, budget, indent = false, isSub = false, bold = false, isExpense = false }: {
  label: string; actual: number; budget: number;
  indent?: boolean; isSub?: boolean; bold?: boolean; isExpense?: boolean;
}) {
  const hasRealBudget = budget > 1;
  const vr = hasRealBudget ? varPct(actual, budget) : 0;
  const bad = isExpense ? vr > 0 : vr < 0;
  return (
    <tr className={`border-b border-slate-50 hover:bg-blue-50/30 transition-colors ${bold ? 'bg-slate-50/60' : ''}`}>
      <td className={`py-[6px] text-[12px] ${bold ? 'font-bold text-slate-900' : isSub ? 'pl-5 text-slate-400 italic text-[11px]' : indent ? 'pl-4 text-slate-500' : 'text-slate-700'}`}>
        {label}
      </td>
      <td className={`py-[6px] text-right font-mono text-[12px] ${bold ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
        {isSub && actual === 0 ? '' : $(actual)}
      </td>
      <td className="py-[6px] text-right font-mono text-[12px] text-slate-400">
        {isSub || !hasRealBudget ? '' : $(budget)}
      </td>
      <td className={`py-[6px] text-right font-mono text-[11px] font-bold ${!hasRealBudget || isSub ? 'text-slate-200' : bad ? 'text-red-600' : 'text-emerald-600'}`}>
        {!hasRealBudget || isSub ? '—' : `${vr >= 0 ? '+' : ''}${vr.toFixed(1)}%`}
      </td>
    </tr>
  );
}

// ─── Cashflow chart tooltip ───────────────────────────────────────────────────

function CfTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 text-[11px]">
      <p className="font-semibold text-slate-700">{payload[0]?.payload?.label}</p>
      <p className="font-mono text-blue-700">{$(payload[0]?.value ?? 0)}</p>
    </div>
  );
}

// ─── Empty aging ──────────────────────────────────────────────────────────────

const EMPTY_AGING: AgingData = {
  total: 0,
  current: { days: 'Current', amount: 0, count: 0 },
  thirty_plus: { days: '30+', amount: 0, count: 0 },
  sixty_plus: { days: '60+', amount: 0, count: 0 },
  ninety_plus: { days: '90+', amount: 0, count: 0 },
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function FinancialDashboard() {
  const navigate = useNavigate();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const { data: raw, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['financial-dashboard'],
    queryFn: async () => {
      const r = await dashboardApi.getSummary();
      setLastRefresh(new Date());
      return r as DashboardData;
    },
    retry: false,
    refetchInterval: autoRefresh ? 300_000 : false,
  });

  const { data: cfRaw } = useQuery({
    queryKey: ['cashflow-forecast'],
    queryFn: () => cashflowApi.getForecast(),
    retry: false,
  });

  const { data: eomRaw } = useQuery({
    queryKey: ['eom-readiness'],
    queryFn: () => eomApi.getReadiness(),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="p-6 animate-pulse space-y-4">
        <div className="h-8 bg-slate-100 rounded-xl w-64" />
        <div className="grid grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 bg-slate-100 rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-5 h-64 bg-slate-100 rounded-2xl" />
          <div className="col-span-4 h-64 bg-slate-100 rounded-2xl" />
          <div className="col-span-3 h-64 bg-slate-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error && !raw) {
    return (
      <div className="p-6">
        <div className="rounded-2xl bg-red-50 border border-red-200 p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 text-red-500" size={24} />
          <p className="font-semibold text-red-800">Dashboard unavailable</p>
          <p className="text-sm text-red-600 mt-1">Could not reach the dashboard service.</p>
          <button onClick={() => refetch()} className="mt-3 text-sm text-red-700 underline hover:no-underline">
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── Safe data extraction ──────────────────────────────────────────────────

  const d: DashboardData = {
    daily_cash:       raw?.daily_cash       ?? [],
    mtd_pl:           raw?.mtd_pl           ?? { revenue: 0, gp: 0, ni: 0, budget_revenue: 1, budget_gp: 1, budget_ni: 1, prior_year_revenue: 0, cogs: 0, opex: 0 },
    dept_performance: raw?.dept_performance ?? [],
    ap_aging:         raw?.ap_aging         ?? EMPTY_AGING,
    ar_aging:         raw?.ar_aging         ?? EMPTY_AGING,
    eom_checklist:    raw?.eom_checklist    ?? { completed: 0, total: 1, items: [] },
    floor_plan:       raw?.floor_plan       ?? { total_balance: 0, interest_accrual: 0, units_count: 0 },
    pending_txns:     raw?.pending_txns     ?? { count: 0, total: 0 },
    cash_flow_forecast: raw?.cash_flow_forecast ?? [],
    anomalies:        raw?.anomalies        ?? [],
    eom_readiness:    raw?.eom_readiness    ?? '',
    unposted_entries: raw?.unposted_entries ?? 0,
    draft_entries:    raw?.draft_entries    ?? 0,
    gl_balanced:      raw?.gl_balanced      ?? true,
    dso:              raw?.dso              ?? 0,
    dpo:              raw?.dpo              ?? 0,
  };

  const cashTotal  = d.daily_cash.reduce((s, a) => s + a.balance, 0);
  const gpPct      = d.mtd_pl.revenue > 0 ? (d.mtd_pl.gp / d.mtd_pl.revenue) * 100 : 0;
  const niPct      = d.mtd_pl.revenue > 0 ? (d.mtd_pl.ni / d.mtd_pl.revenue) * 100 : 0;
  const revVar     = varPct(d.mtd_pl.revenue, d.mtd_pl.budget_revenue);
  const niVar      = varPct(d.mtd_pl.ni, d.mtd_pl.budget_ni);
  const cogs       = d.mtd_pl.cogs ?? (d.mtd_pl.revenue - d.mtd_pl.gp);
  const opex       = d.mtd_pl.opex ?? (d.mtd_pl.gp - d.mtd_pl.ni);
  const eomPct     = d.eom_checklist.total > 0 ? (d.eom_checklist.completed / d.eom_checklist.total) * 100 : 0;
  const dso        = d.dso ?? 0;
  const dpo        = d.dpo ?? 0;

  // Cash flow chart data
  const cfForecast = (cfRaw?.forecasts ?? d.cash_flow_forecast).map((f: any) => ({
    label: `Day ${f.days}`,
    predicted: f.predicted ?? f.predicted_balance ?? 0,
    days: f.days,
  }));
  const cfActuals = (cfRaw?.today != null)
    ? [{ label: 'Today', predicted: cfRaw.today, days: 0 }, ...cfForecast]
    : cfForecast;

  // EOM data
  const eomStepsTotal     = eomRaw?.totalSteps     ?? d.eom_checklist.total;
  const eomStepsCompleted = eomRaw?.completedSteps ?? d.eom_checklist.completed;
  const eomNextStep       = eomRaw?.nextStep       ?? d.eom_checklist.items.find((i: any) => !i.completed)?.name ?? '';

  // Aging helpers
  function agingPortion(amount: number, total: number) {
    return total > 0 ? Math.round((amount / total) * 100) : 0;
  }

  // Key ratios
  const currentRatio = cashTotal > 0 && d.ap_aging.total > 0 ? cashTotal / d.ap_aging.total : 0;
  const quickRatio   = d.ar_aging.total > 0 && d.ap_aging.total > 0 ? (cashTotal + d.ar_aging.total) / d.ap_aging.total : 0;

  const ratioStatus = (v: number, good: number, warn: number): 'good' | 'warn' | 'bad' | 'neutral' => {
    if (v === 0) return 'neutral';
    return v >= good ? 'good' : v >= warn ? 'warn' : 'bad';
  };

  // Alert count
  const alertCount = d.anomalies.length + (d.pending_txns.count > 0 ? 1 : 0) + (!d.gl_balanced ? 1 : 0);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-5 space-y-4 min-h-full" style={{ background: '#F8FAFC' }}>

      {/* Header */}
      <PageHeader
        title="Financial Dashboard"
        subtitle={`May 2026 · MTD Performance + Forecast · Refreshed ${lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12px] text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                className="rounded w-3.5 h-3.5"
              />
              Auto-refresh
            </label>
            <Btn variant="secondary" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
              <span className="ml-1.5 text-[12px]">{isFetching ? 'Refreshing…' : 'Refresh'}</span>
            </Btn>
          </div>
        }
      />

      {/* ── Hero KPI Strip ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-6 gap-3">
        <KpiCard
          label="Cash on Hand"
          value={$k(cashTotal)}
          sub="across all accounts"
          accent="#059669"
          onClick={() => navigate('/accounting/bank-recon')}
        />
        <KpiCard
          label="Revenue MTD"
          value={$k(d.mtd_pl.revenue)}
          trendVal={`${revVar >= 0 ? '+' : ''}${revVar.toFixed(1)}% vs bgt`}
          trend={revVar >= 0 ? 'up' : 'down'}
          accent="#1D4ED8"
          onClick={() => navigate('/accounting/financial-statements')}
        />
        <KpiCard
          label="Gross Profit"
          value={$k(d.mtd_pl.gp)}
          trendVal={pct(gpPct) + ' GP%'}
          trend={gpPct >= 30 ? 'up' : gpPct >= 20 ? 'neutral' : 'down'}
          accent="#7C3AED"
          onClick={() => navigate('/accounting/financial-statements')}
        />
        <KpiCard
          label="Net Income"
          value={$k(d.mtd_pl.ni)}
          trendVal={`${niVar >= 0 ? '+' : ''}${niVar.toFixed(1)}% vs bgt`}
          trend={d.mtd_pl.ni >= 0 ? 'up' : 'down'}
          accent={d.mtd_pl.ni >= 0 ? '#059669' : '#DC2626'}
          onClick={() => navigate('/accounting/financial-statements')}
        />
        <KpiCard
          label="AR Outstanding"
          value={$k(d.ar_aging.total)}
          sub={dso > 0 ? `DSO: ${dso} days` : `${d.ar_aging.current?.count ?? 0} accounts`}
          trend={d.ar_aging.ninety_plus?.amount > 0 ? 'down' : 'neutral'}
          trendVal={d.ar_aging.ninety_plus?.amount > 0 ? `${$(d.ar_aging.ninety_plus.amount)} 90+` : undefined}
          accent="#F59E0B"
          onClick={() => navigate('/accounting/ar')}
        />
        <KpiCard
          label="AP Outstanding"
          value={$k(d.ap_aging.total)}
          sub={dpo > 0 ? `DPO: ${dpo} days` : `${d.ap_aging.current?.count ?? 0} vendors`}
          trend={d.ap_aging.ninety_plus?.amount > 0 ? 'down' : 'neutral'}
          trendVal={d.ap_aging.ninety_plus?.amount > 0 ? `${$(d.ap_aging.ninety_plus.amount)} 90+` : undefined}
          accent="#EF4444"
          onClick={() => navigate('/accounting/ap')}
        />
      </div>

      {/* ── Main 3-column grid ────────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-4">

        {/* ── Column 1 (5/12): Income Statement + Cash Flow ────────────── */}
        <div className="col-span-5 flex flex-col gap-4">

          {/* MTD Income Statement */}
          <SectionCard title="MTD Income Statement" icon={BarChart2} accent="#1D4ED8" action="Full P&L" onAction={() => navigate('/accounting/financial-statements')}>
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-100">
                  <th className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 pb-2">Line Item</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider text-slate-400 pb-2">Actual</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider text-slate-400 pb-2">Budget</th>
                  <th className="text-right text-[10px] font-bold uppercase tracking-wider text-slate-400 pb-2">Var %</th>
                </tr>
              </thead>
              <tbody>
                <PLRow label="Net Revenue"      actual={d.mtd_pl.revenue} budget={d.mtd_pl.budget_revenue} bold />
                <PLRow label="Cost of Sales"    actual={cogs}             budget={d.mtd_pl.budget_revenue * 0.65} indent isExpense />
                <PLRow label="Gross Profit"     actual={d.mtd_pl.gp}      budget={d.mtd_pl.budget_gp} bold />
                <PLRow label={`GP %  ${pct(gpPct)}`} actual={0} budget={0} isSub />
                <PLRow label="Operating Expenses" actual={opex}           budget={d.mtd_pl.budget_gp * 0.65} indent isExpense />
                <PLRow label="Net Income"       actual={d.mtd_pl.ni}      budget={d.mtd_pl.budget_ni} bold />
                <PLRow label={`NI %  ${pct(niPct)}`} actual={0} budget={0} isSub />
              </tbody>
            </table>
            {d.mtd_pl.prior_year_revenue > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-50 flex items-center gap-2 text-[11px] text-slate-400">
                <TrendingUp size={11} />
                Prior year revenue: <span className="font-mono font-semibold text-slate-600">{$(d.mtd_pl.prior_year_revenue)}</span>
                <span className={`ml-auto font-semibold ${d.mtd_pl.revenue >= d.mtd_pl.prior_year_revenue ? 'text-green-600' : 'text-red-600'}`}>
                  {varPct(d.mtd_pl.revenue, d.mtd_pl.prior_year_revenue) >= 0 ? '▲' : '▼'} {Math.abs(varPct(d.mtd_pl.revenue, d.mtd_pl.prior_year_revenue)).toFixed(1)}% YoY
                </span>
              </div>
            )}
          </SectionCard>

          {/* Cash Flow Forecast */}
          <SectionCard title="Cash Flow Forecast" icon={Activity} accent="#6366F1" action="Details" onAction={() => navigate('/accounting/bank-recon')}>
            {cfActuals.length > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  {[{ label: '7-Day', val: cfRaw?.day7 }, { label: '30-Day', val: cfRaw?.day30 }, { label: '90-Day', val: cfRaw?.day90 }]
                    .filter(x => x.val != null)
                    .map(({ label, val }) => (
                      <div key={label} className="bg-slate-50 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</p>
                        <p className={`font-mono text-[15px] font-bold mt-0.5 ${(val ?? 0) >= 0 ? 'text-slate-900' : 'text-red-600'}`}>{$k(val ?? 0)}</p>
                      </div>
                    ))
                  }
                </div>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={cfActuals} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#F1F5F9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94A3B8' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={v => $k(v)} width={55} />
                    <Tooltip content={<CfTooltip />} />
                    <ReferenceLine y={0} stroke="#DC2626" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="predicted" stroke="#6366F1" strokeWidth={2} dot={{ r: 3, fill: '#6366F1' }} />
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-24 text-slate-400 text-[12px]">
                <Activity size={20} className="mb-2 opacity-30" />
                No forecast data — run cashflow service
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── Column 2 (4/12): Dept Performance + GL Health ────────────── */}
        <div className="col-span-4 flex flex-col gap-4">

          {/* Department GP% Performance */}
          <SectionCard title="Department GP %" icon={BarChart2} accent="#7C3AED" action="Full Report" onAction={() => navigate('/accounting/financial-statements')}>
            {d.dept_performance.length > 0 ? (
              <>
                {d.dept_performance.map(dept => (
                  <DeptPerfBar key={dept.department} dept={dept.department} gp={dept.gp_percentage} target={dept.target} />
                ))}
                <p className="text-[10px] text-slate-300 mt-2">Vertical line = target. Green = at/above. Amber = below.</p>
              </>
            ) : (
              <div className="h-32 flex flex-col items-center justify-center text-slate-400 text-[12px]">
                <BarChart2 size={20} className="mb-2 opacity-30" />
                No department data available
              </div>
            )}
          </SectionCard>

          {/* GL Health */}
          <SectionCard title="GL Health" icon={Shield} accent="#059669" action="Journal Entries" onAction={() => navigate('/accounting/gl')}>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 rounded-xl px-3"
                style={{ background: d.gl_balanced ? '#ECFDF5' : '#FEF2F2' }}>
                <div className="flex items-center gap-2">
                  {d.gl_balanced
                    ? <CheckCircle size={14} className="text-green-600" />
                    : <AlertTriangle size={14} className="text-red-600" />
                  }
                  <span className="text-[12px] font-semibold" style={{ color: d.gl_balanced ? '#059669' : '#DC2626' }}>
                    Trial Balance {d.gl_balanced ? 'Balanced' : 'OUT OF BALANCE'}
                  </span>
                </div>
              </div>

              {d.unposted_entries! > 0 && (
                <button onClick={() => navigate('/accounting/gl')}
                  className="w-full flex items-center justify-between py-2 px-3 rounded-xl bg-amber-50 border border-amber-100 hover:border-amber-300 transition-colors">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={13} className="text-amber-600" />
                    <span className="text-[12px] text-amber-800 font-medium">{d.unposted_entries} Unposted Entries</span>
                  </div>
                  <span className="text-[11px] text-amber-600 font-semibold">Review →</span>
                </button>
              )}

              {d.draft_entries! > 0 && (
                <button onClick={() => navigate('/accounting/gl')}
                  className="w-full flex items-center justify-between py-2 px-3 rounded-xl bg-blue-50 border border-blue-100 hover:border-blue-300 transition-colors">
                  <div className="flex items-center gap-2">
                    <CircleDot size={13} className="text-blue-600" />
                    <span className="text-[12px] text-blue-800 font-medium">{d.draft_entries} Draft Entries</span>
                  </div>
                  <span className="text-[11px] text-blue-600 font-semibold">Edit →</span>
                </button>
              )}

              {d.pending_txns.count > 0 && (
                <button onClick={() => navigate('/accounting/ap')}
                  className="w-full flex items-center justify-between py-2 px-3 rounded-xl bg-red-50 border border-red-100 hover:border-red-300 transition-colors">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={13} className="text-red-600" />
                    <span className="text-[12px] text-red-800 font-medium">{d.pending_txns.count} Pending Transactions</span>
                    <span className="text-[11px] text-red-600 font-mono">{$(d.pending_txns.total)}</span>
                  </div>
                  <span className="text-[11px] text-red-600 font-semibold">Clear →</span>
                </button>
              )}

              {d.gl_balanced && d.unposted_entries === 0 && d.draft_entries === 0 && d.pending_txns.count === 0 && (
                <div className="flex items-center gap-2 py-2 px-3 rounded-xl bg-slate-50 text-slate-400 text-[12px]">
                  <CheckCircle size={13} className="text-green-500" />
                  All clear — no issues requiring attention
                </div>
              )}
            </div>
          </SectionCard>

          {/* EOM Close Status */}
          <SectionCard title="EOM Close — May 2026" icon={CheckCircle} accent="#059669" action="EOM Dashboard" onAction={() => navigate('/accounting/eom')}>
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] text-slate-500">
                  {eomStepsCompleted} of {eomStepsTotal} steps complete
                </span>
                <span className="text-[13px] font-bold font-mono text-slate-900">{eomPct.toFixed(0)}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                <div
                  className="h-full rounded-full transition-all duration-700 shadow-sm"
                  style={{
                    width: `${eomPct}%`,
                    background: eomPct >= 80
                      ? 'linear-gradient(90deg, #059669, #10B981)'
                      : eomPct >= 50
                      ? 'linear-gradient(90deg, #D97706, #F59E0B)'
                      : 'linear-gradient(90deg, #1D4ED8, #3B82F6)',
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              {d.eom_checklist.items.slice(0, 5).map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <span className={item.completed ? 'text-green-500' : 'text-slate-300'}>
                    {item.completed ? '✓' : '○'}
                  </span>
                  <span className={item.completed ? 'text-slate-400 line-through' : 'text-slate-600'}>
                    {item.name}
                  </span>
                </div>
              ))}
              {eomNextStep && !d.eom_checklist.items.length && (
                <p className="text-[12px] text-slate-500">Next: <span className="font-medium text-slate-700">{eomNextStep}</span></p>
              )}
            </div>
          </SectionCard>
        </div>

        {/* ── Column 3 (3/12): Aging + Key Ratios ──────────────────────── */}
        <div className="col-span-3 flex flex-col gap-4">

          {/* AR Aging */}
          <SectionCard title="AR Aging" icon={Clock} accent="#F59E0B" action="AR" onAction={() => navigate('/accounting/ar')}>
            {d.ar_aging.total > 0 ? (
              <>
                <AgingBar label="Current" amount={d.ar_aging.current.amount} portion={agingPortion(d.ar_aging.current.amount, d.ar_aging.total)} color="#059669" />
                <AgingBar label="30+ Days" amount={d.ar_aging.thirty_plus.amount} portion={agingPortion(d.ar_aging.thirty_plus.amount, d.ar_aging.total)} color="#D97706" />
                <AgingBar label="60+ Days" amount={d.ar_aging.sixty_plus.amount} portion={agingPortion(d.ar_aging.sixty_plus.amount, d.ar_aging.total)} color="#EA580C" />
                <AgingBar label="90+ Days" amount={d.ar_aging.ninety_plus.amount} portion={agingPortion(d.ar_aging.ninety_plus.amount, d.ar_aging.total)} color="#DC2626" />
                <div className="mt-3 pt-3 border-t border-slate-50 flex justify-between items-center">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total AR</span>
                  <span className="font-mono text-[14px] font-bold text-slate-900">{$(d.ar_aging.total)}</span>
                </div>
              </>
            ) : (
              <p className="text-[12px] text-slate-400 text-center py-4">No AR balances</p>
            )}
          </SectionCard>

          {/* AP Aging */}
          <SectionCard title="AP Aging" icon={Clock} accent="#EF4444" action="AP" onAction={() => navigate('/accounting/ap')}>
            {d.ap_aging.total > 0 ? (
              <>
                <AgingBar label="Current" amount={d.ap_aging.current.amount} portion={agingPortion(d.ap_aging.current.amount, d.ap_aging.total)} color="#059669" />
                <AgingBar label="30+ Days" amount={d.ap_aging.thirty_plus.amount} portion={agingPortion(d.ap_aging.thirty_plus.amount, d.ap_aging.total)} color="#D97706" />
                <AgingBar label="60+ Days" amount={d.ap_aging.sixty_plus.amount} portion={agingPortion(d.ap_aging.sixty_plus.amount, d.ap_aging.total)} color="#EA580C" />
                <AgingBar label="90+ Days" amount={d.ap_aging.ninety_plus.amount} portion={agingPortion(d.ap_aging.ninety_plus.amount, d.ap_aging.total)} color="#DC2626" />
                <div className="mt-3 pt-3 border-t border-slate-50 flex justify-between items-center">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total AP</span>
                  <span className="font-mono text-[14px] font-bold text-slate-900">{$(d.ap_aging.total)}</span>
                </div>
              </>
            ) : (
              <p className="text-[12px] text-slate-400 text-center py-4">No AP balances</p>
            )}
          </SectionCard>

          {/* Key Ratios */}
          <SectionCard title="Key Ratios" icon={Zap} accent="#6366F1">
            <RatioRow label="Gross Profit %" value={pct(gpPct)} status={ratioStatus(gpPct, 30, 20)} />
            <RatioRow label="Net Income %"   value={pct(niPct)} status={ratioStatus(niPct, 10, 5)} />
            <RatioRow label="Current Ratio"  value={currentRatio > 0 ? currentRatio.toFixed(2) : '—'} status={ratioStatus(currentRatio, 1.5, 1.0)} />
            <RatioRow label="Quick Ratio"    value={quickRatio > 0 ? quickRatio.toFixed(2) : '—'} status={ratioStatus(quickRatio, 1.0, 0.7)} />
            {dso > 0 && <RatioRow label="DSO (days)"   value={`${dso}d`} status={ratioStatus(45 - dso, 15, 0)} />}
            {dpo > 0 && <RatioRow label="DPO (days)"   value={`${dpo}d`} status={ratioStatus(dpo, 30, 15)} />}
            <RatioRow label="Floor Plan"     value={$k(d.floor_plan.total_balance)} status="neutral" />
            <RatioRow label="Floor Plan Units" value={`${d.floor_plan.units_count} units`} status="neutral" />
          </SectionCard>
        </div>
      </div>

      {/* ── AI Intelligence / Alerts (full width) ────────────────────────── */}
      <div className="rounded-2xl border border-amber-200 shadow-sm overflow-hidden" style={{ background: '#FFFBF0' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-amber-200" style={{ background: '#FFF7E6' }}>
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-amber-500" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              AI Intelligence
            </span>
            {alertCount > 0 && (
              <span className="inline-flex items-center justify-center h-4 min-w-[16px] rounded-full text-[10px] font-bold text-white px-1"
                style={{ background: '#DC2626' }}>
                {alertCount}
              </span>
            )}
          </div>
          <button onClick={() => navigate('/agents')}
            className="flex items-center gap-0.5 text-[11px] text-blue-600 hover:text-blue-800 font-medium">
            Agent Console <ChevronRight size={11} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-0 divide-x divide-amber-100 px-2 py-3">
          {/* GL Balance status */}
          <div className="px-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">GL Integrity</p>
            <div className={`flex items-start gap-2 p-2.5 rounded-xl ${d.gl_balanced ? 'bg-green-50' : 'bg-red-50'}`}>
              {d.gl_balanced
                ? <CheckCircle size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
                : <AlertTriangle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
              }
              <div>
                <p className={`text-[12px] font-semibold ${d.gl_balanced ? 'text-green-800' : 'text-red-800'}`}>
                  {d.gl_balanced ? 'Trial Balance Balanced' : 'GL Out of Balance — Investigate'}
                </p>
                <p className={`text-[11px] mt-0.5 ${d.gl_balanced ? 'text-green-600' : 'text-red-600'}`}>
                  {d.gl_balanced ? 'All debits equal credits. No action required.' : 'Debits ≠ Credits. Immediate review needed.'}
                </p>
              </div>
            </div>
          </div>

          {/* Anomalies */}
          <div className="px-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Anomaly Scan</p>
            {d.anomalies.length === 0 ? (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-green-50">
                <CheckCircle size={14} className="text-green-600 flex-shrink-0 mt-0.5" />
                <p className="text-[12px] text-green-800 font-medium">No anomalies detected today</p>
              </div>
            ) : (
              <div className="space-y-2">
                {d.anomalies.slice(0, 2).map((a, i) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-100">
                    <AlertTriangle size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-amber-900 truncate">{a.description}</p>
                      <p className="text-[11px] text-amber-600 font-mono">{a.account} · {$(a.amount)}</p>
                    </div>
                  </div>
                ))}
                {d.anomalies.length > 2 && (
                  <button className="text-[11px] text-amber-700 font-semibold hover:text-amber-900">
                    +{d.anomalies.length - 2} more anomalies →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Action Queue */}
          <div className="px-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Action Queue</p>
            <div className="space-y-1.5">
              {d.unposted_entries! > 0 && (
                <button onClick={() => navigate('/accounting/gl')} className="w-full flex items-center justify-between text-left p-2 rounded-lg hover:bg-slate-50">
                  <span className="text-[12px] text-slate-700">{d.unposted_entries} entries need posting</span>
                  <ChevronRight size={12} className="text-slate-400" />
                </button>
              )}
              {d.ar_aging.ninety_plus?.amount > 0 && (
                <button onClick={() => navigate('/accounting/ar')} className="w-full flex items-center justify-between text-left p-2 rounded-lg hover:bg-slate-50">
                  <span className="text-[12px] text-slate-700">AR 90+ requires follow-up</span>
                  <ChevronRight size={12} className="text-slate-400" />
                </button>
              )}
              {eomPct < 100 && (
                <button onClick={() => navigate('/accounting/eom')} className="w-full flex items-center justify-between text-left p-2 rounded-lg hover:bg-slate-50">
                  <span className="text-[12px] text-slate-700">EOM close {eomPct.toFixed(0)}% — {eomStepsTotal - eomStepsCompleted} steps left</span>
                  <ChevronRight size={12} className="text-slate-400" />
                </button>
              )}
              {alertCount === 0 && (
                <p className="text-[12px] text-slate-400 p-2">No actions required</p>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
