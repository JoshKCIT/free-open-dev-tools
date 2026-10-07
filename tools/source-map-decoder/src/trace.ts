import { MAX_POSITION, MAX_TRACE_LINE_CHARS } from './limits';

/** One stack frame read from a line of a trace. Line and column are one based, as every engine prints them. */
export interface Frame {
  /** `v8` for `at fn (url:line:column)`, `gecko` for `fn@url:line:column` (SpiderMonkey and JavaScriptCore). */
  style: 'v8' | 'gecko';
  /** The white space in front of the frame, kept so the decoded trace has the same shape. */
  indent: string;
  /** True for a V8 frame written `at async fn (...)`. */
  async: boolean;
  /** The function name as the engine printed it, `new` and `[as method]` parts included. May be empty. */
  functionName: string;
  /** The address or file name as printed, without the line and column. */
  url: string;
  line: number;
  column: number;
  /** True when the position is the one the engine gave for the file an `eval at` frame was called from. */
  inEval: boolean;
}

/** One line of the pasted trace. `frame` is null for a line that holds no readable position; it is kept as written. */
export interface TraceLine {
  text: string;
  frame: Frame | null;
}

/** Splits a text into lines at a line feed, a carriage return and line feed, or a lone carriage return. */
function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      lines.push(text.slice(start, i));
      start = i + 1;
    } else if (c === 13) {
      lines.push(text.slice(start, i));
      if (text.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
  }
  lines.push(text.slice(start));
  return lines;
}

/** The numbers an address ends with, written `:line:column`, and where that ending starts; null when there are none. */
function endingNumbers(location: string): { at: number; line: number; column: number } | null {
  let i = location.length;
  const read = (): number | null => {
    const stop = i;
    while (i > 0) {
      const c = location.charCodeAt(i - 1);
      if (c < 48 || c > 57) break;
      i--;
    }
    if (i === stop) return null;
    return stop - i > 15 ? Infinity : Number(location.slice(i, stop));
  };
  const column = read();
  if (column === null || location.charCodeAt(i - 1) !== 58) return null;
  i--;
  const line = read();
  if (line === null || location.charCodeAt(i - 1) !== 58) return null;
  i--;
  if (line < 1 || column < 1) return null;
  return { at: i, line, column };
}

/** The place an `eval at` frame was called from: the address inside the parentheses after the last `eval at `. */
function evalOrigin(location: string): string | null {
  const marker = location.lastIndexOf('eval at ');
  if (marker === -1) return null;
  const open = location.indexOf(' (', marker);
  if (open === -1) return null;
  const close = location.indexOf(')', open + 2);
  return close === -1 ? null : location.slice(open + 2, close);
}

function parseV8(trimmed: string, indent: string): Frame | null {
  let body = trimmed.slice(3);
  let async = false;
  if (body.startsWith('async ')) {
    async = true;
    body = body.slice(6);
  }
  let functionName = '';
  let location = body;
  const open = body.indexOf(' (');
  if (open !== -1 && body.endsWith(')')) {
    functionName = body.slice(0, open);
    location = body.slice(open + 2, body.length - 1);
  }
  let inEval = false;
  if (location.startsWith('eval at ')) {
    const origin = evalOrigin(location);
    if (origin === null) return null;
    location = origin;
    inEval = true;
  }
  const ending = endingNumbers(location);
  if (ending === null) return null;
  return {
    style: 'v8',
    indent,
    async,
    functionName,
    url: location.slice(0, ending.at),
    line: ending.line,
    column: ending.column,
    inEval,
  };
}

function parseGecko(trimmed: string, indent: string): Frame | null {
  const at = trimmed.indexOf('@');
  if (at === -1) return null;
  const location = trimmed.slice(at + 1);
  const ending = endingNumbers(location);
  if (ending === null) return null;
  return {
    style: 'gecko',
    indent,
    async: false,
    functionName: trimmed.slice(0, at),
    url: location.slice(0, ending.at),
    line: ending.line,
    column: ending.column,
    inEval: false,
  };
}

/** Reads one line as a frame, or returns null. The position is the last two numbers of the address. */
export function parseFrame(line: string): Frame | null {
  if (line.length > MAX_TRACE_LINE_CHARS) return null;
  const trimmed = line.trim();
  if (trimmed === '') return null;
  const indent = line.slice(0, line.length - line.trimStart().length);
  return trimmed.startsWith('at ') ? parseV8(trimmed, indent) : parseGecko(trimmed, indent);
}

/**
 * Reads a pasted stack trace line by line. V8 (`at fn (url:1:2)`, `at url:1:2`, `at async fn (...)`, `at new Fn (...)`,
 * `at Type.fn [as name] (...)`, `eval at` frames), SpiderMonkey and JavaScriptCore (`fn@url:1:2`, `@url:1:2`,
 * `global code@url:1:2`) are all read by the last two colon-separated numbers of the address, so Windows paths and
 * `file:///` addresses with colons in them work. A line that holds no readable position (the error message, a native
 * frame, a text line) is kept in place, unchanged, with `frame` null.
 */
export function parseTrace(text: string): TraceLine[] {
  const out: TraceLine[] = [];
  for (const line of splitLines(text)) out.push({ text: line, frame: parseFrame(line) });
  return out;
}

/** True when a frame's position is too big for the format to hold. */
export function isOutOfRange(frame: Frame): boolean {
  return frame.line > MAX_POSITION + 1 || frame.column > MAX_POSITION + 1;
}
