/**
 * Writes canonical BBCode from the shared document tree (`tree.ts`),
 * following phpBB's own documented tag examples (see `parse-bbcode.ts`'s
 * header comment for the source). Used both as a conversion target (from
 * Markdown or HTML) and to canonicalise BBCode input back to itself.
 */
import type { BbNode, ListStyle } from './tree';

function listOpenTag(style: ListStyle | undefined): string {
  return style && style !== 'unordered' ? `[list=${style}]` : '[list]';
}

function renderNode(node: BbNode): string {
  if (node.type === 'text') return node.value;

  const inner = () => renderNodes(node.children);

  switch (node.tag) {
    case 'b':
      return `[b]${inner()}[/b]`;
    case 'i':
      return `[i]${inner()}[/i]`;
    case 'u':
      return `[u]${inner()}[/u]`;
    case 's':
      return `[s]${inner()}[/s]`;
    case 'url':
      return `[url=${node.attrs?.href ?? ''}]${inner()}[/url]`;
    case 'img':
      return `[img]${node.attrs?.src ?? ''}[/img]`;
    case 'quote':
      return node.attrs?.cite ? `[quote=${node.attrs.cite}]${inner()}[/quote]` : `[quote]${inner()}[/quote]`;
    case 'code':
      return node.attrs?.lang ? `[code=${node.attrs.lang}]${inner()}[/code]` : `[code]${inner()}[/code]`;
    case 'list':
      return `${listOpenTag(node.attrs?.style as ListStyle | undefined)}${inner()}[/list]`;
    case 'item':
      return `[*]${inner()}`;
    case 'color':
      return `[color=${node.attrs?.value ?? ''}]${inner()}[/color]`;
    case 'size':
      // Canonical BBCode is always a bare integer; strip the '%' this
      // package's own tree uses to distinguish phpBB's percent scale.
      return `[size=${(node.attrs?.value ?? '').replace('%', '')}]${inner()}[/size]`;
    case 'align': {
      const value = node.attrs?.value ?? 'left';
      return `[${value}]${inner()}[/${value}]`;
    }
    case 'br':
      return '\n';
    case 'paragraph':
      return inner();
    default:
      return inner();
  }
}

function renderNodes(nodes: BbNode[]): string {
  const parts: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    parts.push(renderNode(node));
    if (node.type === 'element' && node.tag === 'paragraph' && i < nodes.length - 1) parts.push('\n\n');
    if (node.type === 'element' && node.tag === 'item') parts.push('\n');
  }
  return parts.join('');
}

/** Writes `nodes` as canonical BBCode. */
export function emitBbcode(nodes: BbNode[]): string {
  return renderNodes(nodes);
}
