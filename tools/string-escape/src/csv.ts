/**
 * CSV field escaping (RFC 4180 section 2, rules 5 to 7). Operates on one
 * field at a time; a whole row or file is out of scope for this tool.
 */
import { StringEscapeError, type LiteralResult } from './shared';

export function escapeField(value: string, delimiter: string): LiteralResult {
  const needsQuote = value.includes(delimiter) || value.includes('"') || value.includes('\r') || value.includes('\n');
  if (!needsQuote) return { value, warnings: [] };
  return { value: '"' + value.replace(/"/g, '""') + '"', warnings: [] };
}

export function unescapeField(text: string, delimiter: string): LiteralResult {
  if (text.length === 0) return { value: '', warnings: [] };
  if (text[0] === '"') {
    let out = '';
    let i = 1;
    let closed = false;
    while (i < text.length) {
      if (text[i] === '"') {
        if (text[i + 1] === '"') {
          out += '"';
          i += 2;
          continue;
        }
        i++;
        closed = true;
        break;
      }
      out += text[i];
      i++;
    }
    if (!closed) {
      throw new StringEscapeError('a field starting with a quote must also end with one', 0);
    }
    if (i < text.length) {
      throw new StringEscapeError('text after the closing quote is not valid: this reads a single field', i);
    }
    return { value: out, warnings: [] };
  }
  if (text.includes(delimiter)) {
    throw new StringEscapeError('an unquoted field cannot contain the delimiter; this reads a single field', 0);
  }
  if (text.includes('"')) {
    throw new StringEscapeError('an unquoted field cannot contain a quote; this reads a single field', 0);
  }
  const crlf = text.search(/[\r\n]/);
  if (crlf !== -1) {
    throw new StringEscapeError('an unquoted field cannot contain a line break; this reads a single field', crlf);
  }
  return { value: text, warnings: [] };
}
