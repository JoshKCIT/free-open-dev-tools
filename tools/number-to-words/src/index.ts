import meta from './meta.json';

export { meta };

export class NumberToWordsError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'NumberToWordsError';
    this.position = position;
  }
}

export type WordStyle = 'cardinal' | 'ordinal' | 'currency';

export const SCALES: string[] = [
  'thousand',
  'million',
  'billion',
  'trillion',
  'quadrillion',
  'quintillion',
  'sextillion',
  'septillion',
  'octillion',
  'nonillion',
  'decillion',
];

export interface WordsOptions {
  style?: WordStyle;
  connective?: boolean;
  majorUnit?: string;
  minorUnit?: string;
  minorScale?: number;
}

export function toWords(_input: string, _options: WordsOptions = {}): string {
  throw new Error('not implemented');
}
