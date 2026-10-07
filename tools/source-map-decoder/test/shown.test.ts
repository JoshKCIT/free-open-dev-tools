import { expect, it } from 'vitest';
import { decodeStackTrace } from '../src/index';
import { buildMappings } from './helpers';

/*
 * What the decoded trace and the Frames table show of the text a map gives: a path whole in the decoded trace (it is the
 * text a visitor copies into an editor), cut in the table cell.
 */

const TRACE = 'Error: x\n    at f (https://example.test/min.js:1:1)\n    at g (https://example.test/min.js:1:2)';
const ELLIPSIS = String.fromCodePoint(0x2026);

it('the decoded trace keeps a source path over 200 characters whole, and the table cell is cut', () => {
  // The shape of a package path under a .pnpm folder: 284 characters.
  const longPath = 'webpack://app/./node_modules/.pnpm/' + 'a'.repeat(240) + '/index.js';
  const mappings = buildMappings([
    [
      { col: 0, source: 0, line: 4, ocol: 2 },
      { col: 1, source: 0, line: 6, ocol: 0 },
    ],
  ]);
  const report = decodeStackTrace({
    trace: TRACE,
    maps: JSON.stringify({ version: 3, sources: [longPath], names: [], mappings }),
  });
  expect(report.rows[0]!.status).toBe('mapped');
  expect(report.rows[0]!.original.endsWith(`${ELLIPSIS}:5:3`)).toBe(true);
  expect(report.decoded.split('\n')).toEqual(['Error: x', `    at f (${longPath}:5:3)`, `    at g (${longPath}:7:1)`]);

  // A path longer than any real one is still bounded in the decoded trace: its first 4,096 characters are kept.
  const huge = 'webpack://app/' + 'b'.repeat(10_000) + '.js';
  const bounded = decodeStackTrace({
    trace: TRACE,
    maps: JSON.stringify({ version: 3, sources: [huge], names: [], mappings }),
  });
  expect(bounded.decoded.split('\n')[1]).toBe(`    at f (${huge.slice(0, 4096)}${ELLIPSIS}:5:3)`);
});

it('a name from the map is shown with its hidden characters escaped and cut after 200 characters, in the table and the decoded trace', () => {
  // U+202E turns the text after it around; 300 more characters would make a very wide cell.
  const flip = String.fromCodePoint(0x202e);
  const evil = `${flip}evil${'N'.repeat(300)}`;
  const mappings = buildMappings([
    [
      { col: 0, source: 0, line: 0, ocol: 0, name: 0 },
      { col: 1, source: 0, line: 1, ocol: 0, name: 0 },
    ],
  ]);
  const report = decodeStackTrace({
    trace: TRACE,
    maps: JSON.stringify({ version: 3, sources: ['a.js'], names: [evil], mappings }),
  });
  const escaped = `${String.fromCodePoint(92)}u{202E}evil`;
  const row = report.rows[0]!;
  expect(row.status).toBe('mapped');
  // The first 200 characters of the name (the direction character, evil and 195 of the rest), then an ellipsis.
  for (const shown of [row.name, row.functionName]) {
    expect(shown).toBe(`${escaped}${'N'.repeat(195)}${ELLIPSIS}`);
    expect(shown!.includes(flip)).toBe(false);
  }
  expect(report.rows[1]!.name).toBe(row.name);
  // The decoded trace names the first frame from the second frame's call site, escaped and cut the same way.
  expect(report.decoded.includes(flip)).toBe(false);
  expect(report.decoded.split('\n')[1]).toBe(`    at ${row.functionName!} (a.js:1:1)`);
});
