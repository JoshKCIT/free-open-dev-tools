/**
 * RFC 4180 CSV reading and writing.
 */

export class CsvSyntaxError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = 'CsvSyntaxError';
    this.line = line;
    this.column = column;
  }
}

export interface CsvParseOptions {
  /** Field separator. Default ','. */
  delimiter?: string;
}

export interface CsvParseResult {
  rows: string[][];
}

export interface CsvFormatOptions {
  /** Field separator. Default ','. */
  delimiter?: string;
  /** Record separator written between rows. Default '\r\n' (RFC 4180's own CRLF). */
  lineEnding?: string;
  /** Quote every field, not only the ones rule 6 requires. Default false. */
  quoteAll?: boolean;
}

/** 1-based line and column of `index` in `source`, counting a lone CR or a CRLF pair as one line break. */
function positionAt(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i++) {
    const ch = source[i];
    if (ch === '\n') {
      line++;
      column = 1;
    } else if (ch === '\r') {
      if (source[i + 1] !== '\n') {
        line++;
        column = 1;
      }
      // A CR immediately followed by LF is one CRLF break; the LF above is
      // what advances the line, so this branch does nothing for that case.
    } else {
      column++;
    }
  }
  return { line, column };
}

/** Length of the record separator starting at `index` (CRLF: 2, lone LF or CR: 1), or 0 if none starts there. */
function recordSeparatorLength(source: string, index: number): number {
  if (source[index] === '\r' && source[index + 1] === '\n') return 2;
  if (source[index] === '\n' || source[index] === '\r') return 1;
  return 0;
}

/**
 * Parses CSV text into rows of fields. Accepts CRLF, LF or a lone CR as a
 * record separator (rule 1); the last record needs no trailing separator
 * (rule 2); a quoted field may hold the delimiter and a line break, with an
 * embedded quote doubled (rules 5-7); a stray quote inside an unquoted
 * field is kept as a literal character, since only a field that OPENS with
 * a quote is treated as a quoted field.
 */
export function parseCsv(text: string, options: CsvParseOptions = {}): CsvParseResult {
  const delimiter = options.delimiter ?? ',';
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const n = source.length;

  const fail = (message: string, at: number): never => {
    const pos = positionAt(source, at);
    throw new CsvSyntaxError(message, pos.line, pos.column);
  };

  const rows: string[][] = [];
  let row: string[] = [];
  let rowStarted = false;
  let i = 0;

  while (i < n) {
    let field: string;

    if (source[i] === '"') {
      const start = i;
      i++;
      let content = '';
      for (;;) {
        if (i >= n) fail('An opening quote here is never closed.', start);
        const ch = source[i]!;
        if (ch === '"') {
          if (source[i + 1] === '"') {
            content += '"';
            i += 2;
            continue;
          }
          i++; // consume the closing quote
          break;
        }
        content += ch;
        i++;
      }
      if (i < n && source[i] !== delimiter && recordSeparatorLength(source, i) === 0) {
        fail('A quoted field must end at a delimiter or the end of the line, not more text.', i);
      }
      field = content;
    } else {
      let content = '';
      while (i < n && source[i] !== delimiter && recordSeparatorLength(source, i) === 0) {
        content += source[i]!;
        i++;
      }
      field = content;
    }

    row.push(field);
    rowStarted = true;

    if (i < n && source[i] === delimiter) {
      i++;
      continue;
    }

    const sepLen = recordSeparatorLength(source, i);
    if (sepLen > 0) {
      i += sepLen;
      rows.push(row);
      row = [];
      rowStarted = false;
      continue;
    }

    break; // end of input, mid-field
  }

  if (rowStarted) rows.push(row);

  return { rows };
}

/**
 * Writes rows of fields as CSV text. A field is quoted when it contains the
 * delimiter, a double quote, or a carriage return or line feed (rule 6), or
 * always when `quoteAll` is set; an embedded quote is doubled (rule 7).
 * Records are joined with `lineEnding`; no trailing line break is added.
 */
export function formatCsv(rows: string[][], options: CsvFormatOptions = {}): string {
  const delimiter = options.delimiter ?? ',';
  const lineEnding = options.lineEnding ?? '\r\n';
  const quoteAll = options.quoteAll ?? false;

  const formatField = (field: string): string => {
    const needsQuoting =
      quoteAll || field.includes(delimiter) || field.includes('"') || field.includes('\r') || field.includes('\n');
    if (!needsQuoting) return field;
    return '"' + field.replace(/"/g, '""') + '"';
  };

  return rows.map((row) => row.map(formatField).join(delimiter)).join(lineEnding);
}
