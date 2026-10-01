import meta from './meta.json';
// The `/web` entry is the only one that works the same in a browser worker and in Node: it never fetches
// the WebAssembly and never touches the file system, it only accepts bytes handed to `initSync`. The
// default entry would also work in Node but not in a bundled worker, and the `/vite` entry would fetch the
// binary at run time, which this site never does.
import { initSync, format as engineFormat } from '@wasm-fmt/dart_fmt/web';

export { meta };

/**
 * Thrown for every way a format can fail. `line` and `column` (both 1-based) are set together when the
 * engine located a syntax error, and are both absent otherwise.
 */
export class DartFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'DartFormatterError';
    if (typeof detail.line === 'number' && typeof detail.column === 'number') {
      this.line = detail.line;
      this.column = detail.column;
    }
  }
}

export interface FormatDartOptions {
  /** The preferred line width, a whole number from 1 to 1000. dart_style's own default is 80. */
  lineWidth: number;
}

export interface FormatDartResult {
  output: string;
  inputBytes: number;
  outputBytes: number;
}

const DEFAULT_OPTIONS: FormatDartOptions = { lineWidth: 80 };

const LINE_WIDTH_MIN = 1;
const LINE_WIDTH_MAX = 1000;

// The engine decides the language from nothing but this name, and prints it inside error positions.
const FILE_NAME = 'input.dart';

const NO_GARBAGE_COLLECTION_MESSAGE =
  'This browser cannot run the Dart formatter (it needs WebAssembly garbage collection).';
const TOO_LARGE_MESSAGE = 'This input is too large or too deeply nested for the formatter.';
const FAILED_MESSAGE = 'The formatter failed on this input.';

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Hands the dart_fmt WebAssembly bytes (or an already compiled module) to the engine. The engine keeps the
 * first instance it is given, so calling this again is harmless. The engine is compiled by dart2wasm and needs
 * WebAssembly garbage collection: where that is missing the module cannot be compiled, which surfaces as a
 * WebAssembly.CompileError and becomes a plain message here.
 */
export function loadEngine(wasm: BufferSource | WebAssembly.Module): void {
  try {
    initSync(wasm);
  } catch (err) {
    if (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.CompileError) {
      throw new DartFormatterError(NO_GARBAGE_COLLECTION_MESSAGE);
    }
    throw err;
  }
}

/** Checks every option before the engine runs, naming the field exactly as the page labels it. */
function validate(options: FormatDartOptions): void {
  const width = options.lineWidth;
  if (!Number.isInteger(width) || width < LINE_WIDTH_MIN || width > LINE_WIDTH_MAX) {
    throw new DartFormatterError(`Line width must be a whole number from ${LINE_WIDTH_MIN} to ${LINE_WIDTH_MAX}.`);
  }
}

/**
 * Turns the column dart_style reports into the column a visitor sees: the number of characters (Unicode code
 * points, so an emoji counts once) before that position on the reported line, plus one. dart_style counts lines
 * by `\n`, `\r\n` and a lone `\r`, and counts columns in UTF-16 code units, which is what a JavaScript string
 * slices by.
 */
function characterColumn(source: string, line: number, unitColumn: number): number {
  const lineText = source.split(/\r\n|\r|\n/)[line - 1];
  if (lineText === undefined) return unitColumn;
  const before = lineText.slice(0, Math.max(0, unitColumn - 1));
  return Array.from(before).length + 1;
}

/**
 * Maps everything the engine can throw to one DartFormatterError. A syntax error arrives as an Error whose message
 * is a heading followed by one block per error, each starting `line <n>, column <m> of <file name>: <text>`; the
 * first block is reported. A stack overflow on a pathologically deep input arrives as a RangeError (a WebAssembly
 * trap as a WebAssembly.RuntimeError); anything else keeps its own first line, or gets a plain message when it
 * has none.
 */
function describeEngineFailure(err: unknown, source: string): DartFormatterError {
  if (err instanceof RangeError || (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError)) {
    return new DartFormatterError(TOO_LARGE_MESSAGE);
  }
  const message = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  if (message.trim() === '') return new DartFormatterError(FAILED_MESSAGE);

  const positioned = /line (\d+), column (\d+) of input\.dart: ([^\n]*)/.exec(message);
  if (positioned) {
    const line = Number(positioned[1]);
    const unitColumn = Number(positioned[2]);
    return new DartFormatterError(positioned[3] ?? '', { line, column: characterColumn(source, line, unitColumn) });
  }
  return new DartFormatterError(message.split('\n').find((l) => l.trim() !== '') ?? FAILED_MESSAGE);
}

/**
 * Formats Dart source with dart_style at the chosen line width. Returns `null` for blank or whitespace-only
 * source without calling the engine. Throws `DartFormatterError` for every failure and never returns partly
 * formatted code. `loadEngine` must have been called first.
 */
export function formatDart(source: string, options: Partial<FormatDartOptions> = {}): FormatDartResult | null {
  const chosen: FormatDartOptions = { ...DEFAULT_OPTIONS, ...options };
  validate(chosen);
  if (source.trim() === '') return null;

  let output: string;
  try {
    output = engineFormat(source, FILE_NAME, { line_width: chosen.lineWidth });
  } catch (err) {
    throw describeEngineFailure(err, source);
  }

  return { output, inputBytes: byteLength(source), outputBytes: byteLength(output) };
}
