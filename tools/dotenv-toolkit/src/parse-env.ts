/**
 * A hand-rolled `.env` parser following dotenv's own documented parsing
 * rules (README, and the `LINE` pattern and `parse` function read directly
 * from `lib/main.js` at the pinned tag): an optional `export ` prefix, a key
 * of letters, digits, underscore, dot or hyphen, a `=` or a colon followed
 * by whitespace as the separator, and a value that is either single-,
 * double- or backtick-quoted (each closed only by its own quote character,
 * an escaped same-type quote inside kept as a literal quote) or unquoted and
 * cut at the first `#` (an inline comment needs no leading space). Escape
 * sequences `\n` and `\r` are expanded only inside double-quoted values,
 * exactly as dotenv's own regex-based parser does; a quoted value may span
 * multiple physical lines. Later duplicate keys win, following dotenv's own
 * parse loop, which simply overwrites the same object property again.
 */
import { setOwn } from './own-property';

export interface EnvEntry {
  key: string;
  value: string;
  /** 1-based line the key was declared on (the line the separator was read from). */
  line: number;
  quote: 'single' | 'double' | 'backtick' | 'none';
}

export interface EnvProblem {
  line: number;
  message: string;
}

export interface ParseEnvResult {
  entries: EnvEntry[];
  problems: EnvProblem[];
}

const KEY_PATTERN = /^[A-Za-z0-9_.-]+$/;
const KEY_CHAR = /[A-Za-z0-9_.-]/;

function isSpaceOrTab(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}

/** Finds the first `=` or `: ` separator in a line's text, ignoring one inside nothing (this scan runs only on the still-unparsed remainder of a line). */
function findSeparator(line: string): { index: number; length: number } | undefined {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '=') return { index: i, length: 1 };
    if (line[i] === ':' && isSpaceOrTab(line[i + 1])) return { index: i, length: 1 };
  }
  return undefined;
}

/** Parses `text` into entries and problems, following the dotenv rules described above. Never throws: every malformed line becomes a problem instead. */
export function parseEnv(text: string): ParseEnvResult {
  const normalized = text.replace(/\r\n?/g, '\n');
  const len = normalized.length;
  const entries: EnvEntry[] = [];
  const problems: EnvProblem[] = [];
  const byKey = new Map<string, number>(); // key -> index into entries, for last-wins overwrite

  let i = 0;
  let line = 1;

  function skipToEndOfLine(): void {
    while (i < len && normalized[i] !== '\n') i++;
  }

  function consumeNewlineIfPresent(): void {
    if (i < len && normalized[i] === '\n') {
      i++;
      line++;
    }
  }

  while (i < len) {
    const lineStart = line;

    // Skip leading spaces/tabs on this line.
    while (isSpaceOrTab(normalized[i])) i++;

    if (i >= len) break;

    if (normalized[i] === '\n') {
      consumeNewlineIfPresent();
      continue;
    }

    if (normalized[i] === '#') {
      skipToEndOfLine();
      consumeNewlineIfPresent();
      continue;
    }

    // Optional "export " prefix.
    let cursor = i;
    if (normalized.startsWith('export', cursor) && isSpaceOrTab(normalized[cursor + 6])) {
      let next = cursor + 6;
      while (isSpaceOrTab(normalized[next])) next++;
      if (KEY_CHAR.test(normalized[next] ?? '')) cursor = next;
    }

    const keyStart = cursor;
    while (cursor < len && KEY_CHAR.test(normalized[cursor]!)) cursor++;
    const key = normalized.slice(keyStart, cursor);

    // Skip whitespace before the separator.
    let sepPos = cursor;
    while (isSpaceOrTab(normalized[sepPos])) sepPos++;

    const isEquals = normalized[sepPos] === '=';
    const isColon = normalized[sepPos] === ':' && isSpaceOrTab(normalized[sepPos + 1]);

    if (key === '' || (!isEquals && !isColon)) {
      // Not a recognised name=value line. Report the specific reason: an
      // invalid key name if a separator exists further along this physical
      // line, otherwise this line simply is not a name=value pair.
      let lineEnd = i;
      while (lineEnd < len && normalized[lineEnd] !== '\n') lineEnd++;
      const restOfLine = normalized.slice(i, lineEnd);
      const sep = findSeparator(restOfLine);
      if (sep && sep.index > 0) {
        const candidate = restOfLine.slice(0, sep.index).trim();
        if (candidate !== '' && !KEY_PATTERN.test(candidate)) {
          problems.push({
            line: lineStart,
            message: `"${candidate}" is not a name dotenv accepts (letters, digits, underscore, dot or hyphen only).`,
          });
          skipToEndOfLine();
          consumeNewlineIfPresent();
          continue;
        }
      }
      problems.push({ line: lineStart, message: 'This line is not a name=value pair and was ignored.' });
      skipToEndOfLine();
      consumeNewlineIfPresent();
      continue;
    }

    // Move past the separator.
    i = isColon ? sepPos + 2 : sepPos + 1;
    while (isSpaceOrTab(normalized[i])) i++;

    let quote: EnvEntry['quote'] = 'none';
    let value = '';
    const quoteChar = normalized[i];

    if (quoteChar === "'" || quoteChar === '"' || quoteChar === '`') {
      const closeChar = quoteChar;
      const start = i + 1;
      let end = start;
      let closed = false;
      let raw = '';
      while (end < len) {
        if (normalized[end] === '\\' && normalized[end + 1] === closeChar) {
          raw += closeChar;
          end += 2;
          continue;
        }
        if (normalized[end] === closeChar) {
          closed = true;
          break;
        }
        raw += normalized[end];
        end++;
      }
      if (closed) {
        quote = closeChar === "'" ? 'single' : closeChar === '"' ? 'double' : 'backtick';
        value = closeChar === '"' ? raw.replace(/\\n/g, '\n').replace(/\\r/g, '\r') : raw;
        // Count newlines consumed inside a multi-line quoted value.
        for (const ch of normalized.slice(i, end)) if (ch === '\n') line++;
        i = end + 1;
      }
    }

    if (quote === 'none' && quoteChar !== undefined) {
      // Either not a quote character, or an unterminated quote (falls back
      // to the unquoted form, matching how the alternation in dotenv's own
      // LINE regex would fail the quoted branch and try the next one).
      let end = i;
      while (end < len && normalized[end] !== '#' && normalized[end] !== '\n') end++;
      value = normalized.slice(i, end).trim();
      i = end;
    }

    // Skip trailing whitespace, then discard anything left on the line (an
    // inline comment, or -- for a malformed but partially-parsed line --
    // whatever garbage follows).
    while (isSpaceOrTab(normalized[i])) i++;
    skipToEndOfLine();

    const entry: EnvEntry = { key, value, line: lineStart, quote };
    const existingIndex = byKey.get(key);
    if (existingIndex !== undefined) {
      problems.push({
        line: lineStart,
        message: `Key "${key}" was already given a value at line ${entries[existingIndex]!.line}; this later value wins.`,
      });
      entries[existingIndex] = entry;
    } else {
      byKey.set(key, entries.length);
      entries.push(entry);
    }

    consumeNewlineIfPresent();
  }

  return { entries, problems };
}

/** Builds a plain object from parsed entries, later duplicates already resolved by `parseEnv` itself, written with `setOwn` so a key such as `__proto__` stays an own key. */
export function entriesToObject(entries: EnvEntry[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const entry of entries) setOwn(obj, entry.key, entry.value);
  return obj;
}
