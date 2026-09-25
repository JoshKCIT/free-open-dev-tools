/**
 * Writes CommonMark Markdown from the shared document tree (`tree.ts`).
 * ASCII punctuation in plain text is backslash-escaped wherever CommonMark
 * would otherwise read it as syntax (CommonMark 0.31.2 section 2.4,
 * "Backslash escapes" -- its own list of escapable characters is exactly
 * ASCII punctuation), so a round trip through this emitter and back through
 * a CommonMark parser reads the same text. Underline, colour, size and text
 * alignment have no CommonMark form; each is dropped with one warning per
 * feature used (not one per occurrence), and its content is kept as plain
 * text.
 */
import type { BbNode, ListStyle } from './tree';

export interface MarkdownEmitResult {
  markdown: string;
  warnings: string[];
}

/** CommonMark 0.31.2's own ASCII punctuation set, escapable with a backslash. */
const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/g;

function escapeText(value: string): string {
  return value.replace(ASCII_PUNCTUATION, '\\$&');
}

function flattenPlainText(nodes: BbNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += node.value;
    else out += flattenPlainText(node.children);
  }
  return out;
}

function maxBacktickRun(value: string): number {
  let max = 0;
  for (const run of value.match(/`+/g) ?? []) {
    if (run.length > max) max = run.length;
  }
  return max;
}

const BLOCK_TAGS = new Set(['paragraph', 'quote', 'code', 'list']);

function isBlockNode(node: BbNode): boolean {
  return node.type === 'element' && BLOCK_TAGS.has(node.tag);
}

function renderInline(node: BbNode, warnings: Set<string>): string {
  if (node.type === 'text') return escapeText(node.value);

  const inner = () => node.children.map((c) => renderInline(c, warnings)).join('');

  switch (node.tag) {
    case 'b':
      return `**${inner()}**`;
    case 'i':
      return `*${inner()}*`;
    case 's':
      return `~~${inner()}~~`;
    case 'u':
      warnings.add('Underline has no Markdown form and was dropped.');
      return inner();
    case 'color':
      warnings.add('Text colour has no Markdown form and was dropped.');
      return inner();
    case 'size':
      warnings.add('Text size has no Markdown form and was dropped.');
      return inner();
    case 'align':
      warnings.add('Text alignment has no Markdown form and was dropped.');
      return inner();
    case 'url':
      return `[${inner()}](${node.attrs?.href ?? ''})`;
    case 'img':
      return `![](${node.attrs?.src ?? ''})`;
    case 'br':
      return '  \n';
    default:
      // Reached only if a block-level node ends up inside inline content
      // (e.g. a quote written directly inside a color tag); render it in
      // place rather than lose it.
      return renderBlock(node, warnings);
  }
}

function renderBlock(node: BbNode, warnings: Set<string>): string {
  if (node.type !== 'element') return renderInline(node, warnings);

  switch (node.tag) {
    case 'paragraph':
      return renderInlineRun(node.children, warnings);
    case 'quote': {
      const body = renderBlocks(node.children, warnings);
      const lines = body.split('\n');
      return lines.map((line) => (line === '' ? '>' : `> ${line}`)).join('\n');
    }
    case 'code': {
      const codeText = flattenPlainText(node.children);
      const fenceLength = Math.max(3, maxBacktickRun(codeText) + 1);
      const fence = '`'.repeat(fenceLength);
      const lang = node.attrs?.lang ?? '';
      return `${fence}${lang}\n${codeText}\n${fence}`;
    }
    case 'list': {
      const style = node.attrs?.style as ListStyle | undefined;
      const ordered = Boolean(style) && style !== 'unordered';
      if (ordered && style !== '1') {
        warnings.add(
          'An ordered list style with letters or roman numerals has no Markdown form; numbers were used instead.',
        );
      }
      const items = node.children.filter((c) => c.type === 'element' && c.tag === 'item');
      return items
        .map((item, index) => {
          const marker = ordered ? `${index + 1}. ` : '- ';
          const body = item.type === 'element' ? renderBlocks(item.children, warnings) : '';
          const lines = body.split('\n');
          return lines.map((line, i) => (i === 0 ? `${marker}${line}` : `  ${line}`)).join('\n');
        })
        .join('\n');
    }
    default:
      return renderInlineRun([node], warnings);
  }
}

/** Renders a run of purely inline nodes (no paragraph grouping needed: the caller already knows this run has no block siblings). */
function renderInlineRun(nodes: BbNode[], warnings: Set<string>): string {
  return nodes.map((n) => renderInline(n, warnings)).join('');
}

/** Renders a mixed sequence of block and inline nodes, grouping consecutive inline runs into their own paragraph-like block, separated by a blank line. */
function renderBlocks(nodes: BbNode[], warnings: Set<string>): string {
  const blocks: string[] = [];
  let inlineRun: BbNode[] = [];
  const flush = () => {
    if (inlineRun.length > 0) {
      blocks.push(renderInlineRun(inlineRun, warnings));
      inlineRun = [];
    }
  };
  for (const node of nodes) {
    if (isBlockNode(node)) {
      flush();
      blocks.push(renderBlock(node, warnings));
    } else {
      inlineRun.push(node);
    }
  }
  flush();
  return blocks.join('\n\n');
}

/** Writes `nodes` as CommonMark Markdown. */
export function emitMarkdown(nodes: BbNode[]): MarkdownEmitResult {
  const warnings = new Set<string>();
  const markdown = renderBlocks(nodes, warnings).trim();
  return { markdown, warnings: [...warnings] };
}
