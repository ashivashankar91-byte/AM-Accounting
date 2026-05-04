import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi, glApi, eomApi, agentApi, cashflowApi } from '../api/client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import PageError from '../components/PageError';
import StatusBadge from '../components/StatusBadge';
import { SkeletonKPI } from '../components/Skeleton';
import AIInsight from '../components/AIInsight';

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtCurrency = (cents: number) => {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`;
  if (Math.abs(dollars) >= 1_000) return `$${Math.round(dollars).toLocaleString('en-US')}`;
  return `$${dollars.toFixed(0)}`;
};
const pct = (a: number, b: number) => b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`;
const timeAgo = (d: string) => {
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const CARD: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

export default function Dashboard() {
  const { data: summary, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard-summary'], queryFn: dashboardApi.getSummary, retry: false, refetchInterval: 30000 });
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
    <div style={{ padding: 28 }}>
      {/* ═══ KPI Cards ═══ */}
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 24 }}>
          <SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI />
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 24 }}>
          <KPICard icon="🔧" iconBg="#EFF6FF" label="Open ROs" value={String(todayEntries)} valueColor="#1B4FE4" trend={todayEntries > 0 ? `${todayEntries} today` : undefined} trendUp />
          <KPICard icon="✅" iconBg="#F0FDF4" label="Posted Today" value={String(todayPosted)} valueColor="#059669" trend={todayPosted > 0 ? `${todayPosted} entries` : undefined} trendUp />
          <KPICard icon="⏳" iconBg="#FFFBEB" label="Pending Review" value={String(pendingCount)} valueColor="#D97706" trend={pendingCount > 0 ? 'Requires attention' : 'All clear'} trendUp={pendingCount === 0} badge={pendingCount > 0} />
          <KPICard icon="💰" iconBg="#F0FDF4" label="Revenue MTD" value={fmtCurrency(revenueToday)} valueColor="#0F172A" trend={s?.financials?.revenueVsPriorMonth ? `vs prior: ${fmtCurrency(s.financials.revenueVsPriorMonth)}` : undefined} trendUp={revenueToday >= (s?.financials?.revenueVsPriorMonth ?? 0)} />
        </div>
      )}

      {/* ═══ Middle: Transactions + Agent Feed ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 20, marginBottom: 24 }}>
        {/* Recent Journal Entries */}
        <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Recent Journal Entries</span>
              <span style={{ background: '#F1F5F9', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Polling 30s</span>
            </div>
            <Link to="/gl" style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', textDecoration: 'none' }}>View All →</Link>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E5E7EB' }}>
                {['Time', 'Source', 'Reference', 'Amount', 'Status'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: h === 'Amount' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '48px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>No journal entries yet</div>
                  <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>Post a transaction to see entries here</div>
                </td></tr>
              ) : (entries ?? []).slice(0, 10).map((e: any) => {
                const total = (e.lines ?? []).reduce((a: number, l: any) => a + (l.debit ?? 0), 0);
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid #F1F5F9' }}
                    onMouseEnter={(ev) => ev.currentTarget.style.background = '#F8FAFC'}
                    onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#374151' }}>{new Date(e.entryDate).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{e.source}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'monospace', color: 'var(--primary)' }}>{e.sourceRef || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'monospace', textAlign: 'right', fontWeight: 600, color: total > 0 ? 'var(--debit-color)' : 'var(--text)' }}>{fmt(total)}</td>
                    <td style={{ padding: '12px 16px' }}><StatusBadge status={e.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Agent Activity Feed */}
        <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Agent Decisions</span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', animation: 'pulse 2s infinite' }} />
          </div>
          <div style={{ padding: '12px 20px', maxHeight: 400, overflowY: 'auto' }}>
            {(agentLogs ?? []).length === 0 ? (
              (() => {
                const entryFeed = (entries ?? []).slice(0, 8).map((e: any) => ({
                  id: e.id,
                  icon: e.status === 'POSTED' ? '🤖' : e.status === 'PENDING_REVIEW' ? '⚠️' : '📋',
                  agent: e.source === 'PAYROLL' ? 'Payroll Agent' : e.source === 'SERVICE' ? 'Service Agent' : e.source === 'PARTS' ? 'Parts Agent' : 'GL Agent',
                  action: e.status === 'POSTED' ? 'APPROVED' : e.status === 'PENDING_REVIEW' ? 'FLAGGED' : 'PROCESSED',
                  color: e.status === 'POSTED' ? 'var(--success)' : e.status === 'PENDING_REVIEW' ? 'var(--danger)' : 'var(--text-muted)',
                  detail: `${e.sourceRef || 'Entry'} — ${fmt((e.lines ?? []).reduce((a: number, l: any) => a + (l.debit ?? 0), 0))}`,
                  time: e.entryDate,
                }));
                if (entryFeed.length === 0) return (
                  <div style={{ textAlign: 'center', padding: '48px 16px' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>Agents standing by</div>
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>Post a transaction to see decisions here</div>
                  </div>
                );
                return (<>{entryFeed.map(f => (
                  <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #F1F5F9' }}>
                    <span style={{ fontSize: 16 }}>{f.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{f.agent}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: f.color }}>{f.action}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.detail}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{timeAgo(f.time)}</div>
                    </div>
                  </div>
                ))}</>);
              })()
            ) : (agentLogs ?? []).slice(0, 15).map((l: any) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid #F1F5F9' }}>
                <span style={{ fontSize: 16 }}>{l.humanRequired ? '⚠️' : '🤖'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{l.agentName}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: l.humanRequired ? 'var(--danger)' : 'var(--success)' }}>
                      {l.humanRequired ? 'FLAGGED' : 'APPROVED'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.actionTaken}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{new Date(l.createdAt).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Bottom: Close Readiness + Cash Position + Quick Actions ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
        {/* Close Readiness */}
        <div style={CARD}>
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              {readinessErr ? (
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>—</div>
              ) : readiness?.ready ? (
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--success)' }}>✓</div>
              ) : (readiness?.blockers ?? []).length > 0 ? (
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--danger-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--danger)' }}>✗</div>
              ) : (
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--warning-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: 'var(--warning)' }}>⚠</div>
              )}
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>March 2026 Close</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{readiness?.daysUntilMonthEnd ?? '—'} days remaining</div>
              </div>
            </div>
            {readinessErr ? (
              <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>EOM service unavailable</div>
            ) : (
              <div>
                {(readiness?.blockers ?? []).map((b: any, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--danger)', display: 'flex', gap: 6, marginBottom: 4 }}>
                    <span>●</span><span>{b.description}</span>
                  </div>
                ))}
                {(readiness?.warnings ?? []).map((w: any, i: number) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--warning)', display: 'flex', gap: 6, marginBottom: 4 }}>
                    <span>●</span><span>{w.description}</span>
                  </div>
                ))}
                {readiness?.ready && <div style={{ fontSize: 13, color: 'var(--success)', fontWeight: 600 }}>No blockers ✅</div>}
              </div>
            )}
          </div>
        </div>

        {/* Cash Position */}
        <div style={CARD}>
          <div style={{ padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Cash Position</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
              {fmt(s?.cashPosition?.totalCash ?? 0)}
            </div>
            <div style={{ fontSize: 12, color: (s?.cashPosition?.totalCash ?? 0) > 0 ? 'var(--success)' : 'var(--danger)', marginBottom: 16, fontWeight: 600 }}>
              Cash Clearing: {fmt(s?.cashPosition?.totalCash ?? 0)} {(s?.cashPosition?.totalCash ?? 0) === 0 ? '✅' : ''}
            </div>
            {/* Mini cash chart using CSS bars */}
            {cashflow?.weeks?.length ? (
              <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 60, marginTop: 8 }}>
                {cashflow.weeks.map((w: any, i: number) => {
                  const val = w.net ?? 0;
                  const max = Math.max(...cashflow.weeks.map((wk: any) => Math.abs(wk.net ?? 0)), 1);
                  const h = Math.max(8, (Math.abs(val) / max) * 52);
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <div style={{ width: '100%', height: h, background: val >= 0 ? 'var(--success)' : 'var(--danger)', borderRadius: 4, opacity: 0.7 }} />
                      <span style={{ fontSize: 9, color: 'var(--text-subtle)' }}>{w.week ?? `W${i + 1}`}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No forecast data</div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div style={CARD}>
          <div style={{ padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Quick Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <QuickAction label="+ New Journal Entry" to="/manual-entry" />
              <QuickAction label="Run EOM Pre-Flight" to="/eom" />
              <QuickAction label={`Review Pending (${pendingCount})`} to="/transactions" highlight={pendingCount > 0} />
              <QuickAction label="Generate Trial Balance" to="/trial-balance" />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Revenue Trend Chart ═══ */}
      {(s?.revenueTrend ?? []).length > 0 && (
        <div style={{ ...CARD, padding: 24, marginTop: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Revenue vs Expenses — 6 Month Trend</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={(s?.revenueTrend ?? []).map((r: any) => ({ ...r, revenue: r.revenue / 100, expenses: r.expenses / 100, netIncome: r.netIncome / 100 }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748B' }} />
              <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#64748B' }} />
              <Tooltip formatter={(v: number) => `$${v.toLocaleString()}`} />
              <Line type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2} name="Revenue" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="expenses" stroke="var(--danger)" strokeWidth={2} name="Expenses" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="netIncome" stroke="var(--success)" strokeWidth={2} strokeDasharray="5 5" name="Net Income" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ═══ Department Performance ═══ */}
      {(s?.deptPerformance ?? []).length > 0 && (
        <div style={{ ...CARD, padding: 0, marginTop: 24, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Department Performance — MTD</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E5E7EB' }}>
                {['Department', 'Revenue', 'Cost', 'Gross Profit', 'GP %', 'Units'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: h === 'Department' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(s?.deptPerformance ?? []).map((d: any) => (
                <tr key={d.department} style={{ borderBottom: '1px solid #F1F5F9' }}
                  onMouseEnter={(ev) => ev.currentTarget.style.background = '#F8FAFC'}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = ''}>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{d.department}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'monospace', textAlign: 'right' }}>{fmt(d.revenue)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'monospace', textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(d.cost)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'monospace', textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{fmt(d.grossProfit)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'right' }}>{pct(d.grossProfit, d.revenue)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'right', color: 'var(--text-muted)' }}>{d.units ?? d.roCount ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AIInsight pageType="dashboard" context="Controller Dashboard" data={{ summary: s, recentEntries: entries?.slice(0, 5) }} />
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────────────── */

function KPICard({ icon, iconBg, label, value, valueColor, trend, trendUp, badge }: {
  icon: string; iconBg: string; label: string; value: string; valueColor?: string; trend?: string; trendUp?: boolean; badge?: boolean;
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon" style={{ background: iconBg }}>{icon}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <span className="kpi-value" style={{ color: valueColor || 'var(--text)' }}>{value}</span>
        {badge && <span style={{ background: '#EF4444', color: 'white', fontSize: 10, padding: '1px 6px', borderRadius: 999, fontWeight: 700 }}>!</span>}
      </div>
      {trend && (
        <div style={{ fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: trendUp ? 'var(--success)' : 'var(--danger)' }}>{trendUp ? '↑' : '↓'}</span>
          <span style={{ color: trendUp ? 'var(--success)' : 'var(--danger)' }}>{trend}</span>
        </div>
      )}
    </div>
  );
}

function QuickAction({ label, to, highlight }: { label: string; to: string; highlight?: boolean }) {
  return (
    <Link to={to} style={{
      display: 'block', width: '100%', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
      textAlign: 'center', textDecoration: 'none', border: 'none', cursor: 'pointer',
      background: highlight ? 'var(--primary)' : '#F1F5F9',
      color: highlight ? '#FFFFFF' : 'var(--text)',
      transition: 'all 150ms',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
    >
      {label}
    </Link>
  );
}
