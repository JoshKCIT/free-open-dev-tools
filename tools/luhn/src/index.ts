import meta from './meta.json';

export { meta };

export class LuhnError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'LuhnError';
    this.position = position;
  }
}

export interface IssuerMatch {
  id: string;
  label: string;
}

interface IssuerRange {
  id: string;
  label: string;
  note: string;
  prefixRanges: { min: string; max: string }[];
  lengths: number[];
}

export const ISSUERS: Array<IssuerRange> = [];

export function isValid(_input: string): boolean {
  throw new Error('not implemented');
}

export function checkDigit(_input: string): string {
  throw new Error('not implemented');
}

export function identify(_input: string): IssuerMatch[] {
  throw new Error('not implemented');
}
