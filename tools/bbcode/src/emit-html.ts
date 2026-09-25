/**
 * Writes escaped HTML from the shared document tree (`tree.ts`). This
 * module's own output is never displayed: `index.ts` always runs it through
 * `sanitise.ts` (the same sanitising policy every rendering page on this
 * site shares) before returning it, so an unsafe value that slipped past a
 * parser's own validation is still caught here.
 */
import type { BbNode, ListStyle } from './tree';

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** HTML's own relative font-size keyword scale, index 0 for size 1 through index 6 for size 7. */
const RELATIVE_SIZE_CSS = ['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large'];

function sizeToCss(value: string): string {
  if (value.endsWith('%')) return value;
  const n = Number(value);
  return RELATIVE_SIZE_CSS[n - 1] ?? value;
}

function listTag(style: ListStyle | undefined): 'ul' | 'ol' {
  return style && style !== 'unordered' ? 'ol' : 'ul';
}

function listTypeAttr(style: ListStyle | undefined): string {
  if (style === 'a' || style === 'A' || style === 'i' || style === 'I') return ` type="${style}"`;
  return '';
}

function renderNode(node: BbNode): string {
  if (node.type === 'text') return escapeText(node.value);

  const inner = () => renderNodes(node.children);

  switch (node.tag) {
    case 'b':
      return `<strong>${inner()}</strong>`;
    case 'i':
      return `<em>${inner()}</em>`;
    case 'u':
      return `<u>${inner()}</u>`;
    case 's':
      return `<del>${inner()}</del>`;
    case 'url':
      return `<a href="${escapeAttr(node.attrs?.href ?? '')}">${inner()}</a>`;
    case 'img':
      return `<img src="${escapeAttr(node.attrs?.src ?? '')}" alt="">`;
    case 'quote': {
      const cite = node.attrs?.cite;
      const citeLine = cite ? `<p><cite>${escapeText(cite)} wrote:</cite></p>` : '';
      return `<blockquote>${citeLine}${inner()}</blockquote>`;
    }
    case 'code': {
      const lang = node.attrs?.lang;
      const cls = lang ? ` class="language-${escapeAttr(lang)}"` : '';
      return `<pre><code${cls}>${inner()}</code></pre>`;
    }
    case 'list': {
      const style = node.attrs?.style as ListStyle | undefined;
      const tag = listTag(style);
      return `<${tag}${listTypeAttr(style)}>${inner()}</${tag}>`;
    }
    case 'item':
      return `<li>${inner()}</li>`;
    case 'color':
      return `<span style="color:${escapeAttr(node.attrs?.value ?? '')}">${inner()}</span>`;
    case 'size':
      return `<span style="font-size:${escapeAttr(sizeToCss(node.attrs?.value ?? ''))}">${inner()}</span>`;
    case 'align':
      return `<div style="text-align:${escapeAttr(node.attrs?.value ?? '')}">${inner()}</div>`;
    case 'br':
      return '<br>';
    case 'paragraph':
      return `<p>${inner()}</p>`;
    default:
      return inner();
  }
}

function renderNodes(nodes: BbNode[]): string {
  return nodes.map(renderNode).join('');
}

/** Writes `nodes` as HTML. Never sanitised; always followed by a `sanitise.ts` pass before display. */
export function emitHtml(nodes: BbNode[]): string {
  return renderNodes(nodes);
}
