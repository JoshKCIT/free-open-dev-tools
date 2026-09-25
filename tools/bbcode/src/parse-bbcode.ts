/**
 * Parses BBCode into the shared document tree (`tree.ts`), using `@bbob/parser`
 * (the parse layer of the JiLiZART/bbob project) restricted to this
 * package's own supported tag set (`SUPPORTED_TAGS`). No standards body
 * defines BBCode; the tag set and its examples follow phpBB's own community
 * BBCode guide (`https://www.phpbb.com/community/help/bbcode`, fetched
 * 2026-09-25), not a specification.
 *
 * `@bbob/parser`'s own `onlyAllowTags` option means any bracketed text using
 * a tag name outside this list is never turned into a tag node at all -- it
 * comes back as plain text tokens, already literal. A tag inside the
 * allowed set that is never closed also comes back without an `end`
 * position; this module treats that the same way, slicing the ORIGINAL
 * input text at the tag's own start position rather than guessing at a
 * reconstruction, so the literal text is always exact.
 */
import { parse } from '@bbob/parser';
import {
  SUPPORTED_TAGS,
  text,
  element,
  isSafeLinkTarget,
  isSafeImageTarget,
  normaliseColour,
  normaliseSize,
  groupIntoParagraphs,
  type BbNode,
  type BbElement,
  type ListStyle,
} from './tree';

export interface ParseResult {
  tree: BbNode[];
  warnings: string[];
}

interface RawPosition {
  from: number;
  to: number;
}

interface RawTagNode {
  tag: string;
  attrs?: Record<string, unknown>;
  content?: unknown;
  start?: RawPosition;
  end?: RawPosition;
}

type RawContent = string | number | RawTagNode | null | undefined;

function isRawTag(node: unknown): node is RawTagNode {
  return typeof node === 'object' && node !== null && 'tag' in node;
}

function rawContentArray(content: unknown): RawContent[] {
  if (Array.isArray(content)) return content as RawContent[];
  if (content === null || content === undefined) return [];
  return [content as RawContent];
}

/** The tag's shorthand attribute value (`[url=X]` -> `X`), or null when the tag carries none. `@bbob/parser` stores this value as both the key and the value of a single-entry attrs object. */
function shorthandAttrValue(attrs: Record<string, unknown> | undefined): string | null {
  if (!attrs) return null;
  const keys = Object.keys(attrs);
  return keys.length > 0 ? (keys[0] ?? null) : null;
}

/** Every string token in `content`, concatenated with no separator (matching `@bbob/parser`'s own tokenisation, which already keeps whitespace as its own token). Nested tags' own text is included, their markup is not. */
function flattenText(content: RawContent[]): string {
  let out = '';
  for (const node of content) {
    if (typeof node === 'string') out += node;
    else if (typeof node === 'number') out += String(node);
    else if (isRawTag(node)) out += flattenText(rawContentArray(node.content));
  }
  return out;
}

function normaliseListStyle(raw: string | null): ListStyle {
  if (raw === '1' || raw === 'a' || raw === 'A' || raw === 'i' || raw === 'I') return raw;
  return 'unordered';
}

/** Splits a `list` tag's raw content into its `*` items, discarding whitespace before the first marker. */
function splitListItems(content: RawContent[]): RawContent[][] {
  const items: RawContent[][] = [];
  let current: RawContent[] | null = null;
  for (const node of content) {
    if (isRawTag(node) && node.tag.toLowerCase() === '*') {
      current = [];
      items.push(current);
    } else if (current) {
      current.push(node);
    }
  }
  return items;
}

/** Converts one raw `@bbob/parser` tag node into a document-tree element, or (for an unsafe/unclosed/unwrapped case) plain text/children in its place. */
function convertTag(node: RawTagNode, input: string, warnings: string[]): BbNode[] {
  const tagLower = node.tag.toLowerCase();

  if (!node.end) {
    // Never closed: this project's own convention (following the phpBB
    // guide's own warning about mismatched tags) is to keep the bracket
    // text exactly as written, rather than guess at what it meant.
    const from = node.start?.from ?? 0;
    const to = node.start?.to ?? from;
    return [text(input.slice(from, to))];
  }

  const rawChildren = rawContentArray(node.content);
  const shorthand = shorthandAttrValue(node.attrs);

  switch (tagLower) {
    case 'b':
    case 'i':
    case 'u':
    case 's':
      return [element(tagLower, normaliseChildren(rawChildren, input, warnings))];

    case 'url': {
      const href = shorthand ?? flattenText(rawChildren);
      const linkChildren =
        shorthand !== null ? normaliseChildren(rawChildren, input, warnings) : [text(flattenText(rawChildren))];
      if (!isSafeLinkTarget(href)) {
        warnings.push(`A url value "${href}" was not a safe link, so only its text was kept.`);
        return linkChildren;
      }
      return [element('url', linkChildren, { href })];
    }

    case 'img': {
      const src = flattenText(rawChildren);
      if (!isSafeImageTarget(src)) {
        warnings.push(`An img value "${src}" was not a safe image address, so it was dropped.`);
        return [];
      }
      return [element('img', [], { src })];
    }

    case 'quote': {
      const children = normaliseChildren(rawChildren, input, warnings);
      return [element('quote', children, shorthand !== null ? { cite: shorthand } : undefined)];
    }

    case 'code': {
      // contextFreeTags (see parseBbcode below) keeps this tag's own content
      // as raw text tokens even when it looks like nested BBCode; flattening
      // them back together reproduces the original text exactly, since
      // @bbob/parser's own tokeniser already keeps whitespace as its own token.
      const codeText = flattenText(rawChildren);
      return [element('code', [text(codeText)], shorthand !== null ? { lang: shorthand } : undefined)];
    }

    case 'list': {
      const style = normaliseListStyle(shorthand);
      const items = splitListItems(rawChildren).map((itemContent) =>
        element('item', normaliseChildren(itemContent, input, warnings)),
      );
      return [element('list', items, { style })];
    }

    case 'color': {
      const children = normaliseChildren(rawChildren, input, warnings);
      const value = shorthand !== null ? normaliseColour(shorthand) : null;
      if (value === null) {
        warnings.push(`A color value "${shorthand ?? ''}" was not a safe colour, so it was dropped.`);
        return children;
      }
      return [element('color', children, { value })];
    }

    case 'size': {
      const children = normaliseChildren(rawChildren, input, warnings);
      const value = shorthand !== null ? normaliseSize(shorthand) : null;
      if (value === null) {
        warnings.push(`A size value "${shorthand ?? ''}" was not a supported size, so it was dropped.`);
        return children;
      }
      return [element('size', children, { value })];
    }

    case 'center':
    case 'left':
    case 'right':
      return [element('align', normaliseChildren(rawChildren, input, warnings), { value: tagLower })];

    default:
      // Reached only if SUPPORTED_TAGS and this switch ever drift apart;
      // treated the same as an unsupported tag would have been.
      return [text(input.slice(node.start?.from ?? 0, node.end?.to ?? node.start?.to ?? 0))];
  }
}

/** Converts a raw content array (mixed strings and tag nodes) into document-tree nodes, merging adjacent text runs. */
function normaliseChildren(content: RawContent[], input: string, warnings: string[]): BbNode[] {
  const out: BbNode[] = [];
  for (const node of content) {
    if (typeof node === 'string') {
      const last = out[out.length - 1];
      if (last && last.type === 'text') last.value += node;
      else out.push(text(node));
    } else if (typeof node === 'number') {
      const asText = String(node);
      const last = out[out.length - 1];
      if (last && last.type === 'text') last.value += asText;
      else out.push(text(asText));
    } else if (isRawTag(node)) {
      for (const converted of convertTag(node, input, warnings)) {
        const last = out[out.length - 1];
        if (last && last.type === 'text' && converted.type === 'text') last.value += converted.value;
        else out.push(converted);
      }
    }
  }
  return out;
}

/** Parses `input` as BBCode, restricted to `SUPPORTED_TAGS`, into the shared document tree. */
export function parseBbcode(input: string): ParseResult {
  const warnings: string[] = [];
  const raw = parse(input, {
    onlyAllowTags: [...SUPPORTED_TAGS],
    contextFreeTags: ['code'],
  }) as unknown as RawContent[];
  const tree = groupIntoParagraphs(normaliseChildren(raw, input, warnings));
  return { tree, warnings };
}

export type { BbElement };
