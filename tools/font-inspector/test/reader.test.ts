import { describe, expect, it } from 'vitest';
import { FontInspectorError, MAX_FILE_BYTES, checkFileSize, inspectFont, readContainer } from '../src/index';
import { buildSfnt, fromBase64, tablesOf } from './helpers';

// The "Det Sans" font: 1,672 bytes built with fontTools 4.64.0 for this project (test/fixtures/build-fonts.py in the
// next commits), sha256 3431095620caa514fe33801cacc7913420e5d22b9ef03427009615560320c227. Seven glyphs, 1000 units per
// em, the features liga and kern, and a CC0 statement in name ID 13.
const DET_SANS =
  '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';

const detSans = (): Uint8Array => fromBase64(DET_SANS);
const MIB20 = 20 * 1024 * 1024;

describe('reading the container of a font and the first part of its report', () => {
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
    let error: unknown;
    try {
      readContainer(over);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(FontInspectorError);
    expect((error as FontInspectorError).field).toBe('File');
    expect((error as FontInspectorError).message).toContain('20 MiB');
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
  });
});
