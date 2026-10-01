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

  constructor(message: string, detail: { line?: number; column?: number; cause?: unknown } = {}) {
    super(message, detail.cause === undefined ? undefined : { cause: detail.cause });
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
// What the engine's own compile error says when the cause is a missing WebAssembly feature (garbage collection and the
// struct, array and reference types it adds).
const MISSING_FEATURE_TEXT = /garbage|\bgc\b|struct|array|\bref\b|reference|heap type/i;
const TOO_LARGE_MESSAGE = 'This input is too large or too deeply nested for the formatter.';
const FAILED_MESSAGE = 'The formatter failed on this input.';

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// Bytes already compiled and handed to the engine: giving the same bytes again compiles nothing.
const loadedInputs = new WeakSet<object>();

/**
 * Hands the dart_fmt WebAssembly bytes (or an already compiled module) to the engine. The engine keeps the
 * first instance it is given, so calling this again is harmless, and calling it again with the very same bytes
 * does not even compile them again. The engine is compiled by dart2wasm and needs WebAssembly garbage collection:
 * where that is missing the module cannot be compiled, which surfaces as a WebAssembly.CompileError. When the
 * engine's text names a missing feature that becomes a plain message here (the engine's own error stays the
 * `cause`); any other compile failure, such as a corrupt file, keeps the engine's text in the message.
 *
 * Bytes are compiled here with no `builtins` option, so every `wasm:js-string` helper the module imports comes
 * from the package's own JavaScript. The package's own load asks for the engine's built-in string helpers, and
 * with those Node 22.23 and Node 24 trap on every format ("illegal cast" inside `length`). A module passed in
 * must likewise be compiled with no `builtins` option.
 */
export function loadEngine(wasm: BufferSource | WebAssembly.Module): void {
  if (typeof wasm === 'object' && wasm !== null && loadedInputs.has(wasm)) return;
  try {
    initSync(wasm instanceof WebAssembly.Module ? wasm : new WebAssembly.Module(wasm));
    if (typeof wasm === 'object' && wasm !== null) loadedInputs.add(wasm);
  } catch (err) {
    if (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.CompileError) {
      throw new DartFormatterError(
        MISSING_FEATURE_TEXT.test(err.message)
          ? NO_GARBAGE_COLLECTION_MESSAGE
          : `The Dart formatter engine could not be loaded: ${err.message} (a browser without WebAssembly garbage collection cannot run it).`,
        { cause: err },
      );
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

/** Drops options set to `undefined`, so an option that was not chosen keeps its default instead of replacing it. */
function withoutUndefined<T extends object>(options: T): Partial<T> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/**
 * Formats Dart source with dart_style at the chosen line width. Returns `null` for blank or whitespace-only
 * source without calling the engine. Throws `DartFormatterError` for every failure and never returns partly
 * formatted code. `loadEngine` must have been called first.
 */
export function formatDart(source: string, options: Partial<FormatDartOptions> = {}): FormatDartResult | null {
  const chosen: FormatDartOptions = { ...DEFAULT_OPTIONS, ...withoutUndefined(options) };
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
