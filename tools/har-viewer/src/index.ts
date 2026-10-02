import meta from './meta.json';

export { meta };

export class HarViewerError extends Error {
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, detail: { path?: string; line?: number; column?: number } = {}) {
    super(message);
    this.name = 'HarViewerError';
    this.path = detail.path;
    this.line = detail.line;
    this.column = detail.column;
  }
}

export const MAX_FILE_BYTES = 52428800;
export const MAX_ENTRIES = 20000;
export const PAGE_SIZE = 500;

export function readHar(text: string): never {
  void text;
  throw new Error('not implemented');
}

export function listRequests(har: unknown, options: unknown): never {
  void har;
  void options;
  throw new Error('not implemented');
}
