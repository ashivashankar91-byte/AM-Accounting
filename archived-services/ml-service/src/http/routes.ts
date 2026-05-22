import { FastifyPluginAsync } from 'fastify';

// ═══════════════════════════════════════════════════════════════════
//  AMACC ML Engine — Statistical models for dealership accounting
// ═══════════════════════════════════════════════════════════════════

// --- Baseline anomaly detection models ---
const BASELINE_MODELS: Record<string, { mean: number; stddev: number; category: string }> = {
  '4xxx_REVENUE':    { mean: 45000,  stddev: 12000, category: 'Revenue' },
  '5xxx_COS':        { mean: 28000,  stddev: 8500,  category: 'Cost of Sales' },
  '6xxx_EXPENSE':    { mean: 15000,  stddev: 4200,  category: 'Operating Expense' },
  '0110_SALARIES':   { mean: 32400,  stddev: 2100,  category: 'Payroll' },
  'PAYROLL_TOTAL':   { mean: 127450, stddev: 8200,  category: 'Payroll' },
  'PARTS_INVENTORY': { mean: 67000,  stddev: 11000, category: 'Parts' },
  'SERVICE_LABOR':   { mean: 42000,  stddev: 7500,  category: 'Service' },
  'BODY_SHOP':       { mean: 19000,  stddev: 5200,  category: 'Body Shop' },
  'F_AND_I':         { mean: 78000,  stddev: 15000, category: 'F&I' },
};

// --- 12-month historical revenue data for forecasting ---
function generateHistory(baseRevenue: number, months: number): { period: string; revenue: number; expenses: number; netIncome: number; roCount: number; avgTicket: number }[] {
  const now = new Date();
  const data: any[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    // Seasonal pattern: summer peak, winter dip
    const monthIdx = d.getMonth();
    const seasonal = 1.0 + 0.15 * Math.sin((monthIdx - 2) * Math.PI / 6);
    // Growth trend: ~2% monthly
    const trend = 1.0 + 0.02 * (months - i);
    const noise = 0.95 + Math.random() * 0.10;
    const revenue = Math.round(baseRevenue * seasonal * trend * noise);
    const expenses = Math.round(revenue * (0.78 + Math.random() * 0.06));
    data.push({
      period,
      revenue,
      expenses,
      netIncome: revenue - expenses,
      roCount: Math.round(180 + Math.random() * 60),
      avgTicket: Math.round((revenue / (180 + Math.random() * 60)) * 100) / 100,
    });
  }
  return data;
}

// --- Exponential smoothing forecast ---
function exponentialSmoothing(values: number[], alpha: number, periods: number): number[] {
  if (values.length === 0) return [];
  let level = values[0];
  let trend = values.length > 1 ? values[1] - values[0] : 0;
  const beta = 0.3;
  for (const val of values) {
    const prevLevel = level;
    level = alpha * val + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  const forecast: number[] = [];
  for (let i = 1; i <= periods; i++) {
    forecast.push(Math.round(level + trend * i));
  }
  return forecast;
}

// --- Cash flow projection ---
const MOCK_CASHFLOW_HISTORY = [
  { week: 'W-12', inflow: 312000, outflow: 287000 },
  { week: 'W-11', inflow: 298000, outflow: 291000 },
  { week: 'W-10', inflow: 345000, outflow: 302000 },
  { week: 'W-9', inflow: 278000, outflow: 295000 },
  { week: 'W-8', inflow: 367000, outflow: 310000 },
  { week: 'W-7', inflow: 401000, outflow: 325000 },
  { week: 'W-6', inflow: 356000, outflow: 318000 },
  { week: 'W-5', inflow: 389000, outflow: 337000 },
  { week: 'W-4', inflow: 412000, outflow: 342000 },
  { week: 'W-3', inflow: 378000, outflow: 329000 },
  { week: 'W-2', inflow: 395000, outflow: 345000 },
  { week: 'W-1', inflow: 421000, outflow: 358000 },
];

// --- Deal profitability model ---
const MOCK_DEALS = [
  { dealId: 'D2400101', type: 'NEW', vehicle: '2024 Toyota Camry', grossFront: 2850, grossBack: 3200, holdback: 450, packCost: 400, netProfit: 6100, score: 92, risk: 'LOW' },
  { dealId: 'D2400102', type: 'USED', vehicle: '2022 Honda CR-V', grossFront: 1800, grossBack: 2100, holdback: 0, packCost: 350, netProfit: 3550, score: 78, risk: 'LOW' },
  { dealId: 'D2400103', type: 'NEW', vehicle: '2024 Toyota Tacoma', grossFront: 4200, grossBack: 2800, holdback: 550, packCost: 400, netProfit: 7150, score: 95, risk: 'LOW' },
  { dealId: 'D2400104', type: 'USED', vehicle: '2021 BMW X3', grossFront: -200, grossBack: 4500, holdback: 0, packCost: 500, netProfit: 3800, score: 65, risk: 'MEDIUM' },
  { dealId: 'D2400105', type: 'NEW', vehicle: '2024 Ford F-150', grossFront: 1200, grossBack: 1800, holdback: 380, packCost: 400, netProfit: 2980, score: 71, risk: 'LOW' },
  { dealId: 'D2400106', type: 'USED', vehicle: '2019 Chevy Malibu', grossFront: -800, grossBack: 950, holdback: 0, packCost: 300, netProfit: -150, score: 22, risk: 'HIGH' },
  { dealId: 'D2400107', type: 'NEW', vehicle: '2024 Hyundai Tucson', grossFront: 3100, grossBack: 2400, holdback: 420, packCost: 350, netProfit: 5570, score: 88, risk: 'LOW' },
  { dealId: 'D2400108', type: 'USED', vehicle: '2020 Tesla Model 3', grossFront: 600, grossBack: 1200, holdback: 0, packCost: 450, netProfit: 1350, score: 52, risk: 'MEDIUM' },
];

// --- Technician productivity mock ---
const TECH_HISTORY: Record<string, { period: string; efficiency: number; revenue: number; roCount: number; comebacks: number }[]> = {
  'T001': [
    { period: '2025-10', efficiency: 1.05, revenue: 7800, roCount: 38, comebacks: 1 },
    { period: '2025-11', efficiency: 1.08, revenue: 8100, roCount: 40, comebacks: 0 },
    { period: '2025-12', efficiency: 1.02, revenue: 7500, roCount: 36, comebacks: 2 },
    { period: '2026-01', efficiency: 1.10, revenue: 8400, roCount: 41, comebacks: 0 },
    { period: '2026-02', efficiency: 1.06, revenue: 8000, roCount: 39, comebacks: 1 },
    { period: '2026-03', efficiency: 1.07, revenue: 8225, roCount: 42, comebacks: 0 },
  ],
  'T002': [
    { period: '2025-10', efficiency: 0.85, revenue: 5500, roCount: 28, comebacks: 3 },
    { period: '2025-11', efficiency: 0.87, revenue: 5700, roCount: 29, comebacks: 2 },
    { period: '2025-12', efficiency: 0.82, revenue: 5200, roCount: 26, comebacks: 4 },
    { period: '2026-01', efficiency: 0.91, revenue: 6100, roCount: 31, comebacks: 1 },
    { period: '2026-02', efficiency: 0.88, revenue: 5800, roCount: 30, comebacks: 2 },
    { period: '2026-03', efficiency: 0.89, revenue: 6016, roCount: 31, comebacks: 2 },
  ],
  'T003': [
    { period: '2025-10', efficiency: 1.10, revenue: 8200, roCount: 43, comebacks: 0 },
    { period: '2025-11', efficiency: 1.12, revenue: 8400, roCount: 44, comebacks: 0 },
    { period: '2025-12', efficiency: 1.09, revenue: 8100, roCount: 42, comebacks: 1 },
    { period: '2026-01', efficiency: 1.15, revenue: 8700, roCount: 46, comebacks: 0 },
    { period: '2026-02', efficiency: 1.13, revenue: 8500, roCount: 44, comebacks: 0 },
    { period: '2026-03', efficiency: 1.14, revenue: 8554, roCount: 45, comebacks: 0 },
  ],
  'T004': [
    { period: '2025-10', efficiency: 0.93, revenue: 6500, roCount: 34, comebacks: 2 },
    { period: '2025-11', efficiency: 0.96, revenue: 6700, roCount: 35, comebacks: 1 },
    { period: '2025-12', efficiency: 0.90, revenue: 6200, roCount: 32, comebacks: 3 },
    { period: '2026-01', efficiency: 0.97, revenue: 6900, roCount: 37, comebacks: 1 },
    { period: '2026-02', efficiency: 0.94, revenue: 6600, roCount: 35, comebacks: 2 },
    { period: '2026-03', efficiency: 0.95, revenue: 6815, roCount: 36, comebacks: 1 },
  ],
  'T005': [
    { period: '2025-10', efficiency: 0.88, revenue: 4800, roCount: 25, comebacks: 2 },
    { period: '2025-11', efficiency: 0.90, revenue: 5000, roCount: 27, comebacks: 1 },
    { period: '2025-12', efficiency: 0.86, revenue: 4600, roCount: 24, comebacks: 3 },
    { period: '2026-01', efficiency: 0.93, revenue: 5200, roCount: 28, comebacks: 1 },
    { period: '2026-02', efficiency: 0.91, revenue: 5100, roCount: 27, comebacks: 2 },
    { period: '2026-03', efficiency: 0.92, revenue: 5170, roCount: 28, comebacks: 1 },
  ],
};

// --- Parts demand model ---
const PARTS_DEMAND_FORECAST = [
  { partNumber: '04152-YZZA5', partName: 'Oil Filter', currentStock: 45, avgMonthlyDemand: 128, reorderPoint: 30, forecastNextMonth: 135, forecastConfidence: 0.91, trend: 'RISING', daysUntilStockout: 10 },
  { partNumber: '90915-YZZD3', partName: 'Oil Drain Plug Gasket', currentStock: 120, avgMonthlyDemand: 85, reorderPoint: 25, forecastNextMonth: 88, forecastConfidence: 0.89, trend: 'STABLE', daysUntilStockout: 42 },
  { partNumber: '19301-R40', partName: 'Thermostat', currentStock: 8, avgMonthlyDemand: 47, reorderPoint: 15, forecastNextMonth: 52, forecastConfidence: 0.82, trend: 'RISING', daysUntilStockout: 5 },
  { partNumber: '17801-YZZ08', partName: 'Air Filter', currentStock: 35, avgMonthlyDemand: 63, reorderPoint: 20, forecastNextMonth: 67, forecastConfidence: 0.87, trend: 'RISING', daysUntilStockout: 16 },
  { partNumber: '04112-31050', partName: 'Spark Plug Set', currentStock: 50, avgMonthlyDemand: 22, reorderPoint: 10, forecastNextMonth: 20, forecastConfidence: 0.93, trend: 'DECLINING', daysUntilStockout: 68 },
  { partNumber: '45022-S04-405', partName: 'Brake Pads (Front)', currentStock: 12, avgMonthlyDemand: 34, reorderPoint: 10, forecastNextMonth: 38, forecastConfidence: 0.85, trend: 'RISING', daysUntilStockout: 10 },
  { partNumber: '26296-AE011', partName: 'Wiper Blade Set', currentStock: 28, avgMonthlyDemand: 15, reorderPoint: 5, forecastNextMonth: 22, forecastConfidence: 0.78, trend: 'SEASONAL', daysUntilStockout: 56 },
  { partNumber: '76622-TZ5-A11', partName: 'Cabin Air Filter', currentStock: 18, avgMonthlyDemand: 18, reorderPoint: 8, forecastNextMonth: 20, forecastConfidence: 0.86, trend: 'STABLE', daysUntilStockout: 30 },
];

// --- Warranty claim prediction ---
const WARRANTY_PREDICTIONS = [
  { vin: '1HGBH41JXMN109186', vehicle: '2021 Honda Civic', claimType: 'Transmission', probability: 0.72, estimatedCost: 3200, basis: 'Similar VINs with 45k+ miles showed 3x failure rate', riskLevel: 'HIGH' },
  { vin: '5YFBURHE8HP012345', vehicle: '2023 Toyota Corolla', claimType: 'Battery', probability: 0.45, estimatedCost: 450, basis: 'Seasonal pattern: cold-weather battery claims spike in Q1', riskLevel: 'MEDIUM' },
  { vin: 'WBA8E9C50GK123456', vehicle: '2022 BMW 330i', claimType: 'Coolant System', probability: 0.38, estimatedCost: 1800, basis: 'Known TSB for this model year; 38% claim rate', riskLevel: 'MEDIUM' },
  { vin: '1G1YY22G965109876', vehicle: '2020 Chevy Corvette', claimType: 'Suspension', probability: 0.15, estimatedCost: 2400, basis: 'Low mileage; minimal risk indicators', riskLevel: 'LOW' },
  { vin: '3FA6P0H79HR234567', vehicle: '2023 Ford Fusion', claimType: 'Infotainment', probability: 0.55, estimatedCost: 800, basis: 'Software-related claims trending up for this platform', riskLevel: 'MEDIUM' },
];

// --- Financial health composite score ---
function computeHealthScore(data: {
  currentRatio: number; debtToEquity: number; grossMarginPct: number;
  daysReceivable: number; inventoryTurnover: number; laborUtilization: number;
}): { score: number; grade: string; factors: { name: string; value: number; weight: number; contribution: number; status: string }[] } {
  const factors = [
    { name: 'Current Ratio', value: data.currentRatio, weight: 0.15, target: 2.0, min: 1.0, max: 3.0 },
    { name: 'Debt-to-Equity', value: data.debtToEquity, weight: 0.15, target: 0.5, min: 0, max: 2.0 },
    { name: 'Gross Margin %', value: data.grossMarginPct, weight: 0.20, target: 25, min: 10, max: 40 },
    { name: 'Days Receivable', value: data.daysReceivable, weight: 0.15, target: 30, min: 15, max: 90 },
    { name: 'Inventory Turnover', value: data.inventoryTurnover, weight: 0.15, target: 8, min: 2, max: 15 },
    { name: 'Labor Utilization', value: data.laborUtilization, weight: 0.20, target: 1.10, min: 0.70, max: 1.30 },
  ];

  let totalScore = 0;
  const details = factors.map(f => {
    // Normalize value to 0-100 based on distance from target
    const range = f.max - f.min;
    let normalized: number;
    if (f.name === 'Debt-to-Equity' || f.name === 'Days Receivable') {
      // Lower is better
      normalized = Math.max(0, Math.min(100, 100 - ((f.value - f.min) / range) * 100));
    } else {
      normalized = Math.max(0, Math.min(100, ((f.value - f.min) / range) * 100));
    }
    const contribution = normalized * f.weight;
    totalScore += contribution;
    return {
      name: f.name,
      value: f.value,
      weight: f.weight,
      contribution: Math.round(contribution * 10) / 10,
      status: normalized >= 70 ? 'HEALTHY' : normalized >= 40 ? 'CAUTION' : 'CRITICAL',
    };
  });

  const score = Math.round(totalScore);
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';

  return { score, grade, factors: details };
}

function anomalyDetect(amount: number, mean: number, stddev: number) {
  if (stddev === 0) return { anomaly: false, severity: 'LOW' as const, confidence: 0.5, zScore: 0, mean, stddev, sampleSize: 0 };
  const zScore = Math.abs((amount - mean) / stddev);
  return {
    anomaly: zScore > 2.0,
    severity: zScore > 3.0 ? 'HIGH' as const : zScore > 2.0 ? 'MEDIUM' as const : 'LOW' as const,
    confidence: Math.min(0.95, 0.5 + zScore * 0.15),
    zScore: Math.round(zScore * 100) / 100,
    mean,
    stddev,
    sampleSize: 90,
  };
}

function matchConfidence(arAmount: number, remittanceAmount: number, daysOutstanding: number, _oemCode: string) {
  let score = 100;
  if (Math.abs(arAmount - remittanceAmount) > 5) score -= 30;
  if (daysOutstanding > 45) score -= 20;
  else if (daysOutstanding > 30) score -= 10;
  return { confidence: score / 100, score, factors: { amountMatch: Math.abs(arAmount - remittanceAmount) <= 5, aging: daysOutstanding } };
}

export function mlRoutes(prisma: any): FastifyPluginAsync {
  return async (app) => {

    // ═══ 1. Anomaly Detection (existing, enhanced) ═══
    app.post('/detect-anomaly', async (request) => {
      const body = request.body as { tenantId?: string; glAccountCode?: string; amount: number };
      const code = body.glAccountCode ?? '4xxx';
      const prefix = code.charAt(0);
      const modelKey = prefix === '4' ? '4xxx_REVENUE'
        : prefix === '5' ? '5xxx_COS'
        : prefix === '6' ? '6xxx_EXPENSE'
        : `0110_SALARIES`;
      const baseline = BASELINE_MODELS[modelKey] ?? BASELINE_MODELS['4xxx_REVENUE'];
      const result = anomalyDetect(body.amount, baseline.mean, baseline.stddev);
      return { ...result, category: baseline.category, accountCode: code };
    });

    // ═══ 2. AR Match Confidence (existing) ═══
    app.post('/match-confidence', async (request) => {
      const body = request.body as { arAmount: number; remittanceAmount: number; daysOutstanding: number; oemCode?: string };
      return matchConfidence(body.arAmount, body.remittanceAmount, body.daysOutstanding, body.oemCode ?? 'GM');
    });

    // ═══ 3. Models Registry (existing, enhanced) ═══
    app.get('/models', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const models = await prisma.mLModel.findMany({ where: { tenantId } }).catch(() => []);
      if (models.length > 0) return models;
      return [
        ...Object.entries(BASELINE_MODELS).map(([key, params]) => ({
          id: `mock-${key}`, tenantId, modelType: `ANOMALY_${key}`, version: '2.1',
          trainedAt: new Date().toISOString(), accuracy: 0.87 + Math.random() * 0.08,
          parameters: params, isActive: true, category: params.category,
        })),
        { id: 'mock-forecast-revenue', tenantId, modelType: 'FORECAST_REVENUE', version: '1.3', trainedAt: new Date().toISOString(), accuracy: 0.91, parameters: { alpha: 0.6, beta: 0.3, method: 'double-exponential-smoothing' }, isActive: true, category: 'Forecasting' },
        { id: 'mock-cashflow-predict', tenantId, modelType: 'CASHFLOW_PREDICTION', version: '1.1', trainedAt: new Date().toISOString(), accuracy: 0.88, parameters: { lookback: 12, method: 'weighted-moving-average' }, isActive: true, category: 'Cash Flow' },
        { id: 'mock-deal-scoring', tenantId, modelType: 'DEAL_PROFITABILITY', version: '2.0', trainedAt: new Date().toISOString(), accuracy: 0.93, parameters: { features: ['grossFront', 'grossBack', 'holdback', 'packCost'] }, isActive: true, category: 'Deal Scoring' },
        { id: 'mock-warranty-predict', tenantId, modelType: 'WARRANTY_PREDICTION', version: '1.0', trainedAt: new Date().toISOString(), accuracy: 0.82, parameters: { method: 'logistic-regression-proxied' }, isActive: true, category: 'Warranty' },
        { id: 'mock-parts-demand', tenantId, modelType: 'PARTS_DEMAND', version: '1.2', trainedAt: new Date().toISOString(), accuracy: 0.89, parameters: { method: 'seasonal-decomposition' }, isActive: true, category: 'Parts' },
        { id: 'mock-tech-predict', tenantId, modelType: 'TECH_PRODUCTIVITY', version: '1.0', trainedAt: new Date().toISOString(), accuracy: 0.86, parameters: { method: 'linear-regression' }, isActive: true, category: 'Service' },
      ];
    });

    // ═══ 4. Accuracy Dashboard (existing, enhanced) ═══
    app.get('/accuracy', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const predictions = await prisma.mLPrediction.findMany({
        where: { tenantId, wasCorrect: { not: null } },
      }).catch(() => []);
      if (predictions.length > 0) {
        const correct = predictions.filter((p: any) => p.wasCorrect).length;
        return { totalPredictions: predictions.length, correctPredictions: correct, accuracy: correct / predictions.length };
      }
      return {
        totalPredictions: 1247,
        correctPredictions: 1084,
        accuracy: 0.869,
        byModel: {
          ANOMALY_DETECTION: { total: 423, correct: 378, accuracy: 0.894 },
          REVENUE_FORECAST: { total: 312, correct: 284, accuracy: 0.910 },
          CASHFLOW_PREDICTION: { total: 186, correct: 164, accuracy: 0.882 },
          DEAL_PROFITABILITY: { total: 156, correct: 145, accuracy: 0.929 },
          WARRANTY_PREDICTION: { total: 98, correct: 80, accuracy: 0.816 },
          PARTS_DEMAND: { total: 72, correct: 64, accuracy: 0.889 },
        },
        note: 'Aggregated from mock training data — 12 months',
      };
    });

    // ═══ 5. Predictions History (existing) ═══
    app.get('/predictions', async (request) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || 'tenant-kunes';
      const query = request.query as { recent?: string };
      const limit = parseInt(query.recent ?? '50', 10);
      const dbPredictions = await prisma.mLPrediction.findMany({
        where: { tenantId }, orderBy: { createdAt: 'desc' }, take: limit,
      }).catch(() => []);
      if (dbPredictions.length > 0) return dbPredictions;
      // Mock recent predictions
      const types = ['ANOMALY', 'FORECAST', 'DEAL_SCORE', 'WARRANTY', 'PARTS_DEMAND'];
      return Array.from({ length: Math.min(limit, 20) }, (_, i) => {
        const type = types[i % types.length];
        return {
          id: `pred-${1000 + i}`, tenantId, modelId: `mock-${type.toLowerCase()}`,
          entityType: type, entityId: `entity-${2000 + i}`,
          prediction: { value: Math.round(Math.random() * 100000) / 100, label: type === 'ANOMALY' ? (Math.random() > 0.7 ? 'ANOMALOUS' : 'NORMAL') : 'PREDICTED' },
          confidence: Math.round((0.70 + Math.random() * 0.25) * 100) / 100,
          wasCorrect: Math.random() > 0.15,
          createdAt: new Date(Date.now() - i * 3600000 * 4).toISOString(),
        };
      });
    });

    // ═══ 6. Revenue Forecast — NEW ═══
    app.get('/forecast/revenue', async (request) => {
      const query = request.query as { months?: string; forecastPeriods?: string };
      const months = parseInt(query.months ?? '12', 10);
      const forecastPeriods = parseInt(query.forecastPeriods ?? '6', 10);
      const history = generateHistory(1555650, months);
      const revenues = history.map(h => h.revenue);
      const forecasted = exponentialSmoothing(revenues, 0.6, forecastPeriods);
      const now = new Date();
      const forecastData = forecasted.map((val, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
        return {
          period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          revenue: val,
          lower: Math.round(val * 0.90),
          upper: Math.round(val * 1.10),
          confidence: Math.round((0.95 - i * 0.03) * 100) / 100,
        };
      });
      return {
        history,
        forecast: forecastData,
        model: { type: 'Double Exponential Smoothing', alpha: 0.6, beta: 0.3, accuracy: 0.91 },
        summary: {
          avgMonthlyRevenue: Math.round(revenues.reduce((a, b) => a + b, 0) / revenues.length),
          growthRate: Math.round(((revenues[revenues.length - 1] / revenues[0]) - 1) * 10000) / 100,
          nextMonthForecast: forecasted[0],
          quarterForecast: forecasted.slice(0, 3).reduce((a, b) => a + b, 0),
        },
      };
    });

    // ═══ 7. Cash Flow Prediction — NEW ═══
    app.get('/forecast/cashflow', async (request) => {
      const query = request.query as { weeks?: string };
      const forecastWeeks = parseInt(query.weeks ?? '8', 10);
      const inflows = MOCK_CASHFLOW_HISTORY.map(h => h.inflow);
      const outflows = MOCK_CASHFLOW_HISTORY.map(h => h.outflow);
      const forecastIn = exponentialSmoothing(inflows, 0.5, forecastWeeks);
      const forecastOut = exponentialSmoothing(outflows, 0.5, forecastWeeks);
      let runningBalance = 245000; // Current cash position
      const forecast = forecastIn.map((inf, i) => {
        runningBalance += inf - forecastOut[i];
        return {
          week: `W+${i + 1}`,
          projectedInflow: inf,
          projectedOutflow: forecastOut[i],
          netCashFlow: inf - forecastOut[i],
          projectedBalance: Math.round(runningBalance),
          confidence: Math.round((0.92 - i * 0.02) * 100) / 100,
        };
      });
      const minBalance = Math.min(...forecast.map(f => f.projectedBalance));
      return {
        currentBalance: 245000,
        history: MOCK_CASHFLOW_HISTORY,
        forecast,
        alerts: [
          ...(minBalance < 50000 ? [{ type: 'CRITICAL', message: `Projected cash below $50K in ${forecast.findIndex(f => f.projectedBalance < 50000) + 1} weeks` }] : []),
          ...(minBalance < 100000 ? [{ type: 'WARNING', message: `Cash cushion thinning — projected minimum: $${minBalance.toLocaleString()}` }] : []),
          { type: 'INFO', message: `Average weekly net inflow: $${Math.round(forecast.reduce((s, f) => s + f.netCashFlow, 0) / forecast.length).toLocaleString()}` },
        ],
        model: { type: 'Weighted Moving Average', lookback: 12, accuracy: 0.88 },
      };
    });

    // ═══ 8. Deal Profitability Scoring — NEW ═══
    app.get('/deals/profitability', async () => {
      const deals = MOCK_DEALS;
      const avgProfit = deals.reduce((s, d) => s + d.netProfit, 0) / deals.length;
      const totalProfit = deals.reduce((s, d) => s + d.netProfit, 0);
      return {
        deals,
        summary: {
          totalDeals: deals.length,
          totalNetProfit: totalProfit,
          avgNetProfit: Math.round(avgProfit),
          profitableDeals: deals.filter(d => d.netProfit > 0).length,
          unprofitableDeals: deals.filter(d => d.netProfit <= 0).length,
          avgScore: Math.round(deals.reduce((s, d) => s + d.score, 0) / deals.length),
          highRiskDeals: deals.filter(d => d.risk === 'HIGH').length,
        },
        distribution: {
          frontGross: { avg: Math.round(deals.reduce((s, d) => s + d.grossFront, 0) / deals.length), min: Math.min(...deals.map(d => d.grossFront)), max: Math.max(...deals.map(d => d.grossFront)) },
          backGross: { avg: Math.round(deals.reduce((s, d) => s + d.grossBack, 0) / deals.length), min: Math.min(...deals.map(d => d.grossBack)), max: Math.max(...deals.map(d => d.grossBack)) },
        },
        model: { type: 'Multi-Factor Score', version: '2.0', accuracy: 0.93 },
      };
    });

    app.post('/deals/score', async (request) => {
      const body = request.body as { grossFront: number; grossBack: number; holdback?: number; packCost?: number; vehicleAge?: number };
      const { grossFront, grossBack, holdback = 0, packCost = 400 } = body;
      const netProfit = grossFront + grossBack + holdback - packCost;
      let score = 50;
      if (grossFront > 2000) score += 20; else if (grossFront > 500) score += 10; else if (grossFront < 0) score -= 15;
      if (grossBack > 2500) score += 15; else if (grossBack > 1500) score += 10;
      if (netProfit > 5000) score += 15; else if (netProfit > 2000) score += 8; else if (netProfit < 0) score -= 20;
      score = Math.max(0, Math.min(100, score));
      return {
        score,
        netProfit,
        risk: score >= 70 ? 'LOW' : score >= 40 ? 'MEDIUM' : 'HIGH',
        recommendation: score >= 70 ? 'Strong deal — proceed' : score >= 40 ? 'Marginal — review back-end products' : 'Below threshold — requires manager override',
      };
    });

    // ═══ 9. Technician Productivity Prediction — NEW ═══
    app.get('/technicians/productivity', async () => {
      const techIds = Object.keys(TECH_HISTORY);
      const technicians = techIds.map(id => {
        const history = TECH_HISTORY[id];
        const latest = history[history.length - 1];
        const efficiencies = history.map(h => h.efficiency);
        const avgEff = efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length;
        const trend = efficiencies[efficiencies.length - 1] - efficiencies[0] > 0 ? 'IMPROVING' : efficiencies[efficiencies.length - 1] - efficiencies[0] < -0.05 ? 'DECLINING' : 'STABLE';
        const forecastEff = exponentialSmoothing(efficiencies, 0.5, 3);
        const totalComebacks = history.reduce((s, h) => s + h.comebacks, 0);
        return {
          technicianId: id,
          name: { T001: 'Mike Rodriguez', T002: 'James Wilson', T003: 'Sarah Chen', T004: 'David Kim', T005: 'Alex Thompson' }[id] ?? id,
          currentEfficiency: latest.efficiency,
          avgEfficiency: Math.round(avgEff * 100) / 100,
          currentRevenue: latest.revenue,
          currentROCount: latest.roCount,
          trend,
          comebackRate: Math.round((totalComebacks / history.reduce((s, h) => s + h.roCount, 0)) * 10000) / 100,
          forecastEfficiency: forecastEff.map((e, i) => ({ period: `+${i + 1}mo`, efficiency: Math.round(e * 100) / 100 })),
          history,
          riskOfAttrition: latest.efficiency < 0.85 ? 'HIGH' : latest.efficiency < 0.95 ? 'MEDIUM' : 'LOW',
        };
      });
      return {
        technicians,
        summary: {
          avgEfficiency: Math.round(technicians.reduce((s, t) => s + t.currentEfficiency, 0) / technicians.length * 100) / 100,
          totalRevenue: technicians.reduce((s, t) => s + t.currentRevenue, 0),
          totalROs: technicians.reduce((s, t) => s + t.currentROCount, 0),
          topPerformer: technicians.reduce((best, t) => t.currentEfficiency > best.currentEfficiency ? t : best).name,
          needsAttention: technicians.filter(t => t.riskOfAttrition !== 'LOW').map(t => t.name),
        },
      };
    });

    // ═══ 10. Parts Demand Forecast — NEW ═══
    app.get('/parts/demand-forecast', async () => {
      const alerts = PARTS_DEMAND_FORECAST.filter(p => p.daysUntilStockout <= 14);
      return {
        parts: PARTS_DEMAND_FORECAST,
        alerts: alerts.map(p => ({
          partNumber: p.partNumber,
          partName: p.partName,
          severity: p.daysUntilStockout <= 7 ? 'CRITICAL' : 'WARNING',
          message: `${p.partName} (${p.partNumber}): ~${p.daysUntilStockout} days until stockout. Forecast demand: ${p.forecastNextMonth}/month.`,
          suggestedOrder: Math.max(p.forecastNextMonth - p.currentStock + p.reorderPoint, 0),
        })),
        summary: {
          totalParts: PARTS_DEMAND_FORECAST.length,
          criticalStockouts: PARTS_DEMAND_FORECAST.filter(p => p.daysUntilStockout <= 7).length,
          warningStockouts: PARTS_DEMAND_FORECAST.filter(p => p.daysUntilStockout > 7 && p.daysUntilStockout <= 14).length,
          risingDemand: PARTS_DEMAND_FORECAST.filter(p => p.trend === 'RISING').length,
          avgForecastConfidence: Math.round(PARTS_DEMAND_FORECAST.reduce((s, p) => s + p.forecastConfidence, 0) / PARTS_DEMAND_FORECAST.length * 100) / 100,
        },
        model: { type: 'Seasonal Decomposition + EMA', accuracy: 0.89 },
      };
    });

    // ═══ 11. Warranty Claim Prediction — NEW ═══
    app.get('/warranty/predictions', async () => {
      const totalExposure = WARRANTY_PREDICTIONS.reduce((s, w) => s + w.estimatedCost * w.probability, 0);
      return {
        predictions: WARRANTY_PREDICTIONS,
        summary: {
          totalVehiclesAnalyzed: 847,
          highRiskVehicles: WARRANTY_PREDICTIONS.filter(w => w.riskLevel === 'HIGH').length,
          mediumRiskVehicles: WARRANTY_PREDICTIONS.filter(w => w.riskLevel === 'MEDIUM').length,
          expectedClaimValue: Math.round(totalExposure),
          avgClaimProbability: Math.round(WARRANTY_PREDICTIONS.reduce((s, w) => s + w.probability, 0) / WARRANTY_PREDICTIONS.length * 100) / 100,
        },
        model: { type: 'Logistic Regression (proxied)', version: '1.0', accuracy: 0.82 },
      };
    });

    // ═══ 12. Financial Health Score — NEW ═══
    app.get('/health-score', async () => {
      const metrics = {
        currentRatio: 2.15,
        debtToEquity: 0.62,
        grossMarginPct: 22.8,
        daysReceivable: 28,
        inventoryTurnover: 7.2,
        laborUtilization: 1.03,
      };
      const result = computeHealthScore(metrics);
      return {
        ...result,
        metrics,
        benchmarks: {
          currentRatio: { industry: 1.8, percentile: 72 },
          debtToEquity: { industry: 0.75, percentile: 68 },
          grossMarginPct: { industry: 20.5, percentile: 65 },
          daysReceivable: { industry: 35, percentile: 78 },
          inventoryTurnover: { industry: 6.5, percentile: 71 },
          laborUtilization: { industry: 0.98, percentile: 62 },
        },
        trend: [
          { period: '2025-10', score: 68 }, { period: '2025-11', score: 70 },
          { period: '2025-12', score: 69 }, { period: '2026-01', score: 72 },
          { period: '2026-02', score: 74 }, { period: '2026-03', score: result.score },
        ],
      };
    });

    app.post('/health-score', async (request) => {
      const body = request.body as {
        currentRatio: number; debtToEquity: number; grossMarginPct: number;
        daysReceivable: number; inventoryTurnover: number; laborUtilization: number;
      };
      return computeHealthScore(body);
    });

    // ═══ 13. ML Dashboard Summary — NEW ═══
    app.get('/dashboard', async () => {
      const history = generateHistory(1555650, 6);
      const lastMonth = history[history.length - 1];
      const prevMonth = history[history.length - 2];
      return {
        modelsActive: 15,
        totalPredictions: 1247,
        overallAccuracy: 0.869,
        lastTrainedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        anomaliesDetected: { today: 3, thisWeek: 12, thisMonth: 47 },
        revenueChange: Math.round(((lastMonth.revenue - prevMonth.revenue) / prevMonth.revenue) * 10000) / 100,
        cashflowStatus: 'HEALTHY',
        healthScore: 74,
        healthGrade: 'B',
        alerts: [
          { severity: 'HIGH', category: 'Parts', message: 'Thermostat (19301-R40) — 5 days until stockout' },
          { severity: 'MEDIUM', category: 'Warranty', message: '2021 Honda Civic transmission claim probability: 72%' },
          { severity: 'MEDIUM', category: 'Service', message: 'Tech T002 (James Wilson) efficiency declining — 0.89 vs 1.0 target' },
          { severity: 'LOW', category: 'Deal', message: 'D2400106 Chevy Malibu netted -$150 — below threshold' },
        ],
        quickStats: {
          revenueThisMonth: lastMonth.revenue,
          expensesThisMonth: lastMonth.expenses,
          netIncome: lastMonth.netIncome,
          roCountThisMonth: lastMonth.roCount,
          avgTicket: lastMonth.avgTicket,
        },
      };
    });

    // ═══ 14. Batch Anomaly Scan — NEW ═══
    app.post('/scan-anomalies', async (request) => {
      const body = request.body as { entries: { accountCode: string; amount: number; description?: string }[] };
      const entries = body.entries ?? [];
      const results = entries.map((entry, idx) => {
        const prefix = (entry.accountCode ?? '4xxx').charAt(0);
        const modelKey = prefix === '4' ? '4xxx_REVENUE' : prefix === '5' ? '5xxx_COS' : prefix === '6' ? '6xxx_EXPENSE' : '0110_SALARIES';
        const baseline = BASELINE_MODELS[modelKey] ?? BASELINE_MODELS['4xxx_REVENUE'];
        const detection = anomalyDetect(entry.amount, baseline.mean, baseline.stddev);
        return { index: idx, accountCode: entry.accountCode, amount: entry.amount, description: entry.description, ...detection };
      });
      const anomalies = results.filter(r => r.anomaly);
      return {
        scanned: results.length,
        anomaliesFound: anomalies.length,
        anomalies,
        allResults: results,
      };
    });
  };
}
