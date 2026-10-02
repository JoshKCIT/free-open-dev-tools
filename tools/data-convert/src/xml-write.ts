/**
 * Writes a plain value as XML 1.0 text (canonical file, copied byte for byte into every folder that writes XML).
 * It has no dependency.
 *
 * The rules, the reverse of the reader's (see xml-read.ts):
 *  - a key that starts with the attribute prefix (default `@_`) becomes an attribute of its element, and its value
 *    must be text, a number, true, false or null;
 *  - the text key (default `#text`) is the element's own text;
 *  - every other key becomes a child element; an array under a key becomes that element repeated;
 *  - the root must be an object with exactly one top-level key; none, or several, are wrapped in an element named
 *    `rootName` (default `root`) and a warning says so; an array root becomes `rootName` holding one `rowName`
 *    (default `row`) element per item;
 *  - every element and attribute name must be an XML 1.0 Name, else the write is refused naming the key's RFC 6901
 *    path; so is a character XML 1.0 cannot hold at all, and an array inside an array;
 *  - null becomes an empty element and an empty array becomes nothing, each with a warning;
 *  - an XML declaration comes first.
 */

export class XmlWriteError extends Error {
  /** RFC 6901 pointer to the value or key that was refused, when the refusal is about one. */
  readonly path?: string;

  constructor(message: string, detail: { path?: string } = {}) {
    super(message);
    this.name = 'XmlWriteError';
    this.path = detail.path;
  }
}

export interface XmlWriteOptions {
  /** Prefix that marks a key as an attribute. Default '@_'. May be empty, in which case every key is an element. */
  attributePrefix?: string;
  /** Key whose value is the element's own text. Default '#text'. */
  textKey?: string;
  /** Name of the element that wraps several top-level keys or an array. Default 'root'. */
  rootName?: string;
  /** Name of the element written for each item of an array root. Default 'row'. */
  rowName?: string;
  /** Spaces per indent level. Default 2. */
  indent?: number;
}

export interface XmlWriteResult {
  xml: string;
  warnings: string[];
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
  ':A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D' +
  '\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
const NAME_CHAR = NAME_START_CHAR + '\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040';
// The combining-mark range in NameChar above is the XML 1.0 spec's own, not an accidental combining sequence.
// eslint-disable-next-line no-misleading-character-class
const XML_NAME = new RegExp(`^[${NAME_START_CHAR}][${NAME_CHAR}]*$`, 'u');

/** True for a string that is a valid XML 1.0 Name. */
export function isXmlName(name: string): boolean {
  return name.length > 0 && XML_NAME.test(name);
}

/**
 * Escapes text for element content: `&`, `<` and `>` become entities, and a carriage return becomes a character
 * reference so a reader's line-ending normalisation (XML 1.0 section 2.11) cannot turn it into a line feed.
 */
export function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
}

/** Escapes text for a double-quoted attribute value; tab and line breaks become character references so they are not normalised to spaces. */
function escapeXmlAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

/** The first code point of `text` that XML 1.0 cannot hold (section 2.2 Char production), as a number, or -1 if there is none. */
function findUnwritableChar(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd)) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
    }
    return c;
  }
  return -1;
}

function pointer(tokens: string[]): string {
  return tokens.map((t) => '/' + t.replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

/** True for a plain object (one made by `{}`, JSON or `Object.create(null)`); a Date, a byte array, a Set or a Map is not one. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function scalarText(value: unknown, tokens: string[]): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') text = String(value);
  else if (value === null) text = '';
  else throw new XmlWriteError('This value has no XML form.', { path: pointer(tokens) });
  const bad = findUnwritableChar(text);
  if (bad !== -1) {
    throw new XmlWriteError(
      `This text holds the character U+${bad.toString(16).toUpperCase().padStart(4, '0')}, which XML 1.0 cannot hold.`,
      { path: pointer(tokens) },
    );
  }
  return text;
}

interface WriterState {
  attributePrefix: string;
  textKey: string;
  indent: number;
  nullSeen: boolean;
  emptyArraySeen: boolean;
}

function lineStart(state: WriterState, depth: number): string {
  return state.indent > 0 ? '\n' + ' '.repeat(state.indent * depth) : '';
}

/** Writes one element named `name` for `value` at nesting `depth`. */
function writeElement(name: string, value: unknown, tokens: string[], depth: number, state: WriterState): string {
  if (Array.isArray(value)) {
    throw new XmlWriteError('An array inside an array has no XML form.', { path: pointer(tokens) });
  }
  if (!isRecord(value)) {
    if (value === null) state.nullSeen = true;
    const text = scalarText(value, tokens);
    return text === '' ? `<${name}/>` : `<${name}>${escapeXmlText(text)}</${name}>`;
  }

  let attributes = '';
  let text = '';
  let children = '';
  for (const key of Object.keys(value)) {
    const childTokens = [...tokens, key];
    const child = value[key];
    if (key === state.textKey) {
      if (isRecord(child) || Array.isArray(child)) {
        throw new XmlWriteError('The text of an element must be text, a number, true, false or null.', {
          path: pointer(childTokens),
        });
      }
      if (child === null) state.nullSeen = true;
      text = escapeXmlText(scalarText(child, childTokens));
      continue;
    }
    if (state.attributePrefix !== '' && key.startsWith(state.attributePrefix)) {
      const attributeName = key.slice(state.attributePrefix.length);
      if (!isXmlName(attributeName)) {
        throw new XmlWriteError(`"${attributeName}" is not a valid XML 1.0 attribute name.`, {
          path: pointer(childTokens),
        });
      }
      if (isRecord(child) || Array.isArray(child)) {
        throw new XmlWriteError('The value of an attribute must be text, a number, true, false or null.', {
          path: pointer(childTokens),
        });
      }
      if (child === null) state.nullSeen = true;
      attributes += ` ${attributeName}="${escapeXmlAttribute(scalarText(child, childTokens))}"`;
      continue;
    }
    if (!isXmlName(key)) {
      throw new XmlWriteError(`"${key}" is not a valid XML 1.0 element name.`, { path: pointer(childTokens) });
    }
    if (Array.isArray(child)) {
      if (child.length === 0) state.emptyArraySeen = true;
      child.forEach((item, i) => {
        children +=
          lineStart(state, depth + 1) + writeElement(key, item, [...childTokens, String(i)], depth + 1, state);
      });
    } else {
      children += lineStart(state, depth + 1) + writeElement(key, child, childTokens, depth + 1, state);
    }
  }

  if (children === '' && text === '') return `<${name}${attributes}/>`;
  if (children === '') return `<${name}${attributes}>${text}</${name}>`;
  return `<${name}${attributes}>${text}${children}${lineStart(state, depth)}</${name}>`;
}

/** Writes `value` as XML text by the rules at the top of this file. Throws `XmlWriteError` for a refused value. */
export function writeXmlValue(value: unknown, options: XmlWriteOptions = {}): XmlWriteResult {
  const rootName = options.rootName ?? 'root';
  const rowName = options.rowName ?? 'row';
  const state: WriterState = {
    attributePrefix: options.attributePrefix ?? '@_',
    textKey: options.textKey ?? '#text',
    indent: options.indent ?? 2,
    nullSeen: false,
    emptyArraySeen: false,
  };
  const warnings: string[] = [];

  let body: string;
  if (Array.isArray(value)) {
    if (!isXmlName(rootName)) {
      throw new XmlWriteError(`"${rootName}" is not a valid XML 1.0 element name, so it cannot be the root name.`);
    }
    if (!isXmlName(rowName)) {
      throw new XmlWriteError(`"${rowName}" is not a valid XML 1.0 element name, so it cannot be the row name.`);
    }
    let rows = '';
    value.forEach((item, i) => {
      rows += lineStart(state, 1) + writeElement(rowName, item, [String(i)], 1, state);
    });
    body = rows === '' ? `<${rootName}/>` : `<${rootName}>${rows}${lineStart(state, 0)}</${rootName}>`;
  } else if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] !== state.textKey && !keys[0]!.startsWith(state.attributePrefix || '\u0000')) {
      const only = keys[0]!;
      if (!isXmlName(only)) {
        throw new XmlWriteError(`"${only}" is not a valid XML 1.0 element name.`, { path: pointer([only]) });
      }
      const top = value[only];
      if (Array.isArray(top)) {
        // One top-level key holding an array would be several root elements; the wrapper makes it well formed.
        warnings.push('The input had one top-level key holding a list, so it was wrapped in a root element.');
        if (!isXmlName(rootName)) {
          throw new XmlWriteError(`"${rootName}" is not a valid XML 1.0 element name, so it cannot be the root name.`);
        }
        body = writeElement(rootName, value, [], 0, state);
      } else {
        body = writeElement(only, top, [only], 0, state);
      }
    } else {
      if (!isXmlName(rootName)) {
        throw new XmlWriteError(`"${rootName}" is not a valid XML 1.0 element name, so it cannot be the root name.`);
      }
      warnings.push(
        keys.length === 0
          ? 'The input had no top-level key, so it was wrapped in a root element.'
          : keys.length === 1
            ? 'The only top-level key is an attribute or the text of an element, which cannot be a root element, so it was wrapped in a root element.'
            : 'The input had more than one top-level key, so it was wrapped in a root element.',
      );
      body = writeElement(rootName, value, [], 0, state);
    }
  } else {
    throw new XmlWriteError('The input must be an object or a list so its keys can become XML elements.');
  }

  if (state.nullSeen)
    warnings.push('A null became an empty element or an empty attribute, which reads back as empty text.');
  if (state.emptyArraySeen) warnings.push('An empty list produced no elements, so it is not in the XML.');
  return { xml: '<?xml version="1.0" encoding="UTF-8"?>\n' + body, warnings };
}
