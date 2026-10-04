/**
 * The words that go with a chart: the one-line description of the picture, the written description, and the data as
 * text. A number that was read is written exactly (`exactValue`) and a worked-out figure (an average, a total, a share) at
 * six significant digits (`formatValue`); every piece of typed text is cut at a fixed length and shown with its
 * control and direction characters written out. Pure: no DOM, no clock, nothing logged.
 */
import { exactValue, formatValue } from './scale';
import type { ParsedTable } from './parse';

export type ChartType = 'bar' | 'line' | 'pie';

/** A label is cut to this many code points. */
export const LABEL_LIMIT = 40;
/** A title is cut to this many code points. */
export const TITLE_LIMIT = 60;
/** An axis label is cut to this many code points. */
export const AXIS_LIMIT = 40;

const ELLIPSIS = '…';
const BACKSLASH = String.fromCharCode(92);

/** True for the code units `visible` writes out: every control character, the delete character and the direction marks. */
function isEscaped(unit: number): boolean {
  if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f)) return true;
  if (unit === 0x61c || unit === 0x200e || unit === 0x200f) return true;
  if (unit >= 0x202a && unit <= 0x202e) return true;
  return unit >= 0x2066 && unit <= 0x2069;
}

/**
 * The text with U+0000 to U+001F (tab and line feed too, since every use is one line), U+007F, U+0080 to U+009F, U+061C,
 * U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069 written as the backslash, `u{`, the code point in capital
 * hexadecimal and `}`, so a label cannot move the cursor, hide text or reorder what a reader sees. One pass, linear in
 * the text.
 */
export function visible(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (!isEscaped(unit)) continue;
    out += text.slice(from, i) + BACKSLASH + 'u{' + unit.toString(16).toUpperCase() + '}';
    from = i + 1;
  }
  return out + text.slice(from);
}

/** The text cut to `limit` code points (an astral character counts once) with an ellipsis after the cut. */
export function cutText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let count = 0;
  let i = 0;
  while (i < text.length) {
    if (count === limit) return text.slice(0, i) + ELLIPSIS;
    i += (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
    count++;
  }
  return text;
}

/** A label as the chart, the table and the descriptions show it: cut to 40 code points, and `(no label)` when empty. */
export function shortLabel(label: string): string {
  return label === '' ? '(no label)' : cutText(label, LABEL_LIMIT);
}

/** A label ready to put in a sentence or a table: cut, then with control and direction characters written out. */
function shown(label: string): string {
  return visible(shortLabel(label));
}

/** The name of a chart type as a sentence starts with it. */
export function chartTypeName(type: ChartType): string {
  return type === 'bar' ? 'Bar chart' : type === 'line' ? 'Line chart' : 'Pie chart';
}

/** What the chart draws: every series for a bar or line chart, the first series only for a pie. */
export function effectiveTable(table: ParsedTable, type: ChartType): ParsedTable {
  return type === 'pie' && table.series.length > 1 ? { ...table, series: [table.series[0]!] } : table;
}

interface Extreme {
  value: number;
  label: string;
  series: string;
}

/** The largest and the smallest value, the first of equal values winning in row order, series by series. */
function extremes(table: ParsedTable): { largest: Extreme; smallest: Extreme } | null {
  let largest: Extreme | null = null;
  let smallest: Extreme | null = null;
  for (const series of table.series) {
    for (let i = 0; i < series.values.length; i++) {
      const found = { value: series.values[i]!, label: table.labels[i] ?? '', series: series.name };
      if (largest === null || found.value > largest.value) largest = found;
      if (smallest === null || found.value < smallest.value) smallest = found;
    }
  }
  return largest === null || smallest === null ? null : { largest, smallest };
}

/** `label` or `label, series` when there is more than one series, as a reader says it. */
function reference(found: Extreme, several: boolean): string {
  return several ? `${shown(found.label)}, ${shown(found.series)}` : shown(found.label);
}

/**
 * One line for the image: the title (cut to 60 characters), the type, the number of points and the largest and the
 * smallest value with where they are. This is what a screen reader says for the picture.
 */
export function altText(table: ParsedTable, type: ChartType, title: string): string {
  const drawn = effectiveTable(table, type);
  const points = drawn.labels.length;
  const several = drawn.series.length > 1;
  const unit = type === 'pie' ? 'slice' : 'point';
  let text = title === '' ? '' : `${visible(cutText(title, TITLE_LIMIT))}. `;
  text += `${chartTypeName(type)} with ${points} ${unit}${points === 1 ? '' : 's'}`;
  if (several) text += ` in ${drawn.series.length} series`;
  text += '.';
  const found = extremes(drawn);
  if (found !== null) {
    text += ` Largest value ${exactValue(found.largest.value)} (${reference(found.largest, several)}).`;
    text += ` Smallest value ${exactValue(found.smallest.value)} (${reference(found.smallest, several)}).`;
  }
  return text;
}

/** The sentence for one series of a bar or line chart. */
function seriesSentence(table: ParsedTable, series: ParsedTable['series'][number]): string {
  const name = shown(series.name);
  const count = series.values.length;
  const only: ParsedTable = { ...table, series: [series] };
  const found = extremes(only);
  if (found === null) return `${name}: no values.`;
  if (count === 1) return `${name}: 1 value, ${exactValue(found.largest.value)} (${shown(found.largest.label)}).`;
  if (found.largest.value === found.smallest.value) {
    return `${name}: ${count} values, all equal to ${exactValue(found.largest.value)}.`;
  }
  let sum = 0;
  for (const value of series.values) sum += value;
  return (
    `${name}: ${count} values, from ${exactValue(found.smallest.value)} (${shown(found.smallest.label)}) ` +
    `to ${exactValue(found.largest.value)} (${shown(found.largest.label)}), averaging ${formatValue(sum / count)}.`
  );
}

/** The sentence for a pie: how many slices, what they add up to, and the largest and smallest share. */
function pieSentence(table: ParsedTable): string {
  const series = table.series[0]!;
  const name = shown(series.name);
  const count = series.values.length;
  let total = 0;
  for (const value of series.values) total += value;
  const found = extremes(table);
  if (found === null) return `${name}: no slices.`;
  const percent = (value: number): string => `${formatValue(total === 0 ? 0 : (value / total) * 100)}%`;
  if (count === 1) {
    return `${name}: 1 slice, ${shown(found.largest.label)} at ${exactValue(found.largest.value)} (${percent(found.largest.value)}).`;
  }
  return (
    `${name}: ${count} slices adding up to ${formatValue(total)}. ` +
    `The largest is ${shown(found.largest.label)} at ${exactValue(found.largest.value)} (${percent(found.largest.value)}), ` +
    `the smallest is ${shown(found.smallest.label)} at ${exactValue(found.smallest.value)} (${percent(found.smallest.value)}).`
  );
}

/**
 * The written description of the chart, one sentence per series (a pie has one), for people who cannot see the picture.
 * A bar or line chart with axis labels starts with one sentence for each axis.
 */
export function describeChart(
  table: ParsedTable,
  type: ChartType,
  axes?: { xLabel: string; yLabel: string },
): string[] {
  const drawn = effectiveTable(table, type);
  const sentences: string[] = [];
  if (type !== 'pie' && axes !== undefined) {
    if (axes.xLabel !== '') sentences.push(`Horizontal axis: ${visible(cutText(axes.xLabel, AXIS_LIMIT))}.`);
    if (axes.yLabel !== '') sentences.push(`Vertical axis: ${visible(cutText(axes.yLabel, AXIS_LIMIT))}.`);
  }
  if (type === 'pie') {
    if (drawn.series.length > 0) sentences.push(pieSentence(drawn));
  } else {
    for (const series of drawn.series) sentences.push(seriesSentence(drawn, series));
  }
  return sentences;
}

/** The data as text: the headers, then each row's label and values, labels cut and escaped, each number exactly as read. */
export function tableRows(table: ParsedTable): { headers: string[]; rows: string[][] } {
  return {
    headers: table.headers.map(shown),
    rows: table.labels.map((label, i) => [
      shown(label),
      ...table.series.map((series) => (i < series.values.length ? exactValue(series.values[i]!) : '')),
    ]),
  };
}
