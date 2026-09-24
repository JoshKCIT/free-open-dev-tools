import meta from './meta.json';

export { meta };

export type Notation = 'decimal' | 'scientific' | 'engineering' | 'e';

export class ScientificNotationError extends Error {
  readonly position?: number;
  constructor(message: string, position?: number) {
    super(message);
    this.name = 'ScientificNotationError';
    this.position = position;
  }
}

export interface DecimalValue {
  sign: 1 | -1;
  digits: string;
  exponent: number;
  separatorStripped: boolean;
}

export interface FormatOptions {
  significantFigures?: number;
  letterExponent?: boolean;
}

export const MAX_OUTPUT_DIGITS = 100000;

// RED phase stub: signatures match the planned contract, bodies not yet implemented.
export function parseNumber(_input: string): DecimalValue {
  throw new ScientificNotationError('not implemented');
}

export function formatNumber(_value: DecimalValue, _notation: Notation, _options: FormatOptions = {}): string {
  throw new ScientificNotationError('not implemented');
}
