import meta from './meta.json';

export { meta };

export class RomanNumeralError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'RomanNumeralError';
    this.position = position;
  }
}

export interface RomanSymbol {
  symbol: string;
  value: number;
}

export const ROMAN_SYMBOLS: RomanSymbol[] = [];

export function toRoman(_value: number): string {
  throw new Error('not implemented');
}

export function fromRoman(_text: string): number {
  throw new Error('not implemented');
}
