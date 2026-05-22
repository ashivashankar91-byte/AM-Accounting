import { useQuery } from '@tanstack/react-query';
import { mlApi } from '../api/client';
import PageLoader from '../components/PageLoader';
import PageError from '../components/PageError';
import AIInsight from '../components/AIInsight';

// ─── Mini bar chart (pure CSS, no library) ───
function MiniBar({ value, max, color = 'bg-brand-light0' }: { value: number; max: number; color?: string }) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  return (
    <div className="w-full bg-gray-100 rounded-full h-2.5">
      <div className={`${color} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SeverityBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    HIGH: 'bg-red-100 text-red-700',
    CRITICAL: 'bg-red-100 text-red-700',
    MEDIUM: 'bg-yellow-100 text-yellow-700',
    WARNING: 'bg-yellow-100 text-yellow-700',
    LOW: 'bg-green-100 text-green-700',
    INFO: 'bg-brand-light text-brand',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colors[level] ?? 'bg-gray-100 text-gray-600'}`}>{level}</span>;
}

function ScoreRing({ score, grade, size = 120 }: { score: number; grade: string; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const color = score >= 70 ? '#22C55E' : score >= 55 ? '#EAB308' : '#EF4444';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E5E7EB" strokeWidth={8} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className="transition-all duration-1000" />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-bold" style={{ color }}>{score}</div>
        <div className="text-xs text-gray-500 font-semibold">{grade}</div>
      </div>
    </div>
  );
}

function TrendArrow({ value }: { value: number }) {
  if (value > 0) return <span className="text-green-600 text-sm font-semibold">▲ {value}%</span>;
  if (value < 0) return <span className="text-red-600 text-sm font-semibold">▼ {Math.abs(value)}%</span>;
  return <span className="text-gray-500 text-sm">—</span>;
}

export default function MLDashboard() {
  const { data: dashboard, isLoading, error, refetch } = useQuery({ queryKey: ['ml-dashboard'], queryFn: mlApi.getDashboard, retry: false });
  const { data: health } = useQuery({ queryKey: ['ml-health'], queryFn: mlApi.getHealthScore, retry: false });
  const { data: revenue } = useQuery({ queryKey: ['ml-revenue-forecast'], queryFn: () => mlApi.getRevenueForecast(12, 6), retry: false });
  const { data: cashflow } = useQuery({ queryKey: ['ml-cashflow'], queryFn: () => mlApi.getCashflowForecast(8), retry: false });
  const { data: deals } = useQuery({ queryKey: ['ml-deals'], queryFn: mlApi.getDealProfitability, retry: false });
  const { data: techs } = useQuery({ queryKey: ['ml-techs'], queryFn: mlApi.getTechProductivity, retry: false });
  const { data: parts } = useQuery({ queryKey: ['ml-parts'], queryFn: mlApi.getPartsDemand, retry: false });
  const { data: warranty } = useQuery({ queryKey: ['ml-warranty'], queryFn: mlApi.getWarrantyPredictions, retry: false });
  const { data: models } = useQuery({ queryKey: ['ml-models'], queryFn: mlApi.getModels, retry: false });
  const { data: accuracy } = useQuery({ queryKey: ['ml-accuracy'], queryFn: mlApi.getAccuracy, retry: false });

  if (isLoading) return <PageLoader page="ML Intelligence" service="ml-service" port={3047} />;
  if (error) return <PageError error={error} serviceName="ML Service" port={3047} retry={refetch} />;

  const db = dashboard ?? {};
  const hs = health ?? { score: 0, grade: '-', factors: [] };
  const rv = revenue ?? { history: [], forecast: [], summary: {} };
  const cf = cashflow ?? { currentBalance: 0, history: [], forecast: [], alerts: [] };
  const dl = deals ?? { deals: [], summary: {} };
  const tc = techs ?? { technicians: [], summary: {} };
  const pt = parts ?? { parts: [], alerts: [], summary: {} };
  const wr = warranty ?? { predictions: [], summary: {} };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">ML Intelligence Center</span>
            <span className="bg-purple-100 text-purple-700 text-xs px-2 py-0.5 rounded-full font-medium">LIVE</span>
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{(models ?? []).length} active models • {db.totalPredictions?.toLocaleString() ?? 0} predictions • {Math.round((accuracy?.accuracy ?? 0) * 100)}% overall accuracy</p>
        </div>
      </div>

      {/* ═══ Row 1: KPI Cards ═══ */}
      <div className="grid grid-cols-5 gap-4">
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
          <div className="text-xs text-gray-500 font-medium">Active Models</div>
          <div className="text-2xl font-bold text-purple-700">{(models ?? []).length}</div>
          <div className="text-xs text-gray-400 mt-1">Anomaly, Forecast, Scoring</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
          <div className="text-xs text-gray-500 font-medium">Overall Accuracy</div>
          <div className="text-2xl font-bold text-brand">{Math.round((accuracy?.accuracy ?? 0) * 100)}%</div>
          <div className="text-xs text-gray-400 mt-1">{accuracy?.totalPredictions?.toLocaleString()} predictions</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-amber-500">
          <div className="text-xs text-gray-500 font-medium">Anomalies (Month)</div>
          <div className="text-2xl font-bold text-amber-700">{db.anomaliesDetected?.thisMonth ?? 0}</div>
          <div className="text-xs text-gray-400 mt-1">{db.anomaliesDetected?.today ?? 0} today, {db.anomaliesDetected?.thisWeek ?? 0} this week</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
          <div className="text-xs text-gray-500 font-medium">Revenue Trend</div>
          <div className="text-2xl font-bold text-green-700">${(db.quickStats?.revenueThisMonth ?? 0).toLocaleString()}</div>
          <div className="flex items-center gap-1 mt-1"><TrendArrow value={db.revenueChange ?? 0} /></div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 border-l-4 border-indigo-500">
          <div className="text-xs text-gray-500 font-medium">Health Score</div>
          <div className="text-2xl font-bold text-indigo-700">{hs.score}/{hs.grade}</div>
          <div className="text-xs text-gray-400 mt-1">Composite financial health</div>
        </div>
      </div>

      {/* ═══ Row 2: Health Score + Active Alerts ═══ */}
      <div className="grid grid-cols-3 gap-6">
        {/* Health Score Ring */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="font-semibold mb-4 text-sm">Financial Health Score</h3>
          <div className="flex items-center gap-6">
            <ScoreRing score={hs.score} grade={hs.grade} />
            <div className="flex-1 space-y-2">
              {(hs.factors ?? []).map((f: any) => (
                <div key={f.name} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-28 truncate">{f.name}</span>
                  <MiniBar value={f.contribution} max={20} color={f.status === 'HEALTHY' ? 'bg-green-500' : f.status === 'CAUTION' ? 'bg-yellow-500' : 'bg-red-500'} />
                  <span className="text-xs font-medium w-10 text-right">{f.value}</span>
                </div>
              ))}
            </div>
          </div>
          {(hs.trend ?? []).length > 0 && (
            <div className="mt-4 flex items-end gap-1 h-12">
              {(hs.trend ?? []).map((t: any) => (
                <div key={t.period} className="flex-1 flex flex-col items-center">
                  <div className="w-full bg-indigo-200 rounded-t" style={{ height: `${(t.score / 100) * 48}px` }}>
                    <div className="w-full bg-indigo-500 rounded-t" style={{ height: `${(t.score / 100) * 48}px` }} />
                  </div>
                  <span className="text-[9px] text-gray-400 mt-0.5">{t.period.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Alerts */}
        <div className="bg-white rounded-lg shadow p-5 col-span-2">
          <h3 className="font-semibold mb-3 text-sm flex items-center gap-2">
            ML-Detected Alerts
            <span className="bg-red-100 text-red-700 text-xs px-1.5 py-0.5 rounded">{(db.alerts ?? []).length}</span>
          </h3>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {(db.alerts ?? []).map((alert: any, i: number) => (
              <div key={i} className="flex items-start gap-3 p-2 bg-gray-50 rounded">
                <SeverityBadge level={alert.severity} />
                <div className="flex-1">
                  <span className="text-xs font-medium text-gray-400">{alert.category}</span>
                  <p className="text-sm text-gray-700">{alert.message}</p>
                </div>
              </div>
            ))}
            {/* Parts alerts */}
            {(pt.alerts ?? []).map((alert: any, i: number) => (
              <div key={`parts-${i}`} className="flex items-start gap-3 p-2 bg-gray-50 rounded">
                <SeverityBadge level={alert.severity} />
                <div className="flex-1">
                  <span className="text-xs font-medium text-gray-400">Parts Inventory</span>
                  <p className="text-sm text-gray-700">{alert.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Row 3: Revenue Forecast ═══ */}
      <div className="bg-white rounded-lg shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Revenue Forecast — Double Exponential Smoothing</h3>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>■ <span className="text-brand">Historical</span></span>
            <span>■ <span className="text-purple-600">Forecast</span></span>
            <span className="text-gray-300">|</span>
            <span>Model Accuracy: {rv.model?.accuracy ? Math.round(rv.model.accuracy * 100) + '%' : '-'}</span>
          </div>
        </div>
        {/* Revenue chart as bars */}
        <div className="flex items-end gap-1 h-40 mb-2">
          {(rv.history ?? []).map((h: any) => {
            const maxRev = Math.max(...[...(rv.history ?? []), ...(rv.forecast ?? [])].map((d: any) => d.revenue || d.upper || 0));
            return (
              <div key={h.period} className="flex-1 flex flex-col items-center justify-end">
                <div className="w-full bg-blue-400 rounded-t transition-all" style={{ height: `${(h.revenue / maxRev) * 140}px` }} title={`$${h.revenue.toLocaleString()}`} />
              </div>
            );
          })}
          {(rv.forecast ?? []).map((f: any) => {
            const maxRev = Math.max(...[...(rv.history ?? []), ...(rv.forecast ?? [])].map((d: any) => d.revenue || d.upper || 0));
            return (
              <div key={f.period} className="flex-1 flex flex-col items-center justify-end">
                <div className="w-full bg-purple-400/70 border-2 border-dashed border-purple-500 rounded-t transition-all" style={{ height: `${(f.revenue / maxRev) * 140}px` }} title={`$${f.revenue.toLocaleString()} (±${Math.round((1 - f.confidence) * 100)}%)`} />
              </div>
            );
          })}
        </div>
        <div className="flex gap-1 text-[9px] text-gray-400">
          {[...(rv.history ?? []), ...(rv.forecast ?? [])].map((d: any) => (
            <div key={d.period} className="flex-1 text-center">{d.period.slice(5)}</div>
          ))}
        </div>
        {rv.summary && (
          <div className="grid grid-cols-4 gap-4 mt-4 pt-3 border-t">
            <div className="text-center"><div className="text-xs text-gray-500">Avg Monthly</div><div className="font-bold text-brand">${(rv.summary.avgMonthlyRevenue ?? 0).toLocaleString()}</div></div>
            <div className="text-center"><div className="text-xs text-gray-500">Growth Rate</div><div className="font-bold text-green-700">{rv.summary.growthRate ?? 0}%</div></div>
            <div className="text-center"><div className="text-xs text-gray-500">Next Month Forecast</div><div className="font-bold text-purple-700">${(rv.summary.nextMonthForecast ?? 0).toLocaleString()}</div></div>
            <div className="text-center"><div className="text-xs text-gray-500">Quarter Forecast</div><div className="font-bold text-indigo-700">${(rv.summary.quarterForecast ?? 0).toLocaleString()}</div></div>
          </div>
        )}
      </div>

      {/* ═══ Row 4: Cash Flow + Deal Profitability ═══ */}
      <div className="grid grid-cols-2 gap-6">
        {/* Cash Flow Projection */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="font-semibold text-sm mb-3">Cash Flow Projection (8 weeks)</h3>
          <div className="text-center mb-3">
            <span className="text-xs text-gray-500">Current Balance:</span>
            <span className="ml-2 text-lg font-bold text-green-700">${(cf.currentBalance ?? 0).toLocaleString()}</span>
          </div>
          <div className="space-y-2">
            {(cf.forecast ?? []).slice(0, 6).map((w: any) => (
              <div key={w.week} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-gray-400 w-10">{w.week}</span>
                <div className="flex-1">
                  <MiniBar value={w.projectedBalance} max={500000} color={w.projectedBalance > 100000 ? 'bg-green-500' : w.projectedBalance > 50000 ? 'bg-yellow-500' : 'bg-red-500'} />
                </div>
                <span className="text-xs font-medium w-20 text-right">${w.projectedBalance?.toLocaleString()}</span>
                <span className={`text-xs w-12 text-right ${w.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {w.netCashFlow >= 0 ? '+' : ''}{(w.netCashFlow / 1000).toFixed(0)}K
                </span>
              </div>
            ))}
          </div>
          {(cf.alerts ?? []).length > 0 && (
            <div className="mt-3 pt-3 border-t space-y-1">
              {(cf.alerts ?? []).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <SeverityBadge level={a.type} />
                  <span className="text-gray-600">{a.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Deal Profitability */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="font-semibold text-sm mb-3">Deal Profitability Scoring</h3>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="text-center bg-green-50 rounded p-2">
              <div className="text-lg font-bold text-green-700">${(dl.summary?.totalNetProfit ?? 0).toLocaleString()}</div>
              <div className="text-[10px] text-green-600">Total Net Profit</div>
            </div>
            <div className="text-center bg-brand-light rounded p-2">
              <div className="text-lg font-bold text-brand">{dl.summary?.avgScore ?? 0}</div>
              <div className="text-[10px] text-brand">Avg Score</div>
            </div>
            <div className="text-center bg-red-50 rounded p-2">
              <div className="text-lg font-bold text-red-700">{dl.summary?.highRiskDeals ?? 0}</div>
              <div className="text-[10px] text-red-600">High Risk</div>
            </div>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {(dl.deals ?? []).map((d: any) => (
              <div key={d.dealId} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded text-sm">
                <SeverityBadge level={d.risk} />
                <span className="font-mono text-xs text-gray-400 w-20">{d.dealId}</span>
                <span className="flex-1 truncate text-xs">{d.vehicle}</span>
                <span className={`text-xs font-bold w-16 text-right ${d.netProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>${d.netProfit.toLocaleString()}</span>
                <div className="w-12 flex items-center gap-1">
                  <div className="w-8 bg-gray-200 rounded-full h-1.5"><div className={`h-1.5 rounded-full ${d.score >= 70 ? 'bg-green-500' : d.score >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${d.score}%` }} /></div>
                  <span className="text-[10px] text-gray-400">{d.score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Row 5: Technician Productivity + Parts Demand ═══ */}
      <div className="grid grid-cols-2 gap-6">
        {/* Technician Productivity */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="font-semibold text-sm mb-3">Technician Productivity Prediction</h3>
          <div className="flex items-center gap-4 mb-3 text-center">
            <div className="flex-1 bg-brand-light rounded p-2"><div className="text-lg font-bold text-brand">{tc.summary?.avgEfficiency ?? 0}</div><div className="text-[10px] text-brand">Avg Efficiency</div></div>
            <div className="flex-1 bg-green-50 rounded p-2"><div className="text-lg font-bold text-green-700">${(tc.summary?.totalRevenue ?? 0).toLocaleString()}</div><div className="text-[10px] text-green-600">Total Revenue</div></div>
            <div className="flex-1 bg-purple-50 rounded p-2"><div className="text-lg font-bold text-purple-700">{tc.summary?.totalROs ?? 0}</div><div className="text-[10px] text-purple-600">Total ROs</div></div>
          </div>
          <div className="space-y-2">
            {(tc.technicians ?? []).map((t: any) => (
              <div key={t.technicianId} className="bg-gray-50 rounded p-2">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{t.name}</span>
                    <span className={`text-[10px] px-1 rounded ${t.trend === 'IMPROVING' ? 'bg-green-100 text-green-700' : t.trend === 'DECLINING' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{t.trend}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{t.currentROCount} ROs</span>
                    <span className="text-xs font-bold">{t.currentEfficiency.toFixed(2)}x</span>
                  </div>
                </div>
                <MiniBar value={t.currentEfficiency} max={1.3} color={t.currentEfficiency >= 1.0 ? 'bg-green-500' : t.currentEfficiency >= 0.90 ? 'bg-yellow-500' : 'bg-red-500'} />
                <div className="flex gap-1 mt-1">
                  {(t.forecastEfficiency ?? []).map((f: any) => (
                    <span key={f.period} className="text-[9px] text-purple-500">{f.period}: {f.efficiency}x</span>
                  ))}
                  <span className="ml-auto text-[9px] text-gray-400">Comeback: {t.comebackRate}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Parts Demand */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="font-semibold text-sm mb-3">Parts Demand Forecast</h3>
          <div className="flex items-center gap-4 mb-3 text-center">
            <div className="flex-1 bg-red-50 rounded p-2"><div className="text-lg font-bold text-red-700">{pt.summary?.criticalStockouts ?? 0}</div><div className="text-[10px] text-red-600">Critical Stockouts</div></div>
            <div className="flex-1 bg-yellow-50 rounded p-2"><div className="text-lg font-bold text-yellow-700">{pt.summary?.warningStockouts ?? 0}</div><div className="text-[10px] text-yellow-600">Warning</div></div>
            <div className="flex-1 bg-green-50 rounded p-2"><div className="text-lg font-bold text-green-700">{pt.summary?.risingDemand ?? 0}</div><div className="text-[10px] text-green-600">Rising Demand</div></div>
          </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {(pt.parts ?? []).sort((a: any, b: any) => a.daysUntilStockout - b.daysUntilStockout).map((p: any) => (
              <div key={p.partNumber} className="flex items-center gap-2 p-1.5 bg-gray-50 rounded text-xs">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.daysUntilStockout <= 7 ? 'bg-red-500' : p.daysUntilStockout <= 14 ? 'bg-yellow-500' : 'bg-green-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{p.partName}</div>
                  <div className="text-gray-400">{p.partNumber}</div>
                </div>
                <div className="text-center w-12"><div className="font-bold">{p.currentStock}</div><div className="text-gray-400">stock</div></div>
                <div className="text-center w-14"><div className="font-bold text-purple-600">{p.forecastNextMonth}</div><div className="text-gray-400">forecast</div></div>
                <div className="text-center w-14">
                  <div className={`font-bold ${p.daysUntilStockout <= 7 ? 'text-red-600' : p.daysUntilStockout <= 14 ? 'text-yellow-600' : 'text-green-600'}`}>{p.daysUntilStockout}d</div>
                  <div className="text-gray-400">to out</div>
                </div>
                <span className={`text-[9px] px-1 rounded ${p.trend === 'RISING' ? 'bg-red-50 text-red-600' : p.trend === 'DECLINING' ? 'bg-green-50 text-green-600' : p.trend === 'SEASONAL' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>{p.trend}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ Row 6: Warranty Predictions ═══ */}
      <div className="bg-white rounded-lg shadow p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Warranty Claim Predictions</h3>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>{wr.summary?.totalVehiclesAnalyzed ?? 0} vehicles analyzed</span>
            <span>Expected exposure: <span className="text-red-600 font-semibold">${(wr.summary?.expectedClaimValue ?? 0).toLocaleString()}</span></span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b">
              <th className="text-left py-2 px-2">Vehicle</th>
              <th className="text-left py-2 px-2">VIN</th>
              <th className="text-left py-2 px-2">Claim Type</th>
              <th className="text-center py-2 px-2">Probability</th>
              <th className="text-right py-2 px-2">Est. Cost</th>
              <th className="text-center py-2 px-2">Risk</th>
              <th className="text-left py-2 px-2">Basis</th>
            </tr></thead>
            <tbody>
              {(wr.predictions ?? []).map((w: any) => (
                <tr key={w.vin} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 px-2 font-medium">{w.vehicle}</td>
                  <td className="py-2 px-2 font-mono text-xs text-gray-400">{w.vin.slice(0, 11)}...</td>
                  <td className="py-2 px-2">{w.claimType}</td>
                  <td className="py-2 px-2 text-center">
                    <div className="inline-flex items-center gap-1">
                      <div className="w-12 bg-gray-200 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${w.probability >= 0.6 ? 'bg-red-500' : w.probability >= 0.35 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${w.probability * 100}%` }} />
                      </div>
                      <span className="text-xs font-medium">{Math.round(w.probability * 100)}%</span>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right font-medium">${w.estimatedCost.toLocaleString()}</td>
                  <td className="py-2 px-2 text-center"><SeverityBadge level={w.riskLevel} /></td>
                  <td className="py-2 px-2 text-xs text-gray-500 max-w-xs truncate">{w.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ Row 7: Model Registry ═══ */}
      <div className="bg-white rounded-lg shadow p-5">
        <h3 className="font-semibold text-sm mb-3">Model Registry</h3>
        <div className="grid grid-cols-4 gap-3">
          {(models ?? []).slice(0, 8).map((m: any) => (
            <div key={m.id} className="border rounded-lg p-3 hover:shadow-sm transition">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-gray-700">{m.modelType?.replace(/_/g, ' ')}</span>
                <span className="text-[10px] bg-green-100 text-green-700 px-1 rounded">{m.isActive ? 'ACTIVE' : 'INACTIVE'}</span>
              </div>
              <div className="text-xs text-gray-400">v{m.version} • {m.category}</div>
              <div className="mt-2 flex items-center gap-2">
                <MiniBar value={typeof m.accuracy === 'number' ? m.accuracy * 100 : 85} max={100} color="bg-indigo-500" />
                <span className="text-xs font-medium">{typeof m.accuracy === 'number' ? Math.round(m.accuracy * 100) : 85}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Row 8: Accuracy by Model Type ═══ */}
      {accuracy?.byModel && (
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="font-semibold text-sm mb-3">Prediction Accuracy by Model Type</h3>
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(accuracy.byModel as Record<string, { total: number; correct: number; accuracy: number }>).map(([type, stats]) => (
              <div key={type} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600">{type.replace(/_/g, ' ')}</span>
                    <span className="text-xs font-bold">{Math.round(stats.accuracy * 100)}%</span>
                  </div>
                  <MiniBar value={stats.accuracy * 100} max={100} color={stats.accuracy >= 0.9 ? 'bg-green-500' : stats.accuracy >= 0.8 ? 'bg-brand-light0' : 'bg-yellow-500'} />
                  <div className="text-[10px] text-gray-400 mt-0.5">{stats.correct}/{stats.total} correct</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AIInsight pageType="analytics" context="ML Intelligence" data={{ dashboard: db, health: hs, revenue: rv.summary, cashflow: cf.alerts, deals: dl.summary, parts: pt.summary, warranty: wr.summary }} />
    </div>
  );
}
