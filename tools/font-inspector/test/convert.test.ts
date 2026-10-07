import { unzlibSync, zlibSync } from 'fflate';
import { expect, it } from 'vitest';
import {
  FontInspectorError,
  MAX_SFNT_BYTES,
  compareGlyphs,
  convertFont,
  convertSfnt,
  conversionRefusal,
  openGlyphs,
  outputName,
  readContainer,
  readMetrics,
  readSfntFont,
  tableBytes,
  verifyConversion,
  wrapWoff1,
  type ConvertEngine,
  type ConvertTarget,
} from '../src/index';
import { woff2Compress, woff2Decompress } from '../src/engine';
import { fontBytes } from './fixtures/fonts';
import { buildSfnt, sum32, tablesOf } from './helpers';
import { concat, headTable } from './tables';

/*
 * Conversion (INSP-05). The engine is given to the package by the caller, so these tests pass the real one in-process. The
 * checks here read the converted file with the test's own table readers (below and helpers.ts) and never with the package's.
 */

const engine: ConvertEngine = { woff2Compress, woff2Decompress };

const hex = (bytes: Uint8Array, count: number): string => Buffer.from(bytes.subarray(0, count)).toString('hex');
const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
const be16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const be32 = (b: Uint8Array, o: number): number =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const tagAt = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

/** A WOFF 1.0 file read with this test's own code: each table inflated with unzlibSync when its stored size is smaller. */
function woffTables(w: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < be16(w, 12); i++) {
    const e = 44 + 20 * i;
    const offset = be32(w, e + 4);
    const stored = be32(w, e + 8);
    const original = be32(w, e + 12);
    const raw = w.subarray(offset, offset + stored);
    out.set(tagAt(w, e), stored < original ? unzlibSync(raw) : raw.slice());
  }
  return out;
}

/** The tables of a file in any of the three containers, read by code that is not the package's. */
async function tablesAny(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const signature = hex(bytes, 4);
  if (signature === '774f4646') return woffTables(bytes);
  if (signature === '774f4632') return new Map(tablesOf(await woff2Decompress(bytes)));
  return new Map(tablesOf(bytes));
}

/**
 * Compares two table sets: the same tags, every table byte for byte identical except the ones named in `rewritten` (which
 * are only checked for tag), and `head` compared apart from its checksum adjustment (bytes 8 to 11) and, when asked, flag
 * bit 11 (bit 3 of byte 16).
 */
function expectTables(
  actual: Map<string, Uint8Array>,
  expected: Map<string, Uint8Array>,
  options: { rewritten?: string[]; headAdjustment?: boolean; headFlag?: boolean } = {},
): void {
  expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [tag, data] of expected) {
    const got = actual.get(tag)!;
    if (options.rewritten?.includes(tag)) continue;
    if (tag === 'head' && (options.headAdjustment || options.headFlag)) {
      expect(got.length, 'head length').toBe(data.length);
      for (let i = 0; i < data.length; i++) {
        if (got[i] === data[i]) continue;
        const adjustment = options.headAdjustment === true && i >= 8 && i < 12;
        const flag = options.headFlag === true && i === 16 && (got[i]! ^ data[i]!) === 0x08;
        expect(adjustment || flag, `head byte ${i}`).toBe(true);
      }
      continue;
    }
    expect(same(got, data), `table ${tag}`).toBe(true);
  }
}

it('a TrueType font converts to WOFF2 and its re-read check reports every table and glyph equal', async () => {
  const input = fontBytes('det-sans.ttf');
  const converted = await convertFont({ bytes: input, target: 'woff2', fileName: 'det-sans.ttf' }, engine);
  // The saved name is the PostScript name (name ID 6) with the target's extension; the file starts as WOFF2 does.
  expect(converted.name).toBe('DetSans-Regular.woff2');
  expect(converted.target).toBe('woff2');
  expect(hex(converted.bytes, 4)).toBe('774f4632');

  // The test decodes it with the engine's decoder and compares table by table on its own.
  const back = await woff2Decompress(converted.bytes);
  const before = new Map(tablesOf(input));
  const after = new Map(tablesOf(back));
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  const identical = [...before].filter(([tag, data]) => Buffer.from(after.get(tag)!).equals(Buffer.from(data)));
  const different = [...before.keys()].filter((tag) => !identical.some(([t]) => t === tag));
  for (const tag of different) expect(['glyf', 'head', 'loca']).toContain(tag);
  expect(identical.length).toBeGreaterThanOrEqual(before.size - 3);

  // head differs only in the four checksum adjustment bytes and in flag bit 11 (0x0800).
  const head0 = before.get('head')!;
  const head1 = after.get('head')!;
  const where: number[] = [];
  for (let i = 0; i < head0.length; i++) if (head0[i] !== head1[i]) where.push(i);
  for (const i of where) expect(i === 16 || (i >= 8 && i < 12)).toBe(true);
  expect(head1[16]! & 0x08).toBe(0x08);

  // The re-read check says the same: nothing wrong, every table but three identical, every glyph compared.
  const report = await verifyConversion(input, converted.bytes, engine);
  expect(report.problems).toEqual([]);
  expect(report.ok).toBe(true);
  expect(report.tablesIdentical).toBe(identical.length);
  const numGlyphs = (before.get('maxp')![4]! << 8) | before.get('maxp')![5]!;
  expect(numGlyphs).toBeGreaterThan(0);
  expect(report.glyphsCompared).toBe(numGlyphs);
  const byDesign = report.byDesign.join(' ');
  expect(byDesign).toContain('head');
  expect(byDesign).toContain('glyf');
});

const SFNT_FONTS = ['det-sans.ttf', 'plain.ttf', 'mac-names.ttf', 'preview.ttf', 'variable.ttf', 'cff.otf'];
const KINDS = ['sfnt', 'woff', 'woff2'] as const;
const SIGNATURE: Record<ConvertTarget, string> = { sfnt: '', woff: '774f4646', woff2: '774f4632' };

it('every pair of sfnt, WOFF and WOFF2 converts and reads back with byte-identical tables except head, glyf and loca', async () => {
  let pairs = 0;
  for (const name of SFNT_FONTS) {
    const font = fontBytes(name);
    const original = new Map(tablesOf(font));
    const inputs = { sfnt: font, woff: wrapWoff1(font), woff2: await woff2Compress(font) };
    // What the font is once it has been through WOFF2: the tables the WOFF2 file carries.
    const afterWoff2 = new Map(tablesOf(await woff2Decompress(inputs.woff2)));
    for (const from of KINDS) {
      for (const to of KINDS) {
        if (from === to) continue;
        const label = `${name} ${from} to ${to}`;
        const converted = await convertFont({ bytes: inputs[from], target: to, fileName: name }, engine);
        const read = await tablesAny(converted.bytes);
        // Against the tables the input file carried: every table identical when no WOFF2 layout change is involved (head may
        // only differ in its adjustment for an sfnt made from a WOFF file); head, glyf and loca differ only into WOFF2.
        const carried = from === 'woff2' ? afterWoff2 : original;
        if (to === 'woff2') {
          expectTables(read, carried, { rewritten: ['glyf', 'loca'], headAdjustment: true, headFlag: true });
        } else {
          expectTables(read, carried, { headAdjustment: to === 'sfnt' });
        }
        // Against the font the visitor first had: only head, glyf and loca may differ, and only when WOFF2 is on either side.
        if (from === 'woff2' || to === 'woff2') {
          expectTables(read, original, { rewritten: ['glyf', 'loca'], headAdjustment: true, headFlag: true });
        } else {
          expectTables(read, original, { headAdjustment: to === 'sfnt' });
        }
        // The file is what it says it is, an sfnt output sums to the whole-file value, and the name has the right extension.
        if (to === 'sfnt') {
          expect(sum32(converted.bytes), `${label} whole-file sum`).toBe(0xb1b0afba);
          expect(hex(converted.bytes, 4)).toBe(name.endsWith('.otf') ? '4f54544f' : '00010000');
          expect(converted.name.endsWith(name.endsWith('.otf') ? '.otf' : '.ttf'), label).toBe(true);
        } else {
          expect(hex(converted.bytes, 4), label).toBe(SIGNATURE[to]);
          expect(converted.name.endsWith(`.${to}`), label).toBe(true);
        }
        const report = await verifyConversion(converted.sfnt, converted.bytes, engine);
        expect(report.problems, label).toEqual([]);
        expect(report.ok, label).toBe(true);
        expect(report.tablesIdentical, label).toBeGreaterThanOrEqual(report.tablesTotal - 3);
        pairs++;
      }
    }
  }
  expect(pairs).toBe(SFNT_FONTS.length * 6);

  // fontTools' own WOFF and WOFF2 files, which this package did not write, convert alike (read for their tables only).
  const plain = new Map(tablesOf(fontBytes('plain.ttf')));
  const fromWoff = await convertFont(
    { bytes: fontBytes('plain.woff'), target: 'sfnt', fileName: 'plain.woff' },
    engine,
  );
  expectTables(new Map(tablesOf(fromWoff.bytes)), plain, { headAdjustment: true });
  expect(sum32(fromWoff.bytes)).toBe(0xb1b0afba);
  for (const file of ['plain.woff2', 'with-blocks.woff2']) {
    for (const to of ['sfnt', 'woff'] as const) {
      const converted = await convertFont({ bytes: fontBytes(file), target: to, fileName: file }, engine);
      expectTables(await tablesAny(converted.bytes), plain, {
        rewritten: ['glyf', 'loca'],
        headAdjustment: true,
        headFlag: true,
      });
      const report = await verifyConversion(converted.sfnt, converted.bytes, engine);
      expect(report.problems).toEqual([]);
    }
  }
});

it('after a WOFF2 round trip every glyph compares equal and head differs only in the checksum adjustment and flag bit 11', async () => {
  let glyphs = 0;
  for (const name of SFNT_FONTS) {
    const font = fontBytes(name);
    const back = await woff2Decompress(await woff2Compress(font));
    const before = new Map(tablesOf(font));
    const after = new Map(tablesOf(back));

    // head: the four adjustment bytes and flag bit 11 are the only differences (and the flag really is set).
    const head0 = before.get('head')!;
    const head1 = after.get('head')!;
    expect(head1.length).toBe(head0.length);
    for (let i = 0; i < head0.length; i++) {
      if (head0[i] === head1[i]) continue;
      expect(i >= 8 && i < 12 ? true : i === 16 && (head0[i]! ^ head1[i]!) === 0x08, `${name} head byte ${i}`).toBe(
        true,
      );
    }
    expect(be16(head1, 16) & 0x0800, name).toBe(0x0800);

    // The glyphs, drawn by the tool's own outline reader from both fonts, are equal glyph by glyph.
    const a = openGlyphs(font);
    const b = openGlyphs(back);
    expect(b.count).toBe(a.count);
    for (let g = 0; g < a.count; g++) expect(b.draw(g), `${name} glyph ${g}`).toEqual(a.draw(g));
    glyphs += a.count;

    // And the package's comparison, by value, agrees (TrueType fonts only: a CFF table is one table and stays identical).
    if (before.has('glyf')) {
      const first = readSfntFont(font, 0, false);
      const second = readSfntFont(back, 0, false);
      const numGlyphs = readMetrics(font, first).numGlyphs!;
      const result = compareGlyphs(
        {
          glyf: tableBytes(font, first.tables.get('glyf'))!,
          loca: tableBytes(font, first.tables.get('loca'))!,
          long: be16(head0, 50) === 1,
        },
        {
          glyf: tableBytes(back, second.tables.get('glyf'))!,
          loca: tableBytes(back, second.tables.get('loca'))!,
          long: be16(head1, 50) === 1,
        },
        numGlyphs,
      );
      expect(result.problem, name).toBeNull();
      expect(result.compared).toBe(numGlyphs);
    } else {
      expect(same(after.get('CFF ')!, before.get('CFF ')!)).toBe(true);
    }
  }
  expect(glyphs).toBeGreaterThan(30);
});

/** A WOFF 1.0 file with one table whose compressed bytes and stated original size are given. */
function woffWith(tag: string, compressed: Uint8Array, origLength: number): Uint8Array {
  const dataAt = 64;
  const padded = (compressed.length + 3) & ~3;
  const out = new Uint8Array(dataAt + padded);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4646);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, out.length);
  view.setUint16(12, 1);
  view.setUint32(16, 12 + 16 + ((origLength + 3) & ~3));
  for (let i = 0; i < 4; i++) out[44 + i] = tag.charCodeAt(i);
  view.setUint32(48, dataAt);
  view.setUint32(52, compressed.length);
  view.setUint32(56, origLength);
  out.set(compressed, dataAt);
  return out;
}

/** An engine that counts what it is asked to do, and does it. */
function countingEngine(): { engine: ConvertEngine; calls: { compress: number; decompress: number; sizes: number[] } } {
  const calls = { compress: 0, decompress: 0, sizes: [] as number[] };
  return {
    calls,
    engine: {
      woff2Compress: async (input) => {
        calls.compress++;
        calls.sizes.push(input.length);
        return woff2Compress(input);
      },
      woff2Decompress: async (input) => {
        calls.decompress++;
        return woff2Decompress(input);
      },
    },
  };
}

it('a WOFF2 header that lies about totalSfntSize is capped by the pre-check and never trusted', async () => {
  const font = fontBytes('det-sans.ttf');
  const woff2 = await woff2Compress(font);
  const liar = (size: number): Uint8Array => {
    const copy = woff2.slice();
    new DataView(copy.buffer).setUint32(16, size);
    return copy;
  };
  // A claim of 4 GB and a claim of 30 MiB plus one are refused before the engine is asked to unpack anything.
  for (const claim of [0xfffffff0, MAX_SFNT_BYTES + 1, 1_000_000_000]) {
    const spy = countingEngine();
    await expect(convertFont({ bytes: liar(claim), target: 'sfnt', fileName: 'x.woff2' }, spy.engine)).rejects.toThrow(
      'more than 30 MiB',
    );
    expect(spy.calls.decompress).toBe(0);
  }
  // A claim that is plausible but wrong is not refused on its own (the specification says never to reject on it) and the
  // font that comes out is the font in the file, never a font of the size claimed.
  const spy = countingEngine();
  const wrong = liar(be32(woff2, 16) + 4);
  const read = await convertFont({ bytes: wrong, target: 'sfnt', fileName: 'x.woff2' }, spy.engine).catch(
    (err: unknown) => err,
  );
  if (read instanceof FontInspectorError) {
    expect(read.message.length).toBeGreaterThan(0);
  } else {
    expectTables(new Map(tablesOf((read as { bytes: Uint8Array }).bytes)), new Map(tablesOf(font)), {
      rewritten: ['glyf', 'loca'],
      headAdjustment: true,
      headFlag: true,
    });
  }
  // The same lie in a file this page has just written is a fault of the re-read check, never offered.
  const report = await verifyConversion(font, wrong, engine);
  expect(report.ok).toBe(false);
  const smaller = await verifyConversion(font, liar(be32(woff2, 16) - 4), engine);
  expect(smaller.ok).toBe(false);
  expect(smaller.problems.length).toBeGreaterThan(0);
});

it('a WOFF table that inflates past its stated size stops the streaming inflate at the cap', async () => {
  // 200 MiB of zeros packs to about 200 KB; the table claims a few hundred KB, so the inflate must stop at the claim.
  const bomb = zlibSync(new Uint8Array(200 * 1024 * 1024), { level: 9 });
  const file = woffWith('test', bomb, bomb.length + 1000);
  const spy = countingEngine();
  const t0 = performance.now();
  await expect(convertFont({ bytes: file, target: 'woff2', fileName: 'bomb.woff' }, spy.engine)).rejects.toThrow(
    'inflates to more than its stated size',
  );
  const stopped = performance.now() - t0;
  const t1 = performance.now();
  unzlibSync(bomb);
  const full = performance.now() - t1;
  expect(stopped).toBeLessThan(full / 2);
  expect(spy.calls.compress).toBe(0);
  expect(spy.calls.decompress).toBe(0);
});

it('converting to the same container and converting a collection are refused in plain words', async () => {
  const font = fontBytes('det-sans.ttf');
  const woff = wrapWoff1(font);
  const woff2 = await woff2Compress(font);
  const spy = countingEngine();
  // The same container: a plain sentence naming it, and the engine is never asked.
  await expect(convertFont({ bytes: font, target: 'sfnt' }, spy.engine)).rejects.toThrow(
    'already a TrueType or OpenType file',
  );
  await expect(convertFont({ bytes: woff, target: 'woff' }, spy.engine)).rejects.toThrow('already a WOFF file');
  await expect(convertFont({ bytes: woff2, target: 'woff2' }, spy.engine)).rejects.toThrow('already a WOFF2 file');
  // A collection, in any container, is not converted to anything.
  const collection = fontBytes('collection.ttc');
  const packedCollection = await woff2Compress(collection);
  expect(readContainer(packedCollection).flavor).toBe('collection');
  for (const bytes of [collection, packedCollection]) {
    for (const target of ['sfnt', 'woff', 'woff2'] as const) {
      await expect(convertFont({ bytes, target }, spy.engine), target).rejects.toThrow('collection is not converted');
    }
  }
  expect(spy.calls.compress).toBe(0);
  // Only the compress call above that made the packed collection ran an engine, and it ran outside the spy.
  expect(spy.calls.decompress).toBe(0);
  const refusal = conversionRefusal(readContainer(collection), 'woff2');
  expect(refusal).toContain('collection');
  // Something that is not a font, and a damaged one, are plain sentences too.
  await expect(
    convertFont({ bytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), target: 'woff' }, engine),
  ).rejects.toThrow(FontInspectorError);
  await expect(convertFont({ bytes: new Uint8Array(0), target: 'woff' }, engine)).rejects.toThrow('empty');
  // A font whose directory lists a table twice, or a table outside the file, is not converted.
  const repeated = font.slice();
  repeated.set(repeated.subarray(12, 12 + 4), 12 + 16);
  await expect(convertFont({ bytes: repeated, target: 'woff' }, engine)).rejects.toThrow('same table twice');
  const outside = font.slice();
  new DataView(outside.buffer).setUint32(12 + 8, outside.length + 100);
  await expect(convertFont({ bytes: outside, target: 'woff' }, engine)).rejects.toThrow('lies outside the file');
});

it('the saved name comes from the PostScript name, then family and style, then the file name, cleaned to letters, digits, dots, underscores and hyphens', async () => {
  // PostScript name first, family and style second, the file's own stem third, "font" last.
  expect(outputName({ postScriptName: 'DetSans-Regular', family: 'Other', subfamily: 'Bold' }, 'x.ttf', 'woff2')).toBe(
    'DetSans-Regular.woff2',
  );
  expect(outputName({ family: 'Det Sans', subfamily: 'Bold' }, 'x.ttf', 'woff')).toBe('DetSans-Bold.woff');
  expect(outputName({ family: 'Det Sans' }, 'x.ttf', 'woff')).toBe('DetSans.woff');
  expect(outputName({}, 'my font (1).ttf', 'woff2')).toBe('myfont1.woff2');
  expect(outputName({}, 'C:\\fonts\\a b.otf', 'woff')).toBe('ab.woff');
  expect(outputName({}, '../../etc/passwd', 'woff')).toBe('passwd.woff');
  expect(outputName({}, undefined, 'woff')).toBe('font.woff');
  // The extension follows the target, and the outlines for a TrueType or OpenType file.
  expect(outputName({ postScriptName: 'A' }, undefined, 'sfnt')).toBe('A.ttf');
  expect(outputName({ postScriptName: 'A', cff: true }, undefined, 'sfnt')).toBe('A.otf');
  // Whatever is not in the set is dropped, a source that cleans to nothing gives way to the next, and nothing hidden or reserved
  // is made: no leading dot, no device name, no path, no right-to-left override, no more than 100 characters of stem.
  const rtl = String.fromCodePoint(0x202e);
  expect(outputName({ postScriptName: `evil/../name${rtl}.exe` }, undefined, 'woff2')).toBe('evil..name.exe.woff2');
  expect(outputName({ postScriptName: '###', family: 'Real Family' }, undefined, 'woff2')).toBe('RealFamily.woff2');
  expect(outputName({ postScriptName: String.fromCodePoint(0x65e5, 0x672c) }, 'x.ttf', 'woff')).toBe('x.woff');
  expect(outputName({ postScriptName: '...hidden' }, undefined, 'woff')).toBe('hidden.woff');
  expect(outputName({ postScriptName: 'CON' }, undefined, 'woff')).toBe('_CON.woff');
  expect(outputName({ postScriptName: 'con.txt' }, undefined, 'woff')).toBe('_con.txt.woff');
  expect(outputName({ postScriptName: 'a'.repeat(300) }, undefined, 'woff')).toBe(`${'a'.repeat(100)}.woff`);
  for (const name of ['__proto__', 'constructor', 'toString']) {
    expect(outputName({ postScriptName: name }, undefined, 'woff')).toBe(`${name}.woff`);
  }
  // Whatever the source, the name is only ever made of the set and has exactly the target's extension.
  const hostile = [`a${rtl}b`, 'x\u0000y', '<script>', 'a b\tc', '%00', '`id`', '$(id)', 'a;b'];
  for (const text of hostile) {
    expect(outputName({ postScriptName: text }, text, 'woff2')).toMatch(/^[A-Za-z0-9._-]+\.woff2$/);
  }
  // Through a real conversion: from the font's PostScript name, then (with the name table gone) from the file name.
  const font = fontBytes('det-sans.ttf');
  const named = await convertFont({ bytes: font, target: 'woff', fileName: 'something else.ttf' }, engine);
  expect(named.name).toBe('DetSans-Regular.woff');
  const unnamed = buildSfnt(
    0x00010000,
    tablesOf(font).filter(([tag]) => tag !== 'name'),
  );
  const fromFile = await convertFont({ bytes: unnamed, target: 'woff2', fileName: 'my_font v2.ttf' }, engine);
  expect(fromFile.name).toBe('my_fontv2.woff2');
  // A name table with no usable name at all (all zero bytes) falls back the same way.
  const emptyNames = buildSfnt(
    0x00010000,
    tablesOf(font).map(([tag, data]) => [tag, tag === 'name' ? new Uint8Array(24) : data] as [string, Uint8Array]),
  );
  const fromEmpty = await convertFont({ bytes: emptyNames, target: 'woff', fileName: 'kept.ttf' }, engine);
  expect(fromEmpty.name).toBe('kept.woff');
  // An opened OpenType file with PostScript outlines is named .otf when it is turned back into a plain file.
  const cff = fontBytes('cff.otf');
  const backToSfnt = await convertFont({ bytes: wrapWoff1(cff), target: 'sfnt' }, engine);
  expect(backToSfnt.name.endsWith('.otf')).toBe(true);
});

it('converting the same font twice gives the same bytes', async () => {
  for (const name of SFNT_FONTS) {
    const font = fontBytes(name);
    for (const to of ['woff', 'woff2'] as const) {
      const first = await convertFont({ bytes: font, target: to, fileName: name }, engine);
      const second = await convertFont({ bytes: font, target: to, fileName: name }, engine);
      expect(same(first.bytes, second.bytes), `${name} ${to}`).toBe(true);
      expect(first.name).toBe(second.name);
    }
    // And through a second engine instance of the same module: a converted WOFF2 file converts back to the same sfnt twice.
    const packed = await woff2Compress(font);
    const a = await convertFont({ bytes: packed, target: 'sfnt', fileName: name }, engine);
    const b = await convertFont({ bytes: packed, target: 'sfnt', fileName: name }, engine);
    expect(same(a.bytes, b.bytes)).toBe(true);
  }
});

it('an sfnt of exactly 30 MiB is converted and one byte more is refused before the engine runs', async () => {
  // One table of zeros: 12 + 16 + the table padded to 4 bytes is exactly 30 MiB for 31,457,252 bytes of table. The WOFF file
  // that holds it is tiny, so the 20 MiB file limit does not come into it; the cap that matters is the unpacked size.
  const exactly = MAX_SFNT_BYTES - 28;
  expect(12 + 16 + ((exactly + 3) & ~3)).toBe(MAX_SFNT_BYTES);
  const zlibOf = (n: number): Uint8Array => zlibSync(new Uint8Array(n), { level: 9 });
  const inside = woffWith('padd', zlibOf(exactly), exactly);
  const spy = countingEngine();
  const unpacked = await convertFont({ bytes: inside, target: 'sfnt', fileName: 'big.woff' }, spy.engine);
  expect(unpacked.sfnt.length).toBe(MAX_SFNT_BYTES);
  expect(unpacked.bytes.length).toBe(MAX_SFNT_BYTES);
  // To WOFF2 the engine is asked with exactly 30 MiB (a stand-in answers: only the call is judged here).
  const sizes: number[] = [];
  const standIn: ConvertEngine = {
    woff2Compress: async (input) => {
      sizes.push(input.length);
      return new Uint8Array(64);
    },
    woff2Decompress: async () => new Uint8Array(0),
  };
  const packed = await convertFont({ bytes: inside, target: 'woff2', fileName: 'big.woff' }, standIn);
  expect(sizes).toEqual([MAX_SFNT_BYTES]);
  expect(packed.bytes.length).toBe(64);
  // One byte more of table is four more bytes of padded sfnt: refused from the header's sums, before any inflate and before
  // the engine.
  const past = woffWith('padd', zlibOf(exactly + 1), exactly + 1);
  const sizesPast: number[] = [];
  const watcher: ConvertEngine = {
    woff2Compress: async (input) => {
      sizesPast.push(input.length);
      return new Uint8Array(64);
    },
    woff2Decompress: async () => new Uint8Array(0),
  };
  await expect(convertFont({ bytes: past, target: 'woff2', fileName: 'big.woff' }, watcher)).rejects.toThrow(
    'more than 30 MiB',
  );
  expect(sizesPast).toEqual([]);
  // The same cap holds for an sfnt handed to the conversion directly.
  const oversized = concat([0, 1, 0, 0], new Uint8Array(MAX_SFNT_BYTES + 1 - 4));
  await expect(convertSfnt({ sfnt: oversized, source: 'woff', target: 'woff2' }, watcher)).rejects.toThrow(
    'larger than the 30 MiB',
  );
  expect(sizesPast).toEqual([]);
});

it('an sfnt made from a WOFF file has its head checksum adjustment worked out again for the new layout', async () => {
  // A WOFF file keeps the tables and drops the layout, so the sfnt made from it is laid out afresh and the adjustment, which
  // counts the whole file, is set again; nothing else of head changes.
  const font = fontBytes('plain.ttf');
  const sfnt = (await convertFont({ bytes: wrapWoff1(font), target: 'sfnt' }, engine)).bytes;
  expect(sum32(sfnt)).toBe(0xb1b0afba);
  expectTables(new Map(tablesOf(sfnt)), new Map(tablesOf(font)), { headAdjustment: true });
  // A font whose adjustment was wrong in the opened file comes out right.
  const broken = font.slice();
  const headIndex = [...Array(be16(broken, 4)).keys()].find((i) => tagAt(broken, 12 + 16 * i) === 'head')!;
  const headAt = be32(broken, 12 + 16 * headIndex + 8);
  new DataView(broken.buffer).setUint32(headAt + 8, 0x12345678);
  expect(sum32(broken)).not.toBe(0xb1b0afba);
  const fromBroken = await convertFont({ bytes: wrapWoff1(broken), target: 'sfnt' }, engine);
  expect(sum32(fromBroken.bytes)).toBe(0xb1b0afba);
});

/** A seeded generator (mulberry32), so the random tables of a test are the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('the WOFF 1.0 writer sorts tables by tag, pads to 4 bytes, stores a table uncompressed when that is not larger, and sets totalSfntSize by the formula', () => {
  const random = mulberry32(190606);
  const noise = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => Math.floor(random() * 256));
  // A table for which zlib gives exactly as many bytes as it was given: not smaller, so it must be stored as it is.
  let equalSize: Uint8Array | null = null;
  for (let length = 4; length < 400 && equalSize === null; length++) {
    const candidate = Uint8Array.from({ length }, () => Math.floor(random() * 3));
    if (zlibSync(candidate, { level: 9 }).length === length) equalSize = candidate;
  }
  expect(equalSize, 'a table that zlib does not make smaller').not.toBeNull();
  const tables: [string, Uint8Array][] = [
    ['head', concat(headTable({ fontRevision: 2.5 }))],
    ['zzzz', new Uint8Array(5000)],
    ['aaaa', noise(7)],
    ['cccc', noise(3)],
    ['mmmm', new Uint8Array(0)],
    ['pppp', Uint8Array.from({ length: 601 }, (_, i) => i % 7)],
    ['same', equalSize!],
  ];
  // An sfnt whose directory is out of tag order (fonts in the wild are): reverse the sorted directory, offsets stay valid.
  const ordered = buildSfnt(0x00010000, tables);
  const count = tables.length;
  const entries = Array.from({ length: count }, (_, i) => ordered.slice(12 + 16 * i, 28 + 16 * i)).reverse();
  const scrambled = ordered.slice();
  entries.forEach((entry, i) => scrambled.set(entry, 12 + 16 * i));
  expect(tagAt(scrambled, 12)).not.toBe('aaaa');

  const woff = wrapWoff1(scrambled);
  const view = new DataView(woff.buffer);
  expect(hex(woff, 4)).toBe('774f4646');
  expect(view.getUint32(4)).toBe(0x00010000);
  expect(view.getUint32(8)).toBe(woff.length);
  expect(view.getUint16(12)).toBe(count);
  expect(view.getUint16(14)).toBe(0);
  // The version of the WOFF file follows the head table's revision (2.5 is 2 and 0x8000), and no metadata or private data.
  expect(view.getUint16(20)).toBe(2);
  expect(view.getUint16(22)).toBe(0x8000);
  for (const at of [24, 28, 32, 36, 40]) expect(view.getUint32(at)).toBe(0);

  const directory = Array.from({ length: count }, (_, i) => {
    const e = 44 + 20 * i;
    return {
      tag: tagAt(woff, e),
      offset: view.getUint32(e + 4),
      stored: view.getUint32(e + 8),
      original: view.getUint32(e + 12),
      checksum: view.getUint32(e + 16),
    };
  });
  // Sorted by tag (ascending, as unsigned numbers: the same as the order of the bytes).
  expect(directory.map((d) => d.tag)).toEqual([...directory.map((d) => d.tag)].sort());
  expect(directory.map((d) => d.tag)).toEqual(['aaaa', 'cccc', 'head', 'mmmm', 'pppp', 'same', 'zzzz']);
  // Every table starts on a 4-byte boundary, follows the one before it with only zero padding between, and states unpadded lengths.
  let end = 44 + 20 * count;
  const byTag = new Map(tables);
  for (const d of directory) {
    expect(d.offset % 4, d.tag).toBe(0);
    expect(d.offset, d.tag).toBe(end);
    expect(d.original, d.tag).toBe(byTag.get(d.tag)!.length);
    const padding = woff.subarray(d.offset + d.stored, d.offset + ((d.stored + 3) & ~3));
    expect(
      padding.every((b) => b === 0),
      `${d.tag} padding`,
    ).toBe(true);
    end = d.offset + ((d.stored + 3) & ~3);
  }
  expect(end).toBe(woff.length);
  // A table is stored as it is when compressing would not make it smaller (random, empty and equal-size tables), and
  // compressed when it does (zeros, a pattern).
  const find = (tag: string) => directory.find((d) => d.tag === tag)!;
  for (const tag of ['aaaa', 'cccc', 'mmmm', 'same']) {
    expect(find(tag).stored, `${tag} is stored as it is`).toBe(find(tag).original);
    expect(same(woff.subarray(find(tag).offset, find(tag).offset + find(tag).stored), byTag.get(tag)!), tag).toBe(true);
  }
  for (const tag of ['zzzz', 'pppp']) {
    expect(find(tag).stored, `${tag} is compressed`).toBeLessThan(find(tag).original);
    const inflated = unzlibSync(woff.subarray(find(tag).offset, find(tag).offset + find(tag).stored));
    expect(same(inflated, byTag.get(tag)!), tag).toBe(true);
  }
  // totalSfntSize is 12 + 16 * the number of tables + every table's length rounded up to 4.
  const formula = 12 + 16 * count + tables.reduce((sum, [, data]) => sum + ((data.length + 3) & ~3), 0);
  expect(view.getUint32(16)).toBe(formula);
  // The checksums are the sfnt directory's own, and the file reads back with every table identical.
  for (const d of directory) {
    const padded = new Uint8Array((byTag.get(d.tag)!.length + 3) & ~3 || 0);
    padded.set(byTag.get(d.tag)!);
    if (d.tag === 'head') padded.fill(0, 8, 12);
    expect(d.checksum, d.tag).toBe(sum32(padded));
  }
  expectTables(woffTables(woff), new Map(tablesOf(scrambled)));
  // The same bytes every time, and an sfnt the writer cannot hold is refused in plain words.
  expect(same(wrapWoff1(scrambled), woff)).toBe(true);
  expect(() => wrapWoff1(Uint8Array.from([0, 1, 0, 0, 0, 0]))).toThrow('too short');
  expect(() => wrapWoff1(concat([1, 2, 3, 4], new Uint8Array(20)))).toThrow('not a TrueType or OpenType font');
  expect(() => wrapWoff1(fontBytes('collection.ttc'))).toThrow('not a TrueType or OpenType font');
});
