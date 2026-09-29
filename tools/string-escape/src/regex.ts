/**
 * ECMAScript regular expression literal text (ECMA-262 Patterns,
 * SyntaxCharacter). Escapes exactly the characters that are syntactically
 * significant everywhere in a pattern, plus `/` (which ends a `/.../`
 * literal). The result is meant for use outside a character class.
 */
import { StringEscapeError, type LiteralResult } from './shared';

const SYNTAX_CHARS = new Set(['^', '$', '\\', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|']);

export function escape(text: string): LiteralResult {
  let out = '';
  for (const ch of text) {
    out += SYNTAX_CHARS.has(ch) || ch === '/' ? '\\' + ch : ch;
  }
  return { value: out, warnings: [] };
}

export function unescape(text: string): LiteralResult {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) {
        throw new StringEscapeError('a reverse solidus at the end of the input has nothing to escape', i);
      }
      if (SYNTAX_CHARS.has(next) || next === '/') {
        out += next;
        i += 2;
        continue;
      }
      throw new StringEscapeError(`"\\${next}" is not a literal character: it is a regular-expression escape`, i);
    }
    if (SYNTAX_CHARS.has(ch)) {
      throw new StringEscapeError(`"${ch}" is a regular-expression operator, not a literal character`, i);
    }
    out += ch;
    i++;
  }
  return { value: out, warnings: [] };
}
