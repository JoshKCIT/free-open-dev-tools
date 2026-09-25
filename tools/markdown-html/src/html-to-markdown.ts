/**
 * Converts HTML back to Markdown with `turndown`, on top of its own ATX
 * heading, fenced code and dash bullet options, plus hand-written rules for
 * the GFM constructs turndown has no built-in support for: simple tables,
 * strikethrough and task list checkboxes. `turndown`'s own `package.json`
 * `browser` field swaps its Node-only DOM implementation
 * (`@mixmark-io/domino`) for the caller's own global `DOMParser` in a
 * browser bundle (confirmed directly from the installed package's manifest,
 * not assumed) -- inert either way: neither parser runs a script or loads
 * an image while parsing.
 */
import TurndownService from 'turndown';

export interface HtmlToMarkdownResult {
  markdown: string;
  warnings: string[];
}

/**
 * Refusal threshold for the count of `<a` opening tags in one document
 * (D-09/D-25, freeze risk). Measured directly against this package (not
 * assumed): a wide document of many separate inline links shows
 * super-linear growth (5,000 links ~575ms, 8,000 ~1.4s, 12,000 ~2.8s), a
 * genuinely different risk from a document's raw byte length -- the same
 * package converts a 265KB, 2,000-row GFM table in ~530ms. A background
 * worker cannot bound this instead (shared_procedure rule R's usual fix):
 * confirmed directly, none of this project's four tested browser engines
 * expose `DOMParser` inside a Worker's own global scope, and `turndown`'s
 * browser build needs it the moment parsing starts, so this conversion
 * cannot run off the main thread at all.
 */
const MAX_LINK_TAGS = 6000;

function countLinkTags(html: string): number {
  const matches = html.match(/<a[\s/>]/gi);
  return matches ? matches.length : 0;
}

/** Link target schemes this tool keeps as a real Markdown link; anything else becomes plain text. */
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** Elements whose whole subtree cannot round-trip as a single GFM table cell (GFM's own table rule: no block-level content). */
const BLOCK_CONTENT_TAGS = new Set([
  'p',
  'div',
  'ul',
  'ol',
  'li',
  'table',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'form',
  'fieldset',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'figure',
  'figcaption',
]);

/** True for a value that, read as a URL, carries an explicit scheme not on the safe list (and is not a fragment or relative reference). */
function isDangerousLinkTarget(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return false;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!schemeMatch) return false; // No scheme at all: a relative reference, always safe.
  const scheme = `${(schemeMatch[1] ?? '').toLowerCase()}:`;
  return !SAFE_LINK_SCHEMES.has(scheme);
}

/** True when a table cell or its descendants carry a colspan/rowspan, or any block-level content GFM tables cannot hold. */
function isMergedOrBlockCell(cell: Element): boolean {
  if (cell.hasAttribute('colspan') || cell.hasAttribute('rowspan')) return true;
  for (const el of Array.from(cell.querySelectorAll('*'))) {
    if (BLOCK_CONTENT_TAGS.has(el.tagName.toLowerCase())) return true;
  }
  return false;
}

/** True when every cell in `table` can be represented as one line of a GFM pipe table. */
function isSimpleTable(table: Element): boolean {
  const cells = Array.from(table.querySelectorAll('td, th'));
  return cells.every((cell) => !isMergedOrBlockCell(cell));
}

/** One cell's own content, converted to Markdown, collapsed to a single line, with pipes escaped. */
function cellMarkdown(service: TurndownService, cell: Element): string {
  const converted = service.turndown(cell.innerHTML || cell.textContent || '');
  return converted
    .trim()
    .replace(/\|/g, '\\|')
    .replace(/\r?\n+/g, ' ');
}

/** Builds a GFM pipe table from a `<table>` already proven simple by `isSimpleTable`. */
function simpleTableToMarkdown(service: TurndownService, table: Element): string {
  const allRows = Array.from(table.querySelectorAll('tr'));
  if (allRows.length === 0) return '';

  const thead = table.querySelector('thead');
  const theadRow = thead ? thead.querySelector('tr') : null;
  const headerRow = theadRow ?? allRows[0]!;
  const bodyRows = allRows.filter((row) => row !== headerRow);

  const headerCells = Array.from(headerRow.querySelectorAll('th, td')).map((cell) => cellMarkdown(service, cell));
  const colCount = headerCells.length;
  if (colCount === 0) return '';

  const lines = [
    `| ${headerCells.join(' | ')} |`,
    `| ${headerCells.map(() => '---').join(' | ')} |`,
    ...bodyRows.map((row) => {
      const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => cellMarkdown(service, cell));
      while (cells.length < colCount) cells.push('');
      return `| ${cells.slice(0, colCount).join(' | ')} |`;
    }),
  ];

  return `\n\n${lines.join('\n')}\n\n`;
}

/**
 * Converts `html` to Markdown. Script, style, noscript, template, iframe,
 * object and embed content never reaches the output. GFM tables,
 * strikethrough and task list items are hand-written rules turndown itself
 * has no built-in support for; a table with a merged cell (colspan or
 * rowspan) or block-level content in a cell is kept as raw HTML instead,
 * with a warning. A link whose target is not http, https, mailto, a
 * relative reference or a same-document fragment becomes its own plain
 * text, with a warning.
 */
export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  const linkCount = countLinkTags(html);
  if (linkCount > MAX_LINK_TAGS) {
    throw new Error(
      `This document has ${linkCount} links, more than the ${MAX_LINK_TAGS} limit, so it was refused rather than risk freezing the tab.`,
    );
  }

  const warnings: string[] = [];
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
  });

  service.remove(['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed']);

  service.addRule('strikethrough', {
    // 'strike' is a deprecated but still-encountered tag name, not part of
    // TypeScript's own HTMLElementTagNameMap, so this filter is a plain node
    // name check rather than the string/array form of `filter`.
    filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });

  service.addRule('taskListCheckbox', {
    filter: (node) =>
      node.nodeName === 'INPUT' &&
      (node as unknown as HTMLInputElement).getAttribute('type') === 'checkbox' &&
      node.parentNode?.nodeName === 'LI' &&
      node.parentNode.firstChild === node,
    replacement: (_content, node) => {
      const checked = (node as unknown as Element).hasAttribute('checked');
      return `[${checked ? 'x' : ' '}] `;
    },
  });

  service.addRule('gfmTable', {
    filter: 'table',
    replacement: (_content, node) => {
      const table = node as unknown as Element;
      if (isSimpleTable(table)) return simpleTableToMarkdown(service, table);
      warnings.push('A table with a merged cell or block-level cell content was kept as HTML.');
      return `\n\n${(table as unknown as HTMLElement).outerHTML}\n\n`;
    },
  });

  service.addRule('dangerousLinkTarget', {
    filter: (node) =>
      node.nodeName === 'A' && isDangerousLinkTarget((node as unknown as Element).getAttribute('href') ?? ''),
    replacement: (content, node) => {
      const href = (node as unknown as Element).getAttribute('href') ?? '';
      warnings.push(`A link to "${href}" was not a recognised safe address, so only its text was kept.`);
      return content;
    },
  });

  const markdown = service.turndown(html).trim();
  return { markdown, warnings };
}
