import { MermaidError } from './errors';
import { MAX_SVG_BYTES } from './limits';
import { collapseSpace, cutWithEllipsis, visible } from './text';

/**
 * The elements a drawn diagram may hold: the set measured over the SVG Mermaid 11.17.2 wrote for 22 diagram types with
 * this page's configuration (labels as SVG text) in all five themes. Compared exactly, so a
 * name in another case or with a prefix is refused.
 */
export const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'desc',
  'title',
  'style',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'marker',
  'symbol',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'filter',
  'feDropShadow',
  'switch',
  'foreignObject',
  'div',
  'span',
  'p',
  'b',
  'i',
  'em',
  'strong',
  'br',
]);

/** What the scrub hands back: the same SVG text, the title and description it holds and the diagram type it names. */
export interface ScrubResult {
  svg: string;
  /** The text of the SVG's own title element (the diagram's accTitle), cleaned for display. */
  title?: string;
  /** The text of the SVG's own desc element (the diagram's accDescr), cleaned for display. */
  description?: string;
  /** The diagram type Mermaid names on the SVG (for example `flowchart`), when it is a plain word. */
  type?: string;
}

/** The three namespace addresses an SVG may carry as the value of an `xmlns` attribute. */
const NAMESPACES: ReadonlySet<string> = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
]);

/** URL schemes refused inside an attribute value. */
const SCHEMES: readonly string[] = [
  'javascript',
  'vbscript',
  'data',
  'http',
  'https',
  'file',
  'blob',
  'ftp',
  'ws',
  'wss',
];

/** Style functions and rules that load something without a `url(`. */
const STYLE_LOADERS: readonly string[] = [
  '@import',
  'expression(',
  'image-set(',
  'cross-fade(',
  'element(',
  '-moz-binding',
];

const MAX_DEPTH = 256;
const MAX_ATTRIBUTES = 200;
const MAX_NAME_CHARS = 40;
const MAX_TITLE_CHARS = 300;
const MAX_DESCRIPTION_CHARS = 2000;

/** The words that complete the sentence "this page does not allow (...)". */
const REFUSED = {
  element: 'an element outside the allowed list',
  script: 'a script',
  event: 'an event attribute',
  link: 'a link that leaves the diagram',
  address: 'an address in an attribute',
  style: 'a style rule that loads something',
  doctype: 'a document type declaration',
  entity: 'an entity declaration',
  instruction: 'a processing instruction',
  comment: 'a comment',
  cdata: 'a CDATA section',
  malformed: 'markup that is not well formed',
  deep: 'nesting that is too deep',
  large: 'more than 5 MiB of markup',
} as const;

type RefusedKind = keyof typeof REFUSED;

function refuse(kind: RefusedKind): never {
  throw new MermaidError(
    `The rendered diagram contained something this page does not allow (${REFUSED[kind]}), so it was not shown.`,
  );
}

function isXmlSpace(unit: number): boolean {
  return unit === 0x20 || unit === 0x09 || unit === 0x0a || unit === 0x0d;
}

function isNameChar(unit: number): boolean {
  return (
    (unit >= 0x30 && unit <= 0x39) ||
    (unit >= 0x41 && unit <= 0x5a) ||
    (unit >= 0x61 && unit <= 0x7a) ||
    unit === 0x5f ||
    unit === 0x2d ||
    unit === 0x3a ||
    unit === 0x2e
  );
}

/** The number of bytes the text takes in UTF-8, counted without building the bytes. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

const PREDEFINED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
]);

/**
 * The text with its character references read: the five predefined entities and decimal and hexadecimal numbers. Any
 * other reference, an unfinished one or a number that is not a character makes the markup not well formed.
 */
function decodeEntities(text: string): string {
  let at = text.indexOf('&');
  if (at < 0) return text;
  let out = '';
  let from = 0;
  while (at >= 0) {
    const semi = text.indexOf(';', at + 1);
    if (semi < 0 || semi - at > 10) refuse('malformed');
    const name = text.slice(at + 1, semi);
    let decoded: string | undefined;
    if (name.charCodeAt(0) === 0x23) {
      const hex = name.charCodeAt(1) === 0x78;
      const digits = name.slice(hex ? 2 : 1);
      if (digits === '' || digits.length > 7) refuse('malformed');
      for (let i = 0; i < digits.length; i++) {
        const unit = digits.charCodeAt(i);
        const isDigit = unit >= 0x30 && unit <= 0x39;
        const isHexLetter = hex && ((unit >= 0x41 && unit <= 0x46) || (unit >= 0x61 && unit <= 0x66));
        if (!isDigit && !isHexLetter) refuse('malformed');
      }
      const code = parseInt(digits, hex ? 16 : 10);
      const allowed = code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0x10ffff);
      if (!allowed || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) refuse('malformed');
      decoded = String.fromCodePoint(code);
    } else {
      decoded = PREDEFINED_ENTITIES.get(name);
      if (decoded === undefined) refuse('malformed');
    }
    out += text.slice(from, at) + decoded;
    from = semi + 1;
    at = text.indexOf('&', from);
  }
  return out + text.slice(from);
}

/** One attribute as written: its name and the text between its quotes. */
interface Attribute {
  name: string;
  value: string;
}

/** A start tag: the element name, its attributes, the index just after it and whether it ends with `/>`. */
interface StartTag {
  name: string;
  attributes: Attribute[];
  end: number;
  selfClosing: boolean;
}

/** Reads the start tag whose `<` is at `from`. Anything not well formed is refused. */
function readStartTag(svg: string, from: number): StartTag {
  const n = svg.length;
  let i = from + 1;
  while (i < n && i - from <= MAX_NAME_CHARS + 1 && isNameChar(svg.charCodeAt(i))) i++;
  const name = svg.slice(from + 1, i);
  if (name === '' || name.length > MAX_NAME_CHARS) refuse('malformed');
  const attributes: Attribute[] = [];
  for (;;) {
    const gapStart = i;
    while (i < n && isXmlSpace(svg.charCodeAt(i))) i++;
    if (i >= n) refuse('malformed');
    const c = svg.charCodeAt(i);
    if (c === 0x3e) return { name, attributes, end: i + 1, selfClosing: false };
    if (c === 0x2f) {
      if (svg.charCodeAt(i + 1) !== 0x3e) refuse('malformed');
      return { name, attributes, end: i + 2, selfClosing: true };
    }
    if (i === gapStart) refuse('malformed');
    if (attributes.length >= MAX_ATTRIBUTES) refuse('malformed');
    const nameStart = i;
    while (i < n && i - nameStart <= MAX_NAME_CHARS + 1 && isNameChar(svg.charCodeAt(i))) i++;
    const attributeName = svg.slice(nameStart, i);
    if (attributeName === '' || attributeName.length > MAX_NAME_CHARS) refuse('malformed');
    while (i < n && isXmlSpace(svg.charCodeAt(i))) i++;
    if (svg.charCodeAt(i) !== 0x3d) refuse('malformed');
    i++;
    while (i < n && isXmlSpace(svg.charCodeAt(i))) i++;
    const quote = svg.charCodeAt(i);
    if (quote !== 0x22 && quote !== 0x27) refuse('malformed');
    const close = svg.indexOf(quote === 0x22 ? '"' : "'", i + 1);
    if (close < 0) refuse('malformed');
    const value = svg.slice(i + 1, close);
    if (value.indexOf('<') >= 0 || hasInvalidXmlChar(value)) refuse('malformed');
    attributes.push({ name: attributeName, value });
    i = close + 1;
  }
}

/** The text without the tabs and line breaks a browser removes from an address before it reads the scheme. */
function withoutUrlWhitespace(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) continue;
    out += text.slice(from, i);
    from = i + 1;
  }
  return from === 0 ? text : out + text.slice(from);
}

/** True when the text holds a character XML does not allow: a control character, U+FFFE, U+FFFF or half a surrogate pair. */
function hasInvalidXmlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x20) {
      if (unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) return true;
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if ((unit >= 0xdc00 && unit <= 0xdfff) || unit === 0xfffe || unit === 0xffff) {
      return true;
    }
  }
  return false;
}

/** True when `lower` holds `scheme:` at a word boundary: the scheme is not the end of a longer word. */
function hasScheme(lower: string, scheme: string): boolean {
  const token = `${scheme}:`;
  let at = lower.indexOf(token);
  while (at >= 0) {
    if (at === 0) return true;
    const before = lower.charCodeAt(at - 1);
    const wordChar =
      (before >= 0x30 && before <= 0x39) ||
      (before >= 0x61 && before <= 0x7a) ||
      before === 0x2b ||
      before === 0x2e ||
      before === 0x2d;
    if (!wordChar) return true;
    at = lower.indexOf(token, at + token.length);
  }
  return false;
}

/** True when every `url(` of the lower case text is followed (past spaces and quotes) by a `#`. */
function urlsStayInside(lower: string): boolean {
  let at = lower.indexOf('url(');
  while (at >= 0) {
    let i = at + 4;
    while (i < lower.length) {
      const unit = lower.charCodeAt(i);
      if (unit === 0x20 || unit === 0x09 || unit === 0x0a || unit === 0x0d || unit === 0x22 || unit === 0x27) i++;
      else break;
    }
    if (lower.charCodeAt(i) !== 0x23) return false;
    at = lower.indexOf('url(', at + 4);
  }
  return true;
}

/** Refuses style text, or the value of a style attribute, that loads something or hides what it loads. */
function checkStyleText(decoded: string): void {
  const lower = decoded.toLowerCase();
  if (lower.indexOf(String.fromCharCode(92)) >= 0) refuse('style');
  for (const loader of STYLE_LOADERS) if (lower.indexOf(loader) >= 0) refuse('style');
  const address = withoutUrlWhitespace(lower);
  if (hasScheme(address, 'javascript') || hasScheme(address, 'vbscript')) refuse('style');
  if (!urlsStayInside(lower)) refuse('style');
}

/** Refuses an attribute that carries an address, a link, a handler or a style that loads something. */
function checkAttribute(attribute: Attribute): void {
  const lowerName = attribute.name.toLowerCase();
  if (lowerName.startsWith('on')) refuse('event');
  const value = decodeEntities(attribute.value);
  if (lowerName === 'xmlns' || lowerName.startsWith('xmlns:')) {
    if (!NAMESPACES.has(value)) refuse('address');
    return;
  }
  if (lowerName === 'href' || lowerName === 'xlink:href') {
    if (!value.startsWith('#')) refuse('link');
    return;
  }
  if (lowerName === 'style') {
    checkStyleText(value);
    return;
  }
  const lower = value.toLowerCase();
  if (lower.indexOf('//') >= 0) refuse('address');
  const address = withoutUrlWhitespace(lower);
  if (address.indexOf('//') >= 0) refuse('address');
  for (const scheme of SCHEMES) if (hasScheme(address, scheme)) refuse('address');
  checkStyleText(value);
}

/** The text of a title or description, cleaned for display: character references read, white space folded, escaped. */
function cleanLabel(raw: string, limit: number): string | undefined {
  const text = cutWithEllipsis(collapseSpace(visible(raw)), limit);
  return text === '' ? undefined : text;
}

/** A diagram type name as Mermaid writes it, shortened to the plain word: letters, digits and hyphens only. */
function plainType(raw: string): string | undefined {
  let end = raw.length;
  if (end > 40) return undefined;
  for (let i = 0; i < raw.length; i++) {
    const unit = raw.charCodeAt(i);
    const ok =
      (unit >= 0x30 && unit <= 0x39) ||
      (unit >= 0x41 && unit <= 0x5a) ||
      (unit >= 0x61 && unit <= 0x7a) ||
      unit === 0x2d;
    if (!ok) return undefined;
  }
  // Mermaid marks the second generation of a diagram with a version suffix such as -v2.
  const dash = raw.lastIndexOf('-v');
  if (dash > 0 && raw.slice(dash + 2).length > 0) {
    let digits = true;
    for (let i = dash + 2; i < raw.length; i++) {
      const unit = raw.charCodeAt(i);
      if (unit < 0x30 || unit > 0x39) digits = false;
    }
    if (digits) end = dash;
  }
  return end === 0 ? undefined : raw.slice(0, end);
}

/**
 * Checks a drawn SVG in one pass and hands it back unchanged, with the title, description and diagram type it names.
 * Refuses (with a `MermaidError`) more than 5 MiB, markup that is not well formed, any element outside
 * `ALLOWED_ELEMENTS`, any attribute that starts with `on`, a link that does not start with `#`, an address in any
 * attribute value, style text that imports or loads anything, a document type declaration, an entity declaration, a
 * processing instruction, a comment and a CDATA section. Nothing the SVG holds is repeated in a message.
 */
export function scrubSvg(svg: string): ScrubResult {
  if (utf8Length(svg) > MAX_SVG_BYTES) refuse('large');
  const n = svg.length;
  const stack: string[] = [];
  let rootSeen = false;
  let rootClosed = false;
  let type: string | undefined;
  let title: string | undefined;
  let description: string | undefined;
  let capturing: 'title' | 'desc' | undefined;
  let captured = '';
  let inStyle = false;
  let styleText = '';
  let i = 0;

  const handleText = (raw: string): void => {
    if (stack.length === 0) {
      for (let k = 0; k < raw.length; k++) if (!isXmlSpace(raw.charCodeAt(k))) refuse('malformed');
      return;
    }
    if (raw.indexOf(']]>') >= 0 || hasInvalidXmlChar(raw)) refuse('malformed');
    const decoded = decodeEntities(raw);
    if (inStyle) styleText += decoded;
    if (capturing !== undefined) captured += decoded;
  };

  while (i < n) {
    const lt = svg.indexOf('<', i);
    if (lt < 0) {
      handleText(svg.slice(i));
      break;
    }
    if (lt > i) handleText(svg.slice(i, lt));
    const next = svg.charCodeAt(lt + 1);
    if (next === 0x21) {
      if (svg.startsWith('<!--', lt)) refuse('comment');
      if (svg.startsWith('<![CDATA[', lt)) refuse('cdata');
      const word = svg.slice(lt + 2, lt + 9).toUpperCase();
      if (word === 'DOCTYPE') refuse('doctype');
      if (word.startsWith('ENTITY')) refuse('entity');
      refuse('malformed');
    }
    if (next === 0x3f) refuse('instruction');
    if (next === 0x2f) {
      const close = svg.indexOf('>', lt + 2);
      if (close < 0) refuse('malformed');
      let nameEnd = close;
      while (nameEnd > lt + 2 && isXmlSpace(svg.charCodeAt(nameEnd - 1))) nameEnd--;
      const name = svg.slice(lt + 2, nameEnd);
      if (stack.length === 0 || stack[stack.length - 1] !== name) refuse('malformed');
      stack.pop();
      if (name === 'style') inStyle = false;
      if (
        capturing !== undefined &&
        ((capturing === 'title' && name === 'title') || (capturing === 'desc' && name === 'desc'))
      ) {
        if (capturing === 'title' && title === undefined) title = cleanLabel(captured, MAX_TITLE_CHARS);
        if (capturing === 'desc' && description === undefined)
          description = cleanLabel(captured, MAX_DESCRIPTION_CHARS);
        capturing = undefined;
        captured = '';
      }
      if (name === 'style') {
        checkStyleText(styleText);
        styleText = '';
      }
      if (stack.length === 0) rootClosed = true;
      i = close + 1;
      continue;
    }

    const tag = readStartTag(svg, lt);
    if (rootClosed) refuse('malformed');
    if (!ALLOWED_ELEMENTS.has(tag.name)) refuse(tag.name === 'script' ? 'script' : 'element');
    // One flag and one buffer track the text of a style element, so a style element inside another would make the
    // outer one's text go unchecked. Mermaid never writes one, so it is refused as malformed.
    if (tag.name === 'style' && inStyle) refuse('malformed');
    if (!rootSeen) {
      if (tag.name !== 'svg') refuse('malformed');
      rootSeen = true;
      for (const attribute of tag.attributes) {
        if (attribute.name === 'aria-roledescription') type = plainType(decodeEntities(attribute.value));
      }
    }
    for (const attribute of tag.attributes) checkAttribute(attribute);
    if (tag.selfClosing) {
      if (stack.length === 0) rootClosed = true;
    } else {
      if (stack.length >= MAX_DEPTH) refuse('deep');
      if (tag.name === 'style') {
        inStyle = true;
        styleText = '';
      }
      if (
        stack.length === 1 &&
        capturing === undefined &&
        ((tag.name === 'title' && title === undefined) || (tag.name === 'desc' && description === undefined))
      ) {
        capturing = tag.name;
        captured = '';
      }
      stack.push(tag.name);
    }
    i = tag.end;
  }
  if (!rootSeen || stack.length > 0) refuse('malformed');

  const result: ScrubResult = { svg };
  if (title !== undefined) result.title = title;
  if (description !== undefined) result.description = description;
  if (type !== undefined) result.type = type;
  return result;
}

/**
 * The width and height a drawn SVG states for itself, from its `viewBox` or else its numeric `width` and `height`.
 * Throws a `MermaidError` when the root element gives neither.
 */
export function svgSize(svg: string): { width: number; height: number } {
  const open = svg.indexOf('<');
  if (open < 0) refuse('malformed');
  const tag = readStartTag(svg, open);
  if (tag.name !== 'svg') refuse('malformed');
  const read = (name: string): string | undefined => tag.attributes.find((a) => a.name === name)?.value;
  const viewBox = read('viewBox');
  if (viewBox !== undefined) {
    const parts = collapseSpace(viewBox.split(',').join(' ')).split(' ');
    if (parts.length === 4) {
      const width = Number(parts[2]);
      const height = Number(parts[3]);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return { width, height };
    }
  }
  const width = parseFloat(read('width') ?? '');
  const height = parseFloat(read('height') ?? '');
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return { width, height };
  throw new MermaidError('The rendered diagram does not state its size.');
}

/** The declarations of a style value that stay when the size ones are dropped, joined as written. */
function styleWithoutSize(style: string): string {
  const kept: string[] = [];
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    if (property === 'max-width' || property === 'width' || property === 'height') continue;
    kept.push(declaration.trim());
  }
  return kept.join('; ');
}

/**
 * The SVG with its root element given a fixed pixel size: `width` and `height` replace the percentage Mermaid writes,
 * and a `viewBox` is added when there was none, so a browser draws it at that size when it is loaded as an image. A
 * `max-width` and the other size declarations of the root's style are dropped; the rest of the style stays. The result
 * passes `scrubSvg` again before it is returned.
 */
export function withPixelSize(svg: string, width: number, height: number): string {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 100_000 ||
    height > 100_000
  ) {
    throw new MermaidError('The diagram size is not valid.');
  }
  const open = svg.indexOf('<');
  if (open < 0) refuse('malformed');
  const tag = readStartTag(svg, open);
  if (tag.name !== 'svg') refuse('malformed');
  const original = svgSize(svg);
  let attributes = '';
  let hasViewBox = false;
  for (const attribute of tag.attributes) {
    const lowerName = attribute.name.toLowerCase();
    if (lowerName === 'width' || lowerName === 'height') continue;
    if (attribute.name === 'viewBox') hasViewBox = true;
    let value = attribute.value;
    if (lowerName === 'style') {
      value = styleWithoutSize(value);
      if (value === '') continue;
    }
    attributes += ` ${attribute.name}="${value.split('"').join('&quot;')}"`;
  }
  if (!hasViewBox) attributes += ` viewBox="0 0 ${original.width} ${original.height}"`;
  attributes += ` width="${width}" height="${height}"`;
  const sized = `${svg.slice(0, open)}<svg${attributes}${tag.selfClosing ? '/>' : '>'}${svg.slice(tag.end)}`;
  return scrubSvg(sized).svg;
}
