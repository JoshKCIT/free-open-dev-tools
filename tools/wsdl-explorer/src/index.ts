import meta from './meta.json';

export { meta };
export { WsdlExplorerError, operationNames } from './model';
export type * from './model';

export const MAX_INPUT_BYTES = 2097152;

export function explainWsdl(text: string): never {
  void text;
  throw new Error('not implemented');
}

export function sampleRequest(model: unknown, operation: string, options: unknown): never {
  void model;
  void operation;
  void options;
  throw new Error('not implemented');
}
