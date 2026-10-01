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
    throw new GoFormatterError(
      err instanceof Error && err.message ? err.message : 'The formatter failed on this input.',
    );
  }

  return { output, inputBytes: byteLength(source), outputBytes: byteLength(output) };
}
