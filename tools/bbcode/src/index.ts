import meta from './meta.json';
import type { WindowLike } from 'dompurify';
import { parseBbcode } from './parse-bbcode';
import { emitBbcode } from './emit-bbcode';
import { emitMarkdown } from './emit-markdown';
import { emitHtml } from './emit-html';
import { sanitiseMarkup, describeRemoved, type RemovedSummary } from './sanitise';
import type { BbNode } from './tree';

export { meta };

export class BbcodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BbcodeError';
  }
}

export type MarkupFormat = 'bbcode' | 'markdown' | 'html';

export interface ConvertOptions {
  from: MarkupFormat;
  to: MarkupFormat;
}

export interface ConvertResult {
  /** The converted text: BBCode or Markdown source, or sanitised HTML. */
  output: string;
  /** Equal to `output` for an HTML target; empty for BBCode or Markdown targets, which are never rendered. */
  preview: string;
  /** What the HTML sanitiser removed. All-zero counts for a non-HTML target. */
  removed: RemovedSummary;
  /** Anything the source format could express that the target could not, or an unsafe value that was dropped. */
  warnings: string[];
}

function emptyRemoved(): RemovedSummary {
  return { elements: 0, eventHandlers: 0, dangerousUrls: 0, externalReferences: 0, styles: 0 };
}

function parseSource(input: string, from: MarkupFormat): { tree: BbNode[]; warnings: string[] } {
  switch (from) {
    case 'bbcode':
      return parseBbcode(input);
    default:
      throw new BbcodeError(`Converting from "${from}" is not supported.`);
  }
}

/**
 * Converts `input` from one of `bbcode`, `markdown` or `html` to another,
 * through this package's own shared document tree. `win` is the caller's
 * own `window`; it is read only when `to` is `html` (sanitising needs a
 * DOM), and this package never reads a DOM global for any other target.
 */
export function convertMarkup(input: string, options: ConvertOptions, win?: WindowLike): ConvertResult {
  const { from, to } = options;
  const { tree, warnings: parseWarnings } = parseSource(input, from);

  if (to === 'html') {
    if (!win) throw new BbcodeError('Converting to html needs a browser window to sanitise with.');
    const rawHtml = emitHtml(tree);
    const { markup, removed } = sanitiseMarkup(rawHtml, win, 'html');
    const warnings = [...parseWarnings, ...describeRemoved(removed)];
    return { output: markup, preview: markup, removed, warnings };
  }

  if (to === 'markdown') {
    const { markdown, warnings: emitWarnings } = emitMarkdown(tree);
    return { output: markdown, preview: '', removed: emptyRemoved(), warnings: [...parseWarnings, ...emitWarnings] };
  }

  // to === 'bbcode'
  const output = emitBbcode(tree);
  return { output, preview: '', removed: emptyRemoved(), warnings: parseWarnings };
}
