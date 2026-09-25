import meta from './meta.json';
import { parseJsonText, exceedsDepth, MAX_JSON_DEPTH } from './json-text';
import { formatPointer } from './pointer';
import { XMLParser, XMLValidator, XMLBuilder } from 'fast-xml-parser';

export { meta };

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

const DOCTYPE_MESSAGE = 'Documents with a DOCTYPE are refused: this page never reads DTDs or entity declarations.';

export class XmlJsonError extends Error {
  readonly line?: number;
  readonly column?: number;
  /** RFC 6901 pointer, set for a JSON key that is not a valid XML 1.0 name. */
  readonly path?: string;

  constructor(message: string, detail: { line?: number; column?: number; path?: string } = {}) {
    super(message);
    this.name = 'XmlJsonError';
    this.line = detail.line;
    this.column = detail.column;
    this.path = detail.path;
  }
}

export interface XmlToJsonOptions {
  /** Prefix an attribute's key gets in the JSON output. Default '@_'. */
  attributePrefix?: string;
  /** Key an element's own text goes under in the JSON output. Default '#text'. */
  textKey?: string;
  /** Force every element into an array, even one with a single occurrence. Default false. */
  alwaysArray?: boolean;
  /** Keep mixed text and child element order (a different JSON shape). Default false. */
  keepOrder?: boolean;
  /** Parse tag and attribute values into numbers/booleans instead of leaving every value a string. Default false. */
  parseValues?: boolean;
}

export interface JsonToXmlOptions {
  attributePrefix?: string;
  textKey?: string;
  /** Spaces per indent level. Default 2. */
  indent?: number;
  /** Prepend an XML declaration. Default true. */
  declaration?: boolean;
}

export interface XmlJsonResult {
  output: string;
  warnings: string[];
  /** Count of XML elements read or written. */
  elements: number;
}

/**
 * The XML 1.0 (Fifth Edition) Name production, section 2.3:
 * https://www.w3.org/TR/xml/#NT-Name
 *   NameStartChar ::= ":" | [A-Z] | "_" | [a-z] | [#xC0-#xD6] | [#xD8-#xF6] |
 *     [#xF8-#x2FF] | [#x370-#x37D] | [#x37F-#x1FFF] | [#x200C-#x200D] |
 *     [#x2070-#x218F] | [#x2C00-#x2FEF] | [#x3001-#xD7FF] | [#xF900-#xFDCF] |
 *     [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]
 *   NameChar ::= NameStartChar | "-" | "." | [0-9] | #xB7 | [#x0300-#x036F] | [#x203F-#x2040]
 *   Name ::= NameStartChar (NameChar)*
 */
const NAME_START_CHAR =
  ':A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D' +
  '\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}';
const NAME_CHAR = NAME_START_CHAR + '\\-.0-9\u00B7\u0300-\u036F\u203F-\u2040';
// \u0300-\u036F above is the XML 1.0 spec's own combining-mark range for NameChar, not an
// accidental combining sequence in this class.
// eslint-disable-next-line no-misleading-character-class
const XML_NAME = new RegExp(`^[${NAME_START_CHAR}][${NAME_CHAR}]*$`, 'u');

/** True for a string that is a valid XML 1.0 Name. */
export function isXmlName(name: string): boolean {
  return name.length > 0 && XML_NAME.test(name);
}

const PREDEFINED_ENTITIES: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>' };

/**
 * Decodes the five predefined XML entities and decimal/hexadecimal numeric
 * character references in one left-to-right pass. Used instead of the
 * library's own entity decoding, which this page's `processEntities: false`
 * configuration (required to keep DOCTYPE entities from ever expanding, D-58)
 * also turns off for these five safe, non-DOCTYPE entities.
 */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return whole;
      }
    }
    return Object.prototype.hasOwnProperty.call(PREDEFINED_ENTITIES, body) ? PREDEFINED_ENTITIES[body]! : whole;
  });
}

/** Walks a parsed XML result, decoding entities in every string value found. Mutates in place: every key visited already exists on an object fast-xml-parser itself built, so overwriting its value never creates a new property. */
function decodeEntitiesDeep(value: unknown): unknown {
  if (typeof value === 'string') return decodeXmlEntities(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = decodeEntitiesDeep(value[i]);
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) obj[key] = decodeEntitiesDeep(obj[key]);
    return value;
  }
  return value;
}

function hasDoctype(text: string): boolean {
  return /<!DOCTYPE/i.test(text);
}

/** Reads XML text into a JSON-friendly value. Refuses any document with a DOCTYPE before parsing (D-58). */
export function xmlToJson(text: string, options: XmlToJsonOptions = {}): XmlJsonResult {
  const {
    attributePrefix = '@_',
    textKey = '#text',
    alwaysArray = false,
    keepOrder = false,
    parseValues = false,
  } = options;

  if (hasDoctype(text)) throw new XmlJsonError(DOCTYPE_MESSAGE);

  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    const { err } = validation;
    throw new XmlJsonError(err.msg, { line: err.line, column: err.col });
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: attributePrefix,
    textNodeName: textKey,
    processEntities: false,
    parseTagValue: parseValues,
    parseAttributeValue: parseValues,
    preserveOrder: keepOrder,
    isArray: (_name, _jPath, _isLeafNode, isAttribute) => alwaysArray && !isAttribute,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(text);
  } catch (err) {
    throw new XmlJsonError(err instanceof Error ? err.message : 'The document could not be parsed.');
  }

  if (exceedsDepth(parsed, MAX_JSON_DEPTH)) throw new XmlJsonError(DEPTH_MESSAGE);

  const decoded = decodeEntitiesDeep(parsed);
  const elements = countElements(decoded, keepOrder, textKey, attributePrefix);
  return { output: JSON.stringify(decoded, null, 2), warnings: [], elements };
}

/** Rough element count for the page's stats line: every object key that is not the text key or an attribute counts once per array entry. */
function countElements(value: unknown, keepOrder: boolean, textKey: string, attributePrefix: string): number {
  let count = 0;
  const visit = (node: unknown, isRoot: boolean): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, isRoot);
      return;
    }
    if (node !== null && typeof node === 'object') {
      if (keepOrder) {
        for (const key of Object.keys(node as Record<string, unknown>)) {
          if (key === ':@') continue;
          count++;
          visit((node as Record<string, unknown>)[key], false);
        }
        return;
      }
      if (isRoot) count++;
      for (const key of Object.keys(node as Record<string, unknown>)) {
        if (key === textKey || (attributePrefix !== '' && key.startsWith(attributePrefix))) continue;
        visit((node as Record<string, unknown>)[key], false);
      }
    }
  };
  visit(value, true);
  return count;
}

/** Walks a JSON value that will become XML, refusing the first element or attribute name that is not a valid XML 1.0 Name, and counting elements on the way. */
function checkNamesAndCount(
  value: unknown,
  tokens: string[],
  attributePrefix: string,
  textKey: string,
  isRoot: boolean,
): number {
  if (value === null || typeof value !== 'object') return isRoot ? 1 : 0;

  if (Array.isArray(value)) {
    let total = 0;
    value.forEach((item, i) => {
      total += checkNamesAndCount(item, [...tokens, String(i)], attributePrefix, textKey, isRoot);
    });
    return total;
  }

  let count = isRoot ? 1 : 0;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const childTokens = [...tokens, key];
    if (key === textKey) continue;
    if (attributePrefix !== '' && key.startsWith(attributePrefix)) {
      const attrName = key.slice(attributePrefix.length);
      if (!isXmlName(attrName)) {
        throw new XmlJsonError(`"${attrName}" is not a valid XML 1.0 attribute name.`, {
          path: formatPointer(childTokens),
        });
      }
      continue;
    }
    if (!isXmlName(key)) {
      throw new XmlJsonError(`"${key}" is not a valid XML 1.0 element name.`, { path: formatPointer(childTokens) });
    }
    const child = obj[key];
    if (Array.isArray(child)) {
      child.forEach((item, i) => {
        count += 1;
        count += checkNamesAndCount(item, [...childTokens, String(i)], attributePrefix, textKey, false);
      });
    } else {
      count += 1;
      count += checkNamesAndCount(child, childTokens, attributePrefix, textKey, false);
    }
  }
  return count;
}

/** Writes a JSON value as XML text. The root must be an object; more than one top-level key (or none) is wrapped in a `<root>` element with a warning. */
export function jsonToXml(text: string, options: JsonToXmlOptions = {}): XmlJsonResult {
  const { attributePrefix = '@_', textKey = '#text', indent = 2, declaration = true } = options;

  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    throw new XmlJsonError(parsed.message ?? 'The document could not be parsed.', {
      line: parsed.line,
      column: parsed.column,
    });
  }
  if (exceedsDepth(parsed.value, MAX_JSON_DEPTH)) throw new XmlJsonError(DEPTH_MESSAGE);

  const value = parsed.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new XmlJsonError('The input must be a JSON object whose keys become XML elements.');
  }

  const warnings: string[] = [];
  const topKeys = Object.keys(value as Record<string, unknown>);
  const rootValue: Record<string, unknown> =
    topKeys.length === 1
      ? (value as Record<string, unknown>)
      : (() => {
          warnings.push(
            topKeys.length === 0
              ? 'The input had no top-level key, so it was wrapped in a root element.'
              : 'The input had more than one top-level key, so it was wrapped in a root element.',
          );
          return { root: value };
        })();

  const elements = checkNamesAndCount(rootValue, [], attributePrefix, textKey, true);

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: attributePrefix,
    textNodeName: textKey,
    format: true,
    indentBy: ' '.repeat(indent),
  });

  let output: string;
  try {
    output = builder.build(rootValue) as string;
  } catch (err) {
    throw new XmlJsonError(err instanceof Error ? err.message : 'The document could not be built as XML.');
  }
  if (declaration) output = '<?xml version="1.0" encoding="UTF-8"?>\n' + output;

  return { output, warnings, elements };
}
