import { Decimal } from '@prisma/client/runtime/library';

export type KpiFormulaOperand = { type: 'account'; code: string } | { type: 'constant'; value: number } | { type: 'formula'; ref: string };
export type KpiFormulaOp = 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'DIVIDE' | 'RATIO';

export interface KpiFormulaDefinition {
  op: KpiFormulaOp;
  operands: KpiFormulaOperand[];
}

export function evaluateFormula(def: KpiFormulaDefinition, accountBalances: Record<string, Decimal>, resolvedFormulas: Record<string, Decimal>): Decimal {
  const resolve = (op: KpiFormulaOperand): Decimal => {
    if (op.type === 'account') return accountBalances[op.code] ?? new Decimal(0);
    if (op.type === 'constant') return new Decimal(op.value);
    return resolvedFormulas[op.ref] ?? new Decimal(0);
  };
  const values = def.operands.map(resolve);
  if (values.length === 0) return new Decimal(0);
  switch (def.op) {
    case 'ADD': return values.reduce((a, b) => a.plus(b), new Decimal(0));
    case 'SUBTRACT': return values.slice(1).reduce((a, b) => a.minus(b), values[0]);
    case 'MULTIPLY': return values.reduce((a, b) => a.mul(b), new Decimal(1));
    case 'DIVIDE': return values.length >= 2 && !values[1].isZero() ? values[0].div(values[1]) : new Decimal(0);
    case 'RATIO': return values.length >= 2 && !values[1].isZero() ? values[0].div(values[1]).mul(100) : new Decimal(0);
    default: return new Decimal(0);
  }
}
