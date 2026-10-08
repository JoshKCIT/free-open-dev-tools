/**
 * Reads a pasted text one line at a time, the way git reads a message: lines end at a line feed, one carriage return
 * before the line feed is dropped (so a message saved with Windows line ends reads the same), and a byte order mark at the
 * very start is dropped. Line numbers start at 1 and count every line, blank ones included, so a number shown to the
 * visitor is the number in what they pasted.
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

/** Every line of a text, in order. */
export function splitLines(text: string): string[] {
  const lines: string[] = [];
  forEachLine(text, (line) => {
    lines.push(line);
  });
  return lines;
}

/** A line with nothing on it but white space is blank. */
export function isBlank(line: string): boolean {
  return line.trim() === '';
}
