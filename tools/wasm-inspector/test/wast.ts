/**
 * A small reader for the `.wast` files of the WebAssembly testsuite: just enough of the text format to pull out the
 * `(module binary ...)` forms that must read and the `assert_malformed (module binary ...)` forms that must be refused,
 * with the message the suite states. S-expressions, line and block comments and the string escapes `\n`, `\t`, `\r`,
 * `\"`, `\'`, `\\`, `\u{..}` and `\hh` are understood; everything else in a file is skipped.
 */

export interface Str {
  str: Uint8Array;
}
export type Sexp = string | Str | Sexp[];

export interface WastModule {
  /** `valid` for a bare `(module binary ...)`; `malformed` for one inside `assert_malformed`. */
  kind: 'valid' | 'malformed';
  bytes: Uint8Array;
  /** The message of an `assert_malformed`, else the empty string. */
  message: string;
  /** The position among all binary modules of the file (the number the tests quote). */
  index: number;
}

function isStr(x: Sexp | undefined): x is Str {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function sexprs(text: string): Sexp[] {
  const out: Sexp[] = [];
  const stack: Sexp[][] = [];
  const push = (x: Sexp): void => {
    const top = stack[stack.length - 1];
    if (top === undefined) out.push(x);
    else top.push(x);
  };
  const encoder = new TextEncoder();
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === ';' && text[i + 1] === ';') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '(' && text[i + 1] === ';') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === '(' && text[i + 1] === ';') {
          depth++;
          i += 2;
        } else if (text[i] === ';' && text[i + 1] === ')') {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    if (ch === '(') {
      stack.push([]);
      i++;
      continue;
    }
    if (ch === ')') {
      const done = stack.pop();
      if (done === undefined) throw new Error('unbalanced parenthesis');
      push(done);
      i++;
      continue;
    }
    if (ch === '"') {
      const bytes: number[] = [];
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\') {
          const e = text[i + 1]!;
          if (e === 'n') {
            bytes.push(10);
            i += 2;
          } else if (e === 't') {
            bytes.push(9);
            i += 2;
          } else if (e === 'r') {
            bytes.push(13);
            i += 2;
          } else if (e === '"' || e === "'" || e === '\\') {
            bytes.push(e.charCodeAt(0));
            i += 2;
          } else if (e === 'u') {
            const close = text.indexOf('}', i);
            bytes.push(...encoder.encode(String.fromCodePoint(parseInt(text.slice(i + 3, close), 16))));
            i = close + 1;
          } else {
            bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
            i += 3;
          }
        } else {
          // The files are ASCII outside strings and in most strings; a non-ASCII character is kept as its UTF-8 bytes.
          const point = text.codePointAt(i)!;
          const char = String.fromCodePoint(point);
          bytes.push(...encoder.encode(char));
          i += char.length;
        }
      }
      i++;
      push({ str: Uint8Array.from(bytes) });
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !/[\s()";]/.test(text[j]!)) j++;
    push(text.slice(i, j));
    i = j;
  }
  if (stack.length > 0) throw new Error('unbalanced parenthesis');
  return out;
}

/** The bytes of a `(module ... binary "..." "...")` form, or null when the form is not a binary module. */
function moduleBytes(form: Sexp[]): Uint8Array | null {
  const at = form.indexOf('binary');
  if (form[0] !== 'module' || at < 0) return null;
  const parts = form
    .slice(at + 1)
    .filter(isStr)
    .map((part) => part.str);
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

/** Every binary module of a file, in file order, each with its kind and, for a malformed one, the stated message. */
export function extractModules(text: string): WastModule[] {
  const rows: WastModule[] = [];
  for (const form of sexprs(text)) {
    if (!Array.isArray(form)) continue;
    const head = form[0];
    if (head === 'module') {
      const bytes = moduleBytes(form);
      if (bytes !== null) rows.push({ kind: 'valid', bytes, message: '', index: rows.length });
    } else if (head === 'assert_malformed' && Array.isArray(form[1])) {
      const bytes = moduleBytes(form[1]);
      const stated = form[2];
      if (bytes !== null) {
        const message = isStr(stated) ? new TextDecoder().decode(stated.str) : '';
        rows.push({ kind: 'malformed', bytes, message, index: rows.length });
      }
    }
  }
  return rows;
}
