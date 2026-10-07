import { expect, it, vi } from 'vitest';
import {
  FontInspectorError,
  MAX_CMAP_GROUPS,
  MAX_CHARSTRING_STEPS,
  MAX_COMPONENTS,
  MAX_COMPONENT_DEPTH,
  MAX_GLYPH_POINTS,
  inspectFont,
  openGlyphs,
  readCmap,
  readContainer,
  readNameTable,
  unwrapWoff1,
  visible,
} from '../src/index';
import { fontBytes } from './fixtures/fonts';
import { buildSfnt, tablesOf } from './helpers';
import { HOSTILE, MAX_SCALING_RATIO, scalingRatio } from './scaling';
import {
  ascii,
  cffTable,
  cmap12,
  cmap12Lying,
  cmap4,
  compositeGlyph,
  concat,
  cs,
  glyphFont,
  headTable,
  layoutTable,
  maxpTable,
  nameTable,
  postTable2,
  rectangle,
  sharedStringNameTable,
  simpleGlyph,
  u16,
  utf16be,
} from './tables';

/*
 * Hostile input (D-234, D-236 d). Sizes are judged from lengths and counts before arrays are sized; reading is one pass; the
 * depth of composite glyphs (8) and subroutines (10) and the number of steps a glyph may take (200,000) are capped, and a glyph
 * that hits a cap is drawn as far as it got and flagged, never thrown. Doubling a hostile input must not make a reader take more
 * than 6 times as long, and an input four times as long not more than 12 times (a reader that reads its input once takes about
 * 2 and 4 times as long). Where a ratio reads over its limit under load it is measured twice more and the median of three is
 * judged; the limit is never raised. No message repeats font bytes, and a name is never shown in a sentence beyond 40 characters.
 */

const detSans = (): Uint8Array => fontBytes('det-sans.ttf');
const latin1 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
};
const bytesOf = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
const replaceTable = (font: Uint8Array, tag: string, data: Uint8Array): Uint8Array =>
  buildSfnt(
    0x00010000,
    tablesOf(font).map(([t, d]) =>
      t === tag ? ([t, data] as [string, Uint8Array]) : ([t, d] as [string, Uint8Array]),
    ),
  );

it('off-curve-only contours, composites nested over 8 levels and subroutines over 10 levels stop without throwing', () => {
  expect(MAX_COMPONENT_DEPTH).toBe(8);

  // A contour with no on-curve point is drawn from the midpoints of its off-curve points.
  const offCurve = glyphFont([
    simpleGlyph([
      [
        { x: 0, y: 0, on: false },
        { x: 100, y: 0, on: false },
        { x: 100, y: 100, on: false },
        { x: 0, y: 100, on: false },
      ],
    ]),
  ]);
  const drawn = openGlyphs(offCurve).draw(0);
  expect(drawn.truncated).toBe(false);
  expect(drawn.contours).toHaveLength(1);
  expect(drawn.contours[0]!.map((s) => s[0])).toEqual(['Q', 'Q', 'Q', 'Q']);
  expect(drawn.contours[0]!.map((s) => s[s.length - 1])).toEqual([
    [50, 0],
    [100, 50],
    [50, 100],
    [0, 50],
  ]);

  // Components nest to depth 8 and no further: a leaf at depth 8 is drawn, one at depth 9 flags the glyph.
  const chain = (links: number): Uint8Array[] => [
    ...Array.from({ length: links }, (_, i) => compositeGlyph([{ glyph: i + 1 }])),
    simpleGlyph([rectangle(0, 0, 10, 10)]),
  ];
  const ok = openGlyphs(glyphFont(chain(MAX_COMPONENT_DEPTH))).draw(0);
  expect(ok.truncated).toBe(false);
  expect(ok.contours).toHaveLength(1);
  const deep = openGlyphs(glyphFont(chain(MAX_COMPONENT_DEPTH + 1))).draw(0);
  expect(deep.truncated).toBe(true);
  const deeper = openGlyphs(glyphFont(chain(40))).draw(0);
  expect(deeper.truncated).toBe(true);
  // A glyph that is its own component, and two that name each other.
  expect(openGlyphs(glyphFont([compositeGlyph([{ glyph: 0 }])])).draw(0).truncated).toBe(true);
  const loop = openGlyphs(glyphFont([compositeGlyph([{ glyph: 1 }]), compositeGlyph([{ glyph: 0 }])]));
  expect(loop.draw(0).truncated).toBe(true);
  expect(loop.draw(1).truncated).toBe(true);
  // More components than the cap, and more points than the cap.
  const wide = compositeGlyph(Array.from({ length: MAX_COMPONENTS + 36 }, () => ({ glyph: 1 })));
  const wideDrawn = openGlyphs(glyphFont([wide, simpleGlyph([rectangle(0, 0, 10, 10)])])).draw(0);
  expect(wideDrawn.truncated).toBe(true);
  const points = Array.from({ length: MAX_GLYPH_POINTS + 10 }, (_, i) => ({
    x: i % 1000,
    y: Math.floor(i / 1000),
    on: true,
  }));
  const manyPoints = openGlyphs(glyphFont([simpleGlyph([points])])).draw(0);
  expect(manyPoints.truncated).toBe(true);
  // A glyph whose data runs past the glyf table is flagged unreadable, and the glyph before it still draws.
  const cut = glyphFont([simpleGlyph([rectangle(0, 0, 10, 10)]), simpleGlyph([rectangle(0, 0, 20, 20)])]);
  const cutTables = tablesOf(cut).map(([t, d]) =>
    t === 'glyf' ? ([t, d.slice(0, 40)] as [string, Uint8Array]) : ([t, d] as [string, Uint8Array]),
  );
  const cutFont = buildSfnt(0x00010000, cutTables);
  const cutSource = openGlyphs(cutFont);
  expect(cutSource.draw(0).contours).toHaveLength(1);
  expect(cutSource.draw(1).unreadable).toBe(true);
  expect(() => cutSource.draw(1)).not.toThrow();
  expect(cutSource.draw(99).contours).toEqual([]);

  // CFF: a subroutine that calls itself stops at depth 10, and a wide tree of calls stops at the step cap, both drawn as far as
  // they got and flagged. Subroutine index 0 is called by the operand -107 (the bias is 107 for a short list).
  const call = (index: number): number[] => [...cs(index - 107), 10];
  const cffFont = (programs: number[][], subrs: number[][]): Uint8Array =>
    buildSfnt(0x4f54544f, [
      ['head', headTable()],
      ['maxp', maxpTable(programs.length)],
      ['CFF ', cffTable(programs, { subrs })],
    ]);
  const recursive = openGlyphs(cffFont([[...cs(100), ...cs(0), 21, ...call(0), 14]], [[...call(0), 11]])).draw(0);
  expect(recursive.truncated).toBe(true);
  const levels = 7;
  const subrs: number[][] = [];
  for (let level = 0; level < levels - 1; level++)
    subrs.push(
      Array.from({ length: 10 }, () => call(level + 1))
        .flat()
        .concat([11]),
    );
  subrs.push([...cs(5), ...cs(5), 5, 11]);
  const t0 = performance.now();
  const wideTree = openGlyphs(cffFont([[...cs(0), ...cs(0), 21, ...call(0), 14]], subrs)).draw(0);
  expect(wideTree.truncated).toBe(true);
  expect(performance.now() - t0).toBeLessThan(5000);
  expect(MAX_CHARSTRING_STEPS).toBe(200_000);
  // A charstring that is just an operator with nothing on the stack, and one that calls a subroutine that is not there.
  const sloppy = openGlyphs(
    cffFont(
      [
        [21, 5, 8, 14],
        [...call(50), 14],
      ],
      [[11]],
    ),
  );
  expect(() => sloppy.draw(0)).not.toThrow();
  expect(() => sloppy.draw(1)).not.toThrow();
});

it('names and refusals never show more than 40 characters of a name and never repeat input bytes', () => {
  const marker = 'ZQXMARKERZQX';
  const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
  const base = detSans();

  // A family name of 500 characters ending in the marker: the report keeps the text, but the sentences about it stay short.
  const long = `${'N'.repeat(500)}${marker}`;
  const names = nameTable([
    { platform: 3, encoding: 1, language: 0x409, id: 1, raw: utf16be(long) },
    { platform: 3, encoding: 1, language: 0x409, id: 4, raw: utf16be(long) },
    { platform: 3, encoding: 1, language: 0x409, id: 13, raw: utf16be(`${marker} licence`) },
  ]);
  const marked = replaceTable(base, 'name', names);
  const report = inspectFont(marked, {});
  expect(report.font.family).toBe(long);
  expect(report.grid.alt.length).toBeLessThan(260);
  expect(report.grid.alt).not.toContain(marker);
  expect(report.grid.alt.split('N').length - 1).toBeLessThanOrEqual(40);
  for (const note of report.notes) expect(note.text).not.toContain(marker);
  expect(visible(long, 40).length).toBeLessThanOrEqual(41);

  // The marker as table tags, as table data and in every cut of a font: no sentence, note or label repeats it.
  const seen: string[] = [];
  const check = (bytes: Uint8Array): void => {
    try {
      const r = inspectFont(bytes, {});
      for (const n of r.notes) seen.push(n.text);
      seen.push(r.grid.alt, r.grid.note ?? '');
    } catch (err) {
      expect(err).toBeInstanceOf(FontInspectorError);
      seen.push((err as Error).message);
    }
  };
  const tagged = buildSfnt(0x00010000, [
    ...tablesOf(marked),
    ['ZQXM', Uint8Array.from(ascii(marker))],
    ['ARKE', Uint8Array.from(ascii(marker))],
  ]);
  check(tagged);
  for (let cut = 0; cut < marked.length; cut += 11) check(marked.slice(0, cut));
  for (let cut = 0; cut < tagged.length; cut += 7) check(tagged.slice(0, cut));
  for (let at = 0; at < marked.length; at += 13) {
    const damaged = marked.slice();
    damaged[at] = damaged[at]! ^ 0xff;
    check(damaged);
  }
  expect(seen.length).toBeGreaterThan(50);
  for (const text of seen) {
    expect(text).not.toContain(marker);
    // Not even the start of it: table tags are bytes of the font too, and no sentence names one.
    expect(text).not.toContain(marker.slice(0, 4));
    expect(text.length).toBeLessThan(400);
  }
  // A name table whose records point outside it is a plain phrase, not the bytes.
  const outside = readNameTable(
    concat(u16(0), u16(1), u16(18), u16(3), u16(1), u16(0x409), u16(1), u16(500), u16(100), ascii(marker)),
    0,
    30,
  );
  expect(outside.records[0]!.text).toBeNull();
  expect(outside.records[0]!.undecoded).toBe('string outside the table');
  expect(JSON.stringify(outside)).not.toContain(marker);
  // Container and WOFF faults name no bytes either.
  for (const bytes of [bytesOf(`${marker}${'x'.repeat(40)}`), concat(ascii('wOFF'), new Array(60).fill(0x41))]) {
    for (const fn of [() => readContainer(bytes), () => unwrapWoff1(bytes)]) {
      try {
        fn();
      } catch (err) {
        expect((err as Error).message).not.toContain(marker);
      }
    }
  }
  // The package prints nothing.
  for (const spy of logs) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

it('tags and names __proto__, constructor and toString are plain names', () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort();
  const odd = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  // Glyph names from the post table and name records with these strings are ordinary strings.
  const font = replaceTable(
    glyphFont([
      simpleGlyph([rectangle(0, 0, 10, 10)]),
      simpleGlyph([rectangle(0, 0, 10, 10)]),
      simpleGlyph([rectangle(0, 0, 10, 10)]),
      simpleGlyph([rectangle(0, 0, 10, 10)]),
      simpleGlyph([rectangle(0, 0, 10, 10)]),
    ]),
    'head',
    headTable(),
  );
  const withNames = buildSfnt(0x00010000, [
    ...tablesOf(font),
    ['post', postTable2(odd)],
    ['cmap', cmap12(odd.map((_, i) => [0x41 + i, 0x41 + i, i] as [number, number, number]))],
    [
      'name',
      nameTable(
        odd.map((name, i) => ({
          platform: 3,
          encoding: 1,
          language: 0x409,
          id: i === 0 ? 1 : 20 + i,
          raw: utf16be(name),
        })),
      ),
    ],
    [
      'GSUB',
      layoutTable([
        { tag: 'toSt', uses: [['cons', 'dflt']] },
        { tag: 'cons', uses: [['__pr', 'toSt']] },
      ]),
    ],
  ]);
  const report = inspectFont(withNames, {});
  expect(report.grid.rows.map((r) => r.name)).toEqual(odd);
  expect(report.font.family).toBe('__proto__');
  expect(report.names.map((n) => n.text)).toEqual(odd);
  expect(report.features.map((f) => f.tag).sort()).toEqual(['cons', 'toSt']);
  expect(report.features.find((f) => f.tag === 'cons')!.uses).toEqual(['__pr/toSt']);
  expect(report.features.find((f) => f.tag === 'toSt')!.uses).toEqual(['cons/dflt']);
  // The code point mapped to glyph 0 (U+0041 here) is not counted: glyph 0 is the missing glyph.
  expect(report.coverage.total).toBe(4);
  // Nothing was added to the shared prototype, and no plain object picked up a field.
  expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  expect(({} as Record<string, unknown>)['toSt']).toBeUndefined();
});

/** Runs a reader on a hostile input family and judges the ratio of its time as the input doubles and when it grows four times. */
function linear(label: string, fn: (text: string) => unknown, make: (n: number) => string, n: number): void {
  const judge = (): [number, number] => {
    const a = scalingRatio(fn, make, n);
    const b = scalingRatio(fn, make, 2 * n);
    return [a, a * b];
  };
  let [double, quadruple] = judge();
  if (double > MAX_SCALING_RATIO || quadruple > 2 * MAX_SCALING_RATIO) {
    // Measure twice more and judge the median of three; the limit itself is never raised.
    const second = judge();
    const third = judge();
    const median = (values: number[]): number => [...values].sort((x, y) => x - y)[1]!;
    double = median([double, second[0], third[0]]);
    quadruple = median([quadruple, second[1], third[1]]);
  }
  expect(double, `${label} doubling`).toBeLessThanOrEqual(MAX_SCALING_RATIO);
  expect(quadruple, `${label} four times`).toBeLessThanOrEqual(2 * MAX_SCALING_RATIO);
}

it('every reader stays linear on hostile input', () => {
  const base = detSans();
  const read = (text: string): unknown => inspectFont(bytesOf(text), {});
  const makeWith =
    (tag: string, build: (n: number) => Uint8Array) =>
    (n: number): string =>
      latin1(replaceTable(base, tag, build(n)));

  // Many name records that all point at one long string (the decode budget caps the work).
  const longString = Uint8Array.from({ length: 600 }, (_, i) => (i % 2 === 0 ? 0 : 0x41));
  linear(
    'name records',
    read,
    makeWith('name', (n) => sharedStringNameTable(n, longString)),
    250,
  );
  // Many cmap groups and many cmap segments.
  linear(
    'cmap groups',
    read,
    makeWith('cmap', (n) =>
      cmap12(Array.from({ length: n }, (_, i) => [i * 2, i * 2, (i % 7) + 1] as [number, number, number])),
    ),
    2500,
  );
  linear(
    'cmap segments',
    read,
    makeWith('cmap', (n) =>
      cmap4([
        ...Array.from({ length: n }, (_, i) => [i * 3 + 1, i * 3 + 1, 1] as [number, number, number]),
        [0xffff, 0xffff, 1],
      ]),
    ),
    1500,
  );
  // Many features and many languages of one script.
  linear(
    'features',
    read,
    makeWith('GSUB', (n) =>
      layoutTable(
        Array.from({ length: n }, (_, i) => ({
          tag: `f${String(i % 1000).padStart(3, '0')}`,
          uses: [['latn', 'dflt']] as [string, string][],
        })),
      ),
    ),
    400,
  );
  linear(
    'languages',
    read,
    makeWith('GSUB', (n) =>
      layoutTable([
        {
          tag: 'liga',
          uses: Array.from(
            { length: n },
            (_, i) => ['latn', `L${i.toString(36).padStart(3, '0')}`] as [string, string],
          ),
        },
      ]),
    ),
    1000,
  );
  // Many tables in the directory.
  linear(
    'tables',
    read,
    (n) =>
      latin1(
        buildSfnt(0x00010000, [
          ...tablesOf(base),
          ...Array.from(
            { length: n },
            (_, i) => [`T${String(i).padStart(3, '0')}`, new Uint8Array(8)] as [string, Uint8Array],
          ),
        ]),
      ),
    50,
  );
  // Many glyph names in the post table, and many glyphs.
  linear(
    'glyph names',
    read,
    makeWith('post', (n) => postTable2(Array.from({ length: n }, (_, i) => `g${i}`))),
    1000,
  );
  linear(
    'glyphs',
    (text) => inspectFont(bytesOf(text), { glyphCount: 512 }),
    (n) => latin1(glyphFont(Array.from({ length: n }, () => new Uint8Array(0)))),
    100,
  );
  // Sample text of every hostile shape, up to the cap.
  for (const [i, shape] of HOSTILE.entries()) {
    linear(`sample ${i}`, (text) => inspectFont(base, { sample: text }), shape, 500);
  }
  // A WOFF with many tables and a collection with many members.
  linear(
    'woff tables',
    (text) => unwrapWoff1(bytesOf(text)),
    (n) => {
      const count = Math.min(n, 500);
      const total = 44 + 20 * count + 4 * count;
      const out = new Uint8Array(total);
      const view = new DataView(out.buffer);
      view.setUint32(0, 0x774f4646);
      view.setUint32(4, 0x00010000);
      view.setUint32(8, total);
      view.setUint16(12, count);
      for (let i = 0; i < count; i++) {
        const e = 44 + 20 * i;
        out.set(ascii(`T${String(i).padStart(3, '0')}`), e);
        view.setUint32(e + 4, 44 + 20 * count + 4 * i);
        view.setUint32(e + 8, 4);
        view.setUint32(e + 12, 4);
      }
      return latin1(out);
    },
    60,
  );
});

it('a cmap that claims more groups than the cap or than its bytes allow is refused before any array is sized', () => {
  expect(MAX_CMAP_GROUPS).toBe(200_000);
  const started = performance.now();
  for (const claimed of [0xffffffff, 4_000_000_000, 200_001]) {
    const table = cmap12Lying(claimed);
    const result = readCmap(table, 0, table.length);
    expect(result.map.size).toBe(0);
    expect(result.notes.join(' ')).toContain('more than the 200,000 this page reads');
  }
  // Within the cap but past the bytes of the subtable: refused as not having room.
  const lying = cmap12Lying(200_000);
  expect(readCmap(lying, 0, lying.length).notes.join(' ')).toContain('more groups than it has room for');
  // Exactly 200,000 groups that are really there are read, one code point each.
  const real = cmap12(
    Array.from({ length: 200_000 }, (_, i) => [i + 1, i + 1, (i % 60_000) + 1] as [number, number, number]),
  );
  expect(readCmap(real, 0, real.length).map.size).toBe(200_000);
  // A range of the whole code space many times over is stopped by the step budget, not walked to the end.
  const heavy = cmap12(Array.from({ length: 50 }, () => [0, 0x10ffff, 1] as [number, number, number]));
  const heavyRead = readCmap(heavy, 0, heavy.length);
  expect(heavyRead.notes.join(' ')).toContain('overlapping ranges');
  expect(performance.now() - started).toBeLessThan(10_000);
});
