/**
 * Reads YAML 1.2 text into a plain value and writes a plain value as YAML (canonical file, copied byte for byte into
 * every folder that reads or writes YAML as a value). It imports only `yaml`.
 *
 * The rules, stated once so every folder that copies this file states the same thing:
 *  - YAML is read with the 1.2 core schema: `yes` and `no` are strings, `0o14` and `0x1F` are integers, a quoted
 *    scalar is always a string;
 *  - a mapping with the same key twice is refused, naming the second key's line and column;
 *  - aliases are limited by the library's own rule, `maxAliasCount: 100`: each use of an alias counts with the size of
 *    what it points at, so a document that expands about 100 aliases (99 pass for a one-value anchor, 100 do not) is
 *    refused rather than expanded;
 *  - a document nested deeper than 512 levels is refused, and so is text so deeply nested that reading it would
 *    exhaust the stack;
 *  - every error carries its line and column when the library knows them;
 *  - anchors and aliases are expanded into separate copies, a tag outside the core schema is not interpreted, and a
 *    warning says so for each; a comment holds no data and is dropped without a warning;
 *  - a value with no JSON form (a date or binary value that an explicit tag produced) is refused, never reshaped;
 *  - a key named `__proto__` or `constructor` stays an ordinary key of the value.
 *
 * `documents: 'one'` expects exactly one non-empty document and returns its value; `documents: 'many'` reads a
 * `---` stream and returns the values of its non-empty documents as an array.
 *
 * Writing uses the YAML 1.1 compatibility mode, so a string such as `yes`, `on`, `null`, `1e3` or `2001-01-01` is
 * written quoted and reads back as a string in either YAML version.
 */
import { Document, LineCounter, isAlias, isScalar, parseAllDocuments, visit } from 'yaml';

export class YamlValueError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'YamlValueError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface YamlReadOptions {
  /** `one`: exactly one document, its value returned. `many`: a stream, an array of its documents' values returned. */
  documents: 'one' | 'many';
}

export interface YamlReadResult {
  value: unknown;
  warnings: string[];
}

const MAX_YAML_DEPTH = 512;

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

const ALIAS_BOMB_MESSAGE =
  'This document uses YAML aliases that expand into too much data, so it was refused rather than risk freezing the tab.';

const ALIAS_WARNING = 'A YAML anchor and its aliases were expanded into separate copies of the same value.';
const TAG_WARNING = 'A YAML tag outside the core schema was dropped; the value is kept, the tag is not.';

/** Core-schema tags a YAML scalar or collection resolves to without any explicit `!!` marker. */
const CORE_SCHEMA_TAGS = new Set([
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:map',
  'tag:yaml.org,2002:seq',
]);

/**
 * Walks a value without recursion. Returns `deep` when it is nested beyond `max` levels, and `odd` with a short
 * name for the first value that is not null, a boolean, a number, a string, an array or a plain object.
 */
function inspectValue(value: unknown, max: number): { deep: boolean; odd?: string } {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.depth > max) return { deep: true };
    const v = top.value;
    if (v === null || v === undefined) continue;
    const type = typeof v;
    if (type === 'string' || type === 'number' || type === 'boolean') continue;
    if (Array.isArray(v)) {
      for (const item of v) stack.push({ value: item, depth: top.depth + 1 });
      continue;
    }
    if (type === 'object') {
      const proto = Object.getPrototypeOf(v) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        return {
          deep: false,
          odd: v instanceof Date ? 'a date' : v instanceof Uint8Array ? 'binary data' : 'an object',
        };
      }
      for (const item of Object.values(v as Record<string, unknown>)) {
        stack.push({ value: item, depth: top.depth + 1 });
      }
      continue;
    }
    return { deep: false, odd: type === 'bigint' ? 'a big integer' : 'a value' };
  }
  return { deep: false };
}

interface TagScan {
  nonCoreTag: boolean;
  alias: boolean;
}

function scanDocument(doc: Document): TagScan {
  const found: TagScan = { nonCoreTag: false, alias: false };
  visit(doc, {
    Node(_key, node) {
      const tag = (node as unknown as { tag?: string }).tag;
      if (tag && !CORE_SCHEMA_TAGS.has(tag)) found.nonCoreTag = true;
      if (isAlias(node)) found.alias = true;
    },
  });
  return found;
}

/**
 * True for a document with no content at all: nothing after its `---`, or only comments. An explicit `null` or `~`
 * has source text, a tag or an anchor, so it is a value and is kept.
 */
function isEmptyDocument(doc: Document.Parsed): boolean {
  const contents = doc.contents as unknown;
  if (contents === null) return true;
  if (!isScalar(contents) || contents.value !== null) return false;
  const shape = contents as unknown as { source?: string; tag?: string; anchor?: string };
  return (shape.source ?? '') === '' && !shape.tag && !shape.anchor;
}

function isStackExhaustion(err: unknown): boolean {
  return err instanceof RangeError;
}

/** Reads YAML text into a value by the rules at the top of this file. Throws `YamlValueError` for a refused or malformed document. */
export function readYamlValue(text: string, options: YamlReadOptions): YamlReadResult {
  const lineCounter = new LineCounter();
  let docs: Document.Parsed[];
  try {
    docs = parseAllDocuments(text, { logLevel: 'error', uniqueKeys: true, prettyErrors: true, lineCounter });
  } catch (err) {
    if (isStackExhaustion(err)) throw new YamlValueError(DEPTH_MESSAGE);
    throw err;
  }

  // A document with no content at all (only `---`, or only comments) holds no value; it is skipped, like a blank line
  // in a list of one-line samples.
  const present = docs.filter((doc) => doc.errors.length > 0 || !isEmptyDocument(doc));

  for (const doc of present) {
    if (doc.errors.length > 0) {
      const err = doc.errors[0]!;
      const pos = err.linePos?.[0];
      throw new YamlValueError(err.message, { line: pos?.line, column: pos?.col });
    }
  }

  if (options.documents === 'one') {
    if (present.length === 0) throw new YamlValueError('There is no YAML document here.');
    if (present.length > 1) {
      const second = present[1]!;
      const start = second.range ? lineCounter.linePos(second.range[0]) : undefined;
      throw new YamlValueError(
        'This YAML holds more than one document (a stream separated by ---); this reads one document at a time.',
        { line: start?.line, column: start?.col },
      );
    }
  }

  const warnings: string[] = [];
  let sawAlias = false;
  let sawTag = false;
  const values: unknown[] = [];
  for (const doc of present) {
    let scan: TagScan;
    try {
      scan = scanDocument(doc);
    } catch (err) {
      if (isStackExhaustion(err)) throw new YamlValueError(DEPTH_MESSAGE);
      throw err;
    }
    if (scan.alias) sawAlias = true;
    if (scan.nonCoreTag) sawTag = true;

    let value: unknown;
    try {
      value = doc.toJS({ maxAliasCount: 100 });
    } catch (err) {
      if (err instanceof ReferenceError) {
        // The library raises one error type for both; only the excess-count message is the alias limit.
        throw new YamlValueError(/Excessive alias count/.test(err.message) ? ALIAS_BOMB_MESSAGE : err.message);
      }
      if (isStackExhaustion(err)) throw new YamlValueError(DEPTH_MESSAGE);
      throw err;
    }
    const inspected = inspectValue(value, MAX_YAML_DEPTH);
    if (inspected.deep) throw new YamlValueError(DEPTH_MESSAGE);
    if (inspected.odd) {
      throw new YamlValueError(
        `This YAML holds ${inspected.odd} (made by an explicit tag such as !!binary or !!timestamp), which has no JSON form. Remove the tag to read it as text.`,
      );
    }
    values.push(value);
  }

  if (sawAlias) warnings.push(ALIAS_WARNING);
  if (sawTag) warnings.push(TAG_WARNING);

  return { value: options.documents === 'one' ? values[0] : values, warnings };
}

/** Writes `value` as a YAML document with `indent` spaces per level. A string that another reader could take for a number, a boolean or null is quoted. */
export function writeYamlValue(value: unknown, indent: number): string {
  return new Document(value, { compat: 'yaml-1.1' }).toString({ indent });
}
