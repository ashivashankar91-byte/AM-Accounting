import { IDMSAdapter, CanonicalDealPost, Money, DMSType, asTenantId } from '@amacc/shared-kernel';

function toMoney(val: unknown, currency: 'USD' = 'USD'): Money {
  return { amount: Math.round(Number(val ?? 0) * 100), currency };
}

export class AutoMateAdapter implements IDMSAdapter {
  getAdapterName(): string { return 'automate'; }
  getSupportedVersion(): string { return '4.x'; }

  normalise(raw: unknown): CanonicalDealPost {
    const data = raw as any;
    return {
      dealNumber: data.DealNo ?? data.dealNumber,
      dealDate: new Date(data.DealDate ?? data.dealDate),
      vehicleVin: data.VIN ?? data.vin,
      customerName: data.CustName ?? `${data.firstName} ${data.lastName}`,
      dealType: this.mapDealType(data.DealType ?? data.dealType),
      sourceSystem: DMSType.AUTOMATE,
      tenantId: asTenantId(data.tenantId ?? ''),
      oem: (data.OEM ?? 'OTHER').toUpperCase(),
      salePrice: toMoney(data.SalePrice ?? data.salePrice),
      costOfSale: toMoney(data.Cost ?? data.cost),
      grossProfit: toMoney((Number(data.SalePrice ?? data.salePrice ?? 0)) - (Number(data.Cost ?? data.cost ?? 0))),
      fiIncome: toMoney(data.FIIncome ?? data.fiIncome ?? 0),
      financeSources: (data.FinanceSources ?? data.financeSources ?? []).map((f: any) => ({
        name: f.Name ?? f.name, amount: Number(f.Amount ?? f.amount ?? 0),
      })),
      addOns: (data.AddOns ?? data.addOns ?? []).map((a: any) => ({
        description: a.Desc ?? a.description, price: Number(a.Price ?? a.price ?? 0), cost: Number(a.Cost ?? a.cost ?? 0),
      })),
      tradeIn: data.TradeIn ? {
        vin: data.TradeIn.VIN, allowance: Number(data.TradeIn.Allowance ?? 0), payoff: Number(data.TradeIn.Payoff ?? 0),
      } : undefined,
      journalLines: [],
    };
  }

  private mapDealType(type: string): 'NEW' | 'USED' | 'WHOLESALE' {
    const map: Record<string, 'NEW' | 'USED' | 'WHOLESALE'> = { N: 'NEW', U: 'USED', W: 'WHOLESALE', NEW: 'NEW', USED: 'USED', WHOLESALE: 'WHOLESALE' };
    return map[type?.toUpperCase()] ?? 'NEW';
  }
}

export class CDKAdapter implements IDMSAdapter {
  getAdapterName(): string { return 'cdk'; }
  getSupportedVersion(): string { return '3.x'; }

  normalise(raw: unknown): CanonicalDealPost {
    const data = raw as any;
    const sale = Number(data.amounts?.selling_price ?? 0);
    const cost = Number(data.amounts?.vehicle_cost ?? 0);
    return {
      dealNumber: data.deal_id?.toString() ?? '',
      dealDate: new Date(data.close_date ?? Date.now()),
      vehicleVin: data.vehicle?.vin ?? '',
      customerName: data.buyer?.full_name ?? '',
      dealType: data.vehicle?.condition === 'new' ? 'NEW' : 'USED',
      sourceSystem: DMSType.CDK,
      tenantId: asTenantId(data.tenantId ?? ''),
      oem: (data.vehicle?.make ?? 'OTHER').toUpperCase(),
      salePrice: toMoney(sale),
      costOfSale: toMoney(cost),
      grossProfit: toMoney(sale - cost),
      fiIncome: toMoney(data.fi_income ?? 0),
      financeSources: (data.finance_sources ?? []).map((f: any) => ({
        name: f.source_name, amount: Number(f.amount ?? 0),
      })),
      addOns: (data.aftermarket ?? []).map((a: any) => ({
        description: a.product_name, price: Number(a.retail_price ?? 0), cost: Number(a.dealer_cost ?? 0),
      })),
      tradeIn: data.trade ? {
        vin: data.trade.vin, allowance: Number(data.trade.allowance ?? 0), payoff: Number(data.trade.payoff_amount ?? 0),
      } : undefined,
      journalLines: [],
    };
  }
}

export class ReynoldsAdapter implements IDMSAdapter {
  getAdapterName(): string { return 'reynolds'; }
  getSupportedVersion(): string { return '2.x'; }

  normalise(raw: unknown): CanonicalDealPost {
    const data = raw as any;
    const sale = Number(data.Pricing?.SellingPrice ?? 0);
    const cost = Number(data.Pricing?.DealerCost ?? 0);
    return {
      dealNumber: data.DealNumber ?? '',
      dealDate: new Date(data.DealCloseDate ?? Date.now()),
      vehicleVin: data.Vehicle?.VIN ?? '',
      customerName: `${data.Customer?.LastName ?? ''}, ${data.Customer?.FirstName ?? ''}`,
      dealType: data.DealCategory === 'N' ? 'NEW' : data.DealCategory === 'U' ? 'USED' : 'WHOLESALE',
      sourceSystem: DMSType.REYNOLDS,
      tenantId: asTenantId(data.tenantId ?? ''),
      oem: (data.Vehicle?.Make ?? 'OTHER').toUpperCase(),
      salePrice: toMoney(sale),
      costOfSale: toMoney(cost),
      grossProfit: toMoney(sale - cost),
      fiIncome: toMoney(data.Pricing?.FIIncome ?? 0),
      financeSources: (data.FinanceSources ?? []).map((f: any) => ({
        name: f.SourceName, amount: Number(f.Amount ?? 0),
      })),
      addOns: (data.Accessories ?? []).map((a: any) => ({
        description: a.Description, price: Number(a.RetailPrice ?? 0), cost: Number(a.Cost ?? 0),
      })),
      tradeIn: data.TradeVehicle ? {
        vin: data.TradeVehicle.VIN, allowance: Number(data.TradeVehicle.Allowance ?? 0), payoff: Number(data.TradeVehicle.Payoff ?? 0),
      } : undefined,
      journalLines: [],
    };
  }
}

export class DealertrackAdapter implements IDMSAdapter {
  getAdapterName(): string { return 'dealertrack'; }
  getSupportedVersion(): string { return '5.x'; }

  normalise(raw: unknown): CanonicalDealPost {
    const data = raw as any;
    const sale = Number(data.deal?.selling_price ?? 0);
    const cost = Number(data.deal?.dealer_cost ?? 0);
    return {
      dealNumber: data.deal?.deal_number ?? '',
      dealDate: new Date(data.deal?.close_date ?? Date.now()),
      vehicleVin: data.vehicle?.vin ?? '',
      customerName: data.customer?.display_name ?? '',
      dealType: (data.deal?.type ?? 'NEW').toUpperCase() as 'NEW' | 'USED' | 'WHOLESALE',
      sourceSystem: DMSType.DEALERTRACK,
      tenantId: asTenantId(data.tenantId ?? ''),
      oem: (data.vehicle?.make ?? 'OTHER').toUpperCase(),
      salePrice: toMoney(sale),
      costOfSale: toMoney(cost),
      grossProfit: toMoney(sale - cost),
      fiIncome: toMoney(data.finance?.fi_income ?? 0),
      financeSources: (data.finance?.sources ?? []).map((f: any) => ({
        name: f.name, amount: Number(f.amount ?? 0),
      })),
      addOns: (data.aftermarket_products ?? []).map((a: any) => ({
        description: a.name, price: Number(a.price ?? 0), cost: Number(a.cost ?? 0),
      })),
      tradeIn: data.trade_in ? {
        vin: data.trade_in.vin, allowance: Number(data.trade_in.allowance ?? 0), payoff: Number(data.trade_in.payoff ?? 0),
      } : undefined,
      journalLines: [],
    };
  }
}
