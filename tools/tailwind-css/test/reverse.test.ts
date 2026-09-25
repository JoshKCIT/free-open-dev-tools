import { it, expect, vi } from 'vitest';
import { classesToCss, cssToClasses } from '../src/index';
import { SUPPORTED_CANDIDATES } from '../src/utilities';

it('CSS declarations convert back to the fewest core classes that produce exactly those declarations', () => {
  const css = 'padding: 1rem;\nfont-size: 0.875rem;\nline-height: calc(1.25 / 0.875);';
  const result = cssToClasses(css);
  expect(result.rules[0]!.classes.slice().sort()).toEqual(['p-4', 'text-sm']);
  expect(result.unmatched).toEqual([]);
});

it('padding-left: 1rem; padding-right: 1rem gives pl-4 pr-4, since Tailwind CSS 4 px-4 writes padding-inline, a different property', () => {
  const result = cssToClasses('padding-left: 1rem; padding-right: 1rem;');
  expect(result.classes.split(' ').sort()).toEqual(['pl-4', 'pr-4']);
});

it('color: #ef4444 is listed as unmatched, since the palette is oklch in Tailwind CSS 4', () => {
  const result = cssToClasses('color: #ef4444;');
  expect(result.rules[0]!.classes).toEqual([]);
  expect(result.unmatched).toEqual([{ property: 'color', value: '#ef4444' }]);
});

it('class to CSS to class round trips give the same declarations for every supported class', () => {
  const bad: string[] = [];
  for (const candidate of SUPPORTED_CANDIDATES) {
    const first = classesToCss(candidate);
    if (first.converted.length === 0) continue; // defensive: every candidate should resolve
    const perClassCss = first.converted[0]!.declarations;
    const declText = Object.entries(perClassCss)
      .map(([p, v]) => `${p}: ${v};`)
      .join('\n');
    const back = cssToClasses(declText);
    const roundTripped = classesToCss(back.classes);
    const a = JSON.stringify(Object.entries(perClassCss).sort());
    const b = JSON.stringify(
      Object.entries(roundTripped.converted.reduce((acc, c) => Object.assign(acc, c.declarations), {})).sort(),
    );
    if (a !== b || back.unmatched.length > 0) {
      bad.push(`${candidate}: original=${a} roundTripped=${b} unmatched=${JSON.stringify(back.unmatched)}`);
    }
  }
  expect(bad.slice(0, 20), `${bad.length} of ${SUPPORTED_CANDIDATES.length} failed to round trip`).toEqual([]);
}, 60_000);

it('pixel values match rem-based classes when 1rem is treated as 16px, and only then', () => {
  const on = cssToClasses('padding: 16px;', { remIs16px: true });
  expect(on.classes).toBe('p-4');
  expect(on.unmatched).toEqual([]);

  const off = cssToClasses('padding: 16px;', { remIs16px: false });
  expect(off.classes).toBe('');
  expect(off.unmatched).toEqual([{ property: 'padding', value: '16px' }]);
});

it('declarations no core class produces are listed as unmatched', () => {
  const result = cssToClasses('padding: 1rem; box-shadow: 0 1px 2px red;');
  expect(result.classes).toBe('p-4');
  expect(result.unmatched).toEqual([{ property: 'box-shadow', value: '0 1px 2px red' }]);
});

it('media queries and other at-rules are reported as not converted', () => {
  const result = cssToClasses('@media (min-width: 640px) { .foo { padding: 1rem; } }');
  expect(result.rules).toEqual([]);
  expect(result.warnings.some((w) => w.includes('@media'))).toBe(true);
});

it('nothing is written to the console while converting CSS', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    cssToClasses('padding: 1rem; @media (min-width: 640px) { .foo { color: red; } } color: #ef4444; /* comment */');
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
});
