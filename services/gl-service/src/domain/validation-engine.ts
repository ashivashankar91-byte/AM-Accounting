import { IValidationRule, JournalEntry, TenantContext, ValidationResult } from '@amacc/shared-kernel';

export class GLValidationEngine {
  constructor(private readonly rules: IValidationRule<JournalEntry>[]) {}

  validate(entry: JournalEntry, context: TenantContext): ValidationResult[] {
    return this.rules.map((r) => r.validate(entry, context));
  }

  hasFailures(results: ValidationResult[]): boolean {
    return results.some((r) => !r.valid);
  }

  hasCritical(results: ValidationResult[]): boolean {
    return results.some((r) => !r.valid && r.severity === 'CRITICAL');
  }
}
