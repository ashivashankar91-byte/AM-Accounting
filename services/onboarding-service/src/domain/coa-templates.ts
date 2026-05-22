export const HYUNDAI_STANDARD = {
  accounts: [
    { code: '2310', name: 'Inventory-New Hyundai', type: 'ASSET' },
    { code: '2320', name: 'Inventory-Used Vehicles', type: 'ASSET' },
    { code: '2330', name: 'Inventory-Demo Vehicles', type: 'ASSET' },
    { code: '2340', name: 'Parts Inventory', type: 'ASSET' },
    { code: '2010', name: 'Cash Clearing', type: 'ASSET' },
    { code: '2025', name: 'Cash-Payroll', type: 'ASSET' },
    { code: '2250', name: 'Cash Sales', type: 'ASSET' },
    { code: '3100', name: 'N/P New Hyundai', type: 'LIABILITY' },
    { code: '3110', name: 'N/P Used Vehicles', type: 'LIABILITY' },
    { code: '3200', name: 'Accrued Payroll', type: 'LIABILITY' },
    { code: '3210', name: 'Accrued Payroll (Posting)', type: 'LIABILITY' },
    { code: '3231', name: 'Federal Tax Withholding', type: 'LIABILITY' },
    { code: '4000', name: 'New Vehicle Sales', type: 'REVENUE' },
    { code: '4010', name: 'Used Vehicle Sales-Retail', type: 'REVENUE' },
    { code: '4100', name: 'Service Labor Revenue', type: 'REVENUE' },
    { code: '4200', name: 'Parts Sales-Counter', type: 'REVENUE' },
    { code: '4500', name: 'Labour Revenue', type: 'REVENUE' },
    { code: '4600', name: 'Parts Revenue', type: 'REVENUE' },
    { code: '6500', name: 'Labour Cost', type: 'EXPENSE' },
    { code: '6600', name: 'Parts Cost', type: 'EXPENSE' },
    { code: '6000', name: 'Salaries-Management', type: 'EXPENSE' },
    { code: '6010', name: 'Commissions-Sales', type: 'EXPENSE' },
    { code: '6100', name: 'Payroll Taxes', type: 'EXPENSE' },
    { code: '6200', name: 'Advertising', type: 'EXPENSE' },
  ],
};

export const GM_STANDARD = {
  accounts: [
    { code: '1200', name: 'New Vehicle Inventory', type: 'ASSET' },
    { code: '1210', name: 'Used Vehicle Inventory', type: 'ASSET' },
    { code: '1300', name: 'Parts Inventory', type: 'ASSET' },
    { code: '1000', name: 'Cash-Operating Checking', type: 'ASSET' },
    { code: '1100', name: 'Accounts Receivable-Trade', type: 'ASSET' },
    { code: '2000', name: 'Accounts Payable-Trade', type: 'LIABILITY' },
    { code: '2100', name: 'New Vehicle Floor Plan', type: 'LIABILITY' },
    { code: '2200', name: 'Accrued Payroll', type: 'LIABILITY' },
    { code: '4000', name: 'New Vehicle Sales', type: 'REVENUE' },
    { code: '4010', name: 'Used Vehicle Sales-Retail', type: 'REVENUE' },
    { code: '4100', name: 'Service Labor Sales', type: 'REVENUE' },
    { code: '4200', name: 'Parts Sales-Counter', type: 'REVENUE' },
    { code: '4400', name: 'F&I Income', type: 'REVENUE' },
    { code: '5000', name: 'Cost of New Vehicles Sold', type: 'COST_OF_SALES' },
    { code: '5100', name: 'Service Cost of Sales', type: 'COST_OF_SALES' },
    { code: '6000', name: 'Salaries-Management', type: 'EXPENSE' },
    { code: '6010', name: 'Commissions-Sales', type: 'EXPENSE' },
    { code: '6100', name: 'Payroll Taxes', type: 'EXPENSE' },
    { code: '6200', name: 'Advertising', type: 'EXPENSE' },
    { code: '6300', name: 'Rent Expense', type: 'EXPENSE' },
  ],
};

export const COA_TEMPLATES: Record<string, typeof HYUNDAI_STANDARD> = {
  HYUNDAI: HYUNDAI_STANDARD,
  KIA: HYUNDAI_STANDARD,
  GM: GM_STANDARD,
  FORD: GM_STANDARD,
  DEFAULT: GM_STANDARD,
};

export interface ValidationResult {
  score: number;
  valid: boolean;
  checks: { range: string; required: number; found: number; ok: boolean }[];
}

export function validateAccountRanges(accounts: { code: string }[]): ValidationResult {
  const ranges = [
    { range: '2xxx', prefix: '2', required: 3 },
    { range: '3xxx', prefix: '3', required: 2 },
    { range: '4xxx', prefix: '4', required: 4 },
    { range: '6xxx', prefix: '6', required: 2 },
  ];

  const checks = ranges.map(r => {
    const found = accounts.filter(a => a.code.startsWith(r.prefix)).length;
    return { range: r.range, required: r.required, found, ok: found >= r.required };
  });

  const passedChecks = checks.filter(c => c.ok).length;
  const score = Math.round((passedChecks / checks.length) * 100);
  return { score, valid: passedChecks === checks.length, checks };
}
