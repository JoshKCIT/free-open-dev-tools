import { it, expect, vi } from 'vitest';
import * as csstree from 'css-tree';
import { generateGrid, GridError } from '../src/index';
import { parseTrackList, parseTemplateAreas, GridSyntaxError } from '../src/grid-syntax';
import { findUnsafeCss } from '../src/css-safe';
import { HOSTILE_VALUES } from './hostile-css';

it('generates the plan default: three equal columns and two auto rows with a fixed background', () => {
  const result = generateGrid({});
  expect(result.css).toContain('grid-template-columns: 1fr 1fr 1fr;');
  expect(result.css).toContain('grid-template-rows: auto auto;');
});

it('track lists accept the CSS Grid Level 2 track sizes this tool supports and refuse anything else', () => {
  // Plan behaviour: "columns 1fr 2fr 100px and rows auto 1fr are written
  // back as given; repeat(3, 1fr) and minmax(100px, 1fr) are accepted;
  // url(x), calc(1px, 10 (no unit) and anything outside the subset are
  // refused with a warning and the default is used."
  expect(parseTrackList('1fr 2fr 100px').text).toBe('1fr 2fr 100px');
  expect(parseTrackList('auto 1fr').text).toBe('auto 1fr');
  expect(parseTrackList('repeat(3, 1fr)').text).toBe('repeat(3, 1fr)');
  expect(parseTrackList('repeat(3, 1fr)').trackCount).toBe(3);
  expect(parseTrackList('minmax(100px, 1fr)').text).toBe('minmax(100px, 1fr)');
  expect(parseTrackList('min-content max-content').text).toBe('min-content max-content');

  for (const bad of ['url(x)', 'calc(1px', '10', 'auto-fill', 'fit-content(200px)']) {
    expect(() => parseTrackList(bad)).toThrow(GridSyntaxError);
  }

  // More than 12 tracks after repeat() expansion is refused.
  expect(() => parseTrackList('repeat(12, 1fr) 1fr')).toThrow(GridSyntaxError);

  const result = generateGrid({ columns: 'url(x)' });
  expect(result.css).toContain('grid-template-columns: 1fr 1fr 1fr;');
  expect(result.warnings.some((w) => /Columns could not be parsed/.test(w))).toBe(true);
});

it('each named area must form one filled rectangle as CSS Grid Level 2 requires, otherwise the areas are refused with the name', () => {
  // Section 7.3: "If a named grid area spans multiple grid cells, but
  // those cells do not form a single filled-in rectangle, the declaration
  // is invalid."
  expect(() => parseTemplateAreas('a b\nb a')).toThrow(GridSyntaxError);
  try {
    parseTemplateAreas('a b\nb a');
    expect.fail('expected a GridSyntaxError');
  } catch (err) {
    expect(err).toBeInstanceOf(GridSyntaxError);
    expect((err as GridSyntaxError).message).toContain('a');
  }
  expect(parseTemplateAreas('a a\nb b').areas).toHaveLength(2);

  const result = generateGrid({ areas: 'a b\nb a' });
  expect(result.warnings.some((w) => /could not be parsed/.test(w))).toBe(true);
  expect(result.css).not.toContain('grid-template-areas');
});

it('every row of the areas must have the same number of cells and dots are null cells', () => {
  expect(() => parseTemplateAreas('a b\nc')).toThrow(GridSyntaxError);
  const parsed = parseTemplateAreas('a .\na .');
  expect(parsed.rows).toEqual([
    ['a', null],
    ['a', null],
  ]);
  expect(parsed.areas).toEqual([{ name: 'a', rowStart: 0, rowEnd: 1, columnStart: 0, columnEnd: 0 }]);
});

it('the CSS Grid Level 2 areas example produces its own template and one placed item per area', () => {
  // Section 7.3's own worked example:
  //   grid-template-areas: "head head"
  //                        "nav main"
  //                        "foot ...."
  const result = generateGrid({ areas: 'head head\nnav main\nfoot ....', columns: '1fr 1fr', rows: 'auto auto auto' });
  expect(result.css).toContain('grid-template-areas: "head head" "nav main" "foot .";');
  expect(result.css).toContain('.area-head {');
  expect(result.css).toContain('.area-nav {');
  expect(result.css).toContain('.area-main {');
  expect(result.css).toContain('.area-foot {');
  expect(result.tree.children).toHaveLength(4);
  const names = result.tree.children!.map((c) => c.text);
  expect(names.sort()).toEqual(['foot', 'head', 'main', 'nav']);
});

it('area names become quoted strings and grid-area values holding only validated names', () => {
  const result = generateGrid({ areas: 'header header\nsidebar main', columns: '200px 1fr', rows: 'auto 1fr' });
  expect(result.css).toContain('grid-template-areas: "header header" "sidebar main";');
  expect(result.css).toContain('grid-area: header;');
  expect(result.css).toContain('grid-area: sidebar;');
  expect(result.css).toContain('grid-area: main;');
  // Upper-case letters are refused rather than silently lower-cased.
  expect(() => parseTemplateAreas('Header Header')).toThrow(GridSyntaxError);
});

it('when areas are given the column and row counts must match the area grid, otherwise a warning explains the mismatch', () => {
  const result = generateGrid({ areas: 'a a\nb b', columns: '1fr', rows: 'auto auto' });
  expect(result.warnings.some((w) => /do not match the areas grid/.test(w))).toBe(true);
});

it('without areas, auto-placed items share one .cell rule and each gets its own numbered class', () => {
  const result = generateGrid({ itemCount: 6 });
  expect(result.tree.children).toHaveLength(6);
  expect(result.tree.children![0]!.className).toBe('cell cell-1');
  expect(result.css).toContain('.cell {');
  expect(result.css).not.toContain('.cell-1 {');
});

it('every declaration is valid for its property according to the css-tree lexer', () => {
  const samples = [
    generateGrid({}),
    generateGrid({ areas: 'head head\nnav main', columns: '200px 1fr', rows: 'auto 1fr', columnGap: 8, rowGap: 8 }),
    generateGrid({
      columns: 'repeat(3, minmax(100px, 1fr))',
      itemCount: 3,
      justifyItems: 'center',
      alignItems: 'stretch',
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
    expect(declarationCount).toBeGreaterThan(0);
  }
});

it('hostile field values never produce CSS that can load anything or break out of a rule', () => {
  for (const hostile of HOSTILE_VALUES) {
    let result;
    try {
      result = generateGrid({ columns: hostile, areas: hostile });
    } catch (err) {
      expect(err).toBeInstanceOf(GridError);
      continue;
    }
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
  }

  const numericHostileValues = [NaN, Infinity, -Infinity, 1e21, -1e21, -400];
  for (const value of numericHostileValues) {
    const result = generateGrid({ itemCount: value, columnGap: value, rowGap: value, width: value, height: value });
    expect(findUnsafeCss(result.css), result.css).toBeNull();
    expect(result.css).not.toContain('example.invalid');
  }
});

it('the generated CSS declares everything the preview needs, including the element size', () => {
  const result = generateGrid({ itemCount: 3 });
  expect(result.css).toContain('.grid {');
  expect(result.css).toMatch(/width: \d+px;/);
  expect(result.css).toMatch(/height: \d+px;/);
});

it('nothing is written to the console while generating', () => {
  const spies = ['log', 'warn', 'error', 'info', 'debug'].map((m) =>
    vi.spyOn(console, m as 'log').mockImplementation(() => {}),
  );
  try {
    generateGrid({ columns: 'not-a-track', areas: 'a b\nb a' });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  } finally {
    for (const s of spies) s.mockRestore();
  }
});
