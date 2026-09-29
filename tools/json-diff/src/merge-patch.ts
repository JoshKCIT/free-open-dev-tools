/**
 * RFC 7386 JSON Merge Patch: generating a merge patch from two documents,
 * and applying one to a document.
 */

import { hasOwn, getOwn, setOwn } from './own-property';
import { formatPointer } from './pointer';
import { cloneJson, jsonEqual } from './json-value';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from './json-text';
// Same safe import cycle json-patch.ts uses: read only inside function
// bodies, called only once every module in the package has finished
// evaluating.
import { JsonDiffError } from './index';

const DEPTH_MESSAGE = `A document nested more than ${MAX_JSON_DEPTH} levels deep was refused rather than risk freezing the tab.`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Applies an RFC 7386 JSON Merge Patch to `target`, following section 2's
 * pseudocode exactly: an object member set to `null` in the patch deletes
 * that member from the result; any other member value merges recursively;
 * a patch that is not an object simply replaces the target outright
 * (which is also how a whole array or scalar patch value is applied --
 * arrays are always replaced whole, never merged element by element).
 * Neither input is ever mutated.
 */
export function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return cloneJson(patch);

  const base: Record<string, unknown> = isPlainObject(target) ? (cloneJson(target) as Record<string, unknown>) : {};

  for (const key of Object.keys(patch)) {
    const value = getOwn(patch, key);
    if (value === null) {
      if (hasOwn(base, key)) delete base[key];
    } else {
      setOwn(base, key, applyMergePatch(hasOwn(base, key) ? getOwn(base, key) : undefined, value));
    }
  }

  return base;
}

export interface MergePatchResult {
  /** `undefined` when any value in `b` would have to be expressed as a literal null; see `warnings`. */
  patch: unknown;
  /** One JSON Pointer per value that a merge patch cannot set to null, because null means delete. */
  warnings: string[];
}

function buildMergePatch(a: unknown, b: unknown, tokens: string[], warnings: string[]): unknown {
  if (!isPlainObject(b)) return cloneJson(b);

  const base = isPlainObject(a) ? a : {};
  const result: Record<string, unknown> = {};

  // Every member the base has that b no longer has: delete it.
  for (const key of Object.keys(base)) {
    if (!hasOwn(b, key)) setOwn(result, key, null);
  }

  for (const key of Object.keys(b)) {
    const bValue = getOwn(b, key);
    const childTokens = [...tokens, key];

    if (bValue === null) {
      // Already null in the base: no change needed, nothing to warn about.
      if (hasOwn(base, key) && getOwn(base, key) === null) continue;
      warnings.push(formatPointer(childTokens));
      setOwn(result, key, null);
      continue;
    }

    if (hasOwn(base, key) && jsonEqual(getOwn(base, key), bValue)) continue; // unchanged

    setOwn(
      result,
      key,
      buildMergePatch(hasOwn(base, key) ? getOwn(base, key) : undefined, bValue, childTokens, warnings),
    );
  }

  return result;
}

/**
 * Builds an RFC 7386 Merge Patch that turns `a` into `b`. When `b` is not
 * an object the patch is simply `b` itself (a root of `null` is fine: a
 * merge patch that is not an object always replaces the target outright,
 * so `null` there means "the whole document is null", not "delete").
 * When turning `a` into `b` would require some value to become the
 * literal `null` (which a merge patch can only spend on "delete this
 * member"), `patch` is `undefined` and `warnings` names every such
 * location instead of returning a patch that would not actually produce
 * `b`.
 */
export function toMergePatch(a: unknown, b: unknown): MergePatchResult {
  const warnings: string[] = [];
  const patch = buildMergePatch(a, b, [], warnings);
  return { patch: warnings.length > 0 ? undefined : patch, warnings };
}

function parseTextOrThrow(text: string, label: string): unknown {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new JsonDiffError(`${label} could not be parsed: ${parsed.message}`, {
      line: parsed.line,
      column: parsed.column,
    });
  }
  if (exceedsDepth(parsed.value, MAX_JSON_DEPTH)) {
    throw new JsonDiffError(DEPTH_MESSAGE);
  }
  return parsed.value;
}

/** Parses a document and a merge patch as JSON text and applies the patch, with the same parsing and depth rules every text entry point here uses. */
export function applyMergePatchText(documentText: string, patchText: string): unknown {
  const document = parseTextOrThrow(documentText, 'The document');
  const patch = parseTextOrThrow(patchText, 'The patch');
  return applyMergePatch(document, patch);
}
