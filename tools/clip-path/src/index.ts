import meta from './meta.json';

export { meta };

export class ClipPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipPathError';
  }
}

export const REGULAR_POLYGON_PRESETS: Record<string, { x: number; y: number }[]> = {};

export function generateClipPath(_options: unknown): never {
  throw new Error('not implemented');
}
