/**
 * Reads a text one line at a time, the way the EditorConfig reference cores do: a line ends at a line feed, at a carriage
 * return followed by a line feed, or at a lone carriage return, and a byte order mark at the very start is dropped. Line
 * numbers start at 1 and count every line, blank ones included, so a number shown to the visitor is the number in what they
 * pasted. The last argument of `visit` is true for the final line, which is empty when the text ends with a line end.
 *
 * One pass over the characters, no regular expression, no array of lines: a paste of millions of line ends costs one visit
 * each and nothing is kept.
 */
export function forEachLine(text: string, visit: (line: string, number: number, last: boolean) => void): void {
  const length = text.length;
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let number = 1;
  for (let i = start; i < length; i++) {
    const code = text.charCodeAt(i);
    if (code !== 10 && code !== 13) continue;
    visit(text.slice(start, i), number, false);
    number += 1;
    if (code === 13 && text.charCodeAt(i + 1) === 10) i += 1;
    start = i + 1;
  }
  visit(text.slice(start), number, true);
}

/** Every line of a text, in order. */
export function splitLines(text: string): string[] {
  const lines: string[] = [];
  forEachLine(text, (line) => {
    lines.push(line);
  });
  return lines;
}
