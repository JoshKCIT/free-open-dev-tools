import { expect, it } from 'vitest';
import { convertFont, verifyConversion } from '../src/index';
import { woff2Compress, woff2Decompress } from '../src/engine';
import { fontBytes } from './fixtures/fonts';
import { tablesOf } from './helpers';

/*
 * Conversion (INSP-05). The engine is given to the package by the caller, so these tests pass the real one in-process. The
 * checks here read the converted file with the test's own table reader (helpers.ts) and never with the package's.
 */

const engine = { woff2Compress, woff2Decompress };

const hex = (bytes: Uint8Array, count: number): string => Buffer.from(bytes.subarray(0, count)).toString('hex');

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
