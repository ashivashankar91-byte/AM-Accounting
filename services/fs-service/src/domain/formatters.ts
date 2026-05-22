import {
  IFSFormatter,
  TrialBalance,
  TenantContext,
  FSDocument,
  FSValidationResult,
  FSLine,
  FSPage,
  OEMType,
  Severity,
  money,
} from '@amacc/shared-kernel';

// Open/Closed: new OEM = new formatter class, zero changes to existing code

export class GMFSFormatter implements IFSFormatter {
  getOEM(): OEMType { return 'GM'; }

  format(trialBalance: TrialBalance, ctx: TenantContext): FSDocument {
    const lines: FSLine[] = trialBalance.accounts.map((row, i) => ({
      lineNumber: i + 1,
      accountCode: row.accountCode,
      label: row.accountName,
      amount: money(Math.round((row.debit - row.credit) * 100)),
      pageNumber: this.getPageForType(row.accountType),
    }));

    const pages = this.groupPages(lines);
    const totalAssets = this.sumByPage(lines, 1);
    const totalLiabilities = this.sumByPage(lines, 2);

    return {
      oem: 'GM',
      tenantId: ctx.tenantId,
      period: trialBalance.period,
      dealerCode: '',
      pages,
      lines,
      agentAnnotations: [],
      submissionStatus: 'DRAFT',
      totalAssets: money(totalAssets),
      totalLiabilities: money(totalLiabilities),
      netWorth: money(totalAssets - totalLiabilities),
      netProfit: money(this.sumByPage(lines, 4) - this.sumByPage(lines, 5) - this.sumByPage(lines, 6)),
    };
  }

  validateBeforeSubmission(doc: FSDocument): FSValidationResult[] {
    const results: FSValidationResult[] = [];
    // Assets must equal Liabilities + Net Worth
    const diff = doc.totalAssets.amount - (doc.totalLiabilities.amount + doc.netWorth.amount);
    if (Math.abs(diff) > 1) {
      results.push({ lineNumber: 0, accountCode: 'BALANCE', message: `Balance sheet out of balance by $${(diff / 100).toFixed(2)}`, severity: Severity.CRITICAL });
    }
    // Required lines
    for (const line of doc.lines) {
      if (line.amount.amount === 0) {
        results.push({ lineNumber: line.lineNumber, accountCode: line.accountCode, message: `Line ${line.lineNumber} has zero amount`, severity: Severity.WARN });
      }
    }
    return results;
  }

  private getPageForType(type: string): number {
    switch (type) {
      case 'ASSET': return 1;
      case 'LIABILITY': return 2;
      case 'EQUITY': return 3;
      case 'REVENUE': return 4;
      case 'COST_OF_SALES': return 5;
      case 'EXPENSE': return 6;
      default: return 7;
    }
  }

  private groupPages(lines: FSLine[]): FSPage[] {
    const pageMap = new Map<number, FSLine[]>();
    for (const line of lines) {
      const existing = pageMap.get(line.pageNumber) ?? [];
      existing.push(line);
      pageMap.set(line.pageNumber, existing);
    }
    const titles = ['', 'Assets', 'Liabilities', 'Net Worth', 'Revenue', 'Cost of Sales', 'Expenses', 'Other'];
    return [...pageMap.entries()].map(([num, lines]) => ({
      pageNumber: num,
      title: titles[num] ?? `Page ${num}`,
      lines,
    }));
  }

  private sumByPage(lines: FSLine[], page: number): number {
    return lines.filter((l) => l.pageNumber === page).reduce((s, l) => s + l.amount.amount, 0);
  }
}

export class FordFSFormatter implements IFSFormatter {
  getOEM(): OEMType { return 'FORD'; }

  format(trialBalance: TrialBalance, ctx: TenantContext): FSDocument {
    // Ford OWS format is structurally similar but uses different codes
    const lines: FSLine[] = trialBalance.accounts.map((row, i) => ({
      lineNumber: i + 1,
      accountCode: row.accountCode,
      label: row.accountName,
      amount: money(Math.round((row.debit - row.credit) * 100)),
      pageNumber: 1,
    }));

    const total = lines.reduce((s, l) => s + l.amount.amount, 0);

    return {
      oem: 'FORD',
      tenantId: ctx.tenantId,
      period: trialBalance.period,
      dealerCode: '',
      pages: [{ pageNumber: 1, title: 'Ford OWS', lines }],
      lines,
      agentAnnotations: [],
      submissionStatus: 'DRAFT',
      totalAssets: money(Math.abs(total)),
      totalLiabilities: money(0),
      netWorth: money(total),
      netProfit: money(0),
    };
  }

  validateBeforeSubmission(doc: FSDocument): FSValidationResult[] {
    return [];
  }
}

export class FSFormatterRegistry {
  private formatters = new Map<string, IFSFormatter>();

  register(formatter: IFSFormatter): void {
    this.formatters.set(formatter.getOEM(), formatter);
  }

  get(oem: OEMType): IFSFormatter {
    const f = this.formatters.get(oem);
    if (!f) throw new Error(`No FS formatter for OEM: ${oem}`);
    return f;
  }
}
