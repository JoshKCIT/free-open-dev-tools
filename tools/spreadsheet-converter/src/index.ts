import meta from './meta.json';
import type {
  ConvertJob,
  ConvertResult,
  ReadOptions,
  Sheet,
  TableCell,
  TextFormat,
  TextOptions,
  Workbook,
  WriteOptions,
  WriteResult,
} from './types';

export { meta };
export * from './types';

export function readXlsx(_bytes: Uint8Array, _options: ReadOptions): Workbook {
  throw new Error('not implemented');
}

export function pickSheet(_workbook: Workbook, _selector: string): Sheet {
  throw new Error('not implemented');
}

export function sheetToText(
  _sheet: Sheet,
  _format: TextFormat,
  _options: TextOptions,
): { text: string; warnings: string[] } {
  throw new Error('not implemented');
}

export function parseTextTable(
  _text: string,
  _format: 'csv' | 'tsv' | 'json',
): { rows: TableCell[][]; warnings: string[] } {
  throw new Error('not implemented');
}

export function writeXlsx(_rows: TableCell[][], _options: WriteOptions): WriteResult {
  throw new Error('not implemented');
}

export function serialToIso(_serial: string, _date1904: boolean): string {
  throw new Error('not implemented');
}

export function convertSpreadsheet(_job: ConvertJob): ConvertResult {
  throw new Error('not implemented');
}
