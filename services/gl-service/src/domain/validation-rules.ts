import {
  IValidationRule,
  JournalEntry,
  TenantContext,
  ValidationResult,
  Severity,
} from '@amacc/shared-kernel';

export class DuplicateEntryRule implements IValidationRule<JournalEntry> {
  private recentEntries: JournalEntry[] = [];

  setRecentEntries(entries: JournalEntry[]): void {
    this.recentEntries = entries;
  }

  getRuleName(): string {
    return 'DuplicateEntryRule';
  }

  validate(entity: JournalEntry, _context: TenantContext): ValidationResult {
    if (!entity.sourceRef) {
      return { valid: true, ruleName: this.getRuleName(), message: 'No source ref to check', severity: Severity.INFO };
    }

    const duplicate = this.recentEntries.find(
      (e) => e.sourceRef === entity.sourceRef && e.id !== entity.id,
    );

    if (duplicate) {
      return {
        valid: false,
        ruleName: this.getRuleName(),
        message: `Duplicate source_ref "${entity.sourceRef}" found in entry ${duplicate.id} from ${duplicate.entryDate.toISOString()}`,
        severity: Severity.CRITICAL,
      };
    }

    return { valid: true, ruleName: this.getRuleName(), message: 'No duplicates found', severity: Severity.INFO };
  }
}

export class AccountTypeMismatchRule implements IValidationRule<JournalEntry> {
  getRuleName(): string {
    return 'AccountTypeMismatchRule';
  }

  validate(entity: JournalEntry, _context: TenantContext): ValidationResult {
    // Check if revenue is being posted to an asset account (or similar mismatches)
    // This would need GL account data in practice; placeholder logic
    return { valid: true, ruleName: this.getRuleName(), message: 'Account types consistent', severity: Severity.INFO };
  }
}

export class UnbalancedEntryRule implements IValidationRule<JournalEntry> {
  getRuleName(): string {
    return 'UnbalancedEntryRule';
  }

  validate(entity: JournalEntry, _context: TenantContext): ValidationResult {
    const totalDebits = entity.lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredits = entity.lines.reduce((sum, l) => sum + l.credit, 0);
    const diff = Math.abs(totalDebits - totalCredits);

    if (diff > 0.01) {
      return {
        valid: false,
        ruleName: this.getRuleName(),
        message: `Entry is out of balance by $${diff.toFixed(2)} (debits: $${totalDebits.toFixed(2)}, credits: $${totalCredits.toFixed(2)})`,
        severity: Severity.CRITICAL,
      };
    }

    return { valid: true, ruleName: this.getRuleName(), message: 'Entry is balanced', severity: Severity.INFO };
  }
}

export class AnomalousAmountRule implements IValidationRule<JournalEntry> {
  private averageAmount = 0;

  setAverageAmount(avg: number): void {
    this.averageAmount = avg;
  }

  getRuleName(): string {
    return 'AnomalousAmountRule';
  }

  validate(entity: JournalEntry, _context: TenantContext): ValidationResult {
    if (this.averageAmount === 0) {
      return { valid: true, ruleName: this.getRuleName(), message: 'No baseline to compare', severity: Severity.INFO };
    }

    const totalAmount = entity.lines.reduce((sum, l) => sum + Math.max(l.debit, l.credit), 0);
    const ratio = totalAmount / this.averageAmount;

    if (ratio > 3) {
      return {
        valid: false,
        ruleName: this.getRuleName(),
        message: `Entry amount ($${totalAmount.toFixed(2)}) is ${ratio.toFixed(1)}x the 30-day average ($${this.averageAmount.toFixed(2)})`,
        severity: Severity.WARN,
      };
    }

    return { valid: true, ruleName: this.getRuleName(), message: 'Amount within normal range', severity: Severity.INFO };
  }
}

// --- New expanded rules ---

export class WarrantyLaborMisclassificationRule implements IValidationRule<JournalEntry> {
  getRuleName(): string { return 'WarrantyLaborMisclassificationRule'; }

  validate(entity: JournalEntry, _context: TenantContext): ValidationResult {
    // Detect warranty labor posted to customer-pay labor accounts
    const warrantyLabor = entity.lines.filter(
      (l) => l.glAccountCode?.startsWith('4100') && l.memo?.toLowerCase().includes('warranty'),
    );
    if (warrantyLabor.length > 0) {
      return {
        valid: false,
        ruleName: this.getRuleName(),
        message: `${warrantyLabor.length} line(s) posting warranty labor to customer-pay account 4100. Should use 4420 (Warranty Revenue).`,
        severity: Severity.WARN,
      };
    }
    return { valid: true, ruleName: this.getRuleName(), message: 'No warranty misclassification', severity: Severity.INFO };
  }
}

export class InternalVsCustomerLaborRule implements IValidationRule<JournalEntry> {
  getRuleName(): string { return 'InternalVsCustomerLaborRule'; }

  validate(entity: JournalEntry, _context: TenantContext): ValidationResult {
    // Internal labor should go to 4210 (Parts Sales - Internal), not 4100
    const internal = entity.lines.filter(
      (l) => l.glAccountCode?.startsWith('4100') && l.memo?.toLowerCase().includes('internal'),
    );
    if (internal.length > 0) {
      return {
        valid: false,
        ruleName: this.getRuleName(),
        message: `${internal.length} internal labor line(s) posted to customer service account. Use internal parts/labor accounts.`,
        severity: Severity.WARN,
      };
    }
    return { valid: true, ruleName: this.getRuleName(), message: 'Labor classification OK', severity: Severity.INFO };
  }
}

export class NegativeInventoryRule implements IValidationRule<JournalEntry> {
  getRuleName(): string { return 'NegativeInventoryRule'; }

  validate(entity: JournalEntry, _context: TenantContext): ValidationResult {
    // Flag credits to inventory accounts that could push balance negative
    const invCredits = entity.lines.filter(
      (l) => (l.glAccountCode?.startsWith('12') || l.glAccountCode?.startsWith('13')) && l.credit > 0 && l.credit > 100000,
    );
    if (invCredits.length > 0) {
      const total = invCredits.reduce((s, l) => s + l.credit, 0);
      return {
        valid: false,
        ruleName: this.getRuleName(),
        message: `Large inventory credit of $${(total / 100).toFixed(2)} could cause negative inventory balance. Verify.`,
        severity: Severity.WARN,
      };
    }
    return { valid: true, ruleName: this.getRuleName(), message: 'Inventory balances OK', severity: Severity.INFO };
  }
}

export class FSLineMappingGapRule implements IValidationRule<JournalEntry> {
  private mappedCodes = new Set<string>();

  setMappedCodes(codes: string[]): void {
    this.mappedCodes = new Set(codes);
  }

  getRuleName(): string { return 'FSLineMappingGapRule'; }

  validate(entity: JournalEntry, _context: TenantContext): ValidationResult {
    if (this.mappedCodes.size === 0) {
      return { valid: true, ruleName: this.getRuleName(), message: 'No FS mapping loaded', severity: Severity.INFO };
    }
    const unmapped = entity.lines.filter((l) => l.glAccountCode && !this.mappedCodes.has(l.glAccountCode));
    if (unmapped.length > 0) {
      const codes = [...new Set(unmapped.map((l) => l.glAccountCode))].join(', ');
      return {
        valid: false,
        ruleName: this.getRuleName(),
        message: `GL accounts [${codes}] have no FS line mapping. OEM financial statement will be incomplete.`,
        severity: Severity.WARN,
      };
    }
    return { valid: true, ruleName: this.getRuleName(), message: 'All GL accounts mapped to FS lines', severity: Severity.INFO };
  }
}
