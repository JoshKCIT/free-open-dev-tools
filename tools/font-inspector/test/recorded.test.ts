import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  ByteReader,
  describeEmbedding,
  openGlyphs,
  pickName,
  readCmap,
  readContainer,
  readFeatures,
  readMetrics,
  readNameTable,
  readSfntFont,
  readVariations,
  tableBytes,
  type SfntFont,
} from '../src/index';
import { fontBytes } from './fixtures/fonts';
import { compositeGlyph, concat, glyphFont, nameTable, rectangle, simpleGlyph, u16, u32, utf16be } from './tables';

/*
 * Grounding (D-233): what fontTools 4.64.0 read from fonts this project builds itself (test/fixtures/build-fonts.py), recorded
 * by test/fixtures/record.py into recorded.json. The package's own reader must give the same answers. Each check of the
 * recording is compared in turn, 45 in all; the tests below also name the rules behind them.
 */

interface Check {
  font: string;
  kind: string;
  value: any;
}
const recorded = JSON.parse(readFileSync(new URL('./fixtures/recorded.json', import.meta.url), 'utf8')) as {
  fontTools: string;
  recordedAt: string;
  macRoman128: string;
  codePages: { encoding: number; codec: string; bytesHex: string; text: string }[];
  checks: Check[];
};

function open(name: string, member = 1): { bytes: Uint8Array; font: SfntFont } {
  const bytes = fontBytes(name);
  const container = readContainer(bytes);
  const offset = container.memberOffsets[member - 1]!;
  return { bytes, font: readSfntFont(bytes, offset, container.kind === 'collection') };
}

const tableAt = (font: SfntFont, tag: string) => {
  const entry = font.tables.get(tag);
  if (!entry) throw new Error(`no ${tag} table`);
  return entry;
};

const sortedJson = (values: unknown[]): string[] => values.map((v) => JSON.stringify(v)).sort();

function namesOf(bytes: Uint8Array, font: SfntFont) {
  const entry = tableAt(font, 'name');
  const table = readNameTable(bytes, entry.offset, entry.length);
  return table.records
    .map((r) => ({ platform: r.platform, encoding: r.encoding, language: r.language, id: r.id, text: r.text }))
    .sort((a, b) => a.platform - b.platform || a.encoding - b.encoding || a.language - b.language || a.id - b.id);
}

function metricsOf(bytes: Uint8Array, font: SfntFont) {
  const m = readMetrics(bytes, font);
  return {
    numGlyphs: m.numGlyphs,
    unitsPerEm: m.head!.unitsPerEm,
    fontRevision: m.head!.fontRevision,
    created: m.head!.created,
    modified: m.head!.modified,
    ascent: m.hhea!.ascent,
    descent: m.hhea!.descent,
    lineGap: m.hhea!.lineGap,
    typoAscender: m.os2!.typoAscender,
    typoDescender: m.os2!.typoDescender,
    typoLineGap: m.os2!.typoLineGap,
    winAscent: m.os2!.winAscent,
    winDescent: m.os2!.winDescent,
    weightClass: m.os2!.weightClass,
    widthClass: m.os2!.widthClass,
    vendor: m.os2!.vendor,
    xHeight: m.os2!.xHeight,
    capHeight: m.os2!.capHeight,
  };
}

function cmapOf(bytes: Uint8Array, font: SfntFont) {
  const entry = tableAt(font, 'cmap');
  return readCmap(bytes, entry.offset, entry.length);
}

function outlinesOf(bytes: Uint8Array, member = 1) {
  const source = openGlyphs(bytes, member);
  const out: Record<string, string[]> = {};
  for (let gid = 0; gid < source.count; gid++) {
    out[String(gid)] = source
      .draw(gid)
      .contours.flat()
      .map((s) => JSON.stringify(s))
      .sort();
  }
  return out;
}

function tagsOf(bytes: Uint8Array, font: SfntFont, tag: 'GSUB' | 'GPOS') {
  const table = readFeatures(bytes, font.tables.get(tag));
  return table ? table.tags : null;
}

function usesOf(bytes: Uint8Array, font: SfntFont, tag: 'GSUB' | 'GPOS') {
  const table = readFeatures(bytes, font.tables.get(tag));
  return table ? Object.fromEntries([...table.uses].sort(([a], [b]) => (a < b ? -1 : 1))) : null;
}

it('the recorded fontTools readings of the built fonts are equal on all 45 checks', () => {
  expect(recorded.fontTools).toBe('4.64.0');
  expect(recorded.recordedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  expect(recorded.checks).toHaveLength(45);
  const seen = new Set<string>();
  for (const check of recorded.checks) {
    const label = `${check.font} ${check.kind}`;
    seen.add(label);
    const [file, member] = check.font.split('#');
    const { bytes, font } = open(file!, member ? Number(member) : 1);
    switch (check.kind) {
      case 'names':
        expect(namesOf(bytes, font), label).toEqual(check.value);
        break;
      case 'cmap': {
        const map = cmapOf(bytes, font).map;
        const mine = Object.fromEntries([...map].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v]));
        expect(mine, label).toEqual(check.value);
        break;
      }
      case 'gsub':
        expect(tagsOf(bytes, font, 'GSUB'), label).toEqual(check.value);
        break;
      case 'gpos':
        expect(tagsOf(bytes, font, 'GPOS'), label).toEqual(check.value);
        break;
      case 'metrics':
        expect(metricsOf(bytes, font), label).toEqual(check.value);
        break;
      case 'embedding':
        expect(describeEmbedding(readMetrics(bytes, font).os2!.fsType).fsType, label).toBe(check.value.fsType);
        break;
      case 'outlines':
        expect(outlinesOf(bytes), label).toEqual(check.value);
        break;
      case 'fvarAxes': {
        const v = readVariations(bytes, font.tables.get('fvar'), null)!;
        expect(
          v.axes.map((a) => ({ tag: a.tag, min: a.min, default: a.default, max: a.max, nameId: a.nameId })),
          label,
        ).toEqual(check.value);
        break;
      }
      case 'fvarInstances': {
        const v = readVariations(bytes, font.tables.get('fvar'), null)!;
        expect(
          v.instances.map((i) => ({
            subfamilyNameId: i.nameId,
            coordinates: Object.fromEntries(i.coordinates.map((c) => [c.tag, c.value])),
          })),
          label,
        ).toEqual(check.value);
        break;
      }
      case 'variationSelectors':
        expect(
          cmapOf(bytes, font).variationSelectors.map((s) => ({
            selector: s.selector,
            defaults: s.defaults,
            nonDefaults: s.nonDefaults,
          })),
          label,
        ).toEqual(check.value);
        break;
      case 'gsubScriptsLanguages':
        expect(usesOf(bytes, font, 'GSUB'), label).toEqual(check.value);
        break;
      case 'gposScriptsLanguages':
        expect(usesOf(bytes, font, 'GPOS'), label).toEqual(check.value);
        break;
      case 'memberCount':
        expect(readContainer(bytes).memberCount, label).toBe(check.value);
        break;
      default:
        throw new Error(`unknown check kind ${check.kind}`);
    }
  }
  expect(seen.size).toBe(45);
});

it('name records decode as UTF-16BE, Mac Roman and the 936, 950 and 949 code pages as the platform and encoding say', () => {
  // All three platforms of the built fonts: Unicode (0), Macintosh (1) and Windows (3, including the UCS-4 encoding 10).
  const { bytes, font } = open('mac-names.ttf');
  const records = namesOf(bytes, font);
  expect(new Set(records.map((r) => r.platform))).toEqual(new Set([0, 1, 3]));
  expect(records.some((r) => r.platform === 3 && r.encoding === 10)).toBe(true);
  expect(pickName(readNameTable(bytes, tableAt(font, 'name').offset, tableAt(font, 'name').length), 1)).toBe(
    'Caf\u00e9 Sans',
  );
  const mac = records.find((r) => r.platform === 1 && r.id === 1);
  expect(mac?.text).toBe('Caf\u00e9 Sans');

  // Mac Roman: every one of the 128 high bytes equals what Python and fontTools decode (0xDB is the euro sign).
  const high = Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i);
  const macTable = nameTable([{ platform: 1, encoding: 0, language: 0, id: 1, raw: high }]);
  const macRead = readNameTable(macTable, 0, macTable.length);
  expect(macRead.records[0]!.text).toBe(recorded.macRoman128);
  expect([...recorded.macRoman128]).toHaveLength(128);
  expect(recorded.macRoman128.charCodeAt(0x5b)).toBe(0x20ac);

  // UTF-16BE, including a character outside the Basic Multilingual Plane (one character, two code units).
  const emoji = String.fromCodePoint(0x1f600);
  const utf = nameTable([
    { platform: 0, encoding: 3, language: 0, id: 1, raw: utf16be(`A${emoji}`) },
    { platform: 3, encoding: 10, language: 0x409, id: 1, raw: utf16be(`B${emoji}`) },
    { platform: 3, encoding: 1, language: 0x409, id: 1, raw: utf16be('C') },
  ]);
  const utfRead = readNameTable(utf, 0, utf.length).records.map((r) => r.text);
  expect(utfRead).toEqual([`A${emoji}`, `B${emoji}`, 'C']);
  expect([...utfRead[0]!]).toHaveLength(2);

  // The Windows legacy code pages: encodings 3, 4 and 5 are gbk (936), big5 (950) and euc-kr (949).
  expect(recorded.codePages.map((c) => c.encoding)).toEqual([3, 4, 5]);
  for (const page of recorded.codePages) {
    const raw = Uint8Array.from(Buffer.from(page.bytesHex, 'hex'));
    const table = nameTable([{ platform: 3, encoding: page.encoding, language: 0x409, id: 1, raw }]);
    expect(readNameTable(table, 0, table.length).records[0]!.text, page.codec).toBe(page.text);
  }

  // A platform and encoding that are not decoded give no text and a fixed phrase, never garbage.
  const odd = nameTable([{ platform: 1, encoding: 7, language: 0, id: 1, raw: [0x41] }]);
  const oddRead = readNameTable(odd, 0, odd.length).records[0]!;
  expect(oddRead.text).toBeNull();
  expect(oddRead.undecoded).toBe('Mac encoding not decoded');
});

it('cmap formats 4, 12 and 14 give the recorded code point to glyph map', () => {
  const { bytes, font } = open('plain.ttf');
  const cmap = cmapOf(bytes, font);
  // fontTools writes the format 4 subtable twice (Unicode platform and Windows platform), then 12 and 14.
  const formats = [...new Set(cmap.subtables.map((s) => s.format))].sort((a, b) => a - b);
  expect(formats).toEqual([4, 12, 14]);
  const expected = recorded.checks.find((c) => c.font === 'plain.ttf' && c.kind === 'cmap')!.value as Record<
    string,
    number
  >;
  expect(Object.fromEntries([...cmap.map].map(([k, v]) => [String(k), v]))).toEqual(expected);
  // The supplementary character comes from the format 12 subtable, the variation selector from format 14.
  expect(cmap.map.get(0x1f600)).toBe(expected[String(0x1f600)]);
  expect(cmap.variationSelectors).toEqual([
    { selector: 0xfe0f, defaults: [0x41], defaultCount: 1, nonDefaults: [[0xe9, 3]], nonDefaultCount: 1 },
  ]);

  // Formats 0 and 6 are read too (hand-made subtables, expected values from the format description).
  const f0 = concat(
    u16(0),
    u16(1),
    u16(3),
    u16(1),
    u32(12),
    u16(0),
    u16(262),
    u16(0),
    Array.from({ length: 256 }, (_, i) => (i === 0x41 ? 5 : 0)),
  );
  expect([...readCmap(f0, 0, f0.length).map]).toEqual([[0x41, 5]]);
  const f6 = concat(
    u16(0),
    u16(1),
    u16(3),
    u16(1),
    u32(12),
    u16(6),
    u16(14),
    u16(0),
    u16(0x2000),
    u16(2),
    u16(7),
    u16(8),
  );
  expect([...readCmap(f6, 0, f6.length).map]).toEqual([
    [0x2000, 7],
    [0x2001, 8],
  ]);
});

it('GSUB and GPOS feature tags with their scripts and languages equal the recording', () => {
  const { bytes, font } = open('plain.ttf');
  const gsub = recorded.checks.find((c) => c.font === 'plain.ttf' && c.kind === 'gsubScriptsLanguages')!.value;
  const gpos = recorded.checks.find((c) => c.font === 'plain.ttf' && c.kind === 'gposScriptsLanguages')!.value;
  expect(usesOf(bytes, font, 'GSUB')).toEqual(gsub);
  expect(usesOf(bytes, font, 'GPOS')).toEqual(gpos);
  expect(tagsOf(bytes, font, 'GSUB')).toEqual(['liga', 'smcp', 'ss01']);
  expect(tagsOf(bytes, font, 'GPOS')).toEqual(['kern']);
  // A script's default language system is 'dflt'; a named one keeps its padded tag as the font states it.
  expect(gsub.liga).toEqual(['DFLT/dflt', 'latn/TRK ', 'latn/dflt']);
  // A font with neither table reads as none, not as an error.
  const preview = open('preview.ttf');
  expect(tagsOf(preview.bytes, preview.font, 'GSUB')).toBeNull();
});

it('TrueType outlines are shifted by lsb minus xMin and CFF charstrings give the recorded segments', () => {
  // The variable font has left side bearings 50 below each glyph's xMin, so every simple glyph is drawn 50 to the left.
  const { bytes, font } = open('variable.ttf');
  const recordedOutlines = recorded.checks.find((c) => c.font === 'variable.ttf' && c.kind === 'outlines')!.value;
  const mine = outlinesOf(bytes);
  expect(mine).toEqual(recordedOutlines);
  const glyf = tableBytes(bytes, font.tables.get('glyf'))!;
  const loca = new ByteReader(tableBytes(bytes, font.tables.get('loca'))!);
  // Glyph 2 ("A") has xMin 100 in its own header and is drawn from x = 50.
  const start = loca.u16(2 * 2) * 2;
  expect(new ByteReader(glyf).i16(start + 2)).toBe(100);
  const xs = mine['2']!.flatMap((s) =>
    JSON.parse(s)
      .slice(1)
      .map((p: number[]) => p[0]!),
  );
  expect(Math.min(...xs)).toBe(50);
  expect(Math.max(...xs)).toBe(450);
  // The plain font has equal bearings and xMin, so nothing moves.
  const plain = open('plain.ttf');
  const plainXs = outlinesOf(plain.bytes)['2']!.flatMap((s) =>
    JSON.parse(s)
      .slice(1)
      .map((p: number[]) => p[0]!),
  );
  expect(Math.min(...plainXs)).toBe(100);

  // CFF: the recorded segments of the five glyphs of the OpenType font, including a curve.
  const cff = open('cff.otf');
  const cffRecorded = recorded.checks.find((c) => c.font === 'cff.otf' && c.kind === 'outlines')!.value;
  expect(outlinesOf(cff.bytes)).toEqual(cffRecorded);
  expect(cffRecorded['3'].some((s: string) => s.startsWith('["C"'))).toBe(true);
});

it('Fixed and F2Dot14 values decode exactly and units per em, ascent and descent are whole numbers as recorded', () => {
  const reader = new ByteReader(
    Uint8Array.from([
      0x00, 0x01, 0x80, 0x00, 0xff, 0xfe, 0x80, 0x00, 0x40, 0x00, 0x20, 0x00, 0xc0, 0x00, 0x7f, 0xff, 0x80, 0x00,
    ]),
  );
  expect(reader.fixed(0)).toBe(1.5);
  expect(reader.fixed(4)).toBe(-1.5);
  expect(reader.f2dot14(8)).toBe(1);
  expect(reader.f2dot14(10)).toBe(0.5);
  expect(reader.f2dot14(12)).toBe(-1);
  expect(reader.f2dot14(14)).toBe(1.99993896484375);
  expect(reader.f2dot14(16)).toBe(-2);

  // fontRevision 1 + 1/256 (Fixed 16.16 0x00010100) and the fvar axis values equal fontTools' floats exactly.
  const plain = open('plain.ttf');
  expect(readMetrics(plain.bytes, plain.font).head!.fontRevision).toBe(1.00390625);
  const variable = open('variable.ttf');
  const axes = readVariations(variable.bytes, variable.font.tables.get('fvar'), null)!.axes;
  expect(axes.map((a) => [a.tag, a.min, a.default, a.max])).toEqual([['wght', 100, 400, 900]]);

  // Whole numbers in every recorded font.
  for (const name of ['plain.ttf', 'mac-names.ttf', 'preview.ttf', 'variable.ttf', 'cff.otf']) {
    const f = open(name);
    const m = readMetrics(f.bytes, f.font);
    for (const value of [m.head!.unitsPerEm, m.hhea!.ascent, m.hhea!.descent, m.hhea!.lineGap, m.numGlyphs!]) {
      expect(Number.isInteger(value), `${name} ${value}`).toBe(true);
    }
  }

  // F2Dot14 composite scales: a component drawn at half size lands where the arithmetic says (0x2000 is 0.5).
  const base = simpleGlyph([rectangle(100, 0, 500, 700)]);
  const half = compositeGlyph([{ glyph: 0, dx: 10, dy: 20, scale: 0.5 }]);
  const stretched = compositeGlyph([{ glyph: 0, scale: [0.5, 0.25] }]);
  const font = glyphFont([base, half, stretched]);
  const source = openGlyphs(font);
  const xsHalf = source
    .draw(1)
    .contours.flat()
    .flatMap((s) => s.slice(1).map((p) => (p as number[])[0]!));
  const ysHalf = source
    .draw(1)
    .contours.flat()
    .flatMap((s) => s.slice(1).map((p) => (p as number[])[1]!));
  expect([Math.min(...xsHalf), Math.max(...xsHalf)]).toEqual([60, 260]);
  expect([Math.min(...ysHalf), Math.max(...ysHalf)]).toEqual([20, 370]);
  const xsStretch = source
    .draw(2)
    .contours.flat()
    .flatMap((s) => s.slice(1).map((p) => (p as number[])[0]!));
  const ysStretch = source
    .draw(2)
    .contours.flat()
    .flatMap((s) => s.slice(1).map((p) => (p as number[])[1]!));
  expect([Math.min(...xsStretch), Math.max(...xsStretch)]).toEqual([50, 250]);
  expect([Math.min(...ysStretch), Math.max(...ysStretch)]).toEqual([0, 175]);
});

it('every fixture font equals its recorded size and sha256, so the recording is of exactly these bytes', async () => {
  const { createHash } = await import('node:crypto');
  const { FONT_FILES } = await import('./fixtures/fonts');
  expect(Object.keys(FONT_FILES)).toHaveLength(11);
  for (const font of Object.values(FONT_FILES)) {
    const bytes = fontBytes(font.file);
    expect(bytes.length, font.file).toBe(font.bytes);
    expect(createHash('sha256').update(bytes).digest('hex'), font.file).toBe(font.sha256);
  }
  // The Det Sans font is the one the live fixture carries (1,672 bytes).
  expect(FONT_FILES['det-sans.ttf']!.sha256).toBe('3431095620caa514fe33801cacc7913420e5d22b9ef03427009615560320c227');
});
