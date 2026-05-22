import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import PageLoader from '../../../components/PageLoader';

type CodeType = 'EARNINGS' | 'DEDUCTIONS';

interface EarningRow {
  employeeId: string;
  employeeName: string;
  earningCode: string;
  description: string;
  hours: number;
  amount: number;
  grossPay: number;
}

interface DeductionRow {
  employeeId: string;
  employeeName: string;
  deductionCode: string;
  description: string;
  preTax: boolean;
  amount: number;
  ytdAmount: number;
}

const MOCK_EARNINGS: EarningRow[] = [
  { employeeId: 'E-1042', employeeName: 'Marcus Delgado',    earningCode: 'REG', description: 'Regular Pay',        hours: 80,   amount: 3600.00, grossPay: 4210.00 },
  { employeeId: 'E-1042', employeeName: 'Marcus Delgado',    earningCode: 'OT',  description: 'Overtime Pay',       hours: 8,    amount: 540.00,  grossPay: 4210.00 },
  { employeeId: 'E-1042', employeeName: 'Marcus Delgado',    earningCode: 'BON', description: 'Performance Bonus',  hours: 0,    amount: 70.00,   grossPay: 4210.00 },
  { employeeId: 'E-1017', employeeName: 'Priya Nair',        earningCode: 'REG', description: 'Regular Pay',        hours: 80,   amount: 2900.00, grossPay: 3100.00 },
  { employeeId: 'E-1017', employeeName: 'Priya Nair',        earningCode: 'HOL', description: 'Holiday Pay',        hours: 8,    amount: 200.00,  grossPay: 3100.00 },
  { employeeId: 'E-2003', employeeName: 'Sandra Kuznetsov',  earningCode: 'REG', description: 'Regular Pay',        hours: 80,   amount: 8750.00, grossPay: 9750.00 },
  { employeeId: 'E-2003', employeeName: 'Sandra Kuznetsov',  earningCode: 'CAR', description: 'Car Allowance',      hours: 0,    amount: 1000.00, grossPay: 9750.00 },
];

const MOCK_DEDUCTIONS: DeductionRow[] = [
  { employeeId: 'E-1042', employeeName: 'Marcus Delgado',    deductionCode: '401K', description: '401(k) Contribution', preTax: true,  amount: 336.80,  ytdAmount: 1684.00 },
  { employeeId: 'E-1042', employeeName: 'Marcus Delgado',    deductionCode: 'MEDB', description: 'Medical — Blue Plan', preTax: true,  amount: 180.00,  ytdAmount:  900.00 },
  { employeeId: 'E-1042', employeeName: 'Marcus Delgado',    deductionCode: 'DENT', description: 'Dental Premium',      preTax: true,  amount:  22.00,  ytdAmount:  110.00 },
  { employeeId: 'E-1042', employeeName: 'Marcus Delgado',    deductionCode: 'WADV', description: 'Wage Advance Repay',  preTax: false, amount: 100.00,  ytdAmount:  300.00 },
  { employeeId: 'E-1017', employeeName: 'Priya Nair',        deductionCode: '401K', description: '401(k) Contribution', preTax: true,  amount: 248.00,  ytdAmount: 1240.00 },
  { employeeId: 'E-1017', employeeName: 'Priya Nair',        deductionCode: 'MEDB', description: 'Medical — Blue Plan', preTax: true,  amount: 180.00,  ytdAmount:  900.00 },
  { employeeId: 'E-2003', employeeName: 'Sandra Kuznetsov',  deductionCode: '401K', description: '401(k) Contribution', preTax: true,  amount: 780.00,  ytdAmount: 3900.00 },
  { employeeId: 'E-2003', employeeName: 'Sandra Kuznetsov',  deductionCode: 'ROTH', description: 'Roth 401(k)',          preTax: false, amount: 195.00,  ytdAmount:  975.00 },
];

function fmt(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtPct(amount: number, gross: number): string {
  if (gross === 0) return '—';
  return ((amount / gross) * 100).toFixed(1) + '%';
}

export default function EarningsDeductionsReport() {
  const [codeType, setCodeType]           = useState<CodeType>('EARNINGS');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [generated, setGenerated]         = useState(false);

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.listRuns(),
    retry: false,
  });

  const earningTotals = useMemo(() => ({
    hours:  MOCK_EARNINGS.reduce((s, r) => s + r.hours, 0),
    amount: MOCK_EARNINGS.reduce((s, r) => s + r.amount, 0),
  }), []);

  const deductionTotals = useMemo(() => ({
    amount:    MOCK_DEDUCTIONS.reduce((s, r) => s + r.amount, 0),
    ytdAmount: MOCK_DEDUCTIONS.reduce((s, r) => s + r.ytdAmount, 0),
  }), []);

  function handleGenerate() {
    setGenerated(true);
  }

  if (runsLoading) return <PageLoader page="Earnings & Deductions" service="payroll-service" port={3010} />;

  const runOptions: any[] = Array.isArray(runs) ? runs : [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Earnings &amp; Deductions Report</h1>
        <p className="text-sm text-gray-500 mt-0.5">Per-run breakdown of earning codes or deduction codes (BR-PAY-007)</p>
      </div>

      {/* Parameters card */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Report Parameters</h2>

        {/* BR-PAY-007 XOR warning */}
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-800">
          <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span><strong>Note: BR-PAY-007</strong> — You may select EITHER Earnings OR Deductions codes, not both.</span>
        </div>

        <div className="flex flex-wrap gap-6 items-end">
          {/* Radio buttons — XOR enforced */}
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs font-medium text-gray-600 mb-1">Report Type</legend>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="codeType"
                value="EARNINGS"
                checked={codeType === 'EARNINGS'}
                onChange={() => { setCodeType('EARNINGS'); setGenerated(false); }}
                className="w-4 h-4 text-brand border-gray-300 focus:ring-brand"
              />
              <span className="text-sm text-gray-800">Earnings</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="codeType"
                value="DEDUCTIONS"
                checked={codeType === 'DEDUCTIONS'}
                onChange={() => { setCodeType('DEDUCTIONS'); setGenerated(false); }}
                className="w-4 h-4 text-brand border-gray-300 focus:ring-brand"
              />
              <span className="text-sm text-gray-800">Deductions</span>
            </label>
          </fieldset>

          {/* Pay Period selector */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Pay Period</label>
            <select
              value={selectedRunId}
              onChange={e => { setSelectedRunId(e.target.value); setGenerated(false); }}
              className="h-8 px-2 border border-gray-300 rounded text-sm text-gray-900 focus:ring-1 focus:ring-brand focus:border-blue-500 outline-none min-w-[240px]"
            >
              <option value="">— Select Pay Run —</option>
              {runOptions.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.id} · {r.checkDate ?? r.check_date ?? ''}
                </option>
              ))}
              {/* Demo options when API returns nothing */}
              {runOptions.length === 0 && (
                <>
                  <option value="RUN-2026-05-A">RUN-2026-05-A · 2026-05-15</option>
                  <option value="RUN-2026-04-B">RUN-2026-04-B · 2026-04-30</option>
                  <option value="RUN-2026-04-A">RUN-2026-04-A · 2026-04-15</option>
                </>
              )}
            </select>
          </div>

          <button
            onClick={handleGenerate}
            disabled={!selectedRunId && runOptions.length > 0}
            className="h-8 px-4 bg-brand text-white text-sm font-medium rounded hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Generate
          </button>
        </div>
      </div>

      {/* Report table */}
      {generated && codeType === 'EARNINGS' && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-700">
              Earnings Codes — {selectedRunId || 'RUN-2026-05-A'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Emp ID</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee Name</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Earning Code</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Hours</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">% of Gross</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {MOCK_EARNINGS.map((row, i) => (
                  <tr key={i} className="h-9 hover:bg-gray-50">
                    <td className="px-4 py-0 font-mono text-xs text-gray-600">{row.employeeId}</td>
                    <td className="px-4 py-0 text-gray-900">{row.employeeName}</td>
                    <td className="px-4 py-0 font-mono text-xs font-medium text-brand">{row.earningCode}</td>
                    <td className="px-4 py-0 text-gray-700">{row.description}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-700">{row.hours > 0 ? row.hours.toFixed(2) : '—'}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(row.amount)}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-600">{fmtPct(row.amount, row.grossPay)}</td>
                  </tr>
                ))}
                <tr className="h-9 bg-gray-50 border-t-2 border-gray-300 font-semibold">
                  <td className="px-4 py-0 text-gray-900" colSpan={4}>TOTALS</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{earningTotals.hours.toFixed(2)}</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(earningTotals.amount)}</td>
                  <td className="px-4 py-0" />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {generated && codeType === 'DEDUCTIONS' && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-700">
              Deduction Codes — {selectedRunId || 'RUN-2026-05-A'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Emp ID</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Employee Name</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ded. Code</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Pre-Tax?</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">YTD Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {MOCK_DEDUCTIONS.map((row, i) => (
                  <tr key={i} className="h-9 hover:bg-gray-50">
                    <td className="px-4 py-0 font-mono text-xs text-gray-600">{row.employeeId}</td>
                    <td className="px-4 py-0 text-gray-900">{row.employeeName}</td>
                    <td className="px-4 py-0 font-mono text-xs font-medium text-brand">{row.deductionCode}</td>
                    <td className="px-4 py-0 text-gray-700">{row.description}</td>
                    <td className="px-4 py-0 text-center">
                      {row.preTax
                        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Yes</span>
                        : <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">No</span>
                      }
                    </td>
                    <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(row.amount)}</td>
                    <td className="px-4 py-0 text-right font-mono text-gray-600">{fmt(row.ytdAmount)}</td>
                  </tr>
                ))}
                <tr className="h-9 bg-gray-50 border-t-2 border-gray-300 font-semibold">
                  <td className="px-4 py-0 text-gray-900" colSpan={5}>TOTALS</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(deductionTotals.amount)}</td>
                  <td className="px-4 py-0 text-right font-mono text-gray-900">{fmt(deductionTotals.ytdAmount)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!generated && (
        <div className="flex items-center justify-center h-48 bg-white border border-gray-200 rounded-lg text-gray-400 text-sm">
          Select Earnings or Deductions, choose a pay period, and click Generate.
        </div>
      )}
    </div>
  );
}
