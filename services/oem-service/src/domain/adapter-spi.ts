/**
 * S098 — OEM Adapter Framework SPI. A concrete make adapter (S099 Ford,
 * S100 GM, future Pass-2 makes under S102) implements `parse`: raw feed/
 * file content in, canonical staged rows out. Tolerant-strict per package
 * line 18: an unrecognized segment is staged with parseStatus=UNPARSED
 * (never dropped, never guessed at) so S098's "zero silent loss" AC holds
 * for every adapter built on this SPI.
 */

export type OemCanonicalRowType =
  | 'RECEIVABLE_REMITTANCE'
  | 'CHARGEBACK_LINE'
  | 'INCENTIVE_LINE'
  | 'PARTS_RETURN_CREDIT'
  | 'COOP_LINE';

export interface OemParsedRow {
  rowIndex: number;
  parseStatus: 'PARSED' | 'UNPARSED';
  canonicalType: OemCanonicalRowType | null;
  fields: Record<string, unknown>;
  rawLine: string;
}

export type OemStagedKind =
  | 'REMITTANCE'
  | 'CHARGEBACK_NOTICE'
  | 'INCENTIVE_STATEMENT'
  | 'PARTS_RETURN_CREDIT'
  | 'COOP_STATEMENT'
  | 'OTHER';

export interface OemParsedDocument {
  /** Natural document key (statement id/date/dealer code) — used to build
   * the dedupe identity; NOT a hash of raw bytes (see schema.prisma comment
   * on OemStagedDocument.documentIdentity). */
  naturalKey: string;
  kind: OemStagedKind;
  specVersion: string;
  rows: OemParsedRow[];
}

export interface OemFeedAdapter {
  readonly make: string;
  readonly adapterVersion: string;
  parse(rawContent: string): OemParsedDocument;
}

export class OemAdapterRegistry {
  private readonly adapters = new Map<string, OemFeedAdapter>();

  register(adapter: OemFeedAdapter): void {
    this.adapters.set(adapter.make.toUpperCase(), adapter);
  }

  get(make: string): OemFeedAdapter | undefined {
    return this.adapters.get(make.toUpperCase());
  }

  has(make: string): boolean {
    return this.adapters.has(make.toUpperCase());
  }

  getAll(): OemFeedAdapter[] {
    return Array.from(this.adapters.values());
  }
}
