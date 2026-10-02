import meta from './meta.json';
import { setOwn, hasOwn, getOwn } from './own-property';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from './json-text';
import { XmlValueError, readXmlValue } from './xml-read';
import { typeXmlValues } from './xml-typed';
import { YamlValueError, readYamlValue } from './yaml-value';

export { meta };
export { MAX_JSON_DEPTH };

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

export type SchemaDraft = 'draft-07' | '2020-12';
export type SamplesAre = 'single' | 'array' | 'lines';

/** What the sample text is written in. `json` is the default and reads exactly as it always has. */
export const INPUT_FORMATS = ['json', 'yaml', 'xml'] as const;
export type InputFormat = (typeof INPUT_FORMATS)[number];

export class SchemaGeneratorError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'SchemaGeneratorError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface GenerateSchemaFromValuesOptions {
  draft?: SchemaDraft;
  detectFormats?: boolean;
}

export interface GenerateSchemaOptions extends GenerateSchemaFromValuesOptions {
  samplesAre?: SamplesAre;
  /** How the sample text is written. Default `json`. */
  inputFormat?: InputFormat;
  /** XML input only. Read text written like a JSON number, `true` or `false` as a number or boolean. Default false: every XML leaf is a string. */
  parseValues?: boolean;
}

export interface GenerateSchemaResult {
  schema: unknown;
  output: string;
  sampleCount: number;
  /** Notes from reading YAML or XML; present only when there is something to report. */
  warnings?: string[];
}

/**
 * Basic JSON Schema type names this package tells values apart into, in the
 * fixed order a multi-type location's own `type` array is always written
 * in (this package's own ambiguities note this is a fixed order, not
 * sample order).
 */
const TYPE_ORDER = ['null', 'boolean', 'integer', 'number', 'string', 'array', 'object'] as const;
type BasicType = (typeof TYPE_ORDER)[number];

/**
 * One location's inferred shape, merged across every sample seen there.
 * `propertyOrder` is kept separate from `properties` (itself built with
 * `setOwn`) so nothing ever needs `Object.keys`/`Object.values` on an
 * object built from sample-derived keys (E2) -- push order into a plain
 * array carries no prototype-pollution risk the way a bracket-keyed read
 * would.
 */
interface InferNode {
  types: BasicType[];
  propertyOrder?: string[];
  properties?: Record<string, InferNode>;
  required?: string[];
  items?: InferNode;
  format?: string;
}

// --- String format detection (E: "no looser than ajv-formats' full mode") ---
// Ported directly from ajv-formats' own fullFormats definitions
// (https://github.com/ajv-validator/ajv-formats/blob/master/src/formats.ts,
// fetched this session), not re-derived from memory, so a sample this
// package calls a date-time is one Ajv's own full-mode `date-time` format
// would also accept.

const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

const DATE_RE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;

function isFullDate(str: string): boolean {
  const m = DATE_RE.exec(str);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const daysInThisMonth = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month] ?? 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInThisMonth;
}

const TIME_RE = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;

/** `strictTimeZone` true matches ajv-formats' own `date-time` full-mode rule: the time zone is mandatory. */
function isFullTime(str: string, strictTimeZone: boolean): boolean {
  const m = TIME_RE.exec(str);
  if (!m) return false;
  const hr = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const tz = m[4];
  const tzSign = m[5] === '-' ? -1 : 1;
  const tzH = Number(m[6] ?? 0);
  const tzM = Number(m[7] ?? 0);
  if (tzH > 23 || tzM > 59 || (strictTimeZone && !tz)) return false;
  if (hr <= 23 && min <= 59 && sec < 60) return true;
  // Leap second, same allowance ajv-formats' own full-mode check makes.
  const utcMin = min - tzM * tzSign;
  const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
  return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
}

const DATE_TIME_SEPARATOR = /t|\s/i;

function isFullDateTime(str: string): boolean {
  const parts = str.split(DATE_TIME_SEPARATOR);
  return parts.length === 2 && isFullDate(parts[0] ?? '') && isFullTime(parts[1] ?? '', true);
}

const UUID_RE = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Checked in this order; the first format every sample matches wins. */
const FORMAT_CHECKS: { format: string; test: (s: string) => boolean }[] = [
  { format: 'date-time', test: isFullDateTime },
  { format: 'date', test: isFullDate },
  { format: 'uuid', test: (s) => UUID_RE.test(s) },
  { format: 'ipv4', test: (s) => IPV4_RE.test(s) },
];

function detectFormat(stringSamples: string[]): string | undefined {
  for (const { format, test } of FORMAT_CHECKS) {
    if (stringSamples.every(test)) return format;
  }
  return undefined;
}

// --- Inference ---

function inferValues(values: unknown[], detectFormats: boolean): InferNode {
  const typeSet = new Set<BasicType>();
  const objectSamples: Record<string, unknown>[] = [];
  const arraySamples: unknown[][] = [];
  const stringSamples: string[] = [];

  for (const v of values) {
    if (v === null) {
      typeSet.add('null');
    } else if (typeof v === 'boolean') {
      typeSet.add('boolean');
    } else if (typeof v === 'number') {
      typeSet.add(Number.isInteger(v) ? 'integer' : 'number');
    } else if (typeof v === 'string') {
      typeSet.add('string');
      stringSamples.push(v);
    } else if (Array.isArray(v)) {
      typeSet.add('array');
      arraySamples.push(v);
    } else if (typeof v === 'object') {
      typeSet.add('object');
      objectSamples.push(v as Record<string, unknown>);
    }
  }

  // "integer plus number becomes number" -- a schema listing both would be
  // redundant, since JSON Schema's own `number` type already accepts every
  // integer value too.
  if (typeSet.has('integer') && typeSet.has('number')) typeSet.delete('integer');

  const node: InferNode = { types: TYPE_ORDER.filter((t) => typeSet.has(t)) };

  if (objectSamples.length > 0) {
    const propertyOrder: string[] = [];
    const seen = new Set<string>();
    for (const obj of objectSamples) {
      for (const key of Object.keys(obj)) {
        if (!seen.has(key)) {
          seen.add(key);
          propertyOrder.push(key);
        }
      }
    }
    const properties: Record<string, InferNode> = {};
    const required: string[] = [];
    for (const key of propertyOrder) {
      const childValues: unknown[] = [];
      let presentCount = 0;
      for (const obj of objectSamples) {
        if (hasOwn(obj, key)) {
          childValues.push(getOwn(obj, key));
          presentCount++;
        }
      }
      setOwn(properties, key, inferValues(childValues, detectFormats));
      if (presentCount === objectSamples.length) required.push(key);
    }
    node.propertyOrder = propertyOrder;
    node.properties = properties;
    if (required.length > 0) node.required = required;
  }

  if (arraySamples.length > 0) {
    const allItems: unknown[] = [];
    for (const arr of arraySamples) for (const item of arr) allItems.push(item);
    // Omitted (not merged) when every array sample here was empty -- there
    // is nothing to infer an item shape from.
    if (allItems.length > 0) node.items = inferValues(allItems, detectFormats);
  }

  if (detectFormats && stringSamples.length > 0) {
    const format = detectFormat(stringSamples);
    if (format) node.format = format;
  }

  return node;
}

/** Turns an `InferNode` into a plain JSON Schema fragment, written with `setOwn` at every sample-derived key. */
function buildSchemaNode(node: InferNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out.type = node.types.length === 1 ? node.types[0] : node.types;
  if (node.format) out.format = node.format;

  if (node.properties && node.propertyOrder) {
    const propsOut: Record<string, unknown> = {};
    for (const key of node.propertyOrder) {
      setOwn(propsOut, key, buildSchemaNode(getOwn(node.properties, key) as InferNode));
    }
    out.properties = propsOut;
    if (node.required && node.required.length > 0) out.required = node.required;
  }

  if (node.items) out.items = buildSchemaNode(node.items);

  return out;
}

const SCHEMA_ID: Record<SchemaDraft, string> = {
  'draft-07': 'http://json-schema.org/draft-07/schema#',
  '2020-12': 'https://json-schema.org/draft/2020-12/schema',
};

function collectSamples(samplesText: string, samplesAre: SamplesAre): unknown[] {
  if (samplesAre === 'single') {
    const parsed = parseJsonText(samplesText);
    if (!parsed.ok) {
      throw new SchemaGeneratorError(parsed.message ?? 'The document could not be parsed.', {
        line: parsed.line,
        column: parsed.column,
      });
    }
    return [parsed.value];
  }

  if (samplesAre === 'array') {
    const parsed = parseJsonText(samplesText);
    if (!parsed.ok) {
      throw new SchemaGeneratorError(parsed.message ?? 'The document could not be parsed.', {
        line: parsed.line,
        column: parsed.column,
      });
    }
    if (!Array.isArray(parsed.value)) {
      throw new SchemaGeneratorError('Samples must be a JSON array whose items are the sample documents.');
    }
    return parsed.value;
  }

  // 'lines': JSON Lines -- one document per non-blank line.
  const lines = samplesText.split(/\r\n|\r|\n/);
  const samples: unknown[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    const parsed = parseJsonText(line);
    if (!parsed.ok) {
      throw new SchemaGeneratorError(`Line ${index + 1}: ${parsed.message ?? 'could not be parsed.'}`, {
        line: index + 1,
        column: parsed.column,
      });
    }
    samples.push(parsed.value);
  });
  return samples;
}

function yamlError(err: YamlValueError): SchemaGeneratorError {
  return new SchemaGeneratorError(err.message, { line: err.line, column: err.column });
}

/** Reads YAML samples by the same three choices JSON has: one document, a list at the top, or a `---` stream. */
function collectYamlSamples(text: string, samplesAre: SamplesAre): { samples: unknown[]; warnings: string[] } {
  try {
    if (samplesAre === 'lines') {
      const read = readYamlValue(text, { documents: 'many' });
      return { samples: read.value as unknown[], warnings: read.warnings };
    }
    const read = readYamlValue(text, { documents: 'one' });
    if (samplesAre === 'array') {
      if (!Array.isArray(read.value)) {
        throw new SchemaGeneratorError('Samples must be a YAML list whose items are the sample documents.');
      }
      return { samples: read.value, warnings: read.warnings };
    }
    return { samples: [read.value], warnings: read.warnings };
  } catch (err) {
    if (err instanceof YamlValueError) throw yamlError(err);
    throw err;
  }
}

/** Reads one XML document. The array and lines choices have no meaning for XML, so they are not applied and a warning says so. */
function collectXmlSamples(
  text: string,
  samplesAre: SamplesAre,
  parseValues: boolean,
): { samples: unknown[]; warnings: string[] } {
  try {
    const read = readXmlValue(text);
    const warnings = [...read.warnings];
    if (samplesAre !== 'single') {
      warnings.push('XML holds one document, so the choice of samples was not applied; the one document was used.');
    }
    return { samples: [parseValues ? typeXmlValues(read.value) : read.value], warnings };
  } catch (err) {
    if (err instanceof XmlValueError)
      throw new SchemaGeneratorError(err.message, { line: err.line, column: err.column });
    throw err;
  }
}

/**
 * Infers a JSON Schema from samples that are already parsed values. This is the part of `generateSchema` that comes
 * after the text has been read, so every input format reaches the same inference. Every sample is checked against the
 * 512-level depth limit before inference (E3).
 */
export function generateSchemaFromValues(
  samples: unknown[],
  options: GenerateSchemaFromValuesOptions = {},
): GenerateSchemaResult {
  const draft = options.draft ?? '2020-12';
  const detectFormats = options.detectFormats ?? true;

  if (samples.length === 0) {
    throw new SchemaGeneratorError('At least one sample document is needed to infer a schema.');
  }
  for (const sample of samples) {
    if (exceedsDepth(sample, MAX_JSON_DEPTH)) throw new SchemaGeneratorError(DEPTH_MESSAGE);
  }

  const root = inferValues(samples, detectFormats);
  const schemaBody = buildSchemaNode(root);
  const schema: Record<string, unknown> = { $schema: SCHEMA_ID[draft], ...schemaBody };

  return { schema, output: JSON.stringify(schema, null, 2), sampleCount: samples.length };
}

/**
 * Infers a JSON Schema from one or more sample documents. `samplesAre`
 * selects how `samplesText` is read: `single` (one document), `array` (a
 * JSON array whose items are the samples) or `lines` (JSON Lines, one
 * document per non-blank line). `inputFormat` says the text is YAML or XML
 * instead of JSON; YAML keeps the three choices (one document, a list at the
 * top, a `---` stream) and XML reads one document.
 */
export function generateSchema(samplesText: string, options: GenerateSchemaOptions = {}): GenerateSchemaResult {
  const samplesAre = options.samplesAre ?? 'single';
  const inputFormat = options.inputFormat ?? 'json';

  if (inputFormat === 'json') return generateSchemaFromValues(collectSamples(samplesText, samplesAre), options);

  const read =
    inputFormat === 'yaml'
      ? collectYamlSamples(samplesText, samplesAre)
      : collectXmlSamples(samplesText, samplesAre, options.parseValues ?? false);
  const result = generateSchemaFromValues(read.samples, options);
  return read.warnings.length > 0 ? { ...result, warnings: read.warnings } : result;
}
