import meta from './meta.json';
import { formatPointer } from './pointer';
import { hasOwn, getOwn } from './own-property';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from './json-text';

export { meta };

const DEPTH_MESSAGE = 'A document nested more than 512 levels deep was refused rather than risk freezing the tab.';

export class JsonDiffError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'JsonDiffError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export type DiffChangeKind = 'added' | 'removed' | 'changed';

export interface DiffChange {
  kind: DiffChangeKind;
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface DiffStats {
  added: number;
  removed: number;
  changed: number;
}

export interface DiffResult {
  identical: boolean;
  changes: DiffChange[];
  stats: DiffStats;
}

/** One of the five JSON value kinds a location can hold, used only to detect a type change at that location. */
type Kind = 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';

function kindOf(value: unknown): Kind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as Kind;
}

function compareArrays(tokens: string[], a: unknown[], b: unknown[], changes: DiffChange[]): void {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const childTokens = [...tokens, String(i)];
    if (i >= a.length) {
      changes.push({ kind: 'added', path: formatPointer(childTokens), before: undefined, after: b[i] });
    } else if (i >= b.length) {
      changes.push({ kind: 'removed', path: formatPointer(childTokens), before: a[i], after: undefined });
    } else {
      compareValues(childTokens, a[i], b[i], changes);
    }
  }
}

function compareObjects(
  tokens: string[],
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  changes: DiffChange[],
): void {
  const aKeys = Object.keys(a);
  const aKeySet = new Set(aKeys);
  const bKeys = Object.keys(b);

  // First document's own key order: shared keys compared recursively, keys
  // only in the first document reported removed.
  for (const key of aKeys) {
    const childTokens = [...tokens, key];
    if (!hasOwn(b, key)) {
      changes.push({ kind: 'removed', path: formatPointer(childTokens), before: getOwn(a, key), after: undefined });
    } else {
      compareValues(childTokens, getOwn(a, key), getOwn(b, key), changes);
    }
  }

  // Then keys only in the second document, in its own order, reported added.
  for (const key of bKeys) {
    if (aKeySet.has(key)) continue;
    const childTokens = [...tokens, key];
    changes.push({ kind: 'added', path: formatPointer(childTokens), before: undefined, after: getOwn(b, key) });
  }
}

function compareValues(tokens: string[], a: unknown, b: unknown, changes: DiffChange[]): void {
  const kindA = kindOf(a);
  const kindB = kindOf(b);

  if (kindA !== kindB) {
    changes.push({ kind: 'changed', path: formatPointer(tokens), before: a, after: b });
    return;
  }

  if (kindA === 'array') {
    compareArrays(tokens, a as unknown[], b as unknown[], changes);
    return;
  }

  if (kindA === 'object') {
    compareObjects(tokens, a as Record<string, unknown>, b as Record<string, unknown>, changes);
    return;
  }

  // null, boolean, number or string: `===` is exactly the right comparison
  // here. Two JSON numbers that print differently (1 and 1.0) already parse
  // to the same double, so they compare equal; strings compare code unit by
  // code unit with no Unicode normalisation, which is what `===` does.
  if (a !== b) {
    changes.push({ kind: 'changed', path: formatPointer(tokens), before: a, after: b });
  }
}

/**
 * Compares two already-parsed JSON values and lists every location that was
 * added, removed or changed, as an RFC 6901 JSON Pointer. Object key order
 * never counts as a change; array elements are compared by position; a
 * change of type at a location (for example an object replaced by an array)
 * is reported once there, not as a cascade of changes in every value
 * beneath it.
 */
export function diffJson(a: unknown, b: unknown): DiffResult {
  const changes: DiffChange[] = [];
  compareValues([], a, b, changes);

  const stats: DiffStats = { added: 0, removed: 0, changed: 0 };
  for (const change of changes) stats[change.kind]++;

  return { identical: changes.length === 0, changes, stats };
}

/**
 * Parses both documents (through the same RFC 8259 reader this tool
 * bundles) and diffs the results. Throws `JsonDiffError` naming which
 * document failed to parse, with `line` and `column`, or refuses either
 * document nested more than 512 levels deep before walking it.
 */
export function diffJsonText(first: string, second: string): DiffResult {
  const firstParsed = parseJsonText(first);
  if (!firstParsed.ok) {
    throw new JsonDiffError(`The first document could not be parsed: ${firstParsed.message}`, {
      line: firstParsed.line,
      column: firstParsed.column,
    });
  }

  const secondParsed = parseJsonText(second);
  if (!secondParsed.ok) {
    throw new JsonDiffError(`The second document could not be parsed: ${secondParsed.message}`, {
      line: secondParsed.line,
      column: secondParsed.column,
    });
  }

  if (exceedsDepth(firstParsed.value, MAX_JSON_DEPTH) || exceedsDepth(secondParsed.value, MAX_JSON_DEPTH)) {
    throw new JsonDiffError(DEPTH_MESSAGE);
  }

  return diffJson(firstParsed.value, secondParsed.value);
}
