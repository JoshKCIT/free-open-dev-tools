import meta from './meta.json';
import { ChartError } from './errors';
import { AXIS_LIMIT, TITLE_LIMIT, altText, cutText, describeChart, tableRows, type ChartType } from './describe';
import { checkPasteSize, parseTable, type ParsedTable } from './parse';
import { chartSvg, checkChartable } from './svg';

export { meta, ChartError };
export type { ChartType, ParsedTable };
export { MAX_MAGNITUDE, MAX_PASTE_BYTES, MAX_POINTS, MAX_SERIES, MAX_SLICES, parseTable, readRows } from './parse';
export type { ParsedSeries } from './parse';
export { formatValue, niceTicks } from './scale';
export { CHART_HEIGHT, CHART_WIDTH, PALETTES, chartSvg, checkChartable, escapeXml } from './svg';
export { altText, cutText, describeChart, shortLabel, tableRows, visible } from './describe';

export interface MakeChartOptions {
  type: ChartType;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  /** True when the first row names the columns. Default true. */
  header?: boolean;
  /** Draw a legend (for a pie, and for a chart with more than one series). Default true. */
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

/**
 * Reads pasted rows and draws them as a chart. Returns `null` when there is nothing to draw yet: a blank paste, a header
 * row with no data below it, or rows with no number column. Refuses, with a `ChartError` whose message names a row and a
 * column or a limit and never repeats the pasted text, a paste over 64 KiB, more than 200 points per series or 8 series,
 * anything in a number column that is not a plain finite number, a chart type that is not bar, line or pie, and for a pie
 * more than 24 slices, a negative value or a total of zero.
 */
export function makeChart(text: string, options: MakeChartOptions): Chart | null {
  const type = options.type;
  if (type !== 'bar' && type !== 'line' && type !== 'pie')
    throw new ChartError('The chart type must be bar, line or pie.');
  checkPasteSize(text);
  if (text.trim() === '') return null;
  const table = parseTable(text, { header: options.header ?? true });
  if (table.labels.length === 0 || table.series.length === 0) return null;
  checkChartable(table, type);

  const title = options.title ?? '';
  const xLabel = type === 'pie' ? '' : (options.xLabel ?? '');
  const yLabel = type === 'pie' ? '' : (options.yLabel ?? '');
  const notes = [...table.notes];
  if (type === 'pie' && table.series.length > 1) {
    notes.push('A pie chart shows the first number column only, so the other columns were left out of the picture.');
  }
  if (cutText(title, TITLE_LIMIT) !== title) notes.push(`The title was shortened to ${TITLE_LIMIT} characters.`);
  if (cutText(xLabel, AXIS_LIMIT) !== xLabel)
    notes.push(`The horizontal axis label was shortened to ${AXIS_LIMIT} characters.`);
  if (cutText(yLabel, AXIS_LIMIT) !== yLabel)
    notes.push(`The vertical axis label was shortened to ${AXIS_LIMIT} characters.`);

  return {
    svg: chartSvg(table, {
      type,
      title,
      xLabel,
      yLabel,
      legend: options.legend ?? true,
      values: options.values ?? false,
      palette: options.palette ?? 'default',
    }),
    alt: altText(table, type, title),
    description: describeChart(table, type, { xLabel, yLabel }),
    table: tableRows(table),
    notes,
  };
}
