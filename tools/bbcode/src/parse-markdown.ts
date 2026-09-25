/**
 * Parses Markdown into the shared document tree (`tree.ts`), using
 * `mdast-util-from-markdown` with `micromark-extension-gfm`/`mdast-util-gfm`
 * (tables, strikethrough, autolinks, task lists, footnotes) -- the same
 * combination `markdown-html` (phase 5 plan 05-07) tests against the
 * CommonMark 0.31.2 specification's own example set and the GitHub Flavored
 * Markdown spec's extension examples. This module never renders anything;
 * `fromMarkdown` builds a syntax tree only, and never runs a script or loads
 * a network resource while doing it.
 */
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { text, element, isSafeLinkTarget, isSafeImageTarget, type BbNode } from './tree';

export interface ParseResult {
  tree: BbNode[];
  warnings: string[];
}

// mdast's own node shapes are typed only by the `mdast` package, which this
// project does not depend on; a minimal structural type covers what this
// module actually reads.
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  url?: string;
  alt?: string | null;
  lang?: string | null;
  depth?: number;
  ordered?: boolean | null;
  align?: (string | null)[];
}

function flattenPlainText(nodes: BbNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += node.value;
    else out += flattenPlainText(node.children);
  }
  return out;
}

function convertInline(node: MdastNode, warnings: string[]): BbNode[] {
  const kids = () => convertChildren(node.children ?? [], warnings);

  switch (node.type) {
    case 'text':
      return [text(node.value ?? '')];
    case 'emphasis':
      return [element('i', kids())];
    case 'strong':
      return [element('b', kids())];
    case 'delete':
      return [element('s', kids())];
    case 'inlineCode':
      return [element('code', [text(node.value ?? '')])];
    case 'link': {
      const url = node.url ?? '';
      if (!isSafeLinkTarget(url)) {
        warnings.push(`A link to "${url}" was not a safe address, so only its text was kept.`);
        return kids();
      }
      return [element('url', kids(), { href: url })];
    }
    case 'image': {
      const url = node.url ?? '';
      if (!isSafeImageTarget(url)) {
        warnings.push(`An image at "${url}" was not a safe address, so it was dropped.`);
        return [];
      }
      return [element('img', [], { src: url })];
    }
    case 'break':
      return [element('br', [])];
    case 'footnoteReference':
      warnings.push('A footnote has no BBCode form and was dropped.');
      return [];
    case 'html':
      // Raw inline HTML embedded in Markdown: kept as literal text, exactly
      // as typed, never interpreted as a tag or as BBCode.
      return [text(node.value ?? '')];
    default:
      return kids();
  }
}

function convertChildren(children: MdastNode[], warnings: string[]): BbNode[] {
  const out: BbNode[] = [];
  for (const child of children) out.push(...convertInline(child, warnings));
  return out;
}

function tableToPlainLines(node: MdastNode, warnings: string[]): BbNode[] {
  const out: BbNode[] = [];
  const rows = node.children ?? [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const cells = (row.children ?? []).map((cell) => flattenPlainText(convertChildren(cell.children ?? [], warnings)));
    out.push(text(cells.join('  ')));
    if (i < rows.length - 1) out.push(element('br', []));
  }
  return out;
}

/** Converts one top-level mdast block node into a single block-shaped `BbNode` (a `paragraph`, or a `quote`/`code`/`list` element), or none for a block this tag set cannot represent at all. */
function convertBlock(node: MdastNode, warnings: string[]): BbNode[] {
  switch (node.type) {
    case 'paragraph':
      return [element('paragraph', convertChildren(node.children ?? [], warnings))];
    case 'heading': {
      warnings.push('A heading has no BBCode form; it was converted to bold text.');
      return [element('paragraph', [element('b', convertChildren(node.children ?? [], warnings))])];
    }
    case 'blockquote':
      return [
        element(
          'quote',
          (node.children ?? []).flatMap((c) => convertBlock(c, warnings)),
        ),
      ];
    case 'code':
      return [element('code', [text(node.value ?? '')], node.lang ? { lang: node.lang } : undefined)];
    case 'list': {
      const style = node.ordered ? '1' : 'unordered';
      const items = (node.children ?? []).map((item) =>
        element(
          'item',
          (item.children ?? []).flatMap((c) => convertBlock(c, warnings)),
        ),
      );
      return [element('list', items, { style })];
    }
    case 'thematicBreak':
      warnings.push('A horizontal rule has no BBCode form and was dropped.');
      return [];
    case 'table':
      warnings.push('A table has no tag in this BBCode tag set; its cells were kept as plain lines.');
      return [element('paragraph', tableToPlainLines(node, warnings))];
    case 'footnoteDefinition':
      warnings.push('A footnote has no BBCode form and was dropped.');
      return [];
    case 'html':
      return [element('paragraph', [text(node.value ?? '')])];
    default:
      return [element('paragraph', convertChildren(node.children ?? [], warnings))];
  }
}

/** Parses `input` as CommonMark plus GFM into the shared document tree. */
export function parseMarkdown(input: string): ParseResult {
  const warnings: string[] = [];
  const root = fromMarkdown(input, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as unknown as MdastNode;

  const tree = (root.children ?? []).flatMap((node) => convertBlock(node, warnings));
  return { tree, warnings };
}
