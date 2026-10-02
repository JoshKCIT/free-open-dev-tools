/**
 * Reads XML 1.0 text into a plain value (canonical file, copied byte for byte into every folder that reads XML).
 *
 * The rules, stated once so every folder that copies this file states the same thing:
 *  - an attribute becomes a key made of a prefix (default `@_`) and the attribute name;
 *  - the text of an element that also has attributes or child elements sits under the text key (default `#text`);
 *    an element with only text is just that text, and an empty element is the empty string;
 *  - repeated sibling elements become an array;
 *  - every value stays a string unless `parseValues` is on;
 *  - the five predefined entities and numeric character references are decoded once; the content of a CDATA section
 *    is literal text (XML 1.0 section 2.7), so `&amp;` inside CDATA stays those five characters;
 *  - the text of an element is gathered across its child elements and trimmed of spaces, tabs and line breaks once, at
 *    its two ends, so `<p>Hello <b>big</b> world</p>` keeps the space between its words; text that is only white
 *    space is dropped; what a CDATA section holds, and an attribute value, is never trimmed;
 *  - comments, processing instructions and the XML declaration are dropped, and a warning says so;
 *  - namespace prefixes stay in the names;
 *  - a DOCTYPE anywhere refuses the whole document before any parser reads it, so no entity is ever declared,
 *    resolved or expanded;
 *  - a document that is not well formed is refused with its line and column.
 *
 * Imports only `fast-xml-parser` and `./xml-doctype`.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { DOCTYPE_REFUSAL_MESSAGE, findDoctype } from './xml-doctype';

export class XmlValueError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'XmlValueError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface XmlReadOptions {
  /** Prefix an attribute's key gets. Default '@_'. May be empty. */
  attributePrefix?: string;
  /** Key an element's own text goes under when the element also has attributes or children. Default '#text'. */
  textKey?: string;
  /** Turn numbers and the words true and false into typed values. Default false: every value stays a string. */
  parseValues?: boolean;
}

export interface XmlReadResult {
  value: unknown;
  warnings: string[];
}

/** A document nested deeper than this is refused before any recursive walk touches it. */
const MAX_XML_DEPTH = 512;

const DEPTH_MESSAGE =
  'This document is nested more than 512 levels deep, so it was refused rather than risk freezing the tab.';

/**
 * Keys the parser is asked to use internally. Control characters cannot appear in an XML name, so an attribute, a
 * text node and an element can never be confused here whatever prefix or text key the caller chose; the caller's own
 * prefix and text key are put on afterwards.
 */
const INTERNAL_ATTRIBUTE_PREFIX = '\u0001';
const INTERNAL_TEXT_KEY = '\u0002';
const XML_WHITESPACE = new Set([' ', '\t', '\n', '\r']);

/** Trims spaces, tabs and line breaks (the four XML 1.0 white space characters) from both ends, in one pass each way. */
function trimXmlWhitespace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && XML_WHITESPACE.has(text[start]!)) start++;
  while (end > start && XML_WHITESPACE.has(text[end - 1]!)) end--;
  return start === 0 && end === text.length ? text : text.slice(start, end);
}

const PREDEFINED_ENTITIES: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>' };

/** Decodes the five predefined entities and decimal and hexadecimal character references in one left-to-right pass. */
function decodeXmlEntities(text: string): string {
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

/**
 * Makes the content of a CDATA section read back as literal text: the markup characters become entities, and the
 * white space becomes character references so the trimming of an element's text never touches it. Line breaks are
 * normalised first (XML 1.0 section 2.11), because a character reference would otherwise keep a carriage return.
 */
function escapeCdata(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, '&#32;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;');
}

interface MarkupScan {
  comments: boolean;
  instructions: boolean;
  declaration: boolean;
  /** The text with each CDATA section replaced by its content, escaped so it reads back as literal text, white space included. */
  text: string;
}

/** One pass over the markup: notes which dropped kinds are present and turns CDATA sections into escaped text. */
function scanMarkup(source: string): MarkupScan {
  let comments = false;
  let instructions = false;
  let declaration = false;
  let out = '';
  let copied = 0;
  let i = 0;
  const n = source.length;
  while (i < n) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;
    if (source.startsWith('<!--', lt)) {
      comments = true;
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
    } else if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      const stop = end === -1 ? n : end;
      out += source.slice(copied, lt) + escapeCdata(source.slice(lt + 9, stop));
      i = end === -1 ? n : end + 3;
      copied = i;
    } else if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2);
      if (lt === 0 && /^<\?xml[\s?]/.test(source.slice(0, 7))) declaration = true;
      else instructions = true;
      i = end === -1 ? n : end + 2;
    } else {
      i = lt + 1;
    }
  }
  out += source.slice(copied);
  return { comments, instructions, declaration, text: out };
}

/** True when a value is nested deeper than `max` levels. Iterative, so the check itself cannot overflow the stack. */
function exceedsXmlDepth(value: unknown, max: number): boolean {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.depth > max) return true;
    if (Array.isArray(top.value)) {
      for (const item of top.value) stack.push({ value: item, depth: top.depth + 1 });
    } else if (top.value !== null && typeof top.value === 'object') {
      for (const item of Object.values(top.value as Record<string, unknown>)) {
        stack.push({ value: item, depth: top.depth + 1 });
      }
    }
  }
  return false;
}

/** Sets an own, enumerable data property even for a key such as `__proto__`, which plain assignment would turn into a prototype change. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

interface RebuildState {
  attributePrefix: string;
  textKey: string;
  mixedContent: boolean;
  /** Reads a number or the word true or false from already trimmed text; undefined for anything else. Set only when values are read. */
  typed?: (text: string) => number | boolean | undefined;
}

/**
 * The reader for numbers and booleans, which is the XML parser's own (run on one small element), so the words it
 * accepts as a number are the ones it always accepted. Text holding markup characters is never a number.
 */
function scalarReader(): (text: string) => number | boolean | undefined {
  const parser = new XMLParser({ parseTagValue: true, trimValues: true, processEntities: false });
  return (text) => {
    if (text === '' || /[<&]/.test(text)) return undefined;
    try {
      const value = (parser.parse(`<v>${text}</v>`) as { v?: unknown }).v;
      return typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
    } catch {
      return undefined;
    }
  };
}

/** The value of an element's text: trimmed at its two ends, typed when asked, then its entities decoded. */
function textValue(raw: string, state: RebuildState): unknown {
  const trimmed = trimXmlWhitespace(raw);
  const typed = state.typed?.(trimmed);
  return typed !== undefined ? typed : decodeXmlEntities(trimmed);
}

/** The value of an attribute: typed when asked (from its trimmed text), otherwise exactly as written, entities decoded. */
function attributeValue(raw: string, state: RebuildState): unknown {
  const typed = state.typed?.(trimXmlWhitespace(raw));
  return typed !== undefined ? typed : decodeXmlEntities(raw);
}

/**
 * Copies the parser's result into fresh own-property objects, trimming and decoding every string and giving the
 * caller's own attribute prefix and text key to the internal ones. Safe to recurse: the depth was checked first.
 */
function rebuild(node: unknown, state: RebuildState): unknown {
  if (typeof node === 'string') return textValue(node, state);
  if (Array.isArray(node)) return node.map((item) => rebuild(item, state));
  if (node === null || typeof node !== 'object') return node;

  const source = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let hasText = false;
  let hasChild = false;
  for (const key of Object.keys(source)) {
    const raw = source[key];
    let name: string;
    let value: unknown;
    if (key === INTERNAL_TEXT_KEY) {
      // Text that is only white space (the line breaks between child elements) holds no data.
      if (typeof raw === 'string' && trimXmlWhitespace(raw) === '') continue;
      name = state.textKey;
      value = typeof raw === 'string' ? textValue(raw, state) : raw;
      hasText = true;
    } else if (key.startsWith(INTERNAL_ATTRIBUTE_PREFIX)) {
      name = state.attributePrefix + key.slice(INTERNAL_ATTRIBUTE_PREFIX.length);
      value = typeof raw === 'string' ? attributeValue(raw, state) : raw;
    } else {
      name = key;
      value = rebuild(raw, state);
      hasChild = true;
    }
    if (Object.prototype.hasOwnProperty.call(out, name)) {
      throw new XmlValueError(
        `The attribute prefix and text key chosen here make two keys the same ("${name}"). Choose a different prefix or text key.`,
      );
    }
    setOwn(out, name, value);
  }
  if (hasText && hasChild) state.mixedContent = true;
  return out;
}

/** Reads XML text into a value by the rules at the top of this file. Throws `XmlValueError` for a refused or malformed document. */
export function readXmlValue(text: string, options: XmlReadOptions = {}): XmlReadResult {
  const attributePrefix = options.attributePrefix ?? '@_';
  const textKey = options.textKey ?? '#text';
  const parseValues = options.parseValues ?? false;

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const doctype = findDoctype(source);
  if (doctype) throw new XmlValueError(DOCTYPE_REFUSAL_MESSAGE, { line: doctype.line, column: doctype.column });

  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    const { err } = validation;
    throw new XmlValueError(err.msg, { line: err.line, column: err.col });
  }

  const scan = scanMarkup(source);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: INTERNAL_ATTRIBUTE_PREFIX,
    textNodeName: INTERNAL_TEXT_KEY,
    processEntities: false,
    // Nothing is trimmed or typed by the parser: text is gathered, trimmed once and typed in `rebuild`, so white space
    // inside an element's text, in a CDATA section and in an attribute value is never lost to a per-piece trim.
    trimValues: false,
    parseTagValue: false,
    parseAttributeValue: false,
    ignoreDeclaration: true,
    ignorePiTags: true,
    // The parser's own default is 100 levels; this keeps the one depth limit every other format here has.
    maxNestedTags: MAX_XML_DEPTH,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(scan.text);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The document could not be parsed.';
    throw new XmlValueError(message === 'Maximum nested tags exceeded' ? DEPTH_MESSAGE : message);
  }

  if (exceedsXmlDepth(parsed, MAX_XML_DEPTH)) throw new XmlValueError(DEPTH_MESSAGE);

  const roots = parsed !== null && typeof parsed === 'object' ? Object.keys(parsed as Record<string, unknown>) : [];
  if (roots.length !== 1 || Array.isArray((parsed as Record<string, unknown>)[roots[0]!])) {
    throw new XmlValueError('An XML document has exactly one root element; this one has more than one, or none.');
  }

  const state: RebuildState = {
    attributePrefix,
    textKey,
    mixedContent: false,
    typed: parseValues ? scalarReader() : undefined,
  };
  const value = rebuild(parsed, state);

  const warnings: string[] = [];
  if (scan.declaration) warnings.push('The XML declaration was dropped; it is not part of the data.');
  if (scan.instructions) warnings.push('Processing instructions in the XML were dropped.');
  if (scan.comments) warnings.push('Comments in the XML were dropped.');
  if (state.mixedContent) {
    warnings.push(
      `An element mixes text with child elements; the text is gathered under ${textKey} and its place among the elements is not kept.`,
    );
  }
  return { value, warnings };
}
