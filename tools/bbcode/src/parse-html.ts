/**
 * Parses HTML into the shared document tree (`tree.ts`), using
 * `htmlparser2`'s `parseDocument` -- a tokeniser that builds a plain object
 * tree with no DOM and no `document`, so nothing in the input ever runs or
 * loads while parsing it. `script`, `style`, `noscript`, `template`,
 * `iframe`, `object` and `embed` are dropped along with their own content;
 * every other unrecognised element keeps its children (unwrapped) and is
 * named once in a warning.
 */
import { parseDocument } from 'htmlparser2';
import {
  text,
  element,
  isSafeLinkTarget,
  isSafeImageTarget,
  normaliseColour,
  normaliseSize,
  type BbNode,
} from './tree';

export interface ParseResult {
  tree: BbNode[];
  warnings: string[];
}

interface HtmlNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
}

/** Elements dropped along with everything inside them. */
const DROPPED_WITH_CONTENT = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed']);

const HEADING_RE = /^h[1-6]$/;

function styleDeclarations(styleAttr: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const decl of styleAttr.split(';')) {
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (prop) map.set(prop, value);
  }
  return map;
}

function textAlignValue(styleAttr: string | undefined): 'center' | 'left' | 'right' | null {
  if (!styleAttr) return null;
  const value = styleDeclarations(styleAttr).get('text-align');
  if (value === 'center' || value === 'left' || value === 'right') return value;
  return null;
}

/** CSS's own relative font-size keyword scale, the inverse of `emit-html.ts`'s own `RELATIVE_SIZE_CSS`, so a size this package itself emitted reads back as the same value. */
const RELATIVE_SIZE_KEYWORDS: Record<string, string> = {
  'xx-small': '1',
  'x-small': '2',
  small: '3',
  medium: '4',
  large: '5',
  'x-large': '6',
  'xx-large': '7',
};

/** A CSS `font-size` value this tag set can represent: a percent in its own 50-300% range, or one of the relative-size keywords. Returns the validated `size` value (an integer 1-7 or a percent), or null. */
function fontSizeValue(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const percentMatch = /^(\d+)%$/.exec(trimmed);
  if (percentMatch) return normaliseSize(percentMatch[1] ?? '');
  const keyword = RELATIVE_SIZE_KEYWORDS[trimmed];
  return keyword ? normaliseSize(keyword) : null;
}

function flattenPlainText(nodes: BbNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += node.value;
    else out += flattenPlainText(node.children);
  }
  return out;
}

function convertNodes(nodes: HtmlNode[], warnings: Set<string>): BbNode[] {
  const out: BbNode[] = [];
  for (const node of nodes) out.push(...convertNode(node, warnings));
  return out;
}

function convertNode(node: HtmlNode, warnings: Set<string>): BbNode[] {
  if (node.type === 'text') return [text(node.data ?? '')];
  if (node.type === 'comment') return [];
  if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return [];

  const name = (node.name ?? '').toLowerCase();
  const attribs = node.attribs ?? {};
  const children = node.children ?? [];

  if (DROPPED_WITH_CONTENT.has(name)) {
    warnings.add('Script, style and other embedded content was dropped.');
    return [];
  }

  switch (name) {
    case 'b':
    case 'strong':
      return [element('b', convertNodes(children, warnings))];
    case 'i':
    case 'em':
      return [element('i', convertNodes(children, warnings))];
    case 'u':
    case 'ins':
      return [element('u', convertNodes(children, warnings))];
    case 's':
    case 'del':
    case 'strike':
      return [element('s', convertNodes(children, warnings))];
    case 'a': {
      const href = attribs.href ?? '';
      if (!isSafeLinkTarget(href)) {
        warnings.add('A link to an unsafe address was replaced with only its text.');
        return convertNodes(children, warnings);
      }
      return [element('url', convertNodes(children, warnings), { href })];
    }
    case 'img': {
      const src = attribs.src ?? '';
      if (!isSafeImageTarget(src)) {
        warnings.add('An image at an unsafe address was dropped.');
        return [];
      }
      return [element('img', [], { src })];
    }
    case 'blockquote':
      return [element('quote', convertNodes(children, warnings))];
    case 'pre': {
      const codeChild = children.find((c) => (c.name ?? '').toLowerCase() === 'code');
      const codeText = flattenPlainText(convertNodes(codeChild ? (codeChild.children ?? []) : children, warnings));
      const cls = codeChild?.attribs?.class ?? '';
      const langMatch = /language-(\S+)/.exec(cls);
      return [element('code', [text(codeText)], langMatch ? { lang: langMatch[1] ?? '' } : undefined)];
    }
    case 'code':
      // A bare <code> outside <pre> is still treated as this tag set's one
      // code representation (BBCode has no separate inline-code form).
      return [element('code', [text(flattenPlainText(convertNodes(children, warnings)))])];
    case 'ul':
    case 'ol': {
      const items = children
        .filter((c) => (c.name ?? '').toLowerCase() === 'li')
        .map((li) => element('item', convertNodes(li.children ?? [], warnings)));
      return [element('list', items, { style: name === 'ol' ? '1' : 'unordered' })];
    }
    case 'br':
      return [element('br', [])];
    case 'p': {
      const align = textAlignValue(attribs.style);
      const inner = convertNodes(children, warnings);
      return [element('paragraph', align ? [element('align', inner, { value: align })] : inner)];
    }
    case 'div': {
      const align = textAlignValue(attribs.style);
      const inner = convertNodes(children, warnings);
      return align ? [element('align', inner, { value: align })] : inner;
    }
    case 'center':
      return [element('align', convertNodes(children, warnings), { value: 'center' })];
    case 'span':
    case 'font': {
      const styleMap = attribs.style ? styleDeclarations(attribs.style) : new Map<string, string>();
      const colourRaw = attribs.color ?? styleMap.get('color');
      const sizeRaw = attribs.size ?? fontSizeValue(styleMap.get('font-size'));
      let inner = convertNodes(children, warnings);
      if (colourRaw) {
        const value = normaliseColour(colourRaw);
        if (value) inner = [element('color', inner, { value })];
      }
      if (sizeRaw) {
        const value = attribs.size ? normaliseSize(attribs.size) : sizeRaw;
        if (value) inner = [element('size', inner, { value })];
      }
      return inner;
    }
    default: {
      if (HEADING_RE.test(name)) {
        warnings.add('A heading has no BBCode form; it was converted to bold text.');
        return [element('paragraph', [element('b', convertNodes(children, warnings))])];
      }
      warnings.add(`An unrecognised element ("<${name}>") kept its content, without its own formatting.`);
      return convertNodes(children, warnings);
    }
  }
}

/** Parses `input` as HTML into the shared document tree. Never builds a DOM; nothing in the input runs or loads. */
export function parseHtml(input: string): ParseResult {
  const warnings = new Set<string>();
  const doc = parseDocument(input) as unknown as { children: HtmlNode[] };
  const tree = convertNodes(doc.children ?? [], warnings);
  return { tree, warnings: [...warnings] };
}
