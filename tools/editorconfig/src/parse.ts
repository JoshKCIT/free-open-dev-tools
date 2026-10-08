import { EditorConfigError } from './errors';
import { forEachLine } from './lines';
import { MAX_KEY, MAX_LINE_CHARACTERS, MAX_SECTION_NAME, MAX_VALUE, withCommas } from './limits';

/** One `key = value` line inside a section. The key is lower-cased; the value is trimmed and otherwise as written. */
export interface ParsedPair {
  key: string;
  value: string;
  /** The line of the file, counting from 1. */
  line: number;
}

/** One `[glob]` header and the pairs under it, in file order. */
export interface ParsedSection {
  /** What stands between the first `[` and the last `]` of the header line. */
  name: string;
  line: number;
  pairs: ParsedPair[];
}

/** A line the file format has no place for. It is skipped and reported, never an error. */
export interface ParseProblem {
  line: number;
  message: string;
}

export interface ParsedFile {
  /** True when the lines before the first section hold `root = true` (the value is read without regard to case). */
  root: boolean;
  sections: ParsedSection[];
  problems: ParseProblem[];
}

/** How many characters a text holds, counting a character outside the basic plane once. Only runs on text over a limit. */
function characters(text: string): number {
  let count = 0;
  for (const character of text) count += character.length > 0 ? 1 : 0;
  return count;
}

function overLimit(text: string, limit: number): number {
  if (text.length <= limit) return 0;
  const count = characters(text);
  return count > limit ? count : 0;
}

/**
 * Reads one EditorConfig file as the specification (version 0.17.2) describes it: lines are trimmed; blank lines and lines
 * that start with `;` or `#` are ignored; a line that starts with `[` and ends with `]` opens a section named by what lies
 * between them; any other line is split at its first `=` into a key (lower-cased) and a value, both trimmed, and a `;` or
 * `#` anywhere else in a line starts no comment. Pairs before the first section are the preamble: only `root` is read there.
 *
 * A section name over 1,024 characters, a key over 1,024 or a value over 4,096 is refused naming the file and the line, and
 * so is a line over 8,192 characters. A line with no `=` or with an empty key is skipped and reported in `problems`.
 * `fileName` only labels a refusal.
 */
export function parseEditorConfig(text: string, fileName = 'The file'): ParsedFile {
  const parsed: ParsedFile = { root: false, sections: [], problems: [] };
  let section: ParsedSection | null = null;
  forEachLine(text, (raw, number) => {
    if (raw.length > MAX_LINE_CHARACTERS) {
      throw new EditorConfigError(
        `the line is ${withCommas(raw.length)} characters long and this page reads lines of at most ${withCommas(MAX_LINE_CHARACTERS)}.`,
        fileName,
        number,
      );
    }
    const line = raw.trim();
    if (line === '') return;
    const first = line.charCodeAt(0);
    if (first === 0x3b || first === 0x23) return;
    if (first === 0x5b && line.length >= 2 && line.charCodeAt(line.length - 1) === 0x5d) {
      const name = line.slice(1, -1);
      const count = overLimit(name, MAX_SECTION_NAME);
      if (count > 0) {
        throw new EditorConfigError(
          `the section name is ${withCommas(count)} characters long and this page reads names of at most ${withCommas(MAX_SECTION_NAME)}.`,
          fileName,
          number,
        );
      }
      section = { name, line: number, pairs: [] };
      parsed.sections.push(section);
      return;
    }
    const equals = line.indexOf('=');
    if (equals < 0) {
      parsed.problems.push({
        line: number,
        message: 'this line is not a section header, a comment or a key = value pair, so it is ignored.',
      });
      return;
    }
    const rawKey = line.slice(0, equals).trim();
    if (rawKey === '') {
      parsed.problems.push({
        line: number,
        message: 'the key before the equals sign is empty, so the line is ignored.',
      });
      return;
    }
    const keyCount = overLimit(rawKey, MAX_KEY);
    if (keyCount > 0) {
      throw new EditorConfigError(
        `the key is ${withCommas(keyCount)} characters long and this page reads keys of at most ${withCommas(MAX_KEY)}.`,
        fileName,
        number,
      );
    }
    const value = line.slice(equals + 1).trim();
    const valueCount = overLimit(value, MAX_VALUE);
    if (valueCount > 0) {
      throw new EditorConfigError(
        `the value is ${withCommas(valueCount)} characters long and this page reads values of at most ${withCommas(MAX_VALUE)}.`,
        fileName,
        number,
      );
    }
    const key = rawKey.toLowerCase();
    if (section === null) {
      if (key === 'root') parsed.root = value.toLowerCase() === 'true';
      return;
    }
    section.pairs.push({ key, value, line: number });
  });
  return parsed;
}
