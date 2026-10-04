import { it, expect } from 'vitest';
import { PALETTES, chartSvg, escapeXml, formatValue, niceTicks, type ChartType, type ParsedTable } from '../src/index';

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const FFFD = String.fromCharCode(0xfffd);
const LONE_SURROGATE = String.fromCharCode(0xd800);
const RLO = String.fromCodePoint(0x202e);
const TYPES: ChartType[] = ['bar', 'line', 'pie'];

interface Options {
  type: ChartType;
  title: string;
  xLabel: string;
  yLabel: string;
  legend: boolean;
  values: boolean;
  palette: string;
}
const OPTS = { title: '', xLabel: '', yLabel: '', legend: true, values: false, palette: 'default' };
const opts = (type: ChartType, more: Partial<Options> = {}): Options => ({ ...OPTS, type, ...more });

function tableOf(labels: string[], series: [string, number[]][]): ParsedTable {
  return {
    headers: ['Label', ...series.map(([name]) => name)],
    labels,
    series: series.map(([name, values]) => ({ name, values })),
    notes: [],
  };
}

const FRUIT = tableOf(['Apples', 'Pears', 'Cherries'], [['Count', [3, 5, 8]]]);
const MONTHS = tableOf(
  ['Jan', 'Feb'],
  [
    ['Signups', [2, 4]],
    ['Visits', [10, 12]],
  ],
);

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_all, ref: string) => {
    if (ref === 'amp') return '&';
    if (ref === 'lt') return '<';
    if (ref === 'gt') return '>';
    if (ref === 'quot') return '"';
    if (ref === 'apos') return "'";
    return String.fromCodePoint(ref.startsWith('#x') ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10));
  });
}

/** The attributes of one start tag, with their values decoded. */
function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) out[m[1]!] = decode(m[2]!);
  return out;
}

/** The start tags with the given element name, in file order. */
function tagsOf(svg: string, name: string): Record<string, string>[] {
  return [...svg.matchAll(new RegExp('<' + name + '\\b[^>]*>', 'g'))].map((m) => attrsOf(m[0]));
}

/** Every element that is a graphics-symbol, in file order. */
function symbolsOf(svg: string): { name: string; attrs: Record<string, string> }[] {
  return [...svg.matchAll(/<(rect|circle|path|polygon|ellipse)\b[^>]*role="graphics-symbol"[^>]*>/g)].map((m) => ({
    name: m[1]!,
    attrs: attrsOf(m[0]),
  }));
}

/**
 * A small well-formedness check written for this test: characters XML 1.0 allows, tags that open and close in order,
 * attribute values in double quotes with no raw angle bracket or loose ampersand, references that name allowed
 * characters, one root, no text outside it.
 */
function assertWellFormed(xml: string): void {
  const allowed = (c: number): boolean =>
    c === 9 ||
    c === 10 ||
    c === 13 ||
    (c >= 0x20 && c <= 0xd7ff) ||
    (c >= 0xe000 && c <= 0xfffd) ||
    (c >= 0x10000 && c <= 0x10ffff);
  for (let i = 0; i < xml.length; i++) {
    const c = xml.codePointAt(i)!;
    if (c >= 0x10000) i++;
    if (!allowed(c)) throw new Error('a character XML does not allow, at ' + i + ' (U+' + c.toString(16) + ')');
  }
  const checkReferences = (text: string): void => {
    for (const m of text.matchAll(/&([^;\s]*);?/g)) {
      const ref = m[1]!;
      if (/^(amp|lt|gt|quot|apos)$/.test(ref) && m[0].endsWith(';')) continue;
      const num = /^#(x[0-9a-fA-F]+|[0-9]+)$/.exec(ref);
      if (num && m[0].endsWith(';')) {
        const code = num[1]!.startsWith('x') ? parseInt(num[1]!.slice(1), 16) : parseInt(num[1]!, 10);
        if (allowed(code)) continue;
        throw new Error('a reference to a character XML does not allow: ' + m[0]);
      }
      throw new Error('a loose ampersand or an unknown entity: ' + m[0]);
    }
  };
  const stack: string[] = [];
  let roots = 0;
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const text = xml.slice(i, lt === -1 ? xml.length : lt);
    if (text.includes(']]>')) throw new Error('a text holds ]]>');
    checkReferences(text);
    if (stack.length === 0 && text.trim() !== '') throw new Error('text outside the root element');
    if (lt === -1) break;
    // Find the end of the tag, skipping over quoted values.
    let j = lt + 1;
    let quote = '';
    while (j < xml.length) {
      const ch = xml[j]!;
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    if (j >= xml.length) throw new Error('a tag is never closed');
    const tag = xml.slice(lt + 1, j);
    i = j + 1;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      if (stack.pop() !== name) throw new Error('an end tag does not match: ' + name);
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const head = /^([A-Za-z_][\w.-]*)/.exec(body);
    if (!head) throw new Error('a tag has no name');
    let rest = body.slice(head[0].length);
    const seen = new Set<string>();
    while (rest.trim() !== '') {
      const attr = /^\s+([A-Za-z_:][\w:.-]*)="([^"<]*)"/.exec(rest);
      if (!attr) throw new Error('an attribute is not name="value": ' + rest.slice(0, 30));
      if (seen.has(attr[1]!)) throw new Error('an attribute is repeated: ' + attr[1]);
      seen.add(attr[1]!);
      checkReferences(attr[2]!);
      rest = rest.slice(attr[0].length);
    }
    if (stack.length === 0) {
      roots++;
      if (roots > 1) throw new Error('more than one root element');
    }
    if (!selfClosing) stack.push(head[1]!);
  }
  if (stack.length !== 0) throw new Error('an element is never closed: ' + stack.join(' > '));
  if (roots !== 1) throw new Error('no root element');
}

const DENIED_ELEMENTS = new Set([
  'script',
  'style',
  'foreignObject',
  'image',
  'use',
  'a',
  'iframe',
  'link',
  'animate',
  'set',
  'animateTransform',
  'embed',
  'object',
  'video',
  'audio',
]);

/**
 * Reads every tag of the file with a pattern that only accepts name="value" attributes, checks that every angle
 * bracket belongs to such a tag, and refuses any element that can run code or load something, any link, style or event
 * attribute, and any address in an attribute that is not text for a reader (the aria attributes hold text).
 */
function assertSafeMarkup(svg: string): void {
  const tags = [...svg.matchAll(/<([A-Za-z][\w.-]*)((?:\s+[A-Za-z_:][\w:.-]*="[^"]*")*)\s*\/?>/g)];
  const ends = svg.match(/<\/[A-Za-z][\w.-]*>/g) ?? [];
  expect((svg.match(/</g) ?? []).length).toBe(tags.length + ends.length);
  for (const tag of tags) {
    expect(DENIED_ELEMENTS.has(tag[1]!), tag[1]).toBe(false);
    for (const attr of tag[2]!.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
      const name = attr[1]!.toLowerCase();
      expect(
        name === 'href' || name.endsWith(':href') || name === 'style' || name === 'src' || name.startsWith('on'),
        name,
      ).toBe(false);
      if (!name.startsWith('aria-') && name !== 'xmlns')
        expect(attr[2]!, name).not.toMatch(/url\(|javascript:|data:|:\/\//i);
    }
  }
}

it('the SVG root carries the graphics-document role, a title and a description referenced by aria attributes', () => {
  for (const type of TYPES) {
    const typed = 'Fruit <sold> & "more"';
    const svg = chartSvg(FRUIT, opts(type, { title: typed, xLabel: 'Fruit', yLabel: 'Number' }));
    const root = tagsOf(svg, 'svg')[0]!;
    expect(root['role']).toBe('graphics-document');
    expect(root['aria-roledescription']).toBe(`${type} chart`);
    expect(root['xmlns']).toBe('http://www.w3.org/2000/svg');
    expect(root['width']).toBe('800');
    expect(root['height']).toBe('480');
    expect(root['viewBox']).toBe('0 0 800 480');
    expect(svg.startsWith('<svg ')).toBe(true);

    const titleId = root['aria-labelledby']!;
    const descId = root['aria-describedby']!;
    expect(titleId).toMatch(/^[A-Za-z][\w-]*$/);
    expect(descId).toMatch(/^[A-Za-z][\w-]*$/);
    expect(titleId).not.toBe(descId);
    // Each id names exactly one element, and it is the title and the description.
    expect(svg.split(`id="${titleId}"`)).toHaveLength(2);
    expect(svg.split(`id="${descId}"`)).toHaveLength(2);
    const title = new RegExp(`<title id="${titleId}">([^<]*)</title>`).exec(svg);
    const desc = new RegExp(`<desc id="${descId}">([^<]*)</desc>`).exec(svg);
    expect(title).not.toBeNull();
    expect(desc).not.toBeNull();
    // The typed title comes back exactly once the file's own escaping is undone, and the markup in it stayed text.
    expect(decode(title![1]!)).toBe(typed);
    expect(title![1]).toContain('&lt;sold&gt; &amp; &quot;more&quot;');
    expect(svg).not.toContain('<sold>');
    // The description is the written description of the data.
    expect(decode(desc![1]!)).toContain(
      type === 'pie'
        ? 'Count: 3 slices adding up to 16.'
        : 'Count: 3 values, from 3 (Apples) to 8 (Cherries), averaging 5.33333.',
    );
    // The title and the description are the first two children, so they are read first.
    expect(svg.indexOf('<title')).toBeLessThan(svg.indexOf('<desc'));
    expect(svg.indexOf('<desc')).toBeLessThan(svg.search(/<(rect|circle|path|g|text|line|polyline)\b/));

    // Without a typed title the title still names the chart.
    const plain = chartSvg(FRUIT, opts(type));
    expect(plain).toMatch(new RegExp(`<title id="[^"]+">${type[0]!.toUpperCase()}${type.slice(1)} chart</title>`));
  }
});

it('every bar, point and slice is a graphics-symbol with its label and value', () => {
  // One series: the label of a mark is its row label and its value.
  const bars = symbolsOf(chartSvg(FRUIT, opts('bar')));
  expect(bars.map((s) => s.name)).toEqual(['rect', 'rect', 'rect']);
  expect(bars.map((s) => s.attrs['aria-label'])).toEqual(['Apples: 3', 'Pears: 5', 'Cherries: 8']);
  const points = symbolsOf(chartSvg(FRUIT, opts('line')));
  expect(points.map((s) => s.name)).toEqual(['circle', 'circle', 'circle']);
  expect(points.map((s) => s.attrs['aria-label'])).toEqual(['Apples: 3', 'Pears: 5', 'Cherries: 8']);
  const slices = symbolsOf(chartSvg(FRUIT, opts('pie')));
  expect(slices.map((s) => s.name)).toEqual(['path', 'path', 'path']);
  expect(slices.map((s) => s.attrs['aria-label'])).toEqual(['Apples: 3', 'Pears: 5', 'Cherries: 8']);

  // Several series: the series name is added, series by series, and each series is a graphics-object.
  for (const type of ['bar', 'line'] as const) {
    const svg = chartSvg(MONTHS, opts(type));
    expect(symbolsOf(svg).map((s) => s.attrs['aria-label'])).toEqual([
      'Jan, Signups: 2',
      'Feb, Signups: 4',
      'Jan, Visits: 10',
      'Feb, Visits: 12',
    ]);
    expect(
      tagsOf(svg, 'g')
        .filter((g) => g['role'] === 'graphics-object')
        .map((g) => g['aria-label']),
    ).toEqual(['Signups', 'Visits']);
  }
  // A pie draws the first series only.
  const pie = chartSvg(MONTHS, opts('pie'));
  expect(symbolsOf(pie).map((s) => s.attrs['aria-label'])).toEqual(['Jan: 2', 'Feb: 4']);
  expect(
    tagsOf(pie, 'g')
      .filter((g) => g['role'] === 'graphics-object')
      .map((g) => g['aria-label']),
  ).toEqual(['Signups']);

  // The marks are the only graphics-symbols: gridlines, axes, the legend and the written values are not.
  for (const type of TYPES) {
    const svg = chartSvg(MONTHS, opts(type, { values: true, legend: true, xLabel: 'x', yLabel: 'y' }));
    expect(svg.match(/role="graphics-symbol"/g)).toHaveLength(type === 'pie' ? 2 : 4);
    for (const symbol of symbolsOf(svg)) expect(symbol.attrs['aria-label']).toMatch(/^[A-Za-z, ]+: \d+$/);
  }

  // A value is written by the one number function, so a long decimal is cut to six significant digits.
  const long = chartSvg(tableOf(['A'], [['V', [1 / 3]]]), opts('bar'));
  expect(symbolsOf(long)[0]!.attrs['aria-label']).toBe('A: 0.333333');

  // Zero and negative values keep their mark and their label.
  const mixed = chartSvg(tableOf(['a', 'b', 'c'], [['V', [0, -2, 4]]]), opts('bar'));
  expect(symbolsOf(mixed).map((s) => s.attrs['aria-label'])).toEqual(['a: 0', 'b: -2', 'c: 4']);
  const zeroSlice = chartSvg(tableOf(['a', 'b', 'c'], [['V', [0, 7, 0]]]), opts('pie'));
  // A slice of value 0 has no width, so a pie draws nothing for it (the legend, the table and the description list it).
  expect(symbolsOf(zeroSlice).map((s) => s.attrs['aria-label'])).toEqual(['b: 7']);
});

it('bar heights, line points and pie angles follow the values exactly', () => {
  // Bars: the height is proportional to the size of the value, to half a pixel, and every bar stands on one baseline.
  const values = [3, 5, 8, 0, -4, 6.5];
  const svg = chartSvg(tableOf(['a', 'b', 'c', 'd', 'e', 'f'], [['V', values]]), opts('bar'));
  const bars = symbolsOf(svg).map((s) => ({
    x: Number(s.attrs['x']),
    y: Number(s.attrs['y']),
    width: Number(s.attrs['width']),
    height: Number(s.attrs['height']),
  }));
  expect(bars).toHaveLength(values.length);
  const scale = bars[2]!.height / 8; // pixels for one unit, from the tallest bar
  expect(scale).toBeGreaterThan(5);
  values.forEach((v, i) => {
    expect(Math.abs(bars[i]!.height - Math.abs(v) * scale)).toBeLessThanOrEqual(0.5);
    expect(bars[i]!.width).toBeGreaterThan(5);
  });
  const baseline = bars[0]!.y + bars[0]!.height;
  values.forEach((v, i) => {
    if (v >= 0) expect(Math.abs(bars[i]!.y + bars[i]!.height - baseline)).toBeLessThanOrEqual(0.01);
    else expect(Math.abs(bars[i]!.y - baseline)).toBeLessThanOrEqual(0.01);
  });
  // Bars side by side do not overlap and keep the order of the rows.
  for (let i = 1; i < bars.length; i++)
    expect(bars[i]!.x).toBeGreaterThanOrEqual(bars[i - 1]!.x + bars[i - 1]!.width - 0.01);

  // Several series share one scale.
  const two = chartSvg(
    tableOf(
      ['a', 'b'],
      [
        ['P', [2, 8]],
        ['Q', [4, 6]],
      ],
    ),
    opts('bar'),
  );
  const heights = symbolsOf(two).map((s) => Number(s.attrs['height']));
  expect(heights).toHaveLength(4);
  const unit = heights[1]! / 8;
  [2, 8, 4, 6].forEach((v, i) => expect(Math.abs(heights[i]! - v * unit)).toBeLessThanOrEqual(0.5));

  // Lines: the vertical position is a straight-line function of the value (higher values are higher up), the points
  // are evenly spaced, the polyline joins the same points, and two series use one scale.
  const lineValues = [2, 8, 5, 11];
  const line = chartSvg(
    tableOf(
      ['a', 'b', 'c', 'd'],
      [
        ['P', lineValues],
        ['Q', [1, 3, 9, 6]],
      ],
    ),
    opts('line'),
  );
  const circles = symbolsOf(line).map((s) => ({ cx: Number(s.attrs['cx']), cy: Number(s.attrs['cy']) }));
  expect(circles).toHaveLength(8);
  const first = circles.slice(0, 4);
  const second = circles.slice(4);
  const allValues = [...lineValues, 1, 3, 9, 6];
  const origin = { v: allValues[0]!, y: circles[0]!.cy };
  const slope = (circles[3]!.cy - origin.y) / (allValues[3]! - origin.v);
  expect(slope).toBeLessThan(0); // a larger value is a smaller screen y
  circles.forEach((c, i) => {
    expect(Math.abs(c.cy - (origin.y + slope * (allValues[i]! - origin.v)))).toBeLessThanOrEqual(0.02);
  });
  const step = first[1]!.cx - first[0]!.cx;
  expect(step).toBeGreaterThan(20);
  for (let i = 1; i < 4; i++) expect(Math.abs(first[i]!.cx - first[i - 1]!.cx - step)).toBeLessThanOrEqual(0.02);
  second.forEach((c, i) => expect(Math.abs(c.cx - first[i]!.cx)).toBeLessThanOrEqual(0.02));
  const lines = [...line.matchAll(/<polyline\b[^>]*>/g)].map((m) => attrsOf(m[0])['points']!);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toBe(first.map((c) => `${c.cx},${c.cy}`).join(' '));
  expect(lines[1]).toBe(second.map((c) => `${c.cx},${c.cy}`).join(' '));

  // Pies: each slice's angle is its value over the total times 360, the angles add up to 360, the first slice starts at
  // twelve o'clock and the slices run clockwise from one to the next.
  const shares = [3, 5, 40, 0, 1.5, 12.5];
  const pie = chartSvg(tableOf(['a', 'b', 'c', 'd', 'e', 'f'], [['V', shares]]), opts('pie'));
  const total = shares.reduce((a, b) => a + b, 0);
  const drawnShares = shares.filter((v) => v !== 0); // a slice of value 0 is not drawn
  const slices = symbolsOf(pie).map((s) => {
    const m =
      /^M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+) A (-?[\d.]+) (-?[\d.]+) 0 ([01]) 1 (-?[\d.]+) (-?[\d.]+) Z$/.exec(
        s.attrs['d']!,
      );
    expect(m).not.toBeNull();
    const n = m!.slice(1).map(Number);
    return { cx: n[0]!, cy: n[1]!, x0: n[2]!, y0: n[3]!, rx: n[4]!, ry: n[5]!, large: n[6]!, x1: n[7]!, y1: n[8]! };
  });
  expect(slices).toHaveLength(drawnShares.length);
  const degrees = (cx: number, cy: number, x: number, y: number): number =>
    (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  let sum = 0;
  slices.forEach((s, i) => {
    let angle = degrees(s.cx, s.cy, s.x1, s.y1) - degrees(s.cx, s.cy, s.x0, s.y0);
    angle = ((angle % 360) + 360) % 360;
    expect(Math.abs(angle - (drawnShares[i]! / total) * 360)).toBeLessThanOrEqual(0.01);
    expect(s.large).toBe(angle > 180 ? 1 : 0);
    expect(s.rx).toBe(s.ry);
    expect(Math.abs(Math.hypot(s.x0 - s.cx, s.y0 - s.cy) - s.rx)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(Math.hypot(s.x1 - s.cx, s.y1 - s.cy) - s.rx)).toBeLessThanOrEqual(0.01);
    sum += angle;
    if (i > 0) {
      expect(Math.abs(s.x0 - slices[i - 1]!.x1)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(s.y0 - slices[i - 1]!.y1)).toBeLessThanOrEqual(0.001);
    }
  });
  expect(Math.abs(sum - 360)).toBeLessThanOrEqual(0.05);
  expect(Math.abs(slices[0]!.x0 - slices[0]!.cx)).toBeLessThanOrEqual(0.001);
  expect(slices[0]!.y0).toBeLessThan(slices[0]!.cy);
  // Clockwise on the screen: the second slice's far end is to the right of twelve o'clock first.
  expect(slices[0]!.x1).toBeGreaterThan(slices[0]!.cx);

  // A slice that fills the whole circle is a circle, with the same radius as the others.
  const whole = chartSvg(tableOf(['a', 'b'], [['V', [0, 9]]]), opts('pie'));
  const marks = symbolsOf(whole);
  expect(marks.map((m) => m.name)).toEqual(['circle']);
  expect(Number(marks[0]!.attrs['r'])).toBeGreaterThan(50);
});

it('nice ticks are 1, 2 or 5 times a power of ten and include zero when the range crosses it', () => {
  expect(niceTicks(0, 87, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  expect(niceTicks(0, 8, 5)).toEqual([0, 2, 4, 6, 8]);
  expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  expect(niceTicks(-3, 7, 5)).toEqual([-4, -2, 0, 2, 4, 6, 8]);
  expect(niceTicks(0, 0.37, 5)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  expect(niceTicks(1000, 1010, 5)).toEqual([1000, 1002, 1004, 1006, 1008, 1010]);
  expect(niceTicks(0, 1_234_567, 5)).toEqual([0, 500_000, 1_000_000, 1_500_000]);
  // A range of no width still gives a usable axis, and zero is on it.
  expect(niceTicks(0, 0, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  expect(niceTicks(5, 5, 5)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(niceTicks(-5, -5, 5)).toEqual([-5, -4, -3, -2, -1, 0]);

  // Properties over a seeded spread of ranges.
  let seed = 12345;
  const next = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 400; i++) {
    const scaleOfTen = 10 ** Math.floor(next() * 12 - 6);
    const lo = (next() * 2 - 1) * scaleOfTen * (next() < 0.5 ? 0 : 5);
    const hi = lo + (0.01 + next() * 9) * scaleOfTen;
    const count = 3 + Math.floor(next() * 6);
    const ticks = niceTicks(lo, hi, count);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(count + 2);
    // The ticks cover the range, rise, and are evenly spaced.
    expect(ticks[0]!).toBeLessThanOrEqual(lo + Math.abs(lo) * 1e-9);
    expect(ticks[ticks.length - 1]!).toBeGreaterThanOrEqual(hi - Math.abs(hi) * 1e-9);
    const step = ticks[1]! - ticks[0]!;
    expect(step).toBeGreaterThan(0);
    for (let k = 1; k < ticks.length; k++)
      expect(Math.abs(ticks[k]! - ticks[k - 1]! - step)).toBeLessThanOrEqual(Math.abs(step) * 1e-6);
    // The step is 1, 2 or 5 times a power of ten.
    const power = 10 ** Math.floor(Math.log10(step) + 1e-9);
    const lead = step / power;
    expect([1, 2, 5].some((m) => Math.abs(lead - m) < 1e-6)).toBe(true);
    // Zero is a tick whenever the range crosses it.
    if (lo <= 0 && hi >= 0) expect(ticks.some((t) => t === 0)).toBe(true);
    // No tick is a tiny float error away from a round number.
    for (const t of ticks) expect(t).toBe(Number(t.toPrecision(10)));
  }

  // The number function: at most six significant digits, no exponent for ordinary sizes, no negative zero.
  const cases: [number, string][] = [
    [0, '0'],
    [-0, '0'],
    [5, '5'],
    [-5, '-5'],
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.333333'],
    [1234567, '1234570'],
    [12.3456789, '12.3457'],
    [999999.5, '1000000'],
    [1e-7, '0.0000001'],
    [2.5e-7, '0.00000025'],
    [-1.5e-7, '-0.00000015'],
    [0.000001234567, '0.00000123457'],
    [1e15, '1000000000000000'],
    [123456789012345, '123457000000000'],
  ];
  for (const [n, text] of cases) expect(formatValue(n)).toBe(text);
  expect(formatValue(1e21)).toBe('1e+21');
  expect(formatValue(Number.NaN)).toBe('0');
});

it('labels are cut at 40 code points in the chart and control and bidirectional characters are escaped for XML', () => {
  const smile = String.fromCodePoint(0x1f600);
  const long = 'x'.repeat(39) + smile + 'y';
  const svg = chartSvg(tableOf([long, 'b'], [['V', [1, 2]]]), opts('bar'));
  const labels = symbolsOf(svg).map((s) => s.attrs['aria-label']);
  expect(labels[0]).toBe('x'.repeat(39) + smile + '…: 1');
  expect(svg).not.toContain('y</text>');

  // Characters XML does not allow are replaced, direction characters are written as references, markup stays text.
  expect(escapeXml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
  expect(escapeXml(`a${NUL}b${BEL}c`)).toBe(`a${FFFD}b${FFFD}c`);
  expect(escapeXml(`a${LONE_SURROGATE}b`)).toBe(`a${FFFD}b`);
  expect(escapeXml(`a${String.fromCharCode(0xdc00)}b`)).toBe(`a${FFFD}b`);
  expect(escapeXml(`evil${RLO}gnp`)).toBe('evil&#x202E;gnp');
  expect(escapeXml(String.fromCharCode(0x85, 0x200e, 0x2066, 0x2069, 0x61c))).toBe(
    '&#x85;&#x200E;&#x2066;&#x2069;&#x61C;',
  );
  expect(escapeXml(`plain é ${smile} ${String.fromCharCode(0xfffd)}`)).toBe(
    `plain é ${smile} ${String.fromCharCode(0xfffd)}`,
  );
  expect(escapeXml(String.fromCharCode(0xfffe, 0xffff))).toBe(`${FFFD}${FFFD}`);
  expect(escapeXml(String.fromCharCode(9, 10, 13))).toBe('&#x9;&#xA;&#xD;');
});

it('every chart is well-formed XML with no foreign object, link or url reference', () => {
  const hostileLabels = [
    '<script>alert(1)</script>',
    '"quoted" & \'single\'',
    ']]>',
    `ctl${NUL}${BEL}x`,
    `evil${RLO}gnp.exe`,
    `lone${LONE_SURROGATE}x`,
    '&amp; &#x41; &lt;',
    String.fromCodePoint(0x1f600) + ' emoji',
    'a'.repeat(100),
    '',
    '</text><image href="https://example.invalid/x"/>',
    'javascript:alert(1)',
  ];
  const hostile = tableOf(hostileLabels, [
    ['<b>Series</b> & "one"', hostileLabels.map((_, i) => i * 2.5 - 7)],
    [`two${RLO}`, hostileLabels.map((_, i) => (i % 3) + 0.5)],
  ]);
  const samples: [string, ParsedTable][] = [
    ['hostile', hostile],
    ['fruit', FRUIT],
    ['single', tableOf(['only'], [['V', [4]]])],
    ['negative', tableOf(['a', 'b', 'c'], [['V', [-5, -1, -3]]])],
    ['zeros', tableOf(['a', 'b'], [['V', [0, 0]]])],
    ['huge', tableOf(['a', 'b'], [['V', [1e100, -1e100]]])],
    ['tiny', tableOf(['a', 'b'], [['V', [1e-300, 2e-300]]])],
    [
      'many',
      tableOf(
        Array.from({ length: 200 }, (_, i) => 'Label number ' + i),
        Array.from(
          { length: 8 },
          (_, s) =>
            ['S' + s, Array.from({ length: 200 }, (_, i) => ((i * 37 + s * 11) % 101) - 20)] as [string, number[]],
        ),
      ),
    ],
  ];
  for (const [name, table] of samples) {
    for (const type of TYPES) {
      if (type === 'pie' && ['negative', 'zeros', 'huge'].includes(name)) continue;
      if (type === 'pie' && ['hostile', 'many'].includes(name)) {
        // A pie takes non-negative values and at most 24 slices: use the first 24 absolute values.
        const first = table.series[0]!.values.slice(0, 24).map((v) => Math.abs(v) + 1);
        const slice = tableOf(table.labels.slice(0, 24), [[table.series[0]!.name, first]]);
        const svg = chartSvg(slice, opts('pie', { title: String(name) + RLO + '<t>', values: true }));
        assertWellFormed(svg);
        assertSafeMarkup(svg);
        continue;
      }
      // The big sample is checked with two palettes only, to keep the run short; the others cover every palette.
      const palettes = name === 'many' ? ['default', 'high-contrast'] : [...PALETTES.keys(), 'no such palette'];
      for (const palette of palettes) {
        for (const extra of [
          {},
          { values: true, xLabel: `x${RLO}<>&"`, yLabel: `y${NUL}`, title: `<title>${BEL}` },
          { legend: false },
        ]) {
          const svg = chartSvg(table, opts(type, { palette, ...extra }));
          assertWellFormed(svg);
          // Whatever the labels say, the file holds only the fixed elements and attributes of a chart.
          assertSafeMarkup(svg);
          if (name !== 'hostile') {
            // With no hostile text in the data, the words themselves are absent from the whole file.
            expect(svg).not.toMatch(/foreignObject/i);
            expect(svg).not.toMatch(/href/i);
            expect(svg).not.toMatch(/url\(/i);
            expect(svg).not.toMatch(/<(script|style|image|use|a|iframe|link)\b/i);
            expect(svg).not.toMatch(/\son[a-z]+=/i);
            expect(svg).not.toMatch(/javascript:|data:|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
          }
          expect(svg).not.toContain(RLO);
          expect(svg).not.toContain(NUL);
          expect(svg).not.toContain(BEL);
          expect(svg).not.toContain(LONE_SURROGATE);
        }
      }
    }
  }
  // The checker itself can fail: each of these is rejected.
  for (const broken of [
    '<svg><g></svg>',
    '<svg a="1" a="2"/>',
    '<svg a="<"/>',
    '<svg>&bogus;</svg>',
    '<svg>&#1;</svg>',
    '<svg>a & b</svg>',
    '<svg/><svg/>',
    '<svg>a]]>b</svg>',
    `<svg>${BEL}</svg>`,
    '<svg a=1/>',
  ]) {
    expect(() => assertWellFormed(broken)).toThrow();
  }
  assertWellFormed('<svg a="&amp;&#x202E;">&lt;<g/></svg>');
}, 60_000);

it('palette names are looked up safely and the colour-blind palette is the eight colours of Okabe and Ito', () => {
  // Published: Okabe and Ito, Color Universal Design (2008): orange, sky blue, bluish green, yellow, blue, vermillion,
  // reddish purple and black.
  const okabeIto = ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#000000'];
  expect([...PALETTES.get('colour-blind')!].map((c) => c.toLowerCase()).sort()).toEqual([...okabeIto].sort());
  for (const [name, colours] of PALETTES) {
    expect(colours.length, name).toBeGreaterThanOrEqual(8);
    expect(new Set(colours.map((c) => c.toLowerCase())).size, name).toBe(colours.length);
    for (const c of colours) expect(c, name).toMatch(/^#[0-9a-f]{6}$/);
  }
  // Every mark is drawn in a colour of the palette asked for, and neighbouring slices (the last and the first too)
  // never share a colour, whatever the number of slices.
  for (const [name, colours] of PALETTES) {
    const bar = symbolsOf(chartSvg(tableOf(['a', 'b', 'c'], [['V', [1, 2, 3]]]), opts('bar', { palette: name })));
    for (const mark of bar) expect(colours).toContain(mark.attrs['fill']);
    for (let n = 2; n <= 24; n++) {
      const pie = symbolsOf(
        chartSvg(
          tableOf(
            Array.from({ length: n }, (_, i) => 's' + i),
            [['V', Array.from({ length: n }, () => 1)]],
          ),
          opts('pie', { palette: name }),
        ),
      );
      const fills = pie.map((m) => m.attrs['fill']);
      expect(fills).toHaveLength(n);
      for (const fill of fills) expect(colours).toContain(fill);
      for (let i = 0; i < n; i++) expect(fills[i], `${name} ${n} slices, slice ${i}`).not.toBe(fills[(i + 1) % n]);
    }
  }
});

it('the same table always gives the same SVG and the options change only what they name', () => {
  const a = chartSvg(MONTHS, opts('bar', { title: 'T', xLabel: 'X', yLabel: 'Y' }));
  expect(chartSvg(MONTHS, opts('bar', { title: 'T', xLabel: 'X', yLabel: 'Y' }))).toBe(a);
  // The legend and the written values appear only when asked for.
  const withLegend = chartSvg(MONTHS, opts('bar', { legend: true }));
  const without = chartSvg(MONTHS, opts('bar', { legend: false }));
  expect(withLegend).toMatch(/>Signups</);
  expect(withLegend).toMatch(/>Visits</);
  expect(without).not.toMatch(/>Signups</);
  expect(without).not.toMatch(/>Visits</);
  const single = chartSvg(FRUIT, opts('bar', { legend: true }));
  expect(single).not.toMatch(/>Count</); // a legend for one series would say nothing new
  expect(chartSvg(FRUIT, opts('pie', { legend: true }))).toMatch(/>Pears: 5</);
  expect(chartSvg(FRUIT, opts('pie', { legend: false }))).not.toMatch(/>Pears: 5</);
  const shown = chartSvg(FRUIT, opts('bar', { values: true }));
  const hidden = chartSvg(FRUIT, opts('bar', { values: false }));
  expect(shown).toMatch(/>5</);
  expect(hidden).not.toMatch(/>5</);
  // Axis labels and the title are drawn as text when given.
  expect(a).toMatch(/>T</);
  expect(a).toMatch(/>X</);
  expect(a).toMatch(/>Y</);
  // A bar chart's value axis starts at zero, so its ticks include it even when every value is large.
  const big = chartSvg(tableOf(['a', 'b'], [['V', [1000, 1010]]]), opts('bar'));
  expect(big).toMatch(/>0</);
  // Labels under many points are thinned so the text stays small, while every mark stays.
  const many = chartSvg(
    tableOf(
      Array.from({ length: 200 }, (_, i) => 'Label ' + i),
      [['V', Array.from({ length: 200 }, (_, i) => i)]],
    ),
    opts('bar'),
  );
  expect(many.match(/<text\b/g)!.length).toBeLessThan(60);
  expect(many.match(/role="graphics-symbol"/g)).toHaveLength(200);
});

/** The circle or path marks of a pie, with the numbers a test needs (the two end points of a slice's arc). */
function pieMarks(svg: string): { name: string; label: string; attrs: Record<string, string> }[] {
  return symbolsOf(svg).map((s) => ({ name: s.name, label: s.attrs['aria-label']!, attrs: s.attrs }));
}

/** The rounded start and end points of a path slice, read from its `d` text. */
function arcEnds(d: string): { from: string; to: string; large: string } {
  const m = /^M [\d.-]+ [\d.-]+ L ([\d.-]+) ([\d.-]+) A [\d.-]+ [\d.-]+ 0 ([01]) 1 ([\d.-]+) ([\d.-]+) Z$/.exec(d);
  expect(m).not.toBeNull();
  return { from: `${m![1]} ${m![2]}`, to: `${m![4]} ${m![5]}`, large: m![3]! };
}

it('a pie slice of almost the whole pie is drawn as a full circle, and so is its value label', () => {
  for (const big of [1_000_000, 300_000, 100_000]) {
    const svg = chartSvg(tableOf(['big', 'small'], [['V', [big, 1]]]), opts('pie', { values: true }));
    const marks = pieMarks(svg);
    expect(marks).toHaveLength(2);
    // The big slice is never a path whose two end points are the same point (a browser draws that as nothing).
    const first = marks[0]!;
    if (first.name === 'path') {
      const ends = arcEnds(first.attrs['d']!);
      expect(ends.from).not.toBe(ends.to);
    } else {
      expect(first.name).toBe('circle');
    }
  }
  // From about 3e5 to 1 the two rounded end points are the same point: it must be the circle.
  for (const big of [1_000_000, 300_000]) {
    const svg = chartSvg(tableOf(['big', 'small'], [['V', [big, 1]]]), opts('pie', { values: true }));
    const [first] = pieMarks(svg);
    expect(first!.name).toBe('circle');
    expect(first!.label).toBe(`big: ${big}`);
    // Its value label sits at the middle of the circle, like a slice of the whole pie.
    const cx = Number(first!.attrs['cx']);
    const cy = Number(first!.attrs['cy']);
    expect(svg).toContain(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="12"`);
  }
  // No path in any of these has equal end points with a large arc.
  const svg = chartSvg(tableOf(['big', 'small'], [['V', [1_000_000, 1]]]), opts('pie'));
  for (const mark of pieMarks(svg)) {
    if (mark.name !== 'path') continue;
    const ends = arcEnds(mark.attrs['d']!);
    expect(ends.large === '1' && ends.from === ends.to).toBe(false);
  }
});

it('a pie slice of value 0 draws no path and a pie of one value between two zeros draws one circle', () => {
  const svg = chartSvg(tableOf(['a', 'b', 'c'], [['V', [0, 5, 0]]]), opts('pie', { values: true }));
  const marks = pieMarks(svg);
  expect(marks.map((m) => m.name)).toEqual(['circle']);
  expect(marks[0]!.label).toBe('b: 5');
  expect(svg).not.toMatch(/<path\b/);
  // The zero slices are still in the legend.
  expect(svg).toMatch(/>a: 0</);
  expect(svg).toMatch(/>c: 0</);
});
