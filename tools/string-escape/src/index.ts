/**
 * Dispatches escape/unescape calls to the right language module and
 * implements the two rules shared across languages: adding/stripping the
 * surrounding quote characters ("wrap"), and splitting multi-line input
 * into one literal per line ("perLine").
 */
import meta from './meta.json';
import { StringEscapeError, WRAP_START_MESSAGE, type LiteralResult, type LiteralWarning } from './shared';
import * as js from './javascript';
import * as java from './java';
import * as csharp from './csharp';
import * as python from './python';
import * as go from './go';
import * as sql from './sql';
import * as csv from './csv';
import * as shell from './shell';
import * as regex from './regex';
import { escapeXml, unescapeXml, XML_LANGUAGES, type XmlContext } from './xml';

export { meta, StringEscapeError, XML_LANGUAGES };
export type { LiteralResult, LiteralWarning };

export type Language =
  'javascript' | 'java' | 'csharp' | 'python' | 'go' | 'sql' | 'csv' | 'shell' | 'regex' | XmlContext;

export const LANGUAGES: readonly { id: Language; label: string }[] = [
  { id: 'javascript', label: 'JavaScript / TypeScript' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'sql', label: 'SQL' },
  { id: 'csv', label: 'CSV field' },
  { id: 'shell', label: 'POSIX shell' },
  { id: 'regex', label: 'Regular expression (JavaScript)' },
];

export interface EscapeOptions {
  language: Language;
  quote?: '"' | "'";
  escapeNonAscii?: boolean;
  wrap?: boolean;
  perLine?: boolean;
  csharpForm?: 'regular' | 'verbatim';
  sqlStyle?: 'standard' | 'mysql';
  csvDelimiter?: ',' | ';' | '\t' | '|';
}

export interface UnescapeOptions {
  language: Language;
  quote?: '"' | "'";
  wrap?: boolean;
  csharpForm?: 'regular' | 'verbatim';
  sqlStyle?: 'standard' | 'mysql';
  csvDelimiter?: ',' | ';' | '\t' | '|';
}

const PER_LINE_LANGUAGES: ReadonlySet<Language> = new Set(['javascript', 'java', 'csharp', 'python', 'go']);

function escapeOne(text: string, options: EscapeOptions): LiteralResult {
  const wrap = options.wrap ?? true;
  switch (options.language) {
    case 'javascript': {
      const quote = options.quote ?? '"';
      const r = js.escapeContents(text, { quote, escapeNonAscii: options.escapeNonAscii ?? false });
      return { value: wrap ? quote + r.value + quote : r.value, warnings: r.warnings };
    }
    case 'java': {
      const r = java.escapeContents(text, { escapeNonAscii: options.escapeNonAscii ?? false });
      return { value: wrap ? '"' + r.value + '"' : r.value, warnings: r.warnings };
    }
    case 'csharp': {
      if ((options.csharpForm ?? 'regular') === 'verbatim') {
        const r = csharp.escapeVerbatim(text);
        return { value: wrap ? '@"' + r.value + '"' : r.value, warnings: r.warnings };
      }
      const r = csharp.escapeContents(text, { escapeNonAscii: options.escapeNonAscii ?? false });
      return { value: wrap ? '"' + r.value + '"' : r.value, warnings: r.warnings };
    }
    case 'python': {
      const quote = options.quote ?? '"';
      const r = python.escapeContents(text, { quote, escapeNonAscii: options.escapeNonAscii ?? false });
      return { value: wrap ? quote + r.value + quote : r.value, warnings: r.warnings };
    }
    case 'go': {
      const r = go.escapeContents(text, { escapeNonAscii: options.escapeNonAscii ?? false });
      return { value: wrap ? '"' + r.value + '"' : r.value, warnings: r.warnings };
    }
    case 'sql': {
      const style = options.sqlStyle ?? 'standard';
      const r = sql.escapeContents(text, style);
      return { value: wrap ? "'" + r.value + "'" : r.value, warnings: r.warnings };
    }
    case 'csv':
      return csv.escapeField(text, options.csvDelimiter ?? ',');
    case 'shell':
      return shell.escape(text);
    case 'regex':
      return regex.escape(text);
    case 'xml-text':
    case 'xml-attribute':
      return escapeXml(text, {
        context: options.language,
        quote: options.quote,
        escapeNonAscii: options.escapeNonAscii,
        wrap: options.wrap,
      });
    default: {
      const exhaustive: never = options.language;
      throw new StringEscapeError(`unsupported language "${String(exhaustive)}"`);
    }
  }
}

/** Splits input after each \n, keeping the \n with the line it ends. No empty final literal when input ends with \n. */
function splitLines(text: string): string[] {
  if (text === '') return [''];
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function escapeWithPerLine(text: string, options: EscapeOptions): LiteralResult {
  const lines = splitLines(text);
  const warnings: LiteralWarning[] = [];
  const literalOptions: EscapeOptions = { ...options, wrap: true };
  const literals = lines.map((line) => {
    const r = escapeOne(line, literalOptions);
    warnings.push(...r.warnings);
    return r.value;
  });
  if (lines.length <= 1) {
    return { value: literals[0] ?? '', warnings };
  }
  if (options.language === 'python') {
    const body = literals.map((l) => '    ' + l).join('\n');
    return { value: '(\n' + body + '\n)', warnings };
  }
  return { value: literals.join(' +\n'), warnings };
}

export function escapeLiteral(input: string, options: EscapeOptions): LiteralResult {
  if (options.perLine && PER_LINE_LANGUAGES.has(options.language)) {
    if (options.language === 'csharp' && (options.csharpForm ?? 'regular') !== 'regular') {
      return escapeOne(input, options);
    }
    return escapeWithPerLine(input, options);
  }
  return escapeOne(input, options);
}

export function unescapeLiteral(input: string, options: UnescapeOptions): LiteralResult {
  const wrap = options.wrap ?? true;
  switch (options.language) {
    case 'javascript': {
      if (wrap) {
        const q = input[0];
        if (!q || (q !== '"' && q !== "'") || input.length < 2 || input[input.length - 1] !== q) {
          throw new StringEscapeError(WRAP_START_MESSAGE, 0);
        }
        return js.unescapeContents(input.slice(1, -1), { quote: q });
      }
      return js.unescapeContents(input, { quote: options.quote ?? '"' });
    }
    case 'java': {
      if (wrap) {
        if (input.length < 2 || input[0] !== '"' || input[input.length - 1] !== '"') {
          throw new StringEscapeError(WRAP_START_MESSAGE, 0);
        }
        return java.unescapeContents(input.slice(1, -1), 1);
      }
      return java.unescapeContents(input, 0);
    }
    case 'csharp': {
      if ((options.csharpForm ?? 'regular') === 'verbatim') {
        if (wrap) {
          if (!input.startsWith('@"') || input.length < 3 || input[input.length - 1] !== '"') {
            throw new StringEscapeError(WRAP_START_MESSAGE, 0);
          }
          return csharp.unescapeVerbatim(input.slice(2, -1), 2);
        }
        return csharp.unescapeVerbatim(input, 0);
      }
      if (wrap) {
        if (input.length < 2 || input[0] !== '"' || input[input.length - 1] !== '"') {
          throw new StringEscapeError(WRAP_START_MESSAGE, 0);
        }
        return csharp.unescapeContents(input.slice(1, -1), 1);
      }
      return csharp.unescapeContents(input, 0);
    }
    case 'python':
      return python.unescape(input, { wrap, quote: options.quote ?? '"' });
    case 'go': {
      if (wrap) {
        if (input.length < 2 || input[0] !== '"' || input[input.length - 1] !== '"') {
          throw new StringEscapeError(WRAP_START_MESSAGE, 0);
        }
        return go.unescapeContents(input.slice(1, -1), 1);
      }
      return go.unescapeContents(input, 0);
    }
    case 'sql':
      return sql.unescape(input, { wrap, sqlStyle: options.sqlStyle ?? 'standard' });
    case 'csv':
      return csv.unescapeField(input, options.csvDelimiter ?? ',');
    case 'shell':
      return shell.unescape(input);
    case 'regex':
      return regex.unescape(input);
    case 'xml-text':
    case 'xml-attribute':
      return unescapeXml(input, { context: options.language, quote: options.quote, wrap });
    default: {
      const exhaustive: never = options.language;
      throw new StringEscapeError(`unsupported language "${String(exhaustive)}"`);
    }
  }
}
