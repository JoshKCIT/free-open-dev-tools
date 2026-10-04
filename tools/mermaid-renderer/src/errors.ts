import { cutWithEllipsis, collapseSpace, visible } from './text';

/** Why a diagram was not drawn or not shown. `line` is counted from 1 in the text as pasted, when it is known. */
export class MermaidError extends Error {
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(message);
    this.name = 'MermaidError';
    if (line !== undefined) this.line = line;
  }
}

/** What the page shows when the first line of the diagram does not name a diagram type the engine knows. */
export const UNKNOWN_TYPE_MESSAGE =
  'The first line does not name a diagram type this page can draw, such as flowchart, sequenceDiagram, classDiagram or pie.';

/** What the page shows when the engine ran out of stack drawing a diagram that passed the checks made before it. */
export const TOO_COMPLEX_MESSAGE = 'This diagram is too complex for this page.';

/** A parser message is cut to this many characters. */
export const MAX_PARSER_MESSAGE_CHARS = 160;

/**
 * What the page shows for a diagram the parser could not read: the line the parser's own location gives and what it
 * expected, never the diagram. `expecting` is the clause the frame found in the parser's message (token names of the
 * grammar, such as `Expecting 'NEWLINE', 'SPACE'`); it is shown through `visible`, and the whole message is cut to 160
 * characters. A missing or unusable line or clause is left out.
 */
export function parserMessage(line?: number, expecting?: string): string {
  const hasLine = typeof line === 'number' && Number.isInteger(line) && line >= 1 && line <= 1_000_000;
  let message = hasLine ? `Line ${line}: the diagram could not be read.` : 'The diagram could not be read.';
  if (typeof expecting === 'string') {
    const clause = collapseSpace(visible(expecting.length > 400 ? expecting.slice(0, 400) : expecting));
    if (clause !== '') message += ` ${clause}`;
  }
  return cutWithEllipsis(message, MAX_PARSER_MESSAGE_CHARS);
}
