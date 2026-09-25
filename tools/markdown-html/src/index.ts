import meta from './meta.json';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import type { WindowLike } from 'dompurify';
import { sanitiseToFragment, serialiseFragment, describeRemoved, type RemovedSummary } from './sanitise';

export { meta };

export class MarkdownHtmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkdownHtmlError';
  }
}

/** One heading found while building the table of contents. */
export interface MarkdownHeading {
  /** 1 for h1 through 6 for h6. */
  level: number;
  /** The GitHub-style slug this heading was given (or already carried). */
  id: string;
  /** The heading's own text content. */
  text: string;
}

export interface MarkdownToHtmlOptions {
  /** Build a table of contents nav and place it first. Default false. */
  toc?: boolean;
  /** Deepest heading level (1-6) the table of contents links. Default 3. */
  tocDepth?: number;
}

export interface MarkdownToHtmlResult {
  html: string;
  headings: MarkdownHeading[];
  removed: RemovedSummary;
  warnings: string[];
}

/**
 * Renders `markdown` to HTML with `micromark` plus `micromark-extension-gfm`
 * (tables, strikethrough, autolinks, task list items, tagfilter), the
 * combination this project's tests check against both the CommonMark 0.31.2
 * specification's own example set and the GitHub Flavored Markdown spec's
 * extension examples. `allowDangerousHtml: true` means raw HTML written in
 * the Markdown source is passed on rather than escaped, so a visitor's own
 * inline HTML still works -- the caller must always sanitise this result
 * before showing it. This function's own result is never displayed; only
 * `markdownToSafeHtml`'s sanitised result is.
 */
export function renderCommonMark(markdown: string): string {
  return micromark(markdown, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
    allowDangerousHtml: true,
    allowDangerousProtocol: false,
  });
}

/**
 * GitHub's own observed heading-id convention (ambiguities: not a published
 * standard): lower-case, keeping Unicode letters, marks, numbers, connector
 * punctuation, spaces and hyphens; every other character is dropped; a run
 * of whitespace becomes a single hyphen.
 */
function slugify(text: string): string {
  const lower = text.toLowerCase();
  const kept = lower.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\s-]/gu, '');
  return kept.replace(/\s+/g, '-');
}

function headingLevel(tagName: string): number | null {
  const match = /^h([1-6])$/i.exec(tagName);
  return match ? Number(match[1]) : null;
}

/**
 * Walks every heading in `root`, giving each one without an `id` attribute
 * already a unique GitHub-style slug, and returns the full list in document
 * order (including headings that already carried their own `id`).
 */
function assignHeadingIds(root: DocumentFragment): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const seen = new Set<string>();
  const elements = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));

  for (const el of elements) {
    const level = headingLevel(el.tagName) ?? 1;
    const text = el.textContent ?? '';
    let id = el.getAttribute('id');

    if (id) {
      seen.add(id);
    } else {
      const base = slugify(text) || 'section';
      id = base;
      let suffix = 1;
      while (seen.has(id)) {
        id = `${base}-${suffix}`;
        suffix++;
      }
      seen.add(id);
      el.setAttribute('id', id);
    }

    headings.push({ level, id, text });
  }

  return headings;
}

/**
 * Builds a `nav` holding nested `ul` lists of links to every heading at or
 * above `tocDepth`, in document order, nested by heading level. Every node
 * is created with `createElement` and text is set only with `textContent`,
 * never markup -- the table of contents is built after sanitising, from
 * data this function extracts itself, not from a second pass over untrusted
 * text.
 */
function buildToc(doc: Document, headings: MarkdownHeading[], tocDepth: number): Element {
  const nav = doc.createElement('nav');
  nav.setAttribute('aria-label', 'Table of contents');
  const rootUl = doc.createElement('ul');
  nav.appendChild(rootUl);

  const included = headings.filter((h) => h.level <= tocDepth);
  const stack: { level: number; ul: Element }[] = [{ level: 0, ul: rootUl }];

  for (const heading of included) {
    while (stack.length > 1 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (!parent) continue;

    const li = doc.createElement('li');
    const a = doc.createElement('a');
    a.setAttribute('href', `#${heading.id}`);
    a.textContent = heading.text;
    li.appendChild(a);
    parent.ul.appendChild(li);

    const nestedUl = doc.createElement('ul');
    li.appendChild(nestedUl);
    stack.push({ level: heading.level, ul: nestedUl });
  }

  // Every li speculatively got a nested ul in case a deeper heading followed
  // it; remove the ones that stayed empty.
  for (const ul of Array.from(nav.querySelectorAll('ul'))) {
    if (ul.children.length === 0) ul.remove();
  }

  return nav;
}

/**
 * Renders `markdown` to sanitised HTML: parses with `renderCommonMark`,
 * sanitises with the same html-profile policy every rendering tool on this
 * site shares, gives every heading without one a unique GitHub-style id,
 * and, when `toc`, builds and prepends a table of contents linking headings
 * up to `tocDepth`. `win` is the caller's own `window`; this function never
 * reads a DOM global itself.
 */
export function markdownToSafeHtml(
  markdown: string,
  win: WindowLike,
  options: MarkdownToHtmlOptions = {},
): MarkdownToHtmlResult {
  const { toc = false, tocDepth = 3 } = options;

  const rawHtml = renderCommonMark(markdown);
  const { fragment, removed } = sanitiseToFragment(rawHtml, win, 'html');
  const warnings = describeRemoved(removed);

  const headings = assignHeadingIds(fragment);

  if (toc) {
    const doc = win.document as unknown as Document;
    const nav = buildToc(doc, headings, tocDepth);
    fragment.insertBefore(nav, fragment.firstChild);
  }

  const html = serialiseFragment(fragment, win, 'html');
  return { html, headings, removed, warnings };
}
