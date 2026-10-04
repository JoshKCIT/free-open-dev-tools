/**
 * Draws a bar, line or pie chart as one SVG file, by this package's own code. Every element is a fixed template; every
 * piece of typed text goes through `escapeXml`; every shown number goes through `formatValue`. The file holds no link, no
 * style element, no script, no foreign object and no address: only shapes, text in system fonts and the WAI-ARIA
 * Graphics Module roles (the root is a graphics-document with a title and a description, each series is a
 * graphics-object, and each bar, point and slice is a graphics-symbol with an accessible name). Pure: no DOM, no clock,
 * nothing logged.
 */
import { ChartError } from './errors';
import {
  AXIS_LIMIT,
  TITLE_LIMIT,
  chartTypeName,
  cutText,
  describeChart,
  effectiveTable,
  shortLabel,
  type ChartType,
} from './describe';
import { MAX_MAGNITUDE, MAX_POINTS, MAX_SERIES, MAX_SLICES, type ParsedTable } from './parse';
import { formatValue, niceTicks } from './scale';

export interface ChartSvgOptions {
  type: ChartType;
  title: string;
  xLabel: string;
  yLabel: string;
  /** Draw a legend: for a pie always, for a bar or line chart when it has more than one series. */
  legend: boolean;
  /** Write each value on its mark. */
  values: boolean;
  /** A name from PALETTES; any other name gives the default palette. */
  palette: string;
}

/** Eight colours for each palette. The colour-blind palette is the set of eight colours of Okabe and Ito (2008). */
export const PALETTES: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ['default', ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#17becf']],
  ['colour-blind', ['#0072b2', '#e69f00', '#009e73', '#d55e00', '#cc79a7', '#56b4e9', '#f0e442', '#000000']],
  ['grayscale', ['#111111', '#bbbbbb', '#555555', '#d9d9d9', '#888888', '#333333', '#a0a0a0', '#707070']],
  ['high-contrast', ['#000000', '#c00000', '#0000c0', '#006000', '#800080', '#a05000', '#005f5f', '#606000']],
]);

const DEFAULT_COLOURS = PALETTES.get('default')!;

/** The width of every chart, in pixels. */
export const CHART_WIDTH = 800;
/** The height of every chart, in pixels. */
export const CHART_HEIGHT = 480;
const WIDTH = CHART_WIDTH;
const HEIGHT = CHART_HEIGHT;
const FONT = "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = '#111827';
const SOFT_INK = '#374151';
const AXIS = '#4b5563';
const GRID = '#d1d5db';
const OUTLINE = '#1f2937';
const LEGEND_WIDTH = 220;
const LEGEND_ROW = 17;
const FFFD = String.fromCharCode(0xfffd);
/** The widest label, in characters, that the space under the marks is made for (18 and the ellipsis). */
const LABEL_CELLS = 19;
/** A label under a bar or point is cut to this many code points so it fits. */
const AXIS_TICK_LIMIT = 18;

function hex(unit: number): string {
  return '&#x' + unit.toString(16).toUpperCase() + ';';
}

/**
 * The text made safe to put between tags or inside a double-quoted attribute value. The five markup characters become
 * entities; tab, line feed and carriage return become references so an attribute keeps them; characters XML 1.0 does not
 * allow (other controls, lone surrogate halves, U+FFFE and U+FFFF) become U+FFFD; the C1 controls and the direction
 * marks become numeric references, so no raw character in the file can reorder or hide what a reader sees. One pass.
 */
export function escapeXml(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    let replacement: string | null = null;
    if (unit === 38) replacement = '&amp;';
    else if (unit === 60) replacement = '&lt;';
    else if (unit === 62) replacement = '&gt;';
    else if (unit === 34) replacement = '&quot;';
    else if (unit === 39) replacement = '&apos;';
    else if (unit === 9 || unit === 10 || unit === 13) replacement = hex(unit);
    else if (unit < 0x20) replacement = FFFD;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      replacement = FFFD;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) replacement = FFFD;
    else if (unit === 0xfffe || unit === 0xffff) replacement = FFFD;
    else if (
      (unit >= 0x7f && unit <= 0x9f) ||
      unit === 0x61c ||
      unit === 0x200e ||
      unit === 0x200f ||
      (unit >= 0x202a && unit <= 0x202e) ||
      (unit >= 0x2066 && unit <= 0x2069)
    ) {
      replacement = hex(unit);
    }
    if (replacement === null) continue;
    out += text.slice(from, i) + replacement;
    from = i + 1;
  }
  return out + text.slice(from);
}

/**
 * Refuses a table that cannot be drawn as `type`, with a plain sentence: a chart type that is not one of the three, no
 * rows or no numbers, more than 200 points, more than 8 series, a number above 1e100 in size, and for a pie more than 24
 * slices, a negative value or a total of zero.
 */
export function checkChartable(table: ParsedTable, type: ChartType): void {
  if (type !== 'bar' && type !== 'line' && type !== 'pie')
    throw new ChartError('The chart type must be bar, line or pie.');
  const points = table.labels.length;
  if (points === 0 || table.series.length === 0) {
    throw new ChartError('There is nothing to draw: a chart needs at least one row with a number.');
  }
  if (points > MAX_POINTS) {
    throw new ChartError(
      `There are ${points} rows of data, but a chart can show at most ${MAX_POINTS} points per series.`,
    );
  }
  if (table.series.length > MAX_SERIES) {
    throw new ChartError(
      `There are ${table.series.length} number columns, but a chart can show at most ${MAX_SERIES} series.`,
    );
  }
  for (const series of table.series) {
    if (series.values.length !== points) throw new ChartError('The table is not rectangular, so it cannot be drawn.');
    for (let i = 0; i < points; i++) {
      const value = series.values[i]!;
      if (!Number.isFinite(value) || Math.abs(value) > MAX_MAGNITUDE) {
        throw new ChartError(`A value in data row ${i + 1} is too large to draw. Use a size of 1e100 or less.`);
      }
    }
  }
  if (type === 'pie') {
    if (points > MAX_SLICES) {
      throw new ChartError(`There are ${points} slices, but a pie chart can show at most ${MAX_SLICES} slices.`);
    }
    const values = table.series[0]!.values;
    let total = 0;
    for (let i = 0; i < points; i++) {
      if (values[i]! < 0) {
        throw new ChartError(`Data row ${i + 1} has a negative value. A pie chart needs values of zero or more.`);
      }
      total += values[i]!;
    }
    if (!(total > 0)) throw new ChartError('The values add up to zero, so a pie chart has nothing to show.');
  }
}

/** A number rounded to hundredths, with no negative zero. */
function round2(n: number): number {
  const rounded = Math.round(n * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/** A coordinate as it is written in the file: hundredths, no exponent for any size a chart has. */
function px(n: number): string {
  return String(round2(n));
}

function textElement(x: number, y: number, content: string, attributes: string): string {
  return `<text x="${px(x)}" y="${px(y)}" ${attributes}>${escapeXml(content)}</text>`;
}

function codePoints(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) i++;
    count++;
  }
  return count;
}

/** The colour of mark `index` of `count` in a ring: the last and the first never share one. */
function ringColour(colours: readonly string[], index: number, count: number): string {
  let at = index % colours.length;
  if (count > 1 && index === count - 1 && at === 0) at = Math.min(2, colours.length - 1);
  return colours[at]!;
}

/** A dark or a light ink, whichever reads better on a mark of this #rrggbb colour. */
function inkOn(colour: string): string {
  const channel = (from: number): number => {
    const value = parseInt(colour.slice(from, from + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4 ? INK : '#ffffff';
}

interface Legend {
  colour: string;
  text: string;
}

/** The legend: a swatch and a line of text per entry, at the right of the chart. Decorative for a reader: the data is in the marks. */
function legendElements(entries: Legend[], top: number): string[] {
  const x = WIDTH - LEGEND_WIDTH - 10;
  const parts = ['<g aria-hidden="true">'];
  entries.forEach((entry, i) => {
    const y = top + i * LEGEND_ROW;
    parts.push(
      `<rect x="${px(x)}" y="${px(y)}" width="12" height="12" fill="${entry.colour}" stroke="${OUTLINE}" stroke-width="1"/>`,
    );
    parts.push(textElement(x + 18, y + 10, entry.text, `font-size="12" fill="${INK}"`));
  });
  parts.push('</g>');
  return parts;
}

function cartesian(
  drawn: ParsedTable,
  options: ChartSvgOptions,
  colours: readonly string[],
  title: string,
  xLabel: string,
  yLabel: string,
): string[] {
  const bars = options.type === 'bar';
  const points = drawn.labels.length;
  const count = drawn.series.length;

  let low = Infinity;
  let high = -Infinity;
  for (const series of drawn.series) {
    for (const value of series.values) {
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  // Bars stand on zero, so a bar chart's axis always includes it.
  if (bars) {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }
  const ticks = niceTicks(low, high, 5);
  const axisLow = ticks[0]!;
  const axisHigh = ticks[ticks.length - 1]!;
  const span = axisHigh - axisLow || 1;
  const tickText = ticks.map(formatValue);

  const legendShown = options.legend && count > 1;
  const labels = drawn.labels.map(shortLabel);
  const every = points <= 24 ? 1 : Math.ceil(points / 24);
  // Under the marks a label is shown in at most 18 characters, so it fits; the full label is in the mark's name and the table.
  const underMarks = labels.map((label) => cutText(label, AXIS_TICK_LIMIT));
  let longest = 0;
  for (let i = 0; i < points; i += every) longest = Math.max(longest, codePoints(underMarks[i]!));
  const rotate = points > 8 || longest > 10;

  let widest = 0;
  for (const t of tickText) widest = Math.max(widest, t.length);
  const top = title !== '' ? 52 : 20;
  // A turned label ends at its mark and reaches back to the left, so the first one needs room there.
  const turned = rotate ? Math.ceil(codePoints(underMarks[0]!) * 5.2) + 6 : 0;
  const left = Math.max(14 + (yLabel !== '' ? 22 : 0) + Math.min(widest, 16) * 7 + 10, turned);
  const right = legendShown ? LEGEND_WIDTH + 24 : 24;
  const labelHeight = rotate ? Math.ceil(Math.min(longest, LABEL_CELLS) * 3.8) + 16 : 24;
  const bottom = 10 + labelHeight + (xLabel !== '' ? 24 : 0);
  const plotW = WIDTH - left - right;
  const plotH = HEIGHT - top - bottom;
  const y = (value: number): number => top + ((axisHigh - value) / span) * plotH;
  const slot = plotW / points;
  const centre = (i: number): number => left + (i + 0.5) * slot;

  const parts: string[] = [];
  // Gridlines, the value axis and its numbers, the labels under the marks and the axis titles: all decorative for a
  // reader, because every mark carries its own label and value.
  parts.push('<g aria-hidden="true">');
  ticks.forEach((tick, i) => {
    const at = y(tick);
    const zero = tick === 0;
    parts.push(
      `<line x1="${px(left)}" y1="${px(at)}" x2="${px(left + plotW)}" y2="${px(at)}" stroke="${zero ? AXIS : GRID}" stroke-width="${zero ? '1.5' : '1'}"/>`,
    );
    parts.push(textElement(left - 8, at + 4, tickText[i]!, `text-anchor="end" font-size="12" fill="${SOFT_INK}"`));
  });
  parts.push(
    `<line x1="${px(left)}" y1="${px(top)}" x2="${px(left)}" y2="${px(top + plotH)}" stroke="${AXIS}" stroke-width="1"/>`,
  );
  for (let i = 0; i < points; i += every) {
    const x = centre(i);
    const at = top + plotH + 14;
    parts.push(
      rotate
        ? textElement(
            x,
            at,
            underMarks[i]!,
            `text-anchor="end" font-size="12" fill="${SOFT_INK}" transform="rotate(-35 ${px(x)} ${px(at)})"`,
          )
        : textElement(x, at + 4, underMarks[i]!, `text-anchor="middle" font-size="12" fill="${SOFT_INK}"`),
    );
  }
  if (xLabel !== '') {
    parts.push(textElement(left + plotW / 2, HEIGHT - 10, xLabel, `text-anchor="middle" font-size="13" fill="${INK}"`));
  }
  if (yLabel !== '') {
    const middle = top + plotH / 2;
    parts.push(
      textElement(
        14,
        middle,
        yLabel,
        `text-anchor="middle" font-size="13" fill="${INK}" transform="rotate(-90 14 ${px(middle)})"`,
      ),
    );
  }
  parts.push('</g>');

  const written: string[] = [];
  const name = (i: number, s: number): string =>
    count > 1 ? `${labels[i]!}, ${shortLabel(drawn.series[s]!.name)}` : labels[i]!;
  drawn.series.forEach((series, s) => {
    const colour = colours[s % colours.length]!;
    parts.push(`<g role="graphics-object" aria-label="${escapeXml(shortLabel(series.name))}">`);
    if (bars) {
      const barWidth = (slot * 0.8) / count;
      const baseline = round2(y(0));
      series.values.forEach((value, i) => {
        const x = left + i * slot + slot * 0.1 + s * barWidth;
        const edge = round2(y(value));
        const top0 = value >= 0 ? edge : baseline;
        const height = value >= 0 ? baseline - edge : edge - baseline;
        parts.push(
          `<rect role="graphics-symbol" aria-label="${escapeXml(`${name(i, s)}: ${formatValue(value)}`)}" x="${px(x)}" y="${px(top0)}" width="${px(barWidth)}" height="${px(height)}" fill="${colour}" stroke="${OUTLINE}" stroke-width="1"/>`,
        );
        if (options.values) {
          written.push(
            value >= 0
              ? textElement(
                  x + barWidth / 2,
                  top0 - 4,
                  formatValue(value),
                  `text-anchor="middle" font-size="11" fill="${INK}"`,
                )
              : textElement(
                  x + barWidth / 2,
                  top0 + height + 12,
                  formatValue(value),
                  `text-anchor="middle" font-size="11" fill="${INK}"`,
                ),
          );
        }
      });
    } else {
      if (points >= 2) {
        const joined = series.values.map((value, i) => `${px(centre(i))},${px(y(value))}`).join(' ');
        parts.push(
          `<polyline points="${joined}" fill="none" stroke="${colour}" stroke-width="2.5" stroke-linejoin="round" aria-hidden="true"/>`,
        );
      }
      series.values.forEach((value, i) => {
        parts.push(
          `<circle role="graphics-symbol" aria-label="${escapeXml(`${name(i, s)}: ${formatValue(value)}`)}" cx="${px(centre(i))}" cy="${px(y(value))}" r="4" fill="${colour}" stroke="${OUTLINE}" stroke-width="1"/>`,
        );
        if (options.values) {
          written.push(
            textElement(
              centre(i),
              y(value) - 8,
              formatValue(value),
              `text-anchor="middle" font-size="11" fill="${INK}"`,
            ),
          );
        }
      });
    }
    parts.push('</g>');
  });
  if (written.length > 0) parts.push('<g aria-hidden="true">', ...written, '</g>');
  if (legendShown) {
    parts.push(
      ...legendElements(
        drawn.series.map((series, s) => ({
          colour: colours[s % colours.length]!,
          text: cutText(shortLabel(series.name), 24),
        })),
        top,
      ),
    );
  }
  return parts;
}

function pie(drawn: ParsedTable, options: ChartSvgOptions, colours: readonly string[], title: string): string[] {
  const series = drawn.series[0]!;
  const values = series.values;
  const count = values.length;
  let total = 0;
  for (const value of values) total += value;

  const top = title !== '' ? 52 : 20;
  const left = 20;
  const right = options.legend ? LEGEND_WIDTH + 24 : 20;
  const plotW = WIDTH - left - right;
  const plotH = HEIGHT - top - 20;
  const radius = round2(Math.min(plotW, plotH) / 2 - 4);
  const cx = round2(left + plotW / 2);
  const cy = round2(top + plotH / 2);
  const point = (angle: number): [string, string] => [
    px(cx + radius * Math.cos(angle)),
    px(cy + radius * Math.sin(angle)),
  ];

  const parts: string[] = [`<g role="graphics-object" aria-label="${escapeXml(shortLabel(series.name))}">`];
  const written: string[] = [];
  let before = 0;
  values.forEach((value, i) => {
    // A slice of value 0 has no width: it draws no path (it is still in the legend, the table and the description).
    if (value === 0) return;
    const colour = ringColour(colours, i, count);
    const label = escapeXml(`${shortLabel(drawn.labels[i]!)}: ${formatValue(value)}`);
    const share = value / total;
    const from = -Math.PI / 2 + 2 * Math.PI * (before / total);
    before += value;
    const to = -Math.PI / 2 + 2 * Math.PI * (before / total);
    const [x0, y0] = point(from);
    const [x1, y1] = point(to);
    // An arc whose two end points are the same point is not drawn at all, so a slice that is almost the whole pie
    // (its end points round to one point) is a full circle, and so is a slice of exactly the whole pie.
    const whole = share > 1 - 1e-6 || (share > 0.5 && x0 === x1 && y0 === y1);
    if (whole) {
      parts.push(
        `<circle role="graphics-symbol" aria-label="${label}" cx="${px(cx)}" cy="${px(cy)}" r="${px(radius)}" fill="${colour}" stroke="${OUTLINE}" stroke-width="1"/>`,
      );
    } else {
      parts.push(
        `<path role="graphics-symbol" aria-label="${label}" d="M ${px(cx)} ${px(cy)} L ${x0} ${y0} A ${px(radius)} ${px(radius)} 0 ${share > 0.5 ? 1 : 0} 1 ${x1} ${y1} Z" fill="${colour}" stroke="${OUTLINE}" stroke-width="1"/>`,
      );
    }
    if (options.values && share >= 0.04) {
      const middle = (from + to) / 2;
      const spot = whole ? [cx, cy] : [cx + radius * 0.62 * Math.cos(middle), cy + radius * 0.62 * Math.sin(middle)];
      written.push(
        textElement(
          spot[0]!,
          spot[1]! + 4,
          formatValue(value),
          `text-anchor="middle" font-size="12" fill="${inkOn(colour)}"`,
        ),
      );
    }
  });
  parts.push('</g>');
  if (written.length > 0) parts.push('<g aria-hidden="true">', ...written, '</g>');
  if (options.legend) {
    parts.push(
      ...legendElements(
        values.map((value, i) => ({
          colour: ringColour(colours, i, count),
          text: `${cutText(shortLabel(drawn.labels[i]!), 20)}: ${formatValue(value)}`,
        })),
        top,
      ),
    );
  }
  return parts;
}

/**
 * The whole SVG file for a table: 800 by 480, a white background, the title, the marks, the axes or legend, and the
 * graphics roles described above. Refuses a table `checkChartable` refuses. A pie draws the first series only. The same
 * table and options always give the same text.
 */
export function chartSvg(table: ParsedTable, options: ChartSvgOptions): string {
  checkChartable(table, options.type);
  const drawn = effectiveTable(table, options.type);
  const colours = PALETTES.get(options.palette) ?? DEFAULT_COLOURS;
  const type = options.type;
  const title = cutText(options.title, TITLE_LIMIT);
  const xLabel = type === 'pie' ? '' : cutText(options.xLabel, AXIS_LIMIT);
  const yLabel = type === 'pie' ? '' : cutText(options.yLabel, AXIS_LIMIT);

  const description = describeChart(table, type, { xLabel, yLabel }).join(' ');
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="graphics-document" aria-roledescription="${type} chart" aria-labelledby="fodt-chart-title" aria-describedby="fodt-chart-desc" font-family="${FONT}">`,
    `<title id="fodt-chart-title">${escapeXml(title === '' ? chartTypeName(type) : title)}</title>`,
    `<desc id="fodt-chart-desc">${escapeXml(description)}</desc>`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`,
  ];
  if (title !== '') {
    parts.push(
      textElement(
        WIDTH / 2,
        30,
        title,
        `text-anchor="middle" font-size="18" font-weight="bold" fill="${INK}" aria-hidden="true"`,
      ),
    );
  }
  parts.push(
    ...(type === 'pie'
      ? pie(drawn, options, colours, title)
      : cartesian(drawn, options, colours, title, xLabel, yLabel)),
  );
  parts.push('</svg>');
  return parts.join('\n');
}
