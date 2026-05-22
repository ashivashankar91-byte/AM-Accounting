import { Decimal } from '@prisma/client/runtime/library';

/**
 * Resolves formula expressions like "LINE_101 - LINE_299 + LINE_305"
 * Supported operators: +, -, *, /
 * Operands: LINE_<number> references, numeric literals
 */
export function evaluateFormula(
  formula: string,
  lineValues: Map<string, Decimal>,
): Decimal {
  // Replace LINE_xxx references with their resolved numeric values
  const resolved = formula.replace(/LINE_([A-Z0-9]+)/g, (_match, lineNum: string) => {
    const val = lineValues.get(lineNum);
    return val !== undefined ? val.toFixed(2) : '0';
  });

  // Safe arithmetic evaluator — only allows digits, spaces, and operators
  if (!/^[\d\s.+\-*/()]+$/.test(resolved)) {
    throw new Error(`Unsafe formula expression after resolution: "${resolved}"`);
  }

  // eslint-disable-next-line no-eval
  const result: number = Function(`"use strict"; return (${resolved})`)() as number;

  if (!isFinite(result)) {
    throw new Error(`Formula "${formula}" evaluated to non-finite value`);
  }

  return new Decimal(result).toDecimalPlaces(2);
}

/**
 * Extract all LINE_xxx references from a formula string.
 */
export function extractLineRefs(formula: string): string[] {
  const matches = formula.match(/LINE_([A-Z0-9]+)/g) ?? [];
  return matches.map((m) => m.replace('LINE_', ''));
}
