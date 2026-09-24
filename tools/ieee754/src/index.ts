import meta from './meta.json';

export { meta };

export type FloatFormat = 'binary32' | 'binary64';
export type InputMode = 'value' | 'bits';

export class Ieee754Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ieee754Error';
  }
}

export type SpecialCase =
  | 'zero'
  | 'negative zero'
  | 'positive infinity'
  | 'negative infinity'
  | 'quiet NaN'
  | 'signalling NaN'
  | 'subnormal'
  | 'normal';

export interface FloatReport {
  format: FloatFormat;
  decodedValue: string;
  label: SpecialCase;
  signBit: string;
  exponentField: string;
  mantissaField: string;
  bits: string;
  biasedExponent: number;
  unbiasedExponent: number;
  mantissa: bigint;
  hasImplicitLeadingOne: boolean;
  isQuiet: boolean;
  payload: bigint;
}

// RED phase stub: signatures match the planned contract, bodies not yet implemented.
export function bitsFromHex(_text: string, _format: FloatFormat): bigint {
  throw new Ieee754Error('not implemented');
}

export function fromBits(_bits: bigint, _format: FloatFormat): number {
  throw new Ieee754Error('not implemented');
}

export function reportFromBits(_bits: bigint, _format: FloatFormat): FloatReport {
  throw new Ieee754Error('not implemented');
}

export function inspectFloat(_input: string, _format: FloatFormat, _mode: InputMode = 'value'): FloatReport {
  throw new Ieee754Error('not implemented');
}
