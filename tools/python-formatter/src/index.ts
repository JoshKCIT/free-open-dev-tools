import meta from './meta.json';
// The `/web` entry is the only one that works the same in a browser worker and in Node: it never fetches
// the WebAssembly and never touches the file system, it only accepts bytes handed to `initSync`. The
// default entry uses source-phase imports a bundler cannot parse, and the `/vite` entry would fetch the
// binary at run time, which this site never does.
import { initSync, format as engineFormat } from '@wasm-fmt/ruff_fmt/web';

export { meta };

/**
 * Thrown for every way a format can fail. `line` and `column` (both 1-based) are set together when the
 * engine located a syntax error, and are both absent otherwise.
 */
export class PythonFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'PythonFormatterError';
    if (typeof detail.line === 'number' && typeof detail.column === 'number') {
      this.line = detail.line;
      this.column = detail.column;
    }
  }
}

export interface FormatPythonOptions {
  /** The preferred line width at which lines are wrapped, 1 to 65535. Ruff's own default is 88. */
  lineLength: number;
  /** Quote style for strings: `preserve` keeps each string's own quotes. Ruff's own default is `double`. */
  quoteStyle: 'double' | 'single' | 'preserve';
  /** Indent with spaces or with tabs. Ruff's own default is spaces. */
  indentStyle: 'space' | 'tab';
  /** Spaces per indent level (and the visual width of a tab), 1 to 255. Ruff's own default is 4. */
  indentWidth: number;
}

export interface FormatPythonResult {
  output: string;
  inputBytes: number;
  outputBytes: number;
}

const DEFAULT_OPTIONS: FormatPythonOptions = {
  lineLength: 88,
  quoteStyle: 'double',
  indentStyle: 'space',
  indentWidth: 4,
};

// Ruff's settings schema (ruff.schema.json at tag 0.15.20): LineLength is an unsigned 16 bit integer of at
// least 1, IndentWidth an unsigned 8 bit integer of at least 1.
const LINE_LENGTH_MAX = 65535;
const INDENT_WIDTH_MAX = 255;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Hands the Ruff WebAssembly bytes (or an already compiled module) to the engine. The engine keeps the
 * first instance it is given, so calling this again is harmless.
 */
export function loadEngine(wasm: BufferSource | WebAssembly.Module): void {
  initSync(wasm);
}

const TOO_LARGE_MESSAGE = 'This input is too large or too deeply nested for the formatter.';
const FAILED_MESSAGE = 'The formatter failed on this input.';

/** Checks every option before the engine runs, naming the field exactly as the page labels it. */
function validate(options: FormatPythonOptions): void {
  if (!Number.isInteger(options.lineLength) || options.lineLength < 1 || options.lineLength > LINE_LENGTH_MAX) {
    throw new PythonFormatterError(`Line length must be a whole number from 1 to ${LINE_LENGTH_MAX}.`);
  }
  if (!Number.isInteger(options.indentWidth) || options.indentWidth < 1 || options.indentWidth > INDENT_WIDTH_MAX) {
    throw new PythonFormatterError(`Indent width must be a whole number from 1 to ${INDENT_WIDTH_MAX}.`);
  }
  if (options.quoteStyle !== 'double' && options.quoteStyle !== 'single' && options.quoteStyle !== 'preserve') {
    throw new PythonFormatterError('Quote style must be double, single or preserve.');
  }
  if (options.indentStyle !== 'space' && options.indentStyle !== 'tab') {
    throw new PythonFormatterError('Indent with must be spaces or tabs.');
  }
}

/**
 * Maps everything the engine can throw to one PythonFormatterError. Ruff throws a plain string, not an
 * Error; a stack overflow or a WebAssembly trap on a pathologically deep input arrives as a RangeError or a
 * WebAssembly.RuntimeError.
 */
function describeEngineFailure(err: unknown): PythonFormatterError {
  if (err instanceof RangeError || (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError)) {
    return new PythonFormatterError(TOO_LARGE_MESSAGE);
  }
  const message = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  if (message.trim() === '') return new PythonFormatterError(FAILED_MESSAGE);
  return new PythonFormatterError(message);
}

/**
 * Formats Python source with the Ruff formatter. Returns `null` for blank or whitespace-only source without
 * calling the engine. Throws `PythonFormatterError` for every failure and never returns partly formatted
 * code. `loadEngine` must have been called first.
 */
export function formatPython(source: string, options: Partial<FormatPythonOptions> = {}): FormatPythonResult | null {
  const chosen: FormatPythonOptions = { ...DEFAULT_OPTIONS, ...options };
  validate(chosen);
  if (source.trim() === '') return null;

  let output: string;
  try {
    output = engineFormat(source, 'input.py', {
      line_width: chosen.lineLength,
      quote_style: chosen.quoteStyle,
      indent_style: chosen.indentStyle,
      indent_width: chosen.indentWidth,
    });
  } catch (err) {
    throw describeEngineFailure(err);
  }

  return { output, inputBytes: byteLength(source), outputBytes: byteLength(output) };
}
