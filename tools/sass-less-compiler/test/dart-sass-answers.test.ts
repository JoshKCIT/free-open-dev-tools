import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compileStylesheet } from '../src/index';

/**
 * The two answers that changed when the compiler moved from Dart Sass 1.103.1 to 1.104.0 (and stay in every later 1.x
 * release). Both are quoted from the Dart Sass changelog entry for 1.104.0
 * (https://github.com/sass/dart-sass/blob/main/CHANGELOG.md):
 *
 *   "Potentially breaking compatibility fix: Colors now convert the special values NaN and negative zero, as well as
 *    infinity and negative infinity for polar-hue channels, to 0 as per the CSS spec."
 *   "The special value negative zero is now serialized as `-0` instead of `0` for greater compatibility when using it
 *    in CSS calculations."
 *
 * Before the move the same sources gave `0` and `black` (measured on 1.103.1). A colour whose hue is 0 with 100%
 * saturation and 50% lightness is red (CSS Color: hsl(0, 100%, 50%)), so a NaN hue that becomes 0 gives red.
 */
it('Dart Sass writes negative zero as -0', async () => {
  const source = 'a { b: -0; c: 0 * -1; d: -0px; f: (0 * -5px); }';
  const { css } = await compileStylesheet(source, { language: 'scss', style: 'expanded' });
  expect(css).toBe('a {\n  b: -0;\n  c: -0;\n  d: -0px;\n  f: -0px;\n}');
  // Positive zero is still written as 0.
  const plain = await compileStylesheet('a { b: 0; c: 0 * 1; d: 0px; }', { language: 'scss', style: 'expanded' });
  expect(plain.css).toBe('a {\n  b: 0;\n  c: 0;\n  d: 0px;\n}');
});

it('a colour channel that is not a number is written as 0', async () => {
  // math.div(0, 0) is NaN. As a hue it is converted to 0, and hsl(0, 100%, 50%) is red. Red has hue 0, 100% saturation
  // and 50% lightness, so changing only the hue to 0 keeps it red.
  const source = '@use "sass:color";\n@use "sass:math";\na { b: color.change(red, $hue: math.div(0, 0) * 1deg); }';
  const { css } = await compileStylesheet(source, { language: 'scss', style: 'expanded' });
  expect(css).toBe('a {\n  b: red;\n}');
  const bare = await compileStylesheet('@use "sass:math";\na { b: hsl(math.div(0, 0) * 1deg, 100%, 50%); }', {
    language: 'scss',
    style: 'expanded',
  });
  expect(bare.css).toBe('a {\n  b: red;\n}');
});

it('the limits state the negative zero and NaN colour change', () => {
  const meta = JSON.parse(readFileSync(new URL('../src/meta.json', import.meta.url), 'utf8')) as { limits: string[] };
  const sentence =
    'Dart Sass 1.104 and later writes negative zero as -0 and treats a colour channel that is not a number as 0.';
  expect(meta.limits.filter((entry) => entry === sentence)).toHaveLength(1);
  // It is a new entry added after the earlier ones, which are not rewritten.
  expect(meta.limits[meta.limits.length - 1]).toBe(sentence);
});
