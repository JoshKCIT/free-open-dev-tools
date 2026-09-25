/**
 * RFC 9535 JSONPath evaluation, wrapping the jsonpath-rfc9535 library.
 *
 * Pure logic only: no timers, no background thread and no clock read
 * anywhere in this file. A query that runs too long is a page-side
 * concern -- the worker bridge and its own time limit live in
 * apps/web/src/lib, never here.
 */
import meta from './meta.json';
import { exec } from 'jsonpath-rfc9535';
import { parseJsonText } from './json-text';

export { meta };

export interface JsonPathMatch {
  /** The RFC 9535 Normalized Path (section 2.7) of this match, e.g. "$['store']['book'][0]['author']". */
  path: string;
  value: unknown;
}

export interface JsonPathResult {
  matches: JsonPathMatch[];
}

export class JsonPathError extends Error {
  readonly kind: 'document' | 'expression';
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, kind: 'document' | 'expression', line?: number, column?: number) {
    super(message);
    this.name = 'JsonPathError';
    this.kind = kind;
    this.line = line;
    this.column = column;
  }
}

type PathSegment = string | number;

/**
 * Builds an RFC 9535 Normalized Path (section 2.7) from the raw path array
 * jsonpath-rfc9535's `exec` reports. Each string segment the library hands
 * back is already escaped per its own `toNormalizedKey` (backslash, single
 * quote and the control characters section 2.7 names), so this only needs
 * to add the canonical bracket notation around each segment: a number
 * becomes `[n]`, a string becomes `['already-escaped-text']`.
 */
function normalizedPath(segments: PathSegment[]): string {
  let out = '$';
  for (const segment of segments) {
    out += typeof segment === 'number' ? `[${segment}]` : `['${segment}']`;
  }
  return out;
}

/**
 * Evaluates an RFC 9535 JSONPath expression against a JSON document given
 * as text. Parses the document with `parseJsonText` (an RFC 8259 parse
 * with an engine-independent error position), then runs the expression
 * once with the library's own `exec`, collecting every match in the order
 * it reports them.
 */
export function evaluateJsonPath(documentText: string, expression: string): JsonPathResult {
  const parsed = parseJsonText(documentText);
  if (!parsed.ok) {
    throw new JsonPathError(
      parsed.message ?? 'The document could not be parsed.',
      'document',
      parsed.line,
      parsed.column,
    );
  }

  const matches: JsonPathMatch[] = [];
  try {
    exec(parsed.value as never, expression, (value, path) => {
      matches.push({ path: normalizedPath(path as PathSegment[]), value });
    });
  } catch (err) {
    // The library's own parser throws a PEG.js-generated SyntaxError with a
    // `location.start.{line,column}` object for every malformed expression
    // this session tested (including an incomplete filter and a missing
    // leading root identifier). When a thrown value carries no such shape
    // -- which this session did not observe, but a future library version
    // could -- the column and line are simply omitted rather than guessed.
    const location = (err as { location?: { start?: { line?: number; column?: number } } } | undefined)?.location;
    throw new JsonPathError(
      err instanceof Error ? err.message : 'This expression is not valid RFC 9535 JSONPath.',
      'expression',
      location?.start?.line,
      location?.start?.column,
    );
  }
  return { matches };
}
