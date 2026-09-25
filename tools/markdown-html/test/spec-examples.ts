/**
 * Extracts numbered examples from a CommonMark-format `spec.txt`, at test
 * time. A direct port of upstream `commonmark/commonmark-spec`'s own
 * `test/spec_tests.py` (`get_tests`), fetched and read this session: a
 * thirty-two-backtick `example` fence opens an example, a line reading
 * exactly `.` separates the Markdown part from the HTML part, and a plain
 * thirty-two-backtick line closes it; `->` (recorded upstream as the
 * character U+2192, "RIGHTWARDS ARROW") is replaced with a literal tab in
 * both parts; the nearest preceding Markdown heading line (one or more `#`
 * then a space) is the example's section. Extended, beyond upstream's own
 * script, to also capture an optional extension tag written after the word
 * `example` on the open-fence line (used by `github/cmark-gfm`'s own
 * `test/spec.txt`, e.g. `` ```` example table ``) -- upstream's own script
 * ignores the rest of that line, but this project's tests key on that tag.
 * Test-only: never imported by package source.
 */

/** One example extracted from a spec.txt file. */
export interface SpecExample {
  /** 1-based, counted across every example in the file in document order (upstream's own numbering). */
  number: number;
  /** The nearest preceding Markdown heading's text, with leading #s and surrounding whitespace stripped. */
  section: string;
  /** The extension tag written after "example" on the open-fence line, or undefined for a plain example. */
  extension?: string;
  /** The example's Markdown input, exactly as written upstream (arrow substituted for tab). */
  markdown: string;
  /** The example's expected HTML output, exactly as written upstream (arrow substituted for tab). */
  html: string;
}

const FENCE = '`'.repeat(32);
const OPEN_FENCE_RE = new RegExp(`^${FENCE} example(?: (\\S+))?\\s*$`);
const CLOSE_FENCE_RE = new RegExp(`^${FENCE}\\s*$`);
const HEADING_RE = /^(#{1,6})[ \t]+(.*\S)\s*$/;

/** Replaces the upstream arrow character (U+2192) with a literal tab, exactly as spec_tests.py does. */
function arrowToTab(text: string): string {
  return text.replace(/→/g, '\t');
}

/**
 * Parses `specText` (a whole vendored `spec.txt` file) into its numbered
 * examples, in document order.
 */
export function readSpecExamples(specText: string): SpecExample[] {
  const lines = specText.split(/\r?\n/);
  const examples: SpecExample[] = [];

  let section = '';
  let number = 0;
  // 0 = regular text, 1 = reading the Markdown part, 2 = reading the HTML part.
  let state: 0 | 1 | 2 = 0;
  let extension: string | undefined;
  let markdownLines: string[] = [];
  let htmlLines: string[] = [];

  for (const rawLine of lines) {
    if (state === 0) {
      const headingMatch = HEADING_RE.exec(rawLine);
      if (headingMatch) {
        section = headingMatch[2] ?? '';
        continue;
      }
      const openMatch = OPEN_FENCE_RE.exec(rawLine);
      if (openMatch) {
        state = 1;
        extension = openMatch[1];
        markdownLines = [];
        htmlLines = [];
      }
      continue;
    }

    if (state === 1) {
      if (rawLine === '.') {
        state = 2;
        continue;
      }
      markdownLines.push(rawLine);
      continue;
    }

    // state === 2
    if (CLOSE_FENCE_RE.test(rawLine)) {
      state = 0;
      number++;
      examples.push({
        number,
        section,
        extension,
        markdown: arrowToTab(markdownLines.map((l) => l + '\n').join('')),
        html: arrowToTab(htmlLines.map((l) => l + '\n').join('')),
      });
      continue;
    }
    htmlLines.push(rawLine);
  }

  return examples;
}
