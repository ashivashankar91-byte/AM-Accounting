import type { OemFeedAdapter, OemParsedDocument } from '../adapter-spi';
import { parsePipeFormat } from './pipe-format';

/**
 * S100 — GM feed adapter, concrete on the S098 SPI. TEST_ONLY until
 * certification evidence is recorded against a real GM feed (package
 * "THE OEM BOUNDARY").
 */
export class GmAdapter implements OemFeedAdapter {
  readonly make = 'GM';
  readonly adapterVersion = '1.0.0-fixture';

  parse(rawContent: string): OemParsedDocument {
    return parsePipeFormat('GM', rawContent);
  }
}
