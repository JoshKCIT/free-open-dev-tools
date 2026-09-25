import meta from './meta.json';
import { encodePointerToken, formatPointer, parsePointer, isArrayIndexToken } from './pointer';
import { setOwn } from './own-property';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from './json-text';

export { meta };
export { MAX_JSON_DEPTH };

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

export class FlattenError extends Error {
  /** RFC 6901 pointer the problem was found at, for a structural error. */
  readonly path?: string;
  /** Set instead of `path` when the problem is a JSON syntax error. */
  readonly line?: number;
  readonly column?: number;
  readonly offset?: number;

  constructor(message: string, detail: { path?: string; line?: number; column?: number; offset?: number } = {}) {
    super(message);
    this.name = 'FlattenError';
    this.path = detail.path;
    this.line = detail.line;
    this.column = detail.column;
    this.offset = detail.offset;
  }
}

/**
 * Flattens a parsed JSON value into a plain object whose keys are RFC 6901
 * pointers, in document order, and whose values are leaves. A root scalar
 * is keyed by the empty pointer `''`.
 *
 * To make the result rebuildable without guessing, a container marker (an
 * empty object `{}` or empty array `[]` literal) is also written at the
 * pointer of: every empty object or array, since an empty container gives
 * `unflatten` no children to infer a shape from; and every non-empty object
 * all of whose keys happen to look like array indices, since without the
 * marker `unflatten`'s default guess would mistake it for an array.
 */
export function flatten(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const walk = (v: unknown, tokens: string[]): void => {
    const pointer = formatPointer(tokens);

    if (Array.isArray(v)) {
      if (v.length === 0) {
        setOwn(out, pointer, []);
        return;
      }
      v.forEach((item, i) => walk(item, [...tokens, String(i)]));
      return;
    }

    if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v as Record<string, unknown>);
      if (keys.length === 0) {
        setOwn(out, pointer, {});
        return;
      }
      if (keys.every((k) => isArrayIndexToken(k))) {
        // Disambiguates this object from an array at rebuild time, since
        // its keys alone would otherwise look exactly like one.
        setOwn(out, pointer, {});
      }
      for (const key of keys) walk((v as Record<string, unknown>)[key], [...tokens, key]);
      return;
    }

    setOwn(out, pointer, v);
  };

  walk(value, []);
  return out;
}

interface TrieNode {
  hasValue: boolean;
  value?: unknown;
  children: Map<string, TrieNode>;
}

function newNode(): TrieNode {
  return { hasValue: false, children: new Map() };
}

/** True when every one of `keys` is an array-index token and together they cover exactly 0..n-1. */
function isConsecutiveArrayShape(keys: string[]): boolean {
  if (!keys.every((k) => isArrayIndexToken(k))) return false;
  const nums = keys.map(Number).sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i) return false;
  }
  return true;
}

/** `null` for a leaf value (or a value that isn't an empty-container marker); otherwise which kind of container it marks. */
function markerKind(value: unknown): 'array' | 'object' | null {
  if (Array.isArray(value)) return value.length === 0 ? 'array' : null;
  if (value !== null && typeof value === 'object') return Object.keys(value as object).length === 0 ? 'object' : null;
  return null;
}

/**
 * Rebuilds a value from a flat pointer-keyed map. `map[pointer]` is either a
 * leaf, or an empty object/array literal marking that pointer as a
 * container of that kind (see `flatten`'s own doc comment). Every object
 * built along the way uses `setOwn`, so a key such as `__proto__` becomes
 * an ordinary own key instead of reaching the prototype.
 */
export function unflatten(map: Record<string, unknown>): unknown {
  const root = newNode();

  for (const pointer of Object.keys(map)) {
    let tokens: string[];
    try {
      tokens = parsePointer(pointer);
    } catch {
      throw new FlattenError(`"${pointer}" is not a valid JSON Pointer.`, { path: pointer });
    }
    if (tokens.length > MAX_JSON_DEPTH) throw new FlattenError(DEPTH_MESSAGE);

    let node = root;
    for (const token of tokens) {
      let next = node.children.get(token);
      if (!next) {
        next = newNode();
        node.children.set(token, next);
      }
      node = next;
    }
    node.hasValue = true;
    node.value = map[pointer];
  }

  const build = (node: TrieNode, pointer: string): unknown => {
    const childKeys = [...node.children.keys()];
    const marker = node.hasValue ? markerKind(node.value) : null;

    if (node.hasValue && marker === null) {
      if (childKeys.length > 0) {
        throw new FlattenError(`"${pointer === '' ? '(root)' : pointer}" has both a value and nested entries.`, {
          path: pointer,
        });
      }
      return node.value;
    }

    let kind: 'array' | 'object';
    if (marker === 'array') {
      if (childKeys.length > 0 && !isConsecutiveArrayShape(childKeys)) {
        throw new FlattenError(
          `"${pointer === '' ? '(root)' : pointer}" is marked as an array but its entries are not 0, 1, 2, ... in order.`,
          { path: pointer },
        );
      }
      kind = 'array';
    } else if (marker === 'object') {
      kind = 'object';
    } else {
      kind = isConsecutiveArrayShape(childKeys) ? 'array' : 'object';
    }

    if (kind === 'array') {
      const result: unknown[] = [];
      const sorted = [...childKeys].sort((a, b) => Number(a) - Number(b));
      for (const key of sorted) {
        const childPointer = pointer + '/' + encodePointerToken(key);
        result[Number(key)] = build(node.children.get(key)!, childPointer);
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    for (const key of childKeys) {
      const childPointer = pointer + '/' + encodePointerToken(key);
      setOwn(result, key, build(node.children.get(key)!, childPointer));
    }
    return result;
  };

  return build(root, '');
}

export interface FlattenTextResult {
  output: string;
  leaves: number;
  maxDepth: number;
}

/** Parses `text` as JSON, then flattens it, returning pretty-printed flat-map JSON plus stats. */
export function flattenText(text: string): FlattenTextResult {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new FlattenError(parsed.message ?? 'The document could not be parsed.', {
      line: parsed.line,
      column: parsed.column,
      offset: parsed.offset,
    });
  }
  if (exceedsDepth(parsed.value, MAX_JSON_DEPTH)) throw new FlattenError(DEPTH_MESSAGE);

  const map = flatten(parsed.value);
  const pointers = Object.keys(map);
  let maxDepth = 0;
  for (const p of pointers) maxDepth = Math.max(maxDepth, parsePointer(p).length);

  return { output: JSON.stringify(map, null, 2), leaves: pointers.length, maxDepth };
}

/** Parses `text` as a flat pointer-keyed JSON map, then rebuilds the original value. */
export function unflattenText(text: string): FlattenTextResult {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new FlattenError(parsed.message ?? 'The document could not be parsed.', {
      line: parsed.line,
      column: parsed.column,
      offset: parsed.offset,
    });
  }
  const value = parsed.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FlattenError('A flattened map must be a JSON object whose keys are JSON Pointers.');
  }
  const map = value as Record<string, unknown>;
  const pointers = Object.keys(map);
  let maxDepth = 0;
  for (const p of pointers) maxDepth = Math.max(maxDepth, parsePointer(p).length);

  const rebuilt = unflatten(map);
  return { output: JSON.stringify(rebuilt, null, 2), leaves: pointers.length, maxDepth };
}
