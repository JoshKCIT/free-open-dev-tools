/**
 * CSS declarations back to the fewest core Tailwind CSS 4 classes that
 * produce exactly those declarations. A hand-written reader (quote,
 * parenthesis and comment aware; no regular expression with a nested
 * quantifier, so a hostile paste cannot cause catastrophic backtracking)
 * accepts either a bare declaration list or one or more rules; `@media` and
 * other at-rules are reported and skipped rather than descended into;
 * `!important` is noted in a warning rather than silently dropped.
 */
import { SUPPORTED_CANDIDATES, resolveClass, type Declarations } from './utilities';

export interface NormalizedDeclaration {
  property: string;
  value: string;
}

export interface ParsedRule {
  /** Empty string for a bare declaration list with no selector. */
  selector: string;
  declarations: NormalizedDeclaration[];
}

export interface CssParseResult {
  rules: ParsedRule[];
  warnings: string[];
}

/** Refuses input past this length outright rather than risk a slow parse on a pathological paste. */
export const MAX_REVERSE_INPUT_LENGTH = 200_000;

function stripComments(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) break; // unterminated comment: drop the remainder, never hang
      i = end + 2;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/** Scans forward from `start`, respecting quotes and parenthesis nesting, until a top-level `{`, `;`, or end of string. Returns the index of the terminator (or `n`) and which character it was. */
function scanTopLevel(text: string, start: number): { end: number; terminator: '{' | ';' | null } {
  const n = text.length;
  let depthParen = 0;
  let quote: string | null = null;
  let i = start;
  for (; i < n; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') {
        i++; // skip an escaped character inside a quoted string
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      depthParen++;
      continue;
    }
    if (ch === ')') {
      if (depthParen > 0) depthParen--;
      continue;
    }
    if (depthParen > 0) continue;
    if (ch === '{') return { end: i, terminator: '{' };
    if (ch === ';') return { end: i, terminator: ';' };
  }
  return { end: n, terminator: null };
}

/** Finds the index just past the matching top-level `}` for a body that starts right after an already-consumed `{`. */
function findMatchingBrace(text: string, afterOpenBrace: number): number {
  const n = text.length;
  let depth = 1;
  let quote: string | null = null;
  let depthParen = 0;
  let i = afterOpenBrace;
  for (; i < n && depth > 0; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      depthParen++;
      continue;
    }
    if (ch === ')') {
      if (depthParen > 0) depthParen--;
      continue;
    }
    if (depthParen > 0) continue;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  return i;
}

const AT_RULE_NAME_RE = /^@[a-zA-Z-]+/;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Normalises one declaration's property and value: lower-cased property, collapsed whitespace, `0px` to `0`, and (only when `remIs16px`) a px length that is an exact multiple of 4 converted to the equivalent rem length -- the same 16px-root assumption `--spacing: 0.25rem` (4px) is built on. */
export function normalizeDeclarationValue(rawValue: string, remIs16px: boolean): { value: string; important: boolean } {
  let value = normalizeWhitespace(rawValue);
  let important = false;
  const importantMatch = /!\s*important\s*$/i.exec(value);
  if (importantMatch) {
    important = true;
    value = value.slice(0, importantMatch.index).trim();
  }
  value = value.replace(/\b0px\b/g, '0');
  if (remIs16px) {
    value = value.replace(/\b(\d+)px\b/g, (whole, digits: string) => {
      const px = Number(digits);
      if (px === 0 || px % 4 !== 0) return whole;
      const rem = px / 16;
      const formatted = Number.isInteger(rem) ? String(rem) : rem.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
      return `${formatted}rem`;
    });
  }
  return { value, important };
}

function parseOneDeclaration(text: string, remIs16px: boolean, warnings: string[]): NormalizedDeclaration | null {
  const colon = scanTopLevel(text, 0);
  // scanTopLevel looks for `{`/`;`; reuse its quote/paren awareness by scanning for `:` the same way instead.
  let depthParen = 0;
  let quote: string | null = null;
  let idx = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      depthParen++;
      continue;
    }
    if (ch === ')') {
      if (depthParen > 0) depthParen--;
      continue;
    }
    if (depthParen > 0) continue;
    if (ch === ':') {
      idx = i;
      break;
    }
  }
  void colon;
  if (idx === -1) {
    const trimmed = text.trim();
    if (trimmed !== '') warnings.push(`"${trimmed}" is not a property: value declaration and was skipped.`);
    return null;
  }
  const property = normalizeWhitespace(text.slice(0, idx)).toLowerCase();
  const { value, important } = normalizeDeclarationValue(text.slice(idx + 1), remIs16px);
  if (property === '' || value === '') return null;
  if (important) warnings.push(`"${property}" was declared !important; the class output never carries !important.`);
  return { property, value };
}

function parseDeclarationList(body: string, remIs16px: boolean, warnings: string[]): NormalizedDeclaration[] {
  const decls: NormalizedDeclaration[] = [];
  let i = 0;
  while (i < body.length) {
    const { end, terminator } = scanTopLevel(body, i);
    const chunk = body.slice(i, end);
    const decl = parseOneDeclaration(chunk, remIs16px, warnings);
    if (decl) decls.push(decl);
    i = terminator === ';' ? end + 1 : end;
    if (terminator === null) break;
  }
  return decls;
}

/** Parses CSS text into rules, refusing input past `MAX_REVERSE_INPUT_LENGTH` outright. */
export function parseCssForReverse(css: string, remIs16px: boolean): CssParseResult {
  if (css.length > MAX_REVERSE_INPUT_LENGTH) {
    return {
      rules: [],
      warnings: [
        `This input is longer than ${MAX_REVERSE_INPUT_LENGTH} characters, so it was refused rather than risk freezing the tab.`,
      ],
    };
  }
  const warnings: string[] = [];
  const rules: ParsedRule[] = [];
  const text = stripComments(css);
  const n = text.length;
  let i = 0;
  let pendingBare: NormalizedDeclaration[] = [];

  function flushBare(): void {
    if (pendingBare.length > 0) {
      rules.push({ selector: '', declarations: pendingBare });
      pendingBare = [];
    }
  }

  while (i < n) {
    while (i < n && /\s/.test(text[i]!)) i++;
    if (i >= n) break;
    const start = i;
    const { end, terminator } = scanTopLevel(text, start);
    const chunk = text.slice(start, end).trim();

    if (terminator === '{') {
      const closeIdx = findMatchingBrace(text, end + 1);
      const body = text.slice(end + 1, Math.max(end + 1, closeIdx - 1));
      const atName = AT_RULE_NAME_RE.exec(chunk);
      if (atName) {
        warnings.push(`${atName[0]} is an at-rule and was reported rather than converted.`);
      } else if (chunk !== '') {
        flushBare();
        rules.push({ selector: chunk, declarations: parseDeclarationList(body, remIs16px, warnings) });
      }
      i = closeIdx;
      continue;
    }

    if (chunk !== '') {
      const atName = AT_RULE_NAME_RE.exec(chunk);
      if (atName) {
        warnings.push(`${atName[0]} is an at-rule and was reported rather than converted.`);
      } else {
        const decl = parseOneDeclaration(chunk, remIs16px, warnings);
        if (decl) pendingBare.push(decl);
      }
    }
    i = terminator === ';' ? end + 1 : n;
  }
  flushBare();
  return { rules, warnings };
}

// ---------------------------------------------------------------------------
// Index built once from SUPPORTED_CANDIDATES
// ---------------------------------------------------------------------------

interface IndexEntry {
  className: string;
  decls: NormalizedDeclaration[];
  /** Position in `SUPPORTED_CANDIDATES` (catalogue order), the deterministic cover tie-break. */
  order: number;
}

function normalizeCandidateDecls(decls: Declarations): NormalizedDeclaration[] {
  return Object.entries(decls).map(([property, rawValue]) => ({
    property: property.toLowerCase(),
    value: normalizeDeclarationValue(rawValue, true).value,
  }));
}

let cachedIndex: IndexEntry[] | null = null;
let cachedByProperty: Map<string, IndexEntry[]> | null = null;

function getIndex(): { entries: IndexEntry[]; byProperty: Map<string, IndexEntry[]> } {
  if (cachedIndex && cachedByProperty) return { entries: cachedIndex, byProperty: cachedByProperty };
  const entries: IndexEntry[] = [];
  const byProperty = new Map<string, IndexEntry[]>();
  let order = 0;
  for (const className of SUPPORTED_CANDIDATES) {
    const decls = resolveClass(className);
    if (decls === null) continue;
    const normalized = normalizeCandidateDecls(decls);
    if (normalized.length === 0) continue;
    // One entry object shared between `entries` and every `byProperty`
    // bucket it belongs to, so `coverDeclarations` can tell "the same
    // candidate already used" from "a different candidate with the same
    // shape" by identity -- a second, freshly-built object per bucket would
    // never compare equal to its own `entries` copy.
    const entry: IndexEntry = { className, decls: normalized, order: order++ };
    entries.push(entry);
    const firstProp = normalized[0]!.property;
    const bucket = byProperty.get(firstProp);
    if (bucket) bucket.push(entry);
    else byProperty.set(firstProp, [entry]);
  }
  cachedIndex = entries;
  cachedByProperty = byProperty;
  return { entries, byProperty };
}

// ---------------------------------------------------------------------------
// Cover search
// ---------------------------------------------------------------------------

export interface CoverResult {
  classes: string[];
  unmatched: NormalizedDeclaration[];
}

/**
 * Picks candidates whose whole declaration set is present among the
 * remaining declarations, preferring a candidate that covers more remaining
 * declarations at once, then the earliest candidate in `SUPPORTED_CANDIDATES`
 * (catalogue order) for a deterministic result between equally-sized
 * options. Declarations no candidate's full set covers are listed in
 * `unmatched`. This is a greedy cover, not a guaranteed-minimal one: a
 * pathological input could in principle admit a smaller class list found
 * only by backtracking, which this tool does not attempt.
 */
export function coverDeclarations(declarations: NormalizedDeclaration[]): CoverResult {
  const { byProperty } = getIndex();

  // remaining: property -> value, insertion order kept via a Map
  const remaining = new Map<string, string>();
  for (const d of declarations) remaining.set(d.property, d.value);

  const usedClasses: string[] = [];
  const usedClassNames = new Set<string>();

  function fullyCovers(entry: IndexEntry): boolean {
    return entry.decls.every((d) => remaining.get(d.property) === d.value);
  }

  for (;;) {
    let best: IndexEntry | null = null;
    const seen = new Set<IndexEntry>();
    for (const [property] of remaining) {
      const candidates = byProperty.get(property);
      if (!candidates) continue;
      for (const entry of candidates) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        if (usedClassNames.has(entry.className)) continue;
        if (!fullyCovers(entry)) continue;
        if (
          best === null ||
          entry.decls.length > best.decls.length ||
          (entry.decls.length === best.decls.length && entry.order < best.order)
        ) {
          best = entry;
        }
      }
    }
    if (best === null) break;
    usedClasses.push(best.className);
    usedClassNames.add(best.className);
    for (const d of best.decls) remaining.delete(d.property);
  }

  const unmatched: NormalizedDeclaration[] = declarations.filter((d) => remaining.get(d.property) === d.value);
  return { classes: usedClasses, unmatched };
}

// ---------------------------------------------------------------------------
// cssToClasses
// ---------------------------------------------------------------------------

export interface CssToClassesRule {
  selector: string;
  classes: string[];
  unmatched: NormalizedDeclaration[];
}

export interface CssToClassesOptions {
  /** Treats the CSS root font size as 16px, so a px length that is an exact multiple of 4 matches the equivalent rem-based class. Default true. */
  remIs16px?: boolean;
}

export interface CssToClassesResult {
  /** The winning class list for the first (or only) rule, space-joined -- the common single-rule case. */
  classes: string;
  rules: CssToClassesRule[];
  /** Unmatched declarations of the first (or only) rule. */
  unmatched: NormalizedDeclaration[];
  warnings: string[];
}

export function cssToClasses(css: string, options: CssToClassesOptions = {}): CssToClassesResult {
  const { remIs16px = true } = options;
  const parsed = parseCssForReverse(css, remIs16px);
  const rules: CssToClassesRule[] = parsed.rules.map((rule) => {
    const cover = coverDeclarations(rule.declarations);
    return { selector: rule.selector, classes: cover.classes, unmatched: cover.unmatched };
  });
  const first = rules[0];
  return {
    classes: first ? first.classes.join(' ') : '',
    rules,
    unmatched: first ? first.unmatched : [],
    warnings: parsed.warnings,
  };
}
