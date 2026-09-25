import meta from './meta.json';

export { meta };

export class CsvJsonError extends Error {
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, detail: { line?: number; column?: number } = {}) {
    super(message);
    this.name = 'CsvJsonError';
    this.line = detail.line;
    this.column = detail.column;
  }
}

export interface CsvToJsonOptions {
  delimiter?: string;
  header?: boolean;
  inferTypes?: boolean;
}

export interface CsvJsonResult {
  output: string;
  rows: number;
  columns: number;
}

export function csvToJson(_text: string, _options: CsvToJsonOptions = {}): CsvJsonResult {
  throw new Error('not implemented');
}

export interface JsonToCsvOptions {
  delimiter?: string;
  header?: boolean;
  quoteAll?: boolean;
  lineEnding?: 'crlf' | 'lf';
}

export function jsonToCsv(_text: string, _options: JsonToCsvOptions = {}): CsvJsonResult {
  throw new Error('not implemented');
}
