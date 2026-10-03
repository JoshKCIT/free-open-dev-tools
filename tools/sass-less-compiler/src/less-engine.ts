import createLess, { type LessEnvironment, type LessInstance, type LessNode } from 'less/lib/less/index.js';
import { StylesheetError, describeEngineMessage, importRefusedError, syntaxError } from './errors';
import { scanAtRule } from './import-scan';
import { positionAt } from './text';

/** The Less version this folder pins. A test compares it with the installed package's own version. */
export const LESS_VERSION = '4.9.1';

export interface LessOutcome {
  css: string;
  warnings: string[];
  engine: string;
}

const COMPILER_FAILED = 'The compiler could not process this stylesheet';

const TOO_DEEP = 'This stylesheet nests or repeats too deeply for the compiler';

/** The error the file manager, the plugin loader and the refused functions give back to Less. Its text is never shown. */
const REFUSAL = { type: 'File', message: 'Imports of other files and addresses are not supported here' };

/** What a Less error carries. `message` can be missing (a stack overflow inside the compiler gives none). */
interface LessFailure {
  type?: unknown;
  message?: unknown;
  line?: unknown;
  column?: unknown;
  index?: unknown;
}

/** One request that reached the file manager, the plugin loader or a refused function. */
interface Asked {
  target: string;
  /** The error object handed back to Less, which Less marks with the import's offset for a non-optional import. */
  error: { index?: unknown };
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/**
 * Builds Less from its core factory, `less/lib/less/index.js`, not from the package's stock entry points. Those carry
 * file managers that read the disk and fetch addresses and, in the browser build, need a window and a document, so no
 * configuration of them can promise that nothing is read or fetched. The core factory carries no file reading and no
 * network code at all: every file manager is one the caller passes in, and here there is exactly one, which writes down
 * what it was asked for and refuses. The plugin loader does the same, inline JavaScript is off, and the functions that
 * read an image's size are replaced by refusals (the core factory does not define them).
 *
 * A new instance is built for each compile, so the requests written down belong to that compile only.
 */
function buildLess(asked: Asked[]): LessInstance {
  const environment: LessEnvironment = {
    encodeBase64,
    mimeLookup: () => 'application/octet-stream',
    charsetLookup: () => 'UTF-8',
    getSourceMapGenerator: () => class {},
  };
  const base = createLess(environment, [], LESS_VERSION);

  const refuse = (target: string): { index?: unknown } => {
    const error = { ...REFUSAL } as { index?: unknown };
    asked.push({ target, error });
    return error;
  };

  class RefusingFileManager extends base.AbstractFileManager {
    supports(): boolean {
      return true;
    }
    supportsSync(): boolean {
      return true;
    }
    loadFile(filename: string): Promise<never> {
      return Promise.reject(refuse(filename));
    }
    loadFileSync(filename: string): never {
      throw refuse(filename);
    }
  }

  const less = createLess(environment, [new RefusingFileManager()], LESS_VERSION);

  class RefusingPluginLoader extends less.AbstractPluginLoader {
    less: LessInstance;
    // Less reads this member as the way a plugin gets at other modules; here there are none, so it answers nothing.
    readonly require = (): null => null;
    constructor(owner: LessInstance) {
      super();
      this.less = owner;
    }
    loadPlugin(filename: string): Promise<never> {
      return Promise.reject(refuse(filename));
    }
  }
  less.PluginLoader = RefusingPluginLoader;
  less.FileManager = RefusingFileManager;

  for (const name of ['image-size', 'image-width', 'image-height']) {
    less.functions.functionRegistry.add(name, (first?: LessNode) => {
      const named = first?.value;
      throw refuse(typeof named === 'string' ? named : '');
    });
  }
  return less;
}

/**
 * The text Less actually parses: every line end a line feed and no leading byte order mark. Less reports offsets into
 * this text, so positions are worked out on it.
 */
function parsedText(source: string): string {
  const lineFeeds = source.replace(/\r\n?/g, '\n');
  return lineFeeds.charCodeAt(0) === 0xfeff ? lineFeeds.slice(1) : lineFeeds;
}

/** The offset of the import a refusal was for, from Less's error or from the error objects the loaders handed back. */
function refusedOffset(failure: LessFailure | undefined, asked: Asked[]): number | undefined {
  if (typeof failure?.index === 'number') return failure.index;
  for (const entry of asked) if (typeof entry.error.index === 'number') return entry.error.index;
  return undefined;
}

/**
 * Compiles Less. Any request that reaches the file manager, the plugin loader or a refused function is a refusal, even
 * when Less carries on without the file (an optional import, a `data-uri` that falls back to a plain address). The
 * position is Less's own when it gave one; Less drops the position of an optional import, so then the source is
 * scanned for the `@import` or `@plugin` keyword. Plain CSS imports are copied into the output without any file
 * manager being asked; `compileStylesheet` finds those in the compiled CSS.
 */
export async function compileLess(source: string, options: { compress: boolean }): Promise<LessOutcome> {
  const asked: Asked[] = [];
  const less = buildLess(asked);
  const engine = `Less ${less.version.join('.')}`;
  const text = parsedText(source);

  const refusal = (failure: LessFailure | undefined): StylesheetError => {
    let offset = refusedOffset(failure, asked);
    if (offset === undefined) offset = scanAtRule(text, ['import', 'plugin'], true)?.offset;
    const position = offset === undefined ? undefined : positionAt(text, offset);
    return importRefusedError({ line: position?.line, column: position?.column, target: asked[0]?.target });
  };

  let css: string;
  try {
    css = (await less.render(source, { javascriptEnabled: false, compress: options.compress })).css;
  } catch (err) {
    const failure = (typeof err === 'object' && err !== null ? err : undefined) as LessFailure | undefined;
    if (asked.length > 0) throw refusal(failure);
    // Running out of stack or string room inside the compiler is a limit, not a mistake in the stylesheet.
    if (err instanceof RangeError) throw new StylesheetError(`${TOO_DEEP}.`, 'limit');
    if (failure?.type === undefined) throw new StylesheetError(`${COMPILER_FAILED}.`, 'limit');
    const message = typeof failure?.message === 'string' ? failure.message : undefined;
    if (message === undefined) throw new StylesheetError(`${TOO_DEEP}.`, 'limit');
    const offset = typeof failure?.index === 'number' ? failure.index : undefined;
    // Less counts columns from 0 and gives no offset for some errors; the offset is preferred.
    const fallback =
      typeof failure?.line === 'number' && typeof failure?.column === 'number'
        ? { line: failure.line, column: failure.column + 1 }
        : {};
    throw syntaxError(describeEngineMessage(message, text, COMPILER_FAILED), text, offset, fallback);
  }
  if (asked.length > 0) throw refusal(undefined);
  return { css, warnings: [], engine };
}
