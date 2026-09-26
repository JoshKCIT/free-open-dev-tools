import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { generateFilter, FilterError, FILTER_FUNCTIONS, type FilterLayer } from '../src/index';
import { findUnsafeCss } from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

it('filter functions are written in the chosen order with the units Filter Effects Level 1 defines', () => {
  // Filter Effects Module Level 1 (https://www.w3.org/TR/filter-effects-1/),
  // section 6.1: "blur() = blur( <length>? )" and "grayscale() = grayscale(
  // <number-percentage>? )".
  const forward = generateFilter({
    functions: [
      { name: 'blur', amount: 4 },
      { name: 'grayscale', amount: 50 },
    ],
  });
  expect(forward.value).toBe('blur(4px) grayscale(50%)');
  expect(forward.css).toContain('filter: blur(4px) grayscale(50%);');

  // "The property accepts ... a list of filter functions ... applied in the
  // order provided" -- reversing the slots reverses the output.
  const reversed = generateFilter({
    functions: [
      { name: 'grayscale', amount: 50 },
      { name: 'blur', amount: 4 },
    ],
  });
  expect(reversed.value).toBe('grayscale(50%) blur(4px)');
});

it('amounts outside the range a function allows are clamped with a warning naming the slot', () => {
  // "Values of amount over 100% are allowed but UAs must clamp the values to
  // 1" (grayscale); "Negative values are not allowed" (blur).
  const result = generateFilter({
    functions: [
      { name: 'grayscale', amount: 150 },
      { name: 'blur', amount: -5 },
    ],
  });
  expect(result.value).toBe('grayscale(100%) blur(0px)');
  expect(result.warnings.some((w) => /slot 1/i.test(w))).toBe(true);
  expect(result.warnings.some((w) => /slot 2/i.test(w))).toBe(true);
});

it('drop-shadow is written with offset, blur and colour as Filter Effects Level 1 defines, without spread', () => {
  // "drop-shadow() = drop-shadow( <color>? && <length>{2,3} )" ... "Values
  // are interpreted as for box-shadow but with the optional 3rd <length>
  // value being the standard deviation instead of blur radius." No spread,
  // no inset.
  const result = generateFilter({ functions: [{ name: 'drop-shadow', x: 6, y: 6, blur: 4, color: '#111111' }] });
  expect(result.value).toBe('drop-shadow(6px 6px 4px #111111)');
  expect(result.value).not.toMatch(/inset/);
});

it('the reference form of a filter is never produced', () => {
  const names = FILTER_FUNCTIONS.map((f) => f.name);
  expect(names).not.toContain('url');
  const layers: FilterLayer[] = [
    { name: 'blur', amount: 1e9 },
    { name: 'drop-shadow', x: 1e9, y: -1e9, blur: 1e9, color: 'url(https://example.invalid/x)' },
  ];
  const result = generateFilter({ functions: layers });
  expect(result.value).not.toContain('url(');
  expect(result.css).not.toContain('url(');
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const samples = [
    generateFilter({
      functions: [
        { name: 'blur', amount: 4 },
        { name: 'grayscale', amount: 50 },
      ],
    }),
    generateFilter({ functions: [{ name: 'drop-shadow', x: 6, y: 6, blur: 4, color: '#111111' }] }),
    generateFilter({
      functions: [
        { name: 'sepia', amount: 80 },
        { name: 'hue-rotate', amount: 90 },
        { name: 'saturate', amount: 150 },
        { name: 'contrast', amount: 120 },
      ],
    }),
  ];
  for (const result of samples) {
    const ast = csstree.parse(result.css, { positions: true });
    let declarationCount = 0;
    csstree.walk(ast, (node) => {
      if (node.type === 'Declaration') {
        declarationCount++;
        const match = csstree.lexer.matchProperty(node.property, node.value as never);
        expect(match.error, `${node.property}: ${result.css}`).toBeNull();
        expect(match.matched, `${node.property} did not match: ${result.css}`).not.toBeNull();
      }
    });
    expect(declarationCount).toBe(9); // 5 on .photo, 4 on .photo-label
  }
});

it('hostile field values never produce CSS that can load anything or break out of a rule', () => {
  for (const hostile of HOSTILE_VALUES) {
    for (const build of [
      () => generateFilter({ functions: [{ name: 'drop-shadow', x: 0, y: 0, blur: 0, color: hostile }] }),
    ]) {
      let result;
      try {
        result = build();
      } catch (err) {
        expect(err).toBeInstanceOf(FilterError);
        continue;
      }
      expect(findUnsafeCss(result.css), result.css).toBeNull();
      expect(result.css).not.toContain('example.invalid');
      expect(result.css).not.toContain('url(');
    }
  }

  const numericHostileValues = [NaN, Infinity, -Infinity, 1e21, -1e21, -400];
  for (const value of numericHostileValues) {
    const result = generateFilter({
      functions: [
        { name: 'blur', amount: value },
        { name: 'drop-shadow', x: value, y: value, blur: value, color: '#000000' },
      ],
      width: value,
      height: value,
    });
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const result = generateFilter({ functions: [{ name: 'blur', amount: 4 }] });
  expect(result.tree.className).toBe('photo');
  expect(result.tree.children?.[0]!.className).toBe('photo-label');
  expect(result.css).toContain('.photo {');
  expect(result.css).toMatch(/width: \d+px;/);
  expect(result.css).toMatch(/height: \d+px;/);
  expect(result.css).toContain('filter:');
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generateFilter({ functions: [{ name: 'blur', amount: 4 }] });
    generateFilter({ functions: [{ name: 'drop-shadow', x: 0, y: 0, blur: 0, color: 'not-a-colour' }] });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});
