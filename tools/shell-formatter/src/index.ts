import meta from './meta.json';
// The `/web` entry is the only one that works the same in a browser worker and in Node: it never fetches
// the WebAssembly and never touches the file system, it only accepts bytes handed to `initSync`. The
// default entry uses source-phase imports a bundler cannot parse, and the `/vite` entry would fetch the
// binary at run time, which this site never does.
import { initSync, format as engineFormat } from '@wasm-fmt/shfmt/web';

export { meta };

/**
 * The three dialects a script can be read as. The engine build picks the dialect from the file name it is
 * given (see FILE_NAMES). It cannot parse in POSIX mode, so `posix` formats exactly as `bash` does and bash-only
 * syntax is not refused under it; `mksh` is the only choice that accepts mksh-only syntax such as a coprocess.
 */
export const SHELL_DIALECTS = ['posix', 'bash', 'mksh'] as const;

export type ShellDialect = (typeof SHELL_DIALECTS)[number];

// The file name carries the dialect: a `.bash` name selects bash and a `.mksh` name selects mksh. A `.sh` name
// selects POSIX, which the engine build skips, so it then reads the first line of the script (a `#!/bin/mksh`
// line selects mksh) and otherwise falls back to bash. The name has no colon, so error text can be split on it.
const FILE_NAMES: Record<ShellDialect, string> = {
  posix: 'input.sh',
  bash: 'input.bash',
  mksh: 'input.mksh',
};

/**
 * Thrown for every way a format can fail. `line` and `column` (both 1-based) are set together when the
 * engine located a syntax error, and are both absent otherwise.
 */
export class ShellFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'ShellFormatterError';
    if (typeof detail.line === 'number' && typeof detail.column === 'number') {
      this.line = detail.line;
      this.column = detail.column;
    }
  }
}

export interface FormatShellOptions {
  /** Which shell the script is read as. The engine's own fallback is `bash`. */
  dialect: ShellDialect;
  /** Spaces per indent level, 1 to 16, or 0 for tabs, which is what the engine does by default. */
  indent: number;
}

export interface FormatShellResult {
  output: string;
  inputBytes: number;
  outputBytes: number;
}

const DEFAULT_OPTIONS: FormatShellOptions = { dialect: 'bash', indent: 0 };

const INDENT_MAX = 16;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Hands the shfmt WebAssembly bytes (or an already compiled module) to the engine. The engine keeps the
 * first instance it is given, so calling this again is harmless.
 */
export function loadEngine(wasm: BufferSource | WebAssembly.Module): void {
  initSync(wasm);
}

const TOO_LARGE_MESSAGE = 'This input is too large or too deeply nested for the formatter.';
const STOPPED_MESSAGE =
  'The shell formatter engine stopped after an earlier input that was too large or too deeply nested. Load the engine again in a new worker or process to format more.';
const FAILED_MESSAGE = 'The formatter failed on this input.';

// One stack overflow or WebAssembly trap leaves the shfmt instance broken for good: every later call traps too, even
// on a valid script, and the package offers no way to start a new instance. So the first trap is remembered here and
// every later call says so, instead of blaming that input for being too large. Reloading this module (a new worker or
// process) starts clean. After a trap one tiny valid script is run to see whether the instance really is broken, so a
// failure that leaves the engine usable (an engine that is wrapped, or a different build) is not remembered.
let engineStopped = false;

function engineStillWorks(): boolean {
  try {
    engineFormat('echo hi\n', FILE_NAMES.bash, {});
    return true;
  } catch {
    return false;
  }
}

/** Checks every option before the engine runs, naming the field exactly as the page labels it. */
function validate(options: FormatShellOptions): void {
  if (!SHELL_DIALECTS.includes(options.dialect)) {
    throw new ShellFormatterError('Dialect must be POSIX sh, bash or mksh.');
  }
  if (!Number.isInteger(options.indent) || options.indent < 0 || options.indent > INDENT_MAX) {
    throw new ShellFormatterError(`Indent must be a whole number from 0 to ${INDENT_MAX}.`);
  }
}

/**
 * Turns the byte column shfmt reports into the column a visitor sees: the number of characters (Unicode code
 * points, so an emoji counts once) before that byte on the reported line, plus one. shfmt counts lines by the
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
 * Maps everything the engine can throw to one ShellFormatterError. A syntax error arrives as an Error whose
 * message is `<file name>:<line>:<column>: <text>`; a stack overflow or a WebAssembly trap on a pathologically
 * deep input arrives as a RangeError or a WebAssembly.RuntimeError; anything else keeps its own message, or gets
 * a plain one when it has none.
 */
function describeEngineFailure(err: unknown, source: string): ShellFormatterError {
  if (err instanceof RangeError || (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError)) {
    if (!engineStillWorks()) engineStopped = true;
    return new ShellFormatterError(TOO_LARGE_MESSAGE);
  }
  const message = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  if (message.trim() === '') return new ShellFormatterError(FAILED_MESSAGE);

  const positioned = /^[^:\n]*:(\d+):(\d+): (.*)$/s.exec(message);
  if (positioned) {
    const line = Number(positioned[1]);
    const byteColumn = Number(positioned[2]);
    const text = (positioned[3] ?? '').split('\n')[0] ?? '';
    return new ShellFormatterError(text, { line, column: characterColumn(source, line, byteColumn) });
  }
  return new ShellFormatterError(message);
}

/** Drops options set to `undefined`, so an option that was not chosen keeps its default instead of replacing it. */
function withoutUndefined<T extends object>(options: T): Partial<T> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/**
 * Formats a shell script with shfmt, reading it as the chosen dialect. Returns `null` for blank or
 * whitespace-only source without calling the engine. Throws `ShellFormatterError` for every failure and never
 * returns partly formatted code. `loadEngine` must have been called first. After one input that was too large or too
 * deeply nested the engine is broken for the rest of the process, so every later call throws a ShellFormatterError
 * saying it must be loaded again in a new worker or process.
 */
export function formatShell(source: string, options: Partial<FormatShellOptions> = {}): FormatShellResult | null {
  const chosen: FormatShellOptions = { ...DEFAULT_OPTIONS, ...withoutUndefined(options) };
  validate(chosen);
  if (source.trim() === '') return null;
  if (engineStopped) throw new ShellFormatterError(STOPPED_MESSAGE);

  let output: string;
  try {
    // An indent of 0 sends no indent, so the engine prints its default: tabs.
    output = engineFormat(source, FILE_NAMES[chosen.dialect], chosen.indent > 0 ? { indent: chosen.indent } : {});
  } catch (err) {
    throw describeEngineFailure(err, source);
  }

  return { output, inputBytes: byteLength(source), outputBytes: byteLength(output) };
}
