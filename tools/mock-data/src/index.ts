import meta from './meta.json';

export { meta };

export class MockDataError extends Error {
  readonly line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'MockDataError';
    if (line !== undefined) this.line = line;
  }
}

/** Every field kind this package understands. */
export const FIELD_KINDS = [
  'id',
  'uuid',
  'firstName',
  'lastName',
  'fullName',
  'email',
  'username',
  'company',
  'city',
  'street',
  'word',
  'sentence',
  'boolean',
  'integer',
  'decimal',
  'date',
  'datetime',
  'ipv4',
  'url',
  'color',
  'oneOf',
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

export interface ParsedFieldSpec {
  fields: { name: string; kind: FieldKind; args: string[]; line: number }[];
}

export type MockDataFormat = 'json' | 'jsonl' | 'csv';

export interface GenerateMockDataOptions {
  seed: string;
  fields: string;
  count: number;
  format: MockDataFormat;
}

export interface GenerateMockDataResult {
  output: string;
  records: number;
  fields: number;
}

// RED stub: intentionally throws so the new tests in index.test.ts fail on
// a real assertion rather than an import error, before the GREEN commit
// replaces this file with the working implementation.
export function fnv1a32(_text: string): number {
  throw new Error('not implemented');
}

export function mulberry32(_seed: number): () => number {
  throw new Error('not implemented');
}

export function daysFromCivil(_y: number, _m: number, _d: number): number {
  throw new Error('not implemented');
}

export function civilFromDays(_z: number): { y: number; m: number; d: number } {
  throw new Error('not implemented');
}

export function parseFieldSpec(_text: string): ParsedFieldSpec {
  throw new MockDataError('not implemented');
}

export function generateMockData(_options: GenerateMockDataOptions): GenerateMockDataResult {
  throw new MockDataError('not implemented');
}
