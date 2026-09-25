import meta from './meta.json';

export { meta };

export class ListCompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ListCompareError';
  }
}

export interface ListCompareOptions {
  ignoreCase?: boolean;
  trim?: boolean;
  keepBlank?: boolean;
  normalize?: boolean;
}

export interface ListCompareCounts {
  union: number;
  intersection: number;
  onlyA: number;
  onlyB: number;
  symmetric: number;
  duplicatesA: number;
  duplicatesB: number;
}

export interface ListCompareResult {
  union: string[];
  intersection: string[];
  onlyA: string[];
  onlyB: string[];
  symmetric: string[];
  counts: ListCompareCounts;
}

export function compareLists(_a: string, _b: string, _options: ListCompareOptions = {}): ListCompareResult {
  throw new Error('not implemented');
}
