/**
 * Test-only decoders for each target language's string literal rules. Each
 * one implements the same escape table its emitter used to write the
 * literal in the first place, so the round-trip test proves the emitted
 * text really does decode back to the exact source value, not just that the
 * emitter and the decoder happen to agree with each other by construction.
 */

/** POSIX single-quoted string: `'...'` with `'\''` as the only escape (close, escaped quote, reopen). */
export function decodePosixSingleQuoted(literal: string): string {
  if (!literal.startsWith("'") || !literal.endsWith("'")) {
    throw new Error(`Not a POSIX single-quoted literal: ${literal}`);
  }
  return literal.slice(1, -1).split("'\\''").join("'");
}

/** JavaScript double-quoted string produced by `JSON.stringify`: valid JSON, so `JSON.parse` is the correct decoder. */
export function decodeJsString(literal: string): string {
  const value: unknown = JSON.parse(literal);
  if (typeof value !== 'string') throw new Error(`Not a JS string literal: ${literal}`);
  return value;
}

function decodeEscapedDouble(literal: string, extra: Record<string, string> = {}): string {
  if (!literal.startsWith('"') || !literal.endsWith('"')) {
    throw new Error(`Not a double-quoted literal: ${literal}`);
  }
  const body = literal.slice(1, -1);
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) throw new Error(`Trailing backslash in literal: ${literal}`);
    if (next === 'n') {
      out += '\n';
      i++;
    } else if (next === 'r') {
      out += '\r';
      i++;
    } else if (next === 't') {
      out += '\t';
      i++;
    } else if (next === '\\') {
      out += '\\';
      i++;
    } else if (next === '"') {
      out += '"';
      i++;
    } else if (next === 'x') {
      const hex = body.slice(i + 2, i + 4);
      out += String.fromCharCode(parseInt(hex, 16));
      i += 3;
    } else if (next in extra) {
      out += extra[next];
      i++;
    } else {
      throw new Error(`Unknown escape \\${next} in literal: ${literal}`);
    }
  }
  return out;
}

/** Python double-quoted string literal (backslash, quote, \n \r \t, other controls as \xNN). */
export function decodePythonString(literal: string): string {
  return decodeEscapedDouble(literal);
}

/** Go interpreted string literal (the Go spec's escapes: same table as this project's other targets, no $ escape). */
export function decodeGoString(literal: string): string {
  return decodeEscapedDouble(literal);
}

/** PHP string literal: single-quoted (only \\ and \' recognised) or double-quoted (adds \$, \n \r \t, \xNN). */
export function decodePhpString(literal: string): string {
  if (literal.startsWith("'")) {
    if (!literal.endsWith("'")) throw new Error(`Not a PHP single-quoted literal: ${literal}`);
    const body = literal.slice(1, -1);
    let out = '';
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (ch === '\\' && (body[i + 1] === '\\' || body[i + 1] === "'")) {
        out += body[i + 1];
        i++;
      } else {
        out += ch;
      }
    }
    return out;
  }
  return decodeEscapedDouble(literal, { $: '$' });
}

/**
 * Decodes one HTTPie request item (`name:value`, `name=value` or
 * `name@value`) back to its `[name, value, separator]` triple, undoing the
 * backslash-escaping this package's `emitHttpie` applies to a literal
 * separator character inside the name.
 */
export function decodeHttpieItem(item: string): { name: string; value: string; separator: ':' | '=' | '@' } {
  let name = '';
  let i = 0;
  for (; i < item.length; i++) {
    const ch = item[i]!;
    if (ch === '\\' && i + 1 < item.length) {
      name += item[i + 1];
      i++;
      continue;
    }
    if (ch === ':' || ch === '=' || ch === '@') {
      return { name, value: item.slice(i + 1), separator: ch };
    }
    name += ch;
  }
  throw new Error(`No unescaped separator found in HTTPie item: ${item}`);
}
