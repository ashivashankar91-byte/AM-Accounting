// S019 — Strict JSON parser for the Posting DSL v1.
//
// `JSON.parse` silently accepts duplicate object keys (last write wins),
// which would let an activated rule pack hide a conflicting field behind a
// key that never surfaces in review. This is a small hand-rolled recursive-
// descent parser whose only behavioral difference from JSON.parse is that a
// duplicate key within the same object is a hard parse error. It is
// otherwise a strict subset (no comments, no trailing commas, no NaN/
// Infinity, no leading zeros) — pure and deterministic, no I/O.

export class StrictJsonParseError extends Error {
  constructor(message: string, readonly position: number) {
    super(`${message} (at position ${position})`);
    this.name = 'StrictJsonParseError';
  }
}

export function parseStrictJson(text: string): unknown {
  const parser = new Parser(text);
  const value = parser.parseValue();
  parser.skipWhitespace();
  if (parser.pos !== text.length) {
    throw new StrictJsonParseError('Unexpected trailing content after JSON value', parser.pos);
  }
  return value;
}

class Parser {
  pos = 0;
  constructor(private readonly text: string) {}

  // A plain method, not a getter: TypeScript applies control-flow narrowing
  // to getter reads (treating repeated `this.current()` accesses like a
  // stable `const`), which would incorrectly narrow this method's return
  // type to a single literal after the first equality check against it in
  // a given branch — breaking every subsequent comparison in this parser.
  private current(): string {
    return this.text[this.pos];
  }

  skipWhitespace(): void {
    while (this.pos < this.text.length && /[ \t\n\r]/.test(this.text[this.pos])) this.pos++;
  }

  private expect(ch: string): void {
    if (this.current() !== ch) {
      throw new StrictJsonParseError(`Expected '${ch}' but found '${this.current() ?? 'EOF'}'`, this.pos);
    }
    this.pos++;
  }

  parseValue(): unknown {
    this.skipWhitespace();
    const ch = this.current();
    if (ch === undefined) throw new StrictJsonParseError('Unexpected end of input', this.pos);
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"') return this.parseString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber();
    if (this.text.startsWith('true', this.pos)) { this.pos += 4; return true; }
    if (this.text.startsWith('false', this.pos)) { this.pos += 5; return false; }
    if (this.text.startsWith('null', this.pos)) { this.pos += 4; return null; }
    throw new StrictJsonParseError(`Unexpected token '${ch}'`, this.pos);
  }

  private parseObject(): Record<string, unknown> {
    this.expect('{');
    const obj: Record<string, unknown> = {};
    const seenKeys = new Set<string>();
    this.skipWhitespace();
    if (this.current() === '}') { this.pos++; return obj; }
    for (;;) {
      this.skipWhitespace();
      if (this.current() !== '"') {
        throw new StrictJsonParseError('Expected a quoted object key', this.pos);
      }
      const key = this.parseString();
      if (seenKeys.has(key)) {
        throw new StrictJsonParseError(`Duplicate object key "${key}"`, this.pos);
      }
      seenKeys.add(key);
      this.skipWhitespace();
      this.expect(':');
      const value = this.parseValue();
      obj[key] = value;
      this.skipWhitespace();
      if (this.current() === ',') { this.pos++; continue; }
      if (this.current() === '}') { this.pos++; break; }
      throw new StrictJsonParseError("Expected ',' or '}'", this.pos);
    }
    return obj;
  }

  private parseArray(): unknown[] {
    this.expect('[');
    const arr: unknown[] = [];
    this.skipWhitespace();
    if (this.current() === ']') { this.pos++; return arr; }
    for (;;) {
      arr.push(this.parseValue());
      this.skipWhitespace();
      if (this.current() === ',') { this.pos++; continue; }
      if (this.current() === ']') { this.pos++; break; }
      throw new StrictJsonParseError("Expected ',' or ']'", this.pos);
    }
    return arr;
  }

  private parseString(): string {
    this.expect('"');
    let out = '';
    for (;;) {
      const ch = this.current();
      if (ch === undefined) throw new StrictJsonParseError('Unterminated string', this.pos);
      if (ch === '"') { this.pos++; break; }
      if (ch === '\\') {
        this.pos++;
        const esc = this.current();
        switch (esc) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const hex = this.text.slice(this.pos + 1, this.pos + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new StrictJsonParseError('Invalid unicode escape', this.pos);
            out += String.fromCharCode(parseInt(hex, 16));
            this.pos += 4;
            break;
          }
          default:
            throw new StrictJsonParseError(`Invalid escape sequence '\\${esc}'`, this.pos);
        }
        this.pos++;
      } else if (ch.charCodeAt(0) < 0x20) {
        throw new StrictJsonParseError('Unescaped control character in string', this.pos);
      } else {
        out += ch;
        this.pos++;
      }
    }
    return out;
  }

  private parseNumber(): number {
    const start = this.pos;
    if (this.current() === '-') this.pos++;
    if (this.current() === '0') {
      this.pos++;
    } else if (this.current() >= '1' && this.current() <= '9') {
      while (this.current() >= '0' && this.current() <= '9') this.pos++;
    } else {
      throw new StrictJsonParseError('Invalid number', this.pos);
    }
    if (this.current() === '.') {
      this.pos++;
      if (!(this.current() >= '0' && this.current() <= '9')) throw new StrictJsonParseError('Invalid number fraction', this.pos);
      while (this.current() >= '0' && this.current() <= '9') this.pos++;
    }
    if (this.current() === 'e' || this.current() === 'E') {
      this.pos++;
      if (this.current() === '+' || this.current() === '-') this.pos++;
      if (!(this.current() >= '0' && this.current() <= '9')) throw new StrictJsonParseError('Invalid number exponent', this.pos);
      while (this.current() >= '0' && this.current() <= '9') this.pos++;
    }
    const raw = this.text.slice(start, this.pos);
    return Number(raw);
  }
}

/** Recursively freeze a parsed value so the internal AST cannot be mutated after parse/validate. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Canonical serialization: object keys sorted recursively, arrays preserve
 * order, no whitespace. Two structurally-equal values always serialize to
 * the same string regardless of original key order — this is what the
 * stable content hash is computed over.
 */
export function canonicalStringify(value: unknown): string {
  return stringifyCanonical(value);
}

function stringifyCanonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stringifyCanonical).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifyCanonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  throw new Error(`Cannot canonically serialize value of type ${typeof value}`);
}
