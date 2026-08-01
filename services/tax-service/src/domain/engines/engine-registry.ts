import { TaxEngineAdapter } from '../tax-adapter-contract';
import { NullEngine } from './null-engine';
import { TestFixtureEngine } from './test-fixture-engine';

/**
 * Resolves the TaxEngineAdapter implementation for an engineType string
 * (as stored on TaxEngineConfig, effective-dated). Unknown/absent
 * engineType resolves to NullEngine — the truthful default — never throws
 * and never silently picks a "best guess" engine.
 *
 * No production vendor is implemented by this package — see README.md.
 * Extending this registry with a real vendor's TaxEngineAdapter
 * implementation is the only change required to convert a NullEngine
 * tenant to production calculation once vendor selection/certification
 * completes (per the epic's final verdict).
 */
export class EngineRegistry {
  private readonly nullEngine = new NullEngine();
  private readonly testFixtureEngine = new TestFixtureEngine();

  resolve(engineType: string | null | undefined): TaxEngineAdapter {
    switch (engineType) {
      case 'TEST_FIXTURE_ENGINE':
        return this.testFixtureEngine;
      case 'NULL_ENGINE':
      case null:
      case undefined:
      default:
        return this.nullEngine;
    }
  }
}
