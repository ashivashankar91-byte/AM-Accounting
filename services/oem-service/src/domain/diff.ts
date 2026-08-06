/**
 * S098 — field-level diff between a re-delivered/updated document and its
 * staged predecessor (package line 16: "amounts, line counts, spec
 * version"). Pure function so it is trivially unit-testable without a
 * database.
 */

export interface FieldDiff {
  path: string; // e.g. "specVersion" or "row[3].amount"
  before: unknown;
  after: unknown;
}

export interface DiffableDocument {
  specVersion: string | null;
  rowCount: number;
  rows: Array<{ rowIndex: number; fields: Record<string, unknown> }>;
}

export function computeDocumentDiff(prior: DiffableDocument, next: DiffableDocument): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  if (prior.specVersion !== next.specVersion) {
    diffs.push({ path: 'specVersion', before: prior.specVersion, after: next.specVersion });
  }
  if (prior.rowCount !== next.rowCount) {
    diffs.push({ path: 'rowCount', before: prior.rowCount, after: next.rowCount });
  }

  const priorByIndex = new Map(prior.rows.map((r) => [r.rowIndex, r.fields]));
  const nextByIndex = new Map(next.rows.map((r) => [r.rowIndex, r.fields]));
  const allIndexes = new Set([...priorByIndex.keys(), ...nextByIndex.keys()]);

  for (const idx of Array.from(allIndexes).sort((a, b) => a - b)) {
    const priorFields = priorByIndex.get(idx);
    const nextFields = nextByIndex.get(idx);
    if (priorFields === undefined) {
      diffs.push({ path: `row[${idx}]`, before: null, after: nextFields });
      continue;
    }
    if (nextFields === undefined) {
      diffs.push({ path: `row[${idx}]`, before: priorFields, after: null });
      continue;
    }
    const keys = new Set([...Object.keys(priorFields), ...Object.keys(nextFields)]);
    for (const key of keys) {
      const a = priorFields[key];
      const b = nextFields[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        diffs.push({ path: `row[${idx}].${key}`, before: a ?? null, after: b ?? null });
      }
    }
  }

  return diffs;
}
