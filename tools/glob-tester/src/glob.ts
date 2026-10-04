import picomatch from 'picomatch';
import { GlobTesterError } from './errors';
import { MAX_ALSO_LINES, MAX_REGEX_SHOWN } from './limits';
import { forEachLine, isBlank, parsePaths } from './lines';

/** One path's answer in glob mode. */
export interface GlobRow {
  /** The path as pasted, without the `/` that marks a directory. */
  path: string;
  matched: boolean;
  /** The first pattern line that matched, counting every pasted line; null when none did. */
  line: number | null;
  /** The text of that first matching line; empty when none matched. */
  pattern: string;
  /** Other pattern lines that matched too, in line order, at most MAX_ALSO_LINES of them. */
  also: number[];
  /** How many more matching lines there were than `also` names. */
  moreAlso: number;
}

/** The regular expression one pattern line became, for showing. */
export interface GlobRegex {
  line: number;
  source: string;
  /** True when the source was longer than MAX_REGEX_SHOWN and has been cut. */
  truncated: boolean;
}

interface Compiled {
  line: number;
  text: string;
  isMatch: (path: string) => boolean;
}

/**
 * Matches each pasted path against each pattern line with picomatch. Every call passes `windows: false`: picomatch
 * otherwise reads `navigator.platform` and would treat a backslash as a separator on a Windows visitor's machine, so the
 * platform a browser reports must never change a result. Each pattern line is compiled once; blank lines are skipped
 * but still count, so a line number is the number in the pasted text. A leading ! and braces, extglobs and `**` follow
 * picomatch's documented behaviour.
 */
export function globRows(
  patterns: string,
  paths: string,
  options: { dot: boolean; nocase: boolean },
): { rows: GlobRow[]; regexes: GlobRegex[] } {
  const compiled: Compiled[] = [];
  const regexes: GlobRegex[] = [];
  forEachLine(patterns, (text, line) => {
    if (isBlank(text)) return;
    try {
      const isMatch = picomatch(text, { windows: false, dot: options.dot, nocase: options.nocase });
      const source = picomatch.makeRe(text, { windows: false, dot: options.dot, nocase: options.nocase }).source;
      compiled.push({ line, text, isMatch });
      regexes.push({
        line,
        source: source.length > MAX_REGEX_SHOWN ? source.slice(0, MAX_REGEX_SHOWN) : source,
        truncated: source.length > MAX_REGEX_SHOWN,
      });
    } catch {
      // The library's own message can repeat the pattern; say only which line and what is wrong.
      throw new GlobTesterError(`Line ${line} of the patterns is not a glob that can be read.`, 'patterns', line);
    }
  });

  // Every path is checked before the first one is matched, so a refusal never follows partial work.
  const parsed = parsePaths(paths);
  const answers = new Map<string, Omit<GlobRow, 'path'>>();
  const rows: GlobRow[] = [];
  for (const { path } of parsed) {
    let answer = answers.get(path);
    if (answer === undefined) {
      let first: Compiled | undefined;
      const also: number[] = [];
      let moreAlso = 0;
      for (const pattern of compiled) {
        if (!pattern.isMatch(path)) continue;
        if (first === undefined) first = pattern;
        else if (also.length < MAX_ALSO_LINES) also.push(pattern.line);
        else moreAlso += 1;
      }
      answer = {
        matched: first !== undefined,
        line: first === undefined ? null : first.line,
        pattern: first === undefined ? '' : first.text,
        also,
        moreAlso,
      };
      answers.set(path, answer);
    }
    rows.push({ path, ...answer, also: answer.also.slice() });
  }
  return { rows, regexes };
}
