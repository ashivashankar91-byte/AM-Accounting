import { IDMSAdapter } from '@amacc/shared-kernel';

export class DMSAdapterRegistry {
  private adapters = new Map<string, IDMSAdapter>();

  register(name: string, adapter: IDMSAdapter): void {
    this.adapters.set(name.toLowerCase(), adapter);
  }

  get(name: string): IDMSAdapter {
    const adapter = this.adapters.get(name.toLowerCase());
    if (!adapter) {
      throw new Error(`Unknown DMS adapter: ${name}. Available: ${[...this.adapters.keys()].join(', ')}`);
    }
    return adapter;
  }

  getAll(): IDMSAdapter[] {
    return [...this.adapters.values()];
  }

  has(name: string): boolean {
    return this.adapters.has(name.toLowerCase());
  }
}
