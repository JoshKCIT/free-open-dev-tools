import { GlobTesterError } from './errors';

/**
 * Reads a pasted text one line at a time, the way git reads a .gitignore file: lines end at a line feed, one carriage
 * return before the line feed is dropped (so a file saved with Windows line ends reads the same), and a byte order mark
 * at the very start is dropped. Line numbers start at 1 and count every line, blank ones included, so a number shown to
 * the visitor is the number in what they pasted.
 *
 * One pass with `indexOf`, no regular expression, no array of lines: a paste of millions of line feeds costs one visit
 * each and nothing is kept.
 */
export function forEachLine(text: string, visit: (line: string, number: number) => void): void {
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let number = 1;
  for (;;) {
    const lineFeed = text.indexOf('\n', start);
    if (lineFeed < 0) {
      visit(text.slice(start), number);
      return;
    }
    const end = lineFeed > start && text.charCodeAt(lineFeed - 1) === 13 ? lineFeed - 1 : lineFeed;
    visit(text.slice(start, end), number);
    start = lineFeed + 1;
    number += 1;
  }
}

/** Every line of a text with its pasted line number. */
export function splitLines(text: string): { text: string; line: number }[] {
  const lines: { text: string; line: number }[] = [];
  forEachLine(text, (lineText, line) => {
    lines.push({ text: lineText, line });
  });
  return lines;
}

/** A line with nothing on it but white space matches nothing and is skipped by both modes. */
export function isBlank(line: string): boolean {
  return line.trim() === '';
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function refuse(line: number, problem: string): GlobTesterError {
  return new GlobTesterError(`Line ${line} of the paths ${problem}`, 'paths', line);
}

/**
 * Checks one path line. A path is relative to the top of the repository, written with forward slashes; a trailing `/`
 * says it is a directory and is removed. A path that is absolute, starts with ./ or ../, holds a . or .. segment, a
 * backslash or an empty segment is refused with its line number and nothing of its text.
 */
export function checkPath(path: string, line: number): { path: string; isDirectory: boolean } {
  if (path.charCodeAt(0) === 47)
    throw refuse(line, 'is an absolute path. Write paths relative to the top of the repository.');
  if (path.length >= 3 && isAsciiLetter(path.charCodeAt(0)) && path.charCodeAt(1) === 58 && path.charCodeAt(2) === 47) {
    throw refuse(
      line,
      'is an absolute path (it starts with a drive letter). Write paths relative to the top of the repository.',
    );
  }
  if (path.startsWith('./') || path.startsWith('../')) throw refuse(line, 'starts with ./ or ../. Remove it.');
  if (path.includes('\\')) throw refuse(line, 'holds a backslash. Use / between folders.');

  const isDirectory = path.endsWith('/');
  const name = isDirectory ? path.slice(0, -1) : path;
  for (const segment of name.split('/')) {
    if (segment === '') throw refuse(line, 'holds an empty segment (two / in a row).');
    if (segment === '.' || segment === '..')
      throw refuse(line, 'holds a . or .. segment. Write the path from the top of the repository.');
  }
  return { path: name, isDirectory };
}

/** Every non-blank path line, checked, in pasted order (a path pasted twice appears twice). */
export function parsePaths(text: string): { path: string; isDirectory: boolean }[] {
  const parsed: { path: string; isDirectory: boolean }[] = [];
  forEachLine(text, (lineText, line) => {
    if (isBlank(lineText)) return;
    parsed.push(checkPath(lineText, line));
  });
  return parsed;
}
