import type { ChartType } from './describe';
import type { ParsedTable } from './parse';

export interface ChartSvgOptions {
  type: ChartType;
  title: string;
  xLabel: string;
  yLabel: string;
  legend: boolean;
  values: boolean;
  palette: string;
}

export const PALETTES: ReadonlyMap<string, readonly string[]> = new Map();

export function escapeXml(_text: string): string {
  throw new Error('not implemented');
}

export function checkChartable(_table: ParsedTable, _type: ChartType): void {
  throw new Error('not implemented');
}

export function chartSvg(_table: ParsedTable, _options: ChartSvgOptions): string {
  throw new Error('not implemented');
}
