import meta from './meta.json';
import { ChartError } from './errors';
import type { ChartType } from './describe';
import type { ParsedTable } from './parse';

export { meta, ChartError };
export type { ChartType, ParsedTable };
export { MAX_PASTE_BYTES, MAX_POINTS, MAX_SERIES, MAX_SLICES, parseTable, readRows } from './parse';
export { formatValue, niceTicks } from './scale';
export { PALETTES, chartSvg, checkChartable, escapeXml } from './svg';
export { altText, describeChart, shortLabel, tableRows, visible } from './describe';

export interface MakeChartOptions {
  type: ChartType;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  /** True when the first row names the columns. Default true. */
  header?: boolean;
  /** Draw a legend (for more than one series, and for a pie). Default true. */
  legend?: boolean;
  /** Write each value on its mark. Default false. */
  values?: boolean;
  /** One of the names in PALETTES. Default 'default'. */
  palette?: string;
}

export interface Chart {
  /** The whole SVG file as text. */
  svg: string;
  /** The one-line description for the image. */
  alt: string;
  /** One sentence per series, for people who cannot see the picture. */
  description: string[];
  /** The data as text, labels cut and escaped for display. */
  table: { headers: string[]; rows: string[][] };
  notes: string[];
}

export function makeChart(_text: string, _options: MakeChartOptions): Chart | null {
  throw new Error('not implemented');
}
