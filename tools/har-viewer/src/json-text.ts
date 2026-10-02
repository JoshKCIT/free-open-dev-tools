/**
 * RFC 8259 JSON text parsing with an engine-independent error position.
 *
 * The built-in parser is used for the common case, since it is fast and
 * every engine implements it correctly for valid input. When it throws,
 * this scans the text by hand instead of reading the engine's own error
 * message, because V8, SpiderMonkey and JavaScriptCore each word their
 * `JSON.parse` errors differently and do not agree on how a position is
 * counted. The hand-written scanner always reports the same line and
 * column for the same broken document, in any of them.
 */

export interface JsonTextResult {
  ok: boolean;
  value?: unknown;
  message?: string;
  line?: number;
  column?: number;
  offset?: number;
}

/** A document nested deeper than this is refused before any recursive walk touches it. */
export const MAX_JSON_DEPTH = 512;

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

interface Position {
  line: number;
  column: number;
  offset: number;
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

class ScanFailure extends Error {
  readonly at: Position;
  constructor(message: string, at: Position) {
    super(message);
    this.at = at;
  }
}

/**
 * A minimal RFC 8259 recursive-descent scanner used only to LOCATE the
 * first syntax error once the built-in parser has already thrown. It never
 * needs to build a usable value: it only has to stop at the same place any
 * conforming parser would consider the text broken, and say why in its own
 * words rather than the host engine's.
 */
function scanForError(source: string): ScanFailure {
  const reader = new Reader(source);

  // The explicit annotation on the variable, not just on the arrow, is what
  // makes TypeScript treat a call to this as the end of the code path.
  const fail: (message: string) => never = (message) => {
    throw new ScanFailure(message, reader.position);
  };

  const skipWs = (): void => {
    while (!reader.atEnd() && WHITESPACE.has(reader.peek()!)) reader.advance();
  };

  const readString = (): void => {
    reader.advance(); // opening quote
    for (;;) {
      if (reader.atEnd()) fail('String is never closed.');
      const ch = reader.peek()!;
      if (ch === '"') {
        reader.advance();
        return;
      }
      if (ch === '\\') {
        reader.advance();
        const esc = reader.peek();
        if (esc === undefined) fail('String ends in the middle of an escape.');
        if (esc === 'u') {
          reader.advance();
          for (let i = 0; i < 4; i++) {
            const d = reader.peek();
            if (d === undefined || !/[0-9a-fA-F]/.test(d)) {
              fail('A \\u escape needs exactly four hexadecimal digits.');
            }
            reader.advance();
          }
          continue;
        }
        if (!'"\\/bfnrt'.includes(esc)) {
          fail(`"\\${esc}" is not a valid JSON escape. Valid ones are \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.`);
        }
        reader.advance();
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        fail(
          `Control character U+${code.toString(16).padStart(4, '0').toUpperCase()} must be escaped inside a string.`,
        );
      }
      reader.advance();
    }
  };

  const readNumber = (): void => {
    if (reader.peek() === '-') reader.advance();
    if (reader.peek() === '0') {
      reader.advance();
      if (reader.peek() !== undefined && /[0-9]/.test(reader.peek()!)) fail('A number may not have a leading zero.');
    } else if (reader.peek() !== undefined && /[1-9]/.test(reader.peek()!)) {
      while (reader.peek() !== undefined && /[0-9]/.test(reader.peek()!)) reader.advance();
    } else {
      fail('Expected a digit.');
    }
    if (reader.peek() === '.') {
      reader.advance();
      if (reader.peek() === undefined || !/[0-9]/.test(reader.peek()!)) {
        fail('A decimal point must be followed by at least one digit.');
      }
      while (reader.peek() !== undefined && /[0-9]/.test(reader.peek()!)) reader.advance();
    }
    if (reader.peek() === 'e' || reader.peek() === 'E') {
      reader.advance();
      if (reader.peek() === '+' || reader.peek() === '-') reader.advance();
      if (reader.peek() === undefined || !/[0-9]/.test(reader.peek()!))
        fail('An exponent must have at least one digit.');
      while (reader.peek() !== undefined && /[0-9]/.test(reader.peek()!)) reader.advance();
    }
  };

  const readLiteral = (word: string): void => {
    for (let i = 0; i < word.length; i++) {
      if (reader.peek(i) !== word[i]) fail(`Expected ${word}.`);
    }
    reader.advance(word.length);
  };

  const readValue = (depth: number): void => {
    if (depth > MAX_JSON_DEPTH) {
      fail(`Nesting is deeper than ${MAX_JSON_DEPTH} levels, which is refused to protect the browser tab.`);
    }
    skipWs();
    const ch = reader.peek();
    if (ch === undefined) fail('Unexpected end of input: a value was expected here.');
    if (ch === '{') return readObject(depth);
    if (ch === '[') return readArray(depth);
    if (ch === '"') return readString();
    if (ch === 't') return readLiteral('true');
    if (ch === 'f') return readLiteral('false');
    if (ch === 'n') return readLiteral('null');
    if (ch === '-' || /[0-9]/.test(ch)) return readNumber();
    if (ch === "'") fail('JSON strings use double quotes, not single quotes.');
    if (ch === '}' || ch === ']') fail(`Unexpected "${ch}".`);
    fail(`Unexpected character "${ch}".`);
  };

  function readObject(depth: number): void {
    reader.advance(); // {
    skipWs();
    if (reader.peek() === '}') {
      reader.advance();
      return;
    }
    for (;;) {
      skipWs();
      if (reader.peek() !== '"') {
        fail(
          reader.peek() === "'"
            ? 'JSON keys use double quotes, not single quotes.'
            : 'An object key must be a string in double quotes.',
        );
      }
      readString();
      skipWs();
      if (reader.peek() !== ':') fail('Expected a colon after the key.');
      reader.advance();
      readValue(depth + 1);
      skipWs();
      const next = reader.peek();
      if (next === ',') {
        reader.advance();
        skipWs();
        if (reader.peek() === '}') fail('Trailing comma before the closing brace.');
        continue;
      }
      if (next === '}') {
        reader.advance();
        return;
      }
      fail(next === undefined ? 'Object is never closed.' : `Expected a comma or a closing brace, found "${next}".`);
    }
  }

  function readArray(depth: number): void {
    reader.advance(); // [
    skipWs();
    if (reader.peek() === ']') {
      reader.advance();
      return;
    }
    for (;;) {
      skipWs();
      readValue(depth + 1);
      skipWs();
      const next = reader.peek();
      if (next === ',') {
        reader.advance();
        skipWs();
        if (reader.peek() === ']') fail('Trailing comma before the closing bracket.');
        continue;
      }
      if (next === ']') {
        reader.advance();
        return;
      }
      fail(next === undefined ? 'Array is never closed.' : `Expected a comma or a closing bracket, found "${next}".`);
    }
  }

  try {
    skipWs();
    readValue(1);
    skipWs();
    if (!reader.atEnd()) fail(`Unexpected content after the end of the JSON value: "${reader.peek()}".`);
  } catch (err) {
    if (err instanceof ScanFailure) return err;
    throw err;
  }
  // The built-in parser threw but this scanner found nothing wrong with the
  // grammar; report the end of the text rather than pretending it is valid.
  return new ScanFailure('The document could not be parsed.', reader.position);
}

/**
 * Parses JSON text. Strips one leading byte-order mark, refuses an empty or
 * whitespace-only document, and otherwise parses with the built-in parser
 * first, falling back to the hand-written scanner above only to find where
 * a broken document goes wrong.
 */
export function parseJsonText(text: string): JsonTextResult {
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (stripped.trim() === '') {
    return { ok: false, message: 'The document is empty.', line: 1, column: 1, offset: 0 };
  }
  try {
    const value: unknown = JSON.parse(stripped);
    return { ok: true, value };
  } catch {
    const failure = scanForError(stripped);
    return {
      ok: false,
      message: failure.message,
      line: failure.at.line,
      column: failure.at.column,
      offset: failure.at.offset,
    };
  }
}

/**
 * True when `value` nests deeper than `max` levels. Walks with an explicit
 * stack instead of recursion, so checking the depth of a pathological
 * document cannot itself overflow the call stack it exists to protect.
 */
export function exceedsDepth(value: unknown, max: number): boolean {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.depth > max) return true;
    if (Array.isArray(top.value)) {
      for (const item of top.value) stack.push({ value: item, depth: top.depth + 1 });
    } else if (top.value !== null && typeof top.value === 'object') {
      for (const item of Object.values(top.value as Record<string, unknown>)) {
        stack.push({ value: item, depth: top.depth + 1 });
      }
    }
  }
  return false;
}
