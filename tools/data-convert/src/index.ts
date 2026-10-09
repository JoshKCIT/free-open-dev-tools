import meta from './meta.json';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from './json-text';
import { formatPointer } from './pointer';
import { Document, LineCounter, parseDocument, visit, isAlias, isMap, isScalar, type YAMLMap } from 'yaml';
import { parse as parseToml, stringify as stringifyToml, TomlError } from 'smol-toml';
import { readXmlValue, XmlValueError } from './xml-read';
import { writeXmlValue, XmlWriteError } from './xml-write';
import { readTable, writeTable } from './table';
import { DataConvertError } from './errors';

export { meta, DataConvertError };

export type DataFormat = 'json' | 'yaml' | 'toml' | 'xml' | 'csv' | 'tsv';

export interface ConvertOptions {
  from: DataFormat;
  to: DataFormat;
  /** Spaces per indent level for JSON and YAML output. Default 2. Ignored for TOML. */
  indent?: number;
  /** XML only. Prefix an attribute's key gets, in either direction. Default '@_'. */
  attributePrefix?: string;
  /** XML only. Key an element's own text sits under when it also has attributes or children. Default '#text'. */
  textKey?: string;
  /** XML output only. Name of the element that wraps several top-level keys or a list. Default 'root'. */
  rootName?: string;
  /** XML output only. Name of the element written for each item of a list. Default 'row'. */
  rowName?: string;
  /** CSV and TSV input only. The first row names the columns. Default true. */
  headerRow?: boolean;
  /** CSV and TSV input only. Read true, false, null and numbers as typed values instead of text. Default false. */
  inferTypes?: boolean;
}

export interface ConvertResult {
  output: string;
  warnings: string[];
}

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

const EXPANSION_MESSAGE =
  'This YAML expands, once its aliases are copied out, to more than 2,000,000 values, so it was refused rather than risk freezing the tab.';

/** The most values (scalars, lists and mappings) a YAML document may expand to once its aliases are copied out. */
const MAX_YAML_NODES = 2_000_000;

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
  hasMergeKey: boolean;
  hasYaml11Directive: boolean;
}

const MERGE_KEY_WARNING =
  'A YAML merge key (<<) was read as an ordinary key named <<, because YAML 1.2 has no merge key; nothing was merged.';
const YAML_11_WARNING =
  'A %YAML 1.1 directive makes this document follow the YAML 1.1 rules (yes and no are booleans, 0777 is octal), which differ from the YAML 1.2 rules used everywhere else here.';

/**
 * The name a plain scalar key gets once it is written as text, the way the yaml package turns a key into a property
 * name (null is the empty name, anything else its `String`); undefined for a key that is not a plain scalar value.
 */
function keyName(value: unknown): string | undefined {
  if (value === null) return '';
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') return undefined;
  return String(value as string | number | boolean | bigint);
}

/** Refuses two keys of one mapping that are the same name as text (the integer 1 and the string "1"), and says whether one is a merge key. */
function checkMapKeys(map: YAMLMap, lineCounter: LineCounter): boolean {
  let mergeKey = false;
  const seen = new Set<string>();
  for (const pair of map.items) {
    const key = pair.key as unknown;
    if (!isScalar(key)) continue;
    if (key.value === '<<' && key.type === 'PLAIN') mergeKey = true;
    const name = keyName(key.value);
    if (name === undefined) continue;
    if (seen.has(name)) {
      const start = key.range ? lineCounter.linePos(key.range[0]) : undefined;
      throw new DataConvertError(
        `Two keys of this mapping become the same name, "${name}", once written as text (for example 1 and "1"), so one value would replace the other. Make the keys different.`,
        { line: start?.line, column: start?.col },
      );
    }
    seen.add(name);
  }
  return mergeKey;
}

/**
 * True when `value` holds more than `max` values counted the way a copy of it would be: a value that a YAML alias
 * shares is counted every time it is used, which is what writing it out costs. Iterative, and stops at the limit.
 */
function exceedsNodeCount(value: unknown, max: number): boolean {
  const stack: unknown[] = [value];
  let nodes = 1;
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === null || typeof top !== 'object') continue;
    const items = Array.isArray(top) ? top : Object.values(top as Record<string, unknown>);
    nodes += items.length;
    if (nodes > max) return true;
    for (const item of items) stack.push(item);
  }
  return false;
}

/**
 * Walks a parsed YAML document once, noting whether it carries a comment
 * anywhere (document-level or on any node), an explicit tag outside the YAML
 * 1.2 core schema, or an alias/anchor pair — each is a loss this tool
 * reports when the target format cannot hold it.
 */
function scanYamlSource(doc: Document.Parsed, lineCounter: LineCounter): YamlSourceScan {
  const docShape = doc as unknown as YamlDocumentShape;
  let hasComment = Boolean(docShape.commentBefore || docShape.comment);
  let hasNonCoreTag = false;
  let hasAliasOrAnchor = false;
  let hasMergeKey = false;

  visit(doc, {
    Node(_key, node) {
      const shape = node as unknown as { comment?: string; commentBefore?: string; tag?: string };
      if (shape.comment || shape.commentBefore) hasComment = true;
      if (shape.tag && !CORE_SCHEMA_TAGS.has(shape.tag)) hasNonCoreTag = true;
      if (isAlias(node)) hasAliasOrAnchor = true;
      if (isMap(node) && checkMapKeys(node, lineCounter)) hasMergeKey = true;
    },
  });

  // Under a %YAML 1.1 directive the yaml package does merge `<<`, so only the directive is reported for such a document.
  const hasYaml11Directive = doc.directives.yaml.explicit === true && doc.directives.yaml.version === '1.1';
  return {
    hasComment,
    hasNonCoreTag,
    hasAliasOrAnchor,
    hasMergeKey: hasMergeKey && !hasYaml11Directive,
    hasYaml11Directive,
  };
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

const YAML_TIMESTAMP_WARNING =
  'YAML timestamps (written with the !!timestamp tag) have no equivalent here, so they became ISO 8601 text.';

/** A short plain name for a value an explicit YAML tag made that no target format here can hold. */
function describeTaggedValue(value: unknown): string {
  if (value instanceof Uint8Array) return 'binary data (made by the !!binary tag)';
  if (value instanceof Set) return 'a set (made by the !!set tag)';
  if (value instanceof Map) return 'an ordered map or list of pairs (made by the !!omap or !!pairs tag)';
  return 'a value that has no JSON form';
}

/**
 * Walks a value read from YAML (already checked to be no deeper than 512 levels). A date an explicit
 * `!!timestamp` tag made becomes its ISO 8601 text; binary data, a set or a map is refused naming its RFC 6901
 * path, so none of them is ever written as an empty element, an empty cell or a column per byte. Mutates existing
 * containers in place, so a key such as `__proto__` is only ever overwritten, never freshly created.
 */
function normalizeYamlValue(value: unknown, tokens: string[], onDate: () => void): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new DataConvertError('This YAML holds a timestamp that is not a real date, so it cannot be converted.', {
        path: formatPointer(tokens),
      });
    }
    onDate();
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = normalizeYamlValue(value[i], [...tokens, String(i)], onDate);
    return value;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    throw new DataConvertError(
      `This YAML holds ${describeTaggedValue(value)}, which the other formats cannot hold, so it cannot be converted. Remove the tag to read it as text.`,
      { path: formatPointer(tokens) },
    );
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) obj[key] = normalizeYamlValue(obj[key], [...tokens, key], onDate);
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

/** Converts `text` from one of the six formats to another, returning the output and any loss warnings. Throws `DataConvertError` on a parse or structural problem. */
export function convertData(text: string, options: ConvertOptions): ConvertResult {
  const { from, to } = options;
  const indent = options.indent ?? 2;
  const warnings: string[] = [];

  // YAML to YAML re-serialises the same parsed document, so comments and
  // original scalar styles survive instead of resolving to plain
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
    if (exceedsNodeCount(resolved, MAX_YAML_NODES)) throw new DataConvertError(EXPANSION_MESSAGE);
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
    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { logLevel: 'error', uniqueKeys: true, prettyErrors: true, lineCounter });
    if (doc.errors.length > 0) {
      const err = doc.errors[0]!;
      const pos = err.linePos?.[0];
      throw new DataConvertError(err.message, { line: pos?.line, column: pos?.col });
    }
    const scan = scanYamlSource(doc, lineCounter);
    if (scan.hasComment) {
      warnings.push('Comments in the YAML input were dropped, since the output format here is not YAML.');
    }
    if (scan.hasNonCoreTag) {
      warnings.push('A YAML tag outside the core schema was dropped; the value is kept, the tag is not.');
    }
    if (scan.hasAliasOrAnchor) {
      warnings.push('A YAML anchor and its aliases were expanded into separate copies of the same value.');
    }
    if (scan.hasMergeKey) warnings.push(MERGE_KEY_WARNING);
    if (scan.hasYaml11Directive) warnings.push(YAML_11_WARNING);
    try {
      value = doc.toJS({ maxAliasCount: 100 });
    } catch (err) {
      if (err instanceof ReferenceError) throw new DataConvertError(ALIAS_BOMB_MESSAGE);
      throw err;
    }
  } else if (from === 'xml') {
    try {
      const read = readXmlValue(text, { attributePrefix: options.attributePrefix, textKey: options.textKey });
      value = read.value;
      warnings.push(...read.warnings);
    } catch (err) {
      if (err instanceof XmlValueError) throw new DataConvertError(err.message, { line: err.line, column: err.column });
      throw err;
    }
  } else if (from === 'csv' || from === 'tsv') {
    const read = readTable(text, from, {
      headerRow: options.headerRow ?? true,
      inferTypes: options.inferTypes ?? false,
    });
    value = read.value;
    warnings.push(...read.warnings);
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
  if (from === 'yaml' && exceedsNodeCount(value, MAX_YAML_NODES)) throw new DataConvertError(EXPANSION_MESSAGE);

  if (from === 'yaml') {
    let sawTimestamp = false;
    value = normalizeYamlValue(value, [], () => {
      sawTimestamp = true;
    });
    if (sawTimestamp) warnings.push(YAML_TIMESTAMP_WARNING);
  }

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

  if (to === 'xml') {
    try {
      const written = writeXmlValue(value, {
        attributePrefix: options.attributePrefix,
        textKey: options.textKey,
        rootName: options.rootName,
        rowName: options.rowName,
        indent,
      });
      warnings.push(...written.warnings);
      return { output: written.xml, warnings };
    } catch (err) {
      if (err instanceof XmlWriteError) throw new DataConvertError(err.message, { path: err.path });
      throw err;
    }
  }

  if (to === 'csv' || to === 'tsv') {
    const written = writeTable(value, to);
    warnings.push(...written.warnings);
    return { output: written.text, warnings };
  }

  if (to === 'toml' && from !== 'toml') {
    // A TOML target written from a non-TOML source lists every plain key
    // before any table, which can change the input's key order.
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
