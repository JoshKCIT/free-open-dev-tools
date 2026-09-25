import meta from './meta.json';

export { meta };

export class JsonDiffError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'JsonDiffError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export type DiffChangeKind = 'added' | 'removed' | 'changed';

export interface DiffChange {
  kind: DiffChangeKind;
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface DiffStats {
  added: number;
  removed: number;
  changed: number;
}

export interface DiffResult {
  identical: boolean;
  changes: DiffChange[];
  stats: DiffStats;
}

export function diffJson(_a: unknown, _b: unknown): DiffResult {
  throw new Error('not implemented');
}

export function diffJsonText(_first: string, _second: string): DiffResult {
  throw new Error('not implemented');
}
