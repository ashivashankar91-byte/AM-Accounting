// S020 — Pure, deterministic evaluator for the DSL v1 condition grammar.
// No I/O, no time/random functions — every operator resolves only against
// the already-loaded event envelope.

import { ConditionExpr, JsonPrimitive } from './dsl';
import { SourceEventEnvelope, resolveEnvelopePath } from './event-envelope';

export class UnknownConditionOperatorError extends Error {
  constructor(readonly operator: string) {
    super(`Unknown or unsupported condition operator: ${operator}`);
    this.name = 'UnknownConditionOperatorError';
  }
}

function primitiveEquals(a: unknown, b: JsonPrimitive): boolean {
  return a === b;
}

function asComparable(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function evaluateCondition(expr: ConditionExpr, envelope: SourceEventEnvelope): boolean {
  const keys = Object.keys(expr);
  if (keys.length !== 1) {
    throw new UnknownConditionOperatorError(keys.join(','));
  }
  const op = keys[0];

  switch (op) {
    case 'and': {
      const clauses = (expr as { and: ConditionExpr[] }).and;
      return clauses.every((c) => evaluateCondition(c, envelope));
    }
    case 'or': {
      const clauses = (expr as { or: ConditionExpr[] }).or;
      return clauses.some((c) => evaluateCondition(c, envelope));
    }
    case 'not': {
      const clause = (expr as { not: ConditionExpr }).not;
      return !evaluateCondition(clause, envelope);
    }
    case 'equals': {
      const { path, value } = (expr as { equals: { path: string; value: JsonPrimitive } }).equals;
      return primitiveEquals(resolveEnvelopePath(envelope, path), value);
    }
    case 'notEquals': {
      const { path, value } = (expr as { notEquals: { path: string; value: JsonPrimitive } }).notEquals;
      return !primitiveEquals(resolveEnvelopePath(envelope, path), value);
    }
    case 'greaterThan': {
      const { path, value } = (expr as { greaterThan: { path: string; value: number } }).greaterThan;
      const v = asComparable(resolveEnvelopePath(envelope, path));
      return v !== null && v > value;
    }
    case 'greaterThanOrEqual': {
      const { path, value } = (expr as { greaterThanOrEqual: { path: string; value: number } }).greaterThanOrEqual;
      const v = asComparable(resolveEnvelopePath(envelope, path));
      return v !== null && v >= value;
    }
    case 'lessThan': {
      const { path, value } = (expr as { lessThan: { path: string; value: number } }).lessThan;
      const v = asComparable(resolveEnvelopePath(envelope, path));
      return v !== null && v < value;
    }
    case 'lessThanOrEqual': {
      const { path, value } = (expr as { lessThanOrEqual: { path: string; value: number } }).lessThanOrEqual;
      const v = asComparable(resolveEnvelopePath(envelope, path));
      return v !== null && v <= value;
    }
    case 'in': {
      const { path, values } = (expr as { in: { path: string; values: JsonPrimitive[] } }).in;
      const v = resolveEnvelopePath(envelope, path);
      return values.some((candidate) => primitiveEquals(v, candidate));
    }
    case 'notIn': {
      const { path, values } = (expr as { notIn: { path: string; values: JsonPrimitive[] } }).notIn;
      const v = resolveEnvelopePath(envelope, path);
      return !values.some((candidate) => primitiveEquals(v, candidate));
    }
    case 'exists': {
      const { path } = (expr as { exists: { path: string } }).exists;
      return resolveEnvelopePath(envelope, path) !== undefined;
    }
    case 'isNull': {
      const { path } = (expr as { isNull: { path: string } }).isNull;
      return resolveEnvelopePath(envelope, path) === null;
    }
    case 'isNotNull': {
      const { path } = (expr as { isNotNull: { path: string } }).isNotNull;
      return resolveEnvelopePath(envelope, path) !== null && resolveEnvelopePath(envelope, path) !== undefined;
    }
    default:
      throw new UnknownConditionOperatorError(op);
  }
}
