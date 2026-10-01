import meta from './meta.json';
// The `/web` entry is the only one that works the same in a browser worker and in Node: it never fetches
// the WebAssembly and never touches the file system, it only accepts bytes handed to `initSync`. The
// default entry uses source-phase imports a bundler cannot parse, and the `/vite` entry would fetch the
// binary at run time, which this site never does.
import { initSync, format as engineFormat } from '@wasm-fmt/clang-format/web';

export { meta };

/**
 * The six languages. The engine picks the language from the file name it is given, so each choice carries the
 * name that selects it (Java's has a capital letter, the others are lower case).
 */
export const C_FAMILY_LANGUAGES = [
  { value: 'c', fileName: 'input.c' },
  { value: 'cpp', fileName: 'input.cpp' },
  { value: 'csharp', fileName: 'input.cs' },
  { value: 'java', fileName: 'Input.java' },
  { value: 'objc', fileName: 'input.m' },
  { value: 'proto', fileName: 'input.proto' },
] as const;

export type CFamilyLanguage = (typeof C_FAMILY_LANGUAGES)[number]['value'];

/** The seven named presets clang-format ships, each with its own indent width and column limit. */
export const C_FAMILY_PRESETS = ['LLVM', 'Google', 'Chromium', 'Mozilla', 'WebKit', 'Microsoft', 'GNU'] as const;

export type CFamilyPreset = (typeof C_FAMILY_PRESETS)[number];

const INDENT_WIDTH_MIN = 1;
const INDENT_WIDTH_MAX = 16;

/**
 * Thrown for every way a format can fail. clang-format reports no syntax errors, so `line` and `column` are
 * never set today; the fields exist so every formatter's error has the same shape.
 */
export class CFamilyFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'CFamilyFormatterError';
    if (typeof detail.line === 'number' && typeof detail.column === 'number') {
      this.line = detail.line;
      this.column = detail.column;
    }
  }
}

export interface FormatCFamilyOptions {
  /** Which language the source is read as. */
  language: CFamilyLanguage;
  /** The named style preset. */
  preset: CFamilyPreset;
  /** Spaces per indent level, 1 to 16, replacing the preset's own width. Leave out to keep the preset's width. */
  indentWidth?: number;
}

export interface FormatCFamilyResult {
  output: string;
  inputBytes: number;
  outputBytes: number;
}

const DEFAULT_OPTIONS: FormatCFamilyOptions = { language: 'cpp', preset: 'LLVM' };

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Hands the clang-format WebAssembly bytes (or an already compiled module) to the engine. The engine keeps the
 * first instance it is given, so calling this again is harmless.
 */
export function loadEngine(wasm: BufferSource | WebAssembly.Module): void {
  initSync(wasm);
}

/**
 * The style string the engine reads: a preset name alone, or that preset with an indent width. It is built only
 * from a name in C_FAMILY_PRESETS and a whole number, never from text a visitor typed, because the engine parses
 * a string that starts with a brace as a configuration file.
 */
export function styleFor(preset: CFamilyPreset, indentWidth?: number): string {
  return indentWidth === undefined ? preset : `{BasedOnStyle: ${preset}, IndentWidth: ${indentWidth}}`;
}

const TOO_LARGE_MESSAGE = 'This input is too large or too deeply nested for the formatter.';
const STOPPED_MESSAGE =
  'The C-family formatter engine stopped after an earlier input that was too large or too deeply nested. Load the engine again in a new worker or process to format more.';
const FAILED_MESSAGE = 'The formatter failed on this input.';

// One stack overflow or WebAssembly trap leaves the clang-format instance broken for good: every later call traps
// too, even on a valid program, and the package offers no way to start a new instance. So the first trap is
// remembered here and every later call says so, instead of blaming that input for being too large. Reloading this
// module (a new worker or process) starts clean. After a trap one tiny valid program is run to see whether the instance
// really is broken, so a failure that leaves the engine usable (an engine that is wrapped, or a different build) is not
// remembered.
let engineStopped = false;

function engineStillWorks(): boolean {
  try {
    engineFormat('int x;\n', 'input.cpp', 'LLVM');
    return true;
  } catch {
    return false;
  }
}

/** Checks every option before the engine runs, naming the field exactly as the page labels it. */
function validate(options: FormatCFamilyOptions): void {
  if (!C_FAMILY_LANGUAGES.some((l) => l.value === options.language)) {
    throw new CFamilyFormatterError('Language must be C, C++, C#, Java, Objective-C or Protocol Buffers.');
  }
  if (!C_FAMILY_PRESETS.includes(options.preset)) {
    throw new CFamilyFormatterError('Style preset must be LLVM, Google, Chromium, Mozilla, WebKit, Microsoft or GNU.');
  }
  const width = options.indentWidth;
  if (width !== undefined && (!Number.isInteger(width) || width < INDENT_WIDTH_MIN || width > INDENT_WIDTH_MAX)) {
    throw new CFamilyFormatterError(
      `Indent width must be a whole number from ${INDENT_WIDTH_MIN} to ${INDENT_WIDTH_MAX}.`,
    );
  }
}

/**
 * Maps everything the engine can throw to one CFamilyFormatterError. The engine reports no syntax errors, so
 * what is left is a stack overflow or a WebAssembly trap on a pathologically deep input (a RangeError or a
 * WebAssembly.RuntimeError); anything else keeps its own message, or gets a plain one when it has none.
 */
function describeEngineFailure(err: unknown): CFamilyFormatterError {
  if (err instanceof RangeError || (typeof WebAssembly !== 'undefined' && err instanceof WebAssembly.RuntimeError)) {
    if (!engineStillWorks()) engineStopped = true;
    return new CFamilyFormatterError(TOO_LARGE_MESSAGE);
  }
  const message = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  return new CFamilyFormatterError(message.trim() === '' ? FAILED_MESSAGE : message);
}

/**
 * Formats source with clang-format, reading it as the chosen language under the chosen preset. Returns `null`
 * for blank or whitespace-only source without calling the engine. Throws `CFamilyFormatterError` for every
 * failure and never returns partly formatted code. `loadEngine` must have been called first. After one input that
 * was too large or too deeply nested the engine is broken for the rest of the process, so every later call throws a
 * CFamilyFormatterError saying it must be loaded again in a new worker or process.
 */
export function formatCFamily(source: string, options: Partial<FormatCFamilyOptions> = {}): FormatCFamilyResult | null {
  const chosen: FormatCFamilyOptions = { ...DEFAULT_OPTIONS, ...options };
  validate(chosen);
  if (source.trim() === '') return null;
  if (engineStopped) throw new CFamilyFormatterError(STOPPED_MESSAGE);

  const language = C_FAMILY_LANGUAGES.find((l) => l.value === chosen.language);
  let output: string;
  try {
    output = engineFormat(source, language?.fileName, styleFor(chosen.preset, chosen.indentWidth));
  } catch (err) {
    throw describeEngineFailure(err);
  }

  return { output, inputBytes: byteLength(source), outputBytes: byteLength(output) };
}
