/**
 * The shared document tree every parser in this package produces and every
 * emitter reads. BBCode, Markdown and HTML each parse to this same shape, so
 * a conversion between any two of the three formats is really two
 * independent, already-tested steps: parse to `BbNode[]`, then emit from it.
 *
 * No standards body defines BBCode; `SUPPORTED_TAGS` is this package's own
 * choice, following phpBB's own documented default tag set (see
 * `parse-bbcode.ts`'s header comment for the source).
 */

/** A BBCode source tag name this package understands. `*` is a list item marker, never written with a closing tag. */
export const SUPPORTED_TAGS = [
  'b',
  'i',
  'u',
  's',
  'url',
  'img',
  'quote',
  'code',
  'list',
  '*',
  'color',
  'size',
  'center',
  'left',
  'right',
] as const;

export type SupportedTag = (typeof SUPPORTED_TAGS)[number];

/** The document tree's own node kinds. `align` covers center/left/right (their only difference is the `align` attribute's value); `item` covers `*`. */
export type BbTag =
  | 'b'
  | 'i'
  | 'u'
  | 's'
  | 'url'
  | 'img'
  | 'quote'
  | 'code'
  | 'list'
  | 'item'
  | 'color'
  | 'size'
  | 'align'
  | 'br'
  | 'paragraph';

export type ListStyle = 'unordered' | '1' | 'a' | 'A' | 'i' | 'I';

export type Align = 'center' | 'left' | 'right';

/** A run of plain text. Never carries markup; every emitter is responsible for escaping it for its own target format. */
export interface BbText {
  type: 'text';
  value: string;
}

/**
 * A tag node. `attrs` holds only the keys meaningful for `tag`:
 * - `url`: `href` (the link target, already validated)
 * - `img`: `src` (the image target, already validated)
 * - `quote`: `cite` (optional author name)
 * - `code`: `lang` (optional language name)
 * - `list`: `style` (a `ListStyle`)
 * - `color`: `value` (a validated CSS named colour or `#`-hex value)
 * - `size`: `value` (a validated integer, 1-7 relative or 50-300 percent)
 * - `align`: `value` (an `Align`)
 */
export interface BbElement {
  type: 'element';
  tag: BbTag;
  attrs?: Record<string, string>;
  children: BbNode[];
}

export type BbNode = BbText | BbElement;

/** Block-level tags. A paragraph group holding exactly one of these is not itself wrapped in a paragraph (avoids nesting a block inside inline flow). */
export const BLOCK_TAGS = new Set<BbTag>(['quote', 'code', 'list']);

export function text(value: string): BbText {
  return { type: 'text', value };
}

export function element(tag: BbTag, children: BbNode[], attrs?: Record<string, string>): BbElement {
  return attrs ? { type: 'element', tag, attrs, children } : { type: 'element', tag, children };
}

type Token = BbNode | { type: 'break' };

/** Splits one text run's line breaks into text/br/paragraph-break tokens. A blank line (two or more newlines, blank lines in between allowed to hold only spaces or tabs) is a paragraph break; a single newline is a line break. */
function splitTextBreaks(value: string): Token[] {
  const out: Token[] = [];
  const re = /\n[ \t]*\n+|\n/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    if (match.index > last) out.push(text(value.slice(last, match.index)));
    out.push(match[0].length > 1 ? { type: 'break' } : element('br', []));
    last = match.index + match[0].length;
  }
  if (last < value.length) out.push(text(value.slice(last)));
  return out;
}

/**
 * Groups top-level document content into paragraphs at blank-line
 * boundaries, and turns a single newline into a `br` element. Zero or one
 * resulting paragraph is returned unwrapped (no visible difference from the
 * flat content); two or more are each wrapped in a `paragraph` element,
 * except a paragraph holding exactly one block-level element (`quote`,
 * `code`, `list`), which is returned as that element alone rather than
 * nested inside a paragraph.
 */
export function groupIntoParagraphs(nodes: BbNode[]): BbNode[] {
  const tokens: Token[] = [];
  for (const node of nodes) {
    if (node.type === 'text') tokens.push(...splitTextBreaks(node.value));
    else tokens.push(node);
  }

  const groups: BbNode[][] = [[]];
  for (const token of tokens) {
    if ('type' in token && token.type === 'break') {
      groups.push([]);
    } else {
      groups[groups.length - 1]!.push(token as BbNode);
    }
  }

  const nonEmpty = groups.filter((g) => g.length > 0);
  if (nonEmpty.length <= 1) return nonEmpty[0] ?? [];

  return nonEmpty.map((group) => {
    if (group.length === 1) {
      const only = group[0]!;
      if (only.type === 'element' && BLOCK_TAGS.has(only.tag)) return only;
    }
    return element('paragraph', group);
  });
}

/**
 * The same url/img/colour/size validation rules every parser in this
 * package applies (BBCode, Markdown and HTML), so a hostile value is
 * refused identically no matter which format it arrived in. These rules run
 * BEFORE anything reaches `emit-html.ts`; the canonical `sanitise.ts` runs
 * again, independently, after emitting, and is stricter about which
 * references may load (see its own header comment) -- this module only
 * keeps out schemes that can never be a legitimate link or image target.
 */

/** Removes ASCII whitespace and C0/C1 control characters, the way a browser does before reading a URL scheme. */
function stripWhitespaceAndControls(value: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching control characters, not a typo.
  return value.replace(/[\x00-\x20\x7f-\x9f]+/g, '');
}

function schemeOf(cleaned: string): string | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  return match ? `${(match[1] ?? '').toLowerCase()}:` : null;
}

const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const IMAGE_SCHEMES = new Set(['http:', 'https:']);
const ALLOWED_DATA_IMAGE_TYPES = ['png', 'gif', 'jpeg', 'webp'];

function isAllowedDataImage(cleaned: string): boolean {
  const lower = cleaned.toLowerCase();
  if (!lower.startsWith('data:image/')) return false;
  const afterType = lower.slice('data:image/'.length);
  const type = afterType.split(/[;,]/, 1)[0] ?? '';
  return ALLOWED_DATA_IMAGE_TYPES.includes(type) && lower.includes(';base64,');
}

/** True for a link target this package keeps: http, https, mailto, a relative reference, or a same-document fragment. */
export function isSafeLinkTarget(rawValue: string): boolean {
  const cleaned = stripWhitespaceAndControls(rawValue.trim());
  if (cleaned === '') return false;
  if (cleaned.startsWith('#')) return true;
  const scheme = schemeOf(cleaned);
  if (scheme === null) return true; // No scheme: a relative reference.
  return LINK_SCHEMES.has(scheme);
}

/** True for an image target this package keeps: http, https, a relative reference, a same-document fragment, or a small base64 data:image/{png,gif,jpeg,webp}. */
export function isSafeImageTarget(rawValue: string): boolean {
  const cleaned = stripWhitespaceAndControls(rawValue.trim());
  if (cleaned === '') return false;
  if (cleaned.startsWith('#')) return true;
  if (isAllowedDataImage(cleaned)) return true;
  const scheme = schemeOf(cleaned);
  if (scheme === null) return true; // No scheme: a relative reference.
  return IMAGE_SCHEMES.has(scheme);
}

/**
 * CSS Color Module Level 3's named colour keywords plus `transparent`,
 * lower-case. Fetched from the W3C CSS Color Module Level 3 recommendation's
 * own "Extended color keywords" table (`https://www.w3.org/TR/css-color-3/#svg-color`),
 * not written from memory.
 */
const CSS_NAMED_COLOURS = new Set([
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'grey',
  'green',
  'greenyellow',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
  'transparent',
]);

/** Returns the validated, lower-cased colour value, or null when it is neither a known CSS name nor a well-formed `#`-hex value. */
export function normaliseColour(rawValue: string): string | null {
  const cleaned = rawValue.trim().toLowerCase();
  if (CSS_NAMED_COLOURS.has(cleaned)) return cleaned;
  if (/^#[0-9a-f]{3,4}$/.test(cleaned) || /^#[0-9a-f]{6}$/.test(cleaned) || /^#[0-9a-f]{8}$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

/**
 * Returns the validated size value as a string, or null. An integer 1-7 is
 * kept as-is (HTML's own relative font-size scale); an integer 50-300 is
 * kept with a trailing `%` (phpBB's own documented percent scale).
 */
export function normaliseSize(rawValue: string): string | null {
  const cleaned = rawValue.trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (n >= 1 && n <= 7) return String(n);
  if (n >= 50 && n <= 300) return `${n}%`;
  return null;
}
