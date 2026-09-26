/**
 * Canonical YAML reader for this phase: parses YAML 1.2 documents with
 * source position tracking (a `LineCounter`, yaml's own newline-offset
 * index), refuses a document before it can freeze the tab, and bridges an
 * Ajv JSON Schema error's RFC 6901 instance path back to the line, column
 * and dotted key path of the YAML node it names.
 *
 * Copied byte for byte into every tool in this phase that reads YAML. This
 * header names no tool folder so it stays true wherever it lands.
 */
import { parseDocument, parseAllDocuments, LineCounter, isMap, isSeq, type Document } from 'yaml';
import type { Range } from 'yaml';
import type { ErrorObject } from 'ajv';

/** 5,242,880 bytes (5 MB). A document over this size is refused before parsing. */
export const MAX_YAML_BYTES = 5 * 1024 * 1024;

/** A document nested more than this many levels deep is refused. */
export const MAX_YAML_DEPTH = 512;

const SIZE_MESSAGE = 'This file is larger than 5 MB, so it was refused rather than risk freezing the tab.';

const ALIAS_MESSAGE =
  'This document uses YAML aliases that expand into too much data, so it was refused rather than risk freezing the tab.';

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

export class YamlSourceError extends Error {
  readonly line?: number;
  readonly column?: number;
  readonly path?: string;

  constructor(message: string, detail: { line?: number; column?: number; path?: string } = {}) {
    super(message);
    this.name = 'YamlSourceError';
    this.line = detail.line;
    this.column = detail.column;
    this.path = detail.path;
  }
}

export interface ReadYamlOptions {
  /**
   * Apply YAML merge keys (`<<`). Off by default; a caller turns this on
   * only when its own fetched documentation describes merge semantics for
   * the format it reads (the compose-spec Fragments section, for example).
   */
  merge?: boolean;
  /** Read every `---`-separated document in the source, not only the first. */
  multiDocument?: boolean;
}

export interface ReadYamlDocumentEntry {
  doc: Document.Parsed;
  value: unknown;
  index: number;
}

export interface ReadYamlResult {
  documents: ReadYamlDocumentEntry[];
  lineCounter: LineCounter;
}

export interface YamlFinding {
  line: number;
  column: number;
  path: string;
  pointer: string;
  keyword: string;
  severity: 'error' | 'warning';
  message: string;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * True for a reference token that is a valid RFC 6901 array index: `0`, or a
 * run of digits with no leading zero.
 */
function isArrayIndexToken(token: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(token);
}

function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function splitPointer(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return pointer === '/' ? [''] : [];
  return pointer.slice(1).split('/').map(unescapeToken);
}

/**
 * Checks depth without recursing through every array/object separately from
 * the caller -- used before `doc.toJS` resolves aliases, so a document that
 * is both deep AND alias-heavy is caught by whichever guard runs first.
 */
function exceedsDepth(value: unknown, maxDepth: number, depth = 0): boolean {
  if (depth > maxDepth) return true;
  if (Array.isArray(value)) {
    for (const item of value) if (exceedsDepth(item, maxDepth, depth + 1)) return true;
    return false;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (exceedsDepth((value as Record<string, unknown>)[key], maxDepth, depth + 1)) return true;
    }
    return false;
  }
  return false;
}

/**
 * Reads `text` as one or more YAML documents. Throws `YamlSourceError` for
 * the first syntax or duplicate-key error (with `line`/`column`), for a
 * document over `MAX_YAML_BYTES`, for aliases that expand past the limit, or
 * for nesting past `MAX_YAML_DEPTH`. Never partially returns a refused
 * document.
 */
export function readYaml(text: string, options: ReadYamlOptions = {}): ReadYamlResult {
  if (byteLength(text) > MAX_YAML_BYTES) {
    throw new YamlSourceError(SIZE_MESSAGE);
  }

  const lineCounter = new LineCounter();
  const parseOptions = {
    lineCounter,
    uniqueKeys: true,
    prettyErrors: true,
    logLevel: 'error' as const,
    merge: options.merge ?? false,
  };

  const docs = options.multiDocument ? parseAllDocuments(text, parseOptions) : [parseDocument(text, parseOptions)];

  const documents: ReadYamlDocumentEntry[] = [];

  for (let index = 0; index < docs.length; index++) {
    const doc = docs[index]!;
    if (doc.errors.length > 0) {
      const err = doc.errors[0]!;
      const pos = err.linePos?.[0];
      throw new YamlSourceError(err.message, { line: pos?.line, column: pos?.col });
    }

    let value: unknown;
    try {
      value = doc.toJS({ maxAliasCount: 100 });
    } catch (err) {
      if (err instanceof ReferenceError) throw new YamlSourceError(ALIAS_MESSAGE);
      if (err instanceof RangeError) throw new YamlSourceError(DEPTH_MESSAGE);
      throw err;
    }

    if (exceedsDepth(value, MAX_YAML_DEPTH)) throw new YamlSourceError(DEPTH_MESSAGE);

    documents.push({ doc, value, index });
  }

  return { documents, lineCounter };
}

/**
 * Walks the CST-derived document tree for the pointer's path, descending a
 * `YAMLMap`'s pairs (matching a key by its string form so a numeric or
 * quoted YAML key still matches a plain pointer token) or a `YAMLSeq`'s
 * items, and returns the position of the key node (`{ key: true }`) or the
 * value node otherwise. Falls back to the nearest ancestor whose range is
 * known once the pointer's path runs out of matching structure (a `required`
 * error naming a key that does not exist, for instance).
 */
export function locatePointer(
  source: ReadYamlResult,
  docIndex: number,
  pointer: string,
  options: { key?: boolean } = {},
): { line: number; column: number } {
  const entry = source.documents[docIndex];
  if (!entry) return { line: 1, column: 1 };

  const tokens = splitPointer(pointer);
  let node: unknown = entry.doc.contents;
  let lastRange: Range | undefined = nodeRange(node);
  let keyNode: unknown;

  for (const token of tokens) {
    keyNode = undefined;
    if (isMap(node)) {
      const pair = node.items.find((p) => String((p.key as { value?: unknown } | null)?.value) === token);
      if (!pair) {
        node = undefined;
        break;
      }
      keyNode = pair.key;
      node = pair.value;
    } else if (isSeq(node)) {
      if (!isArrayIndexToken(token)) {
        node = undefined;
        break;
      }
      const idx = Number(token);
      node = idx >= 0 && idx < node.items.length ? node.items[idx] : undefined;
    } else {
      node = undefined;
      break;
    }
    const range = nodeRange(node);
    if (range) lastRange = range;
  }

  const target = options.key && keyNode !== undefined ? keyNode : node;
  const range = nodeRange(target) ?? lastRange;
  if (!range) return { line: 1, column: 1 };

  const pos = source.lineCounter.linePos(range[0]);
  return { line: pos.line, column: pos.col };
}

function nodeRange(node: unknown): Range | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  const range = (node as { range?: Range | null }).range;
  return range ?? undefined;
}

/** Unescapes an RFC 6901 pointer into a dotted key path, `[n]` for a sequence item, keys with a dot, bracket or space wrapped in double quotes. */
export function pointerToPath(pointer: string): string {
  const tokens = splitPointer(pointer);
  let out = '';
  for (const token of tokens) {
    if (isArrayIndexToken(token)) {
      out += `[${token}]`;
      continue;
    }
    if (/[.[\] ]/.test(token)) {
      const quoted = token.replace(/"/g, '\\"');
      out += out === '' ? `"${quoted}"` : `."${quoted}"`;
      continue;
    }
    out += out === '' ? token : `.${token}`;
  }
  return out;
}

/** Levenshtein edit distance, used only to suggest a close-enough property name (capped search, never a hot path). */
function editDistance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }
  return dp[b.length]!;
}

function closeMatch(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(name, candidate);
    if (distance <= 2 && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

interface RawFinding extends YamlFinding {
  /** The Ajv schemaPath, kept only to decide oneOf/anyOf merging; not part of the public shape. */
  schemaPath: string;
  instancePath: string;
}

/**
 * Maps Ajv validation errors for one document to `YamlFinding`s: an
 * `additionalProperties` error points at the offending key itself and names
 * it (with a "did you mean" suggestion when an allowed property is within
 * edit distance 2); a `required` error points at the key that holds the
 * parent mapping (the document root's own position for a top-level
 * requirement) and names the missing key in both the message and the path;
 * an `enum` error lists the allowed values; errors produced by different
 * `oneOf`/`anyOf` branches for the same instance path merge into one finding
 * naming the accepted types, and a bare `oneOf`/`anyOf` error is dropped
 * whenever a deeper finding already covers the same instance path.
 * Duplicates are removed and findings are sorted by line, then column.
 */
/**
 * Ajv reports a failing `oneOf`/`anyOf` as a set of per-branch errors whose
 * `schemaPath` runs through `.../oneOf/<index>/...` or `.../anyOf/<index>/...`,
 * followed by one bare summary error whose `schemaPath` ends exactly at
 * `oneOf`/`anyOf` with no trailing index. This finds which branch keyword
 * and index (if any) an error's `schemaPath` runs through.
 */
function branchOf(schemaPath: string): { keyword: 'oneOf' | 'anyOf'; index?: number } | undefined {
  const segments = schemaPath.split('/');
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === 'oneOf' || segment === 'anyOf') {
      const next = segments[i + 1];
      const index = next !== undefined && /^\d+$/.test(next) ? Number(next) : undefined;
      return { keyword: segment, index };
    }
  }
  return undefined;
}

export function findingsFromAjvErrors(source: ReadYamlResult, docIndex: number, errors: ErrorObject[]): YamlFinding[] {
  const branchGroups = new Map<string, ErrorObject[]>();
  const mergedInstancePaths = new Set<string>();

  for (const error of errors) {
    const branch = branchOf(error.schemaPath);
    if (branch && branch.index !== undefined) {
      const key = `${error.instancePath}\u0000${branch.keyword}`;
      const list = branchGroups.get(key) ?? [];
      list.push(error);
      branchGroups.set(key, list);
    }
  }
  for (const key of branchGroups.keys()) {
    mergedInstancePaths.add(key.split('\u0000')[0]!);
  }

  const raw: RawFinding[] = [];

  for (const error of errors) {
    const branch = branchOf(error.schemaPath);

    // The per-branch errors themselves are folded into the merged finding
    // built below; skip them here so they never appear individually.
    if (branch && branch.index !== undefined) continue;

    // The bare summary error (no trailing branch index) is redundant once
    // its branches produced a merged finding for the same instance path.
    if (branch && branch.index === undefined && mergedInstancePaths.has(error.instancePath)) continue;

    if (error.keyword === 'additionalProperties' || error.keyword === 'unevaluatedProperties') {
      const params = error.params as { additionalProperty?: string; unevaluatedProperty?: string };
      const badKey = String(params.additionalProperty ?? params.unevaluatedProperty ?? '');
      const pointer = `${error.instancePath}/${badKey.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      const pos = locatePointer(source, docIndex, pointer, { key: true });
      const allowed = Object.keys(
        (error.parentSchema as { properties?: Record<string, unknown> } | undefined)?.properties ?? {},
      );
      const suggestion = closeMatch(badKey, allowed);
      const message = suggestion
        ? `"${badKey}" is not a recognised key here -- did you mean "${suggestion}"?`
        : `"${badKey}" is not a recognised key here.`;
      raw.push({
        line: pos.line,
        column: pos.column,
        path: pointerToPath(pointer),
        pointer,
        keyword: error.keyword,
        severity: 'error',
        message,
        schemaPath: error.schemaPath,
        instancePath: error.instancePath,
      });
      continue;
    }

    if (error.keyword === 'required') {
      const missing = String((error.params as { missingProperty?: string }).missingProperty ?? '');
      const pos =
        error.instancePath === ''
          ? { line: 1, column: 1 }
          : locatePointer(source, docIndex, error.instancePath, { key: true });
      const pointer = error.instancePath;
      raw.push({
        line: pos.line,
        column: pos.column,
        path: pointerToPath(pointer),
        pointer,
        keyword: error.keyword,
        severity: 'error',
        message: `This mapping is missing the required key "${missing}".`,
        schemaPath: error.schemaPath,
        instancePath: error.instancePath,
      });
      continue;
    }

    if (error.keyword === 'enum') {
      const allowed = (error.params as { allowedValues?: unknown[] }).allowedValues ?? [];
      const pos = locatePointer(source, docIndex, error.instancePath);
      raw.push({
        line: pos.line,
        column: pos.column,
        path: pointerToPath(error.instancePath),
        pointer: error.instancePath,
        keyword: error.keyword,
        severity: 'error',
        message: `This value must be one of: ${allowed.map((v) => JSON.stringify(v)).join(', ')}.`,
        schemaPath: error.schemaPath,
        instancePath: error.instancePath,
      });
      continue;
    }

    const pos = locatePointer(source, docIndex, error.instancePath);
    raw.push({
      line: pos.line,
      column: pos.column,
      path: pointerToPath(error.instancePath),
      pointer: error.instancePath,
      keyword: error.keyword,
      severity: 'error',
      message: error.message ?? 'This value does not match the schema.',
      schemaPath: error.schemaPath,
      instancePath: error.instancePath,
    });
  }

  for (const [key, list] of branchGroups) {
    const [instancePath, keyword] = key.split('\u0000') as [string, string];
    const types = Array.from(
      new Set(
        list
          .map((e) => (e.params as { type?: string } | undefined)?.type)
          .filter((t): t is string => typeof t === 'string'),
      ),
    );
    const pos = locatePointer(source, docIndex, instancePath);
    const message =
      types.length > 0
        ? `This value must match one of the accepted forms: ${types.join(', ')}.`
        : `This value does not match any of the accepted forms (${keyword}).`;
    raw.push({
      line: pos.line,
      column: pos.column,
      path: pointerToPath(instancePath),
      pointer: instancePath,
      keyword,
      severity: 'error',
      message,
      schemaPath: list[0]!.schemaPath,
      instancePath,
    });
  }

  // Ajv's `unevaluatedProperties` (used wherever a schema combines subschemas
  // with `allOf`, as every compose-spec service does) has a documented
  // interaction with `allErrors: true`: once ANY sibling property inside the
  // same mapping fails validation, the whole failing branch's annotations
  // (which properties it evaluated) are discarded, so `unevaluatedProperties`
  // then reports EVERY property in that mapping as unrecognised -- including
  // ones that are perfectly valid on their own. Once a mapping has any other,
  // more specific finding beneath it, none of that mapping's own
  // `unevaluatedProperties` findings can be trusted as real unknown keys, so
  // all of them are dropped in favour of the specific finding(s).
  const parentsWithSpecificFindings = new Set(
    raw
      .filter((item) => item.keyword !== 'additionalProperties' && item.keyword !== 'unevaluatedProperties')
      .map((item) => item.instancePath),
  );
  const filtered = raw.filter((item) => {
    if (item.keyword !== 'unevaluatedProperties') return true;
    for (const otherPath of parentsWithSpecificFindings) {
      if (otherPath === item.instancePath || otherPath.startsWith(`${item.instancePath}/`)) return false;
    }
    return true;
  });

  const seen = new Set<string>();
  const findings: YamlFinding[] = [];
  for (const item of filtered.sort((a, b) => a.line - b.line || a.column - b.column)) {
    const dedupeKey = `${item.pointer}\u0000${item.keyword}\u0000${item.message}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    findings.push({
      line: item.line,
      column: item.column,
      path: item.path,
      pointer: item.pointer,
      keyword: item.keyword,
      severity: item.severity,
      message: item.message,
    });
  }

  return findings;
}
