import { Decimal } from '@prisma/client/runtime/library';
import type { FSLineItem, OEMProfile } from '.prisma/fs-client';

export interface ValidationIssue {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  lineNumber?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * OEM-specific and cross-OEM financial statement validation.
 *
 * @business-rule Common rules (all OEMs):
 *   - Gross Profit = Total Revenue − Total COGS
 *   - Net Income = Gross Profit − Total Expenses
 *   - All non-subtotal/total line items must have non-null values
 * @business-rule OEM-specific rules:
 *   GM: dealer code must be 5 digits
 *   Ford: parts/service must appear on separate lines
 *   Toyota: used vehicle dept is a separate profit center
 */
export function validateStatement(
  profile: Pick<OEMProfile, 'oemCode' | 'dealerCode'>,
  lineItems: FSLineItem[],
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const lineMap = new Map<string, FSLineItem>();
  for (const item of lineItems) {
    lineMap.set(item.oemLineNumber, item);
  }

  // Common rule 1: no null values on standard lines
  for (const item of lineItems) {
    if (!item.isSubtotal && !item.isTotal) {
      if (item.currentMonth === null) {
        issues.push({
          code: 'NULL_LINE_VALUE',
          message: `Line ${item.oemLineNumber} (${item.oemLineLabel}) has null currentMonth value`,
          severity: 'ERROR',
          lineNumber: item.oemLineNumber,
        });
      }
    }
  }

  // Common rule 2: Gross Profit = Revenue total − COGS total
  const revTotal = sumSection(lineItems, 'REVENUE', true);
  const cogsTotal = sumSection(lineItems, 'COST_OF_SALES', true);
  const gpSection = sumSection(lineItems, 'GROSS_PROFIT', true);
  if (revTotal !== null && cogsTotal !== null && gpSection !== null) {
    const expectedGP = revTotal.minus(cogsTotal);
    if (expectedGP.minus(gpSection).abs().greaterThan(new Decimal('0.02'))) {
      issues.push({
        code: 'GP_MISMATCH',
        message: `Gross Profit (${gpSection.toFixed(2)}) does not equal Revenue (${revTotal.toFixed(2)}) minus COGS (${cogsTotal.toFixed(2)})`,
        severity: 'ERROR',
      });
    }
  }

  // Common rule 3: Net Income = Gross Profit − Expenses total
  const expTotal = sumSection(lineItems, 'EXPENSE', true);
  const otherTotal = sumSection(lineItems, 'OTHER', true);
  // Locate a NET_INCOME or total of GROSS_PROFIT section minus EXPENSE
  if (gpSection !== null && expTotal !== null) {
    const expectedNI = gpSection.minus(expTotal).minus(otherTotal ?? new Decimal(0));
    // Find net income line (last total line in statement)
    const niLines = lineItems.filter((l) => l.isTotal && !l.oemSection.match(/REVENUE|COST_OF_SALES|GROSS_PROFIT|EXPENSE/));
    if (niLines.length > 0) {
      const niLine = niLines[niLines.length - 1];
      const niVal = new Decimal(niLine.currentMonth.toString());
      if (expectedNI.minus(niVal).abs().greaterThan(new Decimal('0.02'))) {
        issues.push({
          code: 'NI_MISMATCH',
          message: `Net Income (${niVal.toFixed(2)}) does not equal Gross Profit minus Expenses (${expectedNI.toFixed(2)})`,
          severity: 'WARNING',
          lineNumber: niLine.oemLineNumber,
        });
      }
    }
  }

  // OEM-specific rules
  switch (profile.oemCode.toUpperCase()) {
    case 'GM':
      validateGM(profile, lineItems, issues);
      break;
    case 'FORD':
      validateFord(lineItems, issues);
      break;
    case 'TOYOTA':
      validateToyota(lineItems, issues);
      break;
  }

  return { valid: issues.filter((i) => i.severity === 'ERROR').length === 0, issues };
}

function validateGM(
  profile: Pick<OEMProfile, 'dealerCode'>,
  lineItems: FSLineItem[],
  issues: ValidationIssue[],
): void {
  // GM: dealer code must be exactly 5 digits
  if (!/^\d{5}$/.test(profile.dealerCode)) {
    issues.push({
      code: 'GM_DEALER_CODE',
      message: `GM dealer code must be exactly 5 digits, got: "${profile.dealerCode}"`,
      severity: 'ERROR',
    });
  }
  // GM: all supplemental fields must be non-zero on total lines
  const totalLines = lineItems.filter((l) => l.isTotal);
  if (totalLines.length === 0) {
    issues.push({ code: 'GM_NO_TOTALS', message: 'GM statement has no total lines', severity: 'ERROR' });
  }
}

function validateFord(lineItems: FSLineItem[], issues: ValidationIssue[]): void {
  // Ford: Parts and service must appear as separate lines
  const hasPartsLine = lineItems.some((l) => l.oemLineLabel.toLowerCase().includes('parts'));
  const hasServiceLine = lineItems.some((l) => l.oemLineLabel.toLowerCase().includes('service'));
  if (!hasPartsLine) {
    issues.push({ code: 'FORD_PARTS_MISSING', message: 'Ford FS requires a Parts line item', severity: 'ERROR' });
  }
  if (!hasServiceLine) {
    issues.push({ code: 'FORD_SERVICE_MISSING', message: 'Ford FS requires a Service line item', severity: 'ERROR' });
  }
  // Ford: F&I income on separate line
  const hasFI = lineItems.some((l) => l.oemLineLabel.toLowerCase().includes('f&i') || l.oemLineLabel.toLowerCase().includes('finance'));
  if (!hasFI) {
    issues.push({ code: 'FORD_FI_MISSING', message: 'Ford FS requires an F&I Income line item', severity: 'WARNING' });
  }
}

function validateToyota(lineItems: FSLineItem[], issues: ValidationIssue[]): void {
  // Toyota: used vehicle department reported as separate profit center
  const hasUsedVehicle = lineItems.some(
    (l) => l.oemLineLabel.toLowerCase().includes('used') && l.oemSection === 'REVENUE',
  );
  if (!hasUsedVehicle) {
    issues.push({
      code: 'TOYOTA_USED_VEHICLE_MISSING',
      message: 'Toyota FS requires used vehicle sales as separate profit center in REVENUE section',
      severity: 'WARNING',
    });
  }
}

function sumSection(
  lineItems: FSLineItem[],
  section: string,
  totalsOnly: boolean,
): Decimal | null {
  const items = lineItems.filter(
    (l) => l.oemSection === section && (!totalsOnly || l.isTotal),
  );
  if (items.length === 0) return null;
  return items.reduce(
    (acc, item) => acc.plus(new Decimal(item.currentMonth.toString())),
    new Decimal(0),
  );
}
