import type { OemFeedAdapter, OemParsedDocument } from '../adapter-spi';
import { parsePipeFormat } from './pipe-format';

/**
 * S099 — Ford feed adapter, concrete on the S098 SPI. TEST_ONLY until
 * certification evidence is recorded against a real Ford feed (package
 * "THE OEM BOUNDARY").
 */
export class FordAdapter implements OemFeedAdapter {
  readonly make = 'FORD';
  readonly adapterVersion = '1.0.0-fixture';

  parse(rawContent: string): OemParsedDocument {
    return parsePipeFormat('FORD', rawContent);
  }
}
