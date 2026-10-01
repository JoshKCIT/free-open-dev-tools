import meta from './meta.json';
// Only the two browser-safe entries: `prettier/standalone` (no Node APIs) and the plugin's own `standalone`
// entry, as its `exports` map names it. The plugin's Node entry would read files and the working directory,
// which a browser worker does not have.
import * as prettier from 'prettier/standalone';
import phpPlugin from '@prettier/plugin-php/standalone';

export { meta };

/**
 * Thrown for every way a format can fail. `line` and `column` (both 1-based) are set together when the parser
 * located a syntax error, and are both absent otherwise.
 */
export class PhpFormatterError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'PhpFormatterError';
    if (typeof detail.line === 'number' && typeof detail.column === 'number') {
      this.line = detail.line;
      this.column = detail.column;
    }
  }
}

/**
 * Every PHP version the plugin accepts as a concrete target, read from the plugin's own option declaration when
 * this module loads, never typed by hand. The plugin also lists `auto` and `composer`; both read the file system
 * (the working directory and composer.json) and cannot run in a browser, so they are left out and refused.
 */
export const PHP_VERSIONS: readonly string[] = readPhpVersions();

function readPhpVersions(): string[] {
  const option = phpPlugin.options?.phpVersion;
  const choices = option && option.type === 'choice' ? option.choices : [];
  const versions: string[] = [];
  for (const choice of choices) {
    if (typeof choice.value === 'string' && choice.value !== 'auto' && choice.value !== 'composer') {
      versions.push(choice.value);
    }
  }
  return versions;
}

export type PhpBraceStyle = 'per-cs' | '1tbs';

export interface FormatPhpOptions {
  /** A whole number from 20 to 200. Default 80. */
  printWidth: number;
  /** A whole number from 1 to 16. Default 4, the plugin's own default. */
  tabWidth: number;
  /** Indent with tabs instead of spaces. Default false. */
  useTabs: boolean;
  /** Prefer single quotes. Default false. */
  singleQuote: boolean;
  /** Trailing commas in multi-line arrays and argument lists. Default true. */
  trailingCommaPHP: boolean;
  /** Default `per-cs`. The deprecated `psr-2` value is not offered. */
  braceStyle: PhpBraceStyle;
  /** One of PHP_VERSIONS. Default 8.5, the newest the plugin lists. */
  phpVersion: string;
}

export interface FormatPhpResult {
  output: string;
  inputBytes: number;
  outputBytes: number;
}

const DEFAULT_OPTIONS: FormatPhpOptions = {
  printWidth: 80,
  tabWidth: 4,
  useTabs: false,
  singleQuote: false,
  trailingCommaPHP: true,
  braceStyle: 'per-cs',
  phpVersion: '8.5',
};

const PRINT_WIDTH_MIN = 20;
const PRINT_WIDTH_MAX = 200;
const TAB_WIDTH_MIN = 1;
const TAB_WIDTH_MAX = 16;

const FAILED_MESSAGE = 'The formatter failed on this input.';

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function isWholeNumberIn(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Checks every option before Prettier runs, naming the field exactly as the page labels it. */
function validate(options: FormatPhpOptions): void {
  if (!isWholeNumberIn(options.printWidth, PRINT_WIDTH_MIN, PRINT_WIDTH_MAX)) {
    throw new PhpFormatterError(`Print width must be a whole number from ${PRINT_WIDTH_MIN} to ${PRINT_WIDTH_MAX}.`);
  }
  if (!isWholeNumberIn(options.tabWidth, TAB_WIDTH_MIN, TAB_WIDTH_MAX)) {
    throw new PhpFormatterError(`Indent width must be a whole number from ${TAB_WIDTH_MIN} to ${TAB_WIDTH_MAX}.`);
  }
  if (options.braceStyle !== 'per-cs' && options.braceStyle !== '1tbs') {
    throw new PhpFormatterError('Brace style must be per-cs or 1tbs.');
  }
  if (typeof options.phpVersion !== 'string' || !PHP_VERSIONS.includes(options.phpVersion)) {
    const first = PHP_VERSIONS[0] ?? '';
    const last = PHP_VERSIONS[PHP_VERSIONS.length - 1] ?? '';
    throw new PhpFormatterError(
      `PHP version must be one of the versions from ${first} to ${last} (for example ${last}); automatic detection is not available in a browser.`,
    );
  }
}

/**
 * Formats PHP source with Prettier and the PHP plugin. Returns `null` for blank or whitespace-only source without
 * calling Prettier. Throws `PhpFormatterError` for every failure and never returns partly formatted code. The PHP
 * version is always passed explicitly: the plugin's own default reads the file system.
 */
export async function formatPhp(
  source: string,
  options: Partial<FormatPhpOptions> = {},
): Promise<FormatPhpResult | null> {
  const chosen: FormatPhpOptions = { ...DEFAULT_OPTIONS, ...options };
  validate(chosen);
  if (source.trim() === '') return null;

  let output: string;
  try {
    output = await prettier.format(source, {
      parser: 'php',
      plugins: [phpPlugin],
      printWidth: chosen.printWidth,
      tabWidth: chosen.tabWidth,
      useTabs: chosen.useTabs,
      singleQuote: chosen.singleQuote,
      trailingCommaPHP: chosen.trailingCommaPHP,
      braceStyle: chosen.braceStyle,
      phpVersion: chosen.phpVersion,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
    throw new PhpFormatterError(message.split('\n').find((l) => l.trim() !== '') ?? FAILED_MESSAGE);
  }

  return { output, inputBytes: byteLength(source), outputBytes: byteLength(output) };
}
