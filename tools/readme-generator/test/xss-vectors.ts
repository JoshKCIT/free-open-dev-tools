/**
 * Extracts XSS payloads, at test time, from the vendored copy of the OWASP
 * XSS Filter Evasion Cheat Sheet under `test/fixtures/owasp-xss-filter-evasion/`.
 * Test-only: never imported by package source. Canonical, copied byte for
 * byte into every tool that needs the same payload list; this header names
 * no tool folder so it stays true wherever it lands.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHEAT_SHEET_PATH = join(HERE, 'fixtures', 'owasp-xss-filter-evasion', 'XSS_Filter_Evasion_Cheat_Sheet.md');

/** One payload extracted from the cheat sheet, with the nearest preceding heading as its source. */
export interface XssVector {
  /** The nearest preceding Markdown heading's text, with leading `#`s and surrounding whitespace stripped. */
  source: string;
  /** The fenced code block's body, exactly as written upstream. */
  payload: string;
}

/**
 * The payload count recorded in `UPSTREAM.md` at fetch time. Asserted equal
 * to what `loadXssVectors()` actually extracts, so a broken extractor (a
 * regex that stops matching after an upstream Markdown formatting change)
 * fails loudly instead of silently passing on zero payloads.
 */
export const EXPECTED_VECTOR_COUNT = 107;

/**
 * Reads the vendored cheat sheet and returns the body of every fenced code
 * block tagged ```` ```html ```` or ```` ```js ````, paired with the text of
 * the nearest Markdown heading above it.
 */
export function loadXssVectors(): XssVector[] {
  const text = readFileSync(CHEAT_SHEET_PATH, 'utf8');
  const lines = text.split(/\r?\n/);

  const vectors: XssVector[] = [];
  let currentHeading = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const headingMatch = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (headingMatch) {
      currentHeading = headingMatch[2] ?? '';
      i++;
      continue;
    }
    const fenceOpen = /^```(html|js)\s*$/.exec(line);
    if (fenceOpen) {
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        bodyLines.push(lines[i] ?? '');
        i++;
      }
      // i now points at the closing fence line (or end of file for a
      // malformed upstream document); either way, skip past it.
      i++;
      vectors.push({ source: currentHeading, payload: bodyLines.join('\n') });
      continue;
    }
    i++;
  }

  return vectors;
}
