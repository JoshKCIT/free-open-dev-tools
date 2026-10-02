import { parseWellFormed, isWhitespaceOnly, type ElementNode, type XmlNode } from './parse';

export interface TreeOptions {
  /** Stop after this many elements and say so. The page uses 2,000. */
  maxElements: number;
  /** How many levels start open: 2 opens the root element and its children. */
  openLevels: number;
}

export interface TreeHtmlResult {
  /** A fragment of HTML that needs no script: nested `details` elements, every character of the document escaped. */
  html: string;
  /** Elements shown. */
  elements: number;
  /** Elements in the whole document. */
  totalElements: number;
  /** True when the view stopped at `maxElements`, so the document has more elements than are shown. */
  truncated: boolean;
}

/** The five predefined entities of XML 1.0 section 4.6, so no character of the document can act as markup. */
export function escapeHtml(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === "'") out += '&#39;';
    else out += ch;
  }
  return out;
}

const STYLE =
  '<style>details{margin:0 0 0 1.1em}summary{cursor:pointer;font-family:ui-monospace,Consolas,monospace;font-size:13px}' +
  '.l,.t,.c{font-family:ui-monospace,Consolas,monospace;font-size:13px;margin:0 0 0 1.1em;white-space:pre-wrap}' +
  '.t{color:#16191d}.c{color:#5b6572}.l{color:#16191d}</style>';

/**
 * Builds the collapsible tree of a document from the parse path that format, minify and check use, so a document
 * that cannot be formatted (a DOCTYPE, a well-formedness error, an undeclared entity) cannot be shown either, with
 * the same message. Nothing is rewritten: each element shows its start tag as written, text and comments as written,
 * and every character is escaped, so the result is text however hostile the document is. The first `openLevels`
 * levels are open, whitespace-only text between elements is left out, and the view stops after `maxElements`
 * elements.
 */
export function buildTreeHtml(text: string, options: TreeOptions): TreeHtmlResult {
  const parsed = parseWellFormed(text);
  const { maxElements, openLevels } = options;
  let shown = 0;
  let truncated = false;

  const renderNodes = (nodes: XmlNode[], depth: number, out: string[]): void => {
    for (const node of nodes) {
      if (truncated) return;
      if (node.type === 'text') {
        if (!isWhitespaceOnly(node.text)) out.push(`<div class="t">${escapeHtml(node.text.trim())}</div>`);
      } else if (node.type === 'element') {
        if (shown >= maxElements) {
          truncated = true;
          return;
        }
        shown++;
        renderElement(node, depth, out);
      } else {
        // A comment, CDATA section, processing instruction or the XML declaration, as written.
        out.push(`<div class="c">${escapeHtml(node.raw)}</div>`);
      }
    }
  };

  const renderElement = (node: ElementNode, depth: number, out: string[]): void => {
    const hasContent = node.children.some((child) => child.type !== 'text' || !isWhitespaceOnly(child.text));
    if (!hasContent) {
      out.push(`<div class="l">${escapeHtml(node.startRaw + (node.endRaw ?? ''))}</div>`);
      return;
    }
    out.push(`<details${depth <= openLevels ? ' open' : ''}><summary>${escapeHtml(node.startRaw)}</summary>`);
    renderNodes(node.children, depth + 1, out);
    out.push(`<div class="l">${escapeHtml(node.endRaw ?? '')}</div></details>`);
  };

  const out: string[] = [];
  renderNodes(parsed.roots, 1, out);
  return { html: STYLE + out.join(''), elements: shown, totalElements: parsed.elements, truncated };
}
