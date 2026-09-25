import meta from './meta.json';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from './json-text';
import { formatPointer } from './pointer';
import { Document, parseDocument, visit, isAlias } from 'yaml';
import { parse as parseToml, stringify as stringifyToml, TomlError } from 'smol-toml';

export { meta };

export type DataFormat = 'json' | 'yaml' | 'toml';

export interface ConvertOptions {
  from: DataFormat;
  to: DataFormat;
  /** Spaces per indent level for JSON and YAML output. Default 2. Ignored for TOML. */
  indent?: number;
}

export interface ConvertResult {
  output: string;
  warnings: string[];
}

export class DataConvertError extends Error {
  /** Set for a JSON, YAML or TOML syntax error. */
  readonly line?: number;
  readonly column?: number;
  /** RFC 6901 pointer, set instead of line/column for a structural problem such as a null on the way to TOML. */
  readonly path?: string;

  constructor(message: string, detail: { line?: number; column?: number; path?: string } = {}) {
    super(message);
    this.name = 'DataConvertError';
    this.line = detail.line;
    this.column = detail.column;
    this.path = detail.path;
  }
}

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

const ALIAS_BOMB_MESSAGE =
  'This document uses YAML aliases that expand into too much data, so it was refused rather than risk freezing the tab.';

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

interface YamlDocumentShape {
  commentBefore?: string | null;
  comment?: string | null;
}

interface YamlSourceScan {
  hasComment: boolean;
  hasNonCoreTag: boolean;
  hasAliasOrAnchor: boolean;
}

/**
 * Walks a parsed YAML document once, noting whether it carries a comment
 * anywhere (document-level or on any node), an explicit tag outside the YAML
 * 1.2 core schema, or an alias/anchor pair — each is a loss this tool
 * reports when the target format cannot hold it.
 */
function scanYamlSource(doc: Document.Parsed): YamlSourceScan {
  const docShape = doc as unknown as YamlDocumentShape;
  let hasComment = Boolean(docShape.commentBefore || docShape.comment);
  let hasNonCoreTag = false;
  let hasAliasOrAnchor = false;

  visit(doc, {
    Node(_key, node) {
      const shape = node as unknown as { comment?: string; commentBefore?: string; tag?: string };
      if (shape.comment || shape.commentBefore) hasComment = true;
      if (shape.tag && !CORE_SCHEMA_TAGS.has(shape.tag)) hasNonCoreTag = true;
      if (isAlias(node)) hasAliasOrAnchor = true;
    },
  });

  return { hasComment, hasNonCoreTag, hasAliasOrAnchor };
}

/**
 * True when TOML source text has a `#` comment outside a quoted string. A
 * plain scan, not a full TOML tokenizer: good enough to decide whether to
 * warn that a comment was dropped, since smol-toml's own parser keeps no
 * comment text to inspect after the fact.
 */
function tomlTextHasComment(text: string): boolean {
  let inBasicString = false;
  let inLiteralString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inBasicString) {
      if (ch === '\\') {
        i++;
      } else if (ch === '"') {
        inBasicString = false;
      }
      continue;
    }
    if (inLiteralString) {
      if (ch === "'") inLiteralString = false;
      continue;
    }
    if (ch === '"') {
      inBasicString = true;
    } else if (ch === "'") {
      inLiteralString = true;
    } else if (ch === '#') {
      return true;
    }
  }
  return false;
}

/**
 * Replaces every TOML date/time (a `TomlDate`, which extends the built-in
 * `Date`) with the string `TomlDate`'s own `toISOString` produces, since
 * that override — unlike the inherited `Date.prototype.toISOString` — reads
 * correctly for a local date or local time that carries no timezone offset.
 * Mutates existing containers in place rather than building new ones, so a
 * key such as `__proto__` (already a safe own property on smol-toml's own
 * output) is only ever overwritten, never freshly created through bracket
 * assignment.
 */
function normalizeTomlDates(value: unknown, onDate: () => void): unknown {
  if (value instanceof Date) {
    onDate();
    return (value as unknown as { toISOString(): string }).toISOString();
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = normalizeTomlDates(value[i], onDate);
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) obj[key] = normalizeTomlDates(obj[key], onDate);
    return value;
  }
  return value;
}

/** Refuses a `null` anywhere in `value`, naming its RFC 6901 pointer, since TOML has no null. */
function assertNoNullsForToml(value: unknown, tokens: string[]): void {
  if (value === null) {
    throw new DataConvertError('TOML has no way to represent null, so this document cannot be converted.', {
      path: formatPointer(tokens),
    });
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoNullsForToml(item, [...tokens, String(i)]));
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) assertNoNullsForToml(obj[key], [...tokens, key]);
  }
}

const BIGINT_MARKER = '@@fodt-data-convert-bigint@@:';

/** JSON.stringify with 2-/4-space indent that writes a BigInt as its exact digits, unquoted. */
function toJsonOutput(value: unknown, indent: number): string {
  const text = JSON.stringify(
    value,
    (_key, v: unknown) => (typeof v === 'bigint' ? BIGINT_MARKER + v.toString() : v),
    indent,
  );
  return text.replace(new RegExp(`"${BIGINT_MARKER}(-?\\d+)"`, 'g'), '$1');
}

/** Writes `value` as a fresh YAML document. `compat: 'yaml-1.1'` quotes scalars (such as `yes`/`no`) that a YAML 1.1 reader would misread as booleans, even though this reads YAML with the 1.2 core schema. */
function toYamlOutput(value: unknown, indent: number): string {
  const doc = new Document(value, { compat: 'yaml-1.1' });
  return doc.toString({ indent });
}

function toTomlOutput(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DataConvertError('A TOML document must have an object at the root, not an array or a plain value.');
  }
  assertNoNullsForToml(value, []);
  return stringifyToml(value as Record<string, unknown>);
}

/** Converts `text` from one of `json`/`yaml`/`toml` to another, returning the output and any loss warnings. Throws `DataConvertError` on a parse or structural problem. */
export function convertData(text: string, options: ConvertOptions): ConvertResult {
  const { from, to } = options;
  const indent = options.indent ?? 2;
  const warnings: string[] = [];

  // YAML to YAML re-serialises the same parsed document, so comments and
  // original scalar styles survive (D-52) instead of resolving to plain
  // values and writing a fresh document.
  if (from === 'yaml' && to === 'yaml') {
    const doc = parseDocument(text, { logLevel: 'error', uniqueKeys: true, prettyErrors: true });
    if (doc.errors.length > 0) {
      const err = doc.errors[0]!;
      const pos = err.linePos?.[0];
      throw new DataConvertError(err.message, { line: pos?.line, column: pos?.col });
    }
    let resolved: unknown;
    try {
      resolved = doc.toJS({ maxAliasCount: 100 });
    } catch (err) {
      if (err instanceof ReferenceError) throw new DataConvertError(ALIAS_BOMB_MESSAGE);
      throw err;
    }
    if (exceedsDepth(resolved, MAX_JSON_DEPTH)) throw new DataConvertError(DEPTH_MESSAGE);
    return { output: doc.toString({ indent }), warnings: [] };
  }

  let value: unknown;

  if (from === 'json') {
    const parsed = parseJsonText(text);
    if (!parsed.ok) {
      throw new DataConvertError(parsed.message ?? 'The document could not be parsed.', {
        line: parsed.line,
        column: parsed.column,
      });
    }
    value = parsed.value;
  } else if (from === 'yaml') {
    const doc = parseDocument(text, { logLevel: 'error', uniqueKeys: true, prettyErrors: true });
    if (doc.errors.length > 0) {
      const err = doc.errors[0]!;
      const pos = err.linePos?.[0];
      throw new DataConvertError(err.message, { line: pos?.line, column: pos?.col });
    }
    const scan = scanYamlSource(doc);
    if (scan.hasComment) {
      warnings.push('Comments in the YAML input were dropped, since the output format here is not YAML.');
    }
    if (scan.hasNonCoreTag) {
      warnings.push('A YAML tag outside the core schema was dropped; the value is kept, the tag is not.');
    }
    if (scan.hasAliasOrAnchor) {
      warnings.push('A YAML anchor and its aliases were expanded into separate copies of the same value.');
    }
    try {
      value = doc.toJS({ maxAliasCount: 100 });
    } catch (err) {
      if (err instanceof ReferenceError) throw new DataConvertError(ALIAS_BOMB_MESSAGE);
      throw err;
    }
  } else {
    try {
      value = parseToml(text, { integersAsBigInt: 'asNeeded' });
    } catch (err) {
      if (err instanceof TomlError) {
        throw new DataConvertError(err.message, { line: err.line, column: err.column });
      }
      throw err;
    }
    if (tomlTextHasComment(text)) {
      warnings.push('TOML comments were dropped; this never keeps comment text from TOML input.');
    }
  }

  if (exceedsDepth(value, MAX_JSON_DEPTH)) throw new DataConvertError(DEPTH_MESSAGE);

  if (from === 'toml' && to !== 'toml') {
    let sawDate = false;
    value = normalizeTomlDates(value, () => {
      sawDate = true;
    });
    if (sawDate) {
      warnings.push('TOML dates and times have no equivalent here, so they became strings.');
    }
  }

  if (to === 'json') return { output: toJsonOutput(value, indent), warnings };
  if (to === 'yaml') return { output: toYamlOutput(value, indent), warnings };

  if (to === 'toml' && from !== 'toml') {
    // A TOML target written from a non-TOML source lists every plain key
    // before any table, which can change the input's key order (D-52).
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const values = Object.values(value as Record<string, unknown>);
      const hasPlain = values.some((v) => v === null || typeof v !== 'object');
      const hasTable = values.some((v) => v !== null && typeof v === 'object' && !Array.isArray(v));
      if (hasPlain && hasTable) {
        warnings.push('TOML output lists plain keys before tables, so the input key order may change.');
      }
    }
  }
  return { output: toTomlOutput(value), warnings };
}
