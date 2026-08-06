import type { OemCanonicalRowType, OemParsedDocument, OemParsedRow, OemStagedKind } from '../adapter-spi';

/**
 * S099/S100 — shared tolerant-strict pipe-delimited parser used by both the
 * Ford and GM fixture adapters. Real per-make statement/remittance feed
 * formats are external, factory-published specifications (package "THE OEM
 * BOUNDARY": "statement-spec content ... versioned configuration/profile
 * data sourced from OEM documentation — never invented"); this fixture
 * format is a deterministic, labeled TEST_ONLY stand-in for certification,
 * not a claim about the real Ford/GM wire format.
 *
 * Format:
 *   HEADER|<MAKE>|<KIND>|<STATEMENT_ID>|<SPEC_VERSION>|<DEALER_CODE>
 *   <TAG>|<ref>|<amount>|<description>
 *   ...
 *
 * TAG one of REMIT/CHARGEBACK/INCENTIVE/RETURN/COOP maps to a canonical row
 * type. Any other TAG, or a malformed line (wrong field count), stages as
 * UNPARSED with the raw line preserved verbatim — never dropped, never
 * guessed (package S099/S100 AC: "zero silent loss").
 */

const TAG_TO_CANONICAL: Record<string, OemCanonicalRowType> = {
  REMIT: 'RECEIVABLE_REMITTANCE',
  CHARGEBACK: 'CHARGEBACK_LINE',
  INCENTIVE: 'INCENTIVE_LINE',
  RETURN: 'PARTS_RETURN_CREDIT',
  COOP: 'COOP_LINE',
};

const KIND_VALUES: OemStagedKind[] = [
  'REMITTANCE', 'CHARGEBACK_NOTICE', 'INCENTIVE_STATEMENT', 'PARTS_RETURN_CREDIT', 'COOP_STATEMENT', 'OTHER',
];

export function parsePipeFormat(make: string, rawContent: string): OemParsedDocument {
  const lines = rawContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error('empty feed content');
  }

  const headerParts = lines[0].split('|');
  if (headerParts[0] !== 'HEADER' || headerParts.length < 6) {
    throw new Error(`unrecognized header line for ${make} feed: "${lines[0]}"`);
  }
  const [, feedMake, kindRaw, statementId, specVersion, dealerCode] = headerParts;
  const kind: OemStagedKind = (KIND_VALUES as string[]).includes(kindRaw) ? (kindRaw as OemStagedKind) : 'OTHER';

  const rows: OemParsedRow[] = lines.slice(1).map((line, idx) => {
    const parts = line.split('|');
    const tag = parts[0];
    const canonicalType = TAG_TO_CANONICAL[tag] ?? null;
    if (!canonicalType || parts.length < 4) {
      return {
        rowIndex: idx,
        parseStatus: 'UNPARSED',
        canonicalType: null,
        fields: { rawFragments: parts },
        rawLine: line,
      };
    }
    const [, ref, amount, ...descParts] = parts;
    return {
      rowIndex: idx,
      parseStatus: 'PARSED',
      canonicalType,
      fields: { ref, amount, description: descParts.join('|') },
      rawLine: line,
    };
  });

  return {
    naturalKey: `${feedMake.toUpperCase()}:${statementId}:${dealerCode}`,
    kind,
    specVersion,
    rows,
  };
}
