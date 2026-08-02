import { PayrollSourceAdapter } from '../payroll-adapter-contract';
import { NullPayrollSource } from './null-source';
import { AttestedManualSource } from './attested-manual-source';
import { TestFixturePayrollSource } from './test-fixture-source';

export type PayrollSourceMode = 'NOT_CONFIGURED' | 'MANUAL_ATTESTED' | 'TEST_FIXTURE';

/**
 * Resolves the PayrollSourceAdapter for a tenant's configured payrollSourceMode
 * (stored on PayrollTenantConfig, additive table). Unknown/absent mode
 * resolves to NullPayrollSource — the truthful default — never throws and
 * never silently picks a "best guess" source. Mirrors CE-10's EngineRegistry.
 *
 * No production payroll-provider vendor is implemented by this package.
 * Extending this registry with a real vendor's PayrollSourceAdapter
 * implementation is the only change required to convert a NullPayrollSource
 * tenant to a certified production feed once vendor selection completes.
 */
export class PayrollSourceRegistry {
  private readonly nullSource = new NullPayrollSource();
  private readonly attestedManualSource = new AttestedManualSource();
  private readonly testFixtureSource = new TestFixturePayrollSource();

  resolve(mode: PayrollSourceMode | string | null | undefined): PayrollSourceAdapter {
    switch (mode) {
      case 'TEST_FIXTURE':
        return this.testFixtureSource;
      case 'MANUAL_ATTESTED':
        return this.attestedManualSource;
      case 'NOT_CONFIGURED':
      case null:
      case undefined:
      default:
        return this.nullSource;
    }
  }
}
