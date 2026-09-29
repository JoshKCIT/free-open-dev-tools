/**
 * RFC 6902 JSON Patch: generating a patch from a structural diff, and
 * applying a patch to a document.
 */

import { parsePointer, isArrayIndexToken } from './pointer';
import { hasOwn, getOwn, setOwn } from './own-property';
import { cloneJson, jsonEqual, countJsonValues } from './json-value';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from './json-text';
// Imported from the sibling module that also imports this one. Both
// bindings used from here (JsonDiffError, diffJson) are only ever read
// inside function bodies that run after every module in the package has
// finished evaluating, never at this file's own top level, so the import
// cycle is safe: by the time applyJsonPatchText or toJsonPatch is actually
// called, index.ts has long since finished defining both.
import { JsonDiffError, diffJson, type DiffResult } from './index';

export class JsonPatchError extends Error {
  /** Zero-based position of the failing operation in the patch array. Absent for a whole-patch problem such as "the patch is not an array". */
  readonly index?: number;
  /** The failing operation's own `path`, when one was readable. */
  readonly path?: string;

  constructor(message: string, detail: { index?: number; path?: string } = {}) {
    super(message);
    this.name = 'JsonPatchError';
    this.index = detail.index;
    this.path = detail.path;
  }
}

export type JsonPatchOperation =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; path: string; from: string }
  | { op: 'copy'; path: string; from: string }
  | { op: 'test'; path: string; value: unknown };

const KNOWN_OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);

/** A document or patch nested deeper than this is refused before any walk touches it. */
const DEPTH_MESSAGE = `A document nested more than ${MAX_JSON_DEPTH} levels deep was refused rather than risk freezing the tab.`;

/** The running value count a patch may not push a document past. Refused rather than risk freezing the tab. */
export const MAX_PATCHED_VALUES = 1_000_000;

function parentPointer(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '' : path.slice(0, idx);
}

/**
 * Reverses every maximal run of consecutive `remove` operations whose
 * paths share the same parent pointer, leaving every other operation and
 * every other ordering untouched. The position-based diff always emits an
 * array's own removals as one ascending run at the end of that array, so
 * reversing the run gives the highest index first -- which is what lets
 * the whole patch apply in order without an earlier removal shifting the
 * position a later one meant to remove. For an object parent, member
 * removals do not interact with each other, so the reversal changes
 * nothing observable there.
 */
function reverseConsecutiveRemoveRuns(ops: JsonPatchOperation[]): JsonPatchOperation[] {
  const out = [...ops];
  let i = 0;
  while (i < out.length) {
    if (out[i]!.op !== 'remove') {
      i++;
      continue;
    }
    const parent = parentPointer(out[i]!.path);
    let j = i;
    while (j + 1 < out.length && out[j + 1]!.op === 'remove' && parentPointer(out[j + 1]!.path) === parent) {
      j++;
    }
    if (j > i) {
      const run = out.slice(i, j + 1).reverse();
      for (let k = 0; k < run.length; k++) out[i + k] = run[k]!;
    }
    i = j + 1;
  }
  return out;
}

/**
 * Builds an RFC 6902 JSON Patch from either an already-computed structural
 * diff, or two documents (diffed internally with the same position-based
 * comparison `diffJson` uses). `added` becomes `add`, `removed` becomes
 * `remove`, `changed` becomes `replace` (a whole-document type change
 * becomes `replace` at path `""`). Every value in the returned patch is a
 * fresh copy, sharing nothing with either input document.
 */
export function toJsonPatch(result: DiffResult): JsonPatchOperation[];
export function toJsonPatch(a: unknown, b: unknown): JsonPatchOperation[];
export function toJsonPatch(...args: [DiffResult] | [unknown, unknown]): JsonPatchOperation[] {
  const result: DiffResult = args.length === 1 ? args[0] : diffJson(args[0], args[1]);

  const ops: JsonPatchOperation[] = result.changes.map((change) => {
    if (change.kind === 'added') return { op: 'add', path: change.path, value: cloneJson(change.after) };
    if (change.kind === 'removed') return { op: 'remove', path: change.path };
    return { op: 'replace', path: change.path, value: cloneJson(change.after) };
  });

  return reverseConsecutiveRemoveRuns(ops);
}

function opFail(index: number, op: string, path: string | undefined, reason: string): never {
  const label = path === undefined ? `patch[${index}] (${op})` : `patch[${index}] (${op} "${path}")`;
  throw new JsonPatchError(`${label}: ${reason}`, { index, path });
}

function safeParsePointer(pointer: string, index: number, op: string, fullPath: string): string[] {
  try {
    return parsePointer(pointer);
  } catch (err) {
    return opFail(index, op, fullPath, err instanceof Error ? err.message : String(err));
  }
}

function tokensEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function isProperPrefix(prefix: string[], tokens: string[]): boolean {
  if (prefix.length >= tokens.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== tokens[i]) return false;
  return true;
}

/** Reads the value at `tokens` inside `root`, own-property-safe throughout. */
function getAt(root: unknown, tokens: string[], index: number, op: string, fullPath: string): unknown {
  let current = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!isArrayIndexToken(token)) opFail(index, op, fullPath, `"${token}" is not a valid array index.`);
      const idx = Number(token);
      if (idx >= current.length) {
        opFail(index, op, fullPath, `Array index ${idx} is out of range (length ${current.length}).`);
      }
      current = current[idx];
    } else if (current !== null && typeof current === 'object') {
      const obj = current as Record<string, unknown>;
      if (!hasOwn(obj, token)) opFail(index, op, fullPath, `The member "${token}" does not exist.`);
      current = getOwn(obj, token);
    } else {
      opFail(index, op, fullPath, `Cannot look inside "${token}": the value there is not an object or array.`);
    }
  }
  return current;
}

/**
 * One patch-application run: owns the mutable working document (in a box,
 * since a whole-document replace changes what the box points at) and the
 * running value count the growth cap watches.
 */
class PatchRun {
  box: { value: unknown };
  valueCount: number;

  constructor(document: unknown) {
    this.box = { value: cloneJson(document) };
    this.valueCount = countJsonValues(this.box.value);
  }

  private growBy(added: number): void {
    this.valueCount += added;
    if (this.valueCount > MAX_PATCHED_VALUES) {
      throw new JsonPatchError(
        `This patch was refused: applying it would grow the document past ${MAX_PATCHED_VALUES.toLocaleString('en-US')} values, which risks freezing the tab.`,
      );
    }
  }

  get(tokens: string[], index: number, op: string, fullPath: string): unknown {
    return getAt(this.box.value, tokens, index, op, fullPath);
  }

  /** `add`/`copy`/`move` semantics: an existing array index is inserted before, shifting later elements right; `-` appends. */
  write(
    tokens: string[],
    rawValue: unknown,
    mode: 'insert' | 'overwrite',
    index: number,
    op: string,
    fullPath: string,
  ): void {
    const cloned = cloneJson(rawValue);
    this.growBy(countJsonValues(cloned));

    if (tokens.length === 0) {
      this.box.value = cloned;
      return;
    }

    const parentTokens = tokens.slice(0, -1);
    const lastToken = tokens[tokens.length - 1]!;
    const container = getAt(this.box.value, parentTokens, index, op, fullPath);

    if (Array.isArray(container)) {
      if (mode === 'overwrite') {
        container.splice(Number(lastToken), 1, cloned);
        return;
      }
      if (lastToken === '-') {
        container.push(cloned);
        return;
      }
      if (!isArrayIndexToken(lastToken)) opFail(index, op, fullPath, `"${lastToken}" is not a valid array index.`);
      const idx = Number(lastToken);
      if (idx > container.length) {
        opFail(index, op, fullPath, `Array index ${idx} is out of range (length ${container.length}).`);
      }
      container.splice(idx, 0, cloned);
      return;
    }

    if (container !== null && typeof container === 'object') {
      setOwn(container as Record<string, unknown>, lastToken, cloned);
      return;
    }

    opFail(index, op, fullPath, `Cannot write to "${lastToken}": the parent is not an object or array.`);
  }

  /** Checks that `tokens` names an existing array index or object member, for `replace`, which may not create a new location. */
  assertExists(tokens: string[], index: number, op: string, fullPath: string): void {
    if (tokens.length === 0) return; // the whole document always "exists"
    const parentTokens = tokens.slice(0, -1);
    const lastToken = tokens[tokens.length - 1]!;
    const container = getAt(this.box.value, parentTokens, index, op, fullPath);
    if (Array.isArray(container)) {
      if (lastToken === '-' || !isArrayIndexToken(lastToken)) {
        opFail(index, op, fullPath, `"${lastToken}" is not a valid array index.`);
      }
      if (Number(lastToken) >= container.length) {
        opFail(index, op, fullPath, `Array index ${lastToken} is out of range (length ${container.length}).`);
      }
      return;
    }
    if (container !== null && typeof container === 'object') {
      if (!hasOwn(container as Record<string, unknown>, lastToken)) {
        opFail(index, op, fullPath, `The member "${lastToken}" does not exist.`);
      }
      return;
    }
    opFail(index, op, fullPath, `Cannot replace "${lastToken}": the parent is not an object or array.`);
  }

  remove(tokens: string[], index: number, op: string, fullPath: string): unknown {
    if (tokens.length === 0) {
      opFail(index, op, fullPath, 'Removing the whole document at "" is not defined by RFC 6902.');
    }
    const parentTokens = tokens.slice(0, -1);
    const lastToken = tokens[tokens.length - 1]!;
    const container = getAt(this.box.value, parentTokens, index, op, fullPath);

    if (Array.isArray(container)) {
      if (lastToken === '-' || !isArrayIndexToken(lastToken)) {
        opFail(index, op, fullPath, `"${lastToken}" is not a valid array index to remove.`);
      }
      const idx = Number(lastToken);
      if (idx >= container.length) {
        opFail(index, op, fullPath, `Array index ${idx} is out of range (length ${container.length}).`);
      }
      return container.splice(idx, 1)[0];
    }

    if (container !== null && typeof container === 'object') {
      const obj = container as Record<string, unknown>;
      if (!hasOwn(obj, lastToken)) opFail(index, op, fullPath, `The member "${lastToken}" does not exist.`);
      const removed = getOwn(obj, lastToken);
      delete obj[lastToken];
      return removed;
    }

    return opFail(index, op, fullPath, `Cannot remove "${lastToken}": the parent is not an object or array.`);
  }
}

/**
 * Applies an RFC 6902 JSON Patch to `document`, returning a new value.
 * Neither `document` nor `patch` is ever mutated: every write lands on an
 * internal copy, and the very first operation that fails throws before any
 * further operation runs, so a caller never sees a half-applied result.
 * Own-property reads and writes throughout mean a member literally named
 * `__proto__` behaves as an ordinary key and never touches a prototype.
 */
export function applyJsonPatch(document: unknown, patch: unknown): unknown {
  if (!Array.isArray(patch)) {
    throw new JsonPatchError('A JSON Patch must be an array of operations.');
  }

  const run = new PatchRun(document);

  for (let index = 0; index < patch.length; index++) {
    const raw = patch[index];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new JsonPatchError(`patch[${index}]: each element of a JSON Patch must be an object.`, { index });
    }
    const rawOp = raw as Record<string, unknown>;

    const opValue = hasOwn(rawOp, 'op') ? getOwn(rawOp, 'op') : undefined;
    if (typeof opValue !== 'string' || !KNOWN_OPS.has(opValue)) {
      throw new JsonPatchError(
        `patch[${index}]: "op" must be one of add, remove, replace, move, copy, test; got ${
          opValue === undefined ? 'nothing' : JSON.stringify(opValue)
        }.`,
        { index },
      );
    }
    const op = opValue as JsonPatchOperation['op'];

    const pathValue = hasOwn(rawOp, 'path') ? getOwn(rawOp, 'path') : undefined;
    if (typeof pathValue !== 'string') {
      throw new JsonPatchError(`patch[${index}] (${op}): "path" must be a string.`, { index });
    }
    const path = pathValue;

    switch (op) {
      case 'add': {
        if (!hasOwn(rawOp, 'value')) opFail(index, op, path, '"value" is required.');
        const tokens = safeParsePointer(path, index, op, path);
        run.write(tokens, getOwn(rawOp, 'value'), 'insert', index, op, path);
        break;
      }
      case 'remove': {
        const tokens = safeParsePointer(path, index, op, path);
        run.remove(tokens, index, op, path);
        break;
      }
      case 'replace': {
        if (!hasOwn(rawOp, 'value')) opFail(index, op, path, '"value" is required.');
        const tokens = safeParsePointer(path, index, op, path);
        run.assertExists(tokens, index, op, path);
        run.write(tokens, getOwn(rawOp, 'value'), 'overwrite', index, op, path);
        break;
      }
      case 'move':
      case 'copy': {
        const fromValue = hasOwn(rawOp, 'from') ? getOwn(rawOp, 'from') : undefined;
        if (typeof fromValue !== 'string') {
          throw new JsonPatchError(`patch[${index}] (${op} "${path}"): "from" must be a string.`, { index, path });
        }
        const fromTokens = safeParsePointer(fromValue, index, op, fromValue);
        const pathTokens = safeParsePointer(path, index, op, path);

        if (op === 'copy') {
          const value = run.get(fromTokens, index, op, fromValue);
          run.write(pathTokens, value, 'insert', index, op, path);
        } else {
          if (tokensEqual(fromTokens, pathTokens)) break; // moving a value onto itself is a no-op
          if (isProperPrefix(fromTokens, pathTokens)) {
            opFail(index, op, path, 'Cannot move a value into one of its own children.');
          }
          const removed = run.remove(fromTokens, index, op, fromValue);
          run.write(pathTokens, removed, 'insert', index, op, path);
        }
        break;
      }
      case 'test': {
        if (!hasOwn(rawOp, 'value')) opFail(index, op, path, '"value" is required.');
        const tokens = safeParsePointer(path, index, op, path);
        const actual = run.get(tokens, index, op, path);
        if (!jsonEqual(actual, getOwn(rawOp, 'value'))) {
          opFail(index, op, path, 'The value at this path does not equal the given test value.');
        }
        break;
      }
    }
  }

  return run.box.value;
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

/**
 * Parses a document and a patch as JSON text (through this package's own
 * RFC 8259 reader, with the same 512-level depth refusal every text entry
 * point here applies) and applies the patch. Returns the patched result
 * and how many operations the patch carried.
 */
export function applyJsonPatchText(documentText: string, patchText: string): { result: unknown; operations: number } {
  const document = parseTextOrThrow(documentText, 'The document');
  const patch = parseTextOrThrow(patchText, 'The patch');
  if (!Array.isArray(patch)) {
    throw new JsonPatchError('A JSON Patch must be an array of operations.');
  }
  const result = applyJsonPatch(document, patch);
  return { result, operations: patch.length };
}
