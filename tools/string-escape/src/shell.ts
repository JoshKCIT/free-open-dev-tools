/**
 * POSIX shell word quoting (POSIX.1-2017 Shell Command Language, section
 * 2.2 Quoting, 2.2.1 Escape Character, 2.2.2 Single-Quotes, 2.2.3
 * Double-Quotes). `{`, `}` and `!` are read literally, as a plain POSIX `sh`
 * does; bash/zsh brace and history expansion are not modelled.
 */
import { StringEscapeError, type LiteralResult } from './shared';

const UNQUOTED_FORBIDDEN = new Set(['$', '`', '*', '?', '[', ']', '|', '&', ';', '<', '>', '(', ')']);

export function escape(text: string): LiteralResult {
  const nul = text.indexOf('\0');
  if (nul !== -1) {
    throw new StringEscapeError('a shell argument cannot contain NUL', nul);
  }
  if (text === '') return { value: "''", warnings: [] };
  return { value: "'" + text.replace(/'/g, "'\\''") + "'", warnings: [] };
}

export function unescape(text: string): LiteralResult {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) {
        throw new StringEscapeError('this single quote is never closed', i);
      }
      out += text.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        const c = text[j]!;
        if (c === '"') {
          closed = true;
          j++;
          break;
        }
        if (c === '$' || c === '`') {
          throw new StringEscapeError(`"${c}" is not literal inside double quotes: a shell would expand it`, j);
        }
        if (c === '\\') {
          const n = text[j + 1];
          if (n === '$' || n === '`' || n === '"' || n === '\\') {
            out += n;
            j += 2;
            continue;
          }
          if (n === '\n') {
            j += 2;
            continue;
          }
          out += c;
          j++;
          continue;
        }
        out += c;
        j++;
      }
      if (!closed) {
        throw new StringEscapeError('this double quote is never closed', i);
      }
      i = j;
      continue;
    }
    if (ch === '\\') {
      const n = text[i + 1];
      if (n === undefined) {
        throw new StringEscapeError('a reverse solidus at the end of the input has nothing to escape', i);
      }
      if (n === '\n') {
        i += 2;
        continue;
      }
      out += n;
      i += 2;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      throw new StringEscapeError('an unquoted space, tab or newline would split this into more than one word', i);
    }
    if (ch === '~' && i === 0) {
      throw new StringEscapeError('a leading "~" would be expanded to a home directory by a shell', i);
    }
    if (ch === '#' && i === 0) {
      throw new StringEscapeError('a leading "#" starts a comment in a shell', i);
    }
    if (UNQUOTED_FORBIDDEN.has(ch)) {
      throw new StringEscapeError(`"${ch}" is not literal outside quotes: a shell would expand or use it`, i);
    }
    out += ch;
    i++;
  }
  return { value: out, warnings: [] };
}
