/**
 * Splits property-line text into raw path/value assignments, one per
 * non-empty line. This module is deliberately syntax-only: it does not know
 * anything about schema.org's own vocabulary. `index.ts`'s `buildJsonLd`
 * decides which paths are real schema.org properties and how the value is
 * written into the output object; a path segment that turns out not to be
 * one (including `__proto__` and `constructor`, which are never registered
 * schema.org property names) is refused there, before it is ever used to
 * write an object key (T-06-24).
 */

export interface PropertyAssignment {
  /** Dot-separated path segments, in order: a property name, a 1-based list index (digits only), or "@type". */
  path: string[];
  value: string;
  /** 1-based line number in the original text. */
  line: number;
}

export interface PropertyLineProblem {
  line: number;
  message: string;
}

export interface ParsePropertyLinesResult {
  assignments: PropertyAssignment[];
  problems: PropertyLineProblem[];
}

/**
 * Parses `path: value` lines. The first colon on a line separates the path
 * from the value; a value may itself contain more colons (for example a URL).
 * A path is dot-separated segments: a property name, a 1-based list index
 * (a run of ASCII digits), or the literal `@type`.
 */
export function parsePropertyLines(text: string): ParsePropertyLinesResult {
  const assignments: PropertyAssignment[] = [];
  const problems: PropertyLineProblem[] = [];

  const rawLines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const line = i + 1;
    if (raw.trim().length === 0) continue;

    const colon = raw.indexOf(':');
    if (colon === -1) {
      problems.push({ line, message: `"${raw.trim()}" has no ":" separating a path from a value.` });
      continue;
    }

    const pathText = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();

    if (pathText.length === 0) {
      problems.push({ line, message: 'This line has no path before the ":".' });
      continue;
    }

    const segments = pathText.split('.');
    if (segments.some((s) => s.length === 0)) {
      problems.push({
        line,
        message: `"${pathText}" has an empty path segment (two dots in a row, or a leading or trailing dot).`,
      });
      continue;
    }

    let badIndex: string | null = null;
    for (const seg of segments) {
      if (/^[0-9]+$/.test(seg) && seg === '0') {
        badIndex = seg;
        break;
      }
    }
    if (badIndex !== null) {
      problems.push({ line, message: `"${pathText}" uses list index 0; list indices start at 1.` });
      continue;
    }

    const atTypeIndex = segments.indexOf('@type');
    if (atTypeIndex !== -1 && atTypeIndex !== segments.length - 1) {
      problems.push({ line, message: `"${pathText}": "@type" must be the last part of a path.` });
      continue;
    }

    assignments.push({ path: segments, value, line });
  }

  return { assignments, problems };
}
