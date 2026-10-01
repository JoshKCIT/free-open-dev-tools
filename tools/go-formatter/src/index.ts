import meta from './meta.json';
// The `/web` entry is the only one that works the same in a browser worker and in Node: it never fetches
// the WebAssembly and never touches the file system, it only accepts bytes handed to `initSync`. The
// default entry uses source-phase imports a bundler cannot parse, and the `/vite` entry would fetch the
// binary at run time, which this site never does.
import { initSync, format as engineFormat } from '@wasm-fmt/gofmt/web';

export { meta };

/**
 * Thrown for every way a format can fail. `line` and `column` (both 1-based) are set together when the
 * engine located a syntax error, and are both absent otherwise.
 */
export class GoFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'GoFormatterError';
    if (typeof detail.line === 'number' && typeof detail.column === 'number') {
      this.line = detail.line;
      this.column = detail.column;
    }
  }
}

export interface FormatGoResult {
  output: string;
  inputBytes: number;
  outputBytes: number;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Hands the gofmt WebAssembly bytes (or an already compiled module) to the engine. The engine keeps the
 * first instance it is given, so calling this again is harmless.
 */
export function loadEngine(wasm: BufferSource | WebAssembly.Module): void {
  initSync(wasm);
}

const TOO_LARGE_MESSAGE = 'This input is too large or too deeply nested for the formatter.';
const FAILED_MESSAGE = 'The formatter failed on this input.';

/**
 * Turns the byte column gofmt reports into the column a visitor sees: the number of characters (Unicode code
 * points, so an emoji counts once) before that byte on the reported line, plus one. gofmt counts lines by the
 * newline character only, and counts columns in bytes of the UTF-8 text.
 */
function characterColumn(source: string, line: number, byteColumn: number): number {
  const lineText = source.split('\n')[line - 1];
  if (lineText === undefined) return byteColumn;
  const bytes = new TextEncoder().encode(lineText);
  const before = new TextDecoder().decode(bytes.subarray(0, Math.max(0, byteColumn - 1)));
  return Array.from(before).length + 1;
}

/**
 * Maps everything the engine can throw to one GoFormatterError. A syntax error arrives as an Error whose
 * message starts with line:column: (the Go parser's own text, possibly ending with how many more errors there
 * are); a stack overflow or a WebAssembly trap on a pathologically deep input arrives as a RangeError or a
 * WebAssembly.RuntimeError; anything else keeps its own message, or gets a plain one when it has none.
 */
function describeEngineFailure(err: unknown, source: string): GoFormatterError {
  if (err instanceof RangeError || (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError)) {
    return new GoFormatterError(TOO_LARGE_MESSAGE);
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (message.trim() === '') return new GoFormatterError(FAILED_MESSAGE);

  const positioned = /^(\d+):(\d+): (.*)$/s.exec(message);
  if (positioned) {
    const line = Number(positioned[1]);
    const byteColumn = Number(positioned[2]);
    const text = (positioned[3] ?? '').split('\n')[0] ?? '';
    return new GoFormatterError(text, { line, column: characterColumn(source, line, byteColumn) });
  }
  return new GoFormatterError(message);
}

/**
 * Formats Go source exactly as the gofmt command does with no flags. Returns `null` for blank or
 * whitespace-only source without calling the engine. Throws `GoFormatterError` for every engine failure
 * and never returns partly formatted code. `loadEngine` must have been called first.
 */
export function formatGo(source: string): FormatGoResult | null {
  if (source.trim() === '') return null;

  let output: string;
  try {
    output = engineFormat(source);
  } catch (err) {
    throw describeEngineFailure(err, source);
  }

  return { output, inputBytes: byteLength(source), outputBytes: byteLength(output) };
}
