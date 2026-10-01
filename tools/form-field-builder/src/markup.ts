/**
 * An element tree, the HTML context-escaping rules, the HTML fragment
 * serializer rules this folder follows, and an inert preview pass.
 *
 * - WHATWG HTML 13.3 (serializing HTML fragments): text escapes `&`, `<` and
 *   `>`; an attribute value written in double quotes also escapes `"`. This
 *   file escapes exactly those characters, in that order, and nothing else.
 * - WHATWG HTML 13.2.5 (tokenization): a line feed straight after a `textarea`
 *   or `pre` start tag is dropped by the parser, so the serializer writes one
 *   extra line feed there when the text itself starts with a line break.
 * - A tree is built once with `el()` and written twice: `serialize(tree)` is the
 *   copyable markup and `serialize(inert(tree))` is the preview, in which every
 *   address-bearing attribute is replaced by a data placeholder or removed.
 *
 * Pure functions only: no DOM, no clock, no network, no storage.
 */

export type AttrValue = string | true;

export interface El {
  tag: string;
  attrs: [string, AttrValue][];
  children: Child[];
}

export type Child = El | string;

export class MarkupError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'MarkupError';
    this.field = field;
  }
}

/** Elements that have no end tag and no children (WHATWG 13.1.2). */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Attributes that carry an address; a preview never keeps one except a data placeholder. */
export const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'src',
  'srcset',
  'poster',
  'href',
  'action',
  'formaction',
  'data',
  'cite',
  'ping',
  'background',
  'manifest',
]);

/** Elements this builder never writes: they run, load or restyle content. */
const REFUSED_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'base',
  'link',
  'meta',
  'frame',
  'frameset',
  'template',
  'noscript',
]);

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

type AttrInput = [string, AttrValue | false | null | undefined];
type ChildInput = Child | false | null | undefined;

/**
 * Builds one element. Attributes whose value is undefined, null or false and
 * children that are undefined, null or false are dropped. Refuses names that are
 * not lowercase ASCII letters, digits and hyphens starting with a letter, any
 * attribute name starting with `on`, a repeated attribute name, children on a
 * void element, and the elements in REFUSED_TAGS.
 */
export function el(tag: string, attrs: AttrInput[] = [], children: ChildInput[] = []): El {
  if (!NAME_PATTERN.test(tag)) throw new MarkupError('Markup', `"${tag}" is not a valid element name`);
  if (REFUSED_TAGS.has(tag))
    throw new MarkupError('Markup', `the ${tag} element is never written, because it runs or loads content`);
  const kept: [string, AttrValue][] = [];
  const seen = new Set<string>();
  for (const [name, value] of attrs) {
    if (value === undefined || value === null || value === false) continue;
    if (!NAME_PATTERN.test(name)) throw new MarkupError('Markup', `"${name}" is not a valid attribute name`);
    if (name.startsWith('on'))
      throw new MarkupError('Markup', `the ${name} attribute is an event handler and is never written`);
    if (seen.has(name))
      throw new MarkupError('Markup', `the ${name} attribute would be written twice on one ${tag} element`);
    seen.add(name);
    kept.push([name, value]);
  }
  const kids = children.filter((c): c is Child => c !== undefined && c !== null && c !== false);
  if (VOID_ELEMENTS.has(tag) && kids.length > 0) {
    throw new MarkupError('Markup', `the ${tag} element is empty and cannot have children`);
  }
  return { tag, attrs: kept, children: kids };
}

function startTag(node: El): string {
  const attrs = node.attrs.map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`));
  return `<${node.tag}${attrs.join('')}>`;
}

function isInline(node: El): boolean {
  return (
    VOID_ELEMENTS.has(node.tag) ||
    node.tag === 'textarea' ||
    node.tag === 'pre' ||
    node.children.length === 0 ||
    node.children.some((c) => typeof c === 'string')
  );
}

function inline(node: El): string {
  const open = startTag(node);
  if (VOID_ELEMENTS.has(node.tag)) return open;
  let body = node.children.map((c) => (typeof c === 'string' ? escapeText(c) : inline(c))).join('');
  const first = node.children[0];
  if ((node.tag === 'textarea' || node.tag === 'pre') && typeof first === 'string' && /^[\r\n]/.test(first)) {
    body = '\n' + body;
  }
  return `${open}${body}</${node.tag}>`;
}

function render(node: Child, pad: string): string {
  if (typeof node === 'string') return pad + escapeText(node);
  if (isInline(node)) return pad + inline(node);
  const kids = node.children.map((c) => render(c, pad + '  '));
  return `${pad}${startTag(node)}\n${kids.join('\n')}\n${pad}</${node.tag}>`;
}

/**
 * Writes a tree as HTML. Fixed layout so tests and fixtures can rely on it:
 * attributes in the order given, always in double quotes, a boolean attribute
 * bare, a void element with no end tag and no trailing slash, each top-level node
 * on its own line, an element whose children are all elements with each child on
 * its own line two spaces deeper, and an element with any text child on one line.
 */
export function serialize(nodes: Child | Child[]): string {
  const list = Array.isArray(nodes) ? nodes : [nodes];
  return list.map((n) => render(n, '')).join('\n');
}

function clampDimension(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^[0-9]+$/.test(value)) return fallback;
  return Math.min(4000, Math.max(1, Number(value)));
}

/** A grey rectangle as a data address, so a preview image loads nothing. */
export function placeholderImage(width = 300, height = 150): string {
  const w = Math.min(4000, Math.max(1, Math.round(width)));
  const h = Math.min(4000, Math.max(1, Math.round(height)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ddd"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function attrValue(node: El, name: string): string | undefined {
  const found = node.attrs.find(([n]) => n.toLowerCase() === name);
  return found && found[1] !== true ? found[1] : undefined;
}

function inertElement(node: El): El {
  const tag = node.tag.toLowerCase();
  const isImageInput = tag === 'input' && (attrValue(node, 'type') ?? '').toLowerCase() === 'image';
  const wantsPlaceholder = tag === 'img' || isImageInput;
  const placeholder = wantsPlaceholder
    ? placeholderImage(clampDimension(attrValue(node, 'width'), 300), clampDimension(attrValue(node, 'height'), 150))
    : '';
  const attrs: [string, AttrValue][] = [];
  let placed = false;
  for (const [name, value] of node.attrs) {
    const lower = name.toLowerCase();
    if (lower === 'src' && wantsPlaceholder) {
      attrs.push([name, placeholder]);
      placed = true;
    } else if (!URL_ATTRIBUTES.has(lower)) {
      attrs.push([name, value]);
    }
  }
  if (wantsPlaceholder && !placed) attrs.push(['src', placeholder]);
  return { tag: node.tag, attrs, children: node.children.map(inertChild) };
}

function inertChild(node: Child): Child {
  return typeof node === 'string' ? node : inertElement(node);
}

/**
 * Returns a new tree for the preview: `img` and `input type=image` get a data
 * placeholder for `src` (sized from their own width and height) and lose
 * `srcset`; `a` and `area` lose `href` and `ping`; `form` loses `action`;
 * `button` and `input` lose `formaction`; any other attribute in URL_ATTRIBUTES
 * is removed. The input tree is never changed.
 */
export function inert(nodes: Child | Child[]): Child[] {
  const list = Array.isArray(nodes) ? nodes : [nodes];
  return list.map(inertChild);
}

/** Lone surrogates, controls, noncharacters: the code points HTML cannot carry as text. */
function describeRefused(cp: number, multiline: boolean): string | null {
  if (cp === 0x0a || cp === 0x0d) return multiline ? null : 'a line break (this field holds one line)';
  if (cp === 0x09) return null;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return 'a control character';
  if (cp >= 0xd800 && cp <= 0xdfff) return 'a lone surrogate';
  if ((cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe) return 'a noncharacter';
  return null;
}

/**
 * Refuses text HTML cannot carry: NUL and the other C0 and C1 controls except a
 * tab (and line feed and carriage return when `multiline`), U+007F,
 * noncharacters and lone surrogates, naming the field and the code point. Also
 * refuses text longer than `max` UTF-16 code units (default 20,000).
 */
export function assertSafeText(value: string, field: string, opts: { multiline?: boolean; max?: number } = {}): void {
  const max = opts.max ?? 20000;
  if (value.length > max) {
    throw new MarkupError(field, `longer than ${max.toLocaleString('en-US')} characters, so it is refused`);
  }
  for (const ch of value) {
    const cp = ch.codePointAt(0) as number;
    const what = describeRefused(cp, opts.multiline === true);
    if (what) {
      const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
      throw new MarkupError(field, `contains ${what} (${hex}), which HTML cannot carry as text; remove it`);
    }
  }
}
