/**
 * The small XML pieces the reader and the writer share.
 *
 * Reading uses a purpose-built scanner, not a general XML parser: a worksheet can hold millions of cells, and a
 * general parser needed seven times the time and four times the memory on a measured 100,000 row sheet. The scanner
 * walks tags in order and hands out text, and it reads no DOCTYPE, no entity declaration and no external reference, so
 * nothing a file names is ever loaded. Writing uses `escapeText` and `escapeAttribute`, so no cell text or sheet name
 * can become markup.
 */

const ENTITY = /&(#x[0-9A-Fa-f]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
const X_ESCAPE = /_x([0-9A-Fa-f]{4})_/g;

function entityText(entity: string): string {
  switch (entity) {
    case 'amp':
      return '&';
    case 'lt':
      return '<';
    case 'gt':
      return '>';
    case 'quot':
      return '"';
    case 'apos':
      return "'";
  }
  const code = entity.charCodeAt(1) === 120 ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
  return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�';
}

/** Decodes the five predefined entities and numeric character references; anything else stays as written. */
export function decodeEntities(text: string): string {
  return text.indexOf('&') < 0 ? text : text.replace(ENTITY, (_, entity: string) => entityText(entity));
}

/**
 * ECMA-376 18.18.94 ST_Xstring: `_xHHHH_` stands for the UTF-16 unit HHHH, which is how a spreadsheet stores a control
 * character that XML 1.0 cannot carry. `_x005F_` is a literal underscore, so a text that really holds `_x0041_` is
 * stored as `_x005F_x0041_` and reads back unchanged.
 */
export function decodeXEscapes(text: string): string {
  return text.indexOf('_x') < 0
    ? text
    : text.replace(X_ESCAPE, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Text content as a spreadsheet means it: entities decoded, line ends normalised as XML 1.0 says, `_xHHHH_` decoded. */
export function decodeText(raw: string): string {
  let text = decodeEntities(raw);
  if (text.indexOf('\r') >= 0) text = text.replace(/\r\n?/g, '\n');
  return decodeXEscapes(text);
}

/** An attribute value: entities decoded (no `_xHHHH_` step: attributes never carry that escape). */
export function decodeAttribute(raw: string): string {
  return decodeEntities(raw);
}

/** Characters XML 1.0 cannot carry: most controls, the two non-characters, and a surrogate with no partner. */
// eslint-disable-next-line no-control-regex
const NOT_XML = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/g;
const X_LOOKALIKE = /_(?=x[0-9A-Fa-f]{4}_)/g;

function hex4(unit: number): string {
  return unit.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Replaces each character XML 1.0 cannot carry (most controls, the two non-characters, a surrogate with no partner)
 * by `_xHHHH_`, and leaves everything else, a valid surrogate pair included, alone.
 */
export function escapeNonXml(text: string): string {
  return text.replace(NOT_XML, (match) => (match.length === 2 ? match : `_x${hex4(match.charCodeAt(0))}_`));
}

/**
 * Cell text for the writer: a character XML cannot carry becomes `_xHHHH_`, a carriage return does too (a raw one is
 * turned into a line feed by every XML reader), and an underscore that starts something that looks like an escape
 * becomes `_x005F_`, so the text reads back exactly.
 */
export function escapeCellText(text: string): string {
  let out = text;
  if (out.indexOf('_x') >= 0) out = out.replace(X_LOOKALIKE, '_x005F_');
  out = escapeNonXml(out);
  if (out.indexOf('\r') >= 0) out = out.replace(/\r/g, '_x000D_');
  return out;
}

/** Escapes text for element content; a carriage return becomes a character reference so no reader turns it into a line feed. */
export function escapeText(text: string): string {
  return text.replace(/[&<>\r]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&#13;'));
}

/** Escapes text for a double-quoted attribute value, including a line break or tab that would otherwise be lost. */
export function escapeAttribute(text: string): string {
  return text.replace(/[&<>"\t\n\r]/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return `&#${ch.charCodeAt(0)};`;
    }
  });
}

const CODE_LT = 60;
const CODE_GT = 62;
const CODE_SLASH = 47;
const CODE_BANG = 33;
const CODE_QUESTION = 63;
const CODE_QUOTE = 34;
const CODE_APOS = 39;
const CODE_EQUALS = 61;

function isSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/** The local part of a possibly prefixed name (`x:row` is `row`). */
function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/**
 * Walks the tags of an XML text in order. After `next()` returns true, `name` is the local name of the tag (any prefix
 * removed), `closing` says it is an end tag, `selfClosing` that it ends with `/>`, and `attr(name)` reads its
 * attributes. Comments, processing instructions, CDATA sections between tags and a DOCTYPE are skipped, never read.
 */
export class XmlScanner {
  readonly xml: string;
  pos = 0;
  name = '';
  closing = false;
  selfClosing = false;
  private attrFrom = 0;
  private attrTo = 0;

  constructor(xml: string) {
    this.xml = xml;
  }

  next(): boolean {
    const xml = this.xml;
    for (;;) {
      const lt = xml.indexOf('<', this.pos);
      if (lt < 0) {
        this.pos = xml.length;
        return false;
      }
      const second = xml.charCodeAt(lt + 1);
      if (second === CODE_BANG) {
        if (xml.startsWith('<!--', lt)) {
          const end = xml.indexOf('-->', lt + 4);
          this.pos = end < 0 ? xml.length : end + 3;
        } else if (xml.startsWith('<![CDATA[', lt)) {
          const end = xml.indexOf(']]>', lt + 9);
          this.pos = end < 0 ? xml.length : end + 3;
        } else {
          // A DOCTYPE or another declaration: skipped to its closing bracket, never interpreted.
          const end = xml.indexOf('>', lt + 2);
          this.pos = end < 0 ? xml.length : end + 1;
        }
        continue;
      }
      if (second === CODE_QUESTION) {
        const end = xml.indexOf('?>', lt + 2);
        this.pos = end < 0 ? xml.length : end + 2;
        continue;
      }

      let gt = xml.indexOf('>', lt + 1);
      if (gt < 0) {
        this.pos = xml.length;
        return false;
      }
      // A quoted attribute value may hold a '>': when the tag has quotes, find its true end by honouring them.
      for (let k = lt + 1; k < gt; k++) {
        const code = xml.charCodeAt(k);
        if (code === CODE_QUOTE || code === CODE_APOS) {
          gt = this.endOfQuotedTag(lt + 1);
          break;
        }
      }
      if (gt < 0) {
        this.pos = xml.length;
        return false;
      }

      let i = lt + 1;
      this.closing = second === CODE_SLASH;
      if (this.closing) i++;
      const nameFrom = i;
      while (i < gt) {
        const code = xml.charCodeAt(i);
        if (isSpace(code) || code === CODE_SLASH) break;
        i++;
      }
      this.name = localName(xml.slice(nameFrom, i));
      this.selfClosing = !this.closing && xml.charCodeAt(gt - 1) === CODE_SLASH;
      this.attrFrom = i;
      this.attrTo = this.selfClosing ? gt - 1 : gt;
      this.pos = gt + 1;
      return true;
    }
  }

  /** The index of the '>' that ends a tag whose attributes hold quotes, or -1. */
  private endOfQuotedTag(from: number): number {
    const xml = this.xml;
    let quote = 0;
    for (let i = from; i < xml.length; i++) {
      const code = xml.charCodeAt(i);
      if (quote !== 0) {
        if (code === quote) quote = 0;
      } else if (code === CODE_QUOTE || code === CODE_APOS) quote = code;
      else if (code === CODE_GT) return i;
      else if (code === CODE_LT) return -1;
    }
    return -1;
  }

  /**
   * The value of an attribute of the current tag, or undefined. `name` matches the whole attribute name, except that a
   * `prefixed` lookup matches `anything:name` (the relationship id attribute is written `r:id`, with any prefix).
   */
  attr(name: string, prefixed = false): string | undefined {
    const xml = this.xml;
    let i = this.attrFrom;
    const to = this.attrTo;
    while (i < to) {
      while (i < to && isSpace(xml.charCodeAt(i))) i++;
      const nameFrom = i;
      while (i < to && xml.charCodeAt(i) !== CODE_EQUALS && !isSpace(xml.charCodeAt(i))) i++;
      const attrName = xml.slice(nameFrom, i);
      while (i < to && isSpace(xml.charCodeAt(i))) i++;
      if (xml.charCodeAt(i) !== CODE_EQUALS) return undefined;
      i++;
      while (i < to && isSpace(xml.charCodeAt(i))) i++;
      const quote = xml.charCodeAt(i);
      if (quote !== CODE_QUOTE && quote !== CODE_APOS) return undefined;
      const end = xml.indexOf(quote === CODE_QUOTE ? '"' : "'", i + 1);
      if (end < 0 || end > to) return undefined;
      const matches = prefixed ? attrName.endsWith(':' + name) : attrName === name;
      if (matches) return decodeAttribute(xml.slice(i + 1, end));
      i = end + 1;
    }
    return undefined;
  }

  /**
   * The text of the element whose start tag `next()` just returned, decoded, with the end tag consumed. Elements read
   * this way (`v`, `t`, `numFmt` text) hold only text, so the first tag after the text ends it.
   */
  readText(): string {
    if (this.selfClosing) return '';
    const xml = this.xml;
    let out = '';
    let from = this.pos;
    for (;;) {
      const lt = xml.indexOf('<', from);
      if (lt < 0) {
        out += decodeText(xml.slice(from));
        this.pos = xml.length;
        return out;
      }
      out += decodeText(xml.slice(from, lt));
      if (xml.startsWith('<![CDATA[', lt)) {
        const end = xml.indexOf(']]>', lt + 9);
        out += xml.slice(lt + 9, end < 0 ? xml.length : end);
        from = end < 0 ? xml.length : end + 3;
        continue;
      }
      const gt = xml.indexOf('>', lt);
      this.pos = gt < 0 ? xml.length : gt + 1;
      return out;
    }
  }

  /** Skips to just past the end tag that matches the start tag `next()` just returned (nested tags of the same name counted). */
  skipElement(): void {
    if (this.selfClosing || this.closing) return;
    const target = this.name;
    let depth = 1;
    while (depth > 0 && this.next()) {
      if (this.name !== target) continue;
      if (this.closing) depth--;
      else if (!this.selfClosing) depth++;
    }
  }
}
