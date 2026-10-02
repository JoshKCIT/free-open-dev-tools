/**
 * Reads pasted CSV, TSV or JSON into the rows the writer stores. CSV goes through the canonical RFC 4180 reader copied
 * into this folder; TSV is split by tabs and every line must have the same number of fields (the IANA registration);
 * JSON is read by a small parser of its own that keeps each number as the text it was written with, so a digit string
 * is never rounded on the way to a cell.
 */
import { parseCsv, CsvSyntaxError } from './csv';
import { SpreadsheetConverterError, type TableCell, type TypedValue } from './types';

/** A JSON document deeper than this is refused before any recursion can exhaust the stack. */
const MAX_JSON_DEPTH = 512;
/** Warnings listed in full; further ones are counted. */
const MAX_WARNINGS = 20;

class WarningList {
  private readonly shown: string[] = [];
  private extra = 0;
  add(message: string): void {
    if (this.shown.length < MAX_WARNINGS) this.shown.push(message);
    else this.extra++;
  }
  done(): string[] {
    if (this.extra > 0) this.shown.push(`${this.extra} more like these were not listed.`);
    return this.shown;
  }
}

function parseTsv(text: string): TableCell[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (source === '') return [];
  const lines = source.split(/\r\n|\r|\n/);
  // A line ending after the last line does not start another line.
  if (lines[lines.length - 1] === '') lines.pop();
  const rows = lines.map((line) => line.split('\t'));
  const expected = rows[0]?.length ?? 0;
  rows.forEach((row, index) => {
    if (row.length === expected) return;
    const fields = (n: number) => `${n} ${n === 1 ? 'field' : 'fields'}`;
    throw new SpreadsheetConverterError(
      `Line ${index + 1} has ${fields(row.length)} but line 1 has ${expected}. Every line of a TSV file must have the same number of fields.`,
      { line: index + 1 },
    );
  });
  return rows;
}

type JsonNode =
  | { t: 'str'; v: string }
  | { t: 'num'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'arr'; v: JsonNode[] }
  | { t: 'obj'; v: [string, JsonNode][] };

/** A JSON Pointer (RFC 6901) segment: ~ and / are escaped. */
const pointerSegment = (key: string | number): string => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

class JsonReader {
  private index = 0;
  private line = 1;
  private lineStart = 0;
  private depth = 0;
  private readonly path: string[] = [];

  constructor(
    private readonly source: string,
    private readonly warnings: WarningList,
  ) {}

  private fail(message: string, at = this.index): never {
    // The line and column of `at`, counting a CRLF as one break.
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < at && i < this.source.length; i++) {
      const ch = this.source.charCodeAt(i);
      if (ch === 10 || (ch === 13 && this.source.charCodeAt(i + 1) !== 10)) {
        line++;
        lineStart = i + 1;
      }
    }
    throw new SpreadsheetConverterError(`Line ${line}, column ${at - lineStart + 1}: ${message}`, {
      line,
      column: at - lineStart + 1,
    });
  }

  private skipSpace(): void {
    for (;;) {
      const ch = this.source.charCodeAt(this.index);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) this.index++;
      else return;
    }
  }

  parseDocument(): JsonNode {
    this.skipSpace();
    const value = this.parseValue();
    this.skipSpace();
    if (this.index < this.source.length) this.fail('Unexpected text after the end of the JSON.');
    return value;
  }

  private pointer(): string {
    return this.path
      .map(pointerSegment)
      .map((segment) => `/${segment}`)
      .join('');
  }

  private enter(): void {
    if (++this.depth > MAX_JSON_DEPTH) {
      this.fail(`This JSON is nested more than ${MAX_JSON_DEPTH} levels deep, so it was refused.`);
    }
  }

  private parseValue(): JsonNode {
    const ch = this.source[this.index];
    if (ch === undefined) this.fail('The JSON ends before it is complete.');
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"') return { t: 'str', v: this.parseString() };
    if (ch === '-' || (ch! >= '0' && ch! <= '9')) return this.parseNumber();
    for (const [word, node] of [
      ['true', { t: 'bool', v: true }],
      ['false', { t: 'bool', v: false }],
      ['null', { t: 'null' }],
    ] as const) {
      if (this.source.startsWith(word, this.index)) {
        this.index += word.length;
        return node;
      }
    }
    return this.fail(`Unexpected "${ch}" here; a value was expected.`);
  }

  private parseObject(): JsonNode {
    this.enter();
    this.index++;
    const entries: [string, JsonNode][] = [];
    const seen = new Map<string, number>();
    this.skipSpace();
    if (this.source[this.index] === '}') {
      this.index++;
      this.depth--;
      return { t: 'obj', v: entries };
    }
    for (;;) {
      this.skipSpace();
      if (this.source[this.index] !== '"') {
        this.fail(
          this.index >= this.source.length
            ? 'The JSON ends before it is complete.'
            : 'A key in quotes was expected here.',
        );
      }
      const key = this.parseString();
      this.skipSpace();
      if (this.source[this.index] !== ':') this.fail('A colon was expected after the key.');
      this.index++;
      this.skipSpace();
      this.path.push(key);
      const value = this.parseValue();
      this.path.pop();
      const earlier = seen.get(key);
      if (earlier === undefined) {
        seen.set(key, entries.length);
        entries.push([key, value]);
      } else {
        entries[earlier] = [key, value];
        this.warnings.add(
          `The key "${key}" at ${this.pointer() || '/'} appears more than once, so its last value was used.`,
        );
      }
      this.skipSpace();
      const next = this.source[this.index];
      if (next === ',') {
        this.index++;
        continue;
      }
      if (next === '}') {
        this.index++;
        this.depth--;
        return { t: 'obj', v: entries };
      }
      this.fail(
        next === undefined ? 'The JSON ends before it is complete.' : 'A comma or a closing brace was expected here.',
      );
    }
  }

  private parseArray(): JsonNode {
    this.enter();
    this.index++;
    const items: JsonNode[] = [];
    this.skipSpace();
    if (this.source[this.index] === ']') {
      this.index++;
      this.depth--;
      return { t: 'arr', v: items };
    }
    for (;;) {
      this.skipSpace();
      this.path.push(String(items.length));
      items.push(this.parseValue());
      this.path.pop();
      this.skipSpace();
      const next = this.source[this.index];
      if (next === ',') {
        this.index++;
        continue;
      }
      if (next === ']') {
        this.index++;
        this.depth--;
        return { t: 'arr', v: items };
      }
      this.fail(
        next === undefined ? 'The JSON ends before it is complete.' : 'A comma or a closing bracket was expected here.',
      );
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index++;
    let out = '';
    for (;;) {
      const ch = this.source[this.index];
      if (ch === undefined) this.fail('A string is never closed.', start);
      if (ch === '"') {
        this.index++;
        return out;
      }
      if (ch === '\\') {
        const esc = this.source[this.index + 1];
        const simple: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        };
        if (esc !== undefined && esc in simple) {
          out += simple[esc]!;
          this.index += 2;
        } else if (esc === 'u' && /^[0-9a-fA-F]{4}$/.test(this.source.slice(this.index + 2, this.index + 6))) {
          out += String.fromCharCode(parseInt(this.source.slice(this.index + 2, this.index + 6), 16));
          this.index += 6;
        } else {
          this.fail('A backslash in a string must start one of \\" \\\\ \\/ \\b \\f \\n \\r \\t or \\uXXXX.');
        }
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) this.fail('A control character inside a string must be escaped.');
      out += ch;
      this.index++;
    }
  }

  private parseNumber(): JsonNode {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      this.source.slice(this.index, this.index + 400),
    );
    if (!match) this.fail('A number was expected here.');
    const lexeme = match![0];
    const after = this.source[this.index + lexeme.length];
    if (after !== undefined && /[0-9.eE+-]/.test(after)) this.fail('This is not a valid JSON number.');
    this.index += lexeme.length;
    return { t: 'num', v: lexeme };
  }
}

/** The compact JSON text of a node, with every number as it was written. */
function nodeText(node: JsonNode): string {
  switch (node.t) {
    case 'str':
      return JSON.stringify(node.v);
    case 'num':
      return node.v;
    case 'bool':
      return node.v ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'arr':
      return `[${node.v.map(nodeText).join(',')}]`;
    case 'obj':
      return `{${node.v.map(([key, value]) => `${JSON.stringify(key)}:${nodeText(value)}`).join(',')}}`;
  }
}

function parseJson(text: string): { rows: TableCell[][]; warnings: string[] } {
  const warnings = new WarningList();
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const root = new JsonReader(source, warnings).parseDocument();
  if (root.t !== 'arr') {
    throw new SpreadsheetConverterError('The JSON must be an array of objects or an array of arrays.');
  }
  if (root.v.length === 0) {
    throw new SpreadsheetConverterError('The JSON array is empty, so there is nothing to write.');
  }

  const cellOf = (node: JsonNode, pointer: string): TableCell => {
    switch (node.t) {
      case 'str':
        return { kind: 'text', text: node.v };
      case 'num':
        return { kind: 'number', text: node.v };
      case 'bool':
        return { kind: 'boolean', text: node.v ? 'true' : 'false' };
      case 'null':
        return null;
      default:
        warnings.add(`The value at ${pointer} is nested, so it was written as its JSON text.`);
        return { kind: 'text', text: nodeText(node) };
    }
  };

  const items = root.v;
  if (items.every((item) => item.t === 'obj')) {
    const columns: string[] = [];
    const known = new Set<string>();
    for (const item of items) {
      if (item.t !== 'obj') continue;
      for (const [key] of item.v) {
        if (!known.has(key)) {
          known.add(key);
          columns.push(key);
        }
      }
    }
    const rows: TableCell[][] = [columns.map((name): TypedValue => ({ kind: 'text', text: name }))];
    items.forEach((item, rowIndex) => {
      if (item.t !== 'obj') return;
      const byKey = new Map(item.v);
      rows.push(
        columns.map((key) => {
          const value = byKey.get(key);
          return value === undefined ? null : cellOf(value, `/${rowIndex}/${pointerSegment(key)}`);
        }),
      );
    });
    return { rows, warnings: warnings.done() };
  }
  if (items.every((item) => item.t === 'arr')) {
    const rows = items.map((item, rowIndex) =>
      item.t === 'arr' ? item.v.map((value, col) => cellOf(value, `/${rowIndex}/${col}`)) : [],
    );
    return { rows, warnings: warnings.done() };
  }
  throw new SpreadsheetConverterError(
    'Every item of the JSON array must be an object, or every item must be an array.',
  );
}

export function parseTextTable(
  text: string,
  format: 'csv' | 'tsv' | 'json',
): { rows: TableCell[][]; warnings: string[] } {
  if (format === 'tsv') return { rows: parseTsv(text), warnings: [] };
  if (format === 'json') return parseJson(text);
  try {
    return { rows: parseCsv(text).rows, warnings: [] };
  } catch (err) {
    if (err instanceof CsvSyntaxError) {
      throw new SpreadsheetConverterError(err.message, { line: err.line, column: err.column });
    }
    throw err;
  }
}
