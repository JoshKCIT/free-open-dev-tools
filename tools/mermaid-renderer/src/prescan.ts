import { MermaidError } from './errors';
import { MAX_DIAGRAM_CHARS, MAX_DIAGRAM_LINES, MAX_LINE_CHARS } from './limits';

/** The messages of the refusals, each started with `Line N: ` by the scan. */
const DIRECTIVE_REFUSED = 'settings directives are not supported here.';
const FRONTMATTER_REFUSED = 'only a title is allowed in the frontmatter.';
const LINK_REFUSED =
  'click and link lines are not supported here, so the diagram cannot open addresses or run handlers.';
const IMAGE_REFUSED = 'image shapes are not supported here.';
const MATH_REFUSED = 'math is not supported here.';

/** The pattern the engine uses to find a frontmatter block at the start of the text it draws, as the engine writes it. */
const ENGINE_FRONTMATTER = /^-{3}\s*[\n\r](.*?)[\n\r]-{3}\s*[\n\r]+/s;

/** Words that start a line that makes a diagram open an address or run a handler. Compared in lower case. */
const LINK_KEYWORDS: ReadonlySet<string> = new Set(['click', 'link', 'links', 'callback']);

/**
 * Diagram types whose lines are free text, so a line may start with a word such as Click or Link without being a
 * click or link statement. The types that have such statements (flowcharts, sequence, class, state and Gantt
 * diagrams) are not on this list.
 */
const FREE_TEXT_KINDS: ReadonlySet<string> = new Set([
  'mindmap',
  'timeline',
  'journey',
  'kanban',
  'treemap',
  'treemap-beta',
  'pie',
  'quadrantchart',
  'xychart-beta',
  'sankey-beta',
  'packet-beta',
  'radar-beta',
]);

/** The sentence for a diagram with more characters than the limit. */
export function tooManyCharactersMessage(count: number): string {
  return `This diagram is ${count} characters. The limit is ${MAX_DIAGRAM_CHARS.toLocaleString('en-US')} because a large diagram can freeze this page while it is drawn.`;
}

/** The sentence for a diagram with more lines than the limit. */
export function tooManyLinesMessage(count: number): string {
  return `This diagram has ${count} lines. The limit is ${MAX_DIAGRAM_LINES} because a large diagram can freeze this page while it is drawn.`;
}

/**
 * True for every character that JavaScript's own white space pattern matches, which is what the engine reads as white
 * space around a fence and before a statement: the tab, the vertical tab, the form feed, the space, the no-break
 * space, the Ogham space mark, the spaces U+2000 to U+200A, the line and paragraph separators, the narrow no-break
 * space, the medium mathematical space, the ideographic space and the byte order mark. The two line breaks (line feed
 * and carriage return) are not told apart here because the scan splits lines on them first.
 */
/** The sentence for a line with more characters than the limit, naming the line and its length. */
export function tooLongLineMessage(line: number, count: number): string {
  return `Line ${line}: this line is ${count} characters. The limit is ${MAX_LINE_CHARS.toLocaleString('en-US')} characters on one line because a very long line can overflow the drawing engine; split it over several lines.`;
}

function isBlankChar(unit: number): boolean {
  return (
    (unit >= 0x09 && unit <= 0x0d) ||
    unit === 0x20 ||
    unit === 0xa0 ||
    unit === 0x1680 ||
    (unit >= 0x2000 && unit <= 0x200a) ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    unit === 0x202f ||
    unit === 0x205f ||
    unit === 0x3000 ||
    unit === 0xfeff
  );
}

function isWordChar(unit: number): boolean {
  return (
    (unit >= 0x30 && unit <= 0x39) ||
    (unit >= 0x41 && unit <= 0x5a) ||
    (unit >= 0x61 && unit <= 0x7a) ||
    unit === 0x5f ||
    unit === 0x2d
  );
}

/** True for a letter, a digit, an underscore, a quote or a dollar sign: what starts the name of a target. */
function isTargetStart(unit: number): boolean {
  const lower = unit | 0x20;
  return (
    (lower >= 0x61 && lower <= 0x7a) ||
    (unit >= 0x30 && unit <= 0x39) ||
    unit === 0x5f ||
    unit === 0x22 ||
    unit === 0x27 ||
    unit === 0x24
  );
}

/** The index of the first line break (line feed or carriage return) at or after `from`, or the text length. */
function lineEnd(text: string, from: number): number {
  const lf = text.indexOf('\n', from);
  const cr = text.indexOf('\r', from);
  if (lf < 0 && cr < 0) return text.length;
  if (lf < 0) return cr;
  if (cr < 0) return lf;
  return Math.min(lf, cr);
}

/** The number of lines of the text: a line break ends a line, and a break at the very end does not start another. */
function countLines(text: string): number {
  if (text === '') return 0;
  let lines = 0;
  let pos = 0;
  for (;;) {
    const end = lineEnd(text, pos);
    lines++;
    if (end >= text.length) return lines;
    pos = text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? end + 2 : end + 1;
    if (pos >= text.length) return lines;
  }
}

/** The index of the first character that is not a space or a tab, or the line length. */
function firstNonBlank(line: string): number {
  let i = 0;
  while (i < line.length && isBlankChar(line.charCodeAt(i))) i++;
  return i;
}

/** True when the rest of the line from `from` holds nothing but spaces and tabs. */
function blankFrom(line: string, from: number): boolean {
  for (let i = from; i < line.length; i++) if (!isBlankChar(line.charCodeAt(i))) return false;
  return true;
}

/** True when the line is a frontmatter fence: three hyphens and then nothing but spaces. */
function isFence(line: string, start: number): boolean {
  return line.startsWith('---', start) && blankFrom(line, start + 3);
}

/**
 * True when `lower` (a line in lower case) holds the key `img` followed by a colon at or after `from`: the `img` is not
 * part of a longer word, and only spaces and an optional closing quote lie between it and the colon.
 */
function hasImageKey(lower: string, from: number): boolean {
  let at = lower.indexOf('img', from);
  while (at >= 0) {
    const before = at === 0 ? 0 : lower.charCodeAt(at - 1);
    if (at === 0 || !isWordChar(before)) {
      let i = at + 3;
      if (i < lower.length && !isWordChar(lower.charCodeAt(i))) {
        const quote = lower.charCodeAt(i);
        if (quote === 0x22 || quote === 0x27 || quote === 0x60) i++;
        while (i < lower.length && isBlankChar(lower.charCodeAt(i))) i++;
        if (lower.charCodeAt(i) === 0x3a) return true;
      }
    }
    at = lower.indexOf('img', at + 3);
  }
  return false;
}

/**
 * True when a statement of the line starts with one of the words that open an address or run a handler, followed by
 * something that names a target. A statement ends at a semicolon, because flowcharts allow several on one line. A word
 * such as `click` used as a node name (`click --> B`) is not followed by a target and is left alone.
 */
function hasLinkStatement(line: string): boolean {
  let from = 0;
  while (from <= line.length) {
    const semi = line.indexOf(';', from);
    const end = semi < 0 ? line.length : semi;
    let i = from;
    while (i < end && isBlankChar(line.charCodeAt(i))) i++;
    let j = i;
    while (j < end && (line.charCodeAt(j) | 0x20) >= 0x61 && (line.charCodeAt(j) | 0x20) <= 0x7a) j++;
    if (j > i && j - i <= 8 && LINK_KEYWORDS.has(line.slice(i, j).toLowerCase())) {
      let k = j;
      while (k < end && isBlankChar(line.charCodeAt(k))) k++;
      if (k > j && k < end) {
        if (isTargetStart(line.charCodeAt(k))) return true;
      }
    }
    if (semi < 0) break;
    from = semi + 1;
  }
  return false;
}

/**
 * Reads the diagram once, line by line, and refuses the constructs that would make the engine load or open something:
 * a `%%{` settings line, frontmatter other than one `title:` line, `click` and `link` lines, an `@{` block that names
 * `img` and `$$` math. Each refusal names its line, counted from 1. Returns the frontmatter title when there is one.
 * Linear in the text; no size check (see `prescanDiagram`).
 */
export function scanConstructs(text: string): { title?: string } {
  let title: string | undefined;
  // 0: no line seen yet, 1: inside the frontmatter, 2: after the frontmatter or past the point it could start.
  let front = 0;
  let frontOpenedAt = 0;
  let atBlockSeen = false;
  let kind: string | undefined;
  let lineNumber = 0;
  let pos = 0;
  for (;;) {
    const end = lineEnd(text, pos);
    const line = text.slice(pos, end);
    lineNumber++;
    const start = firstNonBlank(line);
    const blank = start >= line.length;

    if (line.indexOf('%%{') >= 0) throw new MermaidError(`Line ${lineNumber}: ${DIRECTIVE_REFUSED}`, lineNumber);

    // A fence line opens or closes the frontmatter; the lines between hold nothing but one title line.
    let fenceLine = false;
    if (front === 0 && !blank) {
      if (isFence(line, start)) {
        front = 1;
        fenceLine = true;
        frontOpenedAt = lineNumber;
      } else {
        front = 2;
      }
    } else if (front === 1 && !blank) {
      if (isFence(line, start)) {
        front = 2;
        fenceLine = true;
      } else if (title === undefined && line.startsWith('title', start) && colonAfterKey(line, start + 5)) {
        title = line.slice(line.indexOf(':', start + 5) + 1).trim();
      } else {
        throw new MermaidError(`Line ${lineNumber}: ${FRONTMATTER_REFUSED}`, lineNumber);
      }
    }

    if (!blank && line.indexOf('$$') >= 0) throw new MermaidError(`Line ${lineNumber}: ${MATH_REFUSED}`, lineNumber);

    if (front === 2 && !blank && !fenceLine) {
      const lower = line.toLowerCase();
      const atAt = lower.indexOf('@{');
      if (atAt >= 0 && !atBlockSeen) {
        atBlockSeen = true;
        if (hasImageKey(lower, atAt + 2)) throw new MermaidError(`Line ${lineNumber}: ${IMAGE_REFUSED}`, lineNumber);
      } else if (atBlockSeen && hasImageKey(lower, 0)) {
        throw new MermaidError(`Line ${lineNumber}: ${IMAGE_REFUSED}`, lineNumber);
      }
      // The first line that is not a comment names the diagram type. Link and click lines exist only in the types
      // that draw nodes and tasks; in the types whose lines are free text a first word such as Click is just text.
      if (kind === undefined && !line.startsWith('%%', start)) kind = firstWord(line, start);
      if (!FREE_TEXT_KINDS.has(kind ?? '') && hasLinkStatement(line)) {
        throw new MermaidError(`Line ${lineNumber}: ${LINK_REFUSED}`, lineNumber);
      }
    }

    if (end >= text.length) break;
    pos = text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? end + 2 : end + 1;
    if (pos >= text.length) break;
  }
  if (front === 1) throw new MermaidError(`Line ${frontOpenedAt}: ${FRONTMATTER_REFUSED}`, frontOpenedAt);
  return title === undefined ? {} : { title };
}

/** The first word of the line from `from`, in lower case: letters, digits and hyphens, at most 24 characters. */
function firstWord(line: string, from: number): string {
  let i = from;
  while (i < line.length && i - from < 24 && isWordChar(line.charCodeAt(i))) i++;
  return line.slice(from, i).toLowerCase();
}

/** True when, from `from`, only spaces and tabs come before a colon. */
function colonAfterKey(line: string, from: number): boolean {
  let i = from;
  while (i < line.length && isBlankChar(line.charCodeAt(i))) i++;
  return line.charCodeAt(i) === 0x3a;
}

/**
 * The check made before any frame exists. Refuses a diagram over 20,000 characters or 300 lines or with a line over
 * 2,000 characters (the first such line is named), then reads it once for the constructs `scanConstructs` names. Throws a `MermaidError` with the line number where there is one; returns
 * the frontmatter title when the diagram has one.
 */
export function prescanDiagram(text: string): { title?: string } {
  if (text.length > MAX_DIAGRAM_CHARS) throw new MermaidError(tooManyCharactersMessage(text.length));
  const lines = countLines(text);
  if (lines > MAX_DIAGRAM_LINES) throw new MermaidError(tooManyLinesMessage(lines));
  let lineNumber = 0;
  for (let pos = 0; pos < text.length;) {
    const end = lineEnd(text, pos);
    lineNumber++;
    if (end - pos > MAX_LINE_CHARS) throw new MermaidError(tooLongLineMessage(lineNumber, end - pos), lineNumber);
    if (end >= text.length) break;
    pos = text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? end + 2 : end + 1;
  }
  return scanConstructs(text);
}

/** The lines of the text: a line break ends a line, and a break at the very end does not start another. */
function splitLines(text: string): string[] {
  const lines: string[] = [];
  if (text === '') return lines;
  let pos = 0;
  for (;;) {
    const end = lineEnd(text, pos);
    lines.push(text.slice(pos, end));
    if (end >= text.length) return lines;
    pos = text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? end + 2 : end + 1;
    if (pos >= text.length) return lines;
  }
}

/** The text a diagram is drawn from, and how many lines of the pasted text come before its first line. */
export interface PreparedDiagram {
  text: string;
  /** Add this to a line the parser reports to get the line of the pasted text. */
  lineOffset: number;
}

/**
 * The text handed to the engine. The engine counts the lines of what it parses after it has dropped the frontmatter,
 * the lines of comments and the blank lines at the start, so a line it reports would not be the line of the pasted
 * text. This does that work first, in a way that keeps every other line where it was: the frontmatter and everything
 * up to the first line of the diagram are dropped (and counted in `lineOffset`), later comment lines become empty
 * lines, line breaks become line feeds, and a title line the frontmatter held is put back as frontmatter. Run it after
 * `prescanDiagram` accepted the text.
 */
export function prepareDiagram(text: string): PreparedDiagram {
  const lines = splitLines(text);
  let first = 0;
  while (first < lines.length && blankFrom(lines[first] ?? '', 0)) first++;
  let title: string | undefined;
  if (first < lines.length && isFence(lines[first] ?? '', firstNonBlank(lines[first] ?? ''))) {
    let i = first + 1;
    while (i < lines.length) {
      const line = lines[i] ?? '';
      const start = firstNonBlank(line);
      if (isFence(line, start)) break;
      if (start < line.length && line.startsWith('title', start) && colonAfterKey(line, start + 5)) {
        title = line.slice(line.indexOf(':', start + 5) + 1).trim();
      }
      i++;
    }
    first = i + 1;
  }
  const isComment = (line: string): boolean => line.startsWith('%%', firstNonBlank(line));
  while (first < lines.length) {
    const line = lines[first] ?? '';
    if (!blankFrom(line, 0) && !isComment(line)) break;
    first++;
  }
  const body = lines.slice(first).map((line) => (isComment(line) ? '' : line));
  const heading = title === undefined ? '' : `---\ntitle: ${title}\n---\n`;
  const prepared = heading + body.join('\n');
  // The engine reads settings from any block at the start of the text that matches its own frontmatter pattern. Run
  // that pattern on the text built here and refuse unless what it finds is the title block written above, so no
  // reading of the pasted text that differs from the scan's can reach the engine as settings.
  const found = ENGINE_FRONTMATTER.exec(prepared);
  if (found !== null && found[0] !== heading) {
    throw new MermaidError(`Line ${first + 1}: ${FRONTMATTER_REFUSED}`, first + 1);
  }
  return { text: prepared, lineOffset: first };
}
