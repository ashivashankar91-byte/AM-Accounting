/**
 * Maps canonical deal data to GL journal lines based on NADA account codes.
 * Each transaction type produces a balanced set of debit/credit lines.
 */

interface GLLine {
  accountCode: string;
  debit: number;
  credit: number;
  memo: string;
}

interface DealData {
  dealNumber: string;
  dealType: 'NEW' | 'USED' | 'WHOLESALE';
  salePrice: number;   // dollars
  cost: number;         // dollars
  customerName: string;
  addOns: Array<{ description: string; price: number; cost: number }>;
  financeSources: Array<{ name: string; amount: number }>;
  tradeIn?: { vin: string; allowance: number; payoff: number };
  transactionType?: string;  // RO, INV, DEAL, WARRANTY, INCENTIVE
}

function detectTransactionType(dealNumber: string, description?: string): string {
  const ref = (dealNumber ?? '').toUpperCase();
  if (ref.startsWith('RO')) return 'SERVICE_RO';
  if (ref.startsWith('INV')) return 'INVOICE';
  if (ref.startsWith('W-') || ref.startsWith('WC')) return 'WARRANTY';
  if (ref.startsWith('INC') || ref.startsWith('FI-')) return 'INCENTIVE';
  if (ref.startsWith('BP') || ref.startsWith('BS')) return 'BODY_SHOP';
  return 'VEHICLE_SALE';
}

export function mapDealToGLLines(data: DealData, description?: string): GLLine[] {
  const type = data.transactionType || detectTransactionType(data.dealNumber, description);
  const ref = data.dealNumber;

  switch (type) {
    case 'SERVICE_RO':
      return mapServiceRO(data, ref);
    case 'INVOICE':
      return mapPartsInvoice(data, ref);
    case 'WARRANTY':
      return mapWarrantyClaim(data, ref);
    case 'INCENTIVE':
      return mapFactoryIncentive(data, ref);
    case 'BODY_SHOP':
      return mapBodyShop(data, ref);
    default:
      return mapVehicleSale(data, ref);
  }
}

function mapServiceRO(data: DealData, ref: string): GLLine[] {
  const lines: GLLine[] = [];
  const total = data.salePrice;
  const costAmount = data.cost;

  // Debit Cash for amount received
  lines.push({ accountCode: '1000', debit: total, credit: 0, memo: `Cash received - ${ref}` });

  // Credit Service Labor Sales for revenue
  lines.push({ accountCode: '4100', debit: 0, credit: total, memo: `Service labor - ${ref}` });

  // If cost is known, record COS
  if (costAmount > 0) {
    lines.push({ accountCode: '5100', debit: costAmount, credit: 0, memo: `Service COS - ${ref}` });
    lines.push({ accountCode: '2200', debit: 0, credit: costAmount, memo: `Accrued labor - ${ref}` });
  }

  return lines;
}

function mapPartsInvoice(data: DealData, ref: string): GLLine[] {
  const lines: GLLine[] = [];
  const total = data.salePrice;
  const costAmount = data.cost;

  // Debit Cash or AR
  lines.push({ accountCode: '1000', debit: total, credit: 0, memo: `Parts payment - ${ref}` });
  // Credit Parts Sales
  lines.push({ accountCode: '4200', debit: 0, credit: total, memo: `Parts counter sale - ${ref}` });

  if (costAmount > 0) {
    lines.push({ accountCode: '5200', debit: costAmount, credit: 0, memo: `Parts COS - ${ref}` });
    lines.push({ accountCode: '1300', debit: 0, credit: costAmount, memo: `Parts inventory relief - ${ref}` });
  }

  return lines;
}

function mapWarrantyClaim(data: DealData, ref: string): GLLine[] {
  const lines: GLLine[] = [];
  const total = data.salePrice;

  // Debit AR-Factory (OEM owes us)
  lines.push({ accountCode: '1110', debit: total, credit: 0, memo: `Warranty claim - ${ref}` });
  // Credit Warranty Revenue
  lines.push({ accountCode: '4420', debit: 0, credit: total, memo: `Warranty revenue - ${ref}` });

  if (data.cost > 0) {
    lines.push({ accountCode: '5100', debit: data.cost, credit: 0, memo: `Warranty labor COS - ${ref}` });
    lines.push({ accountCode: '2200', debit: 0, credit: data.cost, memo: `Accrued tech pay - ${ref}` });
  }

  return lines;
}

function mapFactoryIncentive(data: DealData, ref: string): GLLine[] {
  const total = data.salePrice;
  return [
    { accountCode: '1110', debit: total, credit: 0, memo: `Factory incentive receivable - ${ref}` },
    { accountCode: '4500', debit: 0, credit: total, memo: `Factory incentive credit - ${ref}` },
  ];
}

function mapBodyShop(data: DealData, ref: string): GLLine[] {
  const lines: GLLine[] = [];
  const total = data.salePrice;

  lines.push({ accountCode: '1000', debit: total, credit: 0, memo: `Body shop payment - ${ref}` });
  lines.push({ accountCode: '4300', debit: 0, credit: total, memo: `Body shop revenue - ${ref}` });

  if (data.cost > 0) {
    lines.push({ accountCode: '5300', debit: data.cost, credit: 0, memo: `Body shop COS - ${ref}` });
    lines.push({ accountCode: '2000', debit: 0, credit: data.cost, memo: `Parts/sublet payable - ${ref}` });
  }

  return lines;
}

function mapVehicleSale(data: DealData, ref: string): GLLine[] {
  const lines: GLLine[] = [];
  const isNew = data.dealType === 'NEW';
  const isWholesale = data.dealType === 'WHOLESALE';
  const sale = data.salePrice;
  const cost = data.cost;

  // Revenue account
  const revenueAcct = isNew ? '4000' : isWholesale ? '4020' : '4010';
  const revenueLabel = isNew ? 'New vehicle sale' : isWholesale ? 'Wholesale vehicle sale' : 'Used vehicle sale';
  const cosAcct = isNew ? '5000' : '5010';
  const inventoryAcct = isNew ? '1200' : '1210';
  const floorPlanAcct = isNew ? '2100' : '2110';

  // Financing: if finance sources exist, debit AR-Finance; otherwise debit Cash
  const financeTotal = data.financeSources.reduce((s, f) => s + f.amount, 0);
  const cashFromCustomer = sale - financeTotal;

  if (cashFromCustomer > 0) {
    lines.push({ accountCode: '1000', debit: cashFromCustomer, credit: 0, memo: `Customer payment - ${ref}` });
  }
  if (financeTotal > 0) {
    lines.push({ accountCode: '1120', debit: financeTotal, credit: 0, memo: `Finance receivable - ${ref} (${data.financeSources.map(f => f.name).join(', ')})` });
  }

  // Credit Revenue
  lines.push({ accountCode: revenueAcct, debit: 0, credit: sale, memo: `${revenueLabel} - ${ref}` });

  // Cost of Sale — debit COS, credit inventory
  if (cost > 0) {
    lines.push({ accountCode: cosAcct, debit: cost, credit: 0, memo: `Cost of vehicle - ${ref}` });
    lines.push({ accountCode: inventoryAcct, debit: 0, credit: cost, memo: `Inventory relief - ${ref}` });
  }

  // Floor plan payoff
  if (cost > 0) {
    lines.push({ accountCode: floorPlanAcct, debit: cost, credit: 0, memo: `Floor plan payoff - ${ref}` });
    lines.push({ accountCode: '1000', debit: 0, credit: cost, memo: `Floor plan payment - ${ref}` });
  }

  // F&I add-ons
  for (const addon of data.addOns) {
    if (addon.price > 0) {
      lines.push({ accountCode: '4400', debit: 0, credit: addon.price, memo: `F&I: ${addon.description} - ${ref}` });
      lines.push({ accountCode: '1000', debit: addon.price, credit: 0, memo: `F&I payment: ${addon.description} - ${ref}` });
    }
  }

  // Trade-in
  if (data.tradeIn) {
    const { allowance, payoff } = data.tradeIn;
    if (allowance > 0) {
      lines.push({ accountCode: '1210', debit: allowance, credit: 0, memo: `Trade-in inventory - ${ref}` });
      lines.push({ accountCode: '1000', debit: 0, credit: allowance, memo: `Trade-in allowance - ${ref}` });
    }
    if (payoff > 0) {
      lines.push({ accountCode: '1000', debit: 0, credit: payoff, memo: `Trade payoff to lender - ${ref}` });
      lines.push({ accountCode: '2000', debit: payoff, credit: 0, memo: `Trade payoff AP - ${ref}` });
    }
  }

  return lines;
}
