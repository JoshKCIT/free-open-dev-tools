import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  BLOCKS,
  FontInspectorError,
  MAX_SAMPLE_CHARS,
  UNICODE_VERSION,
  blockCoverage,
  checkSample,
  describeFeature,
  inspectFont,
  isRegisteredFeature,
} from '../src/index';
import { makeBlocksSource } from './fixtures/unicode/make-blocks.mjs';
import { fontBytes } from './fixtures/fonts';

const blocksFile = new URL('./fixtures/unicode/Blocks-17.0.0.txt', import.meta.url);

/*
 * Coverage by Unicode block (Unicode 17.0.0, Blocks-17.0.0.txt) and the sample text. A code point is counted once, whatever
 * its position; a character outside the Basic Multilingual Plane is one character, not two.
 */
it('coverage uses the 346 blocks of Unicode 17.0.0 and the sample text counts code points', () => {
  // The vendored file is the original, and the table is exactly what the generator makes of it.
  const raw = readFileSync(blocksFile);
  expect(createHash('md5').update(raw).digest('hex')).toBe('bbb54bbda639796d4d0e9344e537d892');
  expect(UNICODE_VERSION).toBe('17.0.0');
  expect(BLOCKS).toHaveLength(346);
  const generated = makeBlocksSource(raw.toString('utf8'), '17.0.0');
  expect(readFileSync(new URL('../src/blocks.ts', import.meta.url), 'utf8')).toBe(generated);
  const parsed = raw
    .toString('utf8')
    .split(/\r?\n/)
    .filter((l) => /^[0-9A-F]/.test(l))
    .map((l) => {
      const m = /^([0-9A-F]+)\.\.([0-9A-F]+); (.+)$/.exec(l)!;
      return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), m[3]!];
    });
  expect(BLOCKS.map((b) => [...b])).toEqual(parsed);
  // Blocks are in order and never overlap.
  for (let i = 1; i < BLOCKS.length; i++) expect(BLOCKS[i]![0]).toBeGreaterThan(BLOCKS[i - 1]![1]);

  // Each covered code point counts once, even when it is listed twice; the order does not matter.
  const coverage = blockCoverage([0x41, 0x41, 0x42, 0xe9, 0x4e2d, 0x1f600, 0xe0080, 0x20, 0x4e2d]);
  expect(coverage.total).toBe(7);
  const byName = new Map(coverage.blocks.map((b) => [b.name, b]));
  expect(byName.get('Basic Latin')).toMatchObject({ covered: 3, size: 128, first: 0, last: 0x7f });
  expect(byName.get('Latin-1 Supplement')!.covered).toBe(1);
  expect(byName.get('CJK Unified Ideographs')!.covered).toBe(1);
  expect(byName.get('Emoticons')!.covered).toBe(1);
  // 0xE0080 lies between two blocks and is counted outside any block.
  expect(coverage.outsideBlocks).toBe(1);
  expect(coverage.blocks.reduce((sum, b) => sum + b.covered, 0) + coverage.outsideBlocks).toBe(coverage.total);
  expect(coverage.blocks.map((b) => b.first)).toEqual([...coverage.blocks.map((b) => b.first)].sort((a, b) => a - b));
  expect(blockCoverage([]).total).toBe(0);
  expect(blockCoverage([]).blocks).toEqual([]);
  // The first and last code points of a block, and the very last code point of Unicode.
  const edges = blockCoverage([0x7f, 0x80, 0x10ffff, 0x100000]);
  expect(edges.blocks.map((b) => [b.name, b.covered])).toEqual([
    ['Basic Latin', 1],
    ['Latin-1 Supplement', 1],
    ['Supplementary Private Use Area-B', 2],
  ]);

  // The real font: coverage by block from its cmap.
  const report = inspectFont(fontBytes('plain.ttf'), {});
  expect(report.coverage.total).toBe(11);
  expect(report.coverage.blocks.find((b) => b.name === 'Basic Latin')!.covered).toBe(6);
  expect(report.coverage.blocks.find((b) => b.name === 'Alphabetic Presentation Forms')!.covered).toBe(1);

  // The sample text: code points, not UTF-16 units.
  const text = `A${String.fromCodePoint(0x1f600)}é${String.fromCodePoint(0x10ffff)}A`;
  expect(text.length).toBe(7);
  const map = new Map<number, number>([
    [0x41, 1],
    [0x1f600, 2],
    [0xe9, 3],
  ]);
  const sample = checkSample(text, map);
  expect(sample.characters).toBe(5);
  expect(sample.distinct).toBe(4);
  expect(sample.coveredDistinct).toBe(3);
  expect(sample.missing).toEqual([{ codePoint: 0x10ffff, text: String.fromCodePoint(0x10ffff) }]);
  expect(sample.missingCount).toBe(1);
  expect(checkSample('', map).characters).toBe(0);
  // A lone surrogate is one code point too, never a thrown error.
  expect(checkSample('\ud800', map).characters).toBe(1);

  // Up to 10,000 characters are checked; one more is refused naming the field. Characters beyond the BMP count once each.
  expect(MAX_SAMPLE_CHARS).toBe(10_000);
  const emoji = String.fromCodePoint(0x1f600);
  expect(checkSample(emoji.repeat(10_000), map).characters).toBe(10_000);
  let refusal: unknown;
  try {
    checkSample(emoji.repeat(10_001), map);
  } catch (err) {
    refusal = err;
  }
  expect(refusal).toBeInstanceOf(FontInspectorError);
  expect((refusal as FontInspectorError).field).toBe('Check these characters');
  // The report passes the sample on and lists what the font lacks, at most 100 of them.
  const lacking = Array.from({ length: 300 }, (_, i) => String.fromCodePoint(0x3000 + i)).join('');
  const sampled = inspectFont(fontBytes('plain.ttf'), { sample: `A${lacking}` });
  expect(sampled.sample!.missingCount).toBe(300);
  expect(sampled.sample!.missing).toHaveLength(100);
  expect(inspectFont(fontBytes('plain.ttf'), {}).sample).toBeNull();
});

/** The 124 feature tags the OpenType 1.9.1 feature list names one by one (cvXX and ssXX are patterns, read at the feature list page). */
const REGISTERED =
  'aalt abvf abvm abvs afrc akhn apkn blwf blwm blws calt case ccmp cfar chws cjct clig cpct cpsp cswh curs c2pc c2sc dist dlig dnom dtls expt falt fin2 fin3 fina flac frac fwid half haln halt hist hkna hlig hngl hojo hwid init isol ital jalt jp78 jp83 jp90 jp04 kern lfbd liga ljmo lnum locl ltra ltrm mark med2 medi mgrk mkmk mset nalt nlck nukt numr onum opbd ordn ornm palt pcap pkna pnum pref pres pstf psts pwid qwid rand rclt rkrf rlig rphf rtbd rtla rtlm ruby rvrn salt sinf size smcp smpl ssty stch subs sups swsh titl tjmo tnam tnum trad twid unic valt vapk vatu vchw vert vhal vjmo vkna vkrn vpal vrt2 vrtr zero'.split(
    ' ',
  );

it('every registered feature tag has a description and cvXX and ssXX are read as patterns', () => {
  expect(REGISTERED).toHaveLength(124);
  expect(new Set(REGISTERED).size).toBe(124);
  for (const tag of REGISTERED) {
    expect(isRegisteredFeature(tag), tag).toBe(true);
    const text = describeFeature(tag);
    expect(text.length, tag).toBeGreaterThan(10);
    expect(text.endsWith('.'), tag).toBe(false);
  }
  // Every description is a different sentence of the project's own (no two registry rows share one).
  expect(new Set(REGISTERED.map(describeFeature)).size).toBe(124);

  // Patterns: cv01 to cv99 and ss01 to ss20.
  for (let n = 1; n <= 99; n++) {
    const tag = `cv${String(n).padStart(2, '0')}`;
    expect(isRegisteredFeature(tag), tag).toBe(true);
    expect(describeFeature(tag), tag).toContain(`Character variant ${n}`);
  }
  for (let n = 1; n <= 20; n++) {
    const tag = `ss${String(n).padStart(2, '0')}`;
    expect(isRegisteredFeature(tag), tag).toBe(true);
    expect(describeFeature(tag), tag).toContain(`Stylistic set ${n}`);
  }
  // Outside the patterns and the list: no description, never an inherited one.
  for (const tag of [
    'cv00',
    'cv100',
    'ss00',
    'ss21',
    'xxxx',
    'Liga',
    '',
    'constructor',
    'toString',
    '__proto__',
    'hasOwnProperty',
  ]) {
    expect(isRegisteredFeature(tag), tag).toBe(false);
    expect(describeFeature(tag), tag).toBe('');
  }
  // The report names the features of a font with their descriptions.
  const report = inspectFont(fontBytes('plain.ttf'), {});
  const liga = report.features.find((f) => f.tag === 'liga')!;
  expect(liga.description).toBe(describeFeature('liga'));
  expect(liga.tables).toEqual(['GSUB']);
  expect(liga.uses).toEqual(['DFLT/dflt', 'latn/TRK ', 'latn/dflt']);
  expect(report.features.find((f) => f.tag === 'kern')!.tables).toEqual(['GPOS']);
  expect(report.features.find((f) => f.tag === 'ss01')!.description).toContain('Stylistic set 1');
});
