import meta from './meta.json';
import { XMLValidator } from 'fast-xml-parser';
import { optimize } from 'svgo/browser';
import { sanitiseMarkup, describeRemoved, type RemovedSummary } from './sanitise';
import type { WindowLike } from 'dompurify';

export { meta };

export class SvgOptimizerError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'SvgOptimizerError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface OptimizeSvgOptions {
  /** Run the optimiser over its own output again until nothing more changes. Default true. */
  multipass?: boolean;
  /** Decimal places kept for numbers the optimiser rewrites. Negative values are clamped to 0. Default 3. */
  precision?: number;
  /** Pretty-print the optimised output instead of writing it on one line. Default false. */
  pretty?: boolean;
}

export interface OptimizeSvgResult {
  output: string;
  originalBytes: number;
  optimisedBytes: number;
  removed: RemovedSummary;
  warnings: string[];
}

const ENTITY_DOCTYPE_MESSAGE = 'This SVG declares entities in a DOCTYPE, so it was refused rather than expand them.';
const PLAIN_DOCTYPE_WARNING = 'A DOCTYPE declaration was removed; this page never reads DTDs or resolves entities.';
const NOT_SVG_MESSAGE = "This document's root element is not <svg>, so it was refused.";

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Finds a `<!DOCTYPE ...>` declaration, tracking bracket depth so an
 * internal subset's own `>` characters (e.g. inside an `<!ENTITY ...>`
 * declaration) never end the match early.
 */
function findDoctype(text: string): { full: string; start: number; hasInternalSubset: boolean } | null {
  const start = text.search(/<!DOCTYPE/i);
  if (start === -1) return null;

  let i = start + '<!DOCTYPE'.length;
  let bracketDepth = 0;
  let hasInternalSubset = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '[') {
      bracketDepth++;
      hasInternalSubset = true;
    } else if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (ch === '>' && bracketDepth === 0) {
      i++;
      break;
    }
    i++;
  }

  return { full: text.slice(start, i), start, hasInternalSubset };
}

/**
 * Removes any leading XML declaration, comments and processing instructions,
 * then reads the first element's tag name -- used only to check the root
 * element is `<svg>`, not to parse the whole document (`XMLValidator`
 * already proved it is well-formed XML by the time this runs).
 */
function findRootElementName(text: string): string | null {
  // Strip one leading byte-order mark, by code point rather than a literal
  // character in a regex, so this source file carries no invisible Unicode.
  let s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (;;) {
    const trimmed = s.replace(/^\s+/, '');
    if (trimmed.startsWith('<?')) {
      const end = trimmed.indexOf('?>');
      if (end === -1) return null;
      s = trimmed.slice(end + 2);
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      const end = trimmed.indexOf('-->');
      if (end === -1) return null;
      s = trimmed.slice(end + 3);
      continue;
    }
    s = trimmed;
    break;
  }
  const match = /^<\s*([A-Za-z_][\w:.-]*)/.exec(s);
  if (!match) return null;
  const name = match[1] ?? '';
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/**
 * Sanitises then optimises a pasted SVG. In order: (1) an entity-declaring
 * DOCTYPE is refused before anything parses it; a plain DOCTYPE is removed
 * with a warning; (2) malformed XML is refused with its line and column;
 * (3) the root element must be `svg`; (4) the sanitiser's `svg` profile
 * strips everything active or pointing outside the document; (5) the size
 * optimiser runs on the already-sanitised markup, using its own default
 * plugin set for optimisation only -- sanitising has already done every
 * safety-relevant removal this step could otherwise be asked to repeat.
 */
export function optimizeSvg(input: string, win: WindowLike, options: OptimizeSvgOptions = {}): OptimizeSvgResult {
  const { multipass = true, precision = 3, pretty = false } = options;
  const warnings: string[] = [];
  const originalBytes = byteLength(input);

  let working = input;
  const doctype = findDoctype(working);
  if (doctype) {
    if (doctype.hasInternalSubset) {
      throw new SvgOptimizerError(ENTITY_DOCTYPE_MESSAGE);
    }
    working = working.slice(0, doctype.start) + working.slice(doctype.start + doctype.full.length);
    warnings.push(PLAIN_DOCTYPE_WARNING);
  }

  const validation = XMLValidator.validate(working);
  if (validation !== true) {
    const { err } = validation;
    throw new SvgOptimizerError(err.msg, { line: err.line, column: err.col });
  }

  const rootName = findRootElementName(working);
  if (rootName !== 'svg') {
    throw new SvgOptimizerError(NOT_SVG_MESSAGE);
  }

  const { markup: sanitised, removed } = sanitiseMarkup(working, win, 'svg');
  warnings.push(...describeRemoved(removed));

  const result = optimize(sanitised, {
    multipass,
    floatPrecision: Math.max(0, precision),
    js2svg: { pretty },
  });

  return {
    output: result.data,
    originalBytes,
    optimisedBytes: byteLength(result.data),
    removed,
    warnings,
  };
}
