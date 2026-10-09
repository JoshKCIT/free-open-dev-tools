import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { MAX_SHOWN_CHARACTERS, visible } from '../src/index';

/**
 * How `visible` showed every code point and a fixed list of mixed samples, recorded from the module as it was BEFORE the
 * Braille blank (U+2800) was added to the characters shown as escapes (D-243, plan 21-01). `src/limits.ts` is not touched
 * by the commit that adds this file; every later commit that changes it must keep every one of these answers except the
 * one named in INTENDED_CHANGES.
 *
 * The expected answers are the recorded ones, never computed here. Recording is explicit: with RECORD_GOLDEN=1 the file
 * is written when it does not exist; an existing file is never overwritten, so a later run cannot "update" the answers to
 * whatever the new code says. The recording is read with node:fs from a URL next to this file, so the folder still works
 * when copied out alone. Non-ASCII text in the recording is written as JSON escapes so that no invisible character sits in
 * the file, and the samples are built here at run time with String.fromCodePoint.
 */
const GOLDEN = new URL('./fixtures/visible-goldens.json', import.meta.url);

/**
 * The one code point whose display is meant to change: U+2800 BRAILLE PATTERN BLANK draws as an empty cell that looks like
 * a space, so it joins the blank characters shown as an escape (the glob and keyboard tools already do this). Before the
 * change it is shown as itself; after it, as an escape. No other point may differ (D-243).
 */
const INTENDED_CHANGES: readonly number[] = [0x2800];

const LAST_POINT = 0x10ffff;
const cp = (n: number): string => String.fromCodePoint(n);
const BACKSLASH = String.fromCodePoint(92);

interface Sample {
  input: string;
  max: number;
  output: string;
}

interface Golden {
  recordedAt: string;
  head: string;
  /** Every code point whose display is not the character itself, with its display. */
  escaped: [number, string][];
  /** How many code points are shown as themselves (0 to 0x10FFFF, a lone surrogate counted as one point). */
  plainCount: number;
  samples: Sample[];
}

/** The text of one code point the way a name could carry it: a lone surrogate is one code unit. */
function textOf(point: number): string {
  return point >= 0xd800 && point <= 0xdfff ? String.fromCharCode(point) : String.fromCodePoint(point);
}

/** Mixed samples: joiners, direction marks, tag characters, surrogates, look-alike blanks and several length caps. */
function sampleInputs(): { input: string; max: number }[] {
  const long = 'a'.repeat(150);
  const list: { input: string; max: number }[] = [
    { input: 'example.com', max: MAX_SHOWN_CHARACTERS },
    { input: 'a' + cp(0x200d) + 'b' + cp(0x200c) + 'c' + cp(0x2060) + 'd', max: MAX_SHOWN_CHARACTERS },
    { input: 'abc' + cp(0x202e) + 'fed' + cp(0x202c) + '.com', max: MAX_SHOWN_CHARACTERS },
    { input: cp(0x2066) + 'x' + cp(0x2069) + cp(0x200e) + cp(0x200f) + cp(0x061c), max: MAX_SHOWN_CHARACTERS },
    { input: 'a' + cp(0xe0041) + cp(0xe0042) + cp(0xe007f) + 'z', max: MAX_SHOWN_CHARACTERS },
    { input: 'b' + cp(0xfc) + 'cher' + cp(0x1f600) + cp(0x4e2d) + cp(0x6587), max: MAX_SHOWN_CHARACTERS },
    { input: 'a' + String.fromCharCode(0xd800) + 'b' + String.fromCharCode(0xdc00) + 'c', max: MAX_SHOWN_CHARACTERS },
    { input: 'ex' + cp(0xad) + cp(0x200b) + cp(0xfeff) + 'ample' + cp(0xfe0f), max: MAX_SHOWN_CHARACTERS },
    { input: 'sp' + cp(0xa0) + cp(0x3000) + cp(0x2003) + cp(0x3164) + cp(0xffa0) + 'ace', max: MAX_SHOWN_CHARACTERS },
    { input: cp(0x27ff) + cp(0x2801) + cp(0x28ff) + 'braille neighbours', max: MAX_SHOWN_CHARACTERS },
    {
      input: 'tab' + cp(9) + 'line' + cp(10) + 'nul' + cp(0) + 'del' + cp(0x7f) + 'c1' + cp(0x85),
      max: MAX_SHOWN_CHARACTERS,
    },
    { input: 'abcdef', max: 3 },
    { input: 'abcdef', max: 6 },
    { input: 'abcdef', max: 7 },
    { input: 'abcdef', max: 0 },
    { input: '', max: 0 },
    { input: '', max: MAX_SHOWN_CHARACTERS },
    { input: cp(0x1f600).repeat(5), max: 4 },
    { input: 'x' + cp(0x202e) + 'y', max: 1 },
    { input: 'x' + cp(0x202e) + 'y', max: 2 },
    { input: 'x' + cp(0x202e) + 'y', max: 3 },
    { input: cp(0xe0041).repeat(6) + 'end', max: 5 },
    { input: long, max: MAX_SHOWN_CHARACTERS },
    { input: long, max: 150 },
    { input: long, max: 151 },
    { input: ('a' + cp(0x200b)).repeat(60), max: MAX_SHOWN_CHARACTERS },
    { input: BACKSLASH + 'u{200B}' + 'already an escape', max: MAX_SHOWN_CHARACTERS },
  ];
  return list;
}

/** The recording as JSON text with every non-ASCII code unit written as a JSON escape. */
function asciiJson(value: unknown): string {
  return (
    JSON.stringify(value, null, 2).replace(
      /[^\x20-\x7e\n]/g,
      (c) => BACKSLASH + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
    ) + '\n'
  );
}

it('every code point gives the display recorded before the Braille blank was added, except the Braille blank', () => {
  const escaped: [number, string][] = [];
  let plain = 0;
  for (let point = 0; point <= LAST_POINT; point++) {
    const text = textOf(point);
    const shown = visible(text);
    if (shown === text) plain++;
    else escaped.push([point, shown]);
  }
  const samples: Sample[] = sampleInputs().map((s) => ({
    input: s.input,
    max: s.max,
    output: visible(s.input, s.max),
  }));

  if (process.env.RECORD_GOLDEN === '1' && !existsSync(GOLDEN)) {
    const recorded: Golden = {
      recordedAt: new Date().toISOString(),
      head: process.env.GOLDEN_HEAD ?? 'unknown',
      escaped,
      plainCount: plain,
      samples,
    };
    writeFileSync(GOLDEN, asciiJson(recorded));
  }

  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden;
  expect(typeof golden.recordedAt).toBe('string');
  expect(golden.head.length).toBeGreaterThan(0);
  expect(golden.plainCount + golden.escaped.length).toBe(LAST_POINT + 1);

  // Escaped points: the same list, apart from the intended points.
  const keep = (entry: [number, string]): boolean => !INTENDED_CHANGES.includes(entry[0]);
  expect(escaped.filter(keep)).toEqual(golden.escaped.filter(keep));

  // Plain points: the same count, apart from the intended points that were plain when this was recorded.
  const intendedPlainThen = INTENDED_CHANGES.filter((p) => !golden.escaped.some((e) => e[0] === p)).length;
  const intendedPlainNow = INTENDED_CHANGES.filter((p) => visible(textOf(p)) === textOf(p)).length;
  expect(plain - intendedPlainNow).toBe(golden.plainCount - intendedPlainThen);

  // The samples: same inputs (built here) and the same outputs.
  expect(samples.map((s) => ({ input: s.input, max: s.max }))).toEqual(
    golden.samples.map((s) => ({ input: s.input, max: s.max })),
  );
  for (let i = 0; i < samples.length; i++) {
    expect(samples[i]?.output, 'sample ' + String(i + 1)).toBe(golden.samples[i]?.output);
  }
}, 120_000);
