import meta from './meta.json';
import type { loadJq } from 'jq-wasm/inline';

export { meta };

/** The loaded jq-wasm engine, handed in by the caller; this package only imports its type. */
export type JqEngine = Awaited<ReturnType<typeof loadJq>>;

export const MAX_INPUT_BYTES = 5242880;
export const MAX_OUTPUT_BYTES = 1048576;

export class JqPlaygroundError extends Error {
  readonly part?: 'input' | 'filter' | 'arguments' | 'run';
  readonly line?: number;
  readonly column?: number;
  readonly output: string;

  constructor(
    message: string,
    part?: 'input' | 'filter' | 'arguments' | 'run',
    detail: { line?: number; column?: number; output?: string } = {},
  ) {
    super(message);
    this.name = 'JqPlaygroundError';
    this.part = part;
    this.line = detail.line;
    this.column = detail.column;
    this.output = detail.output ?? '';
  }
}

export interface JqOptions {
  compact: boolean;
  raw: boolean;
  slurp: boolean;
  sortKeys: boolean;
  nullInput: boolean;
  ascii: boolean;
  indent: '2' | '4' | 'tab';
  args: string;
}

export interface JqResult {
  output: string;
  truncated: boolean;
  stderr: string;
  exitCode: number;
}

export function runJq(_engine: JqEngine, _input: string, _filter: string, _options: JqOptions): JqResult | null {
  throw new Error('not implemented');
}

export function engineFailureMessage(_err: unknown): string {
  throw new Error('not implemented');
}
