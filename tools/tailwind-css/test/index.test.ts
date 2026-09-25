import { it, expect, vi } from 'vitest';
import { classesToCss, meta } from '../src/index';

it('classesToCss converts a class list to per-class CSS with theme values resolved', () => {
  const result = classesToCss('p-4 text-sm bg-red-500/50');
  expect(result.unknown).toEqual([]);
  expect(result.converted.map((c) => c.className)).toEqual(['p-4', 'text-sm', 'bg-red-500/50']);
  expect(result.css).toContain('.p-4 {\n  padding: 1rem;\n}');
  expect(result.css).toContain('font-size: 0.875rem;');
  expect(result.css).toContain('color-mix(in oklab, oklch(63.7% 0.237 25.331) 50%, transparent)');
});

it('classesToCss in combined mode writes one rule with later classes winning for a repeated property', () => {
  const result = classesToCss('p-2 p-4', { output: 'combined' });
  expect(result.css).toBe('.element {\n  padding: 1rem;\n}');
});

it('classesToCss lists hover:p-4, p-[3px] and prose as not converted', () => {
  const result = classesToCss('p-4 hover:p-4 p-[3px] prose');
  expect(result.unknown).toEqual(['hover:p-4', 'p-[3px]', 'prose']);
  expect(result.converted.map((c) => c.className)).toEqual(['p-4']);
});

it('meta declares the pinned tailwindcss devDependency and the bundled theme notice', () => {
  expect(meta.id).toBe('tailwind-css');
  expect(meta.devDependencies?.tailwindcss).toBe('4.3.3');
  expect(meta.bundledData?.length).toBeGreaterThan(0);
});

it('nothing is written to the console while converting classes', () => {
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    classesToCss('p-4 text-sm bg-red-500/50 hover:p-4 p-[3px] prose grid-cols-3 rounded-t-lg border-t-red-500/25');
  } finally {
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  }
});
