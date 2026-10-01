import { it, expect } from 'vitest';
import { MarkupError } from '../src/markup';
import { checkSizes, checkSrcset, parseSrcset } from '../src/srcset';

/** The MarkupError a call throws, or null when it does not throw. */
function refusal(run: () => unknown): MarkupError | null {
  try {
    run();
    return null;
  } catch (err) {
    if (err instanceof MarkupError) return err;
    throw err;
  }
}

const srcset =
  (text: string, sizesPresent = false) =>
  () =>
    checkSrcset(parseSrcset(text, 'Srcset'), 'Srcset', { sizesPresent });

it('WHATWG 4.8.4.2.1 srcset: width and density descriptors cannot be mixed and repeated descriptors are refused', () => {
  // WHATWG 4.8.4.3.10: the tokenisation. A comma ends an address that has no descriptor, and a comma inside an address stays.
  expect(parseSrcset('pic-1x.png 1x, pic-2x.png 2x', 'Srcset')).toEqual([
    { url: 'pic-1x.png', descriptor: { kind: 'x', value: '1' } },
    { url: 'pic-2x.png', descriptor: { kind: 'x', value: '2' } },
  ]);
  expect(parseSrcset('a.png, b.png 1.5x', 'Srcset')).toEqual([
    { url: 'a.png', descriptor: null },
    { url: 'b.png', descriptor: { kind: 'x', value: '1.5' } },
  ]);
  expect(parseSrcset('a.png 100w,b.png 200w', 'Srcset').map((c) => c.url)).toEqual(['a.png', 'b.png']);
  expect(parseSrcset('a,b.png 1x', 'Srcset').map((c) => c.url)).toEqual(['a,b.png']);
  expect(parseSrcset('  a.png   2x  ', 'Srcset')).toHaveLength(1);

  // The examples that are valid: densities, widths with sizes, one candidate with no descriptor.
  expect(refusal(srcset('pic-1x.png 1x, pic-2x.png 2x'))).toBeNull();
  expect(refusal(srcset('pic-1x.png, pic-2x.png 2x'))).toBeNull();
  expect(refusal(srcset('a.png 400w, b.png 800w', true))).toBeNull();
  expect(refusal(srcset('a.png'))).toBeNull();

  // WHATWG 4.8.4.2.1: width and density descriptors are never mixed; a candidate with no descriptor counts as 1x.
  const mixed = refusal(srcset('a.png 100w, b.png 2x', true));
  expect(mixed?.field).toBe('Srcset');
  expect(mixed?.message).toContain('cannot be mixed');
  expect(mixed?.message).toContain('4.8.4.2.1');
  expect(refusal(srcset('a.png 100w, b.png', true))?.message).toContain('cannot be mixed');

  // No two candidates repeat a width or a density; no descriptor equals 1x; 1.0x equals 1x.
  const repeated = refusal(srcset('a.png 1x, b.png'));
  expect(repeated?.message).toContain('same');
  expect(repeated?.message).toContain('1x');
  expect(refusal(srcset('a.png 1x, b.png 1.0x'))?.message).toContain('same');
  expect(refusal(srcset('a.png 100w, b.png 100w', true))?.message).toContain('same');
  expect(refusal(srcset('a.png 100w, b.png 0100w', true))?.message).toContain('same');

  // A width is a whole number above zero, a density a number above zero, and a candidate has at most one descriptor.
  expect(refusal(srcset('a.png 0w', true))?.message).toContain('whole number greater than zero');
  expect(refusal(srcset('a.png 1.5w', true))?.message).toContain('whole number greater than zero');
  expect(refusal(srcset('a.png -1x'))?.message).toContain('greater than zero');
  expect(refusal(srcset('a.png 0x'))?.message).toContain('greater than zero');
  expect(refusal(srcset('a.png +1x'))?.message).toContain('pixel density');
  expect(refusal(srcset('a.png 1xx'))?.message).toContain('pixel density');
  expect(refusal(srcset('a.png 2h'))?.message).toContain('descriptor');
  expect(refusal(srcset('a.png 100w 2x'))?.message).toContain('at most one descriptor');
  expect(refusal(srcset('a.png 1x extra'))?.message).toContain('at most one descriptor');

  // Commas: an empty candidate, a leading comma and a trailing comma are all refused.
  expect(refusal(srcset('a.png 1x,, b.png 2x'))?.message).toContain('comma');
  expect(refusal(srcset(', a.png 1x'))?.message).toContain('comma');
  expect(refusal(srcset('a.png 1x,'))?.message).toContain('comma');
  expect(refusal(srcset('a.png,,'))?.message).toContain('comma');

  // Width descriptors need a sizes value, and a sizes value needs width descriptors on every candidate.
  const needsSizes = refusal(srcset('a.png 400w'));
  expect(needsSizes?.field).toBe('Sizes');
  expect(needsSizes?.message).toContain('4.8.3');
  expect(refusal(srcset('a.png 1x, b.png 2x', true))?.message).toContain('width descriptor');

  // The cap of 20 candidates is applied while the list is read.
  const many = Array.from({ length: 21 }, (_, i) => `a${i + 1}.png ${i + 1}w`).join(', ');
  const capped = refusal(() => parseSrcset(many, 'Srcset'));
  expect(capped?.field).toBe('Srcset');
  expect(capped?.message).toContain('20');
  const exact = Array.from({ length: 20 }, (_, i) => `a${i + 1}.png ${i + 1}w`).join(', ');
  expect(parseSrcset(exact, 'Srcset')).toHaveLength(20);
});

const sizes =
  (text: string, lazy = false) =>
  () =>
    checkSizes(text, 'Sizes', { lazy });

it('WHATWG 4.8.4.2.2 sizes needs width descriptors, refuses percentages and negative lengths, and allows auto only with lazy loading', () => {
  // WHATWG 4.8.4.2.2: <source-size-list> = <source-size>#? , <source-size-value>; a media condition then a length.
  expect(refusal(sizes('(max-width: 600px) 100vw, 50vw'))).toBeNull();
  expect(refusal(sizes('50vw'))).toBeNull();
  expect(refusal(sizes('100px'))).toBeNull();
  expect(refusal(sizes('0'))).toBeNull();
  expect(refusal(sizes('12.5em'))).toBeNull();
  expect(refusal(sizes('calc(100vw - 20px)'))).toBeNull();
  expect(refusal(sizes('(min-width: 800px) calc(50vw - 1rem), min(100vw, 400px)'))).toBeNull();
  expect(refusal(sizes('(min-width: 800px) and (max-width: 1200px) clamp(10px, 5vw, 40px), 100vw'))).toBeNull();
  expect(refusal(sizes('not (color) 100vw, 50vw'))).toBeNull();

  // A length is never a percentage and never negative.
  const percent = refusal(sizes('50%'));
  expect(percent?.field).toBe('Sizes');
  expect(percent?.message).toContain('percent');
  expect(refusal(sizes('(max-width: 600px) 100%, 50vw'))?.message).toContain('percent');
  expect(refusal(sizes('calc(100% - 10px)'))?.message).toContain('percent');
  const negative = refusal(sizes('-10px'));
  expect(negative?.message).toContain('negative');
  expect(refusal(sizes('(max-width: 600px) -1vw, 50vw'))?.message).toContain('negative');

  // auto is allowed only as the first entry (or the whole value) and only with lazy loading.
  const noLazy = refusal(sizes('auto, 100vw'));
  expect(noLazy?.message).toContain('lazy');
  expect(refusal(sizes('auto'))?.message).toContain('lazy');
  expect(refusal(sizes('auto, 100vw', true))).toBeNull();
  expect(refusal(sizes('AUTO', true))).toBeNull();
  expect(refusal(sizes('(max-width: 600px) 100vw, auto', true))?.message).toContain('first');

  // The shape of the list: a fallback length last, a condition before every other entry, no empty entry.
  expect(refusal(sizes('(max-width: 600px) 100vw'))?.message).toContain('last');
  expect(refusal(sizes('(max-width: 600px) 100vw, 50vw, 20vw'))?.message).toContain('condition');
  expect(refusal(sizes('100vw,'))?.message).toContain('empty');
  expect(refusal(sizes(''))?.message).toContain('empty');
  expect(refusal(sizes('foo'))?.message).toContain('length');
  expect(refusal(sizes('10'))?.message).toContain('length');
  expect(refusal(sizes('calc(1px'))?.message).toContain('parenthes');
  expect(refusal(sizes('rotate(5deg)'))?.message).toContain('calc, min, max or clamp');
  expect(refusal(sizes('max-width: 600px 100vw, 50vw'))?.message).toContain('condition');

  // Width descriptors need sizes: with sizes present they pass, without it they are refused.
  expect(refusal(() => checkSrcset(parseSrcset('a.png 400w', 'Srcset'), 'Srcset', { sizesPresent: true }))).toBeNull();
  expect(
    refusal(() => checkSrcset(parseSrcset('a.png 400w', 'Srcset'), 'Srcset', { sizesPresent: false })),
  ).not.toBeNull();
});
