import type { ParsedTable } from './parse';

export type ChartType = 'bar' | 'line' | 'pie';

export function visible(_text: string): string {
  throw new Error('not implemented');
}

export function shortLabel(_label: string): string {
  throw new Error('not implemented');
}

export function altText(_table: ParsedTable, _type: ChartType, _title: string): string {
  throw new Error('not implemented');
}

export function describeChart(
  _table: ParsedTable,
  _type: ChartType,
  _axes?: { xLabel: string; yLabel: string },
): string[] {
  throw new Error('not implemented');
}

export function tableRows(_table: ParsedTable): { headers: string[]; rows: string[][] } {
  throw new Error('not implemented');
}
