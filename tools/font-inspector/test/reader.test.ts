import { expect, it } from 'vitest';
import {
  DEFAULT_GLYPHS_PER_GRID,
  FontInspectorError,
  MAX_FILE_BYTES,
  MAX_GLYPHS_PER_GRID,
  checkFileSize,
  inspectFont,
  readContainer,
  readSfntFont,
} from '../src/index';
import { fontBytes } from './fixtures/fonts';
import { buildSfnt, tablesOf } from './helpers';
import { glyphFont, rectangle, simpleGlyph } from './tables';

// The "Det Sans" font: 1,672 bytes built with fontTools 4.64.0 for this project (test/fixtures/build-fonts.py), sha256
// 3431095620caa514fe33801cacc7913420e5d22b9ef03427009615560320c227. Seven glyphs, 1000 units per em, the features liga
// and kern, and a CC0 statement in name ID 13.
const detSans = (): Uint8Array => fontBytes('det-sans.ttf');
const MIB20 = 20 * 1024 * 1024;

function failure(fn: () => unknown): FontInspectorError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(FontInspectorError);
    return err as FontInspectorError;
  }
  throw new Error('expected a FontInspectorError');
}

it('a file of exactly 20 MiB is read and one byte more is refused before reading', () => {
  expect(MAX_FILE_BYTES).toBe(MIB20);

  // A real font padded with one extra table to exactly 20 MiB is read.
  const base = buildSfnt(0x00010000, [...tablesOf(detSans()), ['ZZZZ', new Uint8Array(4)]]);
  const exact = buildSfnt(0x00010000, [...tablesOf(detSans()), ['ZZZZ', new Uint8Array(4 + MIB20 - base.length)]]);
  expect(exact.length).toBe(MIB20);
  expect(() => checkFileSize(exact.length)).not.toThrow();
  const container = readContainer(exact);
  expect(container.kind).toBe('sfnt');
  expect(container.fileSize).toBe(MIB20);
  expect(container.memberCount).toBe(1);

  // One byte more is refused from its size alone: all zeros would otherwise give "not a font", a different sentence.
  const over = new Uint8Array(MIB20 + 1);
  const error = failure(() => readContainer(over));
  expect(error.field).toBe('File');
  expect(error.message).toContain('20 MiB');
  expect(() => checkFileSize(MIB20 + 1)).toThrow(FontInspectorError);
  expect(() => checkFileSize(MIB20)).not.toThrow();
});

it('an empty file and a font without name or cmap tables each give a plain sentence and the rest of the report', () => {
  expect(() => readContainer(new Uint8Array(0))).toThrow('The file is empty.');
  expect(() => readContainer(new Uint8Array([0, 1, 0, 0, 0, 3]))).toThrow(
    'The file is too short to hold a font table directory.',
  );
  expect(() => readContainer(new TextEncoder().encode('this is a text file, not a font'))).toThrow(
    'This file is not a TrueType, OpenType, WOFF or WOFF2 font.',
  );

  const without = buildSfnt(
    0x00010000,
    tablesOf(detSans()).filter(([tag]) => tag !== 'name' && tag !== 'cmap'),
  );
  const report = inspectFont(without, {});
  expect(report.font.glyphCount).toBe(7);
  expect(report.font.unitsPerEm).toBe(1000);
  expect(report.names).toEqual([]);
  expect(report.font.family).toBe('');
  const notes = report.notes.map((n) => n.text);
  expect(notes).toContain('This font has no name table, so it shows no names or licence text.');
  expect(notes).toContain('This font has no cmap table, so it maps no characters to glyphs.');
  // The rest of the report is still there.
  expect(report.tables.map((t) => t.tag)).toContain('glyf');
  expect(report.font.outlineFormat).toBe('TrueType');
  expect(report.metrics.os2?.vendor).toBe('TEST');
  expect(report.grid.shown).toBe(7);
  expect(report.coverage.total).toBe(0);
});

it('the Det Sans font reads its family and the licence description from name ID 13', () => {
  const report = inspectFont(detSans(), {});
  expect(report.font.family).toBe('Det Sans');
  expect(report.font.postScriptName).toBe('DetSans-Regular');
  expect(report.font.glyphCount).toBe(7);
  const licence = report.licence.find((l) => l.id === 13);
  expect(licence?.text).toBe('Test font built for this project, released as CC0-1.0.');
  const licenceUrl = report.licence.find((l) => l.id === 14);
  expect(licenceUrl?.text).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
  // The vendor and licence addresses are text in the report; the package has nothing that could request one.
  expect(typeof licenceUrl?.text).toBe('string');
});

it('table checksums and the checksum adjustment are checked for each table and a bad table never hides the rest', () => {
  const bytes = detSans();
  const font = readSfntFont(bytes, 0, false);
  for (const table of font.tables.values()) expect(table.checksumOk, table.tag).toBe(true);
  expect(font.wholeFileOk).toBe(true);
  expect(inspectFont(bytes, {}).notes.filter((n) => n.tone === 'warn')).toEqual([]);

  // One flipped byte in hmtx: that table fails, every other table passes, the whole file fails, and the report goes on.
  const hmtx = font.tables.get('hmtx')!;
  const damaged = bytes.slice();
  damaged[hmtx.offset + 1] = damaged[hmtx.offset + 1]! ^ 0xff;
  const second = readSfntFont(damaged, 0, false);
  expect([...second.tables.values()].filter((t) => t.checksumOk === false).map((t) => t.tag)).toEqual(['hmtx']);
  expect(second.wholeFileOk).toBe(false);
  const report = inspectFont(damaged, {});
  expect(report.font.family).toBe('Det Sans');
  expect(report.tables.find((t) => t.tag === 'hmtx')?.checksumOk).toBe(false);
  expect(report.notes.map((n) => n.text)).toContain('One table has a checksum that does not match its bytes.');

  // A wrong checksum adjustment: the head table still sums as its directory says (the field counts as zero), the whole file does not.
  const head = font.tables.get('head')!;
  const adjusted = bytes.slice();
  adjusted[head.offset + 8] = adjusted[head.offset + 8]! ^ 0x01;
  const third = readSfntFont(adjusted, 0, false);
  expect(third.tables.get('head')!.checksumOk).toBe(true);
  expect(third.wholeFileOk).toBe(false);
  expect(inspectFont(adjusted, {}).notes.map((n) => n.text)).toContain(
    'The whole-file checksum does not match the checksum adjustment in the head table.',
  );

  // A table that leaves the file is listed and not read; the others are read.
  const cut = bytes.slice();
  const view = new DataView(cut.buffer);
  const directoryIndex = [...font.tables.keys()].indexOf('glyf');
  view.setUint32(12 + 16 * directoryIndex + 12, 0x00ffffff);
  const outside = readSfntFont(cut, 0, false);
  expect(outside.tables.get('glyf')!.inFile).toBe(false);
  expect(outside.tables.get('glyf')!.checksumOk).toBeNull();
  expect(outside.tables.get('name')!.checksumOk).toBe(true);
  const outsideReport = inspectFont(cut, {});
  expect(outsideReport.font.family).toBe('Det Sans');
  expect(outsideReport.notes.map((n) => n.text)).toContain('One table lies outside the file and is not read.');
});

it('a collection is read one member at a time and a member number past the count is refused naming the field', () => {
  const bytes = fontBytes('collection.ttc');
  const container = readContainer(bytes);
  expect(container.kind).toBe('collection');
  expect(container.memberCount).toBe(2);
  expect(container.memberOffsets).toHaveLength(2);
  expect(inspectFont(bytes, { member: 1 }).font.family).toBe('Scratch Sans');
  expect(inspectFont(bytes, { member: 2 }).font.family).toBe('Preview Sans');
  expect(inspectFont(bytes, {}).container.member).toBe(1);

  for (const member of [3, 0, -1, 1.5]) {
    const error = failure(() => inspectFont(bytes, { member }));
    expect(error.field, String(member)).toBe('Font number in a collection');
    expect(error.message).toContain('2 fonts');
  }
  // A single font is a collection of one.
  const single = failure(() => inspectFont(detSans(), { member: 2 }));
  expect(single.field).toBe('Font number in a collection');
  expect(single.message).toContain('1 font;');

  // A collection that states four billion fonts in a few bytes is judged by the bytes that remain, and the list stops at 100.
  const lying = new Uint8Array(32);
  lying.set([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0xff, 0xff, 0xff, 0xff]);
  const lied = readContainer(lying);
  expect(lied.memberOffsets.length).toBeLessThanOrEqual(5);
  expect(lied.notes.length).toBeGreaterThan(0);
  const many = new Uint8Array(12 + 4 * 150);
  many.set([0x74, 0x74, 0x63, 0x66, 0, 1, 0, 0, 0, 0, 0, 150]);
  expect(readContainer(many).memberOffsets).toHaveLength(100);
  expect(readContainer(many).memberCount).toBe(100);
});

it('the glyph grid draws 256 glyphs by default, 512 at most, and 513 is refused naming the field', () => {
  expect(DEFAULT_GLYPHS_PER_GRID).toBe(256);
  expect(MAX_GLYPHS_PER_GRID).toBe(512);
  const empty = new Uint8Array(0);
  const font = glyphFont(Array.from({ length: 600 }, () => empty));
  const report = inspectFont(font, {});
  expect(report.grid.requested).toBe(256);
  expect(report.grid.shown).toBe(256);
  expect(report.grid.total).toBe(600);
  expect(report.grid.rows).toHaveLength(256);
  expect(report.grid.rows[0]!.id).toBe(0);
  expect(report.grid.dataAddress.startsWith('data:image/svg+xml,')).toBe(true);
  expect(inspectFont(font, { glyphCount: 512 }).grid.shown).toBe(512);
  expect(inspectFont(font, { glyphCount: 1 }).grid.shown).toBe(1);
  expect(inspectFont(font, { glyphStart: 590, glyphCount: 256 }).grid.shown).toBe(10);

  for (const glyphCount of [513, 0, -1, 2.5]) {
    const error = failure(() => inspectFont(font, { glyphCount }));
    expect(error.field, String(glyphCount)).toBe('Glyphs to draw');
    expect(error.message).toContain('Glyphs to draw');
    expect(error.message).toContain('1 to 512');
  }
  for (const glyphStart of [-1, 65535, 1.5]) {
    const error = failure(() => inspectFont(font, { glyphStart }));
    expect(error.field, String(glyphStart)).toBe('First glyph');
    expect(error.message).toContain('0 to 65534');
  }
  // 65534 is accepted: it is past the last glyph, so nothing is drawn and a note says so.
  const past = inspectFont(font, { glyphStart: 65534 });
  expect(past.grid.shown).toBe(0);
  expect(past.grid.note).toContain('past the last glyph');
});

it('a font with zero glyphs shows an empty grid with a note, and glyphs with no outline are listed', () => {
  const none = glyphFont([]);
  const report = inspectFont(none, {});
  expect(report.font.glyphCount).toBe(0);
  expect(report.grid.shown).toBe(0);
  expect(report.grid.note).toBe('This font has no glyphs, so there is nothing to draw.');
  expect(report.grid.dataAddress.startsWith('data:image/svg+xml,')).toBe(true);

  // Two glyphs, one with an outline and one without: both are listed, the empty one says so.
  const two = glyphFont([simpleGlyph([rectangle(10, 0, 90, 70)]), new Uint8Array(0)]);
  const rows = inspectFont(two, {}).grid.rows;
  expect(rows.map((r) => r.id)).toEqual([0, 1]);
  expect(rows[0]!.empty).toBe(false);
  expect(rows[1]!.empty).toBe(true);
});
