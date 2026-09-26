import meta from './meta.json';

export { meta };

export class TransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransformError';
  }
}

export function generateTransform(_options: unknown): never {
  throw new Error('not implemented');
}

export function composeMatrix(_functions: unknown): never {
  throw new Error('not implemented');
}
