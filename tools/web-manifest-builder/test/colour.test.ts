import { it, expect } from 'vitest';
import { NAMED_COLOURS, parseCssColour, processManifest } from '../src/index';

// Expected values come from CSS Color Module Level 4: the named colour table of section 6.1 (the decimal column), the
// hex notation of section 5, rgb() and hsl() of sections 4 and 7, and the examples in those sections. The 8-bit alpha of
// a browser is not part of the specification, so alpha is compared with a tolerance of one step in 255 here and exactly
// in the browser test against Chromium.

const MANIFEST_URL = 'https://example.com/manifest.webmanifest';
const PAGE_URL = 'https://example.com/';

function srgb(text: string): [number, number, number, number] {
  const result = parseCssColour(text);
  expect(result.kind, text).toBe('srgb');
  if (result.kind !== 'srgb') throw new Error('not sRGB');
  return result.rgba;
}

function closeTo(actual: [number, number, number, number], expected: [number, number, number, number], text: string) {
  expect(actual.slice(0, 3), text).toEqual(expected.slice(0, 3));
  expect(Math.abs((actual[3] ?? 0) - (expected[3] ?? 0)), text).toBeLessThanOrEqual(1 / 255);
}

it('colours are kept only when they parse as sRGB CSS colours and others are reported as ignored', () => {
  // The CSS Color 4 named colour table has 148 names, and rebeccapurple is among them.
  expect(NAMED_COLOURS.size).toBe(148);
  const named: [string, [number, number, number]][] = [
    ['aliceblue', [240, 248, 255]],
    ['antiquewhite', [250, 235, 215]],
    ['red', [255, 0, 0]],
    ['lime', [0, 255, 0]],
    ['rebeccapurple', [102, 51, 153]],
    ['gray', [128, 128, 128]],
    ['grey', [128, 128, 128]],
    ['darkgrey', [169, 169, 169]],
    ['lightgoldenrodyellow', [250, 250, 210]],
    ['yellowgreen', [154, 205, 50]],
  ];
  for (const [name, rgb] of named) {
    expect(NAMED_COLOURS.get(name), name).toEqual(rgb);
    expect(srgb(name), name).toEqual([...rgb, 1]);
    // Names are ASCII case-insensitive.
    expect(srgb(name.toUpperCase()), name).toEqual([...rgb, 1]);
  }
  expect(srgb('AliceBlue')).toEqual([240, 248, 255, 1]);
  expect(srgb('transparent')).toEqual([0, 0, 0, 0]);

  // Hex notation: 3, 4, 6 and 8 digits; each digit of the short forms is doubled.
  expect(srgb('#abc')).toEqual([170, 187, 204, 1]);
  expect(srgb('#ABC')).toEqual([170, 187, 204, 1]);
  expect(srgb('#aabbcc')).toEqual([170, 187, 204, 1]);
  expect(srgb('#0b57d0')).toEqual([11, 87, 208, 1]);
  closeTo(srgb('#abcd'), [170, 187, 204, 221 / 255], '#abcd');
  closeTo(srgb('#aabbccdd'), [170, 187, 204, 221 / 255], '#aabbccdd');
  expect(srgb('#ffffff00')).toEqual([255, 255, 255, 0]);
  expect(srgb('  #fff  ')).toEqual([255, 255, 255, 1]);

  // rgb() and rgba(): comma and space syntax, numbers and percentages, alpha after a slash or a fourth comma value.
  expect(srgb('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1]);
  expect(srgb('rgb(1 2 3)')).toEqual([1, 2, 3, 1]);
  expect(srgb('RGB(1 2 3)')).toEqual([1, 2, 3, 1]);
  expect(srgb('rgba(1 2 3)')).toEqual([1, 2, 3, 1]);
  expect(srgb('rgb(  1  ,  2  ,  3  )')).toEqual([1, 2, 3, 1]);
  expect(srgb('rgb(10%, 20%, 30%)')).toEqual([26, 51, 77, 1]);
  expect(srgb('rgb(300 0 0)')).toEqual([255, 0, 0, 1]);
  expect(srgb('rgb(-5 0 0)')).toEqual([0, 0, 0, 1]);
  expect(srgb('rgb(1e1 2 3)')).toEqual([10, 2, 3, 1]);
  expect(srgb('rgb(none 2 3)')).toEqual([0, 2, 3, 1]);
  expect(srgb('rgb(1.5 2.5 3.5)')).toEqual([2, 3, 4, 1]);
  closeTo(srgb('rgb(1 2 3 / 50%)'), [1, 2, 3, 0.5], 'rgb(1 2 3 / 50%)');
  closeTo(srgb('rgb(1 2 3 / 0.5)'), [1, 2, 3, 0.5], 'rgb(1 2 3 / 0.5)');
  closeTo(srgb('rgba(1, 2, 3, .25)'), [1, 2, 3, 0.25], 'rgba(1, 2, 3, .25)');
  expect(srgb('rgb(0 0 0 / 150%)')).toEqual([0, 0, 0, 1]);
  expect(srgb('rgb(0 0 0 / -1)')).toEqual([0, 0, 0, 0]);

  // hsl() and hsla(): CSS Color 4 section 7 says hsl(120deg 100% 50%) is lime; the legacy comma syntax needs percentages.
  expect(srgb('hsl(120deg 100% 50%)')).toEqual([0, 255, 0, 1]);
  expect(srgb('hsl(120, 100%, 50%)')).toEqual([0, 255, 0, 1]);
  expect(srgb('hsl(0 100% 50%)')).toEqual([255, 0, 0, 1]);
  expect(srgb('hsl(240 100% 50%)')).toEqual([0, 0, 255, 1]);
  expect(srgb('hsl(0 0% 100%)')).toEqual([255, 255, 255, 1]);
  expect(srgb('hsl(0 0% 0%)')).toEqual([0, 0, 0, 1]);
  expect(srgb('hsl(0.5turn 100% 50%)')).toEqual([0, 255, 255, 1]);
  expect(srgb('hsl(180deg 100% 50%)')).toEqual([0, 255, 255, 1]);
  expect(srgb('hsl(200grad 100% 50%)')).toEqual([0, 255, 255, 1]);
  expect(srgb('hsl(-120 100% 50%)')).toEqual([0, 0, 255, 1]);
  expect(srgb('hsl(480 100% 50%)')).toEqual([0, 255, 0, 1]);
  closeTo(srgb('hsla(120 100% 50% / .5)'), [0, 255, 0, 0.5], 'hsla(120 100% 50% / .5)');
  expect(srgb('hsl(120 100 50)')).toEqual([0, 255, 0, 1]);

  // Newer syntax that is valid CSS and sRGB-convertible but not checked here is kept as unchecked.
  for (const text of [
    'lab(50% 0 0)',
    'oklch(0.5 0.1 120)',
    'color(display-p3 1 0 0)',
    'hwb(120 0% 0%)',
    'LCH(1 2 3)',
  ]) {
    expect(parseCssColour(text), text).toEqual({ kind: 'unchecked' });
  }

  // Everything else is invalid.
  const invalid = [
    '',
    '   ',
    'not-a-colour',
    '#',
    '#1',
    '#12',
    '#12345',
    '#1234567',
    '#123456789',
    '#GGG',
    '#12 34 56',
    'red blue',
    'rgb(1 2',
    'rgb(1 2 3',
    'rgb()',
    'rgb(1, 2 3)',
    'rgb(1 2 3 4)',
    'rgb(1 2 3 / )',
    'rgb(1 2 3) x',
    'rgb(10%, 20, 30)',
    'rgb(1 2 3 / 4 / 5)',
    'hsl(120,100,50)',
    'hsl(120 100% 50% 1)',
    'hsl(120foo 100% 50%)',
    'lab(50% 0 0',
    'lab',
    'currentcolor',
    'canvas',
    'inherit',
    'none',
    '__proto__',
    'constructor',
    'toString',
    'light-dark(red, blue)',
    'color-mix(in srgb, red, blue)',
    'var(--x)',
  ];
  for (const text of invalid) expect(parseCssColour(text), JSON.stringify(text)).toEqual({ kind: 'invalid' });

  // As a manifest member: a colour that parses is kept (written in sRGB), others are ignored with a finding, and a
  // colour this page cannot check is kept as written with a warning.
  const result = processManifest({ theme_color: ' #FFF ', background_color: 'not-a-colour' }, MANIFEST_URL, PAGE_URL);
  expect(result.processed.themeColor?.rgba).toEqual([255, 255, 255, 1]);
  expect(result.processed.themeColor?.checked).toBe(true);
  expect(result.processed.backgroundColor).toBeNull();
  const ignored = result.findings.filter((finding) => finding.severity === 'ignored');
  expect(ignored.map((finding) => finding.member)).toEqual(['background_color']);
  expect(ignored[0]?.message).not.toContain('not-a-colour');

  const unchecked = processManifest(
    { theme_color: 'lab(50% 0 0)', background_color: 'transparent' },
    MANIFEST_URL,
    PAGE_URL,
  );
  expect(unchecked.processed.themeColor?.checked).toBe(false);
  expect(unchecked.processed.themeColor?.rgba).toBeNull();
  expect(unchecked.processed.backgroundColor?.rgba).toEqual([0, 0, 0, 0]);
  expect(
    unchecked.findings.filter((finding) => finding.member === 'theme_color').map((finding) => finding.severity),
  ).toEqual(['warning']);
  // A value that is not text is ignored.
  expect(processManifest({ theme_color: 5 }, MANIFEST_URL, PAGE_URL).processed.themeColor).toBeNull();
});
