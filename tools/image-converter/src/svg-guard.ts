/**
 * A one-pass check of SVG text before a browser is asked to draw it.
 *
 * An SVG file is markup that can name scripts, other files, other pages and
 * web addresses. This page draws an SVG only through an image, which loads
 * nothing and runs nothing, and it checks the text first so that anything
 * that tries is refused with a plain sentence instead of being drawn. The
 * check is the second wall: the refusal list below is deliberately wider than
 * what a browser would act on.
 *
 * Refused: type declarations and entity declarations; processing
 * instructions (the style sheet one by name); script, foreignObject, iframe,
 * embed, object and link elements; a style element, style attribute or any
 * other attribute value that imports a file or uses an address function other
 * than a reference to an element inside the same SVG (a hash sign); any
 * event attribute (name starting with "on"); any href or xlink:href that does
 * not start with a hash sign; and an animation that changes an href. A
 * character reference or a backslash is decoded or refused first, so nothing
 * can be hidden from the check by writing it another way.
 *
 * The scan walks the text once with index searches (no pattern runs over the
 * whole text), so a million characters take a few milliseconds whatever they
 * hold. Messages name the kind of thing and its character position, never
 * any of the text.
 */

export class SvgGuardError extends Error {
  readonly construct: string;
  /** 1-based character position of the refused construct in the SVG text. */
  readonly position: number;
  constructor(construct: string, position: number) {
    super(
      `This SVG uses ${construct} at character ${position}, which this page does not load. Remove it and try again.`,
    );
    this.name = 'SvgGuardError';
    this.construct = construct;
    this.position = position;
  }
}

const UNFINISHED = 'markup that is not finished';
const UNREADABLE = 'markup this page cannot read';
const LOADS = 'a value that loads another file';

/** Local element names (after any prefix, lower case) that are refused outright. */
const BANNED_ELEMENTS: ReadonlyMap<string, string> = new Map([
  ['script', 'a script element'],
  ['foreignobject', 'a foreignObject element'],
  ['iframe', 'an iframe element'],
  ['embed', 'an embed element'],
  ['object', 'an object element'],
  ['link', 'a link element'],
]);

/** CSS functions that fetch a picture or file by name (url is handled on its own: a hash reference is fine). */
const LOADING_FUNCTIONS: ReadonlySet<string> = new Set([
  'image-set',
  '-webkit-image-set',
  'image',
  'src',
  'cross-fade',
  '-webkit-cross-fade',
]);

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

function isIdentChar(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 95 || (c >= 65 && c <= 90);
}

function localName(name: string): string {
  const colon = name.lastIndexOf(':');
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase();
}

function startsWithAt(text: string, at: number, needle: string): boolean {
  return text.startsWith(needle, at);
}

function startsWithIgnoreCase(text: string, at: number, needle: string): boolean {
  return text.slice(at, at + needle.length).toLowerCase() === needle;
}

const NAMED_REFERENCES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/**
 * Turns the five named references and numeric character references into the
 * characters they stand for, as an XML reader would, so the checks see what a
 * browser would see. Looks at most 12 characters past each ampersand.
 */
export function decodeReferences(s: string): string {
  if (s.indexOf('&') === -1) return s;
  const parts: string[] = [];
  let last = 0;
  let i = s.indexOf('&');
  while (i !== -1) {
    let semi = -1;
    const stop = Math.min(s.length, i + 12);
    for (let k = i + 1; k < stop; k++) {
      if (s.charCodeAt(k) === 59) {
        semi = k;
        break;
      }
    }
    let replacement: string | undefined;
    if (semi !== -1) {
      const body = s.slice(i + 1, semi);
      if (body.charCodeAt(0) === 35) {
        const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
        const digits = hex ? body.slice(2) : body.slice(1);
        const valid =
          digits.length > 0 &&
          digits.length <= 7 &&
          [...digits].every((ch) => (hex ? '0123456789abcdefABCDEF' : '0123456789').includes(ch));
        if (valid) {
          const code = parseInt(digits, hex ? 16 : 10);
          if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff))
            replacement = String.fromCodePoint(code);
        }
      } else {
        replacement = NAMED_REFERENCES.get(body);
      }
    }
    if (replacement !== undefined) {
      parts.push(s.slice(last, i), replacement);
      last = semi + 1;
      i = s.indexOf('&', last);
    } else {
      i = s.indexOf('&', i + 1);
    }
  }
  parts.push(s.slice(last));
  return parts.join('');
}

/**
 * True when decoded value or style text names anything to load: an import, a
 * backslash escape (which could spell any word), a url(...) that does not
 * start with a hash sign, or one of the other picture-loading functions.
 */
function valueLoads(decoded: string): boolean {
  if (decoded.indexOf('\\') !== -1) return true;
  const lower = decoded.toLowerCase();
  if (lower.indexOf('@import') !== -1) return true;
  let p = lower.indexOf('(');
  while (p !== -1) {
    let k = p - 1;
    while (k >= 0 && isIdentChar(lower.charCodeAt(k))) k--;
    const name = lower.slice(k + 1, p);
    if (name === 'url') {
      let q = p + 1;
      while (q < lower.length && (isSpace(lower.charCodeAt(q)) || lower.charCodeAt(q) === 12)) q++;
      const quote = lower.charCodeAt(q);
      if (quote === 34 || quote === 39) q++;
      if (lower.charCodeAt(q) !== 35) return true;
    } else if (LOADING_FUNCTIONS.has(name)) {
      return true;
    }
    p = lower.indexOf('(', p + 1);
  }
  return false;
}

interface TagRead {
  /** Index just past the closing angle bracket. */
  end: number;
  name: string;
  selfClosing: boolean;
}

/**
 * Reads one start tag whose angle bracket is at `at`. `onName` sees the element name first, then `onAttribute` sees each
 * attribute (name, raw value, 1-based position of the name) and may throw.
 */
function readStartTag(
  text: string,
  at: number,
  onName: (name: string, position: number) => void,
  onAttribute: (name: string, raw: string, position: number) => void,
): TagRead {
  const n = text.length;
  const tagPosition = at + 1;
  let j = at + 1;
  if (j >= n) throw new SvgGuardError(UNFINISHED, tagPosition);
  const first = text.charCodeAt(j);
  const nameStartOk = (first >= 97 && first <= 122) || (first >= 65 && first <= 90) || first === 95 || first === 58;
  if (!nameStartOk) throw new SvgGuardError(UNREADABLE, tagPosition);
  while (j < n) {
    const c = text.charCodeAt(j);
    if (isSpace(c) || c === 47 || c === 62) break;
    j++;
  }
  const name = text.slice(at + 1, j);
  // The element is judged by its name before anything inside its tag is read.
  onName(name, tagPosition);
  return { name, ...readAttributes(text, j, tagPosition, onAttribute) };
}

function readAttributes(
  text: string,
  start: number,
  tagPosition: number,
  onAttribute: (name: string, raw: string, position: number) => void,
): { end: number; selfClosing: boolean } {
  const n = text.length;
  let j = start;
  for (;;) {
    while (j < n && isSpace(text.charCodeAt(j))) j++;
    if (j >= n) throw new SvgGuardError(UNFINISHED, tagPosition);
    const c = text.charCodeAt(j);
    if (c === 62) return { end: j + 1, selfClosing: false };
    if (c === 47) {
      if (j + 1 >= n) throw new SvgGuardError(UNFINISHED, tagPosition);
      if (text.charCodeAt(j + 1) !== 62) throw new SvgGuardError(UNREADABLE, j + 1);
      return { end: j + 2, selfClosing: true };
    }
    const nameStart = j;
    while (j < n) {
      const d = text.charCodeAt(j);
      if (isSpace(d) || d === 61 || d === 62 || d === 47) break;
      j++;
    }
    const attributeName = text.slice(nameStart, j);
    if (attributeName.length === 0 || attributeName.indexOf('<') !== -1)
      throw new SvgGuardError(UNREADABLE, nameStart + 1);
    while (j < n && isSpace(text.charCodeAt(j))) j++;
    if (j >= n) throw new SvgGuardError(UNFINISHED, tagPosition);
    if (text.charCodeAt(j) !== 61) throw new SvgGuardError(UNREADABLE, nameStart + 1);
    j++;
    while (j < n && isSpace(text.charCodeAt(j))) j++;
    if (j >= n) throw new SvgGuardError(UNFINISHED, tagPosition);
    const quote = text.charCodeAt(j);
    if (quote !== 34 && quote !== 39) throw new SvgGuardError(UNREADABLE, nameStart + 1);
    const close = text.indexOf(quote === 34 ? '"' : "'", j + 1);
    if (close === -1) throw new SvgGuardError(UNFINISHED, tagPosition);
    onAttribute(attributeName, text.slice(j + 1, close), nameStart + 1);
    j = close + 1;
    if (j < n) {
      const after = text.charCodeAt(j);
      if (!isSpace(after) && after !== 47 && after !== 62) throw new SvgGuardError(UNREADABLE, nameStart + 1);
    }
  }
}

function checkElementName(name: string, position: number): void {
  const banned = BANNED_ELEMENTS.get(localName(name));
  if (banned !== undefined) throw new SvgGuardError(banned, position);
}

function checkAttribute(name: string, raw: string, position: number): void {
  const local = localName(name);
  const lowerName = name.toLowerCase();
  const isNamespaceDeclaration = lowerName === 'xmlns' || lowerName.startsWith('xmlns:');
  if (!isNamespaceDeclaration && local.length > 2 && local.startsWith('on')) {
    throw new SvgGuardError('an event handler attribute', position);
  }
  const decoded = decodeReferences(raw);
  if (local === 'href' && decoded.charCodeAt(0) !== 35) {
    throw new SvgGuardError('a link to something outside this SVG', position);
  }
  if (local === 'attributename' && localName(decoded) === 'href') {
    throw new SvgGuardError('an animated link address', position);
  }
  if (valueLoads(decoded)) throw new SvgGuardError(LOADS, position);
}

/**
 * Refuses SVG text that names anything outside itself or could run code. Does
 * nothing for a safe SVG. Throws `SvgGuardError` for the first problem found.
 */
export function scanSvg(text: string): void {
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  // An XML declaration is accepted as the first thing in the text (white space before it is not worth refusing for).
  let declarationAllowed = true;
  let styleStart = -1;
  let styleParts: string[] = [];

  const endStyle = (): void => {
    if (styleStart === -1) return;
    const decoded = decodeReferences(styleParts.join(''));
    const at = styleStart;
    styleStart = -1;
    styleParts = [];
    if (valueLoads(decoded)) throw new SvgGuardError('a style element that loads another file', at);
  };

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      if (styleStart !== -1) styleParts.push(text.slice(i));
      break;
    }
    if (lt > i && styleStart !== -1) styleParts.push(text.slice(i, lt));
    i = lt;
    const position = i + 1;
    const mayDeclare = declarationAllowed;
    declarationAllowed = false;

    if (startsWithAt(text, i, '<!--')) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) throw new SvgGuardError(UNFINISHED, position);
      i = end + 3;
      continue;
    }
    if (startsWithAt(text, i, '<![CDATA[')) {
      const end = text.indexOf(']]>', i + 9);
      if (end === -1) throw new SvgGuardError(UNFINISHED, position);
      if (styleStart !== -1) styleParts.push(text.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (startsWithAt(text, i, '<!')) {
      if (startsWithIgnoreCase(text, i, '<!doctype')) throw new SvgGuardError('a DOCTYPE declaration', position);
      if (startsWithIgnoreCase(text, i, '<!entity')) throw new SvgGuardError('an ENTITY declaration', position);
      throw new SvgGuardError('a markup declaration', position);
    }
    if (startsWithAt(text, i, '<?')) {
      const end = text.indexOf('?>', i + 2);
      if (end === -1) throw new SvgGuardError(UNFINISHED, position);
      let t = i + 2;
      while (t < end && !isSpace(text.charCodeAt(t))) t++;
      const target = text.slice(i + 2, t).toLowerCase();
      if (target === 'xml-stylesheet') throw new SvgGuardError('an xml-stylesheet instruction', position);
      if (!(target === 'xml' && mayDeclare)) throw new SvgGuardError('a processing instruction', position);
      i = end + 2;
      continue;
    }
    if (startsWithAt(text, i, '</')) {
      const end = text.indexOf('>', i + 2);
      if (end === -1) throw new SvgGuardError(UNFINISHED, position);
      let t = i + 2;
      while (t < end && !isSpace(text.charCodeAt(t))) t++;
      if (localName(text.slice(i + 2, t)) === 'style') endStyle();
      i = end + 1;
      continue;
    }

    const tag = readStartTag(text, i, checkElementName, checkAttribute);
    const local = localName(tag.name);
    if (local === 'style' && !tag.selfClosing) {
      styleStart = position;
      styleParts = [];
    }
    i = tag.end;
  }
  endStyle();
}

/** The text of the start tag of the first element, with its attributes decoded; used to size an SVG. */
export function readRootElement(text: string): { name: string; attributes: Map<string, string> } {
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < n && isSpace(text.charCodeAt(i))) i++;
    if (i >= n) throw new SvgGuardError(UNFINISHED, n === 0 ? 1 : n);
    if (startsWithAt(text, i, '<!--')) {
      const end = text.indexOf('-->', i + 4);
      if (end === -1) throw new SvgGuardError(UNFINISHED, i + 1);
      i = end + 3;
    } else if (startsWithAt(text, i, '<?')) {
      const end = text.indexOf('?>', i + 2);
      if (end === -1) throw new SvgGuardError(UNFINISHED, i + 1);
      i = end + 2;
    } else {
      break;
    }
  }
  if (text.charCodeAt(i) !== 60 || startsWithAt(text, i, '<!') || startsWithAt(text, i, '</')) {
    throw new SvgGuardError(UNREADABLE, i + 1);
  }
  const attributes = new Map<string, string>();
  const tag = readStartTag(
    text,
    i,
    () => {},
    (name, raw) => {
      if (!attributes.has(name)) attributes.set(name, decodeReferences(raw));
    },
  );
  return { name: tag.name, attributes };
}

/** After optional white space and leading comments, does this text start an SVG (`<svg` or an XML declaration)? */
function startsLikeSvg(text: string): boolean {
  const n = text.length;
  let i = 0;
  for (;;) {
    while (i < n && isSpace(text.charCodeAt(i))) i++;
    if (!startsWithAt(text, i, '<!--')) break;
    const end = text.indexOf('-->', i + 4);
    if (end === -1) return false;
    i = end + 3;
  }
  if (startsWithAt(text, i, '<?xml')) return i + 5 < n && isSpace(text.charCodeAt(i + 5));
  if (startsWithAt(text, i, '<svg')) {
    if (i + 4 >= n) return false;
    const c = text.charCodeAt(i + 4);
    return isSpace(c) || c === 62 || c === 47;
  }
  return false;
}

/**
 * True when the bytes are valid UTF-8 text (after an optional byte order mark)
 * that starts like an SVG. Anything else, including a picture or a page of
 * another kind, is left to the converter's own refusal.
 */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return startsLikeSvg(text);
}

/** The same start check for the first bytes of a file only (a cut-off character at the end does not matter). */
export function looksLikeSvgStart(head: Uint8Array): boolean {
  return startsLikeSvg(new TextDecoder('utf-8', { fatal: false }).decode(head));
}
