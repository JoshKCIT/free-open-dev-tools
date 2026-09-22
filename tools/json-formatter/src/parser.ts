/**
 * A JSON reader that reports what `JSON.parse` throws away.
 *
 * The built-in parser silently keeps the last of a set of duplicate keys, and
 * silently rounds any number that does not fit a double. Both are real sources
 * of data loss, so this parser records them and hands them back alongside the
 * value.
 */

export interface Position {
  line: number;
  column: number;
  offset: number;
}

export interface JsonError extends Position {
  message: string;
  path: string;
}

export interface DuplicateKey extends Position {
  path: string;
  key: string;
  /** How many times the key appeared in the same object. */
  occurrences: number;
}

export interface PrecisionLoss extends Position {
  path: string;
  raw: string;
  /** What the value becomes once stored as a double. */
  stored: string;
}

export interface JsonStats {
  objects: number;
  arrays: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  maxDepth: number;
  keys: number;
}

export interface ParseOptions {
  /** Accept `//` and block comments, as tsconfig.json and many config files use. */
  allowComments?: boolean;
  /** Accept a comma before a closing brace or bracket. */
  allowTrailingCommas?: boolean;
  /** Which value survives when a key repeats. `error` refuses the document. */
  duplicateKeys?: 'last' | 'first' | 'error';
  /** Guard against a pathological document exhausting the stack. */
  maxDepth?: number;
}

export interface ParseResult {
  ok: boolean;
  value?: unknown;
  error?: JsonError;
  duplicates: DuplicateKey[];
  precisionLoss: PrecisionLoss[];
  stats: JsonStats;
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

/** Splits a decimal literal into a sign, a digit string and a power of ten. */
function decimalParts(text: string): { negative: boolean; digits: string; exponent: number } | null {
  const match = /^(-?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const [, sign, intPart, fracPart = '', expPart = '0'] = match;
  let digits = (intPart ?? '') + fracPart;
  let exponent = Number(expPart) - fracPart.length;

  // Normalise so that 1.0, 1 and 1e0 all reduce to the same pair.
  digits = digits.replace(/^0+/, '');
  if (digits === '') return { negative: false, digits: '0', exponent: 0 };
  const trailing = /0*$/.exec(digits)![0].length;
  if (trailing > 0) {
    digits = digits.slice(0, digits.length - trailing);
    exponent += trailing;
  }
  return { negative: sign === '-', digits, exponent };
}

/**
 * True when two decimal literals denote exactly the same real number.
 *
 * Used to tell "the parser reformatted this" from "the parser changed this".
 * Signed zero counts as equal, because JSON draws no distinction there.
 */
export function decimalEquals(a: string, b: string): boolean {
  const x = decimalParts(a);
  const y = decimalParts(b);
  if (!x || !y) return a === b; // Infinity, NaN and anything unparseable
  if (x.digits === '0' && y.digits === '0') return true;
  return x.negative === y.negative && x.digits === y.digits && x.exponent === y.exponent;
}

class Reader {
  readonly source: string;
  index = 0;
  line = 1;
  lineStart = 0;

  constructor(source: string) {
    this.source = source;
  }

  get position(): Position {
    return { line: this.line, column: this.index - this.lineStart + 1, offset: this.index };
  }

  peek(ahead = 0): string | undefined {
    return this.source[this.index + ahead];
  }

  advance(n = 1): void {
    for (let i = 0; i < n; i++) {
      if (this.source[this.index] === '\n') {
        this.line++;
        this.lineStart = this.index + 1;
      }
      this.index++;
    }
  }

  atEnd(): boolean {
    return this.index >= this.source.length;
  }
}

class ParseFailure extends Error {
  readonly detail: JsonError;
  constructor(detail: JsonError) {
    super(detail.message);
    this.detail = detail;
  }
}

export function parseJson(source: string, options: ParseOptions = {}): ParseResult {
  const { allowComments = false, allowTrailingCommas = false, duplicateKeys = 'last', maxDepth = 512 } = options;

  const reader = new Reader(source);
  const duplicates: DuplicateKey[] = [];
  const precisionLoss: PrecisionLoss[] = [];
  const stats: JsonStats = {
    objects: 0,
    arrays: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    maxDepth: 0,
    keys: 0,
  };

  // The explicit annotation on the variable, not just on the arrow, is what
  // makes TypeScript treat a call to this as the end of the code path.
  const fail: (message: string, path: string, at?: Position) => never = (message, path, at) => {
    throw new ParseFailure({ message, path, ...(at ?? reader.position) });
  };

  function skipTrivia(path: string): void {
    for (;;) {
      while (!reader.atEnd() && WHITESPACE.has(reader.peek()!)) reader.advance();
      if (!allowComments) return;
      if (reader.peek() === '/' && reader.peek(1) === '/') {
        while (!reader.atEnd() && reader.peek() !== '\n') reader.advance();
        continue;
      }
      if (reader.peek() === '/' && reader.peek(1) === '*') {
        const start = reader.position;
        reader.advance(2);
        for (;;) {
          if (reader.atEnd()) fail('Block comment is never closed.', path, start);
          if (reader.peek() === '*' && reader.peek(1) === '/') {
            reader.advance(2);
            break;
          }
          reader.advance();
        }
        continue;
      }
      return;
    }
  }

  function readString(path: string): string {
    const start = reader.position;
    reader.advance(); // opening quote
    let out = '';
    for (;;) {
      if (reader.atEnd()) fail('String is never closed.', path, start);
      const ch = reader.peek()!;

      if (ch === '"') {
        reader.advance();
        return out;
      }

      if (ch === '\\') {
        reader.advance();
        const esc = reader.peek();
        if (esc === undefined) fail('String ends in the middle of an escape.', path);
        switch (esc) {
          case '"':
          case '\\':
          case '/':
            out += esc;
            reader.advance();
            break;
          case 'b':
            out += '\b';
            reader.advance();
            break;
          case 'f':
            out += '\f';
            reader.advance();
            break;
          case 'n':
            out += '\n';
            reader.advance();
            break;
          case 'r':
            out += '\r';
            reader.advance();
            break;
          case 't':
            out += '\t';
            reader.advance();
            break;
          case 'u': {
            reader.advance();
            let hex = '';
            for (let i = 0; i < 4; i++) {
              const d = reader.peek();
              if (d === undefined || !/[0-9a-fA-F]/.test(d)) {
                fail('A \\u escape needs exactly four hexadecimal digits.', path);
              }
              hex += d;
              reader.advance();
            }
            out += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          default:
            fail(
              `"\\${esc}" is not a valid JSON escape. Valid ones are \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.`,
              path,
            );
        }
        continue;
      }

      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        fail(
          `Control character U+${code.toString(16).padStart(4, '0').toUpperCase()} must be escaped inside a string.`,
          path,
        );
      }
      out += ch;
      reader.advance();
    }
  }

  function readNumber(path: string): number {
    const start = reader.position;
    let raw = '';
    if (reader.peek() === '-') {
      raw += '-';
      reader.advance();
    }

    if (reader.peek() === '0') {
      raw += '0';
      reader.advance();
      if (reader.peek() !== undefined && /[0-9]/.test(reader.peek()!)) {
        fail('A number may not have a leading zero.', path, start);
      }
    } else if (reader.peek() !== undefined && /[1-9]/.test(reader.peek()!)) {
      while (reader.peek() !== undefined && /[0-9]/.test(reader.peek()!)) {
        raw += reader.peek();
        reader.advance();
      }
    } else {
      fail('Expected a digit.', path, start);
    }

    if (reader.peek() === '.') {
      raw += '.';
      reader.advance();
      if (reader.peek() === undefined || !/[0-9]/.test(reader.peek()!)) {
        fail('A decimal point must be followed by at least one digit.', path);
      }
      while (reader.peek() !== undefined && /[0-9]/.test(reader.peek()!)) {
        raw += reader.peek();
        reader.advance();
      }
    }

    if (reader.peek() === 'e' || reader.peek() === 'E') {
      raw += reader.peek();
      reader.advance();
      if (reader.peek() === '+' || reader.peek() === '-') {
        raw += reader.peek();
        reader.advance();
      }
      if (reader.peek() === undefined || !/[0-9]/.test(reader.peek()!)) {
        fail('An exponent must have at least one digit.', path);
      }
      while (reader.peek() !== undefined && /[0-9]/.test(reader.peek()!)) {
        raw += reader.peek();
        reader.advance();
      }
    }

    const value = Number(raw);
    stats.numbers++;

    // A double holds every integer up to 2^53 exactly, and only those decimals
    // that happen to be representable in binary. Anything else comes back as a
    // different number. Comparing the written text against the exact decimal
    // value of the stored double is the only way to tell reformatting (1.0
    // becoming 1) apart from real loss (9007199254740993 becoming …92).
    if (!decimalEquals(raw, String(value))) {
      precisionLoss.push({ path, raw, stored: String(value), ...start });
    }

    return value;
  }

  function readLiteral(word: string, value: unknown, path: string): unknown {
    for (let i = 0; i < word.length; i++) {
      if (reader.peek(i) !== word[i]) fail(`Expected ${word}.`, path);
    }
    reader.advance(word.length);
    if (value === null) stats.nulls++;
    else stats.booleans++;
    return value;
  }

  function readValue(path: string, depth: number): unknown {
    if (depth > maxDepth) {
      fail(`Nesting is deeper than ${maxDepth} levels, which is refused to protect the browser tab.`, path);
    }
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    skipTrivia(path);

    const ch = reader.peek();
    if (ch === undefined) fail('Unexpected end of input: a value was expected here.', path);

    if (ch === '{') return readObject(path, depth);
    if (ch === '[') return readArray(path, depth);
    if (ch === '"') {
      stats.strings++;
      return readString(path);
    }
    if (ch === 't') return readLiteral('true', true, path);
    if (ch === 'f') return readLiteral('false', false, path);
    if (ch === 'n') return readLiteral('null', null, path);
    if (ch === '-' || /[0-9]/.test(ch)) return readNumber(path);

    if (ch === "'") fail('JSON strings use double quotes, not single quotes.', path);
    if (ch === '}' || ch === ']') fail(`Unexpected "${ch}".`, path);
    fail(`Unexpected character "${ch}".`, path);
    return undefined;
  }

  function readObject(path: string, depth: number): Record<string, unknown> {
    stats.objects++;
    reader.advance(); // {
    const result: Record<string, unknown> = {};
    const seen = new Map<string, number>();

    skipTrivia(path);
    if (reader.peek() === '}') {
      reader.advance();
      return result;
    }

    for (;;) {
      skipTrivia(path);
      if (allowTrailingCommas && reader.peek() === '}') {
        reader.advance();
        return result;
      }
      if (reader.peek() !== '"') {
        fail(
          reader.peek() === "'"
            ? 'JSON keys use double quotes, not single quotes.'
            : 'An object key must be a string in double quotes.',
          path,
        );
      }
      const keyPos = reader.position;
      const key = readString(path);
      const childPath = path === '$' ? `$.${key}` : `${path}.${key}`;
      stats.keys++;

      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count > 1) {
        if (duplicateKeys === 'error') {
          fail(
            `Duplicate key "${key}". RFC 8259 says names SHOULD be unique and leaves the behaviour undefined when they are not.`,
            childPath,
            keyPos,
          );
        }
        duplicates.push({ path: childPath, key, occurrences: count, ...keyPos });
      }

      skipTrivia(childPath);
      if (reader.peek() !== ':') fail('Expected a colon after the key.', childPath);
      reader.advance();

      const value = readValue(childPath, depth + 1);
      // 'last' matches JSON.parse. 'first' keeps the earliest, which is what
      // some streaming parsers do.
      // defineProperty rather than assignment: a key of "__proto__" would
      // otherwise replace the object's prototype and the value would vanish.
      if (count === 1 || duplicateKeys === 'last') {
        Object.defineProperty(result, key, { value, writable: true, enumerable: true, configurable: true });
      }

      skipTrivia(childPath);
      const next = reader.peek();
      if (next === ',') {
        reader.advance();
        skipTrivia(path);
        if (reader.peek() === '}') {
          if (!allowTrailingCommas) fail('Trailing comma before the closing brace.', path);
          reader.advance();
          return result;
        }
        continue;
      }
      if (next === '}') {
        reader.advance();
        return result;
      }
      fail(
        next === undefined ? 'Object is never closed.' : `Expected a comma or a closing brace, found "${next}".`,
        path,
      );
    }
  }

  function readArray(path: string, depth: number): unknown[] {
    stats.arrays++;
    reader.advance(); // [
    const result: unknown[] = [];

    skipTrivia(path);
    if (reader.peek() === ']') {
      reader.advance();
      return result;
    }

    for (;;) {
      skipTrivia(path);
      if (allowTrailingCommas && reader.peek() === ']') {
        reader.advance();
        return result;
      }
      const childPath = `${path}[${result.length}]`;
      result.push(readValue(childPath, depth + 1));

      skipTrivia(childPath);
      const next = reader.peek();
      if (next === ',') {
        reader.advance();
        skipTrivia(path);
        if (reader.peek() === ']') {
          if (!allowTrailingCommas) fail('Trailing comma before the closing bracket.', path);
          reader.advance();
          return result;
        }
        continue;
      }
      if (next === ']') {
        reader.advance();
        return result;
      }
      fail(
        next === undefined ? 'Array is never closed.' : `Expected a comma or a closing bracket, found "${next}".`,
        path,
      );
    }
  }

  try {
    skipTrivia('$');
    if (reader.atEnd()) {
      return {
        ok: false,
        error: { message: 'The input is empty.', path: '$', line: 1, column: 1, offset: 0 },
        duplicates,
        precisionLoss,
        stats,
      };
    }
    const value = readValue('$', 1);
    skipTrivia('$');
    if (!reader.atEnd()) {
      fail(`Unexpected content after the end of the JSON value: "${reader.peek()}".`, '$');
    }
    return { ok: true, value, duplicates, precisionLoss, stats };
  } catch (err) {
    if (err instanceof ParseFailure) {
      return { ok: false, error: err.detail, duplicates, precisionLoss, stats };
    }
    throw err;
  }
}
